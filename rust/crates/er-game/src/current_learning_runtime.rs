//! Owned raw learning actions and independent material recomputation.
use super::*;
use er_state::current_victory_execution::CurrentVictoryDescendantV1 as D;

pub(super) fn execute(
    before: &GameStateV6, content: &PreparedGameContentV2,
    action: &er_types::m7_action::CurrentLearnMoveBatchActionV1,
    context: &GameActionDispatchContextV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    require_none_input(&context.input)?;
    let failure = || GameRuntimeV6Error::Action;
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let owner = before.current_battle_participation.as_ref().and_then(|owner| owner.experience.as_ref()).ok_or_else(failure)?;
    let (pending_id, batch) = owner.pending.iter().find_map(|pending| {
        if let D::LearnMoveBatch { batch } = &pending.victory.as_ref()?.descendant { Some((pending.id, batch)) } else { None }
    }).ok_or_else(failure)?;
    let canonical = crate::m7_progression_control::current_learn_move_batch_control(&context.action, batch)
        .map_err(|_| failure())?;
    let accepted = GameActionV1::CurrentLearnMoveBatch { action: action.clone() };
    let menu = canonical.menu.as_ref().ok_or_else(failure)?;
    let back = matches!(&menu.cancel, er_types::GameMenuCancelV2::Back { action }
        | er_types::GameMenuCancelV2::Close { action } if action.as_ref() == &accepted);
    if run.control != canonical || !context.authority
        || !menu.options.iter().any(|row| row.enabled && row.visible && row.action == accepted) && !back
    { return Err(failure()); }
    let (mut candidate, next, learned) = crate::current_experience_settlement::apply_current_learn_move_batch(before, content, batch, action)?;
    if let Some(move_id) = learned {
        // Source hook occurs after the moveset assignment. Undo restores only
        // movesets and deliberately leaves this actual learning stamp intact.
        candidate.current_achievement_tracker.as_mut().ok_or_else(failure)?
            .persistent.learned_move_stamps.insert(move_id, run.wave);
    }
    let mut next_context = context.action.clone();
    next_context.authority_revision = safe_increment(context.action.authority_revision)?;
    next_context.operation_id = OperationId::new(format!("current/learn/{}/{}/{}",
        run.run_id.get().get(), pending_id.get(), next_context.authority_revision.get()))
        .map_err(|_| failure())?;
    let next_control = if next.complete {
        GameControlPlanV2 { schema_version: er_types::GAME_CONTROL_PLAN_SCHEMA_VERSION_V2,
            revision: next_context.authority_revision, kind: GameControlKindV2::Waiting,
            owner_seat: None, action_context: None, menu: None, actionable: false }
    } else {
        crate::m7_progression_control::current_learn_move_batch_control(&next_context, &next).map_err(|_| failure())?
    };
    candidate.current_battle_participation.as_mut().and_then(|owner| owner.experience.as_mut())
        .and_then(|owner| owner.pending.iter_mut().find(|pending| pending.id == pending_id))
        .and_then(|pending| pending.victory.as_mut()).ok_or_else(failure)?.descendant = D::LearnMoveBatch { batch: next };
    candidate.active_run.as_mut().ok_or_else(failure)?.control = next_control;
    Ok(DomainExecutionV1 { candidate: Some(candidate), ..Default::default() })
}

pub(crate) fn validate_transition(before: &GameStateV6, content: &PreparedGameContentV2,
    transition: &GameTransitionMaterialV6) -> Result<(), GameRuntimeV6Error>
{
    let failure = || GameRuntimeV6Error::Action;
    let Some(GameActionV1::CurrentLearnMoveBatch { action }) = &transition.accepted_action else { return Err(failure()); };
    let context = before.active_run.as_ref().and_then(|run| run.control.action_context.clone()).ok_or_else(failure)?;
    if context.operation_id != transition.operation_id || context.authority_seat != transition.authority_seat
        || context.authority_revision != transition.authority_revision || transition.owned_phase.is_some()
        || transition.domain != GameActionDomainV2::MoveLearning
    { return Err(failure()); }
    let input = GameActionDispatchContextV1 { action: context, authority: true, input: GameDomainExecutionInputV1::None };
    let execution = execute(before, content, action, &input)?;
    let mut candidate = execution.candidate.ok_or_else(failure)?;
    let semantic = PresentationSemanticIdV1::Cue(domain_cue(GameActionDomainV2::MoveLearning));
    let mapping = content.presentation(semantic).ok_or_else(failure)?;
    let mut presentation = vec![GamePresentationEffectV2 { event_id: PresentationEventId::new(transition.authority_revision),
        semantic, blocking: mapping.blocking, skip: mapping.skip, payload: None }];
    current_phase_runtime::assign_presentations(&mut candidate, &mut presentation)?;
    let next_control = normalize_next_control(&mut candidate, safe_increment(transition.authority_revision)?)?;
    let before_digest = game_state_digest(before).map_err(material_error)?;
    let after_digest = game_state_digest(&candidate).map_err(material_error)?;
    let expected = GameTransitionMaterialV6 { schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain: GameActionDomainV2::MoveLearning, operation_id: transition.operation_id.clone(),
        authority_seat: transition.authority_seat, authority_revision: transition.authority_revision,
        content_identity: content.identity().clone(), accepted_action: transition.accepted_action.clone(), owned_phase: None,
        mutations: vec![GameMutationEvidenceV2 { ordinal: 0, domain: GameActionDomainV2::MoveLearning,
            kind: GameMutationKindV2::StateChanged, before_digest: before_digest.clone(), after_digest: after_digest.clone() }],
        before_digest, after_digest, after_state: candidate, next_control, presentation,
        rng_audit: Vec::new(), platform_effects: Vec::new() };
    if &expected != transition { return Err(GameRuntimeV6Error::CandidateMismatch); }
    Ok(())
}
