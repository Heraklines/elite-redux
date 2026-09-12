//! Candidate-only execution of the source-neutral first-turn Victory tail.
//! No generic reward chooser or next-wave provenance is fabricated here.
use crate::m9e_content_v2::PreparedGameContentV2;
use crate::m9e_runtime_v6::GameRuntimeV6Error;
use er_battle::current_target_execution::CurrentTargetExecution;
use er_state::current_experience_owner::{
    CurrentExperienceRecipientStatsV1, CurrentExperienceRecipientV1, CurrentPendingExperienceV1,
};
use er_state::current_faint_execution::CurrentFaintPhaseV1;
use er_state::current_initial_victory_tail::{
    CurrentFieldTurnCountV1, CurrentInitialBattleEndAccountingV1,
    CurrentInitialVictoryTailPhaseV1 as P, CurrentInitialVictoryTailV1,
};
use er_state::current_turn_execution::CurrentTurnStageV1;
use er_state::current_victory_execution::CurrentVictoryDescendantV1;
use er_state::m9e_state_v6::GameStateV6;
use er_state::mechanic_state_v2::MechanicStateStoreV2;
use er_types::battle_ids::BattleSide;
use er_types::battle_model::{BattleOutcome, StatusKind};
use er_types::{BehaviorSourceId, SafeU53};

fn failure() -> GameRuntimeV6Error {
    GameRuntimeV6Error::Action
}
fn one() -> Result<SafeU53, GameRuntimeV6Error> {
    SafeU53::new(1).map_err(|_| failure())
}
fn pending(
    state: &GameStateV6,
    id: SafeU53,
) -> Result<&CurrentPendingExperienceV1, GameRuntimeV6Error> {
    let owner = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .ok_or_else(failure)?;
    if owner.pending.len() != 1 {
        return Err(failure());
    }
    owner
        .pending
        .first()
        .filter(|pending| pending.id == id)
        .ok_or_else(failure)
}
fn set_tail(
    state: &mut GameStateV6,
    id: SafeU53,
    tail: CurrentInitialVictoryTailV1,
) -> Result<(), GameRuntimeV6Error> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.iter_mut().find(|p| p.id == id))
        .ok_or_else(failure)?
        .victory_tail = Some(tail);
    Ok(())
}
fn endpoint(state: &GameStateV6) -> Result<Vec<CurrentExperienceRecipientV1>, GameRuntimeV6Error> {
    state
        .active_run
        .as_ref()
        .ok_or_else(failure)?
        .party
        .iter()
        .map(|p| {
            Ok(CurrentExperienceRecipientV1 {
                pokemon: p.id,
                owner: p.owner_seat.ok_or_else(failure)?,
                hp: p.hp,
                level: p.level,
                experience: p.experience,
                pokerus: p.pokerus,
                stats: Some(CurrentExperienceRecipientStatsV1 {
                    stats: p.stats,
                    max_hp: p.max_hp,
                }),
            })
        })
        .collect()
}

