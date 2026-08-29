//! Dedicated G27 causal-spine contracts without semantic input shortcuts.

use std::error::Error;

use er_game::m7_internal_event::{
    GameInternalEventKindV1, GameInternalEventQueueV1, GameInternalEventV1,
};
use er_game::m7_runtime::GameControlIntentV2;
use er_types::battle_ids::MenuInstanceId;
use er_types::{
    GAME_ACTION_SCHEMA_VERSION_V1, GameActionContextV1, GameActionV1, GameControlKindV2,
    GameMenuCancelV2, GameMenuOptionV2, GameMenuV2, GameProposalV1, MenuOptionId, OperationId,
    RunExecutionContextV2, RunHook, RunProgramId, SafeU53, SeatId,
};

fn safe(value: u64) -> Result<SafeU53, Box<dyn Error>> {
    Ok(SafeU53::new(value)?)
}

fn action() -> Result<GameActionV1, Box<dyn Error>> {
    Ok(GameActionV1::ExecuteRunProgram {
        program: RunProgramId::new(safe(1)?),
        hook: RunHook::RewardSelected,
        context: RunExecutionContextV2::default(),
    })
}

fn context() -> Result<GameActionContextV1, Box<dyn Error>> {
    Ok(GameActionContextV1 {
        operation_id: OperationId::new("m7/causal-spine/reward")?,
        authority_seat: SeatId::new(safe(1)?),
        authority_revision: safe(2)?,
        menu_instance: MenuInstanceId::new(safe(3)?),
    })
}

#[test]
fn menu_projection_hides_typed_action() -> Result<(), Box<dyn Error>> {
    let option_id = MenuOptionId::new("opaque-renderer-option")?;
    let menu = GameMenuV2::new(
        MenuInstanceId::new(safe(3)?),
        SeatId::new(safe(1)?),
        "m7/causal-spine",
        option_id.clone(),
        vec![GameMenuOptionV2::new(
            option_id,
            true,
            true,
            action()?,
            None,
        )?],
        Vec::new(),
        GameMenuCancelV2::Disabled,
    )?;
    assert_eq!(menu.selected_action(), Some(&action()?));
    let renderer = serde_json::to_value(menu.logical_menu()?)?;
    assert!(renderer.to_string().contains("opaque-renderer-option"));
    assert!(!renderer.to_string().contains("EXECUTE_RUN_PROGRAM"));
    Ok(())
}

#[test]
fn proposal_and_fifo_preserve_typed_causal_identity() -> Result<(), Box<dyn Error>> {
    let action = action()?;
    let context = context()?;
    let proposal = GameProposalV1 {
        schema_version: GAME_ACTION_SCHEMA_VERSION_V1,
        context: context.clone(),
        action: action.clone(),
    };
    proposal.validate()?;
    let bytes = er_canonical::canonical_bytes(&proposal)?;
    let decoded: GameProposalV1 = serde_json::from_slice(&bytes)?;
    assert_eq!(decoded, proposal);

    let intent = GameControlIntentV2::Selected {
        kind: GameControlKindV2::Reward,
        option: MenuOptionId::new("opaque-renderer-option")?,
        action,
        context,
    };
    let mut queue = GameInternalEventQueueV1::new(GameInternalEventV1::ControlSelected(intent));
    assert_eq!(
        queue.pop_front()?.map(|event| event.kind()),
        Some(GameInternalEventKindV1::ControlSelected)
    );
    queue.validate_quiescent()?;
    Ok(())
}
