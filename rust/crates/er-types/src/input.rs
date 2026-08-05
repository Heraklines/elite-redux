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
