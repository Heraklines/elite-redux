use std::error::Error;

use er_kernel::{GameKernel, KernelConfig, KernelEffect};
use er_testkit::KeyboardDriver;
use er_types::{
    ChoiceListMenu, GameButton, InputFocus, InputMap, KeyBinding, MenuGeneration, MenuOption,
    MenuOptionId, MenuState, PhysicalKey, SafeU53, SeatId, TimeClass, TimerOwner, UiState,
};

type TestResult = Result<(), Box<dyn Error>>;

fn safe(value: u64) -> SafeU53 {
    match SafeU53::new(value) {
        Ok(value) => value,
        Err(_) => SafeU53::ZERO,
    }
}

fn input_map() -> InputMap {
    let repeat_ms = safe(250);
    InputMap {
        keyboard: vec![
            KeyBinding {
                key: PhysicalKey::ArrowUp,
                button: GameButton::Up,
            },
            KeyBinding {
                key: PhysicalKey::ArrowDown,
                button: GameButton::Down,
            },
            KeyBinding {
                key: PhysicalKey::Enter,
                button: GameButton::Submit,
            },
            KeyBinding {
                key: PhysicalKey::KeyA,
                button: GameButton::Action,
            },
        ],
        gamepad: Vec::new(),
        initial_repeat_delay_ms: repeat_ms,
        repeat_interval_ms: repeat_ms,
    }
}

fn kernel() -> Result<GameKernel, Box<dyn Error>> {
    let options: Vec<MenuOption> = ["one", "two"]
        .into_iter()
        .map(|id| {
            Ok(MenuOption {
                id: MenuOptionId::new(id)?,
                label_key: format!("menu.{id}"),
                enabled: true,
                visible: true,
            })
        })
        .collect::<Result<_, Box<dyn Error>>>()?;
    Ok(GameKernel::new(KernelConfig {
        input_map: input_map(),
        initial_ui: UiState {
            generation: MenuGeneration::new(safe(1)),
            owner_seat: Some(SeatId::new(safe(1))),
            actionable: true,
            stack: vec![MenuState::ChoiceList(ChoiceListMenu {
                cursor: safe(0),
                page: safe(0),
                wrap: true,
                options,
                cancel: er_types::CancelPolicy::Disabled,
            })],
        },
    }))
}

fn schedules(effects: &[KernelEffect]) -> usize {
    effects
        .iter()
        .filter(|effect| matches!(effect, KernelEffect::ScheduleTimer { .. }))
        .count()
}

fn cancels(effects: &[KernelEffect]) -> usize {
    effects
        .iter()
        .filter(|effect| matches!(effect, KernelEffect::CancelTimer { .. }))
        .count()
}

fn scheduled_timer(effects: &[KernelEffect]) -> Option<(SeatId, er_types::TimerId)> {
    effects.iter().find_map(|effect| match effect {
        KernelEffect::ScheduleTimer {
            endpoint,
            timer_id,
            ..
        } => Some((*endpoint, *timer_id)),
        _ => None,
    })
}

fn assert_virtual_schedule(
    effects: &[KernelEffect],
    endpoint: SeatId,
    timer_id: er_types::TimerId,
    button: GameButton,
) {
    assert!(effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ScheduleTimer {
                endpoint: effect_endpoint,
                timer_id: effect_timer,
                owner: TimerOwner::InputRepeat(effect_button),
                delay_ms,
                time_class: TimeClass::Virtual,
            } if *effect_endpoint == endpoint
                && *effect_timer == timer_id
                && *effect_button == button
                && *delay_ms == safe(250)
        )
    }));
}

fn assert_cancel(effects: &[KernelEffect], endpoint: SeatId, timer_id: er_types::TimerId) {
    assert!(effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::CancelTimer {
                endpoint: effect_endpoint,
                timer_id: effect_timer,
            } if *effect_endpoint == endpoint && *effect_timer == timer_id
        )
    }));
}

fn assert_ui_cursor(effects: &[KernelEffect], endpoint: SeatId, cursor: SafeU53) {
    assert!(effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::UiChanged {
                endpoint: effect_endpoint,
                view,
            } if *effect_endpoint == endpoint && view.cursor == Some(cursor)
        )
    }));
}

#[test]
fn keyboard_driver_drives_menu_through_raw_keys_and_owns_repeat_timers() -> TestResult {
    let mut game_kernel = kernel()?;
    let seat = SeatId::new(safe(1));
    let mut driver = KeyboardDriver::new(&mut game_kernel, seat);

    let first_down = driver.key_down(PhysicalKey::ArrowDown, false)?;
    assert_eq!(schedules(&first_down), 1);
    let first_timer = scheduled_timer(&first_down)
        .map(|(endpoint, timer_id)| {
            assert_eq!(endpoint, seat);
            timer_id
        })
        .ok_or_else(|| std::io::Error::other("raw keydown did not schedule a timer"))?;
    assert_virtual_schedule(&first_down, seat, first_timer, GameButton::Down);
    assert_ui_cursor(&first_down, seat, safe(1));
    assert_eq!(driver.kernel().ui_view().cursor, Some(safe(1)));
    assert!(driver.kernel().live_resources().timers.contains(&first_timer));

    let first_up = driver.key_up(PhysicalKey::ArrowDown)?;
    assert_eq!(cancels(&first_up), 1);
    assert_cancel(&first_up, seat, first_timer);
    assert!(driver.kernel().live_resources().timers.is_empty());

    let press = driver.press(PhysicalKey::ArrowUp)?;
    assert_eq!(schedules(&press), 1);
    assert_eq!(cancels(&press), 1);
    let pressed_timer = scheduled_timer(&press)
        .map(|(endpoint, timer_id)| {
            assert_eq!(endpoint, seat);
            timer_id
        })
        .ok_or_else(|| std::io::Error::other("raw press did not schedule a timer"))?;
    assert_virtual_schedule(&press, seat, pressed_timer, GameButton::Up);
    assert_cancel(&press, seat, pressed_timer);
    assert_ui_cursor(&press, seat, safe(0));
    assert_eq!(driver.kernel().ui_view().cursor, Some(safe(0)));
    assert!(driver.kernel().live_resources().timers.is_empty());

    let held = driver.hold_for(PhysicalKey::ArrowDown, safe(250))?;
    assert_eq!(schedules(&held), 2);
    assert_eq!(cancels(&held), 1);
    let held_timer = scheduled_timer(&held)
        .map(|(endpoint, timer_id)| {
            assert_eq!(endpoint, seat);
            timer_id
        })
        .ok_or_else(|| std::io::Error::other("raw hold did not schedule a timer"))?;
    assert_virtual_schedule(&held, seat, held_timer, GameButton::Down);
    assert_cancel(&held, seat, held_timer);
    assert_ui_cursor(&held, seat, safe(0));
    assert_eq!(driver.kernel().ui_view().cursor, Some(safe(0)));
    assert!(driver.kernel().live_resources().timers.is_empty());

    let before_text_entry = driver.kernel().ui_view();
    assert!(driver.focus(InputFocus::TextEntry)?.is_empty());
    assert!(driver.key_down(PhysicalKey::KeyA, true)?.is_empty());
    assert!(driver.focus(InputFocus::Game)?.is_empty());
    assert!(driver.key_up(PhysicalKey::KeyA)?.is_empty());
    assert_eq!(driver.kernel().ui_view(), before_text_entry);
    assert!(driver.blur()?.is_empty());
    assert!(driver.kernel().live_resources().timers.is_empty());
    Ok(())
}
