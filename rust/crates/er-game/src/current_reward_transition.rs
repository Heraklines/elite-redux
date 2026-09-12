//! Transaction for source reward generation after the completed EggLapse.
use super::*;

pub(super) fn transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    let GameOwnedPhaseV1::RewardBegin {
        pending,
        menu_instance,
    } = &phase
    else {
        return Err(failure());
    };
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    if operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || *menu_instance == MenuInstanceId::ZERO
        || run.control.revision != revision
        || run.control.kind != GameControlKindV2::Waiting
        || run.control.actionable
        || battle.authority_seat != authority_seat
        || before.current_turn_execution.is_some()
        || before.current_presentation.is_none()
    {
        return Err(failure());
    }
    let mut candidate = crate::current_reward_selection::begin(before, content, *pending)?;
    let rng_audit = crate::current_reward_selection::audit(&candidate, *pending)?;
    crate::current_reward_selection::install_control(
        &mut candidate,
        *pending,
        *menu_instance,
        safe_increment(revision)?,
        authority_seat,
    )?;
    candidate.validate_with(content).map_err(|_| failure())?;
    let next_control = candidate
        .active_run
        .as_ref()
        .ok_or_else(failure)?
        .control
        .clone();
    let before_digest = game_state_digest(before).map_err(material_error)?;
    let after_digest = game_state_digest(&candidate).map_err(material_error)?;
    Ok(GameTransitionMaterialV6 {
        schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain: GameActionDomainV2::Progression,
        operation_id,
        authority_seat,
        authority_revision: revision,
        content_identity: content.identity().clone(),
        accepted_action: None,
        owned_phase: Some(phase),
        mutations: vec![GameMutationEvidenceV2 {
            ordinal: 0,
            domain: GameActionDomainV2::Progression,
            kind: GameMutationKindV2::StateChanged,
            before_digest: before_digest.clone(),
            after_digest: after_digest.clone(),
        }],
        before_digest,
        after_digest,
        after_state: candidate,
        next_control,
        presentation: Vec::new(),
        rng_audit,
        platform_effects: Vec::new(),
    })
}
