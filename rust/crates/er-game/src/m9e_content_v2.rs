//! M9-E complete generic content bundle extension for GameKernelV7.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_ai::content_v2::{AiPolicyPackV2, PreparedAiPolicyContentV2};
use er_canonical::content_digest;
use er_content::pack::m6_pack::BattleContentPackV3;
use er_content::pack::m6_prepared::{PreparedBattleContentV3, prepare_content};
use er_progression::content_v2::{PreparedProgressionContentV2, ProgressionContentPackV2};
use er_scenario::content_v2::{PreparedScenarioContentV2, ScenarioContentPackV2};
use er_state::m9e_state_v6::GameStateV6ContentContext;
use er_types::battle_ids::{GameModeId, MoveId, SpeciesId};
use er_types::battle_ui::{PresentationBlockingPolicy, PresentationSkipPolicy};
use er_types::run_ids::BiomeId;
use er_types::{
    CatalogHash, GameBehaviorStatus, GameContentBundleHash, GameContentIdentityV2,
    GameControlKindV2, OracleSha, RunDifficultyV1, SafeU53, SetupChoiceIdV1, SetupChoiceValueV1,
};
use er_world::content_v2::{PreparedWorldContentV2, WorldContentPackV2};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_content::{
    MetaContentPackV1, PreparedMetaContentV1, PreparedRunContentV3, RunContentPackV3,
};

