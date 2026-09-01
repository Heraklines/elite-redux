//! Faithful M9-E progression content with signed learnset levels and closed evolution conditions.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_canonical::content_digest;
use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::run_ids::GrowthRateId;
use er_types::{CatalogHash, EvolutionId, InventoryItemId, OracleSha};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{GrowthRateDefinitionV1, NatureDefinitionV1};

pub const PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LevelMoveV2 {
    pub level: i16,
    pub move_id: MoveId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum EvolutionConditionV2 {
    Always,
    MinimumLevel(u16),
    MinimumFriendship(u16),
    Gender(u8),
    TimeOfDay(u8),
    KnownMove(MoveId),
    KnownMoveType(u8),
    PartyType(u8),
    PartySpecies(SpeciesId),
    Biome(u64),
    Weather(u16),
    Nature(Vec<u8>),
    HeldItem(InventoryItemId),
    HeldItemKey(String),
    TreasureAtLeast(u16),
    RandomForm(u16),
    SpeciesCaught(SpeciesId),
    FormKey(String),
    Shedinja,
    All(Vec<EvolutionConditionV2>),
    Any(Vec<EvolutionConditionV2>),
    Not(Box<EvolutionConditionV2>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvolutionDefinitionV2 {
    pub id: EvolutionId,
    pub source_species: SpeciesId,
    pub source_form: Option<u16>,
    pub target_species: SpeciesId,
    pub target_form: u16,
    pub consume_item: Option<InventoryItemId>,
    pub condition: EvolutionConditionV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureBallDefinitionV2 {
    pub item: InventoryItemId,
    pub registry_key: String,
    pub catch_multiplier_numerator: u32,
    pub catch_multiplier_denominator: u32,
    pub guaranteed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesProgressionDefinitionV2 {
    pub species: SpeciesId,
    pub form: u16,
    pub growth_rate: GrowthRateId,
    pub base_friendship: u16,
    pub catch_rate: u16,
    pub level_moves: Vec<LevelMoveV2>,
    pub reminder_moves: Vec<MoveId>,
    pub tm_moves: Vec<MoveId>,
    pub evolutions: Vec<EvolutionId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProgressionContentPackV2 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub growth_rates: Vec<GrowthRateDefinitionV1>,
    pub natures: Vec<NatureDefinitionV1>,
    pub capture_balls: Vec<CaptureBallDefinitionV2>,
    pub species: Vec<SpeciesProgressionDefinitionV2>,
    pub evolutions: Vec<EvolutionDefinitionV2>,
}

#[derive(Clone, Debug)]
pub struct PreparedProgressionContentV2 {
    pack: Arc<ProgressionContentPackV2>,
    species: BTreeMap<(SpeciesId, u16), usize>,
    evolutions: BTreeMap<EvolutionId, usize>,
    capture_balls: BTreeMap<InventoryItemId, usize>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProgressionContentV2Error {
    #[error("progression V2 schema, oracle, or content hash is invalid")]
    Identity,
    #[error("progression V2 collections are empty, unsorted, duplicated, or malformed")]
    Closure,
    #[error("progression V2 references unknown battle content")]
    CrossReference,
    #[error("progression V2 evolution condition is malformed")]
    Condition,
    #[error("progression V2 canonical hashing failed: {0}")]
    Hash(String),
}

#[derive(Serialize)]
struct ProgressionHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    growth_rates: &'a [GrowthRateDefinitionV1],
    natures: &'a [NatureDefinitionV1],
    capture_balls: &'a [CaptureBallDefinitionV2],
    species: &'a [SpeciesProgressionDefinitionV2],
    evolutions: &'a [EvolutionDefinitionV2],
}

impl ProgressionContentPackV2 {
    pub fn recompute_hash(&self) -> Result<CatalogHash, ProgressionContentV2Error> {
        let digest = content_digest(&ProgressionHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            growth_rates: &self.growth_rates,
            natures: &self.natures,
            capture_balls: &self.capture_balls,
            species: &self.species,
            evolutions: &self.evolutions,
        })
        .map_err(|error| ProgressionContentV2Error::Hash(error.to_string()))?;
        CatalogHash::parse(digest)
            .map_err(|error| ProgressionContentV2Error::Hash(error.to_string()))
    }

    pub fn validate(
        &self,
        known_species: &BTreeSet<SpeciesId>,
        known_moves: &BTreeSet<MoveId>,
    ) -> Result<(), ProgressionContentV2Error> {
        if self.schema_version != PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V2
            || self.content_hash != self.recompute_hash()?
        {
            return Err(ProgressionContentV2Error::Identity);
        }
        if self.growth_rates.is_empty()
            || self.natures.is_empty()
            || self.capture_balls.is_empty()
            || self.species.is_empty()
            || self
                .growth_rates
                .windows(2)
                .any(|pair| pair[0].id >= pair[1].id)
            || self.natures.windows(2).any(|pair| pair[0].id >= pair[1].id)
            || self
                .capture_balls
                .windows(2)
                .any(|pair| pair[0].item >= pair[1].item)
            || self
                .species
                .windows(2)
                .any(|pair| (pair[0].species, pair[0].form) >= (pair[1].species, pair[1].form))
            || self
                .evolutions
                .windows(2)
                .any(|pair| pair[0].id >= pair[1].id)
        {
            return Err(ProgressionContentV2Error::Closure);
        }
        let growth_ids = self
            .growth_rates
            .iter()
            .map(|entry| entry.id)
            .collect::<BTreeSet<_>>();
        let evolution_ids = self
            .evolutions
            .iter()
            .map(|entry| entry.id)
            .collect::<BTreeSet<_>>();
        for definition in &self.species {
            if !known_species.contains(&definition.species)
                || !growth_ids.contains(&definition.growth_rate)
                || has_duplicates(&definition.level_moves)
                || has_duplicates(&definition.reminder_moves)
                || has_duplicates(&definition.tm_moves)
                || has_duplicates(&definition.evolutions)
                || definition
                    .level_moves
                    .iter()
                    .any(|entry| !known_moves.contains(&entry.move_id))
                || definition
                    .reminder_moves
                    .iter()
                    .chain(&definition.tm_moves)
                    .any(|move_id| !known_moves.contains(move_id))
                || definition
                    .evolutions
                    .iter()
                    .any(|id| !evolution_ids.contains(id))
            {
                return Err(ProgressionContentV2Error::CrossReference);
            }
        }
        for evolution in &self.evolutions {
            if !known_species.contains(&evolution.source_species)
                || !known_species.contains(&evolution.target_species)
            {
                return Err(ProgressionContentV2Error::CrossReference);
            }
            validate_condition(&evolution.condition, known_species, known_moves)?;
        }
        Ok(())
    }

    pub fn prepare(
        self,
        known_species: &BTreeSet<SpeciesId>,
        known_moves: &BTreeSet<MoveId>,
    ) -> Result<PreparedProgressionContentV2, ProgressionContentV2Error> {
        self.validate(known_species, known_moves)?;
        let species = self
            .species
            .iter()
            .enumerate()
            .map(|(index, value)| ((value.species, value.form), index))
            .collect();
        let evolutions = self
            .evolutions
            .iter()
            .enumerate()
            .map(|(index, value)| (value.id, index))
            .collect();
        let capture_balls = self
            .capture_balls
            .iter()
            .enumerate()
            .map(|(index, value)| (value.item, index))
            .collect();
        Ok(PreparedProgressionContentV2 {
            pack: Arc::new(self),
            species,
            evolutions,
            capture_balls,
        })
    }
}

impl PreparedProgressionContentV2 {
    pub fn pack(&self) -> &ProgressionContentPackV2 {
        &self.pack
    }

    pub fn species(
        &self,
        species: SpeciesId,
        form: u16,
    ) -> Option<&SpeciesProgressionDefinitionV2> {
        self.species
            .get(&(species, form))
            .and_then(|index| self.pack.species.get(*index))
    }

    pub fn evolution(&self, id: EvolutionId) -> Option<&EvolutionDefinitionV2> {
        self.evolutions
            .get(&id)
            .and_then(|index| self.pack.evolutions.get(*index))
    }

    pub fn capture_ball(&self, id: InventoryItemId) -> Option<&CaptureBallDefinitionV2> {
        self.capture_balls
            .get(&id)
            .and_then(|index| self.pack.capture_balls.get(*index))
    }

    pub fn growth_rate(&self, id: GrowthRateId) -> Option<&GrowthRateDefinitionV1> {
        self.pack.growth_rates.iter().find(|entry| entry.id == id)
    }
}

fn validate_condition(
    condition: &EvolutionConditionV2,
    known_species: &BTreeSet<SpeciesId>,
    known_moves: &BTreeSet<MoveId>,
) -> Result<(), ProgressionContentV2Error> {
    let valid = match condition {
        EvolutionConditionV2::Always => true,
        EvolutionConditionV2::MinimumLevel(value)
        | EvolutionConditionV2::MinimumFriendship(value) => *value > 0,
        EvolutionConditionV2::Gender(_)
        | EvolutionConditionV2::TimeOfDay(_)
        | EvolutionConditionV2::KnownMoveType(_)
        | EvolutionConditionV2::PartyType(_)
        | EvolutionConditionV2::Biome(_)
        | EvolutionConditionV2::Weather(_)
        | EvolutionConditionV2::HeldItem(_)
        | EvolutionConditionV2::Shedinja => true,
        EvolutionConditionV2::KnownMove(move_id) => known_moves.contains(move_id),
        EvolutionConditionV2::PartySpecies(species)
        | EvolutionConditionV2::SpeciesCaught(species) => known_species.contains(species),
        EvolutionConditionV2::Nature(values) => !values.is_empty(),
        EvolutionConditionV2::HeldItemKey(key) | EvolutionConditionV2::FormKey(key) => {
            !key.is_empty()
        }
        EvolutionConditionV2::TreasureAtLeast(value) | EvolutionConditionV2::RandomForm(value) => {
            *value > 0
        }
        EvolutionConditionV2::All(values) | EvolutionConditionV2::Any(values) => {
            !values.is_empty()
                && values
                    .iter()
                    .all(|value| validate_condition(value, known_species, known_moves).is_ok())
        }
        EvolutionConditionV2::Not(value) => {
            validate_condition(value, known_species, known_moves).is_ok()
        }
    };
    if valid {
        Ok(())
    } else {
        Err(ProgressionContentV2Error::Condition)
    }
}

fn has_duplicates<T: PartialEq>(values: &[T]) -> bool {
    values
        .iter()
        .enumerate()
        .any(|(index, value)| values[index + 1..].contains(value))
}
