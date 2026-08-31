//! M9-E complete generic content bundle extension for GameKernelV7.

use std::collections::BTreeSet;
use std::sync::Arc;

use er_canonical::content_digest;
use er_types::battle_ids::{GameModeId, MoveId, SpeciesId};
use er_types::run_ids::{BiomeId, RouteNodeId};
use er_types::{
    CatalogHash, GameContentBundleHash, OracleSha, RunDifficultyV1, SafeU53, SetupChoiceIdV1,
    SetupChoiceValueV1,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::m7_content::{GameContentBundleV1, PreparedGameContentV1};

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
    pub initial_route: RouteNodeId,
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationSemanticMappingV1 {
    pub semantic: String,
    pub text_key: String,
    pub asset_keys: Vec<String>,
    pub audio_cue: Option<String>,
    pub blocks_human_input: bool,
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
    pub core: Arc<GameContentBundleV1>,
    pub bootstrap: Arc<BootstrapContentPackV1>,
    pub presentation: Arc<PresentationContentPackV1>,
    pub content_hash: GameContentBundleHash,
}

#[derive(Clone, Debug)]
pub struct PreparedGameContentV2 {
    identity_hash: GameContentBundleHash,
    bundle: Arc<GameContentBundleV2>,
    core: Arc<PreparedGameContentV1>,
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
    #[error("V1 core content is invalid: {0}")]
    Core(String),
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
    core_hash: &'a GameContentBundleHash,
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

    pub fn validate(&self, core: &PreparedGameContentV1) -> Result<(), GameContentV2Error> {
        if self.schema_version != BOOTSTRAP_CONTENT_SCHEMA_VERSION_V1
            || self.oracle_sha != core.bundle().oracle_sha
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
        let bundle = core.bundle();
        for mode in &self.modes {
            if mode.key.is_empty()
                || mode.starting_level == 0
                || bundle
                    .world
                    .modes
                    .iter()
                    .all(|candidate| candidate.id != mode.mode)
                || bundle
                    .world
                    .biomes
                    .iter()
                    .all(|candidate| candidate.id != mode.starting_biome)
                || bundle
                    .world
                    .routes
                    .iter()
                    .all(|candidate| candidate.id != mode.initial_route)
            {
                return Err(GameContentV2Error::CrossReference);
            }
        }
        for starter in &self.starters {
            let species_index = usize::try_from(starter.species_id.get().get())
                .map_err(|_| GameContentV2Error::CrossReference)?;
            let species = bundle
                .battle
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
                        .and_then(|index| bundle.battle.moves.get(index))
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
        if self.schema_version != PRESENTATION_CONTENT_SCHEMA_VERSION_V1
            || &self.oracle_sha != oracle_sha
            || self.content_hash != self.recompute_hash()?
            || self.mappings.is_empty()
            || self
                .mappings
                .windows(2)
                .any(|pair| pair[0].semantic >= pair[1].semantic)
            || self.mappings.iter().any(|mapping| {
                mapping.semantic.is_empty()
                    || mapping.text_key.is_empty()
                    || mapping.asset_keys.is_empty()
                    || mapping.asset_keys.iter().any(String::is_empty)
                    || mapping.audio_cue.as_ref().is_some_and(String::is_empty)
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
            core_hash: &self.core.content_hash,
            bootstrap_hash: &self.bootstrap.content_hash,
            presentation_hash: &self.presentation.content_hash,
        })
        .map_err(|error| GameContentV2Error::Hash(error.to_string()))?;
        GameContentBundleHash::parse(format!("blake3-v1:{digest}"))
            .map_err(|error| GameContentV2Error::Hash(error.to_string()))
    }

    pub fn validate(&self) -> Result<(), GameContentV2Error> {
        if self.schema_version != GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V2
            || self.oracle_sha != self.core.oracle_sha
            || self.oracle_sha != self.bootstrap.oracle_sha
            || self.oracle_sha != self.presentation.oracle_sha
            || self.content_hash != self.recompute_hash()?
        {
            return Err(GameContentV2Error::Identity);
        }
        let core = PreparedGameContentV1::prepare(self.core.clone())
            .map_err(|error| GameContentV2Error::Core(error.to_string()))?;
        self.bootstrap.validate(&core)?;
        self.presentation.validate(&self.oracle_sha)?;
        Ok(())
    }
}

impl PreparedGameContentV2 {
    pub fn prepare(bundle: Arc<GameContentBundleV2>) -> Result<Self, GameContentV2Error> {
        bundle.validate()?;
        let core = Arc::new(
            PreparedGameContentV1::prepare(bundle.core.clone())
                .map_err(|error| GameContentV2Error::Core(error.to_string()))?,
        );
        Ok(Self {
            identity_hash: bundle.content_hash.clone(),
            bundle,
            core,
        })
    }

    pub fn content_hash(&self) -> &GameContentBundleHash {
        &self.identity_hash
    }

    pub fn bundle(&self) -> &Arc<GameContentBundleV2> {
        &self.bundle
    }

    pub fn core(&self) -> &Arc<PreparedGameContentV1> {
        &self.core
    }
}
