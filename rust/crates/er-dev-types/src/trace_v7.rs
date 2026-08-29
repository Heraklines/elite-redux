//! Generic V7 external-event trace with separated mechanical and diagnostic evidence.

use er_types::{RawInputEvent, SafeU53};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{identity::ExecutionIdentityV1, snapshot_v7::RestorableKernelSnapshotV7};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum ExternalTraceInputV7 {
    RawInput(RawInputEvent),
    AdvanceTime(SafeU53),
    NetworkFrame(Vec<u8>),
    PresentationSettled(Vec<u8>),
    StorageResult(Vec<u8>),
    TransportChanged(Vec<u8>),
    Suspend,
    Resume,
    ModelInferenceCompleted(Vec<u8>),
    PlatformLifecycleEvent(Vec<u8>),
    RendererFault(Vec<u8>),
    AssetResult(Vec<u8>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpectedEvidenceV1 {
    pub mechanical_digest: String,
    pub kernel_digest: String,
    pub ui_digest: String,
    pub protocol_digest: String,
    pub scheduler_digest: String,
    pub presentation_digest: String,
    pub rng_digest: String,
    pub save_digest: Option<String>,
    pub diagnostic_root: String,
    pub causal_evidence_digest: String,
    pub live_resources: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelTraceEventV7 {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input: ExternalTraceInputV7,
    pub expected: ExpectedEvidenceV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelTraceV7<K> {
    pub schema_version: u32,
    pub identity: ExecutionIdentityV1,
    pub initial: RestorableKernelSnapshotV7<K>,
    pub events: Vec<KernelTraceEventV7>,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum TraceV7Error {
    #[error("trace V7 schema version must be 7")]
    Version,
    #[error("trace V7 event sequence must be strictly increasing")]
    Sequence,
    #[error("trace V7 expected evidence contains an empty digest")]
    Evidence,
}

impl<K> KernelTraceV7<K> {
    pub fn validate(&self) -> Result<(), TraceV7Error> {
        if self.schema_version != 7 {
            return Err(TraceV7Error::Version);
        }
        if self
            .events
            .windows(2)
            .any(|pair| pair[0].sequence >= pair[1].sequence)
        {
            return Err(TraceV7Error::Sequence);
        }
        if self.events.iter().any(|event| {
            let expected = &event.expected;
            expected.mechanical_digest.is_empty()
                || expected.kernel_digest.is_empty()
                || expected.ui_digest.is_empty()
                || expected.protocol_digest.is_empty()
                || expected.scheduler_digest.is_empty()
                || expected.presentation_digest.is_empty()
                || expected.rng_digest.is_empty()
                || expected.diagnostic_root.is_empty()
                || expected.causal_evidence_digest.is_empty()
        }) {
            return Err(TraceV7Error::Evidence);
        }
        Ok(())
    }
}
