//! M9 pinned-oracle vertical-slice content assembly.

use std::collections::BTreeSet;
use std::sync::Arc;

use er_canonical::content_digest;
use er_content::m6_catalog::{CatalogResolution, SemanticCatalogV1};
use er_content::pack::m6_pack::{
    AbilityDefinitionV3, AbilitySlotDefinitionV1, BattleContentPackV3, FieldContentV1,
    FormDefinitionV1, FormTransformationPolicyV1, MoveDefinitionV3, SpeciesDefinitionV3,
};
use er_content::pack::selected_type_chart;
use er_content::species::SpeciesBaseStats;
use er_game::m7_content::{GameContentBundleV1, RunContentPackV3};
use er_types::battle_ids::{AbilityId, GameModeId, MoveId, SpeciesId};
use er_types::battle_model::{
    EffectChance, MoveAccuracy, MoveCategory, MoveFlag, MovePower, MoveTarget, PokemonType,
    PokemonTyping,
};
use er_types::run_ids::{BiomeId, EncounterId, RouteNodeId};
use er_types::{
    BehaviorSourceId, BehaviorUnitId, BespokeMechanicId, CatalogHash, FormId, MechanicsProgramId,
    SafeU53,
};
use er_world::{
    BiomeDefinitionV1, BiomeRouteLinkV1, EncounterDefinitionV1, EncounterKindV1, PokemonBuildV1,
    RouteDefinitionV1, WeightedEncounterV1, WeightedRouteV1, WorldContentPackV1,
};
use serde::Deserialize;
use thiserror::Error;

use crate::m6::{
    BattleContentDefinitionsV3, BespokeAssignment, CompilerOptions, IntrinsicRule,
    SemanticCatalogInput, SemanticCompileRequest, ValidatedSemanticCatalog,
    assemble_battle_content_pack_v3, compile_semantics,
};

pub const M9_BOOTSTRAP_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Deserialize)]
struct StarterOracleV1 {
    schema_version: u32,
    oracle_sha: String,
    mode: OracleModeV1,
    #[serde(rename = "constructed_player")]
    _constructed_player: OraclePokemonV1,
    generated_enemy: OraclePokemonV1,
    reachable_species: Vec<ReachableSpeciesV1>,
    reachable_moves: Vec<ReachableMoveV1>,
    reachable_abilities: Vec<ReachableAbilityV1>,
}

#[derive(Clone, Debug, Deserialize)]
struct OracleModeV1 {
    mode_id: u64,
    starting_level: u16,
    starting_money: u64,
    starting_biome_id: u64,
}

