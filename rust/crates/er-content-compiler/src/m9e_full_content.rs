//! M9-E complete pinned battle-definition and semantic-closure compiler.

use std::collections::{BTreeMap, BTreeSet};

use er_content::m6_catalog::{CatalogResolution, SemanticCatalogV1};
use er_content::pack::m6_pack::{
    AbilityDefinitionV3, AbilitySlotDefinitionV1, BattleContentPackV3, FieldContentV1,
    FormDefinitionV1, FormTransformationPolicyV1, HeldItemDefinitionV3, MoveDefinitionV3,
    SpeciesDefinitionV3, StatusDefinitionV2, TagDefinitionV2, TerrainDefinitionV2,
    WeatherDefinitionV2,
};
use er_content::pack::{TypeChart, TypeChartEntry};
use er_content::species::SpeciesBaseStats;
use er_game::m9e_content_v2::{
    BOOTSTRAP_CONTENT_SCHEMA_VERSION_V1, BootstrapContentPackV1, BootstrapModeDefinitionV2,
    LevelMoveDefinitionV1, StarterDefinitionV2,
};
use er_types::battle_ids::{AbilityId, GameModeId, MoveId, SpeciesId};
use er_types::battle_model::{
    EffectChance, MoveAccuracy, MoveCategory, MoveFlag, MovePower, MoveTarget, PokemonType,
    PokemonTyping, SingleTypeMultiplier,
};
use er_types::run_ids::BiomeId;
use er_types::{
    BehaviorSourceId, BehaviorUnitId, BespokeMechanicId, CatalogHash, FormId, MechanicsProgramId,
    RunDifficultyV1, SafeU53,
};
use er_world::content_v2::{
    BiomeDefinitionV2, BiomeLinkV2, BiomeSpeciesPoolV2, BiomeTrainerPoolV2, GameModeDefinitionV2,
    WORLD_CONTENT_PACK_SCHEMA_VERSION_V2, WeightedOracleCodeV2, WorldContentPackV2,
};
use serde::Deserialize;
use thiserror::Error;

use crate::m6::{
    BattleContentDefinitionsV3, BespokeAssignment, CompilerOptions, IntrinsicRule,
    SemanticCatalogInput, SemanticCompileRequest, ValidatedSemanticCatalog,
    assemble_battle_content_pack_v3, compile_semantics,
};

