//! Complete immutable M7 game-content bundle and prepared indexes.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use er_ai::{AiPolicyPackV1, PreparedAiPolicyContentV1};
use er_canonical::content_digest;
use er_content::pack::m6_pack::BattleContentPackV3;
use er_content::pack::m6_prepared::{PreparedBattleContentV3, prepare_content};
use er_progression::{PreparedProgressionContentV1, ProgressionContentPackV1};
use er_scenario::{PreparedScenarioContentV1, ScenarioContentPackV1};
use er_types::{
    BattleContentPackHashV3, CatalogHash, GameBehaviorStatus, GameBehaviorUnitId,
    GameContentBundleHash, GameContentIdentity, OracleSha, RunProgramId, RunProgramV1,
};
use er_world::{PreparedWorldContentV1, WorldContentPackV1};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V1: u32 = 1;
pub const RUN_CONTENT_PACK_SCHEMA_VERSION_V3: u32 = 3;
pub const META_CONTENT_PACK_SCHEMA_VERSION_V1: u32 = 1;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunContentPackV3 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub battle_content_hash: BattleContentPackHashV3,
    pub content_hash: CatalogHash,
    pub programs: Vec<RunProgramV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameBehaviorClassificationV1 {
    pub behavior: GameBehaviorUnitId,
    pub status: GameBehaviorStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MetaContentPackV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub content_hash: CatalogHash,
    pub classifications: Vec<GameBehaviorClassificationV1>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GameContentBundleV1 {
    pub schema_version: u32,
    pub oracle_sha: OracleSha,
    pub battle: Arc<BattleContentPackV3>,
    pub run: Arc<RunContentPackV3>,
    pub progression: Arc<ProgressionContentPackV1>,
    pub world: Arc<WorldContentPackV1>,
    pub scenarios: Arc<ScenarioContentPackV1>,
    pub ai: Arc<AiPolicyPackV1>,
    pub meta: Arc<MetaContentPackV1>,
    pub content_hash: GameContentBundleHash,
}

#[derive(Clone, Debug)]
pub struct PreparedRunContentV3 {
    pack: Arc<RunContentPackV3>,
    program_indexes: BTreeMap<RunProgramId, usize>,
}

#[derive(Clone, Debug)]
pub struct PreparedMetaContentV1 {
    pack: Arc<MetaContentPackV1>,
    classification_indexes: BTreeMap<GameBehaviorUnitId, usize>,
}

#[derive(Clone, Debug)]
pub struct PreparedGameContentV1 {
    identity: GameContentIdentity,
    bundle: Arc<GameContentBundleV1>,
    pub battle: PreparedBattleContentV3,
    pub run: PreparedRunContentV3,
    pub progression: PreparedProgressionContentV1,
    pub world: PreparedWorldContentV1,
    pub scenarios: PreparedScenarioContentV1,
    pub ai: PreparedAiPolicyContentV1,
    pub meta: PreparedMetaContentV1,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GameContentError {
    #[error("{kind} schema version must be {expected}, got {actual}")]
    SchemaVersion {
        kind: &'static str,
        expected: u32,
        actual: u32,
    },
    #[error("nested content oracle identity differs from bundle identity")]
    OracleIdentity,
    #[error("nested battle content identity differs from the run pack")]
    BattleIdentity,
    #[error("run programs must be nonempty, sorted, unique, and valid")]
    RunProgramClosure,
    #[error("behavior classifications must be nonempty, sorted, unique, and closed")]
    ClassificationClosure,
    #[error("game content hash mismatch")]
    HashMismatch,
    #[error("canonical content hashing failed: {0}")]
    Canonical(String),
    #[error("battle content preparation failed: {0}")]
    Battle(String),
    #[error("progression content preparation failed: {0}")]
    Progression(String),
    #[error("world content preparation failed: {0}")]
    World(String),
    #[error("scenario content preparation failed: {0}")]
    Scenario(String),
    #[error("AI content preparation failed: {0}")]
    Ai(String),
}

#[derive(Serialize)]
struct GameContentHashView<'a> {
    schema_version: u32,
    oracle_sha: &'a OracleSha,
    battle: &'a BattleContentPackHashV3,
    run: &'a CatalogHash,
    progression: &'a CatalogHash,
    world: &'a CatalogHash,
    scenarios: &'a CatalogHash,
    ai: &'a CatalogHash,
    meta: &'a CatalogHash,
}

impl RunContentPackV3 {
    pub fn validate(&self) -> Result<(), GameContentError> {
        require_schema(
            "RunContentPackV3",
            self.schema_version,
            RUN_CONTENT_PACK_SCHEMA_VERSION_V3,
        )?;
        if self.programs.is_empty()
            || self
                .programs
                .windows(2)
                .any(|pair| pair[0].id >= pair[1].id)
            || self
                .programs
                .iter()
                .any(|program| program.validate().is_err())
        {
            return Err(GameContentError::RunProgramClosure);
        }
        Ok(())
    }
}

impl MetaContentPackV1 {
    pub fn validate(&self) -> Result<(), GameContentError> {
        require_schema(
            "MetaContentPackV1",
            self.schema_version,
            META_CONTENT_PACK_SCHEMA_VERSION_V1,
        )?;
        if self.classifications.is_empty()
            || self
                .classifications
                .windows(2)
                .any(|pair| pair[0].behavior >= pair[1].behavior)
        {
            return Err(GameContentError::ClassificationClosure);
        }
        Ok(())
    }
}

impl GameContentBundleV1 {
    pub fn validate(&self) -> Result<(), GameContentError> {
        require_schema(
            "GameContentBundleV1",
            self.schema_version,
            GAME_CONTENT_BUNDLE_SCHEMA_VERSION_V1,
        )?;
        self.run.validate()?;
        self.meta.validate()?;
        self.progression
            .validate()
            .map_err(|error| GameContentError::Progression(error.to_string()))?;
        self.world
            .validate()
            .map_err(|error| GameContentError::World(error.to_string()))?;
        self.scenarios
            .validate()
            .map_err(|error| GameContentError::Scenario(error.to_string()))?;
        self.ai
            .validate()
            .map_err(|error| GameContentError::Ai(error.to_string()))?;
        if self.battle.oracle_sha != self.oracle_sha
            || self.run.oracle_sha != self.oracle_sha
            || self.progression.oracle_sha != self.oracle_sha
            || self.world.oracle_sha != self.oracle_sha
            || self.scenarios.oracle_sha != self.oracle_sha
            || self.ai.oracle_sha != self.oracle_sha
            || self.meta.oracle_sha != self.oracle_sha
        {
            return Err(GameContentError::OracleIdentity);
        }
        if self.run.battle_content_hash != self.battle.content_hash {
            return Err(GameContentError::BattleIdentity);
        }
        let classifications: BTreeSet<_> = self
            .meta
            .classifications
            .iter()
            .map(|entry| entry.behavior.clone())
            .collect();
        if self
            .run
            .programs
            .iter()
            .any(|program| !classifications.contains(&program.source))
        {
            return Err(GameContentError::ClassificationClosure);
        }
        if self.recompute_hash()? != self.content_hash {
            return Err(GameContentError::HashMismatch);
        }
        Ok(())
    }

    pub fn recompute_hash(&self) -> Result<GameContentBundleHash, GameContentError> {
        let view = GameContentHashView {
            schema_version: self.schema_version,
            oracle_sha: &self.oracle_sha,
            battle: &self.battle.content_hash,
            run: &self.run.content_hash,
            progression: &self.progression.content_hash,
            world: &self.world.content_hash,
            scenarios: &self.scenarios.content_hash,
            ai: &self.ai.content_hash,
            meta: &self.meta.content_hash,
        };
        let digest = content_digest(&view)
            .map_err(|error| GameContentError::Canonical(error.to_string()))?;
        GameContentBundleHash::parse(format!("blake3-v1:{digest}"))
            .map_err(|error| GameContentError::Canonical(error.to_string()))
    }
}

impl PreparedGameContentV1 {
    pub fn prepare(bundle: Arc<GameContentBundleV1>) -> Result<Self, GameContentError> {
        bundle.validate()?;
        let battle = prepare_content((*bundle.battle).clone())
            .map_err(|error| GameContentError::Battle(error.to_string()))?;
        let run = PreparedRunContentV3::prepare(bundle.run.clone())?;
        let progression = PreparedProgressionContentV1::prepare(bundle.progression.clone())
            .map_err(|error| GameContentError::Progression(error.to_string()))?;
        let world = PreparedWorldContentV1::prepare(bundle.world.clone())
            .map_err(|error| GameContentError::World(error.to_string()))?;
        let scenarios = PreparedScenarioContentV1::prepare(bundle.scenarios.clone())
            .map_err(|error| GameContentError::Scenario(error.to_string()))?;
        let ai = PreparedAiPolicyContentV1::prepare(bundle.ai.clone())
            .map_err(|error| GameContentError::Ai(error.to_string()))?;
        let meta = PreparedMetaContentV1::prepare(bundle.meta.clone())?;
        let identity = GameContentIdentity {
            oracle_sha: bundle.oracle_sha.clone(),
            content_hash: bundle.content_hash.clone(),
            battle_content_hash: bundle.battle.content_hash.clone(),
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
        })
    }

    pub fn identity(&self) -> &GameContentIdentity {
        &self.identity
    }

    pub fn bundle(&self) -> &Arc<GameContentBundleV1> {
        &self.bundle
    }
}

