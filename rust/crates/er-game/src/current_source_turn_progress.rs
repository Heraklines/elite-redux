//! Source-owned temporary turn counts and damageTaken for neutral first-wave execution.
use crate::m9e_runtime_v6::GameRuntimeV6Error;
use er_battle::m7_resolver::BattlePresentationCueV5;
use er_state::current_battle_source_events::CurrentBattleSourceEventV1;
use er_state::current_source_progression::CurrentSourceTurnProgressV1;
use er_state::m9e_state_v6::GameStateV6;
use er_types::SafeU53;

fn failure() -> GameRuntimeV6Error {
    GameRuntimeV6Error::Action
}
pub(crate) fn progress(
    state: &GameStateV6,
) -> Result<&CurrentSourceTurnProgressV1, GameRuntimeV6Error> {
    state
        .current_battle_participation
        .as_ref()
        .and_then(|owner| owner.experience.as_ref())
        .and_then(|owner| owner.source_progression.as_ref())
        .and_then(|source| source.turn_progress.as_ref())
        .ok_or_else(failure)
}
pub(crate) fn install(
    state: &mut GameStateV6,
    value: CurrentSourceTurnProgressV1,
) -> Result<(), GameRuntimeV6Error> {
    state
        .current_battle_participation
        .as_mut()
        .and_then(|owner| owner.experience.as_mut())
        .and_then(|owner| owner.source_progression.as_mut())
        .ok_or_else(failure)?
        .turn_progress = Some(value);
    Ok(())
}
fn add(value: SafeU53, amount: u64) -> Result<SafeU53, GameRuntimeV6Error> {
    SafeU53::new(value.get().checked_add(amount).ok_or_else(failure)?).map_err(|_| failure())
}

pub(crate) fn fold(
    before: &GameStateV6,
    after: &mut GameStateV6,
    events: &[CurrentBattleSourceEventV1],
    cues: &[BattlePresentationCueV5],
) -> Result<(), GameRuntimeV6Error> {
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    let next_run = after.active_run.as_ref().ok_or_else(failure)?;
    let next_battle = next_run.battle.as_ref().ok_or_else(failure)?;
    let previous = progress(before)?;
    if !previous.valid(run) || previous.turn != battle.turn || progress(after)? != previous {
        return Err(failure());
    }
    let mut next = previous.clone();
    if before.current_turn_execution.is_none() && after.current_turn_execution.is_some() {
        if !events.is_empty() || !cues.is_empty() || next_battle.turn != battle.turn {
            return Err(failure());
        }
        // Actual TurnInit resets only the current active field, not benched history.
        for row in &mut next.pokemon {
            if battle
                .field
                .slots
                .iter()
                .any(|slot| slot.occupant == Some(row.pokemon))
            {
                row.damage_taken = SafeU53::ZERO;
                row.stat_stages_decreased = false;
                row.last_reset_turn = battle.turn;
            }
        }
    } else if next_battle.turn != battle.turn {
        if !events.is_empty()
            || next_battle.turn.get().get()
                != battle.turn.get().get().checked_add(1).ok_or_else(failure)?
        {
            return Err(failure());
        }
        increment_field(before, &mut next)?;
        next.turn = next_battle.turn;
    } else {
        for event in events {
            let (pokemon, amount) = match event {
                CurrentBattleSourceEventV1::MoveResolution { .. }
                | CurrentBattleSourceEventV1::StatStageChangeQueued { .. } => continue,
                CurrentBattleSourceEventV1::MoveDamage { target, damage, .. } => (*target, *damage),
                CurrentBattleSourceEventV1::StruggleRecoilDamage {
                    user,
                    requested_damage,
                    ..
                } => (*user, *requested_damage),
            };
            let row = next
                .pokemon
                .iter_mut()
                .find(|row| row.pokemon == pokemon)
                .ok_or_else(failure)?;
            if row.last_reset_turn != battle.turn {
                return Err(failure());
            }
            row.damage_taken = add(row.damage_taken, u64::from(amount))?;
        }
        for cue in cues {
            if let BattlePresentationCueV5::Switched { slot, pokemon } = cue {
                if !events.is_empty() {
                    return Err(failure());
                }
                let outgoing = battle
                    .field
                    .slots
                    .iter()
                    .find(|row| row.slot == *slot)
                    .and_then(|row| row.occupant)
                    .ok_or_else(failure)?;
                let one = SafeU53::new(1).map_err(|_| failure())?;
                let old = next
                    .pokemon
                    .iter_mut()
                    .find(|row| row.pokemon == outgoing)
                    .ok_or_else(failure)?;
                old.turn_count = one;
                old.wave_turn_count = one;
                // SwitchSummon resets temporary data to1 then decrements for
                // currentCommand==POKEMON; TurnEnd later increments the new holder.
                let incoming = next
                    .pokemon
                    .iter_mut()
                    .find(|row| row.pokemon == *pokemon)
                    .ok_or_else(failure)?;
                incoming.turn_count = SafeU53::ZERO;
                incoming.wave_turn_count = SafeU53::ZERO;
                incoming.damage_taken = SafeU53::ZERO;
                incoming.stat_stages_decreased = false;
                incoming.last_reset_turn = battle.turn;
            }
        }
    }
    if !next.valid(next_run) || next.turn != next_battle.turn {
        return Err(failure());
    }
    install(after, next)
}

pub(crate) fn increment_field(
    before: &GameStateV6,
    next: &mut CurrentSourceTurnProgressV1,
) -> Result<(), GameRuntimeV6Error> {
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    let battle = run.battle.as_ref().ok_or_else(failure)?;
    for slot in &battle.field.slots {
        let Some(id) = slot.occupant else {
            continue;
        };
        let pokemon = run
            .party
            .iter()
            .chain(&battle.enemy_party)
            .find(|pokemon| pokemon.id == id)
            .ok_or_else(failure)?;
        if pokemon.fainted || pokemon.hp == 0 {
            continue;
        }
        let row = next
            .pokemon
            .iter_mut()
            .find(|row| row.pokemon == id)
            .ok_or_else(failure)?;
        row.turn_count = add(row.turn_count, 1)?;
        row.wave_turn_count = add(row.wave_turn_count, 1)?;
    }
    Ok(())
}

pub(crate) fn settle_tail(
    before: &GameStateV6,
    after: &mut GameStateV6,
) -> Result<(), GameRuntimeV6Error> {
    let mut next = progress(before)?.clone();
    let run = before.active_run.as_ref().ok_or_else(failure)?;
    if !next.valid(run) || next.turn != run.battle.as_ref().ok_or_else(failure)?.turn {
        return Err(failure());
    }
    increment_field(before, &mut next)?;
    next.turn = after
        .active_run
        .as_ref()
        .and_then(|run| run.battle.as_ref())
        .ok_or_else(failure)?
        .turn;
    if next.turn.get().get()
        != progress(before)?
            .turn
            .get()
            .get()
            .checked_add(1)
            .ok_or_else(failure)?
    {
        return Err(failure());
    }
    install(after, next)
}
