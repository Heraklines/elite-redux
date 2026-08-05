//! Logical menu state, semantic intents, and immutable renderer projection.

use serde::{Deserialize, Deserializer, Serialize};
use thiserror::Error;

use crate::{ButtonEvent, MenuGeneration, MenuOptionId, OperationId, SafeU53, SeatId};

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct UiState {
    pub generation: MenuGeneration,
    #[serde(deserialize_with = "deserialize_required_nullable")]
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
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub prompt_key: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct MessageMenu {
    #[serde(deserialize_with = "deserialize_required_nullable")]
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
    #[serde(deserialize_with = "deserialize_required_nullable")]
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
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub owner_seat: Option<SeatId>,
    pub actionable: bool,
    pub kind: UiViewKind,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub cursor: Option<SafeU53>,
    pub options: Vec<MenuOptionView>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
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

#[cfg(test)]
mod tests {
    use std::error::Error;

    use serde_json::{Value, json};

    use super::*;
    use crate::{GameButton, JS_MAX_SAFE_INTEGER};

    type TestResult<T = ()> = Result<T, Box<dyn Error>>;

    fn safe(value: u64) -> TestResult<SafeU53> {
        Ok(SafeU53::new(value)?)
    }

    fn option_id(value: &str) -> TestResult<MenuOptionId> {
        Ok(MenuOptionId::new(value)?)
    }

    fn operation_id(value: &str) -> TestResult<OperationId> {
        Ok(OperationId::new(value)?)
    }

    fn menu_option(
        id: &str,
        label_key: &str,
        enabled: bool,
        visible: bool,
    ) -> TestResult<MenuOption> {
        Ok(MenuOption {
            id: option_id(id)?,
            label_key: label_key.to_owned(),
            enabled,
            visible,
        })
    }

    fn invalid_data(message: impl Into<String>) -> Box<dyn Error> {
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message.into(),
        ))
    }

    fn required<'a>(value: &'a Value, field: &str) -> TestResult<&'a Value> {
        value
            .get(field)
            .ok_or_else(|| invalid_data(format!("missing JSON field {field}")))
    }

    fn sample_state() -> TestResult<UiState> {
        let first_option = menu_option("choice:first", "menu.first", true, true)?;
        let second_option = menu_option("choice:second", "menu.second", false, true)?;
        let choice = ChoiceListMenu {
            cursor: safe(1)?,
            page: safe(JS_MAX_SAFE_INTEGER)?,
            wrap: true,
            options: vec![first_option.clone(), second_option.clone()],
            cancel: CancelPolicy::Select(second_option.id.clone()),
        };

        Ok(UiState {
            generation: MenuGeneration::new(safe(42)?),
            owner_seat: Some(SeatId::new(safe(3)?)),
            actionable: true,
            stack: vec![
                MenuState::None,
                MenuState::Waiting(WaitingMenu {
                    prompt_key: Some("menu.wait".to_owned()),
                }),
                MenuState::Message(MessageMenu {
                    prompt_key: None,
                    cancel: CancelPolicy::Back,
                }),
                MenuState::Confirm(ConfirmMenu {
                    cursor: safe(0)?,
                    options: vec![first_option.clone()],
                    cancel: CancelPolicy::Close,
                }),
                MenuState::ChoiceList(choice.clone()),
                MenuState::Command(CommandMenu {
                    operation_id: operation_id("operation:command")?,
                    control_id: "control:command".to_owned(),
                    cursor: safe(2)?,
                    options: vec![first_option.clone()],
                    cancel: CancelPolicy::Close,
                }),
                MenuState::Replacement(ReplacementMenu {
                    operation_id: operation_id("operation:replacement")?,
                    control_id: "control:replacement".to_owned(),
                    field_index: safe(JS_MAX_SAFE_INTEGER)?,
                    cursor: safe(1)?,
                    options: vec![second_option.clone()],
                    cancel: CancelPolicy::Disabled,
                }),
                MenuState::Interaction(InteractionMenu {
                    operation_id: operation_id("operation:interaction")?,
                    control_id: "control:interaction".to_owned(),
                    surface_class: "surface:choice".to_owned(),
                    operation_kind: "CHOICE".to_owned(),
                    choice,
                }),
                MenuState::Terminal(TerminalMenu {
                    terminal_id: "terminal:done".to_owned(),
                    prompt_key: None,
                }),
            ],
        })
    }

    #[test]
    fn menu_state_round_trip_preserves_variants_coordinates_and_identities() -> TestResult {
        let state = sample_state()?;
        let encoded = serde_json::to_value(&state)?;
        let stack = required(&encoded, "stack")?
            .as_array()
            .ok_or_else(|| invalid_data("stack must be an array"))?;
        let kinds = stack
            .iter()
            .map(|menu| required(menu, "kind").cloned())
            .collect::<TestResult<Vec<_>>>()?;
        assert_eq!(
            kinds,
            vec![
                json!("NONE"),
                json!("WAITING"),
                json!("MESSAGE"),
                json!("CONFIRM"),
                json!("CHOICE_LIST"),
                json!("COMMAND"),
                json!("REPLACEMENT"),
                json!("INTERACTION"),
                json!("TERMINAL"),
            ]
        );

        assert_eq!(encoded["generation"], json!(42));
        assert_eq!(encoded["owner_seat"], json!(3));
        assert_eq!(stack[4]["menu"]["page"], json!(JS_MAX_SAFE_INTEGER));
        assert_eq!(stack[6]["menu"]["field_index"], json!(JS_MAX_SAFE_INTEGER));
        assert_eq!(stack[5]["menu"]["operation_id"], json!("operation:command"));
        assert_eq!(stack[5]["menu"]["control_id"], json!("control:command"));
        assert_eq!(stack[4]["menu"]["options"][0]["id"], json!("choice:first"));
        assert_eq!(stack[4]["menu"]["options"][1]["id"], json!("choice:second"));

        let decoded: UiState = serde_json::from_value(encoded)?;
        assert_eq!(decoded, state);
        Ok(())
    }

    #[test]
    fn safe_coordinates_reject_values_outside_u53() -> TestResult {
        assert!(SafeU53::new(JS_MAX_SAFE_INTEGER).is_ok());
        assert!(SafeU53::new(JS_MAX_SAFE_INTEGER + 1).is_err());

        let invalid_choice = json!({
            "cursor": JS_MAX_SAFE_INTEGER + 1,
            "page": 0,
            "wrap": false,
            "options": [],
            "cancel": { "kind": "DISABLED" }
        });
        assert!(serde_json::from_value::<ChoiceListMenu>(invalid_choice).is_err());

        let invalid_replacement = json!({
            "operation_id": "operation:replacement",
            "control_id": "control:replacement",
            "field_index": JS_MAX_SAFE_INTEGER + 1,
            "cursor": 0,
            "options": [],
            "cancel": { "kind": "DISABLED" }
        });
        assert!(serde_json::from_value::<ReplacementMenu>(invalid_replacement).is_err());
        Ok(())
    }

    #[test]
    fn cancel_policies_round_trip_their_semantic_kind_and_option() -> TestResult {
        let selected = option_id("cancel:option")?;
        let policies = vec![
            (CancelPolicy::Disabled, json!("DISABLED")),
            (CancelPolicy::Close, json!("CLOSE")),
            (CancelPolicy::Back, json!("BACK")),
            (CancelPolicy::Select(selected), json!("SELECT")),
        ];

        for (policy, expected_kind) in policies {
            let encoded = serde_json::to_value(&policy)?;
            assert_eq!(encoded["kind"], expected_kind);
            if matches!(&policy, CancelPolicy::Select(_)) {
                assert_eq!(encoded["option_id"], json!("cancel:option"));
            } else {
                assert!(encoded.get("option_id").is_none());
            }
            let decoded: CancelPolicy = serde_json::from_value(encoded)?;
            assert_eq!(decoded, policy);
        }
        Ok(())
    }

    fn sample_intents() -> TestResult<Vec<UiIntent>> {
        let seat = SeatId::new(safe(4)?);
        let generation = MenuGeneration::new(safe(12)?);
        let operation = operation_id("operation:semantic")?;
        let option = option_id("option:semantic")?;
        Ok(vec![
            UiIntent::CursorChanged {
                seat,
                generation,
                cursor: safe(1)?,
            },
            UiIntent::CancelRequested { seat, generation },
            UiIntent::CommandSubmitted {
                seat,
                generation,
                operation_id: operation.clone(),
                control_id: "control:command".to_owned(),
                option_id: option.clone(),
            },
            UiIntent::ReplacementSubmitted {
                seat,
                generation,
                operation_id: operation.clone(),
                control_id: "control:replacement".to_owned(),
                option_id: option.clone(),
            },
            UiIntent::InteractionSubmitted {
                seat,
                generation,
                operation_id: operation,
                control_id: "control:interaction".to_owned(),
                option_id: option,
            },
            UiIntent::MessageAdvanced { seat, generation },
            UiIntent::Confirmed {
                seat,
                generation,
                accepted: true,
            },
            UiIntent::MenuOpened { seat, generation },
            UiIntent::MenuClosed { seat, generation },
        ])
    }

    #[test]
    fn intents_round_trip_with_seat_generation_and_semantic_ids() -> TestResult {
        let intents = sample_intents()?;
        let encoded = serde_json::to_value(&intents)?;
        let values = encoded
            .as_array()
            .ok_or_else(|| invalid_data("intents must be an array"))?;
        let expected_kinds = [
            "CURSOR_CHANGED",
            "CANCEL_REQUESTED",
            "COMMAND_SUBMITTED",
            "REPLACEMENT_SUBMITTED",
            "INTERACTION_SUBMITTED",
            "MESSAGE_ADVANCED",
            "CONFIRMED",
            "MENU_OPENED",
            "MENU_CLOSED",
        ];
        assert_eq!(values.len(), expected_kinds.len());
        for (value, expected_kind) in values.iter().zip(expected_kinds) {
            assert_eq!(value["kind"], json!(expected_kind));
            assert_eq!(value["seat"], json!(4));
            assert_eq!(value["generation"], json!(12));
        }
        for index in [2, 3, 4] {
            assert_eq!(values[index]["operation_id"], json!("operation:semantic"));
            assert_eq!(values[index]["option_id"], json!("option:semantic"));
        }
        assert_eq!(values[2]["control_id"], json!("control:command"));
        assert_eq!(values[3]["control_id"], json!("control:replacement"));
        assert_eq!(values[4]["control_id"], json!("control:interaction"));

        let decoded: Vec<UiIntent> = serde_json::from_value(encoded)?;
        assert_eq!(decoded, intents);
        Ok(())
    }

    #[test]
    fn nullable_ui_values_are_explicit_and_missing_fields_are_not_silent() -> TestResult {
        let state = UiState::default();
        let state_json = serde_json::to_value(&state)?;
        assert_eq!(state_json["owner_seat"], Value::Null);
        let mut missing_owner = state_json;
        let owner_object = missing_owner
            .as_object_mut()
            .ok_or_else(|| invalid_data("UiState must serialize as an object"))?;
        assert!(owner_object.remove("owner_seat").is_some());
        assert!(serde_json::from_value::<UiState>(missing_owner).is_err());

        let view = UiViewModel {
            generation: MenuGeneration::ZERO,
            owner_seat: None,
            actionable: false,
            kind: UiViewKind::None,
            cursor: None,
            options: Vec::new(),
            prompt_key: None,
        };
        let view_json = serde_json::to_value(&view)?;
        assert_eq!(view_json["owner_seat"], Value::Null);
        assert_eq!(view_json["cursor"], Value::Null);
        assert_eq!(view_json["prompt_key"], Value::Null);

        let mut missing_cursor = view_json;
        let cursor_object = missing_cursor
            .as_object_mut()
            .ok_or_else(|| invalid_data("UiViewModel must serialize as an object"))?;
        assert!(cursor_object.remove("cursor").is_some());
        assert!(serde_json::from_value::<UiViewModel>(missing_cursor).is_err());
        Ok(())
    }

    #[test]
    fn renderer_projection_clone_does_not_share_mutable_state() -> TestResult {
        let original = UiViewModel {
            generation: MenuGeneration::new(safe(7)?),
            owner_seat: Some(SeatId::new(safe(1)?)),
            actionable: true,
            kind: UiViewKind::ChoiceList,
            cursor: Some(safe(0)?),
            options: vec![MenuOptionView {
                id: option_id("option:render")?,
                label_key: "menu.render".to_owned(),
                enabled: true,
                visible: true,
                selected: true,
            }],
            prompt_key: Some("menu.prompt".to_owned()),
        };
        let encoded = serde_json::to_value(&original)?;
        assert_eq!(encoded["kind"], json!("CHOICE_LIST"));
        let decoded: UiViewModel = serde_json::from_value(encoded)?;
        assert_eq!(decoded, original);

        let mut renderer_view = original.clone();
        renderer_view.options[0].selected = false;
        renderer_view.options.push(MenuOptionView {
            id: option_id("option:second")?,
            label_key: "menu.second".to_owned(),
            enabled: false,
            visible: true,
            selected: false,
        });
        renderer_view.prompt_key = None;

        assert!(original.options[0].selected);
        assert_eq!(original.options.len(), 1);
        assert_eq!(original.prompt_key.as_deref(), Some("menu.prompt"));
        assert_eq!(renderer_view.options.len(), 2);
        assert!(!renderer_view.options[0].selected);
        assert_eq!(renderer_view.prompt_key, None);
        Ok(())
    }

    #[test]
    fn every_view_kind_has_a_stable_wire_tag() -> TestResult {
        let cases = [
            (UiViewKind::None, "NONE"),
            (UiViewKind::Waiting, "WAITING"),
            (UiViewKind::Message, "MESSAGE"),
            (UiViewKind::Confirm, "CONFIRM"),
            (UiViewKind::ChoiceList, "CHOICE_LIST"),
            (UiViewKind::Command, "COMMAND"),
            (UiViewKind::Replacement, "REPLACEMENT"),
            (UiViewKind::Interaction, "INTERACTION"),
            (UiViewKind::Terminal, "TERMINAL"),
        ];
        for (kind, tag) in cases {
            let encoded = serde_json::to_value(kind)?;
            assert_eq!(encoded, json!(tag));
            let decoded: UiViewKind = serde_json::from_value(encoded)?;
            assert_eq!(decoded, kind);
        }
        Ok(())
    }

    #[test]
    fn reduction_and_rejection_dtos_round_trip() -> TestResult {
        let reduction = UiReduction {
            source: ButtonEvent::Pressed(GameButton::Submit),
            intents: sample_intents()?,
            view: UiViewModel {
                generation: MenuGeneration::new(safe(12)?),
                owner_seat: Some(SeatId::new(safe(4)?)),
                actionable: true,
                kind: UiViewKind::Command,
                cursor: Some(safe(2)?),
                options: vec![MenuOptionView {
                    id: option_id("option:reduction")?,
                    label_key: "menu.reduction".to_owned(),
                    enabled: true,
                    visible: true,
                    selected: true,
                }],
                prompt_key: Some("menu.command".to_owned()),
            },
        };
        let encoded = serde_json::to_value(&reduction)?;
        let decoded: UiReduction = serde_json::from_value(encoded)?;
        assert_eq!(decoded, reduction);

        let reasons = [
            UiRejectReason::WrongSeat,
            UiRejectReason::StaleGeneration,
            UiRejectReason::NonActionable,
            UiRejectReason::DisabledOption,
            UiRejectReason::InvalidCursor,
            UiRejectReason::UnsupportedButton,
        ];
        for reason in reasons {
            let encoded = serde_json::to_value(reason)?;
            let decoded: UiRejectReason = serde_json::from_value(encoded)?;
            assert_eq!(decoded, reason);
        }
        Ok(())
    }
}
