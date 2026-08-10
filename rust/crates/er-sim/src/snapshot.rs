//! Closed pair/environment snapshots and deterministic fault-script DTOs.
//!
//! These values are intentionally independent of the older diagnostic
//! `PairSnapshot`.  Counts, IDs-only projections, and renderer summaries are
//! useful evidence, but they are not sufficient to resume a pair.  M3C-11
//! acceptance still requires the owner bridge to extract and restore every
//! live field, including queued packet bodies and continuation effects.

use std::fmt;
use std::sync::Arc;

use er_canonical::content_digest;
use er_content::pack::ContentPack;
use er_kernel::snapshot::{
    KernelDeterminismDigest, LiveResourceSnapshot, MechanicalStateDigest, PhysicalInputSourceV2,
    RestorableKernelSnapshotV2, RestorableTimerSnapshotV2, RngDraw,
};
use er_types::battle_ids::{
    BattlePresentationEventId, CanonicalHexBytes,
};
use er_types::battle_ui::{
    BattlePresentationEvent, PresentationSettlementOutcome,
};
use er_types::{
    ConnectionGeneration, InputFocus, PhysicalKey, RawInputEvent, SafeU53, SeatId, TerminalState,
    TimeClass, TimerId, TransportState,
};
use serde::{Deserialize, Deserializer, Serialize, de::Error as _};
use thiserror::Error;

use crate::PairEndpoint;

/// Integration seam for `SimulatedPair` and every private environment owner.
///
/// The implementation belongs in `pair.rs` and the environment owner
/// modules. It must retain actual detached-driver state, virtual-clock
/// registrations, full queued packet bodies/generations, presenter event
/// payloads and tombstones, storage values/requests, fault-script cursor, and
/// exact fault RNG state. Restoration must construct a fresh pair only after
/// complete validation, so an error cannot partially mutate either endpoint.
pub trait SimulatedPairSnapshotBridge: Sized {
    fn snapshot_v2(&self) -> Result<RestorablePairSnapshotV2, SnapshotError>;

    fn from_snapshot_v2(
        snapshot: RestorablePairSnapshotV2,
        content: Arc<ContentPack>,
    ) -> Result<Self, SnapshotError>;
}

/// Validate a bridge-produced pair snapshot before publishing it.
pub fn snapshot_simulated_pair<B: SimulatedPairSnapshotBridge>(
    pair: &B,
) -> Result<RestorablePairSnapshotV2, SnapshotError> {
    let snapshot = pair.snapshot_v2()?;
    snapshot.validate()?;
    Ok(snapshot)
}

/// Validate the complete pair/environment state before delegating to the
/// owner-specific fail-atomic constructor.
pub fn restore_simulated_pair<B: SimulatedPairSnapshotBridge>(
    snapshot: RestorablePairSnapshotV2,
    content: Arc<ContentPack>,
) -> Result<B, SnapshotError> {
    snapshot.validate()?;
    if snapshot.host.content_hash != content.hash {
        return Err(invalid(
            "host.content_hash",
            "snapshot content identity differs from supplied ContentPack",
        ));
    }
    B::from_snapshot_v2(snapshot, content)
}

pub const RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION: u32 = 2;
pub const PAIR_DETERMINISM_DIGEST_DOMAIN: &str = "pokerogue-redux/m3/pair-determinism/v1";
pub const PAIR_DETERMINISM_DIGEST_PREFIX: &str = "blake3-v1:";