/// Qualified run34691284958: 23 IDs have empty PostTurn/PostBattle families;
/// applicable5082 has PassiveRecovery and remains unsupported. Every observed
/// registry row has empty meta_kinds, so the eligible money multiplier is1.
/// Raw locked innate5082 is preserved, not confused with an applicable source.
fn neutral_context(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(), GameRuntimeV6Error> {
    crate::current_source_progression::current_source_progression(state, content)?;
    let run = state.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    if run.party.len() != 1
        || run.wave.get().get() != 1
        || battle.mechanics != MechanicStateStoreV2::default()
        || !battle
            .field
            .slots
            .iter()
            .any(|s| s.slot.side == BattleSide::Player && s.occupant == Some(run.party[0].id))
        || battle
            .field
            .slots
            .iter()
            .any(|s| s.slot.side == BattleSide::Enemy && s.occupant.is_some())
    {
        return Err(failure());
    }
    let pokemon = &run.party[0];
    if pokemon.hp == 0
        || pokemon.fainted
        || pokemon.status.kind != StatusKind::None
        || pokemon.mechanics != MechanicStateStoreV2::default()
        || pokemon.tera_type.is_some()
    {
        return Err(failure());
    }
    let targeting = CurrentTargetExecution::from_state(state).map_err(|_| failure())?;
    // This also rejects weather, terrain, arena tags, suppression and held items.
    for source in targeting
        .ability_sources(run, pokemon)
        .map_err(|_| failure())?
    {
        let id = match source {
            BehaviorSourceId::ActiveAbility { numeric_id }
            | BehaviorSourceId::PassiveAbility { numeric_id } => numeric_id.get(),
            _ => return Err(failure()),
        };
        if !matches!(
            id,
            0 | 18
                | 41
                | 43
                | 47
                | 49
                | 51
                | 62
                | 65
                | 66
                | 67
                | 75
                | 82
                | 94
                | 113
                | 172
                | 192
                | 257
                | 268
                | 5006
                | 5033
                | 5097
                | 5115
        ) {
            return Err(failure());
        }
    }
    let tracker = state
        .current_achievement_tracker
        .as_ref()
        .and_then(|t| t.battle.as_ref())
        .ok_or_else(failure)?;
    if tracker.player_fainted_this_battle {
        return Err(failure());
    }
    Ok(())
}

/// Call at actual Victory.start after friendship preparation and before XP.
/// Source WaveWon observes pre-XP levels and stats; never move it to Complete.
pub(crate) fn claim(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<Option<GameStateV6>, GameRuntimeV6Error> {
    // Unsupported tail contexts preserve the already admitted XP path. They
    // remain explicitly unresolved at Complete rather than silently finishing.
    if neutral_context(before, content).is_err() {
        return Ok(None);
    }
    let pending = pending(before, id)?;
    if pending.victory_tail.is_some()
        || pending.victory.is_some()
        || pending.victory_defeated_total != Some(one()?)
        || !pending.friendship.as_ref().is_some_and(|p| p.complete)
    {
        return Err(failure());
    }
    let source = crate::current_source_progression::current_source_progression(before, content)?;
    let Some(CurrentFaintPhaseV1::ReadyForVictory { address }) = &source.initial_faint.phase else {
        return Err(failure());
    };
    let turn = before.current_turn_execution.as_ref().ok_or_else(failure)?;
    if turn.turn.get().get() != 1 {
        return Ok(None);
    }
    if turn.finalization_done
        || turn.next_action == 0
        || address.pending_id != id
        || !matches!(&turn.stage, CurrentTurnStageV1::AwaitingInterlude { faints }
            if faints.len() == 1 && faints[0].id == address.faint_id && faints[0].pokemon == address.pokemon)
    {
        return Err(failure());
    }
    let tracker = before
        .current_achievement_tracker
        .as_ref()
        .and_then(|t| t.battle.as_ref())
        .ok_or_else(failure)?;
    let flash_reached = tracker.player_ever_acted && !tracker.flash_failed;
    let mut tail = CurrentInitialVictoryTailV1 {
        faint: address.clone(),
        original_turn: Box::new(turn.clone()),
        cancelled_from: turn.next_action,
        cancelled_to: u8::try_from(turn.actions.len()).map_err(|_| failure())?,
        phase: P::Claimed,
        flash: None,
    };
    let mut state = before.clone();
    if flash_reached {
        tail.flash = crate::current_flash_dispatch::begin(&mut state, id)?;
    }
    set_tail(&mut state, id, tail)?;
    Ok(Some(state))
}

/// Close the arithmetic endpoint after every XP presentation/child actually
/// completed. A stored endpoint does not authorize any following HP mutation.
pub(crate) fn finish_experience(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    if pending(before, id)?.victory_tail.is_none() {
        return Err(GameRuntimeV6Error::Domain(
            "source Victory tail remains unsupported at this completed XP boundary".into(),
        ));
    }
    neutral_context(before, content)?;
    crate::current_experience_validation::validate_current_experience_progress(before, content)?;
    let pending = pending(before, id)?;
    if !pending
        .victory
        .as_ref()
        .is_some_and(|v| v.valid(id) && v.descendant == CurrentVictoryDescendantV1::Complete)
    {
        return Err(failure());
    }
    let mut tail = pending.victory_tail.clone().ok_or_else(|| {
        GameRuntimeV6Error::Domain(
            "source Victory tail remains unsupported at this completed XP boundary".into(),
        )
    })?;
    if tail.phase != P::Claimed {
        return Err(failure());
    }
    tail.phase = P::TurnSettlement {
        xp_endpoint: endpoint(before)?,
    };
    let mut state = before.clone();
    set_tail(&mut state, id, tail)?;
    Ok(state)
}

/// The first-turn neutral TurnEnd has no RNG draw and no HP/stat mutation.
/// It still increments the public turn, clears the cached battle substream and
/// command collection, and records both actual active summon turn counters.
pub(crate) fn settle_turn(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    neutral_context(before, content)?;
    validate(before, id)?;
    let mut tail = pending(before, id)?
        .victory_tail
        .clone()
        .ok_or_else(failure)?;
    let P::TurnSettlement { xp_endpoint } = &tail.phase else {
        return Err(failure());
    };
    let xp_endpoint = xp_endpoint.clone();
    let pokemon = before.active_run.as_ref().ok_or_else(failure)?.party[0].id;
    let mut state = before.clone();
    let battle = state
        .active_run
        .as_mut()
        .and_then(|r| r.battle.as_mut())
        .ok_or_else(failure)?;
    battle.battle_rng.increment_turn().map_err(|_| failure())?;
    battle.turn = battle.battle_rng.turn;
    battle.command_state.frontier.clear();
    battle.command_state.tombstones.clear();
    battle.outcome = BattleOutcome::Victory;
    let next_turn = battle.turn;
    state
        .current_battle_participation
        .as_mut()
        .ok_or_else(failure)?
        .next_turn = next_turn;
    // The exact original cursor/actions survive in the tail. They are cancelled,
    // never falsely marked executed by advancing next_action over the suffix.
    state.current_turn_execution = None;
    state
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.iter_mut().find(|p| p.id == id))
        .ok_or_else(failure)?
        .continuation =
        er_state::current_experience_owner::CurrentExperienceContinuationV1::WaveVictoryTail;
    tail.phase = P::BattleEnd {
        xp_endpoint,
        field_turns: vec![CurrentFieldTurnCountV1 {
            pokemon,
            turn_count: one()?,
            wave_turn_count: one()?,
        }],
    };
    set_tail(&mut state, id, tail)?;
    validate(&state, id)?;
    Ok(state)
}

/// Source BattleEnd first-win accounting. No reward/egg/NewBattle operation is
/// executed by this helper; the next stage remains explicitly owned and pending.
pub(crate) fn settle_battle_end(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    neutral_context(before, content)?;
    validate(before, id)?;
    let mut tail = pending(before, id)?
        .victory_tail
        .clone()
        .ok_or_else(failure)?;
    let P::BattleEnd {
        xp_endpoint,
        field_turns,
    } = &tail.phase
    else {
        return Err(failure());
    };
    // First source battle, settled turn2, one nonboss enemy: score multiplier
    // yields ceil(battleScore * Sine.easeIn(1)) == battleScore. No trig shortcut
    // is admitted for later turns. Fresh durable GameStats.battles starts at0.
    let accounting = CurrentInitialBattleEndAccountingV1 {
        battles: one()?,
        score: tail.faint.score_increase,
        money_multiplier: one()?,
        money_multiplier_captured: true,
        money_streaks: xp_endpoint
            .iter()
            .map(|p| Ok((p.pokemon, one()?)))
            .collect::<Result<_, GameRuntimeV6Error>>()?,
    };
    tail.phase = P::EggLapse {
        xp_endpoint: xp_endpoint.clone(),
        field_turns: field_turns.clone(),
        accounting,
    };
    let mut state = before.clone();
    set_tail(&mut state, id, tail)?;
    validate(&state, id)?;
    Ok(state)
}

/// Structural live stage checks plus the explicit neutral endpoint relation.
/// Content-aware XP arithmetic must also validate projection_for_validation.
pub(crate) fn validate(state: &GameStateV6, id: SafeU53) -> Result<(), GameRuntimeV6Error> {
    let pending = pending(state, id)?;
    let tail = pending.victory_tail.as_ref().ok_or_else(failure)?;
    crate::current_flash_dispatch::validate(state, id)?;
    let run = state.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    let source = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.source_progression.as_ref())
        .ok_or_else(failure)?;
    if !matches!(&source.initial_faint.phase, Some(CurrentFaintPhaseV1::ReadyForVictory { address }) if address == &tail.faint)
    {
        return Err(failure());
    }
    if tail.original_turn.turn.get().get() != 1
        || tail.original_turn.finalization_done
        || tail.original_turn.run != run.run_id
        || tail.original_turn.battle != battle.battle_id
        || tail.original_turn.wave != run.wave
        || tail.cancelled_from != tail.original_turn.next_action
        || tail.cancelled_to as usize != tail.original_turn.actions.len()
        || tail.cancelled_from == 0
        || tail.cancelled_from > tail.cancelled_to
        || tail.faint.pending_id != id
        || tail.faint.observation != pending.observation
        || tail.faint.pokemon != pending.source.pokemon
    {
        return Err(failure());
    }
    if let Some(xp) = tail.xp_endpoint()
        && (xp != endpoint(state)?.as_slice()
            || !pending.victory.as_ref().is_some_and(|v| {
                v.valid(id) && v.descendant == CurrentVictoryDescendantV1::Complete
            }))
    {
        return Err(failure());
    }
    if tail.turn_is_settled() {
        if state.current_turn_execution.is_some()
            || battle.turn.get().get() != 2
            || battle.battle_rng.turn != battle.turn
            || battle.battle_rng.saved_substream.is_some()
            || battle.outcome != BattleOutcome::Victory
            || !battle.command_state.frontier.is_empty()
            || !battle.command_state.tombstones.is_empty()
        {
            return Err(failure());
        }
    } else if state.current_turn_execution.as_ref() != Some(tail.original_turn.as_ref())
        || battle.turn.get().get() != 1
    {
        return Err(failure());
    }
    let field_turns = match &tail.phase {
        P::BattleEnd { field_turns, .. }
        | P::EggLapse { field_turns, .. }
        | P::RewardSelectionPending { field_turns, .. } => Some(field_turns),
        _ => None,
    };
    if let Some(counts) = field_turns
        && (run.party.len() != 1
            || counts.as_slice()
                != [CurrentFieldTurnCountV1 {
                    pokemon: run.party[0].id,
                    turn_count: one()?,
                    wave_turn_count: one()?,
                }])
    {
        return Err(failure());
    }
    if let P::EggLapse { accounting, .. } | P::RewardSelectionPending { accounting, .. } =
        &tail.phase
        && (accounting.battles != one()?
            || accounting.score != tail.faint.score_increase
            || accounting.money_multiplier != one()?
            || !accounting.money_multiplier_captured
            || accounting.money_streaks.as_slice() != [(run.party[0].id, one()?)])
    {
        return Err(failure());
    }
    if matches!(&tail.phase, P::RewardSelectionPending { .. }) {
        if tail
            .flash
            .as_ref()
            .is_some_and(|f| f.completed_input.is_some())
        {
            crate::current_flash_dispatch::validate_egg(state, id, true)?;
        } else {
            empty_egg_account(state)?;
        }
    }
    Ok(())
}

