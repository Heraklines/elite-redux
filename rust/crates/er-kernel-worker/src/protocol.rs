use er_kernel::snapshot_v6::ExternalTraceInputV6;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

pub const KERNEL_WORKER_ABI_VERSION_V1: u32 = 1;
pub const MAXIMUM_WORKER_FRAME_BYTES_V1: usize = 16_777_216;
pub const MAXIMUM_SNAPSHOT_BYTES_V1: usize = 8_388_608;
pub const MAXIMUM_TAIL_EVENTS_V1: usize = 4_096;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct KernelSessionIdV1(pub String);

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(transparent)]
pub struct KernelGenerationV1(pub u64);

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelGenerationIdentityV1 {
    pub schema_version: u32,
    pub session_id: KernelSessionIdV1,
    pub generation: KernelGenerationV1,
    pub artifact_sha256: String,
    pub executable_sha256: String,
    pub source_git_sha: String,
    pub worker_abi_version: u32,
    pub minimum_snapshot_schema: u32,
    pub maximum_snapshot_schema: u32,
    pub content_identity: String,
    pub build_target: String,
    pub build_profile: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationArtifactManifestV1 {
    pub schema_version: u32,
    pub identity: KernelGenerationIdentityV1,
    pub executable_name: String,
    pub executable_bytes: u64,
    pub created_unix_seconds: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerBootstrapV1 {
    pub abi_version: u32,
    pub identity: KernelGenerationIdentityV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum KernelWorkerRequestV1 {
    Hello,
    Restore {
        snapshot_bytes: Vec<u8>,
        content_bundle_bytes: Vec<u8>,
    },
    Apply(ExternalTraceInputV6),
    Observe,
    Snapshot,
    ExportRepro,
    Health,
    Dispose,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerRequestEnvelopeV1 {
    pub abi_version: u32,
    pub session_id: KernelSessionIdV1,
    pub generation: KernelGenerationV1,
    pub request_id: u64,
    pub sequence: u64,
    pub fingerprint: String,
    pub request: KernelWorkerRequestV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerHealthV1 {
    pub initialized: bool,
    pub disposed: bool,
    pub accepted_sequence: u64,
    pub applied_events: usize,
    pub owned_resources: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerFaultV1 {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum KernelWorkerResponseV1 {
    Ready(KernelGenerationIdentityV1),
    Restored { mechanical_digest: String },
    Effects { effect_bytes: Vec<u8> },
    Observation { observation_bytes: Vec<u8> },
    Snapshot { snapshot_bytes: Vec<u8> },
    Repro { capsule_bytes: Vec<u8> },
    Health(KernelWorkerHealthV1),
    Fault(KernelWorkerFaultV1),
    Disposed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelWorkerResponseEnvelopeV1 {
    pub abi_version: u32,
    pub session_id: KernelSessionIdV1,
    pub generation: KernelGenerationV1,
    pub request_id: u64,
    pub accepted_sequence: u64,
    pub after_mechanical_digest: String,
    pub response: KernelWorkerResponseV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationTraceEventV1 {
    pub sequence: u64,
    pub generation: KernelGenerationIdentityV1,
    pub input: ExternalTraceInputV6,
    pub after_mechanical_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GenerationReproCapsuleV1 {
    pub schema_version: u32,
    pub initial_generation: KernelGenerationIdentityV1,
    pub active_generation: KernelGenerationIdentityV1,
    pub snapshot_bytes: Vec<u8>,
    pub events: Vec<GenerationTraceEventV1>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum KernelWorkerProtocolErrorV1 {
    #[error("worker ABI version is unsupported")]
    Abi,
    #[error("worker generation identity is invalid: {0}")]
    Identity(&'static str),
    #[error("worker request is not addressed to this generation")]
    Address,
    #[error("worker request fingerprint differs from canonical bytes")]
    Fingerprint,
    #[error("worker request sequence is stale or non-monotonic")]
    Sequence,
    #[error("worker payload exceeds its frozen bound")]
    Oversized,
    #[error("worker protocol serialization failed: {0}")]
    Serialization(String),
}

impl KernelGenerationIdentityV1 {
    pub fn validate(&self) -> Result<(), KernelWorkerProtocolErrorV1> {
        if self.schema_version != 1 || self.worker_abi_version != KERNEL_WORKER_ABI_VERSION_V1 {
            return Err(KernelWorkerProtocolErrorV1::Abi);
        }
        if self.session_id.0.is_empty() || self.session_id.0.len() > 128 {
            return Err(KernelWorkerProtocolErrorV1::Identity("session ID"));
        }
        for digest in [&self.artifact_sha256, &self.executable_sha256] {
            if digest.len() != 64
                || !digest
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            {
                return Err(KernelWorkerProtocolErrorV1::Identity("SHA-256"));
            }
        }
        if self.source_git_sha.len() != 40
            || !self
                .source_git_sha
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(KernelWorkerProtocolErrorV1::Identity("source Git SHA"));
        }
        if self.minimum_snapshot_schema == 0
            || self.minimum_snapshot_schema > self.maximum_snapshot_schema
            || self.content_identity.is_empty()
            || self.build_target.is_empty()
            || self.build_profile.is_empty()
        {
            return Err(KernelWorkerProtocolErrorV1::Identity(
                "schema or build identity",
            ));
        }
        Ok(())
    }
}

impl KernelWorkerRequestEnvelopeV1 {
    pub fn new(
        identity: &KernelGenerationIdentityV1,
        request_id: u64,
        sequence: u64,
        request: KernelWorkerRequestV1,
    ) -> Result<Self, KernelWorkerProtocolErrorV1> {
        let fingerprint = request_fingerprint(identity, request_id, sequence, &request)?;
        Ok(Self {
            abi_version: KERNEL_WORKER_ABI_VERSION_V1,
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
        identity: &KernelGenerationIdentityV1,
        last_sequence: Option<u64>,
    ) -> Result<(), KernelWorkerProtocolErrorV1> {
        if self.abi_version != KERNEL_WORKER_ABI_VERSION_V1 {
            return Err(KernelWorkerProtocolErrorV1::Abi);
        }
        if self.session_id != identity.session_id || self.generation != identity.generation {
            return Err(KernelWorkerProtocolErrorV1::Address);
        }
        if last_sequence.is_some_and(|last| self.sequence <= last) {
            return Err(KernelWorkerProtocolErrorV1::Sequence);
        }
        let expected =
            request_fingerprint(identity, self.request_id, self.sequence, &self.request)?;
        if self.fingerprint != expected {
            return Err(KernelWorkerProtocolErrorV1::Fingerprint);
        }
        Ok(())
    }
}

fn request_fingerprint(
    identity: &KernelGenerationIdentityV1,
    request_id: u64,
    sequence: u64,
    request: &KernelWorkerRequestV1,
) -> Result<String, KernelWorkerProtocolErrorV1> {
    let bytes = serde_json::to_vec(&(identity, request_id, sequence, request))
        .map_err(|error| KernelWorkerProtocolErrorV1::Serialization(error.to_string()))?;
    if bytes.len() > MAXIMUM_WORKER_FRAME_BYTES_V1 {
        return Err(KernelWorkerProtocolErrorV1::Oversized);
    }
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
