//! Canonical source command-stage random targets, consumed without redrawing.
use er_rng::audit::{RngCallsiteId, RngDraw, RngReason};
use er_rng::battle::RngRuntime;
use er_rng::phaser::RunRngState;
use er_types::battle_command::{AcceptedBattleCommand, BattleCommand, BattleTargetSelection, CommandFrontierStatus};
use er_types::battle_ids::{BattleId, BattleSide, FieldSlot, PokemonId, TurnIndex, WaveIndex};
use er_types::run_ids::GameRunId;
use er_types::SafeU53;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use crate::m7_state::RunStateV3;
use crate::current_turn_execution::CurrentTurnExecutionV1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRandomTargetCommandV1 {
    pub command: AcceptedBattleCommand,
    /// Exact source enumeration before the command-stage draw.
    pub candidates: Vec<(FieldSlot, PokemonId)>,
    pub selected: FieldSlot,
    pub draw: RngDraw,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentRandomTargetCommandsV1 {
    pub run: GameRunId,
    pub battle: BattleId,
    pub wave: WaveIndex,
    pub turn: TurnIndex,
    /// Admission order, not later priority/speed order.
    pub entries: Vec<CurrentRandomTargetCommandV1>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("invalid current command-stage random target proof")]
pub struct CurrentRandomTargetCommandError;

impl CurrentRandomTargetCommandsV1 {
    pub fn validate(
        &self,
        run: &RunStateV3,
        turn: Option<&CurrentTurnExecutionV1>,
    ) -> Result<(), CurrentRandomTargetCommandError> {
        let battle = run.battle.as_ref().ok_or(CurrentRandomTargetCommandError)?;
        if self.run != run.run_id || self.battle != battle.battle_id
            || self.wave != battle.wave || self.turn != battle.turn
            || self.entries.is_empty() || self.entries.len() > 2 {
            return Err(CurrentRandomTargetCommandError);
        }
        for (index, entry) in self.entries.iter().enumerate() {
            let AcceptedBattleCommand::Human { proposal, .. } = &entry.command else {
                return Err(CurrentRandomTargetCommandError);
            };
            proposal.validate().map_err(|_| CurrentRandomTargetCommandError)?;
            if proposal.battle_id != self.battle || proposal.wave != self.wave || proposal.turn != self.turn
                || proposal.field_slot.side != BattleSide::Player
                || !run.party.iter().any(|pokemon| pokemon.id == proposal.actor
                    && pokemon.owner_seat == Some(proposal.owner_seat))
                || !matches!(&proposal.command, BattleCommand::Fight { targets: BattleTargetSelection::Implicit, .. })
                || self.entries[..index].iter().any(|prior| prior.command.operation_id() == entry.command.operation_id()
                    || prior.command.field_slot() == entry.command.field_slot())
                || entry.candidates.is_empty() || entry.candidates.len() > 2
                || entry.candidates.windows(2).any(|pair| pair[0].0 >= pair[1].0)
                || entry.candidates.iter().enumerate().any(|(i, (slot, id))| {
                    slot.side != BattleSide::Enemy || slot.position >= battle.format.enemy_capacity
                        || !battle.enemy_party.iter().any(|pokemon| pokemon.id == *id)
                        || entry.candidates[..i].iter().any(|(prior_slot, prior_id)| prior_slot == slot || prior_id == id)
                }) {
                return Err(CurrentRandomTargetCommandError);
            }
            let expected_candidates = if let Some(owner) = turn {
                let mut candidates = owner.accepted_commands.entries.iter()
                    .filter(|command| command.field_slot().side == BattleSide::Enemy)
                    .map(|command| (command.field_slot(), command.actor()))
                    .collect::<Vec<_>>();
                candidates.sort_by_key(|row| row.0);
                let action = owner.actions.iter().find(|action| action.accepted == entry.command)
                    .ok_or(CurrentRandomTargetCommandError)?;
                if action.current_targets.as_deref() != Some(std::slice::from_ref(&entry.selected)) {
                    return Err(CurrentRandomTargetCommandError);
                }
                candidates
            } else {
                battle.field.slots.iter().filter_map(|row| {
                    if row.slot.side != BattleSide::Enemy { return None; }
                    let id = row.occupant?;
                    battle.enemy_party.iter()
                        .any(|pokemon| pokemon.id == id && pokemon.hp > 0 && !pokemon.fainted)
                        .then_some((row.slot, id))
                }).collect::<Vec<_>>()
            };
            if entry.candidates != expected_candidates {
                return Err(CurrentRandomTargetCommandError);
            }
            let retained = turn.is_some_and(|owner| owner.accepted_commands.entries.contains(&entry.command))
                || battle.command_state.frontier.iter().any(|row| match &row.status {
                    CommandFrontierStatus::Retained { command, .. }
                    | CommandFrontierStatus::Admitted { command, .. } => command == &entry.command,
                    CommandFrontierStatus::Pending => false,
                });
            if !retained {
                return Err(CurrentRandomTargetCommandError);
            }
            entry.draw.validate().map_err(|_| CurrentRandomTargetCommandError)?;
            let before_battle = entry.draw.before_state.battle.as_ref().ok_or(CurrentRandomTargetCommandError)?;
            if before_battle.battle_seed != battle.battle_rng.battle_seed || before_battle.turn != self.turn
                || entry.draw.before_state.run != run.run_rng.rdg
                || entry.draw.after_state.run != run.run_rng.rdg
                || entry.draw.sequence.get() != u64::try_from(index).map_err(|_| CurrentRandomTargetCommandError)?
                || entry.draw.before_state.seed_offset.is_some()
                || entry.draw.callsite_id != RngCallsiteId::current_move_target()
                || entry.draw.cardinality.get() != u64::try_from(entry.candidates.len()).map_err(|_| CurrentRandomTargetCommandError)?
                || entry.draw.minimum != SafeU53::ZERO {
                return Err(CurrentRandomTargetCommandError);
            }
            let mut replay = RngRuntime::from_states_at_sequence(
                RunRngState { rdg: entry.draw.before_state.run.clone() },
                Some(before_battle.clone()), entry.draw.sequence,
            ).map_err(|_| CurrentRandomTargetCommandError)?;
            let selected = replay.battle_rand_seed_int(entry.draw.cardinality, SafeU53::ZERO,
                RngReason::RandomTarget, RngCallsiteId::current_move_target())
                .map_err(|_| CurrentRandomTargetCommandError)?;
            if replay.audit_entries() != std::slice::from_ref(&entry.draw)
                || entry.candidates.get(usize::try_from(selected.get()).map_err(|_| CurrentRandomTargetCommandError)?).map(|row| row.0) != Some(entry.selected)
                || (index > 0 && self.entries[index - 1].draw.after_state != entry.draw.before_state) {
                return Err(CurrentRandomTargetCommandError);
            }
        }
        // Before move execution there has been no later battle-stream draw.
        if turn.is_none() && self.entries.last().and_then(|entry| entry.draw.after_state.battle.as_ref())
            != Some(&battle.battle_rng) {
            return Err(CurrentRandomTargetCommandError);
        }
        Ok(())
    }
}
