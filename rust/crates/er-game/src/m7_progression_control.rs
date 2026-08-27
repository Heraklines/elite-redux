//! Stable raw-key logical menus for M7 lifecycle decisions.

use er_types::battle_ids::MenuInstanceId;
use er_types::ui::CancelPolicy;
use er_types::ui_menu::{LogicalMenu, LogicalMenuOption, MenuNavigationEdge, NavigationDirection};
use er_types::{GameControlKindV2, GameControlPlanV2, MenuOptionId, SafeU53, SeatId};
use thiserror::Error;

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProgressionControlError {
    #[error("progression control requires at least one stable option")]
    Empty,
    #[error("progression control identity is invalid: {0}")]
    Identity(String),
    #[error("progression logical menu is invalid: {0}")]
    Menu(String),
}

pub fn capture_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    ball_keys: &[String],
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options: Vec<String> = ball_keys
        .iter()
        .map(|key| format!("capture/ball/{key}"))
        .collect();
    options.push("capture/decline".to_owned());
    vertical_control(
        instance,
        revision,
        seat,
        GameControlKindV2::Capture,
        "m7/capture",
        &options,
        CancelPolicy::Disabled,
    )
}

pub fn full_party_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    party_size: usize,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options: Vec<String> = (0..party_size)
        .map(|index| format!("full-party/replace/{index}"))
        .collect();
    options.push("full-party/send-storage".to_owned());
    vertical_control(
        instance,
        revision,
        seat,
        GameControlKindV2::FullParty,
        "m7/full-party",
        &options,
        CancelPolicy::Disabled,
    )
}

pub fn move_learn_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    occupied_slots: usize,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options: Vec<String> = (0..occupied_slots)
        .map(|index| format!("move-learn/replace/{index}"))
        .collect();
    options.push("move-learn/refuse".to_owned());
    vertical_control(
        instance,
        revision,
        seat,
        GameControlKindV2::MoveLearn,
        "m7/move-learn",
        &options,
        CancelPolicy::Disabled,
    )
}

pub fn evolution_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    branches: usize,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let mut options: Vec<String> = (0..branches)
        .map(|index| format!("evolution/branch/{index}"))
        .collect();
    options.push("evolution/cancel".to_owned());
    vertical_control(
        instance,
        revision,
        seat,
        GameControlKindV2::Evolution,
        "m7/evolution",
        &options,
        CancelPolicy::Disabled,
    )
}

pub fn fusion_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    partner_count: usize,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    let options: Vec<String> = (0..partner_count)
        .map(|index| format!("fusion/partner/{index}"))
        .collect();
    vertical_control(
        instance,
        revision,
        seat,
        GameControlKindV2::Fusion,
        "m7/fusion",
        &options,
        CancelPolicy::Back,
    )
}

fn vertical_control(
    instance: MenuInstanceId,
    revision: SafeU53,
    seat: SeatId,
    kind: GameControlKindV2,
    control_id: &str,
    keys: &[String],
    cancel: CancelPolicy,
) -> Result<GameControlPlanV2, ProgressionControlError> {
    if keys.is_empty() {
        return Err(ProgressionControlError::Empty);
    }
    let ids: Vec<MenuOptionId> = keys
        .iter()
        .map(|key| {
            MenuOptionId::new(key.clone())
                .map_err(|error| ProgressionControlError::Identity(error.to_string()))
        })
        .collect::<Result<_, _>>()?;
    let options = ids
        .iter()
        .cloned()
        .map(|id| {
            LogicalMenuOption::new(id, true, None)
                .map_err(|error| ProgressionControlError::Menu(error.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;
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
    let menu = LogicalMenu::new(
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
        menu: Some(menu),
        actionable: true,
    };
    plan.validate()
        .map_err(|error| ProgressionControlError::Menu(error.to_string()))?;
    Ok(plan)
}

#[cfg(test)]
mod tests {
    use er_types::battle_ids::MenuInstanceId;
    use er_types::{GameControlKindV2, SafeU53, SeatId};

    use super::capture_control;

    #[test]
    fn capture_menu_has_stable_ball_and_decline_graph() {
        let plan = capture_control(
            MenuInstanceId::new(SafeU53::new(1).expect("menu")),
            SafeU53::new(7).expect("revision"),
            SeatId::new(SafeU53::new(1).expect("seat")),
            &["poke-ball".to_owned(), "great-ball".to_owned()],
        )
        .expect("capture control");
        assert_eq!(plan.kind, GameControlKindV2::Capture);
        let menu = plan.menu.expect("logical menu");
        assert_eq!(menu.options.len(), 3);
        assert_eq!(menu.navigation.len(), 6);
        assert!(menu.control_id.contains("capture"));
    }
}