pub const GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V2: u32 = 2;
pub const BOOTSTRAP_CONTENT_SCHEMA_VERSION_V1: u32 = 1;
pub const PRESENTATION_CONTENT_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LevelMoveDefinitionV1 {
    pub level: i16,
    pub move_id: MoveId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StarterDefinitionV2 {
    pub species_id: SpeciesId,
    pub form_index: u16,
    pub cost: u16,
    pub ability_index: u8,
    pub level_moves: Vec<LevelMoveDefinitionV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapModeDefinitionV2 {
    pub mode: GameModeId,
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
pub struct SetupChoiceDefinitionV2 {
    pub id: SetupChoiceIdV1,
    pub values: Vec<SetupChoiceValueV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapContentPackV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub modes: Vec<BootstrapModeDefinitionV2>,
    pub starters: Vec<StarterDefinitionV2>,
    pub choices: Vec<SetupChoiceDefinitionV2>,
    pub difficulties: Vec<RunDifficultyV1>,
    pub maximum_starter_cost: u16,
    pub maximum_starters: usize,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationCueFamilyV1 {
    Move,
    Ability,
    HeldItem,
    Hp,
    Status,
    Stat,
    Switch,
    Faint,
    Capture,
    Progression,
    Evolution,
    Fusion,
    Reward,
    Market,
    World,
    Scenario,
    Save,
    Waiting,
    Terminal,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationUiRoleV1 {
    Heading,
    Body,
    EnabledOption,
    DisabledOption,
    Cursor,
    PartyMember,
    Item,
    Target,
    Status,
    Currency,
    Progress,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum PresentationSemanticIdV1 {
    Control(GameControlKindV2),
    Cue(PresentationCueFamilyV1),
    UiRole(PresentationUiRoleV1),
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationAssetIdentityV1 {
    InterfaceWindow,
    Cursor,
    PartyIcon,
    ItemIcon,
    PokemonSprite,
    BattleEffect,
    WorldBackdrop,
    ScenarioSprite,
    TerminalOverlay,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationAudioCueV1 {
    Confirm,
    Cancel,
    Cursor,
    Battle,
    Capture,
    Reward,
    Evolution,
    Error,
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReducedPresentationPolicyV1 {
    Essential,
    Reducible,
    Omit,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationSemanticMappingV1 {
    pub semantic: PresentationSemanticIdV1,
    pub text_key: String,
    pub assets: Vec<PresentationAssetIdentityV1>,
    pub audio_cue: Option<PresentationAudioCueV1>,
    pub blocking: PresentationBlockingPolicy,
    pub skip: PresentationSkipPolicy,
    pub reduced: ReducedPresentationPolicyV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationContentPackV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub mappings: Vec<PresentationSemanticMappingV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameContentBundleV2 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub battle: Arc<BattleContentPackV3>,
    pub run: Arc<RunContentPackV3>,
    pub progression: Arc<ProgressionContentPackV2>,
    pub world: Arc<WorldContentPackV2>,
    pub scenarios: Arc<ScenarioContentPackV2>,
    pub ai: Arc<AiPolicyPackV2>,
    pub meta: Arc<MetaContentPackV1>,
    pub bootstrap: Arc<BootstrapContentPackV1>,
    pub presentation: Arc<PresentationContentPackV1>,
    pub content_hash: GameContentBundleHash,
}

#[derive(Clone, Debug)]
pub struct PreparedGameContentV2 {
    identity: GameContentIdentityV2,
    bundle: Arc<GameContentBundleV2>,
    pub battle: PreparedBattleContentV3,
    pub run: PreparedRunContentV3,
    pub progression: PreparedProgressionContentV2,
    pub world: PreparedWorldContentV2,
    pub scenarios: PreparedScenarioContentV2,
    pub ai: PreparedAiPolicyContentV2,
    pub meta: PreparedMetaContentV1,
    presentation: BTreeMap<PresentationSemanticIdV1, usize>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameContentV2Error {
    #[error("V2 content schema or oracle identity is invalid")]
    Identity,
    #[error("V2 bootstrap content is invalid")]
    Bootstrap,
    #[error("V2 presentation content is invalid")]
    Presentation,
    #[error("V2 content cross-reference is unresolved")]
    CrossReference,
    #[error("V2 content hash is invalid: {0}")]
    Hash(String),
    #[error("V2 domain content is invalid: {0}")]
    Domain(String),
}

#[derive(Serialize)]
struct BootstrapHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    modes: &'a [BootstrapModeDefinitionV2],
    starters: &'a [StarterDefinitionV2],
    choices: &'a [SetupChoiceDefinitionV2],
    difficulties: &'a [RunDifficultyV1],
    maximum_starter_cost: u16,
    maximum_starters: usize,
}

#[derive(Serialize)]
struct PresentationHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    mappings: &'a [PresentationSemanticMappingV1],
}

#[derive(Serialize)]
struct BundleHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    battle_hash: &'a er_types::BattleContentPackHashV3,
    run_hash: &'a CatalogHash,
    progression_hash: &'a CatalogHash,
    world_hash: &'a CatalogHash,
    scenario_hash: &'a CatalogHash,
    ai_hash: &'a CatalogHash,
    meta_hash: &'a CatalogHash,
    bootstrap_hash: &'a CatalogHash,
    presentation_hash: &'a CatalogHash,
}

impl BootstrapContentPackV1 {
    pub fn recompute_hash(&self) -> Result<CatalogHash, GameContentV2Error> {
        let digest = content_digest(&BootstrapHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            modes: &self.modes,
            starters: &self.starters,
            choices: &self.choices,
            difficulties: &self.difficulties,
            maximum_starter_cost: self.maximum_starter_cost,
            maximum_starters: self.maximum_starters,
        })
        .map_err(|error| GameContentV2Error::Hash(error.to_string()))?;
        CatalogHash::parse(digest).map_err(|error| GameContentV2Error::Hash(error.to_string()))
    }

    pub fn validate(
        &self,
        battle: &BattleContentPackV3,
        world: &WorldContentPackV2,
    ) -> Result<(), GameContentV2Error> {
        if self.schema_version != BOOTSTRAP_CONTENT_SCHEMA_VERSION_V1
            || self.oracle_sha != battle.oracle_sha
            || self.oracle_sha != world.oracle_sha
            || self.content_hash != self.recompute_hash()?
            || self.modes.is_empty()
            || self.starters.is_empty()
            || self.difficulties.is_empty()
            || self.maximum_starter_cost == 0
            || self.maximum_starters == 0
            || self
                .modes
                .windows(2)
                .any(|pair| pair[0].mode >= pair[1].mode)
            || self.starters.windows(2).any(|pair| {
                (pair[0].species_id, pair[0].form_index) >= (pair[1].species_id, pair[1].form_index)
            })
            || self.choices.windows(2).any(|pair| pair[0].id >= pair[1].id)
        {
            return Err(GameContentV2Error::Bootstrap);
        }
        for mode in &self.modes {
            if mode.key.is_empty()
                || mode.starting_level == 0
                || world
                    .modes
                    .iter()
                    .all(|candidate| candidate.id != mode.mode)
                || world
                    .biomes
                    .iter()
                    .all(|candidate| candidate.id != mode.starting_biome)
            {
                return Err(GameContentV2Error::CrossReference);
            }
        }
        for starter in &self.starters {
            let species_index = usize::try_from(starter.species_id.get().get())
                .map_err(|_| GameContentV2Error::CrossReference)?;
            let species = battle
                .species
                .get(species_index)
                .and_then(Option::as_ref)
                .ok_or(GameContentV2Error::CrossReference)?;
            if starter.cost == 0
                || starter.cost > self.maximum_starter_cost
                || starter.level_moves.is_empty()
                || starter
                    .level_moves
                    .iter()
                    .enumerate()
                    .any(|(index, value)| starter.level_moves[index + 1..].contains(value))
                || species.form_ids.iter().all(|form| {
                    form.as_str()
                        != format!("{}:{}", starter.species_id.get().get(), starter.form_index)
                })
                || starter.level_moves.iter().any(|entry| {
                    usize::try_from(entry.move_id.get().get())
                        .ok()
                        .and_then(|index| battle.moves.get(index))
                        .and_then(Option::as_ref)
                        .is_none()
                })
            {
                return Err(GameContentV2Error::CrossReference);
            }
        }
        for choice in &self.choices {
            if choice.values.is_empty()
                || choice
                    .values
                    .iter()
                    .enumerate()
                    .any(|(index, value)| choice.values[index + 1..].contains(value))
            {
                return Err(GameContentV2Error::Bootstrap);
            }
        }
        let unique_difficulties = self.difficulties.iter().collect::<BTreeSet<_>>();
        if unique_difficulties.len() != self.difficulties.len() {
            return Err(GameContentV2Error::Bootstrap);
        }
        Ok(())
    }
}

pub fn all_presentation_semantics_v1() -> Vec<PresentationSemanticIdV1> {
    use GameControlKindV2 as Control;
    use PresentationCueFamilyV1 as Cue;
    use PresentationSemanticIdV1::{Control as ControlSemantic, Cue as CueSemantic, UiRole};
    use PresentationUiRoleV1 as Role;

    let controls = [
        Control::Title,
        Control::ModeSelect,
        Control::StarterSelect,
        Control::BattleCommand,
        Control::BattleMove,
        Control::BattleTarget,
        Control::BattleSwitch,
        Control::BattleReplacement,
        Control::Capture,
        Control::FullParty,
        Control::Progression,
        Control::MoveLearn,
        Control::Evolution,
        Control::Fusion,
        Control::Reward,
        Control::Market,
        Control::Scenario,
        Control::Quest,
        Control::Faction,
        Control::Biome,
        Control::Route,
        Control::Save,
        Control::Waiting,
        Control::Complete,
    ]
    .into_iter()
    .map(ControlSemantic);
    let cues = [
        Cue::Move,
        Cue::Ability,
        Cue::HeldItem,
        Cue::Hp,
        Cue::Status,
        Cue::Stat,
        Cue::Switch,
        Cue::Faint,
        Cue::Capture,
        Cue::Progression,
        Cue::Evolution,
        Cue::Fusion,
        Cue::Reward,
        Cue::Market,
        Cue::World,
        Cue::Scenario,
        Cue::Save,
        Cue::Waiting,
        Cue::Terminal,
        Cue::Error,
    ]
    .into_iter()
    .map(CueSemantic);
    let roles = [
        Role::Heading,
        Role::Body,
        Role::EnabledOption,
        Role::DisabledOption,
        Role::Cursor,
        Role::PartyMember,
        Role::Item,
        Role::Target,
        Role::Status,
        Role::Currency,
        Role::Progress,
    ]
    .into_iter()
    .map(UiRole);
    controls.chain(cues).chain(roles).collect()
}

impl PresentationContentPackV1 {
    pub fn recompute_hash(&self) -> Result<CatalogHash, GameContentV2Error> {
        let digest = content_digest(&PresentationHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            mappings: &self.mappings,
        })
        .map_err(|error| GameContentV2Error::Hash(error.to_string()))?;
        CatalogHash::parse(digest).map_err(|error| GameContentV2Error::Hash(error.to_string()))
    }

    pub fn validate(&self, oracle_sha: &OracleSha) -> Result<(), GameContentV2Error> {
        let expected = all_presentation_semantics_v1();
        if self.schema_version != PRESENTATION_CONTENT_SCHEMA_VERSION_V1
            || &self.oracle_sha != oracle_sha
            || self.content_hash != self.recompute_hash()?
            || self.mappings.len() != expected.len()
            || self
                .mappings
                .iter()
                .map(|mapping| mapping.semantic)
                .ne(expected)
            || self.mappings.iter().any(|mapping| {
                mapping.text_key.is_empty()
                    || mapping.assets.is_empty()
                    || mapping
                        .assets
                        .iter()
                        .enumerate()
                        .any(|(index, asset)| mapping.assets[index + 1..].contains(asset))
            })
        {
            return Err(GameContentV2Error::Presentation);
        }
        Ok(())
    }
}

impl GameContentBundleV2 {
    pub fn recompute_hash(&self) -> Result<GameContentBundleHash, GameContentV2Error> {
        let digest = content_digest(&BundleHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            battle_hash: &self.battle.content_hash,
            run_hash: &self.run.content_hash,
            progression_hash: &self.progression.content_hash,
            world_hash: &self.world.content_hash,
            scenario_hash: &self.scenarios.content_hash,
            ai_hash: &self.ai.content_hash,
            meta_hash: &self.meta.content_hash,
            bootstrap_hash: &self.bootstrap.content_hash,
            presentation_hash: &self.presentation.content_hash,
        })
        .map_err(|error| GameContentV2Error::Hash(error.to_string()))?;
        GameContentBundleHash::parse(format!("blake3-v1:{digest}"))
            .map_err(|error| GameContentV2Error::Hash(error.to_string()))
    }

    pub fn validate(&self) -> Result<(), GameContentV2Error> {
        if self.schema_version != GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V2
            || [
                &self.battle.oracle_sha,
                &self.run.oracle_sha,
                &self.progression.oracle_sha,
                &self.world.oracle_sha,
                &self.scenarios.oracle_sha,
                &self.ai.oracle_sha,
                &self.meta.oracle_sha,
                &self.bootstrap.oracle_sha,
                &self.presentation.oracle_sha,
            ]
            .iter()
            .any(|oracle_sha| **oracle_sha != self.oracle_sha)
            || self.run.battle_content_hash != self.battle.content_hash
            || self.content_hash != self.recompute_hash()?
        {
            return Err(GameContentV2Error::Identity);
        }
        self.run
            .validate()
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        self.meta
            .validate()
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let classifications = self
            .meta
            .classifications
            .iter()
            .map(|entry| (entry.behavior.clone(), entry.status))
            .collect::<BTreeMap<_, _>>();
        if self.run.programs.iter().any(|program| {
            !matches!(
                classifications.get(&program.source),
                Some(GameBehaviorStatus::Compiled | GameBehaviorStatus::BespokeImplemented)
            )
        }) {
            return Err(GameContentV2Error::CrossReference);
        }
        let known_species = self
            .battle
            .species
            .iter()
            .flatten()
            .map(|species| species.id)
            .collect::<BTreeSet<_>>();
        let known_moves = self
            .battle
            .moves
            .iter()
            .flatten()
            .map(|move_definition| move_definition.id)
            .collect::<BTreeSet<_>>();
        self.progression
            .validate(&known_species, &known_moves)
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        self.world
            .validate(&known_species)
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        self.scenarios
            .validate()
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        self.ai
            .validate()
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        self.bootstrap.validate(&self.battle, &self.world)?;
        self.presentation.validate(&self.oracle_sha)?;
        Ok(())
    }
}

impl PreparedGameContentV2 {
    pub fn prepare(bundle: Arc<GameContentBundleV2>) -> Result<Self, GameContentV2Error> {
        bundle.validate()?;
        let known_species = bundle
            .battle
            .species
            .iter()
            .flatten()
            .map(|species| species.id)
            .collect::<BTreeSet<_>>();
        let known_moves = bundle
            .battle
            .moves
            .iter()
            .flatten()
            .map(|move_definition| move_definition.id)
            .collect::<BTreeSet<_>>();
        let battle = prepare_content((*bundle.battle).clone())
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let run = PreparedRunContentV3::prepare(bundle.run.clone())
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let progression = (*bundle.progression)
            .clone()
            .prepare(&known_species, &known_moves)
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let world = (*bundle.world)
            .clone()
            .prepare(&known_species)
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let scenarios = (*bundle.scenarios)
            .clone()
            .prepare()
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let ai = (*bundle.ai)
            .clone()
            .prepare()
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let meta = PreparedMetaContentV1::prepare(bundle.meta.clone())
            .map_err(|error| GameContentV2Error::Domain(error.to_string()))?;
        let presentation = bundle
            .presentation
            .mappings
            .iter()
            .enumerate()
            .map(|(index, mapping)| (mapping.semantic, index))
            .collect();
        let identity = GameContentIdentityV2 {
            oracle_sha: bundle.oracle_sha.clone(),
            bundle_hash: bundle.content_hash.clone(),
            battle_hash: bundle.battle.content_hash.clone(),
            run_hash: bundle.run.content_hash.clone(),
            progression_hash: bundle.progression.content_hash.clone(),
            world_hash: bundle.world.content_hash.clone(),
            scenario_hash: bundle.scenarios.content_hash.clone(),
            ai_hash: bundle.ai.content_hash.clone(),
            bootstrap_hash: bundle.bootstrap.content_hash.clone(),
            presentation_hash: bundle.presentation.content_hash.clone(),
            semantic_catalog_hash: bundle.battle.semantic_catalog_hash.clone(),
        };
        Ok(Self {
            identity,
            bundle,
            battle,
            run,
            progression,
            world,
            scenarios,
            ai,
            meta,
            presentation,
        })
    }

    pub fn identity(&self) -> &GameContentIdentityV2 {
        &self.identity
    }

    pub fn content_hash(&self) -> &GameContentBundleHash {
        &self.identity.bundle_hash
    }

    pub fn bundle(&self) -> &Arc<GameContentBundleV2> {
        &self.bundle
    }

    pub fn presentation(
        &self,
        semantic: PresentationSemanticIdV1,
    ) -> Option<&PresentationSemanticMappingV1> {
        self.presentation
            .get(&semantic)
            .and_then(|index| self.bundle.presentation.mappings.get(*index))
    }
}

impl GameStateV6ContentContext for PreparedGameContentV2 {
    fn identity(&self) -> &GameContentIdentityV2 {
        &self.identity
    }

    fn has_mode(&self, mode: GameModeId) -> bool {
        self.world.mode(mode).is_some()
    }

    fn has_species_form(&self, species: SpeciesId, form: u16) -> bool {
        self.progression.species(species, form).is_some()
    }

    fn has_move(&self, move_id: MoveId) -> bool {
        usize::try_from(move_id.get().get())
            .ok()
            .and_then(|index| self.bundle.battle.moves.get(index))
            .and_then(Option::as_ref)
            .is_some()
    }
}
