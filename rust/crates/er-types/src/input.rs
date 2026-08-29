//! Raw physical input and logical button contracts.

use serde::{Deserialize, Serialize};

use crate::{SafeU53, TimerId};

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PhysicalKey {
    ArrowUp,
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    Enter,
    Space,
    Escape,
    Backspace,
    KeyA,
    KeyB,
    KeyC,
    KeyD,
    KeyE,
    KeyF,
    KeyN,
    KeyR,
    KeyT,
    Unknown(String),
}

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InputFocus {
    #[default]
    Game,
    TextEntry,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "data", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RawInputEvent {
    KeyDown {
        code: PhysicalKey,
        printable: bool,
        browser_repeat: bool,
        focus: InputFocus,
    },
    KeyUp {
        code: PhysicalKey,
    },
    GamepadDown {
        button: u16,
    },
    GamepadUp {
        button: u16,
    },
    FocusChanged(InputFocus),
    WindowBlurred,
    WindowFocused,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GameButton {
    Up,
    Down,
    Left,
    Right,
    Submit,
    Action,
    Cancel,
    Menu,
    Stats,
    CycleShiny,
    CycleForm,
    CycleGender,
    CycleAbility,
    CycleNature,
    CycleTera,
    SpeedUp,
    SlowDown,
    DevCustom,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct KeyBinding {
    pub key: PhysicalKey,
    pub button: GameButton,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct GamepadBinding {
    pub button_index: u16,
    pub button: GameButton,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InputMap {
    pub keyboard: Vec<KeyBinding>,
    pub gamepad: Vec<GamepadBinding>,
    pub initial_repeat_delay_ms: SafeU53,
    pub repeat_interval_ms: SafeU53,
}

impl Default for InputMap {
    fn default() -> Self {
        let repeat_ms = match SafeU53::new(250) {
            Ok(value) => value,
            Err(_) => SafeU53::ZERO,
        };
        Self {
            keyboard: Vec::new(),
            gamepad: Vec::new(),
            initial_repeat_delay_ms: repeat_ms,
            repeat_interval_ms: repeat_ms,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "button", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ButtonEvent {
    Pressed(GameButton),
    Released(GameButton),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum InputTimerCommand {
    Schedule {
        timer_id: TimerId,
        delay_ms: SafeU53,
    },
    Cancel {
        timer_id: TimerId,
    },
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct InputRouterOutput {
    pub events: Vec<ButtonEvent>,
    pub timers: Vec<InputTimerCommand>,
}

#[cfg(test)]
mod contract_tests {
    use super::*;
    use serde::Serialize;
    use serde::de::DeserializeOwned;
    use serde_json::{Value, json};

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    fn assert_json_round_trip<T>(value: T, expected: Value) -> Result<(), serde_json::Error>
    where
        T: DeserializeOwned + Eq + Serialize + std::fmt::Debug,
    {
        let encoded = serde_json::to_value(&value)?;
        assert_eq!(encoded, expected);

        let decoded: T = serde_json::from_value(encoded.clone())?;
        assert_eq!(decoded, value);
        assert_eq!(serde_json::to_value(&decoded)?, encoded);
        Ok(())
    }

    #[test]
    fn physical_key_vocabulary_and_unknown_values_are_stable() -> TestResult {
        let cases = [
            (PhysicalKey::ArrowUp, json!({"kind": "ARROW_UP"})),
            (PhysicalKey::ArrowDown, json!({"kind": "ARROW_DOWN"})),
            (PhysicalKey::ArrowLeft, json!({"kind": "ARROW_LEFT"})),
            (PhysicalKey::ArrowRight, json!({"kind": "ARROW_RIGHT"})),
            (PhysicalKey::Enter, json!({"kind": "ENTER"})),
            (PhysicalKey::Space, json!({"kind": "SPACE"})),
            (PhysicalKey::Escape, json!({"kind": "ESCAPE"})),
            (PhysicalKey::Backspace, json!({"kind": "BACKSPACE"})),
            (PhysicalKey::KeyA, json!({"kind": "KEY_A"})),
            (PhysicalKey::KeyB, json!({"kind": "KEY_B"})),
            (PhysicalKey::KeyC, json!({"kind": "KEY_C"})),
            (PhysicalKey::KeyD, json!({"kind": "KEY_D"})),
            (PhysicalKey::KeyE, json!({"kind": "KEY_E"})),
            (PhysicalKey::KeyF, json!({"kind": "KEY_F"})),
            (PhysicalKey::KeyN, json!({"kind": "KEY_N"})),
            (PhysicalKey::KeyR, json!({"kind": "KEY_R"})),
            (PhysicalKey::KeyT, json!({"kind": "KEY_T"})),
            (
                PhysicalKey::Unknown("BrowserCode:KeyZ".to_owned()),
                json!({"kind": "UNKNOWN", "value": "BrowserCode:KeyZ"}),
            ),
        ];

        for (key, expected) in cases {
            assert_json_round_trip(key, expected)?;
        }
        Ok(())
    }

    #[test]
    fn input_focus_vocabulary_and_default_are_stable() -> TestResult {
        assert_eq!(InputFocus::default(), InputFocus::Game);
        assert_json_round_trip(InputFocus::Game, json!("GAME"))?;
        assert_json_round_trip(InputFocus::TextEntry, json!("TEXT_ENTRY"))?;
        Ok(())
    }

    #[test]
    fn raw_input_events_preserve_browser_focus_and_window_boundaries() -> TestResult {
        let cases = [
            (
                RawInputEvent::KeyDown {
                    code: PhysicalKey::KeyA,
                    printable: true,
                    browser_repeat: true,
                    focus: InputFocus::TextEntry,
                },
                json!({
                    "kind": "KEY_DOWN",
                    "data": {
                        "code": {"kind": "KEY_A"},
                        "printable": true,
                        "browser_repeat": true,
                        "focus": "TEXT_ENTRY"
                    }
                }),
            ),
            (
                RawInputEvent::KeyUp {
                    code: PhysicalKey::Unknown("BrowserCode:KeyZ".to_owned()),
                },
                json!({
                    "kind": "KEY_UP",
                    "data": {
                        "code": {"kind": "UNKNOWN", "value": "BrowserCode:KeyZ"}
                    }
                }),
            ),
            (
                RawInputEvent::GamepadDown { button: 17 },
                json!({"kind": "GAMEPAD_DOWN", "data": {"button": 17}}),
            ),
            (
                RawInputEvent::GamepadUp { button: 17 },
                json!({"kind": "GAMEPAD_UP", "data": {"button": 17}}),
            ),
            (
                RawInputEvent::FocusChanged(InputFocus::Game),
                json!({"kind": "FOCUS_CHANGED", "data": "GAME"}),
            ),
            (
                RawInputEvent::WindowBlurred,
                json!({"kind": "WINDOW_BLURRED"}),
            ),
            (
                RawInputEvent::WindowFocused,
                json!({"kind": "WINDOW_FOCUSED"}),
            ),
        ];

        for (event, expected) in cases {
            assert_json_round_trip(event, expected)?;
        }
        Ok(())
    }

    #[test]
    fn game_button_vocabulary_is_exhaustive_and_stable() -> TestResult {
        let cases = [
            (GameButton::Up, "UP"),
            (GameButton::Down, "DOWN"),
            (GameButton::Left, "LEFT"),
            (GameButton::Right, "RIGHT"),
            (GameButton::Submit, "SUBMIT"),
            (GameButton::Action, "ACTION"),
            (GameButton::Cancel, "CANCEL"),
            (GameButton::Menu, "MENU"),
            (GameButton::Stats, "STATS"),
            (GameButton::CycleShiny, "CYCLE_SHINY"),
            (GameButton::CycleForm, "CYCLE_FORM"),
            (GameButton::CycleGender, "CYCLE_GENDER"),
            (GameButton::CycleAbility, "CYCLE_ABILITY"),
            (GameButton::CycleNature, "CYCLE_NATURE"),
            (GameButton::CycleTera, "CYCLE_TERA"),
            (GameButton::SpeedUp, "SPEED_UP"),
            (GameButton::SlowDown, "SLOW_DOWN"),
            (GameButton::DevCustom, "DEV_CUSTOM"),
        ];

        for (button, name) in cases {
            assert_json_round_trip(button, json!(name))?;
        }
        Ok(())
    }

    #[test]
    fn bindings_and_repeat_defaults_round_trip_without_loss() -> TestResult {
        let defaults = InputMap::default();
        assert!(defaults.keyboard.is_empty());
        assert!(defaults.gamepad.is_empty());
        assert_eq!(defaults.initial_repeat_delay_ms.get(), 250);
        assert_eq!(defaults.repeat_interval_ms.get(), 250);
        assert_json_round_trip(
            defaults.clone(),
            json!({
                "keyboard": [],
                "gamepad": [],
                "initial_repeat_delay_ms": 250,
                "repeat_interval_ms": 250
            }),
        )?;

        let map = InputMap {
            keyboard: vec![
                KeyBinding {
                    key: PhysicalKey::ArrowUp,
                    button: GameButton::Up,
                },
                KeyBinding {
                    key: PhysicalKey::Unknown("BrowserCode:KeyZ".to_owned()),
                    button: GameButton::DevCustom,
                },
            ],
            gamepad: vec![GamepadBinding {
                button_index: 17,
                button: GameButton::Submit,
            }],
            initial_repeat_delay_ms: defaults.initial_repeat_delay_ms,
            repeat_interval_ms: defaults.repeat_interval_ms,
        };
        assert_json_round_trip(
            map,
            json!({
                "keyboard": [
                    {"key": {"kind": "ARROW_UP"}, "button": "UP"},
                    {
                        "key": {"kind": "UNKNOWN", "value": "BrowserCode:KeyZ"},
                        "button": "DEV_CUSTOM"
                    }
                ],
                "gamepad": [{"button_index": 17, "button": "SUBMIT"}],
                "initial_repeat_delay_ms": 250,
                "repeat_interval_ms": 250
            }),
        )?;
        Ok(())
    }

    #[test]
    fn button_events_timer_commands_and_outputs_keep_wire_shapes() -> TestResult {
        assert_json_round_trip(
            ButtonEvent::Pressed(GameButton::Submit),
            json!({"kind": "PRESSED", "button": "SUBMIT"}),
        )?;
        assert_json_round_trip(
            ButtonEvent::Released(GameButton::Cancel),
            json!({"kind": "RELEASED", "button": "CANCEL"}),
        )?;
        assert_json_round_trip(
            InputTimerCommand::Schedule {
                timer_id: TimerId::ZERO,
                delay_ms: SafeU53::new(250)?,
            },
            json!({"kind": "SCHEDULE", "timer_id": 0, "delay_ms": 250}),
        )?;
        assert_json_round_trip(
            InputTimerCommand::Cancel {
                timer_id: TimerId::ZERO,
            },
            json!({"kind": "CANCEL", "timer_id": 0}),
        )?;

        assert_json_round_trip(
            InputRouterOutput {
                events: vec![
                    ButtonEvent::Pressed(GameButton::Up),
                    ButtonEvent::Released(GameButton::Up),
                ],
                timers: vec![InputTimerCommand::Cancel {
                    timer_id: TimerId::ZERO,
                }],
            },
            json!({
                "events": [
                    {"kind": "PRESSED", "button": "UP"},
                    {"kind": "RELEASED", "button": "UP"}
                ],
                "timers": [{"kind": "CANCEL", "timer_id": 0}]
            }),
        )?;
        Ok(())
    }
}
