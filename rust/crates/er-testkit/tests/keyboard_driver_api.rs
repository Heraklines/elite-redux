use std::error::Error;

use er_kernel::{GameKernel, KernelConfig, KernelEffect};
use er_testkit::KeyboardDriver;
use er_types::{
    ChoiceListMenu, GameButton, InputFocus, InputMap, KeyBinding, MenuGeneration, MenuOption,
    MenuOptionId, MenuState, PhysicalKey, SafeU53, SeatId, UiState,
};

type TestResult = Result<(), Box<dyn Error>>;

const KEYBOARD_DRIVER_SOURCE: &str = include_str!("../src/keyboard_driver.rs");

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
                options: options.collect(),
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

#[test]
fn keyboard_driver_public_surface_is_raw_only_and_kernel_access_is_read_only() {
    let public_methods: Vec<&str> = KEYBOARD_DRIVER_SOURCE
        .lines()
        .filter_map(|line| {
            line.trim_start()
                .strip_prefix("pub fn ")
                .and_then(|rest| rest.split('(').next())
        })
        .collect();
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
            "kernel",
        ]
    );

    for forbidden in [
        "choice",
        "cursor",
        "command",
        "replacement",
        "shop",
        "menu",
        "select",
        "submit",
        "replace",
        "mutate",
    ] {
        let declaration = format!("pub fn {forbidden}(");
        assert!(!KEYBOARD_DRIVER_SOURCE.contains(&declaration));
    }
}

#[test]
fn keyboard_driver_exercises_only_raw_keystrokes_focus_and_timer_lifecycle() -> TestResult {
    let mut game_kernel = kernel()?;
    let seat = SeatId::new(safe(1));
    let mut driver = KeyboardDriver::new(&mut game_kernel, seat);

    let first_down = driver.key_down(PhysicalKey::ArrowDown, false)?;
    assert_eq!(schedules(&first_down), 1);
    let first_up = driver.key_up(PhysicalKey::ArrowDown)?;
    assert_eq!(cancels(&first_up), 1);

    let press = driver.press(PhysicalKey::ArrowUp)?;
    assert_eq!(schedules(&press), 1);
    assert_eq!(cancels(&press), 1);

    let held = driver.hold_for(PhysicalKey::ArrowDown, safe(250))?;
    assert_eq!(schedules(&held), 2);
    assert_eq!(cancels(&held), 1);

    assert!(driver.focus(InputFocus::TextEntry)?.is_empty());
    assert!(driver.key_down(PhysicalKey::KeyA, true)?.is_empty());
    assert!(driver.focus(InputFocus::Game)?.is_empty());
    assert!(driver.key_up(PhysicalKey::KeyA)?.is_empty());
    assert!(driver.blur()?.is_empty());
    assert!(driver.kernel().live_resources().timers.is_empty());
    Ok(())
}
