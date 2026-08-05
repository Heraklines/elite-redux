//! Logical menu state, semantic intents, and immutable renderer projection.

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{ButtonEvent, MenuGeneration, MenuOptionId, OperationId, SafeU53, SeatId};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UiState {
    pub generation: MenuGeneration,
    pub owner_seat: Option<SeatId>,
    pub actionable: bool,
    pub stack: Vec<MenuState>,
}

impl Default for UiState {
    fn default() -> Self {
        Self {
            generation: MenuGeneration::ZERO,
            owner_seat: None,
            actionable: false,
            stack: vec![MenuState::None],
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "menu", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MenuState {
    None,
    Waiting(WaitingMenu),
    Message(MessageMenu),
    Confirm(ConfirmMenu),
    ChoiceList(ChoiceListMenu),
    Command(CommandMenu),
    Replacement(ReplacementMenu),
    Interaction(InteractionMenu),
    Terminal(TerminalMenu),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct WaitingMenu {
    pub prompt_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MessageMenu {
    pub prompt_key: Option<String>,
    pub cancel: CancelPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ConfirmMenu {
    pub cursor: SafeU53,
    pub options: Vec<MenuOption>,
    pub cancel: CancelPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MenuOption {
    pub id: MenuOptionId,
    pub label_key: String,
    pub enabled: bool,
    pub visible: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ChoiceListMenu {
    pub cursor: SafeU53,
    pub page: SafeU53,
    pub wrap: bool,
    pub options: Vec<MenuOption>,
    pub cancel: CancelPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct CommandMenu {
    pub operation_id: OperationId,
    pub control_id: String,
    pub cursor: SafeU53,
    pub options: Vec<MenuOption>,
    pub cancel: CancelPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ReplacementMenu {
    pub operation_id: OperationId,
    pub control_id: String,
    pub field_index: SafeU53,
    pub cursor: SafeU53,
    pub options: Vec<MenuOption>,
    pub cancel: CancelPolicy,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct InteractionMenu {
    pub operation_id: OperationId,
    pub control_id: String,
    pub surface_class: String,
    pub operation_kind: String,
    pub choice: ChoiceListMenu,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TerminalMenu {
    pub terminal_id: String,
    pub prompt_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "option_id",
    rename_all = "SCREAMING_SNAKE_CASE"
)]
pub enum CancelPolicy {
    Disabled,
    Close,
    Back,
    Select(MenuOptionId),
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UiViewKind {
    None,
    Waiting,
    Message,
    Confirm,
    ChoiceList,
    Command,
    Replacement,
    Interaction,
    Terminal,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MenuOptionView {
    pub id: MenuOptionId,
    pub label_key: String,
    pub enabled: bool,
    pub visible: bool,
    pub selected: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UiViewModel {
    pub generation: MenuGeneration,
    pub owner_seat: Option<SeatId>,
    pub actionable: bool,
    pub kind: UiViewKind,
    pub cursor: Option<SafeU53>,
    pub options: Vec<MenuOptionView>,
    pub prompt_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UiIntent {
    CursorChanged {
        seat: SeatId,
        generation: MenuGeneration,
        cursor: SafeU53,
    },
    CancelRequested {
        seat: SeatId,
        generation: MenuGeneration,
    },
    CommandSubmitted {
        seat: SeatId,
        generation: MenuGeneration,
        operation_id: OperationId,
        control_id: String,
        option_id: MenuOptionId,
    },
    ReplacementSubmitted {
        seat: SeatId,
        generation: MenuGeneration,
        operation_id: OperationId,
        control_id: String,
        option_id: MenuOptionId,
    },
    InteractionSubmitted {
        seat: SeatId,
        generation: MenuGeneration,
        operation_id: OperationId,
        control_id: String,
        option_id: MenuOptionId,
    },
    MessageAdvanced {
        seat: SeatId,
        generation: MenuGeneration,
    },
    Confirmed {
        seat: SeatId,
        generation: MenuGeneration,
        accepted: bool,
    },
    MenuOpened {
        seat: SeatId,
        generation: MenuGeneration,
    },
    MenuClosed {
        seat: SeatId,
        generation: MenuGeneration,
    },
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UiRejectReason {
    #[error("the input seat does not own the menu")]
    WrongSeat,
    #[error("the menu generation is stale")]
    StaleGeneration,
    #[error("the menu is not actionable")]
    NonActionable,
    #[error("the selected option is disabled or hidden")]
    DisabledOption,
    #[error("the menu cursor is invalid")]
    InvalidCursor,
    #[error("the button has no meaning for the active menu")]
    UnsupportedButton,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UiReduction {
    pub source: ButtonEvent,
    pub intents: Vec<UiIntent>,
    pub view: UiViewModel,
}
