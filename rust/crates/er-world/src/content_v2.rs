//! Faithful M9-E world content preserving biome pool dimensions.

use std::collections::BTreeSet;

use er_canonical::content_digest;
use er_types::battle_ids::{GameModeId, SpeciesId};
use er_types::run_ids::BiomeId;
use er_types::{CatalogHash, OracleSha, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const WORLD_CONTENT_PACK_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameModeDefinitionV2 {
    pub id: GameModeId,
    pub key: String,
    pub starting_level: u16,
    pub starting_money: SafeU53,
    pub starting_biome: BiomeId,
    pub challenge_selection: bool,
    pub cooperative: bool,
    pub supported: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeSpeciesPoolV2 {
    pub tier: i16,
    pub time_of_day: i16,
    pub species: Vec<SpeciesId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeTrainerPoolV2 {
    pub tier: i16,
    pub trainer_types: Vec<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeightedOracleCodeV2 {
    pub code: u16,
    pub weight: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeLinkV2 {
    pub biome: BiomeId,
    pub weight: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeDefinitionV2 {
    pub id: BiomeId,
    pub key: String,
    pub pokemon_pools: Vec<BiomeSpeciesPoolV2>,
    pub trainer_pools: Vec<BiomeTrainerPoolV2>,
    pub trainer_chance_denominator: u32,
    pub weather_pool: Vec<WeightedOracleCodeV2>,
    pub terrain_pool: Vec<WeightedOracleCodeV2>,
    pub links: Vec<BiomeLinkV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldContentPackV2 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub modes: Vec<GameModeDefinitionV2>,
    pub biomes: Vec<BiomeDefinitionV2>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum WorldContentV2Error {
    #[error("world V2 schema, identity, or content hash is invalid")]
    Identity,
    #[error("world V2 modes are empty, unsorted, duplicated, or malformed")]
    Modes,
    #[error("world V2 biome pools, weights, or links are malformed")]
    Biomes,
    #[error("world V2 references unknown biome or battle species")]
    CrossReference,
    #[error("world V2 canonical hashing failed: {0}")]
    Hash(String),
}

#[derive(Serialize)]
struct WorldHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    modes: &'a [GameModeDefinitionV2],
    biomes: &'a [BiomeDefinitionV2],
}

impl WorldContentPackV2 {
    pub fn recompute_hash(&self) -> Result<CatalogHash, WorldContentV2Error> {
        let digest = content_digest(&WorldHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            modes: &self.modes,
            biomes: &self.biomes,
        })
        .map_err(|error| WorldContentV2Error::Hash(error.to_string()))?;
        CatalogHash::parse(digest).map_err(|error| WorldContentV2Error::Hash(error.to_string()))
    }

    pub fn validate(&self, known_species: &BTreeSet<SpeciesId>) -> Result<(), WorldContentV2Error> {
        if self.schema_version != WORLD_CONTENT_PACK_SCHEMA_VERSION_V2
            || self.content_hash != self.recompute_hash()?
        {
            return Err(WorldContentV2Error::Identity);
        }
        if self.modes.is_empty()
            || self.modes.windows(2).any(|pair| pair[0].id >= pair[1].id)
            || self
                .modes
                .iter()
                .any(|mode| mode.key.is_empty() || mode.starting_level == 0)
        {
            return Err(WorldContentV2Error::Modes);
        }
        if self.biomes.is_empty() || self.biomes.windows(2).any(|pair| pair[0].id >= pair[1].id) {
            return Err(WorldContentV2Error::Biomes);
        }
        let biome_ids = self
            .biomes
            .iter()
            .map(|biome| biome.id)
            .collect::<BTreeSet<_>>();
        if self
            .modes
            .iter()
            .any(|mode| !biome_ids.contains(&mode.starting_biome))
        {
            return Err(WorldContentV2Error::CrossReference);
        }
        for biome in &self.biomes {
            if biome.key.is_empty()
                || biome.pokemon_pools.is_empty()
                || biome.weather_pool.is_empty()
                || biome.terrain_pool.is_empty()
                || biome.pokemon_pools.windows(2).any(|pair| {
                    (pair[0].tier, pair[0].time_of_day) >= (pair[1].tier, pair[1].time_of_day)
                })
                || biome
                    .trainer_pools
                    .windows(2)
                    .any(|pair| pair[0].tier >= pair[1].tier)
                || !unique_pool_members(&biome.pokemon_pools)
                || !unique_trainer_members(&biome.trainer_pools)
                || !weighted_codes_valid(&biome.weather_pool)
                || !weighted_codes_valid(&biome.terrain_pool)
                || biome
                    .links
                    .iter()
                    .any(|link| link.weight == 0 || !biome_ids.contains(&link.biome))
                || biome
                    .links
                    .windows(2)
                    .any(|pair| pair[0].biome >= pair[1].biome)
            {
                return Err(WorldContentV2Error::Biomes);
            }
            if biome
                .pokemon_pools
                .iter()
                .flat_map(|pool| &pool.species)
                .any(|species| !known_species.contains(species))
            {
                return Err(WorldContentV2Error::CrossReference);
            }
        }
        Ok(())
    }
}

fn unique_pool_members(pools: &[BiomeSpeciesPoolV2]) -> bool {
    pools.iter().all(|pool| {
        !pool.species.is_empty()
            && pool
                .species
                .iter()
                .enumerate()
                .all(|(index, value)| !pool.species[index + 1..].contains(value))
    })
}

fn unique_trainer_members(pools: &[BiomeTrainerPoolV2]) -> bool {
    pools.iter().all(|pool| {
        pool.trainer_types
            .iter()
            .enumerate()
            .all(|(index, value)| !pool.trainer_types[index + 1..].contains(value))
    })
}

fn weighted_codes_valid(entries: &[WeightedOracleCodeV2]) -> bool {
    !entries.is_empty()
        && entries.iter().all(|entry| entry.weight > 0)
        && entries.windows(2).all(|pair| pair[0].code < pair[1].code)
}
