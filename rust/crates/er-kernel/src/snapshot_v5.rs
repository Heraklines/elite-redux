//! Directly restorable M6 endpoint snapshot.
//!
//! V5 owns the GameStateV4-native runtime snapshot directly. It contains no
//! RestorableKernelSnapshotV2/V3/V4 sidecar and no caller-supplied companion
//! game state.

use er_game::m6::runtime_v4::{GameRuntimeSnapshotV4, M6RuntimeError};
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_types::battle_ui::BattleUiProjection;
use er_types::{
    BattleContentPackHashV3, CatalogHash, M6_MECHANIC_STATE_SCHEMA_VERSION,
    M6_MECHANICS_PROGRAM_VERSION, M6_RESTORABLE_SNAPSHOT_VERSION, TerminalState,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2, SnapshotError};

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

/// One complete M6 endpoint owner graph. All fields are constructor inputs for
/// the live V5 kernel; none are diagnostic-only summaries.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableKernelSnapshotV5 {
    pub schema_version: u32,
    pub mechanics_program_version: u32,
    pub mechanic_state_schema_version: u32,
    pub prepared_content: PreparedContentIdentityV3,
    pub runtime: GameRuntimeSnapshotV4,
    pub input_router: InputRouterSnapshotV2,
    pub ui: BattleUiProjection,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: ProtocolRuntimeSnapshotV2,
    #[serde(default)]
    pub terminal: Option<TerminalState>,
}

impl RestorableKernelSnapshotV5 {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        runtime: GameRuntimeSnapshotV4,
        input_router: InputRouterSnapshotV2,
        ui: BattleUiProjection,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: ProtocolRuntimeSnapshotV2,
        terminal: Option<TerminalState>,
    ) -> Result<Self, SnapshotV5Error> {
        let prepared_content = PreparedContentIdentityV3 {
            battle_content_hash: runtime.state.battle_content_hash_v3.clone(),
            semantic_catalog_hash: runtime.state.semantic_catalog_hash.clone(),
            mechanics_program_version: M6_MECHANICS_PROGRAM_VERSION,
        };
        let snapshot = Self {
            schema_version: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V5,
            mechanics_program_version: M6_MECHANICS_PROGRAM_VERSION,
            mechanic_state_schema_version: M6_MECHANIC_STATE_SCHEMA_VERSION,
            prepared_content,
            runtime,
            input_router,
            ui,
            scheduler,
            protocol,
            terminal,
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
            return Err(SnapshotV5Error::MechanicStateSchemaVersion {
                expected: M6_MECHANIC_STATE_SCHEMA_VERSION,
                actual: self.mechanic_state_schema_version,
            });
        }
        self.prepared_content.validate()?;
        self.runtime.validate()?;
        self.input_router
            .validate()
            .map_err(SnapshotV5Error::Input)?;
        self.scheduler
            .validate()
            .map_err(SnapshotV5Error::Scheduler)?;
        self.protocol
            .validate()
            .map_err(|error| SnapshotV5Error::Protocol(error.to_string()))?;
        if self.prepared_content.battle_content_hash != self.runtime.state.battle_content_hash_v3
            || self.prepared_content.semantic_catalog_hash
                != self.runtime.state.semantic_catalog_hash
        {
            return Err(SnapshotV5Error::PreparedContentMismatch);
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum SnapshotV5Error {
    #[error("snapshot schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("mechanics program version must be {expected}, got {actual}")]
    MechanicsProgramVersion { expected: u32, actual: u32 },
    #[error("mechanic state schema version must be {expected}, got {actual}")]
    MechanicStateSchemaVersion { expected: u32, actual: u32 },
    #[error("GameStateV4 runtime snapshot is invalid: {0}")]
    Runtime(#[from] M6RuntimeError),
    #[error("input-router snapshot is invalid: {0}")]
    Input(SnapshotError),
    #[error("scheduler snapshot is invalid: {0}")]
    Scheduler(SnapshotError),
    #[error("protocol snapshot is invalid: {0}")]
    Protocol(String),
    #[error("prepared-content identity does not match the live V4 runtime state")]
    PreparedContentMismatch,
}
