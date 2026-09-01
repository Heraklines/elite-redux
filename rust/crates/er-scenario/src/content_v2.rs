//! Complete source-bound M9-E scenario content and prepared indexes.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::Arc;

use er_canonical::content_digest;
use er_types::{CatalogHash, GameBehaviorUnitId, OracleSha, ScenarioId, ScenarioNodeId};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V2: u32 = 2;

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScenarioCallbackSlotV2 {
    Init,
    VisualsStart,
    TurnStart,
    Rewards,
    EncounterExperience,
    EncounterRewards,
    ContinueEncounter,
    GameOver,
    OptionPre,
    OptionApply,
    OptionPost,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioCallbackEvidenceV2 {
    pub slot: ScenarioCallbackSlotV2,
    pub sha256: String,
    pub asynchronous: bool,
    pub source_length: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioRatioV1 {
    pub numerator: i64,
    pub denominator: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ScenarioRequirementV2 {
    WaveRange {
        minimum: i64,
        maximum: i64,
    },
    WaveModulus {
        modulus: u64,
        allowed: Vec<u64>,
    },
    PartySize {
        minimum: i64,
        maximum: i64,
        exclude_disallowed: bool,
    },
    Money {
        amount: u64,
        scaling: ScenarioRatioV1,
    },
    PersistentModifier {
        registry_keys: Vec<String>,
        minimum_items: u32,
    },
    PokemonCombination {
        all: bool,
        requirements: Vec<ScenarioRequirementV2>,
    },
    PokemonType {
        type_ids: Vec<u8>,
        exclude_fainted: bool,
        minimum_pokemon: u8,
        inverted: bool,
    },
    PokemonMove {
        move_ids: Vec<u64>,
        exclude_disallowed: bool,
        minimum_pokemon: u8,
        inverted: bool,
    },
    PokemonCanLearnMove {
        move_ids: Vec<u64>,
        exclude_level_moves: bool,
        exclude_tm_moves: bool,
        exclude_egg_moves: bool,
        include_fainted: bool,
        minimum_pokemon: u8,
        inverted: bool,
    },
    PokemonAbility {
        ability_ids: Vec<u64>,
        exclude_disallowed: bool,
        minimum_pokemon: u8,
        inverted: bool,
    },
    PokemonHealthRatio {
        minimum: ScenarioRatioV1,
        maximum: ScenarioRatioV1,
        minimum_pokemon: u8,
        inverted: bool,
    },
    PokemonHeldItem {
        registry_keys: Vec<String>,
        transferable: bool,
        minimum_pokemon: u8,
        inverted: bool,
    },
    PokemonAttackBoosterType {
        type_ids: Vec<u8>,
        transferable: bool,
        minimum_pokemon: u8,
        inverted: bool,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioFlagsV2 {
    pub hide_battle_intro_message: bool,
    pub auto_hide_intro_visuals: bool,
    pub enter_intro_visuals_from_right: bool,
    pub catch_allowed: bool,
    pub flee_allowed: bool,
    pub continuous_encounter: bool,
    pub max_allowed_encounters: u8,
    pub has_battle_animations_without_targets: bool,
    pub skip_enemy_battle_turns: bool,
    pub skip_to_fight_input: bool,
    pub prevent_game_stats_updates: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioOptionDefinitionV2 {
    pub option_index: u8,
    pub option_key: String,
    pub option_mode: u8,
    pub has_dex_progress: bool,
    pub exclude_primary_from_secondary_requirements: bool,
    pub requirements: Vec<ScenarioRequirementV2>,
    pub primary_pokemon_requirements: Vec<ScenarioRequirementV2>,
    pub secondary_pokemon_requirements: Vec<ScenarioRequirementV2>,
    pub callbacks: Vec<ScenarioCallbackEvidenceV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum ScenarioNodeV2 {
    Message {
        message_key: String,
        next: ScenarioNodeId,
    },
    Choice {
        prompt_key: String,
        edges: Vec<ScenarioChoiceEdgeV2>,
    },
    ExecuteOption {
        option_index: u8,
        behavior_units: Vec<GameBehaviorUnitId>,
        primary_party_target: bool,
        secondary_party_target: bool,
        nested_battle: bool,
        next: ScenarioNodeId,
    },
    Complete {
        outcome_key: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioChoiceEdgeV2 {
    pub option_index: u8,
    pub option_key: String,
    pub target: ScenarioNodeId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioNodeEntryV2 {
    pub id: ScenarioNodeId,
    pub node: ScenarioNodeV2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ScenarioBehaviorHandlerV2 {
    EvaluateCondition,
    AvailableChoices,
    Advance,
    StartNestedBattle,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioBehaviorBindingV2 {
    pub behavior_unit: GameBehaviorUnitId,
    pub group_id: String,
    pub source_path: String,
    pub source_line: u32,
    pub source_column: u32,
    pub symbol: String,
    pub asynchronous: bool,
    pub parameter_count: u16,
    pub handler: ScenarioBehaviorHandlerV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioDefinitionV2 {
    pub id: ScenarioId,
    pub key: String,
    pub localization_key: String,
    pub tier: u8,
    pub biome_ids: Vec<u64>,
    pub disallowed_game_modes: Vec<u64>,
    pub disallowed_challenges: Vec<u64>,
    pub flags: ScenarioFlagsV2,
    pub requirements: Vec<ScenarioRequirementV2>,
    pub primary_pokemon_requirements: Vec<ScenarioRequirementV2>,
    pub secondary_pokemon_requirements: Vec<ScenarioRequirementV2>,
    pub exclude_primary_from_support_requirements: bool,
    pub callbacks: Vec<ScenarioCallbackEvidenceV2>,
    pub options: Vec<ScenarioOptionDefinitionV2>,
    pub entry: ScenarioNodeId,
    pub nodes: Vec<ScenarioNodeEntryV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioContentPackV2 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub scenarios: Vec<ScenarioDefinitionV2>,
    pub behavior_bindings: Vec<ScenarioBehaviorBindingV2>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ScenarioProgramHandlerV2 {
    GroupA,
    GroupB,
    GroupC,
    GroupD,
    GroupE,
    GroupF,
    GroupG,
    GroupH,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScenarioOptionProgramV2 {
    pub scenario: ScenarioId,
    pub option_index: u8,
    pub pre_callback_sha256: Option<String>,
    pub apply_callback_sha256: String,
    pub post_callback_sha256: Option<String>,
    pub handler: ScenarioProgramHandlerV2,
}

#[derive(Clone, Debug)]
pub struct PreparedScenarioContentV2 {
    pack: Arc<ScenarioContentPackV2>,
    scenarios: BTreeMap<ScenarioId, usize>,
    behaviors: BTreeMap<GameBehaviorUnitId, usize>,
    option_programs: BTreeMap<(ScenarioId, u8), ScenarioOptionProgramV2>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum ScenarioContentV2Error {
    #[error("scenario V2 identity or hash is invalid")]
    Identity,
    #[error("scenario V2 collection, graph, callback, or requirement is invalid")]
    Closure,
    #[error("scenario V2 canonical hashing failed: {0}")]
    Hash(String),
}

#[derive(Serialize)]
struct ScenarioHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    scenarios: &'a [ScenarioDefinitionV2],
    behavior_bindings: &'a [ScenarioBehaviorBindingV2],
}

impl ScenarioContentPackV2 {
    pub fn recompute_hash(&self) -> Result<CatalogHash, ScenarioContentV2Error> {
        let digest = content_digest(&ScenarioHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            scenarios: &self.scenarios,
            behavior_bindings: &self.behavior_bindings,
        })
        .map_err(|error| ScenarioContentV2Error::Hash(error.to_string()))?;
        CatalogHash::parse(digest).map_err(|_| ScenarioContentV2Error::Identity)
    }

    pub fn validate(&self) -> Result<(), ScenarioContentV2Error> {
        if self.schema_version != SCENARIO_CONTENT_PACK_SCHEMA_VERSION_V2
            || self.content_hash != self.recompute_hash()?
            || self.scenarios.is_empty()
            || self.behavior_bindings.is_empty()
            || self
                .scenarios
                .windows(2)
                .any(|pair| pair[0].id >= pair[1].id)
            || self
                .behavior_bindings
                .windows(2)
                .any(|pair| pair[0].behavior_unit >= pair[1].behavior_unit)
        {
            return Err(ScenarioContentV2Error::Identity);
        }
        for scenario in &self.scenarios {
            validate_scenario(scenario)?;
        }
        if self.behavior_bindings.iter().any(|binding| {
            binding.group_id.is_empty()
                || binding.source_path.is_empty()
                || binding.source_line == 0
                || binding.source_column == 0
                || binding.symbol.is_empty()
        }) {
            return Err(ScenarioContentV2Error::Closure);
        }
        Ok(())
    }

    pub fn prepare(self) -> Result<PreparedScenarioContentV2, ScenarioContentV2Error> {
        self.validate()?;
        let scenarios = self
            .scenarios
            .iter()
            .enumerate()
            .map(|(index, scenario)| (scenario.id, index))
            .collect();
        let behaviors = self
            .behavior_bindings
            .iter()
            .enumerate()
            .map(|(index, binding)| (binding.behavior_unit.clone(), index))
            .collect();
        let option_programs = self
            .scenarios
            .iter()
            .flat_map(|scenario| {
                scenario.options.iter().map(|option| {
                    compile_option_program(scenario, option)
                        .map(|program| ((scenario.id, option.option_index), program))
                })
            })
            .collect::<Result<_, _>>()?;
        Ok(PreparedScenarioContentV2 {
            pack: Arc::new(self),
            scenarios,
            behaviors,
            option_programs,
        })
    }
}

impl PreparedScenarioContentV2 {
    pub fn pack(&self) -> &ScenarioContentPackV2 {
        &self.pack
    }

    pub fn scenario(&self, id: ScenarioId) -> Option<&ScenarioDefinitionV2> {
        self.scenarios
            .get(&id)
            .and_then(|index| self.pack.scenarios.get(*index))
    }

    pub fn behavior(&self, id: &GameBehaviorUnitId) -> Option<&ScenarioBehaviorBindingV2> {
        self.behaviors
            .get(id)
            .and_then(|index| self.pack.behavior_bindings.get(*index))
    }

    pub fn option_program(
        &self,
        scenario: ScenarioId,
        option: u8,
    ) -> Option<&ScenarioOptionProgramV2> {
        self.option_programs.get(&(scenario, option))
    }
}

fn compile_option_program(
    scenario: &ScenarioDefinitionV2,
    option: &ScenarioOptionDefinitionV2,
) -> Result<ScenarioOptionProgramV2, ScenarioContentV2Error> {
    let callback = |slot| {
        option
            .callbacks
            .iter()
            .find(|callback| callback.slot == slot)
            .map(|callback| callback.sha256.clone())
    };
    let apply_callback_sha256 =
        callback(ScenarioCallbackSlotV2::OptionApply).ok_or(ScenarioContentV2Error::Closure)?;
    let handler = match scenario.id.get().get() {
        0..=11 => ScenarioProgramHandlerV2::GroupA,
        12..=22 => ScenarioProgramHandlerV2::GroupB,
        23..=33 => ScenarioProgramHandlerV2::GroupC,
        34..=44 => ScenarioProgramHandlerV2::GroupD,
        45..=55 => ScenarioProgramHandlerV2::GroupE,
        56..=66 => ScenarioProgramHandlerV2::GroupF,
        67..=78 => ScenarioProgramHandlerV2::GroupG,
        79..=90 => ScenarioProgramHandlerV2::GroupH,
        _ => return Err(ScenarioContentV2Error::Closure),
    };
    Ok(ScenarioOptionProgramV2 {
        scenario: scenario.id,
        option_index: option.option_index,
        pre_callback_sha256: callback(ScenarioCallbackSlotV2::OptionPre),
        apply_callback_sha256,
        post_callback_sha256: callback(ScenarioCallbackSlotV2::OptionPost),
        handler,
    })
}

fn validate_scenario(scenario: &ScenarioDefinitionV2) -> Result<(), ScenarioContentV2Error> {
    if scenario.key.is_empty()
        || scenario.localization_key.is_empty()
        || scenario.options.len() < 2
        || scenario.flags.max_allowed_encounters == 0
        || scenario.options.iter().enumerate().any(|(index, option)| {
            option.option_index as usize != index || option.option_key.is_empty()
        })
        || !is_sorted_unique(&scenario.biome_ids)
        || !is_sorted_unique(&scenario.disallowed_game_modes)
        || !is_sorted_unique(&scenario.disallowed_challenges)
        || scenario.nodes.is_empty()
        || scenario
            .nodes
            .windows(2)
            .any(|pair| pair[0].id >= pair[1].id)
    {
        return Err(ScenarioContentV2Error::Closure);
    }
    validate_callbacks(&scenario.callbacks)?;
    validate_requirements(&scenario.requirements)?;
    validate_requirements(&scenario.primary_pokemon_requirements)?;
    validate_requirements(&scenario.secondary_pokemon_requirements)?;
    for option in &scenario.options {
        validate_callbacks(&option.callbacks)?;
        validate_requirements(&option.requirements)?;
        validate_requirements(&option.primary_pokemon_requirements)?;
        validate_requirements(&option.secondary_pokemon_requirements)?;
    }
    validate_graph(scenario)
}

fn validate_callbacks(
    callbacks: &[ScenarioCallbackEvidenceV2],
) -> Result<(), ScenarioContentV2Error> {
    let mut slots = BTreeSet::new();
    if callbacks.iter().any(|callback| {
        !slots.insert(callback.slot)
            || callback.source_length == 0
            || callback.sha256.len() != 64
            || !callback
                .sha256
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }) {
        return Err(ScenarioContentV2Error::Closure);
    }
    Ok(())
}

fn validate_requirements(
    requirements: &[ScenarioRequirementV2],
) -> Result<(), ScenarioContentV2Error> {
    if requirements.iter().any(|requirement| match requirement {
        ScenarioRequirementV2::WaveRange { minimum, maximum } => minimum > maximum,
        ScenarioRequirementV2::WaveModulus { modulus, allowed } => {
            *modulus == 0
                || allowed.is_empty()
                || !is_sorted_unique(allowed)
                || allowed.iter().any(|value| value >= modulus)
        }
        ScenarioRequirementV2::PartySize {
            minimum, maximum, ..
        } => minimum > maximum,
        ScenarioRequirementV2::Money { scaling, .. } => scaling.denominator == 0,
        ScenarioRequirementV2::PersistentModifier {
            registry_keys,
            minimum_items,
        } => *minimum_items == 0 || invalid_keys(registry_keys),
        ScenarioRequirementV2::PokemonCombination { requirements, .. } => {
            requirements.is_empty() || validate_requirements(requirements).is_err()
        }
        ScenarioRequirementV2::PokemonType {
            type_ids,
            minimum_pokemon,
            ..
        }
        | ScenarioRequirementV2::PokemonAttackBoosterType {
            type_ids,
            minimum_pokemon,
            ..
        } => type_ids.is_empty() || *minimum_pokemon == 0 || !is_sorted_unique(type_ids),
        ScenarioRequirementV2::PokemonMove {
            move_ids,
            minimum_pokemon,
            ..
        }
        | ScenarioRequirementV2::PokemonCanLearnMove {
            move_ids,
            minimum_pokemon,
            ..
        } => move_ids.is_empty() || *minimum_pokemon == 0 || !is_sorted_unique(move_ids),
        ScenarioRequirementV2::PokemonAbility {
            ability_ids,
            minimum_pokemon,
            ..
        } => ability_ids.is_empty() || *minimum_pokemon == 0 || !is_sorted_unique(ability_ids),
        ScenarioRequirementV2::PokemonHealthRatio {
            minimum,
            maximum,
            minimum_pokemon,
            ..
        } => {
            minimum.denominator == 0
                || maximum.denominator == 0
                || *minimum_pokemon == 0
                || i128::from(minimum.numerator) * i128::from(maximum.denominator)
                    > i128::from(maximum.numerator) * i128::from(minimum.denominator)
        }
        ScenarioRequirementV2::PokemonHeldItem {
            registry_keys,
            minimum_pokemon,
            ..
        } => *minimum_pokemon == 0 || invalid_keys(registry_keys),
    }) {
        return Err(ScenarioContentV2Error::Closure);
    }
    Ok(())
}

fn validate_graph(scenario: &ScenarioDefinitionV2) -> Result<(), ScenarioContentV2Error> {
    let node_ids = scenario
        .nodes
        .iter()
        .map(|entry| entry.id)
        .collect::<BTreeSet<_>>();
    if !node_ids.contains(&scenario.entry) {
        return Err(ScenarioContentV2Error::Closure);
    }
    let mut reached = BTreeSet::new();
    let mut queue = VecDeque::from([scenario.entry]);
    while let Some(id) = queue.pop_front() {
        if !reached.insert(id) {
            continue;
        }
        let node = scenario
            .nodes
            .iter()
            .find(|entry| entry.id == id)
            .ok_or(ScenarioContentV2Error::Closure)?;
        for target in node_targets(&node.node) {
            if !node_ids.contains(&target) {
                return Err(ScenarioContentV2Error::Closure);
            }
            queue.push_back(target);
        }
    }
    if reached != node_ids {
        return Err(ScenarioContentV2Error::Closure);
    }
    Ok(())
}

fn node_targets(node: &ScenarioNodeV2) -> Vec<ScenarioNodeId> {
    match node {
        ScenarioNodeV2::Message { next, .. } | ScenarioNodeV2::ExecuteOption { next, .. } => {
            vec![*next]
        }
        ScenarioNodeV2::Choice { edges, .. } => edges.iter().map(|edge| edge.target).collect(),
        ScenarioNodeV2::Complete { .. } => Vec::new(),
    }
}

fn invalid_keys(values: &[String]) -> bool {
    values.is_empty() || values.iter().any(String::is_empty) || !is_sorted_unique(values)
}

fn is_sorted_unique<T: Ord>(values: &[T]) -> bool {
    values.windows(2).all(|pair| pair[0] < pair[1])
}
