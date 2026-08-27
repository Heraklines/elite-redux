//! M7 Pokémon lifecycle and progression content.

use std::collections::BTreeMap;
use std::sync::Arc;

use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::run_ids::NatureId;
use er_types::{CatalogHash, EvolutionId, InventoryItemId, OracleSha};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureBallDefinitionV1 {
    pub item: InventoryItemId,
    pub registry_key: String,
    pub catch_multiplier_numerator: u32,
    pub catch_multiplier_denominator: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum EvolutionConditionV1 {
    Level(u16),
    Item(InventoryItemId),
    Friendship(u16),
    KnowsMove(MoveId),
    Biome(er_types::run_ids::BiomeId),
    Mode(er_types::battle_ids::GameModeId),
    Compound(Vec<EvolutionConditionV1>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvolutionDefinitionV1 {
    pub id: EvolutionId,
    pub source_species: SpeciesId,
    pub source_form: u16,
    pub target_species: SpeciesId,
    pub target_form: u16,
    pub conditions: Vec<EvolutionConditionV1>,
    pub consume_item: Option<InventoryItemId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LevelMoveV1 {
    pub level: u16,
    pub move_id: MoveId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesProgressionDefinitionV1 {
    pub species: SpeciesId,
    pub form: u16,
    pub growth_rate: er_types::run_ids::GrowthRateId,
    pub base_friendship: u16,
    pub allowed_natures: Vec<NatureId>,
    pub level_moves: Vec<LevelMoveV1>,
    pub reminder_moves: Vec<MoveId>,
    pub tm_moves: Vec<MoveId>,
    pub evolutions: Vec<EvolutionId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionContentPackV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub capture_balls: Vec<CaptureBallDefinitionV1>,
    pub species: Vec<SpeciesProgressionDefinitionV1>,
    pub evolutions: Vec<EvolutionDefinitionV1>,
}

#[derive(Clone, Debug)]
pub struct PreparedProgressionContentV1 {
    pack: Arc<ProgressionContentPackV1>,
    capture_ball_indexes: BTreeMap<InventoryItemId, usize>,
    species_indexes: BTreeMap<(SpeciesId, u16), usize>,
    evolution_indexes: BTreeMap<EvolutionId, usize>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProgressionContentError {
    #[error("progression content schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("progression content collections must be sorted and unique")]
    NotSortedUnique,
    #[error("capture-ball registry key or ratio is invalid")]
    CaptureBall,
    #[error("species progression definition is invalid")]
    Species,
    #[error("evolution definition is invalid or references unknown content")]
    Evolution,
    #[error("progression content pack is empty")]
    Empty,
}

impl ProgressionContentPackV1 {
    pub fn validate(&self) -> Result<(), ProgressionContentError> {
        if self.schema_version != PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V1 {
            return Err(ProgressionContentError::SchemaVersion {
                expected: PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V1,
                actual: self.schema_version,
            });
        }
        if self.capture_balls.is_empty() || self.species.is_empty() {
            return Err(ProgressionContentError::Empty);
        }
        require_sorted_by(&self.capture_balls, |entry| entry.item)?;
        require_sorted_by(&self.species, |entry| (entry.species, entry.form))?;
        require_sorted_by(&self.evolutions, |entry| entry.id)?;
        for ball in &self.capture_balls {
            if ball.registry_key.is_empty()
                || ball.catch_multiplier_numerator == 0
                || ball.catch_multiplier_denominator == 0
            {
                return Err(ProgressionContentError::CaptureBall);
            }
        }
        let species_keys: std::collections::BTreeSet<_> = self
            .species
            .iter()
            .map(|entry| (entry.species, entry.form))
            .collect();
        let evolution_ids: std::collections::BTreeSet<_> =
            self.evolutions.iter().map(|entry| entry.id).collect();
        for definition in &self.species {
            if definition
                .level_moves
                .windows(2)
                .any(|pair| (pair[0].level, pair[0].move_id) >= (pair[1].level, pair[1].move_id))
                || !strictly_sorted(&definition.reminder_moves)
                || !strictly_sorted(&definition.tm_moves)
                || !strictly_sorted(&definition.allowed_natures)
                || !strictly_sorted(&definition.evolutions)
                || definition
                    .evolutions
                    .iter()
                    .any(|id| !evolution_ids.contains(id))
            {
                return Err(ProgressionContentError::Species);
            }
        }
        for evolution in &self.evolutions {
            if evolution.id == EvolutionId::ZERO
                || evolution.conditions.is_empty()
                || !species_keys.contains(&(evolution.source_species, evolution.source_form))
                || !species_keys.contains(&(evolution.target_species, evolution.target_form))
                || !evolution_conditions_valid(&evolution.conditions)
            {
                return Err(ProgressionContentError::Evolution);
            }
        }
        Ok(())
    }
}

impl PreparedProgressionContentV1 {
    pub fn prepare(pack: Arc<ProgressionContentPackV1>) -> Result<Self, ProgressionContentError> {
        pack.validate()?;
        let capture_ball_indexes = pack
            .capture_balls
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.item, index))
            .collect();
        let species_indexes = pack
            .species
            .iter()
            .enumerate()
            .map(|(index, entry)| ((entry.species, entry.form), index))
            .collect();
        let evolution_indexes = pack
            .evolutions
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.id, index))
            .collect();
        Ok(Self {
            pack,
            capture_ball_indexes,
            species_indexes,
            evolution_indexes,
        })
    }

    pub fn pack(&self) -> &Arc<ProgressionContentPackV1> {
        &self.pack
    }

    pub fn capture_ball(&self, id: InventoryItemId) -> Option<&CaptureBallDefinitionV1> {
        self.capture_ball_indexes
            .get(&id)
            .and_then(|index| self.pack.capture_balls.get(*index))
    }

    pub fn species(
        &self,
        species: SpeciesId,
        form: u16,
    ) -> Option<&SpeciesProgressionDefinitionV1> {
        self.species_indexes
            .get(&(species, form))
            .and_then(|index| self.pack.species.get(*index))
    }

    pub fn evolution(&self, id: EvolutionId) -> Option<&EvolutionDefinitionV1> {
        self.evolution_indexes
            .get(&id)
            .and_then(|index| self.pack.evolutions.get(*index))
    }
}

fn evolution_conditions_valid(conditions: &[EvolutionConditionV1]) -> bool {
    conditions.iter().all(|condition| match condition {
        EvolutionConditionV1::Level(level) => *level > 0,
        EvolutionConditionV1::Friendship(friendship) => *friendship > 0,
        EvolutionConditionV1::Compound(values) => {
            !values.is_empty() && evolution_conditions_valid(values)
        }
        _ => true,
    })
}

fn require_sorted_by<T, K: Ord>(
    values: &[T],
    key: impl Fn(&T) -> K,
) -> Result<(), ProgressionContentError> {
    if values.windows(2).any(|pair| key(&pair[0]) >= key(&pair[1])) {
        return Err(ProgressionContentError::NotSortedUnique);
    }
    Ok(())
}

fn strictly_sorted<T: Ord>(values: &[T]) -> bool {
    !values.windows(2).any(|pair| pair[0] >= pair[1])
}
