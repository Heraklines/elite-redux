//! Source-ordered Victory descendants. Presentation allocation, acknowledgement,
//! account rewards and final Faint release belong to the material dispatcher.
use crate::current_experience_settlement::{
    apply_current_experience_award, begin_current_learn_move_batch, plan_current_level_up_children,
    plan_current_victory_experience, prepare_current_experience_phase,
};
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;
use er_state::current_experience_settlement::{
    CurrentExperienceAwardV1, CurrentLearnMoveBatchV1, CurrentLevelUpChildrenV1,
    CurrentLevelUpEndV1, CurrentLevelUpV1,
};
use er_state::current_victory_execution::{
    CurrentVictoryDescendantV1 as D, CurrentVictoryExecutionV1,
};
use er_state::m9e_state_v6::GameStateV6;
use er_types::{PresentationEventId, SafeU53};

/// Drafts carry the actual retained operands. The dispatcher renders the source
/// settings, allocates a real receipt, and binds it in the same transaction.
pub(crate) enum CurrentVictoryPresentation {
    FieldAward(CurrentExperienceAwardV1),
    PartyAward {
        award: CurrentExperienceAwardV1,
        level_up: Option<CurrentLevelUpV1>,
    },
    LevelUp(CurrentLevelUpEndV1),
    HidePartyBar(CurrentExperienceAwardV1),
}

pub(crate) enum CurrentVictoryPump {
    Advanced(GameStateV6),
    Present {
        candidate: GameStateV6,
        request: CurrentVictoryPresentation,
    },
    AwaitingPresentation(PresentationEventId),
    LevelUpAccount(CurrentLevelUpV1),
    LearnMoves(CurrentLearnMoveBatchV1),
    Evolution(CurrentLevelUpChildrenV1),
    Complete,
}

fn failure() -> GameRuntimeV6Error {
    GameRuntimeV6Error::Action
}

fn cursor(
    state: &GameStateV6,
    pending_id: SafeU53,
) -> Result<&CurrentVictoryExecutionV1, GameRuntimeV6Error> {
    let value = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.iter().find(|p| p.id == pending_id))
        .and_then(|p| p.victory.as_ref())
        .ok_or_else(failure)?;
    if !value.valid(pending_id) {
        return Err(failure());
    }
    Ok(value)
}

fn replace(
    state: &mut GameStateV6,
    pending_id: SafeU53,
    value: CurrentVictoryExecutionV1,
) -> Result<(), GameRuntimeV6Error> {
    if !value.valid(pending_id) {
        return Err(failure());
    }
    let pending = state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.iter_mut().find(|p| p.id == pending_id))
        .ok_or_else(failure)?;
    pending.victory = Some(value);
    Ok(())
}

/// The caller reaches this only through its actual Faint/friendship frontier.
/// Re-entry cannot recapture awards from an already-mutated party.
pub(crate) fn begin_current_victory(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    pending_id: SafeU53,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    let pending = before
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.iter().find(|p| p.id == pending_id))
        .ok_or_else(failure)?;
    if pending.victory.is_some()
        || !pending
            .friendship
            .as_ref()
            .is_some_and(|phase| phase.complete)
    {
        return Err(failure());
    }
    let phases = plan_current_victory_experience(before, content, pending_id)?;
    let descendant = if phases.is_empty() {
        D::Complete
    } else {
        D::Ready
    };
    let mut candidate = before.clone();
    replace(
        &mut candidate,
        pending_id,
        CurrentVictoryExecutionV1 {
            phases,
            next_phase: 0,
            completed: Vec::new(),
            descendant,
            level_achievements: None,
        },
    )?;
    Ok(candidate)
}

fn advance(
    before: &GameStateV6,
    pending_id: SafeU53,
    descendant: D,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    let mut retained = cursor(before, pending_id)?.clone();
    retained.descendant = descendant;
    let mut candidate = before.clone();
    replace(&mut candidate, pending_id, retained)?;
    Ok(candidate)
}

fn finish_recipient(
    before: &GameStateV6,
    pending_id: SafeU53,
    award: &CurrentExperienceAwardV1,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    let mut retained = cursor(before, pending_id)?.clone();
    if retained.phases.get(usize::from(retained.next_phase)) != Some(&award.phase) {
        return Err(failure());
    }
    retained.completed.push(award.clone());
    retained.next_phase = retained.next_phase.checked_add(1).ok_or_else(failure)?;
    retained.descendant = if usize::from(retained.next_phase) == retained.phases.len() {
        D::Complete
    } else {
        D::Ready
    };
    let mut candidate = before.clone();
    replace(&mut candidate, pending_id, retained)?;
    Ok(candidate)
}