#[derive(Clone, Debug, Deserialize)]
struct OraclePokemonV1 {
    species_id: u64,
    form_index: u16,
    level: u16,
    ability_id: u64,
    passive_ability_ids: Vec<u64>,
    passive_enabled: bool,
    tera_type_name: PokemonType,
    moves: Vec<OracleMoveSlotV1>,
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct OracleMoveSlotV1 {
    move_id: u64,
}

#[derive(Clone, Debug, Deserialize)]
struct ReachableSpeciesV1 {
    species_id: u64,
    form_index: u16,
    base_stats: [u32; 6],
    type_names: Vec<PokemonType>,
    weight_hectograms: u32,
    selected_active_ability_id: u64,
    passive_ability_ids: Vec<u64>,
    passive_enabled: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct ReachableMoveV1 {
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
struct ReachableAbilityV1 {
    id: u64,
    #[allow(dead_code)]
    name: String,
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

#[derive(Debug, Error)]
pub enum M9ContentBuildError {
    #[error("M9 starter oracle or semantic input is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("M9 starter/semantic schema or oracle identity is invalid")]
    Identity,
    #[error("M9 semantic catalog validation failed: {0}")]
    Catalog(String),
    #[error("M9 semantic compilation failed: {0}")]
    Compile(String),
    #[error("M9 content identity or definition is invalid: {0}")]
    Definition(String),
    #[error("M9 reachable content contains duplicate identities")]
    Duplicate,
}

pub fn build_m9_vertical_slice_pack(
    starter_oracle_bytes: &[u8],
    semantic_catalog_bytes: &[u8],
    bespoke_cluster_bytes: &[u8],
) -> Result<BattleContentPackV3, M9ContentBuildError> {
    let starter: StarterOracleV1 = serde_json::from_slice(starter_oracle_bytes)?;
    let semantic_catalog: SemanticCatalogV1 = serde_json::from_slice(semantic_catalog_bytes)?;
    let bespoke: BespokeClusterDocumentV1 = serde_json::from_slice(bespoke_cluster_bytes)?;
    if starter.schema_version != 1
        || starter.oracle_sha != M9_BOOTSTRAP_ORACLE_SHA
        || semantic_catalog.oracle_sha != M9_BOOTSTRAP_ORACLE_SHA
        || bespoke.schema_version != 1
        || bespoke.oracle_sha != M9_BOOTSTRAP_ORACLE_SHA
    {
        return Err(M9ContentBuildError::Identity);
    }

    let raw_hash = CatalogHash::parse(semantic_catalog.raw_catalog_hash.clone())
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    let catalog = ValidatedSemanticCatalog::new_for_oracle(
        SemanticCatalogInput::new(semantic_catalog, raw_hash),
        M9_BOOTSTRAP_ORACLE_SHA,
    )
    .map_err(|error| M9ContentBuildError::Catalog(error.to_string()))?;
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
    .map_err(|error| M9ContentBuildError::Compile(error.to_string()))?;

    let program_allocations = semantic.programs.clone();
    let programs_for = |source: &BehaviorSourceId| {
        program_allocations
            .iter()
            .filter(|allocation| &allocation.source == source)
            .map(|allocation| allocation.id)
            .collect::<Vec<MechanicsProgramId>>()
    };

    let mut species_ids = BTreeSet::new();
    let max_species = starter
        .reachable_species
        .iter()
        .map(|species| species.species_id)
        .max()
        .ok_or(M9ContentBuildError::Identity)?;
    let mut species_slots = vec![None; slot_count(max_species)?];
    let mut forms = Vec::with_capacity(starter.reachable_species.len());
    for species in starter.reachable_species {
        if !species_ids.insert(species.species_id)
            || species.type_names.is_empty()
            || species.type_names.len() > 2
            || species.weight_hectograms == 0
        {
            return Err(M9ContentBuildError::Duplicate);
        }
        let id = SpeciesId::try_from_u64(species.species_id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        let form_id = FormId::parse(format!("{}:{}", species.species_id, species.form_index))
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        let active = AbilityId::try_from_u64(species.selected_active_ability_id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        let mut passives = [None; 3];
        if species.passive_enabled {
            for (slot, value) in species.passive_ability_ids.into_iter().take(3).enumerate() {
                passives[slot] = Some(
                    AbilityId::try_from_u64(value)
                        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?,
                );
            }
        }
        let definition = SpeciesDefinitionV3 {
            id,
            canonical_form: form_id.clone(),
            base_stats: SpeciesBaseStats {
                hp: species.base_stats[0],
                attack: species.base_stats[1],
                defense: species.base_stats[2],
                special_attack: species.base_stats[3],
                special_defense: species.base_stats[4],
                speed: species.base_stats[5],
            },
            typing: PokemonTyping {
                primary: species.type_names[0],
                secondary: species.type_names.get(1).copied(),
            },
            weight: species.weight_hectograms,
            ability_slots: AbilitySlotDefinitionV1 { active, passives },
            form_ids: vec![form_id.clone()],
            mechanic_programs: programs_for(&BehaviorSourceId::Species {
                numeric_id: id.get(),
            }),
        };
        let index = usize::try_from(species.species_id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        species_slots[index] = Some(definition);
        forms.push(FormDefinitionV1 {
            id: form_id,
            species: id,
            stat_override: None,
            typing_override: None,
            weight_override: None,
            ability_override: None,
            mechanic_programs: Vec::new(),
            transformation_policy: FormTransformationPolicyV1::Static,
        });
    }
    forms.sort_by(|left, right| left.id.cmp(&right.id));

    let mut move_ids = BTreeSet::new();
    let max_move = starter
        .reachable_moves
        .iter()
        .map(|move_definition| move_definition.id)
        .max()
        .ok_or(M9ContentBuildError::Identity)?;
    let mut move_slots = vec![None; slot_count(max_move)?];
    for move_definition in starter.reachable_moves {
        if !move_ids.insert(move_definition.id) {
            return Err(M9ContentBuildError::Duplicate);
        }
        let id = MoveId::try_from_u64(move_definition.id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        let index = usize::try_from(move_definition.id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        move_slots[index] = Some(MoveDefinitionV3 {
            id,
            category: move_definition.category,
            move_type: move_definition.move_type,
            power: move_definition.power,
            accuracy: move_definition.accuracy,
            base_pp: move_definition.base_pp,
            effect_chance: move_definition.effect_chance,
            priority: move_definition.priority,
            target: move_definition.target,
            flags: move_definition.flags,
            mechanic_programs: programs_for(&BehaviorSourceId::Move {
                numeric_id: id.get(),
            }),
        });
    }

    let mut ability_ids = BTreeSet::new();
    let max_ability = starter
        .reachable_abilities
        .iter()
        .map(|ability| ability.id)
        .max()
        .ok_or(M9ContentBuildError::Identity)?;
    let mut ability_slots = vec![None; slot_count(max_ability)?];
    for ability in starter.reachable_abilities {
        if !ability_ids.insert(ability.id) {
            return Err(M9ContentBuildError::Duplicate);
        }
        let id = AbilityId::try_from_u64(ability.id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        let mut mechanic_programs = programs_for(&BehaviorSourceId::ActiveAbility {
            numeric_id: id.get(),
        });
        mechanic_programs.extend(programs_for(&BehaviorSourceId::PassiveAbility {
            numeric_id: id.get(),
        }));
        mechanic_programs.sort_unstable();
        mechanic_programs.dedup();
        let index = usize::try_from(ability.id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
        ability_slots[index] = Some(AbilityDefinitionV3 {
            id,
            mechanic_programs,
        });
    }

    assemble_battle_content_pack_v3(
        semantic,
        BattleContentDefinitionsV3 {
            species: species_slots,
            forms,
            moves: move_slots,
            abilities: ability_slots,
            held_items: Vec::new(),
            field_content: FieldContentV1::default(),
            rng_sites: Vec::new(),
            type_chart: selected_type_chart(),
        },
    )
    .map_err(|error| M9ContentBuildError::Definition(error.to_string()))
}

pub fn build_m9_game_content_bundle(
    base_bundle_bytes: &[u8],
    starter_oracle_bytes: &[u8],
    semantic_catalog_bytes: &[u8],
    bespoke_cluster_bytes: &[u8],
) -> Result<GameContentBundleV1, M9ContentBuildError> {
    let mut bundle: GameContentBundleV1 = serde_json::from_slice(base_bundle_bytes)?;
    let starter: StarterOracleV1 = serde_json::from_slice(starter_oracle_bytes)?;
    let battle = Arc::new(build_m9_vertical_slice_pack(
        starter_oracle_bytes,
        semantic_catalog_bytes,
        bespoke_cluster_bytes,
    )?);
    if bundle.oracle_sha.as_str() != M9_BOOTSTRAP_ORACLE_SHA
        || battle.oracle_sha.as_str() != M9_BOOTSTRAP_ORACLE_SHA
    {
        return Err(M9ContentBuildError::Identity);
    }
    let run = Arc::new(
        RunContentPackV3::new(
            bundle.oracle_sha.clone(),
            battle.content_hash.clone(),
            bundle.run.programs.clone(),
        )
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?,
    );
    let world = Arc::new(build_world_slice(bundle.world.as_ref(), &starter)?);
    bundle.battle = battle;
    bundle.run = run;
    bundle.world = world;
    bundle.content_hash = bundle
        .recompute_hash()
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    bundle
        .validate()
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    Ok(bundle)
}

fn build_world_slice(
    base: &WorldContentPackV1,
    starter: &StarterOracleV1,
) -> Result<WorldContentPackV1, M9ContentBuildError> {
    if starter.mode.starting_level == 0 {
        return Err(M9ContentBuildError::Identity);
    }
    SafeU53::new(starter.mode.starting_money)
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    let mode_id = GameModeId::new(
        SafeU53::new(starter.mode.mode_id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?,
    );
    let biome_id = BiomeId::new(
        SafeU53::new(starter.mode.starting_biome_id)
            .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?,
    );
    let route_id = RouteNodeId::new(SafeU53::ZERO);
    let encounter_id = EncounterId::new(SafeU53::ZERO);
    let fallback_route = base
        .routes
        .first()
        .map(|route| route.id)
        .ok_or(M9ContentBuildError::Identity)?;
    let mut mode = base
        .modes
        .first()
        .cloned()
        .ok_or(M9ContentBuildError::Identity)?;
    mode.id = mode_id;
    mode.key = "classic-m9-vertical-slice".to_owned();
    mode.route = route_id;

    let enemy = &starter.generated_enemy;
    let active_ability = AbilityId::try_from_u64(enemy.ability_id)
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    let mut passive_abilities = [None; 3];
    if enemy.passive_enabled {
        for (slot, value) in enemy
            .passive_ability_ids
            .iter()
            .copied()
            .take(3)
            .enumerate()
        {
            passive_abilities[slot] = Some(
                AbilityId::try_from_u64(value)
                    .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?,
            );
        }
    }
    let mut enemy_moves = enemy
        .moves
        .iter()
        .map(|slot| {
            MoveId::try_from_u64(slot.move_id)
                .map_err(|error| M9ContentBuildError::Definition(error.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    enemy_moves.sort_unstable();
    enemy_moves.dedup();
    let encounter = EncounterDefinitionV1 {
        id: encounter_id,
        key: "pinned-pidgey-wave-1".to_owned(),
        kind: EncounterKindV1::Wild,
        party: vec![PokemonBuildV1 {
            species: SpeciesId::try_from_u64(enemy.species_id)
                .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?,
            form: enemy.form_index,
            level_offset: i16::try_from(enemy.level)
                .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?
                - i16::try_from(starter.mode.starting_level)
                    .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?,
            moves: enemy_moves,
            active_ability,
            passive_abilities,
            held_items: Vec::new(),
            tera_type: Some(enemy.tera_type_name),
        }],
        money_reward: SafeU53::ZERO,
        ai_policy_key: "first-legal".to_owned(),
    };
    let biome = BiomeDefinitionV1 {
        id: biome_id,
        key: "town-m9-vertical-slice".to_owned(),
        travel_allowed: true,
        encounters: vec![WeightedEncounterV1 {
            encounter: encounter_id,
            weight: 1,
        }],
        exits: vec![WeightedRouteV1 {
            route: fallback_route,
            weight: 1,
        }],
        routing_exits: vec![BiomeRouteLinkV1 {
            route: fallback_route,
            inclusion_denominator: None,
        }],
        encounter_profile: None,
        battle_rule: None,
    };
    let route = RouteDefinitionV1 {
        id: route_id,
        biome: biome_id,
        next: vec![WeightedRouteV1 {
            route: fallback_route,
            weight: 1,
        }],
        minimum_wave: 1,
        maximum_wave: Some(1),
    };
    let mut output = base.clone();
    output.modes.retain(|entry| entry.id != mode_id);
    output.biomes.retain(|entry| entry.id != biome_id);
    output.routes.retain(|entry| entry.id != route_id);
    output.encounters.retain(|entry| entry.id != encounter_id);
    output.modes.push(mode);
    output.biomes.push(biome);
    output.routes.push(route);
    output.encounters.push(encounter);
    output.modes.sort_by_key(|entry| entry.id);
    output.biomes.sort_by_key(|entry| entry.id);
    output.routes.sort_by_key(|entry| entry.id);
    output.encounters.sort_by_key(|entry| entry.id);
    let world_digest = content_digest(&(
        output.schema_version,
        &output.oracle_sha,
        &output.modes,
        &output.biomes,
        &output.routes,
        &output.encounters,
    ))
    .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    output.content_hash = CatalogHash::parse(world_digest)
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    output
        .validate()
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?;
    Ok(output)
}

fn slot_count(maximum: u64) -> Result<usize, M9ContentBuildError> {
    usize::try_from(maximum)
        .map_err(|error| M9ContentBuildError::Definition(error.to_string()))?
        .checked_add(1)
        .ok_or_else(|| M9ContentBuildError::Definition("content index overflow".to_owned()))
}
