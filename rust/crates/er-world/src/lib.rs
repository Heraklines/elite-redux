//! Deterministic M7 modes, routes, encounters, trainers, and bosses.
pub mod runtime;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_types::battle_ids::{AbilityId, GameModeId, MoveId, SpeciesId};
use er_types::run_ids::{BiomeId, EncounterId, RouteNodeId};
use er_types::{CatalogHash, InventoryItemId, OracleSha, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const WORLD_CONTENT_PACK_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum TerminalWavePolicyV1 {
    Exact(u32),
    Interval(u32),
    Never,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameModeDefinitionV1 {
    pub id: GameModeId,
    pub key: String,
    pub first_wave: u32,
    pub terminal_wave: Option<u32>,
    pub terminal_policy: TerminalWavePolicyV1,
    pub difficulty_base_offset: u32,
    pub difficulty_curve_interval: Option<u32>,
    pub route: RouteNodeId,
    pub allows_coop: bool,
    pub branching_routes: bool,
    pub sprint_structure: bool,
    pub finale_routing_start_wave: Option<u32>,
    pub progression_scale: u32,
    pub checkpoint_interval: u32,
    pub major_checkpoint_interval: u32,
    pub mystery_encounter_max_wave: u32,
    pub mystery_encounter_target: u32,
    pub early_move_power_cap_wave: u32,
    pub gym_interval: u32,
    pub story_source_waves: BTreeMap<u32, u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeDefinitionV1 {
    pub id: BiomeId,
    pub key: String,
    pub travel_allowed: bool,
    pub encounters: Vec<WeightedEncounterV1>,
    pub exits: Vec<WeightedRouteV1>,
    pub routing_exits: Vec<BiomeRouteLinkV1>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BiomeRouteLinkV1 {
    pub route: RouteNodeId,
    pub inclusion_denominator: Option<u32>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeightedEncounterV1 {
    pub encounter: EncounterId,
    pub weight: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeightedRouteV1 {
    pub route: RouteNodeId,
    pub weight: u32,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RouteDefinitionV1 {
    pub id: RouteNodeId,
    pub biome: BiomeId,
    pub next: Vec<WeightedRouteV1>,
    pub minimum_wave: u32,
    pub maximum_wave: Option<u32>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PokemonBuildV1 {
    pub species: SpeciesId,
    pub form: u16,
    pub level_offset: i16,
    pub moves: Vec<MoveId>,
    pub active_ability: AbilityId,
    pub passive_abilities: [Option<AbilityId>; 3],
    pub held_items: Vec<InventoryItemId>,
    pub tera_type: Option<er_types::battle_model::PokemonType>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EncounterKindV1 {
    Wild,
    Trainer,
    Boss,
    Scenario,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EncounterDefinitionV1 {
    pub id: EncounterId,
    pub key: String,
    pub kind: EncounterKindV1,
    pub party: Vec<PokemonBuildV1>,
    pub money_reward: SafeU53,
    pub ai_policy_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldContentPackV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub modes: Vec<GameModeDefinitionV1>,
    pub biomes: Vec<BiomeDefinitionV1>,
    pub routes: Vec<RouteDefinitionV1>,
    pub encounters: Vec<EncounterDefinitionV1>,
}

#[derive(Clone, Debug)]
pub struct PreparedWorldContentV1 {
    pack: Arc<WorldContentPackV1>,
    mode_indexes: BTreeMap<GameModeId, usize>,
    biome_indexes: BTreeMap<BiomeId, usize>,
    route_indexes: BTreeMap<RouteNodeId, usize>,
    encounter_indexes: BTreeMap<EncounterId, usize>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum WorldContentError {
    #[error("world content schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("world content collections must be nonempty, sorted, and unique")]
    Collection,
    #[error("world definition has an empty key, invalid bounds, weight, or party")]
    Definition,
    #[error("world definition references unknown content")]
    Reference,
}

impl WorldContentPackV1 {
    pub fn validate(&self) -> Result<(), WorldContentError> {
        if self.schema_version != WORLD_CONTENT_PACK_SCHEMA_VERSION_V1 {
            return Err(WorldContentError::SchemaVersion {
                expected: WORLD_CONTENT_PACK_SCHEMA_VERSION_V1,
                actual: self.schema_version,
            });
        }
        if self.modes.is_empty()
            || self.biomes.is_empty()
            || self.routes.is_empty()
            || self.encounters.is_empty()
            || !sorted_by(&self.modes, |value| value.id)
            || !sorted_by(&self.biomes, |value| value.id)
            || !sorted_by(&self.routes, |value| value.id)
            || !sorted_by(&self.encounters, |value| value.id)
        {
            return Err(WorldContentError::Collection);
        }
        let biomes: BTreeSet<_> = self.biomes.iter().map(|value| value.id).collect();
        let routes: BTreeSet<_> = self.routes.iter().map(|value| value.id).collect();
        let encounters: BTreeSet<_> = self.encounters.iter().map(|value| value.id).collect();
        for mode in &self.modes {
            if mode.key.is_empty()
                || mode.first_wave == 0
                || mode.terminal_wave.is_some_and(|end| end < mode.first_wave)
                || match mode.terminal_policy {
                    TerminalWavePolicyV1::Exact(wave) => {
                        wave == 0 || mode.terminal_wave != Some(wave)
                    }
                    TerminalWavePolicyV1::Interval(interval) => {
                        interval == 0 || mode.terminal_wave.is_some()
                    }
                    TerminalWavePolicyV1::Never => mode.terminal_wave.is_some(),
                }
                || mode
                    .difficulty_curve_interval
                    .is_some_and(|interval| interval == 0)
                || mode.finale_routing_start_wave.is_some_and(|start| {
                    start < mode.first_wave || mode.terminal_wave.is_some_and(|end| start > end)
                })
                || mode.progression_scale == 0
                || mode.checkpoint_interval == 0
                || mode.major_checkpoint_interval == 0
                || mode.mystery_encounter_max_wave == 0
                || mode.early_move_power_cap_wave < 2
                || mode.gym_interval == 0
                || mode
                    .story_source_waves
                    .iter()
                    .any(|(wave, source)| *wave == 0 || *source == 0)
                || !routes.contains(&mode.route)
            {
                return Err(WorldContentError::Definition);
            }
        }
        for biome in &self.biomes {
            if biome.key.is_empty()
                || !weighted_encounters_valid(&biome.encounters, &encounters)
                || !weighted_routes_valid(&biome.exits, &routes)
                || biome.routing_exits.iter().any(|link| {
                    !routes.contains(&link.route)
                        || link
                            .inclusion_denominator
                            .is_some_and(|denominator| denominator == 0)
                })
            {
                return Err(WorldContentError::Definition);
            }
        }
        for route in &self.routes {
            if !biomes.contains(&route.biome)
                || route
                    .maximum_wave
                    .is_some_and(|end| end < route.minimum_wave)
                || !weighted_routes_valid(&route.next, &routes)
            {
                return Err(WorldContentError::Reference);
            }
        }
        for encounter in &self.encounters {
            if encounter.key.is_empty()
                || encounter.ai_policy_key.is_empty()
                || encounter.party.is_empty()
                || encounter.party.iter().any(|build| {
                    build.moves.is_empty()
                        || build.moves.windows(2).any(|pair| pair[0] >= pair[1])
                        || build.held_items.windows(2).any(|pair| pair[0] >= pair[1])
                })
            {
                return Err(WorldContentError::Definition);
            }
        }
        Ok(())
    }
}

impl PreparedWorldContentV1 {
    pub fn prepare(pack: Arc<WorldContentPackV1>) -> Result<Self, WorldContentError> {
        pack.validate()?;
        Ok(Self {
            mode_indexes: indexes(&pack.modes, |value| value.id),
            biome_indexes: indexes(&pack.biomes, |value| value.id),
            route_indexes: indexes(&pack.routes, |value| value.id),
            encounter_indexes: indexes(&pack.encounters, |value| value.id),
            pack,
        })
    }

    pub fn pack(&self) -> &Arc<WorldContentPackV1> {
        &self.pack
    }

    pub fn mode(&self, id: GameModeId) -> Option<&GameModeDefinitionV1> {
        self.mode_indexes
            .get(&id)
            .and_then(|index| self.pack.modes.get(*index))
    }

    pub fn biome(&self, id: BiomeId) -> Option<&BiomeDefinitionV1> {
        self.biome_indexes
            .get(&id)
            .and_then(|index| self.pack.biomes.get(*index))
    }

    pub fn route(&self, id: RouteNodeId) -> Option<&RouteDefinitionV1> {
        self.route_indexes
            .get(&id)
            .and_then(|index| self.pack.routes.get(*index))
    }

    pub fn encounter(&self, id: EncounterId) -> Option<&EncounterDefinitionV1> {
        self.encounter_indexes
            .get(&id)
            .and_then(|index| self.pack.encounters.get(*index))
    }
}

fn indexes<T, K: Ord + Copy>(values: &[T], key: impl Fn(&T) -> K) -> BTreeMap<K, usize> {
    values
        .iter()
        .enumerate()
        .map(|(index, value)| (key(value), index))
        .collect()
}

fn sorted_by<T, K: Ord>(values: &[T], key: impl Fn(&T) -> K) -> bool {
    !values.windows(2).any(|pair| key(&pair[0]) >= key(&pair[1]))
}

fn weighted_encounters_valid(
    values: &[WeightedEncounterV1],
    known: &BTreeSet<EncounterId>,
) -> bool {
    !values.is_empty()
        && values
            .iter()
            .all(|value| value.weight > 0 && known.contains(&value.encounter))
        && values
            .windows(2)
            .all(|pair| pair[0].encounter < pair[1].encounter)
}

fn weighted_routes_valid(values: &[WeightedRouteV1], known: &BTreeSet<RouteNodeId>) -> bool {
    values
        .iter()
        .all(|value| value.weight > 0 && known.contains(&value.route))
        && values.windows(2).all(|pair| pair[0].route < pair[1].route)
}
