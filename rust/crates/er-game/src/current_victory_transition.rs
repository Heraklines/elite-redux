//! Canonical transaction binding for source-owned XP descendants.
use super::*;
use crate::current_victory_pump::{
    self, CurrentVictoryPresentation as P, CurrentVictoryPump as Pump,
};
use crate::m9e_material_v6::GamePresentationPayloadV1;
use er_state::current_victory_execution::CurrentVictoryDescendantV1 as D;

pub(super) fn transition(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    operation_id: OperationId,
    authority_seat: SeatId,
    revision: SafeU53,
    phase: GameOwnedPhaseV1,
) -> Result<GameTransitionMaterialV6, GameRuntimeV6Error> {
    let failure = || GameRuntimeV6Error::Action;
    let run = before.active_run.as_ref().ok_or_else(failure)?;

    let pending_id = match &phase {
        GameOwnedPhaseV1::Victory { pending, .. }
        | GameOwnedPhaseV1::VictoryPresentation { pending, .. }
        | GameOwnedPhaseV1::VictoryTail { pending } => *pending,
        GameOwnedPhaseV1::AchievementClock { request, .. } => request.pending,
        GameOwnedPhaseV1::FlashEgg { input } => input.pending,
        _ => return Err(failure()),
    };
    let pending = before
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| {
            owner
                .pending
                .iter()
                .find(|pending| pending.id == pending_id)
        })
        .ok_or_else(failure)?;
    let turn = before
        .current_turn_execution
        .as_ref()
        .or_else(|| {
            pending
                .victory_tail
                .as_ref()
                .map(|tail| tail.original_turn.as_ref())
        })
        .ok_or_else(failure)?;
    if operation_id.as_str().is_empty()
        || revision == SafeU53::ZERO
        || run.control.revision != revision
        || run.control.kind != GameControlKindV2::Waiting
        || run.control.actionable
        || turn.authority != authority_seat
        || before.current_presentation.is_none()
        || !pending
            .friendship
            .as_ref()
            .is_some_and(|friendship| friendship.complete)
        || pending.victory_defeated_total.is_none()
        || !matches!(&turn.stage, CurrentTurnStageV1::AwaitingInterlude { faints }
            if faints.iter().any(|faint| faint.pokemon == pending.source.pokemon))
    {
        return Err(failure());
    }
    let mut reward_payloads = Vec::new();
    let result = match &phase {
        GameOwnedPhaseV1::FlashEgg { input } => {
            let (candidate, payloads) = crate::current_flash_dispatch::settle_egg(before, content, input)?;
            reward_payloads = payloads;
            Pump::Advanced(current_victory_pump::begin_current_victory(&candidate, content, pending_id)?)
        }
        GameOwnedPhaseV1::AchievementClock { request, utc_milliseconds }
            if request.achievement == er_state::current_achievement_execution::CurrentAchievementKeyV1::RealisticFlash => {
            let (candidate, payloads) = crate::current_flash_dispatch::settle_clock(before, content, request, *utc_milliseconds)?;
            reward_payloads = payloads;
            Pump::Advanced(candidate)
        }
        GameOwnedPhaseV1::AchievementClock { request, utc_milliseconds } => {
            let (candidate, parent, payloads) = crate::current_level_dispatch::settle(before, content, request, *utc_milliseconds)?;
            reward_payloads = payloads;
            if let Some(level_up) = parent {
                let (candidate, end) = crate::current_experience_settlement::apply_current_level_up(&candidate, content, &level_up)?;
                Pump::Present { candidate, request: P::LevelUp(end) }
            } else { Pump::Advanced(candidate) }
        }
        GameOwnedPhaseV1::VictoryPresentation { event_id, .. } => {
            Pump::Advanced(current_victory_pump::resume_current_victory_presentation(
                before, content, pending_id, *event_id,
            )?)
        }
        GameOwnedPhaseV1::Victory { .. } if pending.victory.is_none() => {
            if crate::current_flash_dispatch::waiting(before, pending_id) { return Err(failure()); }
            let claimed = crate::current_initial_victory_tail::claim(before, content, pending_id)?;
            let candidate = claimed.as_ref().unwrap_or(before);
            if crate::current_flash_dispatch::waiting(candidate, pending_id) {
                Pump::Advanced(candidate.clone())
            } else { Pump::Advanced(current_victory_pump::begin_current_victory(candidate, content, pending_id)?) }
        }
        GameOwnedPhaseV1::VictoryTail { .. } => {
            use er_state::current_initial_victory_tail::CurrentInitialVictoryTailPhaseV1 as T;
            let tail = pending.victory_tail.as_ref().ok_or_else(failure)?;
            let candidate = match &tail.phase {
                T::TurnSettlement { .. } => {
                    crate::current_initial_victory_tail::settle_turn(before, content, pending_id)?
                }
                T::BattleEnd { .. } => crate::current_initial_victory_tail::settle_battle_end(
                    before, content, pending_id,
                )?,
                T::EggLapse { .. } => crate::current_initial_victory_tail::settle_egg_lapse(
                    before, content, pending_id,
                )?,
                T::RewardSelectionPending { .. } => {
                    return Err(GameRuntimeV6Error::Domain(
                        "source reward choices remain pending".into(),
                    ));
                }
                T::Claimed => return Err(failure()),
            };
            Pump::Advanced(candidate)
        }
        GameOwnedPhaseV1::Victory { .. } => {
            current_victory_pump::pump_current_victory(before, content, pending_id)?
        }
        _ => return Err(failure()),
    };
    let result = match result {
        Pump::LevelUpAccount(level_up) => {
            let (candidate, parent) = crate::current_level_dispatch::begin(before, content, &level_up)?;
            if let Some(parent) = parent {
                let (candidate, end) = crate::current_experience_settlement::apply_current_level_up(&candidate, content, &parent)?;
                Pump::Present { candidate, request: P::LevelUp(end) }
            } else { Pump::Advanced(candidate) }
        }
        other => other,
    };
    let (mut candidate, request) = match result {
        Pump::Advanced(candidate) => (candidate, None),
        Pump::Present { candidate, request } => (candidate, Some(request)),
        // Completion cannot release the retained move until actual Faint and
        // Victory tails own their remaining source effects. Learning also uses
        // its actual raw control path; no synthetic acceptance is generated.
        Pump::AwaitingPresentation(event_id) => {
            return Err(GameRuntimeV6Error::Domain(format!(
                "presentation {} is still awaiting its actual callback",
                event_id.get()
            )));
        }
        Pump::LearnMoves(batch) => {
            return Err(GameRuntimeV6Error::Domain(format!(
                "retained learning for Pokemon {} requires its owned raw menu",
                batch.children.parent.level_up.award.phase.pokemon.get()
            )));
        }
        Pump::Evolution(children) => {
            return Err(GameRuntimeV6Error::Domain(format!(
                "retained evolution for Pokemon {} has unresolved descendants",
                children.parent.level_up.award.phase.pokemon.get()
            )));
        }
        Pump::Complete => (
            crate::current_initial_victory_tail::finish_experience(before, content, pending_id)?,
            None,
        ),
        Pump::LevelUpAccount(_) => return Err(failure()),
    };
    let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Reward);
    let mapping = content.presentation(semantic).ok_or_else(failure)?;
    let mut presentation = reward_payloads.into_iter().map(|payload| GamePresentationEffectV2 {
        event_id: PresentationEventId::new(revision), semantic, blocking: mapping.blocking,
        skip: mapping.skip, payload: Some(payload),
    }).collect::<Vec<_>>();
    assign_presentations(&mut candidate, &mut presentation)?;
    if let Some(request) = request {
        let payload = match &request {
            P::FieldAward(award) => GamePresentationPayloadV1::ExperienceGain {
                holder: award.phase.pokemon,
                amount: award.experience,
                party_bar: false,
            },
            P::PartyAward { award, .. } => GamePresentationPayloadV1::ExperienceGain {
                holder: award.phase.pokemon,
                amount: award.experience,
                party_bar: true,
            },
            P::LevelUp(end) => {
                let level = &end.level_up;
                let pokemon = candidate
                    .active_run
                    .as_ref()
                    .and_then(|run| run.party.get(usize::from(level.award.phase.party_index)))
                    .ok_or_else(failure)?;
                GamePresentationPayloadV1::LevelStats {
                    holder: pokemon.id,
                    previous_level: level.previous_level,
                    level: level.new_level,
                    previous_stats: level.previous_stats,
                    stats: pokemon.stats,
                }
            }
            P::HidePartyBar(award) => GamePresentationPayloadV1::HidePartyExperience {
                holder: award.phase.pokemon,
            },
        };
        let semantic = PresentationSemanticIdV1::Cue(PresentationCueFamilyV1::Progression);
        let mapping = content.presentation(semantic).ok_or_else(failure)?;
        presentation.push(GamePresentationEffectV2 {
            event_id: PresentationEventId::new(revision),
            semantic,
            blocking: mapping.blocking,
            skip: mapping.skip,
            payload: Some(payload),
        });
        assign_presentations(&mut candidate, presentation.last_mut().map(std::slice::from_mut).ok_or_else(failure)?)?;
        let event_id = presentation.last().ok_or_else(failure)?.event_id;
        let descendant = match request {
            P::FieldAward(award) => D::AwardPresentation { award, event_id },
            P::PartyAward { award, level_up } => D::PartyAwardPresentation {
                award,
                level_up,
                event_id,
            },
            P::LevelUp(end) => D::LevelUpPresentation { end, event_id },
            P::HidePartyBar(award) => D::HidePartyBarPresentation { award, event_id },
        };
        candidate
            .current_battle_participation
            .as_mut()
            .and_then(|owner| owner.experience.as_mut())
            .and_then(|owner| {
                owner
                    .pending
                    .iter_mut()
                    .find(|pending| pending.id == pending_id)
            })
            .and_then(|pending| pending.victory.as_mut())
            .ok_or_else(failure)?
            .descendant = descendant;
    }
    let batch = candidate
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| {
            owner
                .pending
                .iter()
                .find(|pending| pending.id == pending_id)
        })
        .and_then(|pending| pending.victory.as_ref())
        .and_then(|victory| match &victory.descendant {
            D::LearnMoveBatch { batch } if !batch.complete => Some(batch),
            _ => None,
        });
    if let Some(batch) = batch {
        let GameOwnedPhaseV1::Victory { menu_instance, .. } = &phase else {
            return Err(failure());
        };
        // The kernel supplies its actual next menu allocation. This identity is
        // retained in the material and independently reused by recomputation.
        if *menu_instance == MenuInstanceId::ZERO {
            return Err(failure());
        }
        let next_revision = safe_increment(revision)?;
        let context = GameActionContextV1 {
            operation_id: OperationId::new(format!(
                "current/learn/{}/{}/{}",
                run.run_id.get().get(),
                pending_id.get(),
                next_revision.get()
            ))
            .map_err(|_| failure())?,
            authority_seat,
            authority_revision: next_revision,
            menu_instance: *menu_instance,
        };
        let control =
            crate::m7_progression_control::current_learn_move_batch_control(&context, batch)
                .map_err(|_| failure())?;
        candidate.active_run.as_mut().ok_or_else(failure)?.control = control;
    } else {
        install_waiting(&mut candidate, revision)?;
    }
    candidate
        .validate_with(content)
        .map_err(|_| GameRuntimeV6Error::Invalid)?;
    let next_control = candidate
        .active_run
        .as_ref()
        .ok_or_else(failure)?
        .control
        .clone();
    let mut platform_effects = crate::current_level_dispatch::clock(&candidate, pending_id)
        .or_else(|| crate::current_flash_dispatch::clock(&candidate, pending_id))
        .filter(|next| Some(*next) != crate::current_level_dispatch::clock(before, pending_id).or_else(|| crate::current_flash_dispatch::clock(before, pending_id)))
        .map(|request| vec![GamePlatformEffectV2::CurrentAchievementClock { request: *request }])
        .unwrap_or_default();
    if let Some(request) = crate::current_flash_dispatch::egg_request(&candidate, pending_id)
        .filter(|request| Some(*request) != crate::current_flash_dispatch::egg_request(before, pending_id)) {
        platform_effects.push(GamePlatformEffectV2::CurrentFlashEgg { request: *request });
    }
    let before_digest = game_state_digest(before).map_err(material_error)?;
    let after_digest = game_state_digest(&candidate).map_err(material_error)?;
    Ok(GameTransitionMaterialV6 {
        schema_version: crate::m9e_material_v6::GAME_MATERIAL_SCHEMA_VERSION_V6,
        domain: GameActionDomainV2::Progression,
        operation_id,
        authority_seat,
        authority_revision: revision,
        content_identity: before.content_identity.clone(),
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
        rng_audit: Vec::new(),
        platform_effects,
    })
}