/// Reconstruct only the retained validation frontier, never execute it again.
/// Faint validates this exact original turn/address; XP validates the captured
/// endpoint. Live tail validation separately owns post-XP successor changes.
pub(crate) fn projection_for_validation(
    state: &GameStateV6,
    id: SafeU53,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    validate(state, id)?;
    let tail = pending(state, id)?
        .victory_tail
        .as_ref()
        .ok_or_else(failure)?;
    let mut projected = state.clone();
    let run = projected.active_run.as_mut().ok_or_else(failure)?;
    if let Some(endpoint) = tail.xp_endpoint() {
        if endpoint.len() != run.party.len() {
            return Err(failure());
        }
        for (p, end) in run.party.iter_mut().zip(endpoint) {
            let stats = end.stats.as_ref().ok_or_else(failure)?;
            p.hp = end.hp;
            p.fainted = end.hp == 0;
            p.level = end.level;
            p.experience = end.experience;
            p.stats = stats.stats;
            p.max_hp = stats.max_hp;
        }
    }
    let battle = run.battle.as_mut().ok_or_else(failure)?;
    battle.turn = tail.original_turn.turn;
    battle.battle_rng.turn = battle.turn;
    battle.outcome = BattleOutcome::Ongoing;
    projected
        .current_battle_participation
        .as_mut()
        .ok_or_else(failure)?
        .next_turn = battle.turn;
    projected
        .current_battle_participation
        .as_mut()
        .and_then(|p| p.experience.as_mut())
        .and_then(|o| o.pending.first_mut())
        .ok_or_else(failure)?
        .continuation =
        er_state::current_experience_owner::CurrentExperienceContinuationV1::BattleTail;
    tail.original_turn.validate(run).map_err(|_| failure())?;
    projected.current_turn_execution = Some(*tail.original_turn.clone());
    Ok(projected)
}

