use er_state::migration_v3::GameStateV3;
use er_types::mechanics::{MECHANIC_STATE_SCHEMA_VERSION, MECHANICS_PROGRAM_VERSION};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot_v3::RestorableKernelSnapshotV3;

pub const RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V4: u32 = 4;
pub const KERNEL_TRACE_SCHEMA_VERSION_V4: u32 = 4;
pub const MECHANICAL_DIGEST_SCHEMA_VERSION_V3: u32 = 3;
pub const KERNEL_DETERMINISM_DIGEST_SCHEMA_VERSION_V3: u32 = 3;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableKernelSnapshotV4 {
    pub schema_version: u32,
    pub mechanics_program_version: u32,
    pub mechanic_state_schema_version: u32,
    pub battle_content_hash_v2: String,
    pub base: RestorableKernelSnapshotV3,
    pub game_v3: GameStateV3,
}

impl RestorableKernelSnapshotV4 {
    pub fn validate(&self) -> Result<(), SnapshotV4Error> {
        if self.schema_version != RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V4 {
            return Err(SnapshotV4Error::SchemaVersion {
                expected: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V4,
                actual: self.schema_version,
            });
        }
        if self.mechanics_program_version != MECHANICS_PROGRAM_VERSION
            || self.mechanic_state_schema_version != MECHANIC_STATE_SCHEMA_VERSION
        {
            return Err(SnapshotV4Error::MechanicsVersion);
        }
        self.base
            .validate()
            .map_err(|error| SnapshotV4Error::Base(error.to_string()))?;
        self.game_v3.validate()?;
        if self.game_v3.base != self.base.game.state
            || self.game_v3.battle_content_hash_v2 != self.battle_content_hash_v2
        {
            return Err(SnapshotV4Error::StateFrontierMismatch);
        }
        validate_hash(&self.battle_content_hash_v2)?;
        Ok(())
    }
}

fn validate_hash(value: &str) -> Result<(), SnapshotV4Error> {
    let Some(digest) = value.strip_prefix("blake3-v1:") else {
        return Err(SnapshotV4Error::ContentHash);
    };
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(SnapshotV4Error::ContentHash);
    }
    Ok(())
}

#[derive(Debug, Error)]
pub enum SnapshotV4Error {
    #[error("snapshot V4 schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("mechanics version mismatch")]
    MechanicsVersion,
    #[error("base snapshot V3 is invalid: {0}")]
    Base(String),
    #[error("V3 game state is invalid: {0}")]
    Game(#[from] er_state::migration_v3::MigrationV3Error),
    #[error("V3 game state does not match the base snapshot frontier")]
    StateFrontierMismatch,
    #[error("battle content hash V2 is malformed")]
    ContentHash,
}
