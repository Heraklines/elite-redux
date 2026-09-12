//! Source Growl child mutation, separate from physical callback admission.
use crate::current_source_progression::current_source_progression;
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;
use er_state::current_turn_execution::{CurrentStatStageChildPhaseV1 as Phase, CurrentStatStageChildV1};
use er_state::m9e_state_v6::GameStateV6;
use er_types::PresentationEventId;

fn failure() -> GameRuntimeV6Error { GameRuntimeV6Error::Action }

pub(crate) fn validate<'a>(
    state: &'a GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<&'a CurrentStatStageChildV1, GameRuntimeV6Error> {
    current_source_progression(state, content)?;
    let run=state.active_run.as_ref().ok_or_else(failure)?;
    let turn=state.current_turn_execution.as_ref().ok_or_else(failure)?;
    turn.validate(run).map_err(|_| failure())?;
    let child=turn.stat_child.as_deref().ok_or_else(failure)?;
    let battle=run.battle.as_ref().ok_or_else(failure)?;
    let progress = crate::current_source_turn_progress::progress(state)?;
    let row = progress.pokemon.iter().find(|row| row.pokemon == child.target).ok_or_else(failure)?;
    // This admitted single battle has one command per holder, and TurnInit
    // resets the flag. Only this target's actual child can set it this turn.
    if row.stat_stages_decreased != (matches!(child.phase, Phase::Message { .. }) && child.before > -6) {
        return Err(failure());
    }
    let targeting=er_battle::current_target_execution::CurrentTargetExecution::from_state(state).map_err(|_| failure())?;
    let target=run.party.iter().chain(&battle.enemy_party).find(|p|p.id==child.target).ok_or_else(failure)?;
    // GREEN34703043538: exact initialized24 stat families. Competitive's
    // PostStatStageChange child is nonneutral and requires its own owner.
    if targeting.ability_sources(run,target).map_err(|_| failure())?.iter().any(|source|
        matches!(source,er_types::BehaviorSourceId::ActiveAbility{numeric_id}|er_types::BehaviorSourceId::PassiveAbility{numeric_id} if numeric_id.get()==172))
    { return Err(failure()); }
    for pokemon in run.party.iter().chain(&battle.enemy_party) {
        if pokemon.status.kind!=er_types::battle_model::StatusKind::None
            || pokemon.mechanics!=er_state::mechanic_state_v2::MechanicStateStoreV2::default()
            || pokemon.tera_type.is_some()
        { return Err(failure()); }
    }
    Ok(child)
}

/// Returns whether the transaction must allocate animation, message, or none.
/// Its intermediate candidate is not publishable until that exact event ID
/// is assigned to the retained phase in the enclosing owned transaction.
pub(crate) fn advance(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    callback: Option<(PresentationEventId,bool)>,
) -> Result<(GameStateV6,Option<bool>),GameRuntimeV6Error> {
    let child=validate(before,content)?.clone();
    let (commit_stage,next)=match (&child.phase,callback) {
        (Phase::Ready,None) if child.before>-6 => (false,Some(true)),
        (Phase::Ready,None) => (true,Some(false)),
        (Phase::Animation{event_id},Some((received,true))) if *event_id==received => (true,Some(false)),
        (Phase::Message{event_id},Some((received,false))) if *event_id==received => (false,None),
        _ => return Err(failure()),
    };
    let mut candidate=before.clone();
    if commit_stage {
        let run=candidate.active_run.as_mut().ok_or_else(failure)?;
        let battle=run.battle.as_mut().ok_or_else(failure)?;
        let target=run.party.iter_mut().chain(&mut battle.enemy_party).find(|p|p.id==child.target).ok_or_else(failure)?;
        if target.stat_stages.attack!=child.before { return Err(failure()); }
        target.stat_stages.attack=child.after();
        // Actual erRecordAchievementStatStage runs after setStatStage. It only
        // records player positive-six events (and DEF-six Snorlax); this owned
        // ATK decrease ends at most5, so it makes no achievement mutation.
        let progress=candidate.current_battle_participation.as_mut()
            .and_then(|p|p.experience.as_mut()).and_then(|p|p.source_progression.as_mut())
            .and_then(|p|p.turn_progress.as_mut()).ok_or_else(failure)?;
        let row=progress.pokemon.iter_mut().find(|row|row.pokemon==child.target).ok_or_else(failure)?;
        row.stat_stages_decreased |= child.before>-6;
    }
    if next.is_none() {
        er_battle::m7_resolver::complete_current_stat_tail(before,&content.battle).map_err(|_| failure())?;
        candidate.current_turn_execution.as_mut().ok_or_else(failure)?.stat_child=None;
    }
    Ok((candidate,next))
}
pub(crate) fn validate_all(state: &GameStateV6, content: &PreparedGameContentV2) -> Result<(), GameRuntimeV6Error> {
    if state.current_turn_execution.as_ref().is_none_or(|turn| turn.stat_child.is_none()) {
        return Ok(());
    }
    let child = validate(state, content)?;
    let (event_id, animation) = match child.phase {
        Phase::Ready => return Ok(()),
        Phase::Animation { event_id } => (event_id, true),
        Phase::Message { event_id } => (event_id, false),
    };
    let semantic = crate::m9e_content_v2::PresentationSemanticIdV1::Cue(
        crate::m9e_content_v2::PresentationCueFamilyV1::Move);
    let mapping = content.presentation(semantic).ok_or_else(failure)?;
    let payload = if animation {
        crate::m9e_material_v6::GamePresentationPayloadV1::StatStageAnimation {
            holder: child.target, stat: child.stat, before: child.before, after: child.after(), tween_milliseconds: 1750,
        }
    } else {
        crate::m9e_material_v6::GamePresentationPayloadV1::StatStageMessage {
            holder: child.target, stat: child.stat, before: child.before, after: child.after(),
        }
    };
    let effect = crate::m9e_material_v6::GamePresentationEffectV2 {
        event_id, semantic, blocking: mapping.blocking, skip: mapping.skip, payload: Some(payload),
    };
    let hash = er_canonical::fixture_digest(&effect).map_err(|_| failure())?;
    if mapping.blocking != er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
        || state.current_presentation.as_ref().is_none_or(|owner|
            !owner.receipts.iter().any(|receipt| receipt.event_id == event_id && receipt.effect_sha256 == hash))
    { return Err(failure()); }
    Ok(())
}