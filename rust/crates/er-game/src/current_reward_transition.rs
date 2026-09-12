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
    let pending = match &phase {
        GameOwnedPhaseV1::RewardBegin { pending, .. }
        | GameOwnedPhaseV1::RewardTmLearn { pending }
        | GameOwnedPhaseV1::RewardTmPresentation { pending, .. } => *pending,
        _ => return Err(failure()),
    };
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    if operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || run.control.revision != revision
        || run.control.kind != GameControlKindV2::Waiting
        || run.control.actionable
        || battle.authority_seat != authority_seat
        || before.current_turn_execution.is_some()
        || before.current_presentation.is_none()
    {
        return Err(failure());
    }
    let mut presentation = Vec::new();
    let (candidate, rng_audit) = match &phase {
        GameOwnedPhaseV1::RewardBegin { menu_instance, .. } => {
            if *menu_instance == MenuInstanceId::ZERO {
                return Err(failure());
            }
            let mut candidate = crate::current_reward_selection::begin(before, content, pending)?;
            let audit = crate::current_reward_selection::audit(&candidate, pending)?;
            crate::current_reward_selection::install_control(
                &mut candidate,
                pending,
                *menu_instance,
                safe_increment(revision)?,
                authority_seat,
            )?;
            (candidate, audit)
        }
        GameOwnedPhaseV1::RewardTmLearn { .. } | GameOwnedPhaseV1::RewardTmPresentation { .. } => {
            use er_state::current_reward_selection::CurrentRewardStageV1 as S;
            use er_state::current_reward_tm::CurrentRewardTmPhaseV1 as T;
            crate::current_reward_selection::validate(before, content, pending)?;
            let mut selection = before
                .current_battle_participation
                .as_ref()
                .and_then(|o| o.experience.as_ref())
                .and_then(|o| o.pending.iter().find(|p| p.id == pending))
                .and_then(|p| p.victory_tail.as_ref())
                .and_then(|t| t.reward.as_deref())
                .ok_or_else(failure)?
                .clone();
            let S::TmPending { offer, holder } = selection.stage else {
                return Err(failure());
            };
            let mut candidate = before.clone();
            use er_state::current_reward_tm::{
                CurrentRewardTmMessageKindV1 as M, CurrentRewardTmMessageV1,
            };
            let tm = selection.tm.as_ref().ok_or_else(failure)?;
            let message = match &phase {
                GameOwnedPhaseV1::RewardTmLearn { .. } => Some(match tm.phase {
                    T::Queued if tm.slot == 4 => M::Intro,
                    T::Queued => M::Learned,
                    T::ForgetQueued => M::ForgetQuestion,
                    T::LearningQueued => M::Forgotten,
                    T::DeclineQueued => M::NotLearned,
                    _ => return Err(failure()),
                }),
                GameOwnedPhaseV1::RewardTmPresentation { event_id, .. } => {
                    if tm.phase.event() != Some(*event_id) {
                        return Err(failure());
                    }
                    match tm.phase {
                        T::Forgotten { .. } => Some(M::Learned),
                        _ => None,
                    }
                }
                _ => return Err(failure()),
            };
            if let Some(kind) = message {
                let payload = crate::current_reward_tm::payload(&selection, tm, kind)?;
                let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Progression);
                let mapping = content.presentation(semantic).ok_or_else(failure)?;
                if mapping.blocking
                    != er_types::battle_ui::PresentationBlockingPolicy::BlocksHumanInput
                {
                    return Err(failure());
                }
                presentation.push(GamePresentationEffectV2 {
                    event_id: PresentationEventId::new(revision),
                    semantic,
                    blocking: mapping.blocking,
                    skip: mapping.skip,
                    payload: Some(payload),
                });
                assign_presentations(&mut candidate, &mut presentation)?;
                let event_id = presentation[0].event_id;
                let tm = selection.tm.as_mut().ok_or_else(failure)?;
                if tm.messages.len() >= 4096 {
                    return Err(failure());
                }
                tm.messages
                    .push(CurrentRewardTmMessageV1 { kind, event_id });
                tm.phase = match kind {
                    M::Intro => T::Intro { event_id },
                    M::ForgetQuestion => T::ForgetPrompt { event_id },
                    M::Forgotten => T::Forgotten { event_id },
                    M::Learned => T::Present { event_id },
                    M::NotLearned => T::DeclinePresent { event_id },
                };
            } else {
                let tm = selection.tm.as_mut().ok_or_else(failure)?;
                tm.phase = match tm.phase {
                    T::Intro { .. } => T::Replace,
                    T::ForgetPrompt { .. } => T::ChooseSlot,
                    T::Present { event_id } => {
                        selection.stage = S::Applied {
                            offer,
                            holder: Some(holder),
                        };
                        T::Complete { event_id }
                    }
                    T::DeclinePresent { event_id } => {
                        selection.stage = S::Choice;
                        T::Declined { event_id }
                    }
                    _ => return Err(failure()),
                };
            }
            let tm = selection.tm.as_deref().ok_or_else(failure)?;
            let replay = crate::current_reward_tm::replay(before, &selection, tm)?;
            candidate.active_run.as_mut().ok_or_else(failure)?.party = replay.party;
            crate::current_reward_tm::set_history(&mut candidate, holder, replay.history)?;
            candidate.current_achievement_tracker = Some(replay.tracker);
            let menu_instance = tm.menu_instance;
            let actionable = tm.phase.actionable() || matches!(selection.stage, S::Choice);
            crate::current_reward_selection::set_selection(&mut candidate, pending, selection)?;
            if actionable {
                crate::current_reward_selection::install_control(
                    &mut candidate,
                    pending,
                    menu_instance,
                    safe_increment(revision)?,
                    authority_seat,
                )?;
            } else {
                install_waiting(&mut candidate, revision)?;
            }
            (candidate, Vec::new())
        }
        _ => return Err(failure()),
    };
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
        presentation,
        rng_audit,
        platform_effects: Vec::new(),
    })
}
