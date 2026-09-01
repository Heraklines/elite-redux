//! Deterministic compiler for the complete pinned M9-E progression catalog.

use std::collections::BTreeSet;

use er_progression::content_v2::{
    CaptureBallDefinitionV2, EvolutionConditionV2, EvolutionDefinitionV2, LevelMoveV2,
    PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V2, ProgressionContentPackV2,
    SpeciesProgressionDefinitionV2,
};
use er_progression::{GrowthRateDefinitionV1, NatureDefinitionV1};
use er_types::battle_ids::{MoveId, SpeciesId};
use er_types::battle_model::BattleStat;
use er_types::run_ids::{Experience, GrowthRateId, NatureId};
use er_types::{CatalogHash, EvolutionId, InventoryItemId, OracleSha, SafeU53};
use serde::Deserialize;
use thiserror::Error;

pub const M9_PROGRESSION_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteProgressionDefinitionsV1 {
    schema_version: u32,
    oracle_sha: String,
    special_learnset_levels: SpecialLearnsetLevelsV1,
    stat_names: serde_json::Value,
    evolution_condition_keys: serde_json::Value,
    growth_rates: Vec<RawGrowthRateV1>,
    natures: Vec<RawNatureV1>,
    capture_balls: Vec<RawCaptureBallV1>,
    species: Vec<RawSpeciesProgressionV1>,
    evolutions: Vec<RawEvolutionV1>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SpecialLearnsetLevelsV1 {
    relearn: i16,
    evolution: i16,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawGrowthRateV1 {
    id: u8,
    experience_by_level: Vec<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawNatureV1 {
    id: u8,
    increased_stat: Option<u8>,
    decreased_stat: Option<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCaptureBallV1 {
    item_id: u64,
    registry_key: String,
    catch_multiplier_numerator: u32,
    catch_multiplier_denominator: u32,
    guaranteed: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct RawLevelMoveV1 {
    level: i16,
    move_id: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawSpeciesProgressionV1 {
    species_id: u64,
    form_index: u16,
    form_key: Option<String>,
    growth_rate: u8,
    base_friendship: u16,
    catch_rate: u16,
    level_moves: Vec<RawLevelMoveV1>,
    reminder_moves: Vec<u64>,
    evolution_moves: Vec<u64>,
    tm_moves: Vec<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEvolutionV1 {
    id: u64,
    source_species: u64,
    source_form: Option<u16>,
    source_form_key: Option<String>,
    target_species: u64,
    target_form: u16,
    target_form_key: Option<String>,
    minimum_level: u16,
    evolution_item: u64,
    evolution_item_key: String,
    conditions: Vec<RawEvolutionConditionV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawEvolutionConditionV1 {
    key: u8,
    value: Option<u16>,
    #[serde(default)]
    r#move: Option<u64>,
    time: Option<Vec<u8>>,
    biome: Option<Vec<u64>>,
    gender: Option<u8>,
    #[serde(rename = "pkmnType")]
    pkmn_type: Option<u8>,
    #[serde(rename = "speciesCaught")]
    species_caught: Option<u64>,
    #[serde(rename = "itemKey")]
    item_key: Option<String>,
    nature: Option<Vec<u8>>,
    weather: Option<Vec<u16>>,
    #[serde(rename = "formKey")]
    form_key: Option<String>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ProgressionBuildErrorV1 {
    #[error("progression oracle input is malformed: {0}")]
    Decode(String),
    #[error("progression oracle identity or fixed registry is invalid")]
    Identity,
    #[error("progression oracle contains an invalid value or unresolved reference")]
    Invalid,
    #[error("progression V2 validation failed: {0}")]
    Validation(String),
}

pub fn build_m9_engineering_progression_v2(
    definitions_bytes: &[u8],
    known_species: &BTreeSet<SpeciesId>,
    known_moves: &BTreeSet<MoveId>,
) -> Result<ProgressionContentPackV2, ProgressionBuildErrorV1> {
    let source: CompleteProgressionDefinitionsV1 = serde_json::from_slice(definitions_bytes)
        .map_err(|error| ProgressionBuildErrorV1::Decode(error.to_string()))?;
    if source.schema_version != 1
        || source.oracle_sha != M9_PROGRESSION_ORACLE_SHA
        || source.special_learnset_levels.relearn != -1
        || source.special_learnset_levels.evolution != 0
        || !source.stat_names.is_object()
        || source
            .evolution_condition_keys
            .as_object()
            .is_none_or(|entries| entries.len() != 15)
    {
        return Err(ProgressionBuildErrorV1::Identity);
    }

    let growth_rates = source
        .growth_rates
        .into_iter()
        .map(|entry| {
            if entry.experience_by_level.len() != 100 {
                return Err(ProgressionBuildErrorV1::Invalid);
            }
            Ok(GrowthRateDefinitionV1 {
                id: GrowthRateId::new(entry.id),
                experience_by_level: entry
                    .experience_by_level
                    .into_iter()
                    .map(|value| safe(value).map(Experience::new))
                    .collect::<Result<Vec<_>, _>>()?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let natures = source
        .natures
        .into_iter()
        .map(|entry| {
            Ok(NatureDefinitionV1 {
                id: NatureId::new(entry.id),
                increased_stat: entry.increased_stat.map(battle_stat).transpose()?,
                decreased_stat: entry.decreased_stat.map(battle_stat).transpose()?,
            })
        })
        .collect::<Result<Vec<_>, ProgressionBuildErrorV1>>()?;
    let capture_balls = source
        .capture_balls
        .into_iter()
        .map(|entry| {
            if entry.registry_key.is_empty()
                || entry.catch_multiplier_denominator == 0
                || entry.catch_multiplier_numerator == 0
            {
                return Err(ProgressionBuildErrorV1::Invalid);
            }
            Ok(CaptureBallDefinitionV2 {
                item: InventoryItemId::new(safe(entry.item_id)?),
                registry_key: entry.registry_key,
                catch_multiplier_numerator: entry.catch_multiplier_numerator,
                catch_multiplier_denominator: entry.catch_multiplier_denominator,
                guaranteed: entry.guaranteed,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;

    let evolutions = source
        .evolutions
        .iter()
        .map(compile_evolution)
        .collect::<Result<Vec<_>, _>>()?;
    let species = source
        .species
        .into_iter()
        .map(|entry| compile_species(entry, &evolutions))
        .collect::<Result<Vec<_>, _>>()?;

    let oracle_sha =
        OracleSha::parse(source.oracle_sha).map_err(|_| ProgressionBuildErrorV1::Identity)?;
    let mut pack = ProgressionContentPackV2 {
        schema_version: PROGRESSION_CONTENT_PACK_SCHEMA_VERSION_V2,
        oracle_sha,
        content_hash: CatalogHash::parse("0".repeat(64))
            .map_err(|_| ProgressionBuildErrorV1::Identity)?,
        growth_rates,
        natures,
        capture_balls,
        species,
        evolutions,
    };
    pack.content_hash = pack
        .recompute_hash()
        .map_err(|error| ProgressionBuildErrorV1::Validation(error.to_string()))?;
    pack.validate(known_species, known_moves)
        .map_err(|error| ProgressionBuildErrorV1::Validation(error.to_string()))?;
    Ok(pack)
}

fn compile_species(
    entry: RawSpeciesProgressionV1,
    evolutions: &[EvolutionDefinitionV2],
) -> Result<SpeciesProgressionDefinitionV2, ProgressionBuildErrorV1> {
    let species = SpeciesId::new(safe(entry.species_id)?);
    if entry.evolution_moves.iter().any(|move_id| *move_id == 0) {
        return Err(ProgressionBuildErrorV1::Invalid);
    }
    let _source_form_key = entry.form_key;
    let mut level_moves = entry
        .level_moves
        .into_iter()
        .map(|level_move| {
            Ok(LevelMoveV2 {
                level: level_move.level,
                move_id: MoveId::new(safe(level_move.move_id)?),
            })
        })
        .collect::<Result<Vec<_>, ProgressionBuildErrorV1>>()?;
    let mut seen_level_moves = BTreeSet::new();
    level_moves.retain(|entry| seen_level_moves.insert((entry.level, entry.move_id)));
    let reminder_moves = move_ids(entry.reminder_moves)?;
    let tm_moves = move_ids(entry.tm_moves)?;
    let applicable_evolutions = evolutions
        .iter()
        .filter(|evolution| {
            evolution.source_species == species
                && evolution
                    .source_form
                    .is_none_or(|source_form| source_form == entry.form_index)
        })
        .map(|evolution| evolution.id)
        .collect();
    Ok(SpeciesProgressionDefinitionV2 {
        species,
        form: entry.form_index,
        growth_rate: GrowthRateId::new(entry.growth_rate),
        base_friendship: entry.base_friendship,
        catch_rate: entry.catch_rate,
        level_moves,
        reminder_moves,
        tm_moves,
        evolutions: applicable_evolutions,
    })
}

fn compile_evolution(
    entry: &RawEvolutionV1,
) -> Result<EvolutionDefinitionV2, ProgressionBuildErrorV1> {
    if entry.evolution_item_key.is_empty() {
        return Err(ProgressionBuildErrorV1::Invalid);
    }
    let _source_form_key = entry.source_form_key.as_deref();
    let _target_form_key = entry.target_form_key.as_deref();
    let mut conditions = Vec::new();
    if entry.minimum_level > 1 {
        conditions.push(EvolutionConditionV2::MinimumLevel(entry.minimum_level));
    }
    conditions.extend(
        entry
            .conditions
            .iter()
            .map(compile_condition)
            .collect::<Result<Vec<_>, _>>()?,
    );
    let condition = match conditions.len() {
        0 => EvolutionConditionV2::Always,
        1 => conditions.pop().expect("one condition is present"),
        _ => EvolutionConditionV2::All(conditions),
    };
    let consume_item = if entry.evolution_item == 0 {
        None
    } else {
        let item = entry
            .evolution_item
            .checked_add(1_000)
            .ok_or(ProgressionBuildErrorV1::Invalid)?;
        Some(InventoryItemId::new(safe(item)?))
    };
    Ok(EvolutionDefinitionV2 {
        id: EvolutionId::new(safe(entry.id)?),
        source_species: SpeciesId::new(safe(entry.source_species)?),
        source_form: entry.source_form,
        target_species: SpeciesId::new(safe(entry.target_species)?),
        target_form: entry.target_form,
        consume_item,
        condition,
    })
}

fn compile_condition(
    entry: &RawEvolutionConditionV1,
) -> Result<EvolutionConditionV2, ProgressionBuildErrorV1> {
    let value = match entry.key {
        1 => EvolutionConditionV2::MinimumFriendship(required(entry.value)?),
        2 => any_values(
            required(entry.time.clone())?,
            EvolutionConditionV2::TimeOfDay,
        )?,
        3 => EvolutionConditionV2::KnownMove(MoveId::new(safe(required(entry.r#move)?)?)),
        4 => EvolutionConditionV2::KnownMoveType(required(entry.pkmn_type)?),
        5 => EvolutionConditionV2::PartyType(required(entry.pkmn_type)?),
        6 => any_values(
            required(entry.weather.clone())?,
            EvolutionConditionV2::Weather,
        )?,
        7 => any_values(required(entry.biome.clone())?, EvolutionConditionV2::Biome)?,
        9 => EvolutionConditionV2::Shedinja,
        10 => EvolutionConditionV2::TreasureAtLeast(required(entry.value)?),
        11 => EvolutionConditionV2::RandomForm(required(entry.value)?),
        12 => EvolutionConditionV2::SpeciesCaught(SpeciesId::new(safe(required(
            entry.species_caught,
        )?)?)),
        13 => EvolutionConditionV2::Gender(required(entry.gender)?),
        14 => EvolutionConditionV2::Nature(required(entry.nature.clone())?),
        15 => EvolutionConditionV2::HeldItemKey(required(entry.item_key.clone())?),
        16 => EvolutionConditionV2::FormKey(required(entry.form_key.clone())?),
        _ => return Err(ProgressionBuildErrorV1::Invalid),
    };
    Ok(value)
}

fn any_values<T>(
    values: Vec<T>,
    constructor: impl Fn(T) -> EvolutionConditionV2,
) -> Result<EvolutionConditionV2, ProgressionBuildErrorV1> {
    let mut conditions = values.into_iter().map(constructor).collect::<Vec<_>>();
    match conditions.len() {
        0 => Err(ProgressionBuildErrorV1::Invalid),
        1 => Ok(conditions.pop().expect("one condition is present")),
        _ => Ok(EvolutionConditionV2::Any(conditions)),
    }
}

fn required<T>(value: Option<T>) -> Result<T, ProgressionBuildErrorV1> {
    value.ok_or(ProgressionBuildErrorV1::Invalid)
}

fn move_ids(values: Vec<u64>) -> Result<Vec<MoveId>, ProgressionBuildErrorV1> {
    values
        .into_iter()
        .map(|value| safe(value).map(MoveId::new))
        .collect()
}

fn safe(value: u64) -> Result<SafeU53, ProgressionBuildErrorV1> {
    SafeU53::new(value).map_err(|_| ProgressionBuildErrorV1::Invalid)
}

fn battle_stat(value: u8) -> Result<BattleStat, ProgressionBuildErrorV1> {
    match value {
        1 => Ok(BattleStat::Attack),
        2 => Ok(BattleStat::Defense),
        3 => Ok(BattleStat::SpecialAttack),
        4 => Ok(BattleStat::SpecialDefense),
        5 => Ok(BattleStat::Speed),
        _ => Err(ProgressionBuildErrorV1::Invalid),
    }
}
