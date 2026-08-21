//! Typed M4 encounter plan consumed by `BattleStartV2`.
//!
//! The plan is transaction-local evidence: it is excluded from the mechanical
//! digest until it folds into material `after_state` as a complete battle
//! (`rust/contracts/m4-api.md`, digest domains). The game root keeps the sole
//! player-party copy; this structure owns only encounter enemies.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use er_state::pokemon_v2::PokemonStateV2;
use er_types::battle_command::ScriptedEnemyPolicyV1;
use er_types::battle_ids::{BattleFormat, PokemonId, WaveIndex};
use er_types::run_ids::{BiomeId, EncounterId, GameRunId, RunContentPackHash};

use crate::content::EncounterPlanSource;
use crate::rng_audit::RunRngDraw;

pub const ENCOUNTER_PLAN_SCHEMA_VERSION: u32 = 1;

/// The complete authority-prepared input for one battle start.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncounterPlan {
    pub schema_version: u32,
    pub encounter_id: EncounterId,
    pub run_id: GameRunId,
    pub wave: WaveIndex,
    pub biome: BiomeId,
    pub format: BattleFormat,
    /// Encounter-owned enemy party. Player party stays game-owned.
    pub enemy_party: Vec<PokemonStateV2>,
    /// Stable enemy IDs occupying the initial enemy field slots.
    pub enemy_leads: Vec<PokemonId>,
    /// Stable player roster IDs occupying the initial player field slots.
    pub player_leads: Vec<PokemonId>,
    pub scripted_policy: ScriptedEnemyPolicyV1,
    pub battle_seed: String,
    pub generation_audit: Vec<RunRngDraw>,
    pub source: EncounterPlanSource,
    /// Content identity the captured vector was exported against.
    pub content_hash: Option<RunContentPackHash>,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum EncounterPlanError {
    #[error("encounter plan schema version must be {expected}, got {actual}")]
    SchemaVersionMismatch { expected: u32, actual: u32 },
    #[error("encounter plan enemy leads reference unknown enemy {0:?}")]
    UnknownEnemyLead(PokemonId),
    #[error("encounter plan battle seed must not be empty")]
    EmptyBattleSeed,
    #[error("encounter plan enemy party exceeds its declared format capacity")]
    EnemyPartyOverCapacity,
    #[error("encounter plan enemy lead count {leads} exceeds format capacity {capacity}")]
    EnemyLeadsOverCapacity { leads: usize, capacity: usize },
    #[error("encounter plan player lead count {leads} exceeds format capacity {capacity}")]
    PlayerLeadsOverCapacity { leads: usize, capacity: usize },
    #[error("encounter plan generation audit sequences are not contiguous")]
    NonContiguousGenerationAudit,
}

impl EncounterPlan {
    /// Validates structural invariants that hold without live content.
    ///
    /// Party-member and policy validation against loaded content happens at
    /// battle start, where the full content bundle is available.
    pub fn validate(&self) -> Result<(), EncounterPlanError> {
        if self.schema_version != ENCOUNTER_PLAN_SCHEMA_VERSION {
            return Err(EncounterPlanError::SchemaVersionMismatch {
                expected: ENCOUNTER_PLAN_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.battle_seed.is_empty() {
            return Err(EncounterPlanError::EmptyBattleSeed);
        }
        let enemy_ids: BTreeSet<_> = self.enemy_party.iter().map(|record| record.id).collect();
        for lead in &self.enemy_leads {
            if !enemy_ids.contains(lead) {
                return Err(EncounterPlanError::UnknownEnemyLead(*lead));
            }
        }
        if usize::from(self.format.enemy_capacity) < self.enemy_party.len() {
            return Err(EncounterPlanError::EnemyPartyOverCapacity);
        }
        if usize::from(self.format.enemy_capacity) < self.enemy_leads.len() {
            return Err(EncounterPlanError::EnemyLeadsOverCapacity {
                leads: self.enemy_leads.len(),
                capacity: usize::from(self.format.enemy_capacity),
            });
        }
        if usize::from(self.format.player_capacity) < self.player_leads.len() {
            return Err(EncounterPlanError::PlayerLeadsOverCapacity {
                leads: self.player_leads.len(),
                capacity: usize::from(self.format.player_capacity),
            });
        }
        let mut expected_sequence = None;
        for draw in &self.generation_audit {
            match expected_sequence {
                Some(expected) if draw.sequence.get() != expected => {
                    return Err(EncounterPlanError::NonContiguousGenerationAudit);
                }
                _ => {}
            }
            expected_sequence = Some(
                draw.sequence
                    .get()
                    .checked_add(1)
                    .ok_or(EncounterPlanError::NonContiguousGenerationAudit)?,
            );
        }
        Ok(())
    }
}
