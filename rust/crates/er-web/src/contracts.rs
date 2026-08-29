//! Frozen M8 browser worker request, response, effect, and fault schemas.

use er_types::{RawInputEvent, SafeU53};
use serde::{Deserialize, Serialize};

pub const BROWSER_WORKER_PROTOCOL_VERSION_V1: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrowserExecutionModeV1 {
    LegacyTypeScript,
    TypeScriptWithRustShadow,
    RustLocalAuthority,
    RustStagingAuthority,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserLifecycleEventV1 {
    VisibilityChanged(String),
    PageHidden,
    PageShown,
    PageFreeze,
    PageResume,
    BeforeUnload,
    NetworkOnline,
    NetworkOffline,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserInitV1 {
    pub mode: BrowserExecutionModeV1,
    pub execution_identity_bytes: Vec<u8>,
    pub session_start_bytes: Vec<u8>,
    pub maximum_pending_requests: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserRequestV1 {
    Initialize(BrowserInitV1),
    RawInput(RawInputEvent),
    AdvanceTime(SafeU53),
    TimerWakeup {
        monotonic_micros: SafeU53,
    },
    NetworkFrame {
        generation: SafeU53,
        bytes: Vec<u8>,
    },
    TransportChanged {
        generation: SafeU53,
        connected: bool,
    },
    StorageResult {
        request_id: SafeU53,
        bytes: Vec<u8>,
    },
    PresentationSettled {
        event_id: String,
        outcome: String,
    },
    Lifecycle(BrowserLifecycleEventV1),
    Observe {
        profile: String,
    },
    Snapshot,
    ExportRepro,
    Dispose,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserRequestEnvelopeV1 {
    pub version: u32,
    pub request_id: SafeU53,
    pub sequence: SafeU53,
    pub request: BrowserRequestV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserEffectV1 {
    UiChanged(Vec<u8>),
    Presentation(Vec<u8>),
    PresentationSceneChanged(Vec<u8>),
    SendNetworkFrame { generation: SafeU53, bytes: Vec<u8> },
    StorageRequest(Vec<u8>),
    AssetRequest(Vec<u8>),
    AudioCue(Vec<u8>),
    Terminal(Vec<u8>),
    Telemetry(Vec<u8>),
    ReproReady(Vec<u8>),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserEffectBatchV1 {
    pub external_sequence: SafeU53,
    pub effects: Vec<BrowserEffectV1>,
    pub observation_bytes: Vec<u8>,
    pub next_wakeup_micros: Option<SafeU53>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserKernelFaultV1 {
    pub code: String,
    pub message: String,
    pub normalized_panic: Option<String>,
    pub repro_reference: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind", content = "value")]
pub enum BrowserResponseV1 {
    Ready { identity_bytes: Vec<u8> },
    Effects(BrowserEffectBatchV1),
    Observation(Vec<u8>),
    Snapshot(Vec<u8>),
    Repro(Vec<u8>),
    Fault(BrowserKernelFaultV1),
    Disposed,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserResponseEnvelopeV1 {
    pub version: u32,
    pub request_id: SafeU53,
    pub accepted_sequence: SafeU53,
    pub after_mechanical_digest: String,
    pub response: BrowserResponseV1,
}
