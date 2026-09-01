use std::collections::{BTreeMap, BTreeSet};

use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::m9e_state_v6::GameStateV6;
use er_types::{OperationId, PhysicalKey, SafeU53, TerminalState};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2};

pub const CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7: u32 = 7;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingPresentationV2 {
    pub event_id: String,
    pub bytes: Vec<u8>,
    pub blocking: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PendingPlatformRequestV1 {
    pub request_id: SafeU53,
    pub kind: String,
    pub bytes: Vec<u8>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoreGameKernelSnapshotV7 {
    pub schema_version: u32,
    pub game_state: GameStateV6,
    pub input_router: InputRouterSnapshotV2,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: Option<ProtocolRuntimeSnapshotV2>,
    pub pressed_keys: BTreeSet<PhysicalKey>,
    pub pending_presentations: BTreeMap<String, PendingPresentationV2>,
    pub pending_platform: BTreeMap<SafeU53, PendingPlatformRequestV1>,
    pub applied_materials: BTreeMap<OperationId, Vec<u8>>,
    pub replay_sequence: SafeU53,
    pub terminal: Option<TerminalState>,
}
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotV7Error {
    #[error("snapshot V7 is invalid")]
    Invalid,
}
impl CoreGameKernelSnapshotV7 {
    pub fn validate(&self) -> Result<(), SnapshotV7Error> {
        if self.schema_version != CORE_GAME_KERNEL_SNAPSHOT_SCHEMA_VERSION_V7
            || self
                .pending_presentations
                .iter()
                .any(|(id, p)| id.is_empty() || p.event_id != *id || p.bytes.is_empty())
            || self
                .pending_platform
                .iter()
                .any(|(id, p)| *id != p.request_id || p.kind.is_empty() || p.bytes.is_empty())
            || self.applied_materials.iter().any(|(_, b)| b.is_empty())
        {
            return Err(SnapshotV7Error::Invalid);
        }
        self.game_state
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        self.input_router
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        self.scheduler
            .validate()
            .map_err(|_| SnapshotV7Error::Invalid)?;
        if let Some(p) = &self.protocol {
            p.validate().map_err(|_| SnapshotV7Error::Invalid)?
        }
        Ok(())
    }
}