fn finish_children(
    before: &GameStateV6,
    pending_id: SafeU53,
    award: &CurrentExperienceAwardV1,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    if award.phase.on_field {
        finish_recipient(before, pending_id, award)
    } else {
        advance(
            before,
            pending_id,
            D::HidePartyBar {
                award: award.clone(),
            },
        )
    }
}

/// One logical step, never a drain loop. An outstanding presentation is returned
/// without mutating XP; the kernel must actually acknowledge it before resume.
pub(crate) fn pump_current_victory(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    pending_id: SafeU53,
) -> Result<CurrentVictoryPump, GameRuntimeV6Error> {
    let retained = cursor(before, pending_id)?;
    Ok(match &retained.descendant {
        D::Ready => {
            let phase = retained
                .phases
                .get(usize::from(retained.next_phase))
                .ok_or_else(failure)?;
            let award = prepare_current_experience_phase(before, content, phase)?;
            if phase.on_field {
                CurrentVictoryPump::Present {
                    candidate: before.clone(),
                    request: CurrentVictoryPresentation::FieldAward(award),
                }
            } else {
                let (candidate, level_up) =
                    apply_current_experience_award(before, content, &award)?;
                CurrentVictoryPump::Present {
                    candidate,
                    request: CurrentVictoryPresentation::PartyAward { award, level_up },
                }
            }
        }
        D::AwardPresentation { event_id, .. }
        | D::PartyAwardPresentation { event_id, .. }
        | D::LevelUpPresentation { event_id, .. }
        | D::HidePartyBarPresentation { event_id, .. } => {
            CurrentVictoryPump::AwaitingPresentation(*event_id)
        }
        D::LevelUpStart { level_up } => CurrentVictoryPump::LevelUpAccount(level_up.clone()),
        D::LevelUpChildren { children } => {
            let batch = begin_current_learn_move_batch(before, content, children)?;
            let next = if batch.complete {
                D::Evolution {
                    children: children.clone(),
                }
            } else {
                D::LearnMoveBatch { batch }
            };
            CurrentVictoryPump::Advanced(advance(before, pending_id, next)?)
        }
        D::LearnMoveBatch { batch } => {
            if batch.complete {
                CurrentVictoryPump::Advanced(advance(
                    before,
                    pending_id,
                    D::Evolution {
                        children: batch.children.clone(),
                    },
                )?)
            } else {
                CurrentVictoryPump::LearnMoves(batch.clone())
            }
        }
        D::Evolution { children } => {
            if children.evolution_candidates.is_empty() {
                CurrentVictoryPump::Advanced(finish_children(
                    before,
                    pending_id,
                    &children.parent.level_up.award,
                )?)
            } else {
                CurrentVictoryPump::Evolution(children.clone())
            }
        }
        D::HidePartyBar { award } => CurrentVictoryPump::Present {
            candidate: before.clone(),
            request: CurrentVictoryPresentation::HidePartyBar(award.clone()),
        },
        D::Complete => CurrentVictoryPump::Complete,
    })
}

/// Internal dispatcher hook, called only after its exact receipt is acknowledged.
/// The retained event ID prevents resuming a different descendant or replaying an
/// old acknowledgement. Receipt existence alone is deliberately not consulted.
pub(crate) fn resume_current_victory_presentation(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    pending_id: SafeU53,
    acknowledged: PresentationEventId,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    match &cursor(before, pending_id)?.descendant {
        D::AwardPresentation { award, event_id } if *event_id == acknowledged => {
            let (candidate, level_up) = apply_current_experience_award(before, content, award)?;
            match level_up {
                Some(level_up) => advance(&candidate, pending_id, D::LevelUpStart { level_up }),
                None => finish_children(&candidate, pending_id, award),
            }
        }
        D::PartyAwardPresentation {
            award,
            level_up,
            event_id,
        } if *event_id == acknowledged => {
            // Party XP was applied before displaying the bar; never apply twice.
            match level_up {
                Some(level_up) => advance(
                    before,
                    pending_id,
                    D::LevelUpStart {
                        level_up: level_up.clone(),
                    },
                ),
                None => finish_children(before, pending_id, award),
            }
        }
        D::LevelUpPresentation { end, event_id } if *event_id == acknowledged => {
            let children = plan_current_level_up_children(before, content, end)?;
            advance(before, pending_id, D::LevelUpChildren { children })
        }
        D::HidePartyBarPresentation { award, event_id } if *event_id == acknowledged => {
            finish_recipient(before, pending_id, award)
        }
        _ => Err(failure()),
    }
}