fn deserialize_required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DriverHoldSnapshotV2 {
    pub key: PhysicalKey,
    pub remaining_ms: SafeU53,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DetachedKeyboardDriverSnapshotV2 {
    pub seat: er_types::SeatId,
    pub focus: InputFocus,
    pub pressed_keys: Vec<PhysicalKey>,
    pub active_holds: Vec<DriverHoldSnapshotV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VirtualClockSnapshotV2 {
    pub now_ms: SafeU53,
    pub timers: Vec<PairClockTimerSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairClockTimerSnapshotV2 {
    pub endpoint: er_types::SeatId,
    pub timer_id: TimerId,
    pub time_class: TimeClass,
    pub remaining_active_ms: SafeU53,
    pub paused: bool,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RestorablePacketKindV2 {
    AuthorityFrame,
    CommandProposal,
    ReplacementProposal,
    ControlReceipt,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PacketReorderStateV2 {
    Stable,
    Held { rank: SafeU53 },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PacketDispositionV2 {
    Queued,
    Delayed,
    Ready,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkLinkSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub generation: ConnectionGeneration,
    pub connected: bool,
    pub suspended: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QueuedPacketSnapshotV2 {
    pub packet_id: SafeU53,
    pub queue_order_id: SafeU53,
    pub kind: RestorablePacketKindV2,
    pub source: PairEndpoint,
    pub destination: PairEndpoint,
    pub source_generation: ConnectionGeneration,
    pub destination_generation: ConnectionGeneration,
    pub body: CanonicalHexBytes,
    pub enqueued_at_ms: SafeU53,
    pub delivery_deadline_ms: SafeU53,
    pub reorder_state: PacketReorderStateV2,
    pub disposition: PacketDispositionV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaultNetworkSnapshotV2 {
    pub next_packet_id: SafeU53,
    pub next_queue_order_id: SafeU53,
    pub packets: Vec<QueuedPacketSnapshotV2>,
    pub links: Vec<NetworkLinkSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresenterSnapshotV2 {
    pub pending: Vec<PairPresenterEventSnapshotV2>,
    pub outcomes: Vec<PairPresenterOutcomeSnapshotV2>,
    pub tombstones: Vec<PairPresenterTombstoneSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairPresenterEventSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub event: BattlePresentationEvent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairPresenterOutcomeSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub outcome: er_kernel::snapshot::PresentationOutcomeSnapshotV1,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairPresenterTombstoneSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub event_id: BattlePresentationEventId,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageValueSnapshotV2 {
    pub key: String,
    pub canonical_value: CanonicalHexBytes,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RestorableStorageRequestV2 {
    Load { request_id: SafeU53, key: String },
    Persist {
        request_id: SafeU53,
        key: String,
        value: CanonicalHexBytes,
    },
}

impl RestorableStorageRequestV2 {
    pub fn request_id(&self) -> SafeU53 {
        match self {
            Self::Load { request_id, .. } | Self::Persist { request_id, .. } => *request_id,
        }
    }

    pub fn key(&self) -> &str {
        match self {
            Self::Load { key, .. } | Self::Persist { key, .. } => key,
        }
    }

    pub fn validate(&self, path: &str) -> Result<(), SnapshotError> {
        if self.key().is_empty() {
            return Err(invalid(path, "storage key must not be empty"));
        }
        if let Self::Persist { value, .. } = self {
            validate_bytes(value, path)?;
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageRequestSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub request: RestorableStorageRequestV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageFaultSnapshotV2 {
    pub reason: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RestorableStorageResultV2 {
    Loaded {
        #[serde(deserialize_with = "deserialize_required_nullable")]
        value: Option<CanonicalHexBytes>,
    },
    Persisted,
    Failed { reason: String },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageSnapshotV2 {
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub next_request_id: Option<SafeU53>,
    pub values: Vec<StorageValueSnapshotV2>,
    pub pending_requests: Vec<StorageRequestSnapshotV2>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub one_shot_fault: Option<StorageFaultSnapshotV2>,
    pub disposed: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum FrameCorruptionV2 {
    Replace { body: CanonicalHexBytes },
    DeleteField { json_pointer: String },
    ReplaceField {
        json_pointer: String,
        canonical_value: CanonicalHexBytes,
    },
    MalformedJson { body: CanonicalHexBytes },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum FaultOperationV2 {
    Deliver { packet_id: SafeU53 },
    DeliverNext,
    Drop { packet_id: SafeU53 },
    Duplicate { packet_id: SafeU53 },
    Delay {
        packet_id: SafeU53,
        additional_ms: SafeU53,
    },
    Reorder { packet_ids: Vec<SafeU53> },
    Corrupt {
        packet_id: SafeU53,
        corruption: FrameCorruptionV2,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaultScriptSnapshotV2 {
    pub cursor: SafeU53,
    pub operations: Vec<FaultOperationV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaultRngStateV2 {
    pub algorithm_version: u32,
    pub state_bits: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum PairOperationV2 {
    RawInput {
        endpoint: PairEndpoint,
        event: RawInputEvent,
    },
    AdvanceTime { delta_ms: SafeU53 },
    Fault { operation: FaultOperationV2 },
    Disconnect { endpoint: PairEndpoint },
    Reconnect { endpoint: PairEndpoint },
    BattlePresentationOutcome {
        endpoint: PairEndpoint,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    },
    StorageResult {
        endpoint: PairEndpoint,
        request_id: SafeU53,
        result: RestorableStorageResultV2,
    },
    Suspend { endpoint: PairEndpoint },
    Resume { endpoint: PairEndpoint },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorablePairSnapshotV2 {
    pub schema_version: u32,
    pub sequence: SafeU53,
    pub replay_seed: String,
    pub virtual_time_ms: SafeU53,
    pub host: RestorableKernelSnapshotV2,
    pub guest: RestorableKernelSnapshotV2,
    pub host_driver: DetachedKeyboardDriverSnapshotV2,
    pub guest_driver: DetachedKeyboardDriverSnapshotV2,
    pub clock: VirtualClockSnapshotV2,
    pub network: FaultNetworkSnapshotV2,
    pub presenter: PresenterSnapshotV2,
    pub storage: StorageSnapshotV2,
    pub fault_script: FaultScriptSnapshotV2,
    pub fault_rng_state: FaultRngStateV2,
}

pub const KERNEL_TRACE_SCHEMA_VERSION: u32 = 2;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RestorableKernelInputV2 {
    RawInput { seat: SeatId, event: RawInputEvent },
    NetworkFrame {
        endpoint: SeatId,
        bytes: CanonicalHexBytes,
    },
    ProposalEnvelope {
        endpoint: SeatId,
        bytes: CanonicalHexBytes,
    },
    TimerFired { endpoint: SeatId, timer_id: TimerId },
    BattlePresentationOutcome {
        endpoint: SeatId,
        event_id: BattlePresentationEventId,
        outcome: PresentationSettlementOutcome,
    },
    TransportChanged {
        endpoint: SeatId,
        state: TransportState,
        generation: ConnectionGeneration,
    },
    StorageResult {
        endpoint: SeatId,
        request_id: SafeU53,
        result: RestorableStorageResultV2,
    },
    RejectedCompatibility {
        kind: RejectedBattleCompatibilityInputV1,
        bytes: CanonicalHexBytes,
    },
    Suspend { endpoint: SeatId },
    Resume { endpoint: SeatId },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RejectedBattleCompatibilityInputV1 {
    MaterialApplied,
    ControlProjected,
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum InternalEventKindV1 {
    Button,
    Ui,
    Game,
    Protocol,
    BattleResolved,
    AuthorityEntryReady,
    MaterialInstalled,
    ControlInstalled,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum RestorableKernelEffectV2 {
    SendFrame {
        from: SeatId,
        bytes: CanonicalHexBytes,
    },
    SendProposal {
        from: SeatId,
        bytes: CanonicalHexBytes,
    },
    ScheduleTimer {
        timer: RestorableTimerSnapshotV2,
    },
    CancelTimer {
        endpoint: SeatId,
        timer_id: TimerId,
    },
    BattleUiChanged {
        endpoint: SeatId,
        projection: er_types::battle_ui::BattleUiProjection,
    },
    PresentBattle {
        endpoint: SeatId,
        event: BattlePresentationEvent,
    },
    Load {
        endpoint: SeatId,
        request: RestorableStorageRequestV2,
    },
    Persist {
        endpoint: SeatId,
        request: RestorableStorageRequestV2,
    },
    EnterSharedTerminal { terminal: TerminalState },
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum TraceFailureOwnerV2 {
    Endpoint,
    Host,
    Guest,
    Environment,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraceFailureEvidenceV2 {
    pub owner: TraceFailureOwnerV2,
    pub code: String,
    pub path: String,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub expected: Option<String>,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub actual: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KernelTraceEntryV2 {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input: RestorableKernelInputV2,
    pub effects: Vec<RestorableKernelEffectV2>,
    pub mechanical_before: MechanicalStateDigest,
    pub mechanical_after: MechanicalStateDigest,
    pub kernel_before: KernelDeterminismDigest,
    pub kernel_after: KernelDeterminismDigest,
    pub presentation_before: er_types::battle_ui::PresentationPlanDigest,
    pub presentation_after: er_types::battle_ui::PresentationPlanDigest,
    pub rng_audit: Vec<RngDraw>,
    pub rng_audit_digest: String,
    pub internal_events: Vec<InternalEventKindV1>,
    pub live_resources: LiveResourceSnapshot,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub failure: Option<TraceFailureEvidenceV2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndpointKernelTraceV2 {
    pub schema_version: u32,
    pub replay_seed: String,
    pub initial_snapshot: RestorableKernelSnapshotV2,
    pub entries: Vec<KernelTraceEntryV2>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairTraceEndpointEvidenceV2 {
    pub mechanical_before: MechanicalStateDigest,
    pub mechanical_after: MechanicalStateDigest,
    pub kernel_before: KernelDeterminismDigest,
    pub kernel_after: KernelDeterminismDigest,
    pub presentation_before: er_types::battle_ui::PresentationPlanDigest,
    pub presentation_after: er_types::battle_ui::PresentationPlanDigest,
    pub rng_audit: Vec<RngDraw>,
    pub rng_audit_digest: String,
    pub internal_events: Vec<InternalEventKindV1>,
    pub live_resources: LiveResourceSnapshot,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairTraceEffectV2 {
    pub sequence: SafeU53,
    pub origin: PairEndpoint,
    pub effect: RestorableKernelEffectV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairEnvironmentResourceSnapshotV2 {
    pub host_driver: DetachedKeyboardDriverSnapshotV2,
    pub guest_driver: DetachedKeyboardDriverSnapshotV2,
    pub clock: VirtualClockSnapshotV2,
    pub network: FaultNetworkSnapshotV2,
    pub presenter: PresenterSnapshotV2,
    pub storage: StorageSnapshotV2,
    pub fault_script: FaultScriptSnapshotV2,
    pub fault_rng_state: FaultRngStateV2,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairTraceEntryV2 {
    pub trace_sequence: SafeU53,
    pub pair_sequence_before: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input: PairOperationV2,
    pub effects: Vec<PairTraceEffectV2>,
    pub host: PairTraceEndpointEvidenceV2,
    pub guest: PairTraceEndpointEvidenceV2,
    pub pair_before: PairDeterminismDigest,
    pub pair_after: PairDeterminismDigest,
    pub environment_after: PairEnvironmentResourceSnapshotV2,
    #[serde(deserialize_with = "deserialize_required_nullable")]
    pub failure: Option<TraceFailureEvidenceV2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairKernelTraceV2 {
    pub schema_version: u32,
    pub initial_snapshot: RestorablePairSnapshotV2,
    pub entries: Vec<PairTraceEntryV2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "trace", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum KernelTraceV2 {
    Endpoint(EndpointKernelTraceV2),
    Pair(PairKernelTraceV2),
}

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(transparent)]
pub struct PairDeterminismDigest(String);

impl PairDeterminismDigest {
    pub fn new(value: impl Into<String>) -> Result<Self, SnapshotError> {
        let value = value.into();
        let Some(hex) = value.strip_prefix(PAIR_DETERMINISM_DIGEST_PREFIX) else {
            return Err(invalid(
                "pair_determinism_digest",
                "must start with blake3-v1:",
            ));
        };
        if hex.len() != 64
            || !hex
                .bytes()
                .all(|digit| matches!(digit, b'0'..=b'9' | b'a'..=b'f'))
        {
            return Err(invalid(
                "pair_determinism_digest",
                "must contain exactly 64 lowercase hexadecimal digits",
            ));
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn compute(snapshot: &RestorablePairSnapshotV2) -> Result<Self, SnapshotError> {
        let raw = content_digest(&PairDigestPreimage {
            domain: PAIR_DETERMINISM_DIGEST_DOMAIN,
            snapshot,
        })
        .map_err(|error| SnapshotError::Canonical {
            path: "pair_determinism_digest".to_owned(),
            reason: error.to_string(),
        })?;
        Self::new(format!("{PAIR_DETERMINISM_DIGEST_PREFIX}{raw}"))
    }
}

impl<'de> Deserialize<'de> for PairDeterminismDigest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

impl fmt::Display for PairDeterminismDigest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

#[derive(Serialize)]
struct PairDigestPreimage<'a> {
    domain: &'static str,
    snapshot: &'a RestorablePairSnapshotV2,
}

#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum SnapshotError {
    #[error("snapshot field {path} is invalid: {reason}")]
    Invalid { path: String, reason: String },
    #[error("snapshot canonicalization failed at {path}: {reason}")]
    Canonical { path: String, reason: String },
}

fn invalid(path: impl Into<String>, reason: impl Into<String>) -> SnapshotError {
    SnapshotError::Invalid {
        path: path.into(),
        reason: reason.into(),
    }
}

fn strictly_sorted<T: Ord>(values: &[T], path: &str) -> Result<(), SnapshotError> {
    if values.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(invalid(
            path,
            "entries must be strictly increasing and duplicate-free",
        ));
    }
    Ok(())
}

fn validate_seed(seed: &str, path: &str) -> Result<(), SnapshotError> {
    if seed.is_empty() || (seed.len() > 1 && seed.starts_with('0')) || !seed.bytes().all(|b| b.is_ascii_digit()) {
        return Err(invalid(path, "must be a canonical unsigned decimal string"));
    }
    seed.parse::<u64>()
        .map_err(|_| invalid(path, "must fit in u64"))?;
    Ok(())
}

fn validate_bytes(bytes: &CanonicalHexBytes, path: &str) -> Result<(), SnapshotError> {
    if bytes.as_str().is_empty() {
        return Err(invalid(path, "canonical byte payload must not be empty"));
    }
    Ok(())
}

fn endpoint_rank(endpoint: PairEndpoint) -> u8 {
    match endpoint {
        PairEndpoint::Host => 0,
        PairEndpoint::Guest => 1,
    }
}

fn event_key(endpoint: PairEndpoint, event_id: &BattlePresentationEventId) -> (u8, BattlePresentationEventId) {
    (endpoint_rank(endpoint), event_id.clone())
}

fn validate_driver_endpoint(
    driver: &DetachedKeyboardDriverSnapshotV2,
    endpoint: &RestorableKernelSnapshotV2,
    path: &str,
) -> Result<(), SnapshotError> {
    if driver.focus != endpoint.input_router.focus {
        return Err(invalid(
            path,
            "driver focus must equal the endpoint input-router focus",
        ));
    }
    let keyboard_pressed = endpoint
        .input_router
        .pressed
        .iter()
        .filter_map(|pressed| match &pressed.source {
            PhysicalInputSourceV2::Keyboard(key) => Some(key.clone()),
            PhysicalInputSourceV2::Gamepad(_) => None,
        })
        .collect::<Vec<_>>();
    if driver.pressed_keys != keyboard_pressed {
        return Err(invalid(
            path,
            "driver pressed keys must exactly equal physical keyboard input state",
        ));
    }
    Ok(())
}

fn validate_presenter_endpoint(
    presenter: &PresenterSnapshotV2,
    pair_endpoint: PairEndpoint,
    endpoint: &RestorableKernelSnapshotV2,
    path: &str,
) -> Result<(), SnapshotError> {
    let pending = presenter
        .pending
        .iter()
        .filter(|entry| entry.endpoint == pair_endpoint)
        .collect::<Vec<_>>();
    if pending.len() != endpoint.pending_presentations.pending_barrier_ids.len() {
        return Err(invalid(
            path,
            "presenter and endpoint have different pending barrier counts",
        ));
    }
    for event_id in &endpoint.pending_presentations.pending_barrier_ids {
        let planned = endpoint
            .pending_presentations
            .plan_events()
            .into_iter()
            .find(|event| &event.event_id == event_id)
            .ok_or_else(|| invalid(path, "pending barrier has no planned event"))?;
        if !pending.iter().any(|entry| &entry.event == &planned) {
            return Err(invalid(
                path,
                "presenter is missing the endpoint's exact pending event",
            ));
        }
    }
    for outcome in &endpoint.pending_presentations.outcomes {
        if !presenter.outcomes.iter().any(|entry| {
            entry.endpoint == pair_endpoint && &entry.outcome == outcome
        }) {
            return Err(invalid(
                path,
                "presenter is missing an endpoint presentation outcome",
            ));
        }
    }
    Ok(())
}

impl DetachedKeyboardDriverSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(&self.pressed_keys, "driver.pressed_keys")?;
        strictly_sorted(
            &self
                .active_holds
                .iter()
                .map(|hold| hold.key.clone())
                .collect::<Vec<_>>(),
            "driver.active_holds",
        )?;
        if self
            .active_holds
            .iter()
            .any(|hold| hold.remaining_ms == SafeU53::ZERO || !self.pressed_keys.contains(&hold.key))
        {
            return Err(invalid(
                "driver.active_holds",
                "active holds must retain a positive duration and a pressed physical key",
            ));
        }
        Ok(())
    }
}

impl VirtualClockSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .timers
                .iter()
                .map(|timer| (timer.endpoint, timer.timer_id))
                .collect::<Vec<_>>(),
            "clock.timers",
        )?;
        if self.disposed && !self.timers.is_empty() {
            return Err(invalid("clock", "disposed clock cannot retain timers"));
        }
        Ok(())
    }
}

impl FaultNetworkSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .packets
                .iter()
                .map(|packet| packet.queue_order_id)
                .collect::<Vec<_>>(),
            "network.packets.queue_order_id",
        )?;
        let mut packet_ids = self
            .packets
            .iter()
            .map(|packet| packet.packet_id)
            .collect::<Vec<_>>();
        packet_ids.sort_unstable();
        if packet_ids.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(invalid(
                "network.packets.packet_id",
                "packet IDs must be unique even when queue order is reordered",
            ));
        }
        if self.packets.iter().any(|packet| {
            packet.packet_id >= self.next_packet_id
                || packet.queue_order_id >= self.next_queue_order_id
        }) {
            return Err(invalid(
                "network.next_packet_id",
                "packet and queue allocators must be above every allocated ID",
            ));
        }
        strictly_sorted(
            &self
                .links
                .iter()
                .map(|link| endpoint_rank(link.endpoint))
                .collect::<Vec<_>>(),
            "network.links",
        )?;
        for packet in &self.packets {
            if packet.source == packet.destination {
                return Err(invalid(
                    "network.packets",
                    "packet source and destination must differ",
                ));
            }
            validate_bytes(&packet.body, "network.packets.body")?;
            if packet.delivery_deadline_ms < packet.enqueued_at_ms {
                return Err(invalid(
                    "network.packets.delivery_deadline_ms",
                    "delivery deadline cannot precede enqueue time",
                ));
            }
        }
        if self.links.len() != 2 {
            return Err(invalid(
                "network.links",
                "pair network must retain exactly host and guest links",
            ));
        }
        if self.disposed && !self.packets.is_empty() {
            return Err(invalid("network", "disposed network cannot retain packets"));
        }
        Ok(())
    }
}

impl PresenterSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .pending
                .iter()
                .map(|entry| event_key(entry.endpoint, &entry.event.event_id))
                .collect::<Vec<_>>(),
            "presenter.pending",
        )?;
        strictly_sorted(
            &self
                .outcomes
                .iter()
                .map(|entry| event_key(entry.endpoint, &entry.outcome.event_id))
                .collect::<Vec<_>>(),
            "presenter.outcomes",
        )?;
        strictly_sorted(
            &self
                .tombstones
                .iter()
                .map(|entry| (endpoint_rank(entry.endpoint), entry.event_id.clone()))
                .collect::<Vec<_>>(),
            "presenter.tombstones",
        )?;
        let pending_keys = self
            .pending
            .iter()
            .map(|entry| event_key(entry.endpoint, &entry.event.event_id))
            .collect::<Vec<_>>();
        let outcome_keys = self
            .outcomes
            .iter()
            .map(|entry| event_key(entry.endpoint, &entry.outcome.event_id))
            .collect::<Vec<_>>();
        let tombstone_keys = self
            .tombstones
            .iter()
            .map(|entry| event_key(entry.endpoint, &entry.event_id))
            .collect::<Vec<_>>();
        if pending_keys
            .iter()
            .any(|key| outcome_keys.contains(key) || tombstone_keys.contains(key))
            || outcome_keys.iter().any(|key| !tombstone_keys.contains(key))
        {
            return Err(invalid(
                "presenter",
                "pending identities must be unsettled and every retained outcome must have a tombstone",
            ));
        }
        if self.disposed
            && (!self.pending.is_empty()
                || !self.outcomes.is_empty()
                || !self.tombstones.is_empty())
        {
            return Err(invalid(
                "presenter",
                "disposed presenter cannot retain pending/outcome state",
            ));
        }
        Ok(())
    }
}

impl StorageSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        strictly_sorted(
            &self
                .values
                .iter()
                .map(|value| value.key.clone())
                .collect::<Vec<_>>(),
            "storage.values",
        )?;
        strictly_sorted(
            &self
                .pending_requests
                .iter()
                .map(|request| (endpoint_rank(request.endpoint), request.request.request_id()))
                .collect::<Vec<_>>(),
            "storage.pending_requests",
        )?;
        for value in &self.values {
            validate_bytes(&value.canonical_value, "storage.values.canonical_value")?;
        }
        for request in &self.pending_requests {
            if let RestorableStorageRequestV2::Persist { value, .. } = &request.request {
                validate_bytes(value, "storage.pending_requests.value")?;
            }
        }
        if let Some(next_request_id) = self.next_request_id {
            if self
                .pending_requests
                .iter()
                .any(|request| request.request.request_id() >= next_request_id)
            {
                return Err(invalid(
                    "storage.next_request_id",
                    "allocator must be above every pending request ID",
                ));
            }
        }
        if let Some(fault) = &self.one_shot_fault {
            if fault.reason.is_empty() {
                return Err(invalid("storage.one_shot_fault.reason", "must not be empty"));
            }
        }
        if self.disposed
            && (!self.values.is_empty()
                || !self.pending_requests.is_empty()
                || self.one_shot_fault.is_some())
        {
            return Err(invalid(
                "storage",
                "disposed storage cannot retain pending requests",
            ));
        }
        Ok(())
    }
}

impl FaultScriptSnapshotV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.cursor.get() > self.operations.len() as u64 {
            return Err(invalid(
                "fault_script.cursor",
                "cursor cannot exceed operation count",
            ));
        }
        for operation in &self.operations {
            if let FaultOperationV2::Reorder { packet_ids } = operation {
                let mut sorted = packet_ids.clone();
                sorted.sort_unstable();
                strictly_sorted(&sorted, "fault_script.reorder.packet_ids")?;
            }
            if let FaultOperationV2::Corrupt { corruption, .. } = operation {
                match corruption {
                    FrameCorruptionV2::DeleteField { json_pointer }
                    | FrameCorruptionV2::ReplaceField { json_pointer, .. }
                        if !json_pointer.starts_with('/') =>
                    {
                        return Err(invalid(
                            "fault_script.corruption.json_pointer",
                            "must be a non-root JSON pointer beginning with '/'",
                        ));
                    }
                    FrameCorruptionV2::ReplaceField {
                        canonical_value, ..
                    } => validate_bytes(canonical_value, "fault_script.corruption.canonical_value")?,
                    _ => {}
                }
            }
        }
        Ok(())
    }
}

impl FaultRngStateV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.algorithm_version == 0
            || self.state_bits.is_empty()
            || !self.state_bits.bytes().all(|bit| matches!(bit, b'0' | b'1'))
        {
            return Err(invalid(
                "fault_rng_state",
                "algorithm version and an exact binary state-bit string are required",
            ));
        }
        Ok(())
    }
}

impl RestorablePairSnapshotV2 {
    /// Validate the complete pair/environment snapshot before any owner is
    /// reconstructed.  No repair, dropping, renumbering, or defaults occur.
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION {
            return Err(invalid(
                "schema_version",
                format!(
                    "expected {RESTORABLE_PAIR_SNAPSHOT_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        validate_seed(&self.replay_seed, "replay_seed")?;
        if self.virtual_time_ms != self.clock.now_ms {
            return Err(invalid(
                "virtual_time_ms",
                "must equal clock.now_ms",
            ));
        }
        self.host
            .validate()
            .map_err(|error| invalid("host", error.to_string()))?;
        self.guest
            .validate()
            .map_err(|error| invalid("guest", error.to_string()))?;
        if self.host.runtime_identity.local_seat == self.guest.runtime_identity.local_seat {
            return Err(invalid(
                "host.guest.runtime_identity",
                "host and guest seats must be distinct",
            ));
        }
        if self.host.content_hash != self.guest.content_hash {
            return Err(invalid(
                "host.guest.content_hash",
                "both endpoints must use the same content identity",
            ));
        }
        let host_authority = self.host.game.state.battle.as_ref().map(|battle| battle.authority_seat);
        let guest_authority = self.guest.game.state.battle.as_ref().map(|battle| battle.authority_seat);
        if host_authority != guest_authority {
            return Err(invalid(
                "host.guest.game.state.battle.authority_seat",
                "both endpoints must name the same authority seat",
            ));
        }
        if self.host.protocol.role == self.guest.protocol.role {
            return Err(invalid(
                "host.guest.protocol.role",
                "pair endpoints must be authority/replica compatible",
            ));
        }
        if self.host_driver.seat != self.host.runtime_identity.local_seat
            || self.guest_driver.seat != self.guest.runtime_identity.local_seat
        {
            return Err(invalid(
                "driver.seat",
                "keyboard driver seat must equal its endpoint identity",
            ));
        }
        self.host_driver.validate()?;
        self.guest_driver.validate()?;
        validate_driver_endpoint(&self.host_driver, &self.host, "host_driver")?;
        validate_driver_endpoint(&self.guest_driver, &self.guest, "guest_driver")?;
        self.clock.validate()?;
        self.network.validate()?;
        self.presenter.validate()?;
        validate_presenter_endpoint(&self.presenter, PairEndpoint::Host, &self.host, "presenter.host")?;
        validate_presenter_endpoint(
            &self.presenter,
            PairEndpoint::Guest,
            &self.guest,
            "presenter.guest",
        )?;
        self.storage.validate()?;
        self.fault_script.validate()?;
        self.fault_rng_state.validate()?;
        let mut scheduler_timer_count = 0_usize;
        for (path, endpoint) in [("host.scheduler", &self.host), ("guest.scheduler", &self.guest)] {
            for timer in &endpoint.scheduler.timers {
                scheduler_timer_count += 1;
                let registration = &timer.registration;
                let clock_timer = self
                    .clock
                    .timers
                    .iter()
                    .find(|clock_timer| {
                        clock_timer.endpoint == registration.endpoint
                            && clock_timer.timer_id == registration.timer_id
                    })
                    .ok_or_else(|| invalid(path, "scheduler timer has no pair-clock registration"))?;
                let expected_paused = endpoint.scheduler.pauses.iter().any(|pause| {
                    pause.endpoint == registration.endpoint
                        && pause.time_class == registration.time_class
                });
                if clock_timer.time_class != registration.time_class
                    || clock_timer.remaining_active_ms != timer.remaining_active_ms
                    || clock_timer.paused != expected_paused
                {
                    return Err(invalid(
                        path,
                        "pair-clock duration, pause state, or time class differs from scheduler owner",
                    ));
                }
            }
        }
        if scheduler_timer_count != self.clock.timers.len() {
            return Err(invalid(
                "clock.timers",
                "pair clock contains a registration not owned by either endpoint scheduler",
            ));
        }
        let environment_disposed = self.clock.disposed
            && self.network.disposed
            && self.presenter.disposed
            && self.storage.disposed;
        if self.host.disposed != self.guest.disposed
            || self.host.disposed != environment_disposed
            || (!self.host.disposed
                && (self.clock.disposed
                    || self.network.disposed
                    || self.presenter.disposed
                    || self.storage.disposed))
        {
            return Err(invalid(
                "disposed",
                "endpoint and environment owners must enter disposal together",
            ));
        }
        let _ = PairDeterminismDigest::compute(self)?;
        Ok(())
    }
}
