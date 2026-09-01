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
pub enum ScenarioCompiledEffectV2 {
    RestoreParty,
}

#[derive(Clone, Debug)]
pub struct PreparedScenarioContentV2 {
    pack: Arc<ScenarioContentPackV2>,
    scenarios: BTreeMap<ScenarioId, usize>,
    behaviors: BTreeMap<GameBehaviorUnitId, usize>,
    option_effects: BTreeMap<(ScenarioId, u8), Vec<ScenarioCompiledEffectV2>>,
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
        let option_effects = self
            .scenarios
            .iter()
            .flat_map(|scenario| {
                scenario.options.iter().filter_map(|option| {
                    compile_known_option_effects(scenario, option)
                        .map(|effects| ((scenario.id, option.option_index), effects))
                })
            })
            .collect();
        Ok(PreparedScenarioContentV2 {
            pack: Arc::new(self),
            scenarios,
            behaviors,
            option_effects,
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

    pub fn option_effects(
        &self,
        scenario: ScenarioId,
        option: u8,
    ) -> Option<&[ScenarioCompiledEffectV2]> {
        self.option_effects
            .get(&(scenario, option))
            .map(Vec::as_slice)
    }
}

fn compile_known_option_effects(
    scenario: &ScenarioDefinitionV2,
    option: &ScenarioOptionDefinitionV2,
) -> Option<Vec<ScenarioCompiledEffectV2>> {
    let callback_sha = option
        .callbacks
        .iter()
        .find(|callback| callback.slot == ScenarioCallbackSlotV2::OptionPhase)?
        .sha256
        .as_str();
    if callback_has_no_canonical_effects(callback_sha) {
        return Some(Vec::new());
    }
    match (scenario.id.get().get(), option.option_index, callback_sha) {
        (73, 0, "36655e9af0ef2718fc59812babf5584af44146d289918d3c5037e4f59eb36a8d") => {
            Some(vec![ScenarioCompiledEffectV2::RestoreParty])
        }
        _ => None,
    }
}

fn callback_has_no_canonical_effects(callback_sha: &str) -> bool {
    matches!(
        callback_sha,
        "0d9b385a5bba574f55206f9496c997e746819d5ac19037c726d85554e683d6e7"
            | "0ff710dbeec3f9391911e04c6f07c2a34337e636fc95c15e5bd987def7d1a3db"
            | "13484df1f54c53b3513cd65088304bce401cfa7b6d025a7aef9e3163155ee5f1"
            | "17af498336692497e12accd41e9ddc96e05cf87dbb434ee2d9518012c61f284d"
            | "188171dc06049055f94986b51f5290336fefbd457dba7cbb8fcf951c2878ebf1"
            | "1b72e5886eef0862a7f7d3ca268fab29cac9bc3ede551be008432b93ca3958ba"
            | "20939cce20593b9fc96c0dc0aa5c3b662fa050eff8e2b8d449fa10d236350d6c"
            | "218119858149664f3451ce2f82721cb0d4f7c16598aef87f1d0c4c833a68973f"
            | "28cd4c21286bf25d28679ae39ba1501fcce646dbf9a482f6c211cedeba77ef73"
            | "2a8866df33e2b28c1cb7da66f541037b06f88efc5e72099bfa000c404d3693e0"
            | "2e5a16437bafb073b6748ff78f231246e5ccd3cb36a1235f6dd2d8067cf950ed"
            | "32b2d65acb8c0f7746a6dcc11ec7146d7747a9985d3060d4e389048d6767e0ab"
            | "34a1e26e75ca230e5ebc7cb8ce9b0d67e2c436d7b4aa2fba212c30dc3b468933"
            | "390a2abdad17a286818992e2b25e8e018a1995a6f31a4bd7420890362cc53502"
            | "40576c026beae347e9578566bc960101ad8380b1a91877f861225cb68f6b4dfc"
            | "40e5ffa91d14ffdba01123bcbc55f3e1816f78d5c75f882d6bfc971ef8e25239"
            | "4760208b5f29f5eaa69f7ea25872b80a24d9b5fdf383704ba16ce0f7600f1241"
            | "4a04e15b9a0ab193243051c410197b6c2d57e7143748e03181785a102dd52d34"
            | "56983a3558f11829cfe3859f5d8208745ebf330985d1f206f9bddba41ac024ef"
            | "595e251bff89b957beb7f0f3d4c206e6e2524746ad9622d5b16cc8246871a729"
            | "5a6fe8a4fe48dcbcbec55a435e3172900290dc9153f497578e19fe0136fdc679"
            | "60e6e36b04b8dfa563a2e73760d5a680c7de169dbcc876d15246fa76ccbc393b"
            | "61dce4a35f5a93a241835ab034b8b134a96cfe3852ab867a6dfe2186399bf282"
            | "6922cfc90eba99fcd167d9b568ddc899949056983628d66bb0eafb3a282b510d"
            | "7bd8ab95d4bb77ef199fdffe380afd7fbf56624f68799f2fc3465864c420ae4f"
            | "7c895423366e4e122aaf0ea921fde40c20d788ccb084933a8ca59eb6b1065b11"
            | "823e4cfc692840b8d3029a1844f484c08fadc9585bd5d326fcef40e01ab1ec35"
            | "854ce78df5492daafab96c59aa472eff0e1252b721ed7e0759584d7a5aba4efb"
            | "8f4ab225958f2af1e22f9338a7e20a585328ab8e5d81694c6a47a6fddd6ee3b3"
            | "91d61fd6bdb2cd4bab1538b368b6bcab31bc7c8272c677f33b4b4212d5a5f422"
            | "964d1ce44377d70bbfb915840f6b63f53d59737c2acc070eefd13c7a26e60711"
            | "9e29526e0a872e6433f1349408461e4bf12060753fd13c5dfdd860b803b89cea"
            | "a0becc89fab74950c546e89418275473d32c6ae24e6d180b1d75b05d2bdf7730"
            | "a6562cb1c78f03fc4161e3203e3693122801cc6de6094403f3ca1a6dc630bcbf"
            | "a922d0edc76e7bdcf28dbfd02f30fd0a7351f46c26d00d5438bf5d04402c3393"
            | "b596fde89014c3a0ed2348614d37ae384e08e11e8b25bb0296b6f9116bc1c970"
            | "c68aa8d562cc335018b2089341fe647ecb7ca7d2dcad70c1dd98cb97b952bfd5"
            | "cc448f6acc803ef023f2c214442161bef9c1eaf613b0059965b871c0f4a72c17"
            | "d860f6f3bddfd1e9cb72910a736c7bbd23e82838577daf1b236ef11c5f9c98f8"
            | "dede57a6ef8cedd950e154987dc1330d9c6023bf98d74c4c12a410fcd2624dbc"
            | "df5d64ce53df9de6d44212a0dc4b134f86ed8ccee8278acef87591716a6d0d73"
            | "e0ce48c46d8c6dc284e7e30c4cd84f93d0f330cd9c107494011230da7f67925e"
            | "e9f3012576babdce31ce1f5096821d1b191034c6a478859ea157d0df912659cb"
            | "eaa369bd3a2b26bdf3518a156e55f99574da049b1daef46a4f6500de14b71361"
            | "eef4cd0ef004d296fe1fde2cffb6a8e9c4d8acc498ead47d415e15f9dc39e49c"
            | "f6845e6f72508eb1a86ad9faa81e9cef6683dd39d3efb11f7ea454b4caf5be09"
            | "fe7d5ed79aaf17174e1db717bb6c30bfe63810b1faf2a0921ccc885779d11336"
    )
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