pub const M9_ENGINEERING_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteBattleDefinitionsV1 {
    schema_version: u32,
    oracle_sha: String,
    modes: Vec<CompleteModeV1>,
    biomes: Vec<CompleteBiomeV2>,
    species: Vec<CompleteSpeciesV1>,
    moves: Vec<CompleteMoveV1>,
    abilities: Vec<CompleteAbilityV1>,
    type_chart: Vec<CompleteTypeChartEntryV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteModeV1 {
    mode_id: u64,
    key: String,
    starting_level: u16,
    starting_money: u64,
    starting_biome_id: u64,
    challenge_selection: bool,
    cooperative: bool,
    supported: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteBiomeV2 {
    biome_id: u64,
    key: String,
    pokemon_pools: Vec<CompletePokemonPoolV2>,
    trainer_pools: Vec<CompleteTrainerPoolV2>,
    trainer_chance_denominator: u32,
    weather_pool: Vec<CompleteWeightedCodeV2>,
    terrain_pool: Vec<CompleteWeightedCodeV2>,
    links: Vec<CompleteBiomeLinkV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompletePokemonPoolV2 {
    tier: i16,
    time_of_day: i16,
    species: Vec<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteTrainerPoolV2 {
    tier: i16,
    trainer_types: Vec<u32>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteWeightedCodeV2 {
    code: u16,
    weight: u32,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteBiomeLinkV2 {
    biome_id: u64,
    weight: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteSpeciesV1 {
    species_id: u64,
    canonical_form_index: u16,
    starter_cost: Option<u16>,
    #[serde(rename = "growth_rate")]
    _growth_rate: u16,
    #[serde(rename = "catch_rate")]
    _catch_rate: u16,
    #[serde(rename = "base_friendship")]
    _base_friendship: u16,
    passive_ability_ids: Vec<u64>,
    level_moves: Vec<CompleteLevelMoveV1>,
    forms: Vec<CompleteFormV1>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(deny_unknown_fields)]
struct CompleteLevelMoveV1 {
    level: i16,
    move_id: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteFormV1 {
    form_index: u16,
    base_stats: [u32; 6],
    type_names: Vec<PokemonType>,
    weight_hectograms: u32,
    active_ability_ids: [u64; 3],
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteMoveV1 {
    id: u64,
    #[allow(dead_code)]
    name: String,
    category: MoveCategory,
    move_type: PokemonType,
    power: MovePower,
    accuracy: MoveAccuracy,
    base_pp: u16,
    effect_chance: EffectChance,
    priority: i8,
    target: MoveTarget,
    flags: Vec<MoveFlag>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteAbilityV1 {
    id: u64,
    #[allow(dead_code)]
    name: String,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct CompleteTypeChartEntryV1 {
    attack: PokemonType,
    defense: PokemonType,
    multiplier: SingleTypeMultiplier,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BespokeClusterDocumentV1 {
    schema_version: u32,
    oracle_sha: String,
    clusters: Vec<BespokeClusterV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BespokeClusterV1 {
    cluster: BespokeMechanicId,
    behavior_units: Vec<BehaviorUnitId>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum FullContentBuildErrorV1 {
    #[error("complete content input is malformed: {0}")]
    Json(String),
    #[error("complete content schema or oracle identity is invalid")]
    Identity,
    #[error("complete content semantic closure failed: {0}")]
    Semantic(String),
    #[error("complete content definition is invalid: {0}")]
    Definition(String),
    #[error("complete content contains duplicate or unsorted identities")]
    Duplicate,
}

pub fn build_m9_engineering_battle_pack_v1(
    definitions_bytes: &[u8],
    semantic_catalog_bytes: &[u8],
    bespoke_cluster_bytes: &[u8],
) -> Result<BattleContentPackV3, FullContentBuildErrorV1> {
    let definitions: CompleteBattleDefinitionsV1 = serde_json::from_slice(definitions_bytes)
        .map_err(|error| FullContentBuildErrorV1::Json(error.to_string()))?;
    let semantic_catalog: SemanticCatalogV1 = serde_json::from_slice(semantic_catalog_bytes)
        .map_err(|error| FullContentBuildErrorV1::Json(error.to_string()))?;
    let bespoke: BespokeClusterDocumentV1 = serde_json::from_slice(bespoke_cluster_bytes)
        .map_err(|error| FullContentBuildErrorV1::Json(error.to_string()))?;
    if definitions.schema_version != 1
        || definitions.oracle_sha != M9_ENGINEERING_ORACLE_SHA
        || semantic_catalog.oracle_sha != M9_ENGINEERING_ORACLE_SHA
        || bespoke.schema_version != 1
        || bespoke.oracle_sha != M9_ENGINEERING_ORACLE_SHA
    {
        return Err(FullContentBuildErrorV1::Identity);
    }
    let raw_hash = CatalogHash::parse(semantic_catalog.raw_catalog_hash.clone())
        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
    let catalog = ValidatedSemanticCatalog::new_for_oracle(
        SemanticCatalogInput::new(semantic_catalog, raw_hash),
        M9_ENGINEERING_ORACLE_SHA,
    )
    .map_err(|error| FullContentBuildErrorV1::Semantic(error.to_string()))?;
    let catalog_sources = catalog
        .sources()
        .iter()
        .map(|entry| entry.source.clone())
        .collect::<Vec<_>>();
    let intrinsic_rules = catalog
        .behavior_units()
        .iter()
        .filter(|unit| unit.semantic.resolution == CatalogResolution::ResolvedIntrinsic)
        .map(|unit| IntrinsicRule {
            behavior_unit: unit.id.clone(),
        })
        .collect::<Vec<_>>();
    let bespoke_assignments = bespoke
        .clusters
        .into_iter()
        .map(|cluster| BespokeAssignment {
            mechanic: cluster.cluster,
            behavior_units: cluster.behavior_units,
        })
        .collect::<Vec<_>>();
    let semantic = compile_semantics(SemanticCompileRequest {
        catalog: &catalog,
        intrinsic_rules: &intrinsic_rules,
        bespoke_assignments: &bespoke_assignments,
        options: CompilerOptions::default(),
    })
    .map_err(|error| FullContentBuildErrorV1::Semantic(error.to_string()))?;
    let allocations = semantic.programs.clone();
    let mut source_programs = BTreeMap::<BehaviorSourceId, Vec<MechanicsProgramId>>::new();
    for allocation in &allocations {
        for behavior_unit in &allocation.behavior_units {
            source_programs
                .entry(behavior_unit.source.clone())
                .or_default()
                .push(allocation.id);
        }
    }
    for programs in source_programs.values_mut() {
        programs.sort_unstable();
        programs.dedup();
    }
    let programs_for =
        |source: &BehaviorSourceId| source_programs.get(source).cloned().unwrap_or_default();

    let species = build_species(&definitions.species, &programs_for)?;
    let forms = build_forms(&definitions.species, &programs_for)?;
    let moves = build_moves(&definitions.moves, &programs_for)?;
    let abilities = build_abilities(&definitions.abilities, &programs_for)?;
    let held_items =
        registry_definitions(&catalog_sources, &source_programs, |source| match source {
            BehaviorSourceId::HeldItem { registry_key } => Some(registry_key.clone()),
            _ => None,
        })
        .into_iter()
        .map(|(registry_key, mechanic_programs)| HeldItemDefinitionV3 {
            registry_key,
            mechanic_programs,
        })
        .collect();
    let field_content = build_field_content(&catalog_sources, &source_programs)?;
    let mut type_chart_entries = definitions
        .type_chart
        .into_iter()
        .map(|entry| TypeChartEntry {
            attack: entry.attack,
            defense: entry.defense,
            multiplier: entry.multiplier,
        })
        .collect::<Vec<_>>();
    type_chart_entries.sort_by_key(|entry| (entry.attack, entry.defense));
    let type_chart = TypeChart::new(type_chart_entries)
        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;

    assemble_battle_content_pack_v3(
        semantic,
        BattleContentDefinitionsV3 {
            species,
            forms,
            moves,
            abilities,
            held_items,
            field_content,
            rng_sites: Vec::new(),
            type_chart,
        },
    )
    .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))
}

pub fn build_m9_engineering_world_content_v2(
    definitions_bytes: &[u8],
    known_species: &BTreeSet<SpeciesId>,
) -> Result<WorldContentPackV2, FullContentBuildErrorV1> {
    let definitions: CompleteBattleDefinitionsV1 = serde_json::from_slice(definitions_bytes)
        .map_err(|error| FullContentBuildErrorV1::Json(error.to_string()))?;
    if definitions.schema_version != 1
        || definitions.oracle_sha != M9_ENGINEERING_ORACLE_SHA
        || definitions.modes.is_empty()
        || definitions.biomes.is_empty()
    {
        return Err(FullContentBuildErrorV1::Identity);
    }
    ensure_sorted_unique(definitions.modes.iter().map(|mode| mode.mode_id))?;
    ensure_sorted_unique(definitions.biomes.iter().map(|biome| biome.biome_id))?;
    let modes = definitions
        .modes
        .into_iter()
        .map(|mode| {
            Ok(GameModeDefinitionV2 {
                id: GameModeId::new(
                    SafeU53::new(mode.mode_id)
                        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                ),
                key: mode.key,
                starting_level: mode.starting_level,
                starting_money: SafeU53::new(mode.starting_money)
                    .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                starting_biome: BiomeId::new(
                    SafeU53::new(mode.starting_biome_id)
                        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                ),
                challenge_selection: mode.challenge_selection,
                cooperative: mode.cooperative,
                supported: mode.supported,
            })
        })
        .collect::<Result<Vec<_>, FullContentBuildErrorV1>>()?;
    let biomes = definitions
        .biomes
        .into_iter()
        .map(|biome| {
            let pokemon_pools = biome
                .pokemon_pools
                .into_iter()
                .map(|pool| {
                    Ok(BiomeSpeciesPoolV2 {
                        tier: pool.tier,
                        time_of_day: pool.time_of_day,
                        species: pool
                            .species
                            .into_iter()
                            .map(SpeciesId::try_from_u64)
                            .collect::<Result<Vec<_>, _>>()
                            .map_err(|error| {
                                FullContentBuildErrorV1::Definition(error.to_string())
                            })?,
                    })
                })
                .collect::<Result<Vec<_>, FullContentBuildErrorV1>>()?;
            let trainer_pools = biome
                .trainer_pools
                .into_iter()
                .map(|pool| BiomeTrainerPoolV2 {
                    tier: pool.tier,
                    trainer_types: pool.trainer_types,
                })
                .collect();
            let weather_pool = biome
                .weather_pool
                .into_iter()
                .map(|entry| WeightedOracleCodeV2 {
                    code: entry.code,
                    weight: entry.weight,
                })
                .collect();
            let terrain_pool = biome
                .terrain_pool
                .into_iter()
                .map(|entry| WeightedOracleCodeV2 {
                    code: entry.code,
                    weight: entry.weight,
                })
                .collect();
            let links = biome
                .links
                .into_iter()
                .map(|link| {
                    Ok(BiomeLinkV2 {
                        biome: BiomeId::new(SafeU53::new(link.biome_id).map_err(|error| {
                            FullContentBuildErrorV1::Definition(error.to_string())
                        })?),
                        weight: link.weight,
                    })
                })
                .collect::<Result<Vec<_>, FullContentBuildErrorV1>>()?;
            Ok(BiomeDefinitionV2 {
                id: BiomeId::new(
                    SafeU53::new(biome.biome_id)
                        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                ),
                key: biome.key,
                pokemon_pools,
                trainer_pools,
                trainer_chance_denominator: biome.trainer_chance_denominator,
                weather_pool,
                terrain_pool,
                links,
            })
        })
        .collect::<Result<Vec<_>, FullContentBuildErrorV1>>()?;
    let mut pack = WorldContentPackV2 {
        schema_version: WORLD_CONTENT_PACK_SCHEMA_VERSION_V2,
        oracle_sha: er_types::OracleSha::parse(M9_ENGINEERING_ORACLE_SHA)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
        content_hash: CatalogHash::parse("0".repeat(64))
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
        modes,
        biomes,
    };
    pack.content_hash = pack
        .recompute_hash()
        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
    pack.validate(known_species)
        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
    Ok(pack)
}

pub fn build_m9_engineering_bootstrap_content_v1(
    definitions_bytes: &[u8],
    battle: &BattleContentPackV3,
    world: &WorldContentPackV2,
) -> Result<BootstrapContentPackV1, FullContentBuildErrorV1> {
    let definitions: CompleteBattleDefinitionsV1 = serde_json::from_slice(definitions_bytes)
        .map_err(|error| FullContentBuildErrorV1::Json(error.to_string()))?;
    if definitions.schema_version != 1
        || definitions.oracle_sha != M9_ENGINEERING_ORACLE_SHA
        || battle.oracle_sha.as_str() != M9_ENGINEERING_ORACLE_SHA
        || world.oracle_sha.as_str() != M9_ENGINEERING_ORACLE_SHA
        || definitions.modes.is_empty()
    {
        return Err(FullContentBuildErrorV1::Identity);
    }
    ensure_sorted_unique(definitions.modes.iter().map(|mode| mode.mode_id))?;
    let modes = definitions
        .modes
        .into_iter()
        .map(|mode| {
            let id = GameModeId::new(
                SafeU53::new(mode.mode_id)
                    .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
            );

            Ok(BootstrapModeDefinitionV2 {
                mode: id,
                key: mode.key,
                starting_level: mode.starting_level,
                starting_money: SafeU53::new(mode.starting_money)
                    .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                starting_biome: BiomeId::new(
                    SafeU53::new(mode.starting_biome_id)
                        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                ),

                challenge_selection: mode.challenge_selection,
                cooperative: mode.cooperative,
                supported: mode.supported,
            })
        })
        .collect::<Result<Vec<_>, FullContentBuildErrorV1>>()?;
    let mut starters = definitions
        .species
        .into_iter()
        .filter_map(|species| {
            species.starter_cost.map(|cost| {
                let species_id = SpeciesId::try_from_u64(species.species_id)
                    .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
                let level_moves = species
                    .level_moves
                    .into_iter()
                    .map(|entry| {
                        Ok(LevelMoveDefinitionV1 {
                            level: entry.level,
                            move_id: MoveId::try_from_u64(entry.move_id).map_err(|error| {
                                FullContentBuildErrorV1::Definition(error.to_string())
                            })?,
                        })
                    })
                    .collect::<Result<Vec<_>, FullContentBuildErrorV1>>()?;
                Ok(StarterDefinitionV2 {
                    species_id,
                    form_index: species.canonical_form_index,
                    cost,
                    ability_index: 0,
                    level_moves,
                })
            })
        })
        .collect::<Result<Vec<_>, FullContentBuildErrorV1>>()?;
    starters.sort_by_key(|starter| (starter.species_id, starter.form_index));
    let mut pack = BootstrapContentPackV1 {
        schema_version: BOOTSTRAP_CONTENT_SCHEMA_VERSION_V1,
        oracle_sha: battle.oracle_sha.clone(),
        content_hash: CatalogHash::parse("0".repeat(64))
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
        modes,
        starters,
        choices: Vec::new(),
        difficulties: vec![
            RunDifficultyV1::Youngster,
            RunDifficultyV1::Ace,
            RunDifficultyV1::Elite,
            RunDifficultyV1::Hell,
        ],
        maximum_starter_cost: 10,
        maximum_starters: 6,
    };
    pack.content_hash = pack
        .recompute_hash()
        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
    pack.validate(battle, world)
        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
    Ok(pack)
}

fn build_species(
    source: &[CompleteSpeciesV1],
    programs_for: &impl Fn(&BehaviorSourceId) -> Vec<MechanicsProgramId>,
) -> Result<Vec<Option<SpeciesDefinitionV3>>, FullContentBuildErrorV1> {
    ensure_sorted_unique(source.iter().map(|entry| entry.species_id))?;
    let maximum = source
        .last()
        .ok_or(FullContentBuildErrorV1::Identity)?
        .species_id;
    let mut slots = vec![None; slot_count(maximum)?];
    for entry in source {
        let id = SpeciesId::try_from_u64(entry.species_id)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
        let canonical = entry
            .forms
            .iter()
            .find(|form| form.form_index == entry.canonical_form_index)
            .ok_or(FullContentBuildErrorV1::Definition(
                "canonical form is absent".to_owned(),
            ))?;
        validate_form(canonical)?;
        let mut passives = [None; 3];
        for (slot, ability) in entry
            .passive_ability_ids
            .iter()
            .copied()
            .take(3)
            .enumerate()
        {
            passives[slot] = Some(
                AbilityId::try_from_u64(ability)
                    .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
            );
        }
        let active = AbilityId::try_from_u64(canonical.active_ability_ids[0])
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
        let mut form_ids = entry
            .forms
            .iter()
            .map(|form| FormId::parse(format!("{}:{}", entry.species_id, form.form_index)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
        form_ids.sort();
        if entry
            .forms
            .windows(2)
            .any(|pair| pair[0].form_index >= pair[1].form_index)
            || entry
                .level_moves
                .iter()
                .enumerate()
                .any(|(index, value)| entry.level_moves[index + 1..].contains(value))
        {
            return Err(FullContentBuildErrorV1::Duplicate);
        }
        slots[usize::try_from(entry.species_id)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?] =
            Some(SpeciesDefinitionV3 {
                id,
                canonical_form: FormId::parse(format!(
                    "{}:{}",
                    entry.species_id, entry.canonical_form_index
                ))
                .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                base_stats: stats(canonical),
                typing: typing(canonical)?,
                weight: canonical.weight_hectograms,
                ability_slots: AbilitySlotDefinitionV1 { active, passives },
                form_ids,
                mechanic_programs: programs_for(&BehaviorSourceId::Species {
                    numeric_id: id.get(),
                }),
            });
    }
    Ok(slots)
}

fn build_forms(
    source: &[CompleteSpeciesV1],
    programs_for: &impl Fn(&BehaviorSourceId) -> Vec<MechanicsProgramId>,
) -> Result<Vec<FormDefinitionV1>, FullContentBuildErrorV1> {
    let mut output = Vec::new();
    for species in source {
        let id = SpeciesId::try_from_u64(species.species_id)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
        let canonical = species
            .forms
            .iter()
            .find(|form| form.form_index == species.canonical_form_index)
            .ok_or(FullContentBuildErrorV1::Identity)?;
        for form in &species.forms {
            validate_form(form)?;
            let form_id = FormId::parse(format!("{}:{}", species.species_id, form.form_index))
                .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
            let mut passives = [None; 3];
            for (slot, ability) in species
                .passive_ability_ids
                .iter()
                .copied()
                .take(3)
                .enumerate()
            {
                passives[slot] = Some(
                    AbilityId::try_from_u64(ability)
                        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?,
                );
            }
            let active = AbilityId::try_from_u64(form.active_ability_ids[0])
                .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
            output.push(FormDefinitionV1 {
                id: form_id.clone(),
                species: id,
                stat_override: (form.base_stats != canonical.base_stats).then(|| stats(form)),
                typing_override: (form.type_names != canonical.type_names)
                    .then(|| typing(form))
                    .transpose()?,
                weight_override: (form.weight_hectograms != canonical.weight_hectograms)
                    .then_some(form.weight_hectograms),
                ability_override: (form.active_ability_ids != canonical.active_ability_ids)
                    .then_some(AbilitySlotDefinitionV1 { active, passives }),
                mechanic_programs: programs_for(&BehaviorSourceId::Form {
                    registry_key: form_id.as_str().to_owned(),
                }),
                transformation_policy: FormTransformationPolicyV1::Static,
            });
        }
    }
    output.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(output)
}

fn build_moves(
    source: &[CompleteMoveV1],
    programs_for: &impl Fn(&BehaviorSourceId) -> Vec<MechanicsProgramId>,
) -> Result<Vec<Option<MoveDefinitionV3>>, FullContentBuildErrorV1> {
    ensure_sorted_unique(source.iter().map(|entry| entry.id))?;
    let maximum = source.last().ok_or(FullContentBuildErrorV1::Identity)?.id;
    let mut slots = vec![None; slot_count(maximum)?];
    for entry in source {
        let id = MoveId::try_from_u64(entry.id)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
        slots[usize::try_from(entry.id)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?] =
            Some(MoveDefinitionV3 {
                id,
                category: entry.category,
                move_type: entry.move_type,
                power: entry.power.clone(),
                accuracy: entry.accuracy.clone(),
                base_pp: entry.base_pp,
                effect_chance: entry.effect_chance.clone(),
                priority: entry.priority,
                target: entry.target,
                flags: entry.flags.clone(),
                mechanic_programs: programs_for(&BehaviorSourceId::Move {
                    numeric_id: id.get(),
                }),
            });
    }
    Ok(slots)
}

fn build_abilities(
    source: &[CompleteAbilityV1],
    programs_for: &impl Fn(&BehaviorSourceId) -> Vec<MechanicsProgramId>,
) -> Result<Vec<Option<AbilityDefinitionV3>>, FullContentBuildErrorV1> {
    ensure_sorted_unique(source.iter().map(|entry| entry.id))?;
    let maximum = source.last().ok_or(FullContentBuildErrorV1::Identity)?.id;
    let mut slots = vec![None; slot_count(maximum)?];
    for entry in source {
        let id = AbilityId::try_from_u64(entry.id)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?;
        let mut mechanic_programs = programs_for(&BehaviorSourceId::ActiveAbility {
            numeric_id: id.get(),
        });
        mechanic_programs.extend(programs_for(&BehaviorSourceId::PassiveAbility {
            numeric_id: id.get(),
        }));
        mechanic_programs.sort_unstable();
        mechanic_programs.dedup();
        slots[usize::try_from(entry.id)
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?] =
            Some(AbilityDefinitionV3 {
                id,
                mechanic_programs,
            });
    }
    Ok(slots)
}

fn build_field_content(
    sources: &[BehaviorSourceId],
    source_programs: &BTreeMap<BehaviorSourceId, Vec<MechanicsProgramId>>,
) -> Result<FieldContentV1, FullContentBuildErrorV1> {
    Ok(FieldContentV1 {
        statuses: numeric_definitions(sources, source_programs, |source| match source {
            BehaviorSourceId::MajorStatus { numeric_id } => Some(*numeric_id),
            _ => None,
        })?
        .into_iter()
        .map(|entry| {
            entry.map(|(id, mechanic_programs)| StatusDefinitionV2 {
                id,
                mechanic_programs,
            })
        })
        .collect(),
        weather: numeric_definitions(sources, source_programs, |source| match source {
            BehaviorSourceId::Weather { numeric_id } => Some(*numeric_id),
            _ => None,
        })?
        .into_iter()
        .map(|entry| {
            entry.map(|(id, mechanic_programs)| WeatherDefinitionV2 {
                id,
                mechanic_programs,
            })
        })
        .collect(),
        terrain: numeric_definitions(sources, source_programs, |source| match source {
            BehaviorSourceId::Terrain { numeric_id } => Some(*numeric_id),
            _ => None,
        })?
        .into_iter()
        .map(|entry| {
            entry.map(|(id, mechanic_programs)| TerrainDefinitionV2 {
                id,
                mechanic_programs,
            })
        })
        .collect(),
        side_conditions: tag_definitions(sources, source_programs, |source| match source {
            BehaviorSourceId::SideCondition { registry_key } => Some(registry_key.clone()),
            _ => None,
        }),
        battler_tags: tag_definitions(sources, source_programs, |source| match source {
            BehaviorSourceId::BattlerTag { registry_key } => Some(registry_key.clone()),
            _ => None,
        }),
        arena_tags: tag_definitions(sources, source_programs, |source| match source {
            BehaviorSourceId::ArenaTag { registry_key } => Some(registry_key.clone()),
            _ => None,
        }),
        positional_tags: tag_definitions(sources, source_programs, |source| match source {
            BehaviorSourceId::PositionalTag { registry_key } => Some(registry_key.clone()),
            _ => None,
        }),
    })
}

fn numeric_definitions(
    sources: &[BehaviorSourceId],
    source_programs: &BTreeMap<BehaviorSourceId, Vec<MechanicsProgramId>>,
    key: impl Fn(&BehaviorSourceId) -> Option<SafeU53>,
) -> Result<Vec<Option<(SafeU53, Vec<MechanicsProgramId>)>>, FullContentBuildErrorV1> {
    let mut groups = BTreeMap::<SafeU53, Vec<MechanicsProgramId>>::new();
    for source in sources {
        if let Some(id) = key(source) {
            groups.insert(id, source_programs.get(source).cloned().unwrap_or_default());
        }
    }
    let Some(maximum) = groups.keys().next_back().copied() else {
        return Ok(Vec::new());
    };
    let mut slots = vec![None; slot_count(maximum.get())?];
    for (id, programs) in groups {
        slots[usize::try_from(id.get())
            .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?] =
            Some((id, programs));
    }
    Ok(slots)
}

fn registry_definitions(
    sources: &[BehaviorSourceId],
    source_programs: &BTreeMap<BehaviorSourceId, Vec<MechanicsProgramId>>,
    key: impl Fn(&BehaviorSourceId) -> Option<String>,
) -> Vec<(String, Vec<MechanicsProgramId>)> {
    sources
        .iter()
        .filter_map(|source| {
            key(source).map(|key| {
                (
                    key,
                    source_programs.get(source).cloned().unwrap_or_default(),
                )
            })
        })
        .collect()
}

fn tag_definitions(
    sources: &[BehaviorSourceId],
    source_programs: &BTreeMap<BehaviorSourceId, Vec<MechanicsProgramId>>,
    key: impl Fn(&BehaviorSourceId) -> Option<String>,
) -> Vec<TagDefinitionV2> {
    registry_definitions(sources, source_programs, key)
        .into_iter()
        .map(|(registry_key, mechanic_programs)| TagDefinitionV2 {
            registry_key,
            mechanic_programs,
        })
        .collect()
}

fn validate_form(form: &CompleteFormV1) -> Result<(), FullContentBuildErrorV1> {
    if form.type_names.is_empty()
        || form.type_names.len() > 2
        || form.weight_hectograms == 0
        || form.base_stats.contains(&0)
    {
        return Err(FullContentBuildErrorV1::Definition(
            "invalid species form".to_owned(),
        ));
    }
    Ok(())
}

fn stats(form: &CompleteFormV1) -> SpeciesBaseStats {
    SpeciesBaseStats {
        hp: form.base_stats[0],
        attack: form.base_stats[1],
        defense: form.base_stats[2],
        special_attack: form.base_stats[3],
        special_defense: form.base_stats[4],
        speed: form.base_stats[5],
    }
}

fn typing(form: &CompleteFormV1) -> Result<PokemonTyping, FullContentBuildErrorV1> {
    let primary = *form
        .type_names
        .first()
        .ok_or_else(|| FullContentBuildErrorV1::Definition("missing primary type".to_owned()))?;
    Ok(PokemonTyping {
        primary,
        secondary: form.type_names.get(1).copied(),
    })
}

fn ensure_sorted_unique(values: impl Iterator<Item = u64>) -> Result<(), FullContentBuildErrorV1> {
    let values = values.collect::<Vec<_>>();
    if values.is_empty() || values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(FullContentBuildErrorV1::Duplicate);
    }
    Ok(())
}

fn slot_count(maximum: u64) -> Result<usize, FullContentBuildErrorV1> {
    usize::try_from(maximum)
        .map_err(|error| FullContentBuildErrorV1::Definition(error.to_string()))?
        .checked_add(1)
        .ok_or_else(|| {
            FullContentBuildErrorV1::Definition("content slot count overflowed".to_owned())
        })
}