impl PreparedRunContentV3 {
    fn prepare(pack: Arc<RunContentPackV3>) -> Result<Self, GameContentError> {
        pack.validate()?;
        let program_indexes = pack
            .programs
            .iter()
            .enumerate()
            .map(|(index, program)| (program.id, index))
            .collect();
        Ok(Self {
            pack,
            program_indexes,
        })
    }

    pub fn pack(&self) -> &Arc<RunContentPackV3> {
        &self.pack
    }

    pub fn program(&self, id: RunProgramId) -> Option<&RunProgramV1> {
        self.program_indexes
            .get(&id)
            .and_then(|index| self.pack.programs.get(*index))
    }
}

impl PreparedMetaContentV1 {
    fn prepare(pack: Arc<MetaContentPackV1>) -> Result<Self, GameContentError> {
        pack.validate()?;
        let classification_indexes = pack
            .classifications
            .iter()
            .enumerate()
            .map(|(index, entry)| (entry.behavior.clone(), index))
            .collect();
        Ok(Self {
            pack,
            classification_indexes,
        })
    }

    pub fn pack(&self) -> &Arc<MetaContentPackV1> {
        &self.pack
    }

    pub fn status(&self, id: &GameBehaviorUnitId) -> Option<GameBehaviorStatus> {
        self.classification_indexes
            .get(id)
            .and_then(|index| self.pack.classifications.get(*index))
            .map(|entry| entry.status)
    }
}

