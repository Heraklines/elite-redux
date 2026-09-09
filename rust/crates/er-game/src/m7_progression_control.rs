//! Stable raw-key logical menus for M7 lifecycle decisions.

use er_types::battle_ids::{MenuInstanceId, MoveId, MoveSlotIndex, PartyIndex, PokemonId};
use er_types::ui_menu::NavigationDirection;
use er_types::{
    CaptureActionV1, EvolutionActionV1, EvolutionId, FusionActionV1, GameActionContextV1,
    GameActionV1, GameControlKindV2, GameControlPlanV2, GameMenuCancelV2, GameMenuOptionV2,
    GameMenuV2, InventoryItemId, MenuNavigationEdge, MenuOptionId, MoveLearningActionV1,
    OperationId, PartyActionV1, SafeU53, SeatId,
};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProgressionControlError {
    #[error("progression control requires at least one stable option")]
    Empty,
    #[error("progression control identity is invalid: {0}")]
    Identity(String),
    #[error("progression game menu is invalid: {0}")]
    Menu(String),
}

/// One current batch panel; each assignment and its source tracker mutation is
/// separately authoritative. Undo remains in the panel; Cancel with no teaches
/// opens the source confirmation, while Cancel after a teach commits and exits.
pub fn current_learn_move_batch_control(
    context: &GameActionContextV1,
    batch: &er_state::current_experience_settlement::CurrentLearnMoveBatchV1,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    use er_types::m7_action::CurrentLearnMoveBatchActionV1;
    if batch.complete { return Err(ProgressionControlError::Empty); }
    if batch.cancel_confirmation {
        let options = vec![
            ("current/learn-batch/cancel/no".to_owned(), GameActionV1::CurrentLearnMoveBatch {
                action: CurrentLearnMoveBatchActionV1::ConfirmCancel { confirmed: false },
            }),
            ("current/learn-batch/cancel/yes".to_owned(), GameActionV1::CurrentLearnMoveBatch {
                action: CurrentLearnMoveBatchActionV1::ConfirmCancel { confirmed: true },
            }),
        ];
        let mut plan = vertical_control(context.menu_instance, context.authority_revision, context.authority_seat,
            context.operation_id.clone(), GameControlKindV2::MoveLearn,
            "current/learn-batch/cancel", &options, GameMenuCancelV2::Back { action: Box::new(
                GameActionV1::CurrentLearnMoveBatch {
                    action: CurrentLearnMoveBatchActionV1::ConfirmCancel { confirmed: false },
                }) })?;
        let menu = plan.menu.take().ok_or(ProgressionControlError::Empty)?;
        let no = menu.selected_option_id.clone();
        let yes = menu.options.iter().find(|row| row.option_id != no)
            .ok_or(ProgressionControlError::Empty)?.option_id.clone();
        let edges = vec![
            MenuNavigationEdge::new(no.clone(), NavigationDirection::Left, yes.clone()),
            MenuNavigationEdge::new(no.clone(), NavigationDirection::Right, yes.clone()),
            MenuNavigationEdge::new(yes.clone(), NavigationDirection::Left, no.clone()),
            MenuNavigationEdge::new(yes, NavigationDirection::Right, no.clone()),
        ];
        plan.menu = Some(GameMenuV2::new(menu.instance_id, menu.owner_seat, menu.control_id,
            no, menu.options, edges, menu.cancel)
            .map_err(|error| ProgressionControlError::Menu(error.to_string()))?);
        return Ok(plan);
    }
    let mut options = Vec::new();
    if let Some(move_id) = batch.pending_move {
        for index in 0..4 {
            let slot = MoveSlotIndex::new(index)
                .map_err(|error| ProgressionControlError::Identity(error.to_string()))?;
            options.push((format!("current/learn-batch/{}/slot/{index}", move_id.get()),
                GameActionV1::CurrentLearnMoveBatch {
                    action: CurrentLearnMoveBatchActionV1::Assign { move_id, slot },
                }));
        }
        return current_batch_vertical_control(context, "current/learn-batch/slot", &options, 0,
            GameMenuCancelV2::Back { action: Box::new(GameActionV1::CurrentLearnMoveBatch {
                action: CurrentLearnMoveBatchActionV1::CancelSlot,
            }) });
    }
    for move_id in &batch.offered {
        if batch.assignments.iter().any(|row| row.move_id == *move_id) { continue; }
        options.push((format!("current/learn-batch/move/{}", move_id.get()),
            GameActionV1::CurrentLearnMoveBatch {
                action: CurrentLearnMoveBatchActionV1::SelectMove { move_id: *move_id },
            }));
    }
    let done = GameActionV1::CurrentLearnMoveBatch {
        action: CurrentLearnMoveBatchActionV1::Done,
    };
    let undo = GameActionV1::CurrentLearnMoveBatch { action: CurrentLearnMoveBatchActionV1::Undo };
    if !batch.assignments.is_empty() { options.push(("current/learn-batch/undo".to_owned(), undo)); }
    options.push(("current/learn-batch/done".to_owned(), done.clone()));
    current_batch_vertical_control(context, "current/learn-batch", &options, usize::from(batch.list_cursor),
        GameMenuCancelV2::Back { action: Box::new(done) })
}

