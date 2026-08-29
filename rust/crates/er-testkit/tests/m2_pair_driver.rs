use std::error::Error;

use er_kernel::{GameKernel, KernelConfig};
use er_testkit::{DetachedKeyboardDriver, KeyboardDriver};
use er_types::{
    ChoiceListMenu, GameButton, InputFocus, InputMap, KernelEffect, KeyBinding, MenuGeneration,
    MenuOption, MenuOptionId, MenuState, PhysicalKey, RawInputEvent, SafeU53, SeatId, TimeClass,
    UiState,
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

fn kernel(owner: SeatId) -> Result<GameKernel, Box<dyn Error>> {
    let options = ["one", "two"]
        .into_iter()
        .map(|id| {
            Ok(MenuOption {
                id: MenuOptionId::new(id)?,
                label_key: format!("menu.{id}"),
                enabled: true,
                visible: true,
            })
        })
        .collect::<Result<Vec<_>, Box<dyn Error>>>()?;

    Ok(GameKernel::new(KernelConfig {
        input_map: input_map(),
        initial_ui: UiState {
            generation: MenuGeneration::new(safe(1)),
            owner_seat: Some(owner),
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

fn scheduled_for(effects: &[KernelEffect], endpoint: SeatId) -> usize {
    effects
        .iter()
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::ScheduleTimer {
                    endpoint: effect_endpoint,
                    time_class: TimeClass::HumanInput,
                    ..
                } if *effect_endpoint == endpoint
            )
        })
        .count()
}

fn cancelled_for(effects: &[KernelEffect], endpoint: SeatId) -> usize {
    effects
        .iter()
        .filter(|effect| {
            matches!(
                effect,
                KernelEffect::CancelTimer {
                    endpoint: effect_endpoint,
                    ..
                } if *effect_endpoint == endpoint
            )
        })
        .count()
}

#[test]
fn two_seat_keyboard_drivers_keep_raw_timer_state_isolated() -> TestResult {
    let host_seat = SeatId::new(safe(1));
    let guest_seat = SeatId::new(safe(2));
    let mut host_kernel = kernel(host_seat)?;
    let mut guest_kernel = kernel(guest_seat)?;
    let mut host = KeyboardDriver::new(&mut host_kernel, host_seat);
    let mut guest = KeyboardDriver::new(&mut guest_kernel, guest_seat);

    let host_down = host.key_down(PhysicalKey::ArrowDown, false)?;
    let guest_down = guest.key_down(PhysicalKey::ArrowDown, false)?;
    assert_eq!(scheduled_for(&host_down, host_seat), 1);
    assert_eq!(scheduled_for(&guest_down, guest_seat), 1);
    assert_eq!(host.live_resources().timers.len(), 1);
    assert_eq!(guest.live_resources().timers.len(), 1);

    let host_up = host.key_up(PhysicalKey::ArrowDown)?;
    assert_eq!(cancelled_for(&host_up, host_seat), 1);
    assert!(host.live_resources().timers.is_empty());
    assert_eq!(guest.live_resources().timers.len(), 1);

    let guest_up = guest.key_up(PhysicalKey::ArrowDown)?;
    assert_eq!(cancelled_for(&guest_up, guest_seat), 1);
    assert!(guest.live_resources().timers.is_empty());

    let guest_hold = guest.hold_for(PhysicalKey::ArrowDown, safe(250))?;
    assert_eq!(scheduled_for(&guest_hold, guest_seat), 2);
    assert_eq!(cancelled_for(&guest_hold, guest_seat), 1);
    assert!(guest.live_resources().timers.is_empty());

    let guest_release = guest.key_up(PhysicalKey::ArrowDown)?;
    assert!(guest_release.is_empty());
    assert!(guest.live_resources().timers.is_empty());
    Ok(())
}

#[test]
fn detached_pair_driver_emits_raw_key_down_up_sequences_per_seat() -> TestResult {
    let host_seat = SeatId::new(safe(1));
    let guest_seat = SeatId::new(safe(2));
    let mut host = DetachedKeyboardDriver::new(host_seat);
    let guest = DetachedKeyboardDriver::new(guest_seat);

    assert_ne!(host.seat(), guest.seat());
    assert_eq!(
        host.key_down(PhysicalKey::KeyA, true),
        RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: true,
            browser_repeat: false,
            focus: InputFocus::Game,
        }
    );
    assert_eq!(
        host.key_up(PhysicalKey::KeyA),
        RawInputEvent::KeyUp {
            code: PhysicalKey::KeyA,
        }
    );
    assert_eq!(
        guest.press(PhysicalKey::ArrowDown),
        [
            RawInputEvent::KeyDown {
                code: PhysicalKey::ArrowDown,
                printable: false,
                browser_repeat: false,
                focus: InputFocus::Game,
            },
            RawInputEvent::KeyUp {
                code: PhysicalKey::ArrowDown,
            },
        ]
    );

    assert_eq!(
        host.focus(InputFocus::TextEntry),
        RawInputEvent::FocusChanged(InputFocus::TextEntry)
    );
    let held = host.hold_for(PhysicalKey::KeyA, safe(250));
    assert_eq!(
        held.key_down,
        RawInputEvent::KeyDown {
            code: PhysicalKey::KeyA,
            printable: true,
            browser_repeat: false,
            focus: InputFocus::TextEntry,
        }
    );
    assert_eq!(
        held.key_up,
        RawInputEvent::KeyUp {
            code: PhysicalKey::KeyA,
        }
    );
    assert_eq!(held.duration_ms, safe(250));
    Ok(())
}
