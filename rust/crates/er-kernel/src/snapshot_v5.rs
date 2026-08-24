//! Restorable endpoint snapshot V5.
//!
//! V5 wraps the complete proven V4 environmental snapshot and replaces the
//! canonical game frontier with GameStateV4 plus exact prepared-content
//! identity. A snapshot cannot claim a different base GameStateV2 frontier or
//! content identity.

use er_state::migration_v4::GameStateV4;
use er_types::{
    BattleContentPackHashV3, CatalogHash, M6_MECHANIC_STATE_SCHEMA_VERSION,
    M6_MECHANICS_PROGRAM_VERSION, M6_RESTORABLE_SNAPSHOT_VERSION,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot_v4::{RestorableKernelSnapshotV4, SnapshotV4Error};

pub const RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V5: u32 = M6_RESTORABLE_SNAPSHOT_VERSION;
pub const KERNEL_TRACE_SCHEMA_VERSION_V5: u32 = 5;
pub const MECHANICAL_DIGEST_SCHEMA_VERSION_V4: u32 = 4;
pub const KERNEL_DETERMINISM_DIGEST_SCHEMA_VERSION_V4: u32 = 4;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedContentIdentityV3 {
    pub battle_content_hash: BattleContentPackHashV3,
    pub semantic_catalog_hash: CatalogHash,
    pub mechanics_program_version: u32,
}

impl PreparedContentIdentityV3 {
    pub fn validate(&self) -> Result<(), SnapshotV5Error> {
        if self.mechanics_program_version != M6_MECHANICS_PROGRAM_VERSION {
            return Err(SnapshotV5Error::MechanicsProgramVersion {
                expected: M6_MECHANICS_PROGRAM_VERSION,
                actual: self.mechanics_program_version,
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableKernelSnapshotV5 {
    pub schema_version: u32,
    pub mechanics_program_version: u32,
    pub mechanic_state_schema_version: u32,
    pub prepared_content: PreparedContentIdentityV3,
    pub base: RestorableKernelSnapshotV4,
    pub game_v4: GameStateV4,
}

impl RestorableKernelSnapshotV5 {
    pub fn new(
        base: RestorableKernelSnapshotV4,
        game_v4: GameStateV4,
    ) -> Result<Self, SnapshotV5Error> {
        let prepared_content = PreparedContentIdentityV3 {
            battle_content_hash: game_v4.battle_content_hash_v3.clone(),
            semantic_catalog_hash: game_v4.semantic_catalog_hash.clone(),
            mechanics_program_version: M6_MECHANICS_PROGRAM_VERSION,
        };
        let snapshot = Self {
            schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V5,
            mechanics_program_version: M6_MECHANICS_PROGRAM_VERSION,
            mechanic_state_schema_version: M6_MECHANIC_STATE_SCHEMA_VERSION,
            prepared_content,
            base,
            game_v4,
        };
        snapshot.validate()?;
        Ok(snapshot)
    }

    pub fn validate(&self) -> Result<(), SnapshotV5Error> {
        if self.schema_version != RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V5 {
            return Err(SnapshotV5Error::SchemaVersion {
                expected: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V5,
                actual: self.schema_version,
            });
        }
        if self.mechanics_program_version != M6_MECHANICS_PROGRAM_VERSION {
            return Err(SnapshotV5Error::MechanicsProgramVersion {
                expected: M6_MECHANICS_PROGRAM_VERSION,
                actual: self.mechanics_program_version,
            });
        }
        if self.mechanic_state_schema_version != M6_MECHANIC_STATE_SCHEMA_VERSION {
            return Err(SnapshotV5Error::MechanicStateVersion {
                expected: M6_MECHANIC_STATE_SCHEMA_VERSION,
                actual: self.mechanic_state_schema_version,
            });
        }
        self.prepared_content.validate()?;
        self.base.validate().map_err(SnapshotV5Error::Base)?;
        self.game_v4.validate().map_err(SnapshotV5Error::Game)?;
        if self.game_v4.base != self.base.game_v3.base {
            return Err(SnapshotV5Error::StateFrontierMismatch);
        }
        if self.prepared_content.battle_content_hash != self.game_v4.battle_content_hash_v3
            || self.prepared_content.semantic_catalog_hash != self.game_v4.semantic_catalog_hash
        {
            return Err(SnapshotV5Error::PreparedContentMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum SnapshotV5Error {
    #[error("snapshot V5 schema must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("mechanics program version must be {expected}, got {actual}")]
    MechanicsProgramVersion { expected: u32, actual: u32 },
    #[error("mechanic state version must be {expected}, got {actual}")]
    MechanicStateVersion { expected: u32, actual: u32 },
    #[error("base snapshot V4 is invalid: {0}")]
    Base(#[source] SnapshotV4Error),
    #[error("GameStateV4 is invalid: {0}")]
    Game(#[source] er_state::migration_v4::MigrationV4Error),
    #[error("GameStateV4 does not match the V4 snapshot base frontier")]
    StateFrontierMismatch,
    #[error("prepared-content identity does not match GameStateV4")]
    PreparedContentMismatch,
}
