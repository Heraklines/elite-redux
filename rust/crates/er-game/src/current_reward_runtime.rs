//! Raw reward actions bound to their exact retained source menu.
use super::*;

pub(super) fn execute(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    action: &RewardActionV1,
    context: &GameActionContextV1,
) -> Result<DomainExecutionV1, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let pending = before.current_battle_participation.as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| owner.pending.first())
        .filter(|pending| pending.victory_tail.as_ref().and_then(|tail| tail.reward.as_ref()).is_some())
        .ok_or_else(failure)?;
    // Reconstruct the current menu from the owned stage. Matching only the
    // ordinal or caller-supplied action context would admit hidden choices.
    let mut projected = before.clone();
    crate::current_reward_selection::install_control(&mut projected, pending.id,
        context.menu_instance, context.authority_revision, context.authority_seat)?;
    let selected = run.control.menu.as_ref().ok_or_else(failure)?.selected_option_id.clone();
    let projected_menu = projected.active_run.as_mut().ok_or_else(failure)?
        .control.menu.as_mut().ok_or_else(failure)?;
    if !projected_menu.options.iter().any(|row|
        row.option_id == selected && row.enabled && row.visible) {
        return Err(failure());
    }
    projected_menu.selected_option_id = selected;
    let canonical = &projected.active_run.as_ref().ok_or_else(failure)?.control;
    let accepted = GameActionV1::Reward { action: action.clone() };
    let menu = canonical.menu.as_ref().ok_or_else(failure)?;
    let back = matches!(&menu.cancel, GameMenuCancelV2::Back { action }
        | GameMenuCancelV2::Close { action } if action.as_ref() == &accepted);
    if !run.control.actionable || &run.control != canonical
        || canonical.action_context.as_ref() != Some(context)
        || (!menu.options.iter().any(|row| row.enabled && row.visible && row.action == accepted) && !back) {
        return Err(failure());
    }
    let mut candidate = match action {
        RewardActionV1::Select { option_ordinal } =>
            crate::current_reward_selection::select(before, content, pending.id, *option_ordinal)?,
        RewardActionV1::Decline =>
            crate::current_reward_selection::cancel_holder(before, content, pending.id)?,
        RewardActionV1::Reroll | RewardActionV1::ToggleLock { .. } => return Err(failure()),
    };
    let applied = candidate.current_battle_participation.as_ref()
        .and_then(|owner| owner.experience.as_ref()).and_then(|owner| owner.pending.first())
        .and_then(|pending| pending.victory_tail.as_ref()).and_then(|tail| tail.reward.as_ref())
        .is_some_and(|reward| matches!(reward.stage,
            er_state::current_reward_selection::CurrentRewardStageV1::Applied { .. }));
    if applied {
        current_phase_runtime::install_waiting(&mut candidate, context.authority_revision)?;
    } else {
        crate::current_reward_selection::install_control(&mut candidate, pending.id,
            context.menu_instance, safe_increment(context.authority_revision)?, context.authority_seat)?;
    }
    Ok(DomainExecutionV1 { candidate: Some(candidate), ..Default::default() })
}

pub(crate) fn validate_transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    transition: &GameTransitionMaterialV6,
) -> Result<(), GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    let Some(GameActionV1::Reward { action }) = &transition.accepted_action else {
        return Err(failure());
    };
    let context = before.active_run.as_ref()
        .and_then(|run| run.control.action_context.as_ref()).ok_or_else(failure)?;
    if context.operation_id != transition.operation_id
        || context.authority_seat != transition.authority_seat
        || context.authority_revision != transition.authority_revision
        || transition.owned_phase.is_some() || transition.domain != GameActionDomainV2::Reward {
        return Err(failure());
    }
    let execution = execute(before, content, action, context)?;
    let mut candidate = execution.candidate.ok_or_else(failure)?;
    let semantic = PresentationSemanticIdV1::Cue(domain_cue(GameActionDomainV2::Reward));
    let mapping = content.presentation(semantic).ok_or_else(failure)?;
    let mut presentation = vec![GamePresentationEffectV2 {
        event_id: PresentationEventId::new(transition.authority_revision), semantic,
        blocking: mapping.blocking, skip: mapping.skip, payload: None,
    }];
    current_phase_runtime::assign_presentations(&mut candidate, &mut presentation)?;
    let next_control = normalize_next_control(&mut candidate, safe_increment(transition.authority_revision)?)?;
    let before_digest = game_state_digest(before).map_err(material_error)?;
    let after_digest = game_state_digest(&candidate).map_err(material_error)?;
    let expected = GameTransitionMaterialV6 {
        schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain: GameActionDomainV2::Reward,
        operation_id: transition.operation_id.clone(), authority_seat: transition.authority_seat,
        authority_revision: transition.authority_revision, content_identity: content.identity().clone(),
        accepted_action: transition.accepted_action.clone(), owned_phase: None,
        mutations: vec![GameMutationEvidenceV2 { ordinal: 0, domain: GameActionDomainV2::Reward,
            kind: GameMutationKindV2::StateChanged,
            before_digest: before_digest.clone(), after_digest: after_digest.clone() }],
        before_digest, after_digest, after_state: candidate, next_control, presentation,
        rng_audit: Vec::new(), platform_effects: Vec::new(),
    };
    if &expected != transition { return Err(GameRuntimeV6Error::CandidateMismatch); }
    Ok(())
}