fn current_batch_vertical_control(
    context: &GameActionContextV1, control_id: &str, entries: &[(String, GameActionV1)],
    selected: usize,
    cancel: GameMenuCancelV2,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut plan = vertical_control(context.menu_instance, context.authority_revision, context.authority_seat,
        context.operation_id.clone(), GameControlKindV2::MoveLearn, control_id, entries, cancel)?;
    let first = entries.first().ok_or(ProgressionControlError::Empty)?.0.as_str();
    let last = entries.last().ok_or(ProgressionControlError::Empty)?.0.as_str();
    let menu = plan.menu.as_mut().ok_or(ProgressionControlError::Empty)?;
    let selected_id = &entries.get(selected).ok_or(ProgressionControlError::Empty)?.0;
    menu.selected_option_id = menu.options.iter().find(|row| row.option_id.as_str() == selected_id)
        .ok_or(ProgressionControlError::Empty)?.option_id.clone();
    // Actual batch UP/DOWN stops at the first/last row; no wrap is installed.
    menu.navigation.retain(|edge| !((edge.from.as_str() == first && edge.direction == NavigationDirection::Up)
        || (edge.from.as_str() == last && edge.direction == NavigationDirection::Down)));
    plan.validate().map_err(|error| ProgressionControlError::Menu(error.to_string()))?;
    Ok(plan)
}

pub fn capture_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    operation_id: OperationId,
    target: PokemonId,
    balls: &[(InventoryItemId, String)],
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options: Vec<_> = balls
        .iter()
        .map(|(ball, key)| {
            (
                format!("capture/ball/{key}"),
                GameActionV1::Capture {
                    action: CaptureActionV1::Attempt {
                        target,
                        ball: *ball,
                    },
                },
            )
        })
        .collect();
    options.push((
        "capture/decline".to_owned(),
        GameActionV1::Capture {
            action: CaptureActionV1::Decline,
        },
    ));
    vertical_control(
        instance,
        revision,
        seat,
        operation_id,
        GameControlKindV2::Capture,
        "m7/capture",
        &options,
        GameMenuCancelV2::Disabled,
    )
}

pub fn full_party_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    operation_id: OperationId,
    pokemon: PokemonId,
    party_size: usize,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options = (0..party_size)
        .map(|index| {
            let numeric = u8::try_from(index)
                .map_err(|error| ProgressionControlError::Identity(error.to_string()))?;
            let slot = PartyIndex::new(numeric)
                .map_err(|error| ProgressionControlError::Identity(error.to_string()))?;
            Ok((
                format!("full-party/replace/{index}"),
                GameActionV1::Party {
                    action: PartyActionV1::ChooseFullPartyDestination {
                        pokemon,
                        replace: Some(slot),
                    },
                },
            ))
        })
        .collect::<Result<Vec<_>, ProgressionControlError>>()?;
    options.push((
        "full-party/send-storage".to_owned(),
        GameActionV1::Party {
            action: PartyActionV1::ChooseFullPartyDestination {
                pokemon,
                replace: None,
            },
        },
    ));
    vertical_control(
        instance,
        revision,
        seat,
        operation_id,
        GameControlKindV2::FullParty,
        "m7/full-party",
        &options,
        GameMenuCancelV2::Disabled,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn move_learn_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    operation_id: OperationId,
    pokemon: PokemonId,
    move_id: MoveId,
    occupied_slots: usize,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options = (0..occupied_slots)
        .map(|index| {
            let numeric = u8::try_from(index)
                .map_err(|error| ProgressionControlError::Identity(error.to_string()))?;
            let slot = MoveSlotIndex::new(numeric)
                .map_err(|error| ProgressionControlError::Identity(error.to_string()))?;
            Ok((
                format!("move-learn/replace/{index}"),
                GameActionV1::MoveLearning {
                    action: MoveLearningActionV1::Replace {
                        pokemon,
                        move_id,
                        slot,
                    },
                },
            ))
        })
        .collect::<Result<Vec<_>, ProgressionControlError>>()?;
    options.push((
        "move-learn/refuse".to_owned(),
        GameActionV1::MoveLearning {
            action: MoveLearningActionV1::Refuse { pokemon, move_id },
        },
    ));
    vertical_control(
        instance,
        revision,
        seat,
        operation_id,
        GameControlKindV2::MoveLearn,
        "m7/move-learn",
        &options,
        GameMenuCancelV2::Disabled,
    )
}

pub fn evolution_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    operation_id: OperationId,
    pokemon: PokemonId,
    evolutions: &[EvolutionId],
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options: Vec<_> = evolutions
        .iter()
        .enumerate()
        .map(|(index, evolution)| {
            (
                format!("evolution/branch/{index}"),
                GameActionV1::Evolution {
                    action: EvolutionActionV1::Complete {
                        pokemon,
                        evolution: *evolution,
                    },
                },
            )
        })
        .collect();
    if let Some(evolution) = evolutions.first() {
        options.push((
            "evolution/cancel".to_owned(),
            GameActionV1::Evolution {
                action: EvolutionActionV1::Cancel {
                    pokemon,
                    evolution: *evolution,
                },
            },
        ));
    }
    vertical_control(
        instance,
        revision,
        seat,
        operation_id,
        GameControlKindV2::Evolution,
        "m7/evolution",
        &options,
        GameMenuCancelV2::Disabled,
    )
}

