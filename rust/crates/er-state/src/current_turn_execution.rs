//! Durable, nonrecursive ownership of an already selected current battle turn.

use er_types::battle_command::{AcceptedBattleCommand, BattleCommand, CommandSet};
use er_types::battle_ids::{BattleId, FieldSlot, MoveId, PokemonId, TurnIndex, WaveIndex};
use er_types::run_ids::GameRunId;
use er_types::{SafeU53, SeatId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_state::RunStateV3;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentTurnActionV1 {
    pub accepted: AcceptedBattleCommand,
    pub command: BattleCommand,
    pub source_slot: FieldSlot,
    pub priority: i8,
    pub effective_speed: u32,
    /// Mutable queued target vector; the accepted command itself is immutable.
    pub current_targets: Option<Vec<FieldSlot>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentFaintMoveSourceV1 {
    pub pokemon: PokemonId,
    pub move_id: MoveId,
    /// Actual pre-action slots only for fallback Struggle, which consumes no PP.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub struggle_pp_before: Option<[Option<er_types::battle_model::MoveSlotState>; 4]>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentTurnFaintV1 {
    pub id: SafeU53,
    pub pokemon: PokemonId,
    pub slot: FieldSlot,
    /// Actual damage hook identity, retained before subsequent PP-dependent lookup.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_move: Option<CurrentFaintMoveSourceV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", deny_unknown_fields)]
pub enum CurrentTurnStageV1 {
    ReadyForMove,
    AwaitingInterlude { faints: Vec<CurrentTurnFaintV1> },
    Complete,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentTurnExecutionV1 {
    pub run: GameRunId,
    pub battle: BattleId,
    pub wave: WaveIndex,
    /// The turn selected at begin, even after exactly-once finalization.
    pub turn: TurnIndex,
    pub authority: SeatId,
    pub authority_revision: SafeU53,
    pub accepted_commands: CommandSet,
    /// The one-time speed shuffle and priority ordering, never recomputed.
    pub actions: Vec<CurrentTurnActionV1>,
    pub next_action: u8,
    pub next_rng_sequence: SafeU53,
    pub next_faint_sequence: SafeU53,
    pub finalization_done: bool,
    pub stage: CurrentTurnStageV1,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("current turn continuation identity or retained action frontier is invalid")]
pub struct CurrentTurnExecutionError;

impl CurrentTurnExecutionV1 {
    pub fn validate(&self, run: &RunStateV3) -> Result<(), CurrentTurnExecutionError> {
        let battle = run.battle.as_ref().ok_or(CurrentTurnExecutionError)?;
        let expected_turn = self
            .turn
            .get()
            .get()
            .checked_add(u64::from(self.finalization_done))
            .ok_or(CurrentTurnExecutionError)?;
        if self.run != run.run_id
            || self.battle != battle.battle_id
            || self.wave != battle.wave
            || self.wave != run.wave
            || self.authority != battle.authority_seat
            || battle.turn.get().get() != expected_turn
            || self.actions.is_empty()
            || self.actions.len() > 6
            || self.actions.len() != self.accepted_commands.entries.len()
            || usize::from(self.next_action) > self.actions.len()
            || (self.finalization_done && usize::from(self.next_action) != self.actions.len())
        {
            return Err(CurrentTurnExecutionError);
        }
        self.accepted_commands
            .validate()
            .map_err(|_| CurrentTurnExecutionError)?;
        for (index, action) in self.actions.iter().enumerate() {
            let (command, battle_id, wave, turn) = match &action.accepted {
                AcceptedBattleCommand::Human { proposal, .. } => (
                    &proposal.command,
                    proposal.battle_id,
                    proposal.wave,
                    proposal.turn,
                ),
                AcceptedBattleCommand::ScriptedEnemy { command, .. } => (
                    &command.command,
                    command.battle_id,
                    command.wave,
                    command.turn,
                ),
            };
            if command != &action.command
                || battle_id != self.battle
                || wave != self.wave
                || turn != self.turn
                || action.source_slot != action.accepted.field_slot()
                || !self.accepted_commands.entries.contains(&action.accepted)
                || self.actions[..index]
                    .iter()
                    .any(|previous| previous.accepted == action.accepted)
                || matches!(
                    (&action.command, &action.current_targets),
                    (BattleCommand::Fight { .. }, None) | (BattleCommand::Switch { .. }, Some(_))
                )
                || action.current_targets.as_ref().is_some_and(|targets| {
                    targets.len() > 6
                        || targets
                            .iter()
                            .enumerate()
                            .any(|(i, slot)| slot.position >= 3 || targets[..i].contains(slot))
                })
            {
                return Err(CurrentTurnExecutionError);
            }
        }
        if self.actions.windows(2).any(|pair| {
            pair[0].priority < pair[1].priority
                || (pair[0].priority == pair[1].priority
                    && pair[0].effective_speed < pair[1].effective_speed)
        }) {
            return Err(CurrentTurnExecutionError);
        }
        match &self.stage {
            CurrentTurnStageV1::ReadyForMove if !self.finalization_done => Ok(()),
            CurrentTurnStageV1::Complete if self.finalization_done => Ok(()),
            CurrentTurnStageV1::AwaitingInterlude { faints }
                if self.next_action > 0
                    && !faints.is_empty()
                    && faints.len() <= 12
                    && faints
                        .windows(2)
                        .all(|pair| pair[0].id.get().checked_add(1) == Some(pair[1].id.get()))
                    && faints.last().is_some_and(|last| {
                        last.id.get().checked_add(1) == Some(self.next_faint_sequence.get())
                    })
                    && faints.iter().all(|faint| {
                        faint.source_move.as_ref().is_none_or(|source| {
                            source.pokemon.get() != SafeU53::ZERO
                                && source.move_id.get() != SafeU53::ZERO
                                && run.party.iter().chain(battle.enemy_party.iter())
                                    .any(|pokemon| {
                                        if pokemon.id != source.pokemon { return false; }
                                        let BattleCommand::Fight { move_slot, .. } = self.actions[usize::from(self.next_action - 1)].command else { return false; };
                                        match &source.struggle_pp_before {
                                            Some(slots) => source.move_id.get().get() == 165 && &pokemon.moves == slots
                                                && slots[usize::from(move_slot.get())].is_some(),
                                            None => pokemon.moves[usize::from(move_slot.get())].as_ref()
                                                .is_some_and(|slot| slot.move_id == source.move_id),
                                        }
                                    })
                                && !self.finalization_done
                                && self.actions[usize::from(self.next_action - 1)].command.actor() == source.pokemon
                                && matches!(self.actions[usize::from(self.next_action - 1)].command, BattleCommand::Fight { .. })
                        })
                            && battle.field.slots.iter().any(|row| row.slot == faint.slot)
                            && match faint.slot.side {
                                er_types::battle_ids::BattleSide::Player => {
                                    run.party.iter().any(|pokemon| pokemon.id == faint.pokemon)
                                }
                                er_types::battle_ids::BattleSide::Enemy => battle
                                    .enemy_party
                                    .iter()
                                    .any(|pokemon| pokemon.id == faint.pokemon),
                            }
                    }) =>
            {
                Ok(())
            }
            _ => Err(CurrentTurnExecutionError),
        }
    }
}
