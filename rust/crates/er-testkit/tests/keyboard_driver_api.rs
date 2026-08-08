use std::error::Error;

use er_kernel::{GameKernel, KernelConfig, KernelEffect};
use er_testkit::KeyboardDriver;
use er_types::{
    ChoiceListMenu, GameButton, InputFocus, InputMap, KeyBinding, MenuGeneration, MenuOption,
    MenuOptionId, MenuState, PhysicalKey, SafeU53, SeatId, TimeClass, TimerOwner, UiState,
};

type TestResult = Result<(), Box<dyn Error>>;

#[test]
fn keyboard_driver_public_surface_stays_on_raw_input_and_read_only_state() {
    let source = include_str!("../src/keyboard_driver.rs");
    let implementation = source
        .split("impl<'kernel> KeyboardDriver<'kernel> {")
        .nth(1)
        .and_then(|body| body.split("\nfn is_printable").next())
        .expect("KeyboardDriver implementation must remain present");

    let public_signatures = public_signatures(implementation);
    let public_methods = public_signatures
        .iter()
        .filter_map(|signature| signature.strip_prefix("pub fn "))
        .filter_map(|signature| signature.split('(').next())
        .map(str::to_owned)
        .collect::<Vec<_>>();

    assert_eq!(
        public_methods,
        vec![
            "new",
            "key_down",
            "key_up",
            "press",
            "hold_for",
            "blur",
            "focus",
            "ui_view",
            "live_resources",
        ]
    );

    for forbidden in [
        "kernel",
        "kernel_mut",
        "kernel_ref",
        "kernel_handle",
        "kernel_state",
        "with_kernel",
        "reducer",
        "reducer_mut",
        "reducer_ref",
        "reducer_handle",
        "ui_reducer",
        "with_reducer",
        "menu",
        "menu_mut",
        "menu_ref",
        "menu_handle",
        "menu_state",
        "menu_view",
        "with_menu",
        "select_command",
        "choose_command",
        "select_replacement",
        "choose_replacement",
        "select_option",
        "choose_option",
        "set_cursor",
        "submit_choice",
        "submit_command",
        "submit_interaction",
        "open_menu",
        "close_menu",
        "inject_intent",
        "send_intent",
        "dispatch_intent",
    ] {
        assert!(
            !public_methods.iter().any(|method| method == forbidden),
            "forbidden public KeyboardDriver method {forbidden} must not enter the driver surface"
        );
    }

    for forbidden in [
        "GameKernel",
        "UiReducer",
        "UiState",
        "MenuState",
        "ChoiceListMenu",
    ] {
        assert!(
            public_signatures
                .iter()
                .filter_map(|signature| signature
                    .split_once(") ->")
                    .map(|(_, return_type)| return_type))
                .all(|return_type| !return_type.contains(forbidden)),
            "public KeyboardDriver methods must not return {forbidden} handles or state"
        );
    }

    for forbidden in [
        "UiIntent",
        "KernelInput",
        "Box<dyn",
        "dyn ",
        "Fn",
        "dyn Fn",
        "impl Fn",
        "FnMut",
        "FnOnce",
    ] {
        assert!(
            public_signatures
                .iter()
                .all(|signature| !signature.contains(forbidden)),
            "public KeyboardDriver API must not expose {forbidden}"
        );
    }

    for forbidden in [
        "pub fn kernel(",
        "pub fn kernel_mut(",
        "pub fn reducer(",
        "pub fn reducer_mut(",
        "pub fn menu(",
        "pub fn menu_mut(",
        "-> &GameKernel",
        "-> &mut GameKernel",
        "-> &UiReducer",
        "-> &mut UiReducer",
        "UiIntent",
        "KernelInput::UiIntent",
    ] {
        assert!(
            !implementation.contains(forbidden),
            "forbidden KeyboardDriver surface {forbidden} must remain absent"
        );
    }
}

fn public_signatures(implementation: &str) -> Vec<String> {
    let mut signatures = Vec::new();
    let mut current = None;

    for line in implementation.lines().map(str::trim) {
        if line.starts_with("pub fn ") {
            current = Some(line.to_owned());
        } else if let Some(signature) = current.as_mut() {
            signature.push(' ');
            signature.push_str(line);
        } else {
            continue;
        }

        if line.contains('{')
            && let Some(signature) = current.take()
        {
            signatures.push(signature);
        }
    }

    signatures
}

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
        protocol: None,
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
            endpoint, timer_id, ..
        } => Some((*endpoint, *timer_id)),
        _ => None,
    })
}