fn require_schema(kind: &'static str, actual: u32, expected: u32) -> Result<(), GameContentError> {
    if actual != expected {
        return Err(GameContentError::SchemaVersion {
            kind,
            expected,
            actual,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use er_types::{
        BattleContentPackHashV3, CatalogHash, GameBehaviorStatus, GameBehaviorUnitId, OracleSha,
    };

    use super::{
        GameBehaviorClassificationV1, GameContentError, META_CONTENT_PACK_SCHEMA_VERSION_V1,
        MetaContentPackV1, RUN_CONTENT_PACK_SCHEMA_VERSION_V3, RunContentPackV3,
    };

    fn oracle() -> OracleSha {
        OracleSha::parse("399d5d368f0b5642ebf8f45bd8a5e73350fa4de7").expect("oracle")
    }

    fn catalog_hash(fill: char) -> CatalogHash {
        CatalogHash::parse(fill.to_string().repeat(64)).expect("catalog hash")
    }

    #[test]
    fn empty_run_program_catalog_fails_closed() {
        let pack = RunContentPackV3 {
            schema_version: RUN_CONTENT_PACK_SCHEMA_VERSION_V3,
            oracle_sha: oracle(),
            battle_content_hash: BattleContentPackHashV3::parse(format!(
                "blake3-v3:{}",
                "a".repeat(64)
            ))
            .expect("battle hash"),
            content_hash: catalog_hash('b'),
            programs: Vec::new(),
        };
        assert_eq!(pack.validate(), Err(GameContentError::RunProgramClosure));
    }

    #[test]
    fn duplicate_behavior_classification_fails_closed() {
        let behavior = GameBehaviorUnitId::parse("c".repeat(64)).expect("behavior");
        let entry = GameBehaviorClassificationV1 {
            behavior,
            status: GameBehaviorStatus::Compiled,
        };
        let pack = MetaContentPackV1 {
            schema_version: META_CONTENT_PACK_SCHEMA_VERSION_V1,
            oracle_sha: oracle(),
            content_hash: catalog_hash('d'),
            classifications: vec![entry.clone(), entry],
        };
        assert_eq!(
            pack.validate(),
            Err(GameContentError::ClassificationClosure)
        );
    }
}
