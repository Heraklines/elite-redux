//! Source-owned settlement of the skipped first reward into Town wave two.
use super::*;

#[inline(never)]
pub(super) fn transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6, GameRuntimeV6Error> {
    let GameOwnedPhaseV1::RewardNextEncounter {
        pending,
        menu_instance,
    } = phase
    else {
        return Err(GameRuntimeV6Error::Action);
    };
    let run = before.active_run.as_ref().ok_or(GameRuntimeV6Error::Action)?;
    let battle = run.battle.as_ref().ok_or(GameRuntimeV6Error::Action)?;
    let owner = before
        .current_battle_participation
        .as_ref()
        .and_then(|row| row.experience.as_ref())
        .ok_or(GameRuntimeV6Error::Action)?;
    if operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || menu_instance == MenuInstanceId::ZERO
        || run.control.revision != revision
        || run.control.kind != GameControlKindV2::Waiting
        || run.control.actionable
        || battle.authority_seat != authority_seat
        || owner.authority != authority_seat
        || !owner.pending.iter().any(|row| row.id == pending)
        || before.current_turn_execution.is_some()
        || before.current_presentation.is_none()
    {
        return Err(GameRuntimeV6Error::Action);
    }
    let (mut candidate, rng_audit) =
        crate::m9e_new_run_v6::advance_current_town_day_wave_two_after_skipped_reward(
            before, content,
        )
        .map_err(|error| GameRuntimeV6Error::Domain(error.to_string()))?;
    let next_owner = next_battle_control_owner(&candidate)?;
    install_battle_command_control(
        &mut candidate,
        next_owner,
        authority_seat,
        safe_increment(revision)?,
        menu_instance,
    )?;
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let next_control = candidate
        .active_run
        .as_ref()
        .ok_or(GameRuntimeV6Error::Action)?
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
        owned_phase: Some(GameOwnedPhaseV1::RewardNextEncounter {
            pending,
            menu_instance,
        }),
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
