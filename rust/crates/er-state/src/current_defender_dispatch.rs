//! Narrow bookkeeping for observed current Poison Absorb (5082) dispatches.
//!
//! This is NOT a complete source abilitiesApplied history. Other ability IDs,
//! including preexisting source 5097, remain unknown/unowned here. A consumer
//! requiring full source histories must use a separately proven broader owner.
//! None means no tracked dispatch, not a known empty source history.

use er_types::battle_ids::{BattleId, PokemonId, TurnIndex, WaveIndex};
use er_types::run_ids::GameRunId;
use er_types::{OperationId, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_state::RunStateV3;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentDefenderActionV1 {
    pub operation_id: OperationId,
    pub authority_revision: SafeU53,
    pub battle_id: BattleId,
    pub turn: TurnIndex,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentDefenderHolderV1 {
    pub pokemon: PokemonId,
    /// Observed since tracked_since, never an assertion about earlier source use.
    pub wave_observed: bool,
    /// Reset only at an actual summon/switch boundary or new wave.
    pub summon_observed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentDefenderDispatchV1 {
    pub run_id: GameRunId,
    pub wave: WaveIndex,
    pub tracked_since: CurrentDefenderActionV1,
    pub last_action: CurrentDefenderActionV1,
    /// Strictly PokemonId-ordered current-roster observations; bounded by roster.
    pub holders: Vec<CurrentDefenderHolderV1>,
}

/// Adapter inputs must come from the actual ordered battle cue stream. The cue
/// ordinal binds a real emission, not a synthetic gameplay operation or timer.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CurrentDefenderObservationV1 {
    Applied {
        ordinal: u16,
        holder: PokemonId,
        innate_slot: Option<u8>,
    },
    Summoned {
        ordinal: u16,
        holder: PokemonId,
    },
}

impl CurrentDefenderObservationV1 {
    fn ordinal(self) -> u16 {
        match self {
            Self::Applied { ordinal, .. } | Self::Summoned { ordinal, .. } => ordinal,
        }
    }
    fn holder(self) -> PokemonId {
        match self {
            Self::Applied { holder, .. } | Self::Summoned { holder, .. } => holder,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[error("invalid or duplicated current defender dispatch observation")]
pub struct CurrentDefenderDispatchError;

impl CurrentDefenderDispatchV1 {
    pub fn validate(&self, run: &RunStateV3) -> Result<(), CurrentDefenderDispatchError> {
        if self.run_id != run.run_id || self.wave != run.wave
            || self.tracked_since.operation_id.as_str().is_empty()
            || self.last_action.operation_id.as_str().is_empty()
            || self.tracked_since.authority_revision > self.last_action.authority_revision
            // Actual outer material r installs its next control at r+1 before
            // dispatch folding. A restored owner cannot claim a future receipt.
            || self.last_action.authority_revision >= run.control.revision
            || self.holders.windows(2).any(|pair| pair[0].pokemon >= pair[1].pokemon)
        {
            return Err(CurrentDefenderDispatchError);
        }
        for holder in &self.holders {
            if !in_roster(run, holder.pokemon) || (!holder.wave_observed && holder.summon_observed)
            {
                return Err(CurrentDefenderDispatchError);
            }
        }
        Ok(())
    }

    /// Synchronize only represented lifecycle boundaries. This does not invent
    /// an observation when the source history was previously unowned.
    pub fn synchronize(&mut self, run: &RunStateV3) -> Result<(), CurrentDefenderDispatchError> {
        if self.run_id != run.run_id {
            return Err(CurrentDefenderDispatchError);
        }
        if self.wave != run.wave {
            self.wave = run.wave;
            self.holders.clear();
        }
        self.holders.retain(|holder| in_roster(run, holder.pokemon));
        self.validate(run)
    }

    /// Fold one actual resolver action/turn receipt. Material replay does not
    /// invoke this again: common material application owns its idempotence.
    /// Reusing an action identity here is a programming/protocol error, rejected
    /// atomically rather than adding another apparent source dispatch.
    pub fn observe(
        previous: Option<&Self>,
        before: &RunStateV3,
        after: &RunStateV3,
        operation_id: &OperationId,
        authority_revision: SafeU53,
        observations: &[CurrentDefenderObservationV1],
    ) -> Result<Option<Self>, CurrentDefenderDispatchError> {
        if before.run_id != after.run_id {
            return Err(CurrentDefenderDispatchError);
        }
        // A begin/finalize or no-ability continuation chunk has no dispatch to
        // identify. Preserve its bookkeeping identity, while applying only actual
        // roster/wave lifecycle changes. The retained turn revision is not a new
        // material revision and must never be used to manufacture an observation.
        if observations.is_empty() {
            return previous
                .map(|previous| {
                    previous.validate(before)?;
                    let mut result = previous.clone();
                    result.synchronize(after)?;
                    Ok(result)
                })
                .transpose();
        }
        let battle = before.battle.as_ref().ok_or(CurrentDefenderDispatchError)?;
        if operation_id.as_str().is_empty()
            || observations
                .windows(2)
                .any(|pair| pair[0].ordinal() >= pair[1].ordinal())
        {
            return Err(CurrentDefenderDispatchError);
        }
        // Each active participant can apply to each field slot and can summon
        // once in the same command set. This is a live topology-derived bound.
        let slots = battle.field.slots.len();
        let maximum = slots
            .checked_mul(slots.checked_add(1).ok_or(CurrentDefenderDispatchError)?)
            .ok_or(CurrentDefenderDispatchError)?;
        if observations.len() > maximum {
            return Err(CurrentDefenderDispatchError);
        }
        for event in observations {
            if !in_roster(before, event.holder()) && !in_roster(after, event.holder()) {
                return Err(CurrentDefenderDispatchError);
            }
            if let CurrentDefenderObservationV1::Applied {
                innate_slot: Some(slot),
                ..
            } = event
            {
                if *slot > 2 {
                    return Err(CurrentDefenderDispatchError);
                }
            }
        }
        let action = CurrentDefenderActionV1 {
            operation_id: operation_id.clone(),
            authority_revision,
            battle_id: battle.battle_id,
            turn: battle.turn,
        };
        let any_applied = observations
            .iter()
            .any(|event| matches!(event, CurrentDefenderObservationV1::Applied { .. }));
        let mut result = match previous {
            Some(previous) => {
                previous.validate(before)?;
                if previous.last_action.operation_id == *operation_id
                    || authority_revision <= previous.last_action.authority_revision
                {
                    return Err(CurrentDefenderDispatchError);
                }
                previous.clone()
            }
            None if any_applied => Self {
                run_id: before.run_id,
                wave: before.wave,
                tracked_since: action.clone(),
                last_action: action.clone(),
                holders: Vec::new(),
            },
            None => return Ok(None),
        };
        // Fold in exact cue order, before clearing a possible new-wave owner.
        for event in observations {
            match *event {
                CurrentDefenderObservationV1::Applied { holder, .. } => {
                    let position = match result
                        .holders
                        .binary_search_by_key(&holder, |row| row.pokemon)
                    {
                        Ok(position) => position,
                        Err(position) => {
                            result.holders.insert(
                                position,
                                CurrentDefenderHolderV1 {
                                    pokemon: holder,
                                    wave_observed: false,
                                    summon_observed: false,
                                },
                            );
                            position
                        }
                    };
                    result.holders[position].wave_observed = true;
                    result.holders[position].summon_observed = true;
                }
                CurrentDefenderObservationV1::Summoned { holder, .. } => {
                    if let Ok(position) = result
                        .holders
                        .binary_search_by_key(&holder, |row| row.pokemon)
                    {
                        result.holders[position].summon_observed = false;
                    }
                }
            }
        }
        result.last_action = action;
        result.synchronize(after)?;
        Ok(Some(result))
    }
}

fn in_roster(run: &RunStateV3, id: PokemonId) -> bool {
    run.party.iter().any(|pokemon| pokemon.id == id)
        || run
            .battle
            .as_ref()
            .is_some_and(|battle| battle.enemy_party.iter().any(|pokemon| pokemon.id == id))
}