pub(crate) fn settled_projection(
    state: &GameStateV6,
) -> Result<Option<GameStateV6>, GameRuntimeV6Error> {
    let Some(pending) = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .and_then(|o| o.pending.first())
    else {
        return Ok(None);
    };
    if pending
        .victory_tail
        .as_ref()
        .is_some_and(|tail| tail.turn_is_settled())
    {
        Ok(Some(projection_for_validation(state, pending.id)?))
    } else {
        Ok(None)
    }
}

pub(crate) fn validate_all(
    state: &GameStateV6,
    content: &PreparedGameContentV2,
) -> Result<(), GameRuntimeV6Error> {
    neutral_context(state, content)?;
    let owner = state
        .current_battle_participation
        .as_ref()
        .and_then(|p| p.experience.as_ref())
        .ok_or_else(failure)?;
    if owner.pending.len() != 1 {
        return Err(failure());
    }
    validate(state, owner.pending[0].id)
}
/// Explicit ownership is mandatory: missing historical data is not empty.
fn empty_egg_account(state: &GameStateV6) -> Result<(), GameRuntimeV6Error> {
    let account = state
        .current_friendship_profile
        .as_ref()
        .and_then(|p| p.egg_account.as_ref())
        .ok_or_else(|| GameRuntimeV6Error::Domain("source Egg account is unknown".into()))?;
    account.validate().map_err(|_| failure())?;
    if !account.eggs.is_empty() || account.auto_restock.enabled {
        return Err(GameRuntimeV6Error::Domain(
            "source EggLapse has unresolved hatch/restock descendants".into(),
        ));
    }
    Ok(())
}

