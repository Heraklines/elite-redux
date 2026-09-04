//! Current V7 worker ABI. V1 remains a separately selected historical protocol.

use er_env::current::{CurrentExternalEvent, CurrentGameObservation};
use er_game::m9e_content_v2::GameContentBundleV2;
use er_kernel::game_kernel_v7::{GameKernelRoleV7, GameKernelStepV7};
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_state::m7_state::ProfileStateV1;
use er_types::{GameContentIdentityV2, SeatId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::protocol::{KernelGenerationV1, KernelSessionIdV1};

pub const KERNEL_WORKER_ABI_VERSION_V2: u32 = 2;
pub const MAXIMUM_WORKER_FRAME_BYTES_V2: usize = 16_777_216;
pub const MAXIMUM_SNAPSHOT_BYTES_V2: usize = 8_388_608;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelGenerationIdentityV2 {
    pub schema_version: u32,
    pub session_id: KernelSessionIdV1,
    pub generation: KernelGenerationV1,
    pub artifact_sha256: String,
    pub executable_sha256: String,
    pub source_git_sha: String,
    pub worker_abi_version: u32,
    pub minimum_snapshot_schema: u32,
    pub maximum_snapshot_schema: u32,
    pub content_identity: GameContentIdentityV2,
    pub build_target: String,
    pub build_profile: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerBootstrapV2 {
    pub abi_version: u32,
    pub identity: KernelGenerationIdentityV2,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "SCREAMING_SNAKE_CASE",
    tag = "kind",
    content = "value",
    deny_unknown_fields
)]
pub enum KernelWorkerInitializationV2 {
    Natural {
        profile: Box<ProfileStateV1>,
        seed: String,
        local_seat: SeatId,
        save_slots: Vec<String>,
        local_is_host: bool,
        scheduler: KernelSchedulerSnapshotV2,
        protocol: Box<Option<ProtocolRuntimeSnapshotV2>>,
    },
    Snapshot {
        snapshot_bytes: Vec<u8>,
        local_seat: SeatId,
        role: GameKernelRoleV7,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "SCREAMING_SNAKE_CASE",
    tag = "kind",
    content = "value",
    deny_unknown_fields
)]
pub enum KernelWorkerRequestV2 {
    Hello,
    Initialize {
        content_bundle: Box<GameContentBundleV2>,
        initialization: Box<KernelWorkerInitializationV2>,
    },
    Restore {
        snapshot_bytes: Vec<u8>,
        local_seat: SeatId,
        role: GameKernelRoleV7,
    },
    /// Reuses the current event schema, including its existing nested-field serde behavior.
    /// This ABI does not tighten that shared event type's unknown-field handling.
    Apply(CurrentExternalEvent),
    Observe,
    Snapshot,
    ExportRepro,
    Health,
    Dispose,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerRequestEnvelopeV2 {
    pub abi_version: u32,
    pub session_id: KernelSessionIdV1,
    pub generation: KernelGenerationV1,
    pub request_id: u64,
    pub sequence: u64,
    pub fingerprint: String,
    pub request: KernelWorkerRequestV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerHealthV2 {
    pub initialized: bool,
    pub disposed: bool,
    pub accepted_sequence: Option<u64>,
    pub applied_events: u64,
    pub prepared_content_retained: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KernelWorkerFaultCodeV2 {
    ProtocolViolation,
    NotInitialized,
    AlreadyInitialized,
    ContentRejected,
    SnapshotRejected,
    KernelFailure,
    ResponseTooLarge,
    SerializationFailure,
    UnsupportedOperation,
    Disposed,
    ResourceExhausted,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerFaultV2 {
    pub code: KernelWorkerFaultCodeV2,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    rename_all = "SCREAMING_SNAKE_CASE",
    tag = "kind",
    content = "value",
    deny_unknown_fields
)]
pub enum KernelWorkerResponseV2 {
    Ready(Box<KernelGenerationIdentityV2>),
    Initialized {
        observation: Box<CurrentGameObservation>,
    },
    Restored {
        observation: Box<CurrentGameObservation>,
    },
    Effects {
        step: GameKernelStepV7,
        observation: Box<CurrentGameObservation>,
    },
    Observation(Box<CurrentGameObservation>),
    Snapshot {
        snapshot: Box<CoreGameKernelSnapshotV7>,
    },
    Health(KernelWorkerHealthV2),
    Fault(KernelWorkerFaultV2),
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerResponseEnvelopeV2 {
    pub abi_version: u32,
    pub session_id: KernelSessionIdV1,
    pub generation: KernelGenerationV1,
    pub request_id: u64,
    pub accepted_sequence: Option<u64>,
    pub after_mechanical_digest: Option<String>,
    pub response: KernelWorkerResponseV2,
}

#[derive(Debug, Error)]
pub enum KernelWorkerProtocolErrorV2 {
    #[error("current worker ABI or snapshot schema is unsupported")]
    Abi,
    #[error("current worker generation identity is invalid: {0}")]
    Identity(&'static str),
    #[error("current worker request is addressed to another session or generation")]
    Address,
    #[error("current worker request sequence must begin at zero and advance by one")]
    Sequence,
    #[error("current worker request fingerprint differs from canonical bytes")]
    Fingerprint,
    #[error("current worker frame exceeds its bound")]
    Oversized,
    #[error("current worker protocol serialization failed: {0}")]
    Serialization(String),
}

impl KernelGenerationIdentityV2 {
    pub fn validate(&self) -> Result<(), KernelWorkerProtocolErrorV2> {
        if self.schema_version != 2
            || self.worker_abi_version != KERNEL_WORKER_ABI_VERSION_V2
            || self.minimum_snapshot_schema != 7
            || self.maximum_snapshot_schema != 7
        {
            return Err(KernelWorkerProtocolErrorV2::Abi);
        }
        if self.session_id.0.is_empty() || self.session_id.0.len() > 128 || self.generation.0 == 0 {
            return Err(KernelWorkerProtocolErrorV2::Identity(
                "session or generation",
            ));
        }
        if !is_hex(&self.artifact_sha256, 64)
            || !is_hex(&self.executable_sha256, 64)
            || !is_hex(&self.source_git_sha, 40)
        {
            return Err(KernelWorkerProtocolErrorV2::Identity(
                "source or artifact digest",
            ));
        }
        if self.build_target.is_empty()
            || self.build_target.len() > 256
            || self.build_profile.is_empty()
            || self.build_profile.len() > 64
        {
            return Err(KernelWorkerProtocolErrorV2::Identity(
                "build target or profile",
            ));
        }
        Ok(())
    }
}

impl KernelWorkerRequestEnvelopeV2 {
    pub fn new(
        identity: &KernelGenerationIdentityV2,
        request_id: u64,
        sequence: u64,
        request: KernelWorkerRequestV2,
    ) -> Result<Self, KernelWorkerProtocolErrorV2> {
        identity.validate()?;
        let fingerprint = request_fingerprint(identity, request_id, sequence, &request)?;
        Ok(Self {
            abi_version: KERNEL_WORKER_ABI_VERSION_V2,
            session_id: identity.session_id.clone(),
            generation: identity.generation,
            request_id,
            sequence,
            fingerprint,
            request,
        })
    }

    pub fn validate_for(
        &self,
        identity: &KernelGenerationIdentityV2,
        accepted_sequence: Option<u64>,
    ) -> Result<(), KernelWorkerProtocolErrorV2> {
        if self.abi_version != KERNEL_WORKER_ABI_VERSION_V2 {
            return Err(KernelWorkerProtocolErrorV2::Abi);
        }
        if self.session_id != identity.session_id
            || self.generation != identity.generation
            || self.request_id == 0
        {
            return Err(KernelWorkerProtocolErrorV2::Address);
        }
        let expected = match accepted_sequence {
            Some(sequence) => sequence
                .checked_add(1)
                .ok_or(KernelWorkerProtocolErrorV2::Sequence)?,
            None => 0,
        };
        if self.sequence != expected {
            return Err(KernelWorkerProtocolErrorV2::Sequence);
        }
        if self.fingerprint
            != request_fingerprint(identity, self.request_id, self.sequence, &self.request)?
        {
            return Err(KernelWorkerProtocolErrorV2::Fingerprint);
        }
        let bytes = serde_json::to_vec(self)
            .map_err(|error| KernelWorkerProtocolErrorV2::Serialization(error.to_string()))?;
        if bytes.len() > MAXIMUM_WORKER_FRAME_BYTES_V2 {
            return Err(KernelWorkerProtocolErrorV2::Oversized);
        }
        Ok(())
    }
}

fn request_fingerprint(
    identity: &KernelGenerationIdentityV2,
    request_id: u64,
    sequence: u64,
    request: &KernelWorkerRequestV2,
) -> Result<String, KernelWorkerProtocolErrorV2> {
    let bytes = er_canonical::canonical_bytes(&(
        KERNEL_WORKER_ABI_VERSION_V2,
        identity,
        request_id,
        sequence,
        request,
    ))
    .map_err(|error| KernelWorkerProtocolErrorV2::Serialization(error.to_string()))?;
    if bytes.len() > MAXIMUM_WORKER_FRAME_BYTES_V2 {
        return Err(KernelWorkerProtocolErrorV2::Oversized);
    }
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn is_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}
