//! Deterministic compiler for the complete pinned M9-E scenario surface.

use std::collections::BTreeMap;

use er_scenario::content_v2::{
    SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V2, ScenarioBehaviorBindingV2, ScenarioBehaviorHandlerV2,
    ScenarioCallbackEvidenceV2, ScenarioCallbackSlotV2, ScenarioChoiceEdgeV2,
    ScenarioContentPackV2, ScenarioDefinitionV2, ScenarioFlagsV2, ScenarioNodeEntryV2,
    ScenarioNodeV2, ScenarioOptionDefinitionV2, ScenarioRatioV1, ScenarioRequirementV2,
};
use er_types::{CatalogHash, GameBehaviorUnitId, OracleSha, SafeU53, ScenarioId, ScenarioNodeId};
use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

pub const M9_SCENARIO_ORACLE_SHA: &str = "399d5d368f0b5642ebf8f45bd8a5e73350fa4de7";

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawScenarioDocumentV2 {
    schema_version: u32,
    oracle_sha: String,
    scenarios: Vec<RawScenarioV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawScenarioV2 {
    id: u64,
    key: String,
    localization_key: String,
    tier: u8,
    biome_ids: Vec<u64>,
    disallowed_game_modes: Vec<u64>,
    disallowed_challenges: Vec<u64>,
    flags: ScenarioFlagsV2,
    requirements: Vec<Value>,
    primary_pokemon_requirements: Vec<Value>,
    secondary_pokemon_requirements: Vec<Value>,
    exclude_primary_from_support_requirements: bool,
    callbacks: BTreeMap<String, RawCallbackV2>,
    options: Vec<RawOptionV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawOptionV2 {
    option_index: u8,
    option_mode: u8,
    has_dex_progress: bool,
    exclude_primary_from_secondary_requirements: bool,
    requirements: Vec<Value>,
    primary_pokemon_requirements: Vec<Value>,
    secondary_pokemon_requirements: Vec<Value>,
    callbacks: BTreeMap<String, RawCallbackV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawCallbackV2 {
    sha256: String,
    #[serde(rename = "async")]
    asynchronous: bool,
    source_length: u32,
    starts_nested_battle: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ScenarioBehaviorCatalogV1 {
    schema_version: u32,
    oracle_sha: String,
    oracle_tree_sha: String,
    behavior_count: usize,
    behaviors: Vec<RawBehaviorUnitV1>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBehaviorUnitV1 {
    #[serde(rename = "async")]
    asynchronous: bool,
    declaration_kind: String,
    domain: String,
    id: String,
    implementation_status: String,
    owner: Option<String>,
    parameter_count: u16,
    source: RawBehaviorSourceV1,
    symbol: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBehaviorSourceV1 {
    column: u32,
    line: u32,
    path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct BehaviorImplementationDocumentV2 {
    schema_version: u32,
    oracle_sha: String,
    oracle_tree_sha: String,
    publication_state: String,
    implementation_group_count: usize,
    implementation_count: usize,
    implementations: Vec<RawBehaviorImplementationV2>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawBehaviorImplementationV2 {
    group_id: String,
    domain: String,
    status: String,
    behavior_units: Vec<String>,
    rust_symbols: Vec<String>,
    proof_registry_group: String,
    proof_tests: Vec<String>,
    proof_execution_digest: String,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScenarioBuildErrorV2 {
    #[error("scenario V2 source artifact is malformed: {0}")]
    Decode(String),
    #[error("scenario V2 source identity or classification is invalid")]
    Identity,
    #[error("scenario V2 source contains an unsupported or malformed value")]
    Invalid,
    #[error("scenario V2 pack validation failed: {0}")]
    Validation(String),
}

pub fn build_m9_engineering_scenario_v2(
    scenario_bytes: &[u8],
    behavior_catalog_bytes: &[u8],
    implementation_bytes: &[u8],
) -> Result<ScenarioContentPackV2, ScenarioBuildErrorV2> {
    let source: RawScenarioDocumentV2 = decode(scenario_bytes)?;
    let catalog: ScenarioBehaviorCatalogV1 = decode(behavior_catalog_bytes)?;
    let implementations: BehaviorImplementationDocumentV2 = decode(implementation_bytes)?;
    if source.schema_version != 2
        || source.oracle_sha != M9_SCENARIO_ORACLE_SHA
        || catalog.schema_version != 1
        || catalog.oracle_sha != M9_SCENARIO_ORACLE_SHA
        || catalog.oracle_tree_sha.is_empty()
        || catalog.behavior_count != catalog.behaviors.len()
        || catalog.behavior_count != 841
        || implementations.schema_version != 2
        || implementations.oracle_sha != M9_SCENARIO_ORACLE_SHA
        || implementations.oracle_tree_sha.is_empty()
        || implementations.publication_state != "QUALIFIED"
        || implementations.implementation_group_count != implementations.implementations.len()
        || implementations.implementation_count < catalog.behavior_count
    {
        return Err(ScenarioBuildErrorV2::Identity);
    }

    let group_by_behavior = implementation_groups(&implementations.implementations)?;
    let behavior_bindings = compile_behavior_bindings(catalog.behaviors, &group_by_behavior)?;
    let behavior_paths = behavior_bindings
        .iter()
        .map(|binding| {
            (
                binding.source_path.clone(),
                binding.behavior_unit.clone(),
                binding.handler,
            )
        })
        .collect::<Vec<_>>();
    let scenarios = source
        .scenarios
        .into_iter()
        .map(|scenario| compile_scenario(scenario, &behavior_paths))
        .collect::<Result<Vec<_>, _>>()?;

    let mut pack = ScenarioContentPackV2 {
        schema_version: SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V2,
        oracle_sha: OracleSha::parse(source.oracle_sha)
            .map_err(|_| ScenarioBuildErrorV2::Identity)?,
        content_hash: CatalogHash::parse("0".repeat(64))
            .map_err(|_| ScenarioBuildErrorV2::Identity)?,
        scenarios,
        behavior_bindings,
    };
    pack.content_hash = pack
        .recompute_hash()
        .map_err(|error| ScenarioBuildErrorV2::Validation(error.to_string()))?;
    pack.validate()
        .map_err(|error| ScenarioBuildErrorV2::Validation(error.to_string()))?;
    Ok(pack)
}

fn implementation_groups(
    implementations: &[RawBehaviorImplementationV2],
) -> Result<BTreeMap<String, (String, ScenarioBehaviorHandlerV2)>, ScenarioBuildErrorV2> {
    let mut result = BTreeMap::new();
    for implementation in implementations {
        if implementation.domain != "SCENARIO" {
            continue;
        }
        if implementation.status != "BESPOKE_IMPLEMENTED"
            || implementation.group_id.is_empty()
            || implementation.behavior_units.is_empty()
            || implementation.rust_symbols.is_empty()
            || implementation.proof_registry_group != implementation.group_id
            || implementation.proof_tests.is_empty()
            || !implementation
                .proof_execution_digest
                .starts_with("blake3-v1:")
        {
            return Err(ScenarioBuildErrorV2::Identity);
        }
        let handler = handler(&implementation.rust_symbols)?;
        for behavior in &implementation.behavior_units {
            if result
                .insert(behavior.clone(), (implementation.group_id.clone(), handler))
                .is_some()
            {
                return Err(ScenarioBuildErrorV2::Identity);
            }
        }
    }
    Ok(result)
}

fn handler(symbols: &[String]) -> Result<ScenarioBehaviorHandlerV2, ScenarioBuildErrorV2> {
    if symbols
        .iter()
        .any(|symbol| symbol.ends_with("::start_nested_battle"))
    {
        Ok(ScenarioBehaviorHandlerV2::StartNestedBattle)
    } else if symbols.iter().any(|symbol| symbol.ends_with("::advance")) {
        Ok(ScenarioBehaviorHandlerV2::Advance)
    } else if symbols
        .iter()
        .any(|symbol| symbol.ends_with("::available_scenario_choices_v1"))
    {
        Ok(ScenarioBehaviorHandlerV2::AvailableChoices)
    } else if symbols
        .iter()
        .any(|symbol| symbol.ends_with("::evaluate_scenario_condition_v1"))
    {
        Ok(ScenarioBehaviorHandlerV2::EvaluateCondition)
    } else {
        Err(ScenarioBuildErrorV2::Identity)
    }
}

fn compile_behavior_bindings(
    mut behaviors: Vec<RawBehaviorUnitV1>,
    groups: &BTreeMap<String, (String, ScenarioBehaviorHandlerV2)>,
) -> Result<Vec<ScenarioBehaviorBindingV2>, ScenarioBuildErrorV2> {
    behaviors.sort_by(|left, right| left.id.cmp(&right.id));
    behaviors
        .into_iter()
        .map(|behavior| {
            if behavior.domain != "SCENARIO"
                || behavior.implementation_status != "REQUIRES_M7"
                || behavior.declaration_kind.is_empty()
                || behavior.owner.as_deref().is_some_and(str::is_empty)
            {
                return Err(ScenarioBuildErrorV2::Identity);
            }
            let (group_id, handler) = groups
                .get(&behavior.id)
                .ok_or(ScenarioBuildErrorV2::Identity)?;
            Ok(ScenarioBehaviorBindingV2 {
                behavior_unit: GameBehaviorUnitId::parse(behavior.id)
                    .map_err(|_| ScenarioBuildErrorV2::Identity)?,
                group_id: group_id.clone(),
                source_path: behavior.source.path,
                source_line: behavior.source.line,
                source_column: behavior.source.column,
                symbol: behavior.symbol,
                asynchronous: behavior.asynchronous,
                parameter_count: behavior.parameter_count,
                handler: *handler,
            })
        })
        .collect()
}

fn compile_scenario(
    scenario: RawScenarioV2,
    behavior_paths: &[(String, GameBehaviorUnitId, ScenarioBehaviorHandlerV2)],
) -> Result<ScenarioDefinitionV2, ScenarioBuildErrorV2> {
    let slug = scenario_slug(&scenario.key);
    let suffix = format!("/{slug}-encounter.ts");
    let matching_behaviors = behavior_paths
        .iter()
        .filter(|(path, _, _)| path.ends_with(&suffix))
        .collect::<Vec<_>>();
    let behavior_units = matching_behaviors
        .iter()
        .map(|(_, behavior, _)| behavior.clone())
        .collect::<Vec<_>>();
    let nested_battle = matching_behaviors
        .iter()
        .any(|(_, _, handler)| *handler == ScenarioBehaviorHandlerV2::StartNestedBattle)
        || scenario
            .callbacks
            .values()
            .chain(
                scenario
                    .options
                    .iter()
                    .flat_map(|option| option.callbacks.values()),
            )
            .any(|callback| callback.starts_nested_battle);
    let callbacks = compile_callbacks(scenario.callbacks, false)?;
    let mut options = scenario
        .options
        .into_iter()
        .map(compile_option)
        .collect::<Result<Vec<_>, _>>()?;
    options.sort_by_key(|option| option.option_index);
    let nodes = graph_nodes(
        &scenario.localization_key,
        &options,
        &behavior_units,
        nested_battle,
    )?;
    Ok(ScenarioDefinitionV2 {
        id: ScenarioId::new(safe(scenario.id)?),
        key: scenario.key,
        localization_key: scenario.localization_key,
        tier: scenario.tier,
        biome_ids: sorted_unique(scenario.biome_ids),
        disallowed_game_modes: sorted_unique(scenario.disallowed_game_modes),
        disallowed_challenges: sorted_unique(scenario.disallowed_challenges),
        flags: scenario.flags,
        requirements: compile_requirements(scenario.requirements)?,
        primary_pokemon_requirements: compile_requirements(scenario.primary_pokemon_requirements)?,
        secondary_pokemon_requirements: compile_requirements(
            scenario.secondary_pokemon_requirements,
        )?,
        exclude_primary_from_support_requirements: scenario
            .exclude_primary_from_support_requirements,
        callbacks,
        options,
        entry: node_id(1)?,
        nodes,
    })
}

fn compile_option(option: RawOptionV2) -> Result<ScenarioOptionDefinitionV2, ScenarioBuildErrorV2> {
    Ok(ScenarioOptionDefinitionV2 {
        option_index: option.option_index,
        option_key: format!("option/{}", option.option_index),
        option_mode: option.option_mode,
        has_dex_progress: option.has_dex_progress,
        exclude_primary_from_secondary_requirements: option
            .exclude_primary_from_secondary_requirements,
        requirements: compile_requirements(option.requirements)?,
        primary_pokemon_requirements: compile_requirements(option.primary_pokemon_requirements)?,
        secondary_pokemon_requirements: compile_requirements(
            option.secondary_pokemon_requirements,
        )?,
        callbacks: compile_callbacks(option.callbacks, true)?,
    })
}

fn compile_callbacks(
    values: BTreeMap<String, RawCallbackV2>,
    option: bool,
) -> Result<Vec<ScenarioCallbackEvidenceV2>, ScenarioBuildErrorV2> {
    values
        .into_iter()
        .map(|(name, callback)| {
            let slot = callback_slot(&name, option)?;
            Ok(ScenarioCallbackEvidenceV2 {
                slot,
                sha256: callback.sha256,
                asynchronous: callback.asynchronous,
                source_length: callback.source_length,
            })
        })
        .collect()
}

fn callback_slot(name: &str, option: bool) -> Result<ScenarioCallbackSlotV2, ScenarioBuildErrorV2> {
    let slot = match (option, name) {
        (false, "onInit") => ScenarioCallbackSlotV2::Init,
        (false, "onVisualsStart") => ScenarioCallbackSlotV2::VisualsStart,
        (false, "onTurnStart") => ScenarioCallbackSlotV2::TurnStart,
        (false, "onRewards") => ScenarioCallbackSlotV2::Rewards,
        (false, "doEncounterExp") => ScenarioCallbackSlotV2::EncounterExperience,
        (false, "doEncounterRewards") => ScenarioCallbackSlotV2::EncounterRewards,
        (false, "doContinueEncounter") => ScenarioCallbackSlotV2::ContinueEncounter,
        (false, "onGameOver") => ScenarioCallbackSlotV2::GameOver,
        (true, "onPreOptionPhase") => ScenarioCallbackSlotV2::OptionPre,
        (true, "onOptionPhase") => ScenarioCallbackSlotV2::OptionApply,
        (true, "onPostOptionPhase") => ScenarioCallbackSlotV2::OptionPost,
        _ => return Err(ScenarioBuildErrorV2::Invalid),
    };
    Ok(slot)
}

fn graph_nodes(
    localization_key: &str,
    options: &[ScenarioOptionDefinitionV2],
    behavior_units: &[GameBehaviorUnitId],
    nested_battle: bool,
) -> Result<Vec<ScenarioNodeEntryV2>, ScenarioBuildErrorV2> {
    let mut nodes = vec![
        ScenarioNodeEntryV2 {
            id: node_id(1)?,
            node: ScenarioNodeV2::Message {
                message_key: format!("{localization_key}.intro"),
                next: node_id(2)?,
            },
        },
        ScenarioNodeEntryV2 {
            id: node_id(2)?,
            node: ScenarioNodeV2::Choice {
                prompt_key: format!("{localization_key}.prompt"),
                edges: options
                    .iter()
                    .map(|option| {
                        Ok(ScenarioChoiceEdgeV2 {
                            option_index: option.option_index,
                            option_key: option.option_key.clone(),
                            target: node_id(3 + u64::from(option.option_index) * 2)?,
                        })
                    })
                    .collect::<Result<Vec<_>, ScenarioBuildErrorV2>>()?,
            },
        },
    ];
    for option in options {
        let execute = 3 + u64::from(option.option_index) * 2;
        let complete = execute + 1;
        nodes.push(ScenarioNodeEntryV2 {
            id: node_id(execute)?,
            node: ScenarioNodeV2::ExecuteOption {
                option_index: option.option_index,
                behavior_units: behavior_units.to_vec(),
                primary_party_target: !option.primary_pokemon_requirements.is_empty(),
                secondary_party_target: !option.secondary_pokemon_requirements.is_empty(),
                nested_battle,
                next: node_id(complete)?,
            },
        });
        nodes.push(ScenarioNodeEntryV2 {
            id: node_id(complete)?,
            node: ScenarioNodeV2::Complete {
                outcome_key: format!("{localization_key}.option.{}.complete", option.option_index),
            },
        });
    }
    Ok(nodes)
}

fn compile_requirements(
    values: Vec<Value>,
) -> Result<Vec<ScenarioRequirementV2>, ScenarioBuildErrorV2> {
    values.iter().map(compile_requirement).collect()
}

fn compile_requirement(value: &Value) -> Result<ScenarioRequirementV2, ScenarioBuildErrorV2> {
    let object = value.as_object().ok_or(ScenarioBuildErrorV2::Invalid)?;
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .ok_or(ScenarioBuildErrorV2::Invalid)?;
    let fields = object
        .get("fields")
        .and_then(Value::as_object)
        .ok_or(ScenarioBuildErrorV2::Invalid)?;
    let result = match kind {
        "WaveRangeRequirement" => {
            let [minimum, maximum] = pair_i64(field(fields, "waveRange")?)?;
            ScenarioRequirementV2::WaveRange { minimum, maximum }
        }
        "WaveModulusRequirement" => ScenarioRequirementV2::WaveModulus {
            modulus: number_u64(field(fields, "modulusValue")?)?,
            allowed: sorted_unique(numbers_u64(field(fields, "waveModuli")?)?),
        },
        "PartySizeRequirement" => {
            let [minimum, maximum] = pair_i64(field(fields, "partySizeRange")?)?;
            ScenarioRequirementV2::PartySize {
                minimum,
                maximum,
                exclude_disallowed: boolean(field(fields, "excludeDisallowedPokemon")?)?,
            }
        }
        "MoneyRequirement" => ScenarioRequirementV2::Money {
            amount: number_u64(field(fields, "requiredMoney")?)?,
            scaling: ratio(field(fields, "scalingMultiplier")?)?,
        },
        "PersistentModifierRequirement" => ScenarioRequirementV2::PersistentModifier {
            registry_keys: sorted_unique(strings(field(fields, "requiredHeldItemModifiers")?)?),
            minimum_items: number_u8(field(fields, "minNumberOfItems")?)?.into(),
        },
        "CombinationPokemonRequirement" => ScenarioRequirementV2::PokemonCombination {
            all: boolean(field(fields, "isAnd")?)?,
            requirements: compile_requirements(array(field(fields, "requirements")?)?.to_vec())?,
        },
        "TypeRequirement" => ScenarioRequirementV2::PokemonType {
            type_ids: sorted_unique(numbers_u8(field(fields, "requiredType")?)?),
            exclude_fainted: boolean(field(fields, "excludeFainted")?)?,
            minimum_pokemon: number_u8(field(fields, "minNumberOfPokemon")?)?,
            inverted: boolean(field(fields, "invertQuery")?)?,
        },
        "MoveRequirement" => ScenarioRequirementV2::PokemonMove {
            move_ids: sorted_unique(numbers_u64(field(fields, "requiredMoves")?)?),
            exclude_disallowed: boolean(field(fields, "excludeDisallowedPokemon")?)?,
            minimum_pokemon: number_u8(field(fields, "minNumberOfPokemon")?)?,
            inverted: boolean(field(fields, "invertQuery")?)?,
        },
        "CanLearnMoveRequirement" => ScenarioRequirementV2::PokemonCanLearnMove {
            move_ids: sorted_unique(numbers_u64(field(fields, "requiredMoves")?)?),
            exclude_level_moves: boolean(field(fields, "excludeLevelMoves")?)?,
            exclude_tm_moves: boolean(field(fields, "excludeTmMoves")?)?,
            exclude_egg_moves: boolean(field(fields, "excludeEggMoves")?)?,
            include_fainted: boolean(field(fields, "includeFainted")?)?,
            minimum_pokemon: number_u8(field(fields, "minNumberOfPokemon")?)?,
            inverted: boolean(field(fields, "invertQuery")?)?,
        },
        "AbilityRequirement" => ScenarioRequirementV2::PokemonAbility {
            ability_ids: sorted_unique(numbers_u64(field(fields, "requiredAbilities")?)?),
            exclude_disallowed: boolean(field(fields, "excludeDisallowedPokemon")?)?,
            minimum_pokemon: number_u8(field(fields, "minNumberOfPokemon")?)?,
            inverted: boolean(field(fields, "invertQuery")?)?,
        },
        "HealthRatioRequirement" => {
            let [minimum, maximum] = pair(field(fields, "requiredHealthRange")?)?;
            ScenarioRequirementV2::PokemonHealthRatio {
                minimum: ratio(minimum)?,
                maximum: ratio(maximum)?,
                minimum_pokemon: number_u8(field(fields, "minNumberOfPokemon")?)?,
                inverted: boolean(field(fields, "invertQuery")?)?,
            }
        }
        "HeldItemRequirement" => ScenarioRequirementV2::PokemonHeldItem {
            registry_keys: sorted_unique(strings(field(fields, "requiredHeldItemModifiers")?)?),
            transferable: boolean(field(fields, "requireTransferable")?)?,
            minimum_pokemon: number_u8(field(fields, "minNumberOfPokemon")?)?,
            inverted: boolean(field(fields, "invertQuery")?)?,
        },
        "AttackTypeBoosterHeldItemTypeRequirement" => {
            ScenarioRequirementV2::PokemonAttackBoosterType {
                type_ids: sorted_unique(numbers_u8(field(fields, "requiredHeldItemTypes")?)?),
                transferable: boolean(field(fields, "requireTransferable")?)?,
                minimum_pokemon: number_u8(field(fields, "minNumberOfPokemon")?)?,
                inverted: boolean(field(fields, "invertQuery")?)?,
            }
        }
        _ => return Err(ScenarioBuildErrorV2::Invalid),
    };
    Ok(result)
}

fn scenario_slug(key: &str) -> String {
    key.strip_prefix("ER_")
        .unwrap_or(key)
        .to_ascii_lowercase()
        .replace('_', "-")
}

fn ratio(value: &Value) -> Result<ScenarioRatioV1, ScenarioBuildErrorV2> {
    let text = value.to_string();
    let negative = text.starts_with('-');
    let unsigned = text.trim_start_matches('-');
    let (whole, fraction) = unsigned.split_once('.').unwrap_or((unsigned, ""));
    let denominator = 10_u64
        .checked_pow(u32::try_from(fraction.len()).map_err(|_| ScenarioBuildErrorV2::Invalid)?)
        .ok_or(ScenarioBuildErrorV2::Invalid)?;
    let whole_value = whole
        .parse::<u64>()
        .map_err(|_| ScenarioBuildErrorV2::Invalid)?;
    let fraction_value = if fraction.is_empty() {
        0
    } else {
        fraction
            .parse::<u64>()
            .map_err(|_| ScenarioBuildErrorV2::Invalid)?
    };
    let unsigned_numerator = whole_value
        .checked_mul(denominator)
        .and_then(|value| value.checked_add(fraction_value))
        .ok_or(ScenarioBuildErrorV2::Invalid)?;
    let numerator = i64::try_from(unsigned_numerator).map_err(|_| ScenarioBuildErrorV2::Invalid)?;
    let signed_numerator = if negative { -numerator } else { numerator };
    let divisor = gcd(signed_numerator.unsigned_abs(), denominator);
    Ok(ScenarioRatioV1 {
        numerator: signed_numerator
            / i64::try_from(divisor).map_err(|_| ScenarioBuildErrorV2::Invalid)?,
        denominator: denominator / divisor,
    })
}

fn gcd(mut left: u64, mut right: u64) -> u64 {
    while right != 0 {
        (left, right) = (right, left % right);
    }
    left
}

fn field<'a>(
    fields: &'a serde_json::Map<String, Value>,
    key: &str,
) -> Result<&'a Value, ScenarioBuildErrorV2> {
    fields.get(key).ok_or(ScenarioBuildErrorV2::Invalid)
}

fn array(value: &Value) -> Result<&[Value], ScenarioBuildErrorV2> {
    value
        .as_array()
        .map(Vec::as_slice)
        .ok_or(ScenarioBuildErrorV2::Invalid)
}

fn pair(value: &Value) -> Result<[&Value; 2], ScenarioBuildErrorV2> {
    let [left, right] = array(value)? else {
        return Err(ScenarioBuildErrorV2::Invalid);
    };
    Ok([left, right])
}

fn pair_i64(value: &Value) -> Result<[i64; 2], ScenarioBuildErrorV2> {
    let [left, right] = pair(value)?;
    Ok([number_i64(left)?, number_i64(right)?])
}

fn boolean(value: &Value) -> Result<bool, ScenarioBuildErrorV2> {
    value.as_bool().ok_or(ScenarioBuildErrorV2::Invalid)
}

fn number_i64(value: &Value) -> Result<i64, ScenarioBuildErrorV2> {
    value.as_i64().ok_or(ScenarioBuildErrorV2::Invalid)
}

fn number_u64(value: &Value) -> Result<u64, ScenarioBuildErrorV2> {
    value.as_u64().ok_or(ScenarioBuildErrorV2::Invalid)
}

fn number_u8(value: &Value) -> Result<u8, ScenarioBuildErrorV2> {
    u8::try_from(number_u64(value)?).map_err(|_| ScenarioBuildErrorV2::Invalid)
}

fn numbers_u64(value: &Value) -> Result<Vec<u64>, ScenarioBuildErrorV2> {
    array(value)?.iter().map(number_u64).collect()
}

fn numbers_u8(value: &Value) -> Result<Vec<u8>, ScenarioBuildErrorV2> {
    array(value)?.iter().map(number_u8).collect()
}

fn strings(value: &Value) -> Result<Vec<String>, ScenarioBuildErrorV2> {
    array(value)?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or(ScenarioBuildErrorV2::Invalid)
        })
        .collect()
}

fn sorted_unique<T: Ord>(mut values: Vec<T>) -> Vec<T> {
    values.sort();
    values.dedup();
    values
}

fn safe(value: u64) -> Result<SafeU53, ScenarioBuildErrorV2> {
    SafeU53::new(value).map_err(|_| ScenarioBuildErrorV2::Invalid)
}

fn node_id(value: u64) -> Result<ScenarioNodeId, ScenarioBuildErrorV2> {
    Ok(ScenarioNodeId::new(safe(value)?))
}

fn decode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, ScenarioBuildErrorV2> {
    serde_json::from_slice(bytes).map_err(|error| ScenarioBuildErrorV2::Decode(error.to_string()))
}
