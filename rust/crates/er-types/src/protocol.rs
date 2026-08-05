//! Authority V2 wire DTOs and kernel environment boundary values.

use std::collections::BTreeSet;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::{
    ConnectionGeneration, GameButton, MembershipRevision, OperationId, PresentationEventId,
    RawInputEvent, Revision, RunId, SafeU53, SeatId, SessionId, TimerId, UiState, UiViewModel,
};

pub const PROTOCOL_VERSION: &str = "er-coop-47";
pub const FRAME_PROTOCOL_VERSION: u32 = 2;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameContext {
    pub session_id: SessionId,
    pub run_id: RunId,
    pub session_epoch: SafeU53,
    pub seat_map_id: String,
    pub membership_revision: MembershipRevision,
    pub sender_seat_id: SeatId,
    pub authority_seat_id: SeatId,
    pub connection_generation: ConnectionGeneration,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AuthorityEntryKind {
    #[serde(rename = "TURN_COMMIT")]
    TurnCommit,
    #[serde(rename = "REPLACEMENT_COMMIT")]
    ReplacementCommit,
    #[serde(rename = "INTERACTION_COMMIT")]
    InteractionCommit,
    #[serde(rename = "CONTROL_COMMIT")]
    ControlCommit,
    #[serde(rename = "WAVE_ADVANCE")]
    WaveAdvance,
    #[serde(rename = "TERMINAL_COMMIT")]
    TerminalCommit,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Material {
    pub digest: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandControlTarget {
    pub owner_seat_id: SeatId,
    pub pokemon_id: SafeU53,
    pub field_index: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementControlAddress {
    pub operation_id: OperationId,
    pub owner_seat_id: SeatId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub occurrence: SafeU53,
    pub field_index: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandFrontierControl {
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub commands: Vec<CommandControlTarget>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacementControl {
    pub operation_id: OperationId,
    pub owner_seat_id: SeatId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub occurrence: SafeU53,
    pub field_index: SafeU53,
    pub remaining: Vec<ReplacementControlAddress>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionSuccessor {
    pub operation_kinds: Vec<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub operation_ids: Option<Vec<OperationId>>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedInteractionControl {
    pub operation_id: OperationId,
    pub owner_seat_id: SeatId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub surface_class: String,
    pub operation_kind: String,
    pub successor: InteractionSuccessor,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionControlAddress {
    pub surface_class: String,
    pub operation_kind: String,
    pub wave: SafeU53,
    pub turn: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlAddress {
    pub material_kind: String,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub operation_id: Option<OperationId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwaitSuccessorControl {
    pub after_operation_id: OperationId,
    pub epoch: SafeU53,
    pub wave: SafeU53,
    pub turn: SafeU53,
    pub allowed_kinds: Vec<AuthorityEntryKind>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub allowed_interaction_addresses: Option<Vec<InteractionControlAddress>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub allowed_control_addresses: Option<Vec<ControlAddress>>,
    pub allow_next_wave_start: bool,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub expected_operation_id: Option<OperationId>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalControl {
    pub terminal_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum NextControl {
    #[serde(rename = "COMMAND_FRONTIER")]
    CommandFrontier(CommandFrontierControl),
    #[serde(rename = "REPLACEMENT")]
    Replacement(ReplacementControl),
    #[serde(rename = "SHARED_INTERACTION")]
    SharedInteraction(SharedInteractionControl),
    #[serde(rename = "AWAIT_SUCCESSOR")]
    AwaitSuccessor(AwaitSuccessorControl),
    #[serde(rename = "TERMINAL")]
    Terminal(TerminalControl),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityEntry {
    pub context: FrameContext,
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub material: Material,
    pub next_control: NextControl,
    pub subsumes: Vec<Revision>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum AckStage {
    #[serde(rename = "admitted")]
    Admitted,
    #[serde(rename = "materialApplied")]
    MaterialApplied,
    #[serde(rename = "controlInstalled")]
    ControlInstalled,
    #[serde(rename = "presentationSettled")]
    PresentationSettled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorityReceipt {
    pub context: FrameContext,
    pub revision: Revision,
    pub operation_id: OperationId,
    pub stage: AckStage,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_optional_non_null"
    )]
    pub control_id: Option<String>,
}

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

fn deserialize_optional_non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub enum FrameType {
    #[serde(rename = "authorityEntry")]
    AuthorityEntry,
    #[serde(rename = "authorityReceipt")]
    AuthorityReceipt,
    #[serde(rename = "tailRequest")]
    TailRequest,
    #[serde(rename = "recoveryRequest")]
    RecoveryRequest,
    #[serde(rename = "recoveryBundle")]
    RecoveryBundle,
    #[serde(rename = "recoveryApplied")]
    RecoveryApplied,
    #[serde(rename = "terminal")]
    Terminal,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NetworkFrame {
    #[serde(rename = "v")]
    pub version: u32,
    #[serde(rename = "t")]
    pub frame_type: FrameType,
    #[serde(rename = "ctx")]
    pub context: FrameContext,
    #[serde(rename = "body")]
    pub body: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "owner", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TimerOwner {
    InputRepeat(GameButton),
    Protocol,
    Presentation,
    Storage,
    Kernel,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TimeClass {
    Virtual,
    Active,
    WallClock,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PresentationOutcome {
    Settled,
    Cancelled,
    Failed { reason: String },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransportState {
    Disconnected,
    Connecting,
    Connected,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StorageResult {
    Loaded { value: Option<Value> },
    Persisted,
    Failed { reason: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct StorageRequest {
    pub request_id: SafeU53,
    pub key: String,
    pub value: Option<Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PresentationEvent {
    pub event_id: PresentationEventId,
    pub event_kind: String,
    pub payload: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct TerminalState {
    pub terminal_id: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct KernelSnapshot {
    pub ui: UiState,
    pub state: Value,
}

impl Default for KernelSnapshot {
    fn default() -> Self {
        Self {
            ui: UiState::default(),
            state: Value::Object(serde_json::Map::new()),
        }
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct LiveResourceSnapshot {
    pub timers: BTreeSet<TimerId>,
    pub presentations: BTreeSet<PresentationEventId>,
    pub storage_requests: BTreeSet<SafeU53>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KernelInput {
    RawInput {
        seat: SeatId,
        event: RawInputEvent,
    },
    NetworkFrame {
        endpoint: SeatId,
        frame: NetworkFrame,
    },
    TimerFired {
        endpoint: SeatId,
        timer_id: TimerId,
    },
    PresentationSettled {
        endpoint: SeatId,
        event_id: PresentationEventId,
        outcome: PresentationOutcome,
    },
    TransportChanged {
        endpoint: SeatId,
        state: TransportState,
        generation: ConnectionGeneration,
    },
    StorageResult {
        endpoint: SeatId,
        request_id: SafeU53,
        result: StorageResult,
    },
    Suspend {
        endpoint: SeatId,
    },
    Resume {
        endpoint: SeatId,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum KernelEffect {
    SendFrame {
        from: SeatId,
        frame: NetworkFrame,
    },
    ScheduleTimer {
        endpoint: SeatId,
        timer_id: TimerId,
        owner: TimerOwner,
        delay_ms: SafeU53,
        time_class: TimeClass,
    },
    CancelTimer {
        endpoint: SeatId,
        timer_id: TimerId,
    },
    UiChanged {
        endpoint: SeatId,
        view: UiViewModel,
    },
    Present {
        endpoint: SeatId,
        event: PresentationEvent,
    },
    Persist {
        endpoint: SeatId,
        request: StorageRequest,
    },
    EnterSharedTerminal {
        terminal: TerminalState,
    },
}
