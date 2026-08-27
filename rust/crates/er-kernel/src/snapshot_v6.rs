//! Complete directly restorable M7 snapshot and replay trace schemas.

use std::collections::BTreeSet;

use er_battle::m7_resolver::BattlePresentationCueV5;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::m7_state::GameStateV5;
use er_types::{
    GameContentIdentity, OperationId, PhysicalKey, RawInputEvent, SafeU53, SeatId, TerminalState,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::snapshot::{InputRouterSnapshotV2, KernelSchedulerSnapshotV2, SnapshotError};

pub const RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6: u32 = 6;
pub const KERNEL_TRACE_SCHEMA_VERSION_V6: u32 = 6;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorableKernelSnapshotV6 {
    pub schema_version: u32,
    pub content_identity: GameContentIdentity,
    pub game_state: GameStateV5,
    pub input_router: InputRouterSnapshotV2,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: Option<ProtocolRuntimeSnapshotV2>,
    pub pending_presentations: Vec<BattlePresentationCueV5>,
    pub prepared_transactions: Vec<PreparedTransactionSnapshotV1>,
    pub replay_sequence: SafeU53,
    pub terminal: Option<TerminalState>,
    pub pressed_keys: BTreeSet<PhysicalKey>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedTransactionSnapshotV1 {
    pub operation_id: OperationId,
    pub before_digest: String,
    pub material_bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelTraceV6 {
    pub schema_version: u32,
    pub initial: RestorableKernelSnapshotV6,
    pub events: Vec<KernelTraceEventV6>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelTraceEventV6 {
    pub sequence: SafeU53,
    pub input: ExternalTraceInputV6,
    pub expected_mechanical_digest: String,
    pub expected_kernel_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ExternalTraceInputV6 {
    RawInput(RawInputEvent),
    NetworkFrame {
        peer: SeatId,
        bytes: Vec<u8>,
    },
    AdvanceTime {
        milliseconds: SafeU53,
    },
    PresentationSettled {
        event_id: String,
        settled: bool,
    },
    StorageResult {
        request: SafeU53,
        bytes: Option<Vec<u8>>,
    },
    TransportChanged {
        peer: SeatId,
        connected: bool,
    },
    Suspend,
    Resume,
}

#[derive(Debug, Error)]
pub enum SnapshotV6Error {
    #[error("snapshot schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("snapshot content identity differs from canonical game state")]
    ContentIdentity,
    #[error("canonical game state is invalid: {0}")]
    GameState(String),
    #[error("input-router snapshot is invalid: {0}")]
    Input(SnapshotError),
    #[error("scheduler snapshot is invalid: {0}")]
    Scheduler(SnapshotError),
    #[error("protocol snapshot is invalid: {0}")]
    Protocol(String),
    #[error("prepared transaction identities, digests, or material bytes are invalid")]
    Transaction,
    #[error("trace schema, sequence, input payload, or digest closure is invalid")]
    Trace,
}

impl RestorableKernelSnapshotV6 {
    pub fn validate(&self) -> Result<(), SnapshotV6Error> {
        if self.schema_version != RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6 {
            return Err(SnapshotV6Error::SchemaVersion {
                expected: RESTORABLE_KERNEL_SNAPSHOT_SCHEMA_VERSION_V6,
                actual: self.schema_version,
            });
        }
        if self.game_state.content_identity != self.content_identity {
            return Err(SnapshotV6Error::ContentIdentity);
        }
        self.game_state
            .validate()
            .map_err(|error| SnapshotV6Error::GameState(error.to_string()))?;
        self.input_router
            .validate()
            .map_err(SnapshotV6Error::Input)?;
        self.scheduler
            .validate()
            .map_err(SnapshotV6Error::Scheduler)?;
        if let Some(protocol) = &self.protocol {
            protocol
                .validate()
                .map_err(|error| SnapshotV6Error::Protocol(error.to_string()))?;
        }
        for pair in self.prepared_transactions.windows(2) {
            if pair[0].operation_id >= pair[1].operation_id {
                return Err(SnapshotV6Error::Transaction);
            }
        }
        if self.prepared_transactions.iter().any(|transaction| {
            transaction.material_bytes.is_empty() || !valid_digest(&transaction.before_digest)
        }) {
            return Err(SnapshotV6Error::Transaction);
        }
        Ok(())
    }
}

impl KernelTraceV6 {
    pub fn validate(&self) -> Result<(), SnapshotV6Error> {
        if self.schema_version != KERNEL_TRACE_SCHEMA_VERSION_V6 {
            return Err(SnapshotV6Error::Trace);
        }
        self.initial.validate()?;
        if self
            .events
            .windows(2)
            .any(|pair| pair[0].sequence >= pair[1].sequence)
            || self.events.iter().any(|event| {
                !valid_digest(&event.expected_mechanical_digest)
                    || !valid_digest(&event.expected_kernel_digest)
                    || !trace_input_valid(&event.input)
            })
        {
            return Err(SnapshotV6Error::Trace);
        }
        Ok(())
    }
}

fn trace_input_valid(input: &ExternalTraceInputV6) -> bool {
    match input {
        ExternalTraceInputV6::NetworkFrame { bytes, .. } => !bytes.is_empty(),
        ExternalTraceInputV6::PresentationSettled { event_id, .. } => !event_id.is_empty(),
        _ => true,
    }
}

fn valid_digest(value: &str) -> bool {
    value.strip_prefix("blake3-v1:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

#[cfg(test)]
mod tests {
    use super::{ExternalTraceInputV6, trace_input_valid, valid_digest};

    #[test]
    fn digest_contract_rejects_wrong_prefix_case_and_length() {
        assert!(valid_digest(&format!("blake3-v1:{}", "a".repeat(64))));
        assert!(!valid_digest(&format!("blake3-v2:{}", "a".repeat(64))));
        assert!(!valid_digest(&format!("blake3-v1:{}", "A".repeat(64))));
        assert!(!valid_digest(&format!("blake3-v1:{}", "a".repeat(63))));
    }

    #[test]
    fn presentation_trace_requires_stable_event_identity() {
        assert!(!trace_input_valid(
            &ExternalTraceInputV6::PresentationSettled {
                event_id: String::new(),
                settled: true,
            }
        ));
    }
}