fn scheduled_timers(effects: &[KernelEffect]) -> Vec<(SeatId, er_types::TimerId)> {
    effects
        .iter()
        .filter_map(|effect| match effect {
            KernelEffect::ScheduleTimer {
                endpoint, timer_id, ..
            } => Some((*endpoint, *timer_id)),
            _ => None,
        })
        .collect()
}

fn assert_human_input_schedule(
    effects: &[KernelEffect],
    endpoint: SeatId,
    timer_id: er_types::TimerId,
    button: GameButton,
) {
    let expected_owner = TimerOwner::input_repeat(button);
    assert!(effects.iter().any(|effect| {
        matches!(
            effect,
            KernelEffect::ScheduleTimer {
                endpoint: effect_endpoint,
                timer_id: effect_timer,
                owner,
                delay_ms,
                time_class: TimeClass::HumanInput,
            } if *effect_endpoint == endpoint
                && *effect_timer == timer_id
                && owner == &expected_owner
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
    assert_human_input_schedule(&first_down, seat, first_timer, GameButton::Down);
    assert_ui_cursor(&first_down, seat, safe(1));
    assert_eq!(driver.ui_view().cursor, Some(safe(1)));
    assert!(driver.live_resources().timers.contains(&first_timer));

    let first_up = driver.key_up(PhysicalKey::ArrowDown)?;
    assert_eq!(cancels(&first_up), 1);
    assert_cancel(&first_up, seat, first_timer);
    assert!(driver.live_resources().timers.is_empty());

    let press = driver.press(PhysicalKey::ArrowUp)?;
    assert_eq!(schedules(&press), 1);
    assert_eq!(cancels(&press), 1);
    let pressed_timer = scheduled_timer(&press)
        .map(|(endpoint, timer_id)| {
            assert_eq!(endpoint, seat);
            timer_id
        })
        .ok_or_else(|| std::io::Error::other("raw press did not schedule a timer"))?;
    assert_human_input_schedule(&press, seat, pressed_timer, GameButton::Up);
    assert_cancel(&press, seat, pressed_timer);
    assert_ui_cursor(&press, seat, safe(0));
    assert_eq!(driver.ui_view().cursor, Some(safe(0)));
    assert!(driver.live_resources().timers.is_empty());

    let held = driver.hold_for(PhysicalKey::ArrowDown, safe(250))?;
    assert_eq!(schedules(&held), 2);
    assert_eq!(cancels(&held), 1);
    let held_timers = scheduled_timers(&held);
    assert_eq!(held_timers.len(), 2, "raw hold must schedule two timers");
    let (held_endpoint, held_timer) = held_timers[0];
    let (repeat_endpoint, repeat_timer) = held_timers[1];
    assert_eq!(held_endpoint, seat);
    assert_eq!(repeat_endpoint, seat);
    assert_ne!(
        held_timer, repeat_timer,
        "repeats must receive fresh timer IDs"
    );
    assert_human_input_schedule(&held, seat, held_timer, GameButton::Down);
    assert_human_input_schedule(&held, seat, repeat_timer, GameButton::Down);
    assert_cancel(&held, seat, repeat_timer);
    assert_ui_cursor(&held, seat, safe(0));
    assert_eq!(driver.ui_view().cursor, Some(safe(0)));
    assert!(driver.live_resources().timers.is_empty());

    let before_text_entry = driver.ui_view();
    assert!(driver.focus(InputFocus::TextEntry)?.is_empty());
    assert!(driver.key_down(PhysicalKey::KeyA, true)?.is_empty());
    assert!(driver.focus(InputFocus::Game)?.is_empty());
    assert!(driver.key_up(PhysicalKey::KeyA)?.is_empty());
    assert_eq!(driver.ui_view(), before_text_entry);
    assert!(driver.blur()?.is_empty());
    assert!(driver.live_resources().timers.is_empty());
    Ok(())
}