pub fn fusion_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    operation_id: OperationId,
    primary: PokemonId,
    partners: &[PokemonId],
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let options: Vec<_> = partners
        .iter()
        .enumerate()
        .map(|(index, partner)| {
            (
                format!("fusion/partner/{index}"),
                GameActionV1::Fusion {
                    action: FusionActionV1::Fuse {
                        primary,
                        partner: *partner,
                    },
                },
            )
        })
        .collect();
    vertical_control(
        instance,
        revision,
        seat,
        operation_id,
        GameControlKindV2::Fusion,
        "m7/fusion",
        &options,
        GameMenuCancelV2::Back {
            action: Box::new(GameActionV1::Fusion {
                action: FusionActionV1::Cancel,
            }),
        },
    )
}

#[allow(clippy::too_many_arguments)]
pub fn generic_vertical_control_v2(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    operation_id: OperationId,
    kind: GameControlKindV2,
    control_id: &str,
    entries: &[(String, GameActionV1)],
    cancel: GameMenuCancelV2,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    vertical_control(
        instance,
        revision,
        seat,
        operation_id,
        kind,
        control_id,
        entries,
        cancel,
    )
}

#[allow(clippy::too_many_arguments)]
fn vertical_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    operation_id: OperationId,
    kind: GameControlKindV2,
    control_id: &str,
    entries: &[(String, GameActionV1)],
    cancel: GameMenuCancelV2,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    if entries.is_empty() {
        return Err(ProgressionControlError::Empty);
    }
    let options = entries
        .iter()
        .map(|(key, action)| {
            let id = MenuOptionId::new(key.clone())
                .map_err(|error| ProgressionControlError::Identity(error.to_string()))?;
            GameMenuOptionV2::new(id, true, true, action.clone(), None)
                .map_err(|error| ProgressionControlError::Menu(error.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let ids: Vec<_> = options
        .iter()
        .map(|option| option.option_id.clone())
        .collect();
    let mut edges = Vec::with_capacity(ids.len() * 2);
    for (index, id) in ids.iter().enumerate() {
        let previous = if index == 0 { ids.len() - 1 } else { index - 1 };
        let next = if index + 1 == ids.len() { 0 } else { index + 1 };
        edges.push(MenuNavigationEdge::new(
            id.clone(),
            NavigationDirection::Up,
            ids[previous].clone(),
        ));
        edges.push(MenuNavigationEdge::new(
            id.clone(),
            NavigationDirection::Down,
            ids[next].clone(),
        ));
    }
    let menu = GameMenuV2::new(
        instance,
        seat,
        control_id,
        ids[0].clone(),
        options,
        edges,
        cancel,
    )
    .map_err(|error| ProgressionControlError::Menu(error.to_string()))?;
    let plan = GameControlPlanV2 {
        schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
        revision,
        kind,
        owner_seat: Some(seat),
        action_context: Some(GameActionContextV1 {
            operation_id,
            authority_seat: seat,
            authority_revision: revision,
            menu_instance: instance,
        }),
        menu: Some(menu),
        actionable: true,
    };
    plan.validate()
        .map_err(|error| ProgressionControlError::Menu(error.to_string()))?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use er_types::battle_ids::{MenuInstanceId, PokemonId};
    use er_types::{
        CaptureActionV1, GameActionV1, GameControlKindV2, InventoryItemId, OperationId, SafeU53,
        SeatId,
    };

    use super::capture_control;

    #[test]
    fn capture_menu_has_stable_ball_and_decline_graph() {
        let plan = capture_control(
            MenuInstanceId::new(SafeU53::new(1).expect("menu")),
            SafeU53::new(7).expect("revision"),
            SeatId::new(SafeU53::new(1).expect("seat")),
            OperationId::new("m7/test/capture").expect("operation"),
            PokemonId::new(SafeU53::new(9).expect("pokemon")),
            &[
                (
                    InventoryItemId::new(SafeU53::new(1).expect("ball")),
                    "poke-ball".to_owned(),
                ),
                (
                    InventoryItemId::new(SafeU53::new(2).expect("ball")),
                    "great-ball".to_owned(),
                ),
            ],
        )
        .expect("capture control");
        assert_eq!(plan.kind, GameControlKindV2::Capture);
        let menu = plan.menu.expect("logical menu");
        assert_eq!(menu.options.len(), 3);
        assert_eq!(menu.navigation.len(), 6);
        assert!(menu.control_id.contains("capture"));
        assert!(matches!(
            menu.options[0].action,
            GameActionV1::Capture {
                action: CaptureActionV1::Attempt { .. }
            }
        ));
    }
}
