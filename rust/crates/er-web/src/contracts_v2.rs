//! Typed browser worker contracts for BrowserKernelHostV2.

use er_game::m9e_content_v2::{
    PresentationAssetIdentityV1, PresentationAudioCueV1, PresentationSemanticIdV1,
};
use er_game::m9e_material_v6::{GamePresentationEffectV2, GameTelemetryEventV2};
use er_kernel::game_kernel_v7::GameKernelRoleV7;
use er_kernel::snapshot::KernelSchedulerSnapshotV2;
use er_kernel::snapshot_v7::CoreGameKernelSnapshotV7;
use er_protocol::ProtocolRuntimeSnapshotV2;
use er_save::m9e_save_v2::GameSaveV2;
use er_state::m7_state::ProfileStateV1;
use er_types::{
    GameControlPlanV2, PlatformRequestId, PresentationEventId, RawInputEvent, SafeU53, ScenarioId,
    SeatId, TerminalState,
};
use serde::{Deserialize, Serialize};

pub const BROWSER_WORKER_PROTOCOL_VERSION_V2: u32 = 2;
pub const MAXIMUM_BROWSER_REQUEST_BYTES_V2: usize = 16 * 1024 * 1024;
pub const MAXIMUM_BROWSER_RESPONSE_BYTES_V2: usize = 32 * 1024 * 1024;
pub const MAXIMUM_BROWSER_BATCH_REQUESTS_V2: usize = 256;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserSessionContextV2 {
    pub local_seat: SeatId,
    pub role: GameKernelRoleV7,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: Option<ProtocolRuntimeSnapshotV2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BrowserSessionInitializationV2 {
    NaturalStart {
        context: BrowserSessionContextV2,
        profile: ProfileStateV1,
        seed: String,
        save_slots: Vec<String>,
        local_is_host: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        existing_saves: bool,
    },
    ExistingSave {
        context: BrowserSessionContextV2,
        save: GameSaveV2,
    },
    Snapshot {
        context: BrowserSessionContextV2,
        snapshot: CoreGameKernelSnapshotV7,
    },
    Scenario {
        context: BrowserSessionContextV2,
        snapshot: CoreGameKernelSnapshotV7,
        scenario: ScenarioId,
    },
    /// Historical raw-input-only replay, retained for explicit compatibility.
    ReproCapsule {
        context: BrowserSessionContextV2,
        snapshot: CoreGameKernelSnapshotV7,
        inputs: Vec<RawInputEvent>,
    },
    /// Current causal capsule with explicit browser transport context.
    CurrentReproCapsule { capsule_bytes: Vec<u8> },
}

fn is_false(value: &bool) -> bool { !*value }

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrowserLifecycleEventV2 {
    Suspend,
    Resume,
    Hidden,
    Visible,
    PageHide,
    PageShow,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BrowserPresentationOutcomeV2 {
    Settled,
    IntentionallySkipped,
    Failed { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BrowserStorageResultV2 {
    Read { bytes: Option<Vec<u8>> },
    Written,
    Deleted,
    Slots { slots: Vec<String> },
    Failed { reason: String },
    Conflict { current_generation: SafeU53 },
    Uncertain { reason: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BrowserRequestV2 {
    Initialize {
        initialization: Box<BrowserSessionInitializationV2>,
    },
    RawInput {
        event: RawInputEvent,
    },
    AdvanceTime {
        milliseconds: SafeU53,
    },
    ProposalFrame {
        bytes: Vec<u8>,
    },
    AuthorityMaterial {
        bytes: Vec<u8>,
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
        request_id: PlatformRequestId,
        result: BrowserStorageResultV2,
    },
    PresentationSettled {
        event_id: PresentationEventId,
        outcome: BrowserPresentationOutcomeV2,
    },
    Lifecycle {
        event: BrowserLifecycleEventV2,
    },
    Snapshot,
    ExportRepro,
    Dispose,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserRequestEnvelopeV2 {
    pub version: u32,
    pub request_id: SafeU53,
    pub sequence: SafeU53,
    pub request: BrowserRequestV2,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BrowserStorageRequestKindV2 {
    Read,
    Write,
    Delete,
    List,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserStorageRequestV2 {
    pub request_id: PlatformRequestId,
    pub kind: BrowserStorageRequestKindV2,
    pub slot: Option<String>,
    pub generation: Option<SafeU53>,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BrowserEffectV2 {
    UiChanged {
        control: GameControlPlanV2,
    },
    Presentation {
        effect: GamePresentationEffectV2,
    },
    PresentationSceneChanged {
        semantic: PresentationSemanticIdV1,
    },
    SendNetworkFrame {
        generation: SafeU53,
        bytes: Vec<u8>,
    },
    StorageRequest {
        request: BrowserStorageRequestV2,
    },
    AssetRequest {
        asset: PresentationAssetIdentityV1,
    },
    AudioCue {
        cue: PresentationAudioCueV1,
    },
    Terminal {
        terminal: TerminalState,
    },
    Telemetry {
        event: GameTelemetryEventV2,
    },
    /// Historical raw-input-only capsule response.
    ReproReady {
        snapshot: Box<CoreGameKernelSnapshotV7>,
        inputs: Vec<RawInputEvent>,
    },
    /// Canonical current capsule JSON, including browser transport context.
    CurrentReproReady {
        capsule_bytes: Vec<u8>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserEffectBatchV2 {
    pub external_sequence: SafeU53,
    pub effects: Vec<BrowserEffectV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserKernelFaultV2 {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", tag = "kind")]
pub enum BrowserResponseV2 {
    Ready,
    Effects {
        batch: BrowserEffectBatchV2,
    },
    Snapshot {
        snapshot: Box<CoreGameKernelSnapshotV7>,
    },
    Fault {
        fault: BrowserKernelFaultV2,
    },
    Disposed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserResponseEnvelopeV2 {
    pub version: u32,
    pub request_id: SafeU53,
    pub accepted_sequence: SafeU53,
    pub response: BrowserResponseV2,
}