/// Actual solo empty-inventory EggLapse: filter/decrement visits no eggs, and
/// planAutoRestock's disabled branch returns no purchases. Source oracle
/// run34692247388 established the fresh settings and actual empty plan.
pub(crate) fn settle_egg_lapse(
    before: &GameStateV6,
    content: &PreparedGameContentV2,
    id: SafeU53,
) -> Result<GameStateV6, GameRuntimeV6Error> {
    neutral_context(before, content)?;
    validate(before, id)?;
    let mut tail = pending(before, id)?
        .victory_tail
        .clone()
        .ok_or_else(failure)?;
    let flash = tail
        .flash
        .as_ref()
        .is_some_and(|f| f.completed_input.is_some());
    if flash {
        crate::current_flash_dispatch::validate_egg(before, id, false)?;
    } else {
        empty_egg_account(before)?;
    }
    let P::EggLapse {
        xp_endpoint,
        field_turns,
        accounting,
    } = &tail.phase
    else {
        return Err(failure());
    };
    tail.phase = P::RewardSelectionPending {
        xp_endpoint: xp_endpoint.clone(),
        field_turns: field_turns.clone(),
        accounting: accounting.clone(),
    };
    let mut state = before.clone();
    if flash {
        let account = state
            .current_friendship_profile
            .as_mut()
            .and_then(|p| p.egg_account.as_mut())
            .ok_or_else(failure)?;
        account.eggs.first_mut().ok_or_else(failure)?.hatch_waves = 24;
    }
    set_tail(&mut state, id, tail)?;
    validate(&state, id)?;
    Ok(state)
}
