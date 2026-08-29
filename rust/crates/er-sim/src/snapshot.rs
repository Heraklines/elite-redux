//! Closed pair/environment snapshots and deterministic fault-script DTOs.
//!
//! These values are intentionally independent of the older diagnostic
//! `PairSnapshot`.  Counts, IDs-only projections, and renderer summaries are
//! useful evidence, but they are not sufficient to resume a pair.  M3C-11
//! acceptance still requires the owner bridge to extract and restore every
//! live field, including queued packet bodies and continuation effects.

use std::collections::BTreeSet;
use std::fmt;
use std::sync::Arc;

use er_canonical::{canonical_bytes, content_digest};
use er_content::pack::ContentPack;
use er_kernel::snapshot::{
    GameKernelSnapshotBridge, KernelDeterminismDigest, LiveResourceSnapshot, MechanicalStateDigest,
    PhysicalInputSourceV2, RestorableKernelSnapshotV2, RestorableTimerSnapshotV2, RngDraw,
    snapshot_game_kernel, validate_live_resources as validate_kernel_live_resources,
};
use er_types::battle_ids::{BattlePresentationEventId, CanonicalHexBytes};
use er_types::battle_ui::{BattlePresentationEvent, PresentationSettlementOutcome};
use er_types::{
    ConnectionGeneration, InputFocus, PhysicalKey, RawFrame, RawInputEvent, SafeU53, SeatId,
    TerminalState, TimeClass, TimerId, TransportState,
};
use serde::{Deserialize, Deserializer, Serialize, de::DeserializeOwned, de::Error as _};
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
    Load {
        request_id: SafeU53,
        key: String,
    },
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
    Failed {
        reason: String,
    },
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
    Replace {
        body: CanonicalHexBytes,
    },
    DeleteField {
        json_pointer: String,
    },
    ReplaceField {
        json_pointer: String,
        canonical_value: CanonicalHexBytes,
    },
    MalformedJson {
        body: CanonicalHexBytes,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum FaultOperationV2 {
    Deliver {
        packet_id: SafeU53,
    },
    DeliverNext,
    Drop {
        packet_id: SafeU53,
    },
    Duplicate {
        packet_id: SafeU53,
    },
    Delay {
        packet_id: SafeU53,
        additional_ms: SafeU53,
    },
    Reorder {
        packet_ids: Vec<SafeU53>,
    },
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
    AdvanceTime {
        delta_ms: SafeU53,
    },
    Fault {
        operation: FaultOperationV2,
    },
    Disconnect {
        endpoint: PairEndpoint,
    },
    Reconnect {
        endpoint: PairEndpoint,
    },
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
    Suspend {
        endpoint: PairEndpoint,
    },
    Resume {
        endpoint: PairEndpoint,
    },
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
    RawInput {
        seat: SeatId,
        event: RawInputEvent,
    },
    NetworkFrame {
        endpoint: SeatId,
        bytes: CanonicalHexBytes,
    },
    ProposalEnvelope {
        endpoint: SeatId,
        bytes: CanonicalHexBytes,
    },
    TimerFired {
        endpoint: SeatId,
        timer_id: TimerId,
    },
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
        #[serde(rename = "compatibility_kind")]
        kind: RejectedBattleCompatibilityInputV1,
        bytes: CanonicalHexBytes,
    },
    Suspend {
        endpoint: SeatId,
    },
    Resume {
        endpoint: SeatId,
    },
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
    EnterSharedTerminal {
        terminal: TerminalState,
    },
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

// This frozen public trace union is constructed and matched across crates;
// boxing either payload would change that Rust contract.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    content = "trace",
    rename_all = "SCREAMING_SNAKE_CASE",
    deny_unknown_fields
)]
pub enum KernelTraceV2 {
    Endpoint(EndpointKernelTraceV2),
    Pair(PairKernelTraceV2),
}

/// A deterministic first-mismatch report for one trace boundary.
///
/// This is deliberately an in-memory diagnostic rather than another wire
/// DTO.  The trace's frozen `failure` field remains the wire representation;
/// this value adds the sequence and virtual-time coordinates needed to act on
/// a replay failure without changing that schema.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TraceDivergenceV2 {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub owner: TraceFailureOwnerV2,
    pub code: String,
    pub path: String,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

impl TraceDivergenceV2 {
    pub fn failure(&self) -> TraceFailureEvidenceV2 {
        TraceFailureEvidenceV2 {
            owner: self.owner,
            code: self.code.clone(),
            path: self.path.clone(),
            expected: self.expected.clone(),
            actual: self.actual.clone(),
        }
    }
}

/// Replay result.  `replayed_entries` includes the entry at which the first
/// divergence was found, matching the existing M2 replay-report convention.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TraceReplayReportV2 {
    pub replayed_entries: SafeU53,
    pub first_divergence: Option<TraceDivergenceV2>,
}

/// Post-input evidence supplied by an endpoint recorder/replay adapter.
///
/// The adapter is intentionally small: the authoritative before-state is
/// held by `EndpointKernelTraceRecorder`, while the after snapshot is taken
/// through the real public snapshot boundary.  RNG and internal-event vectors
/// are supplied by the owner that can observe them; an adapter must not infer
/// or synthesize them from a digest.
#[derive(Clone, Debug, PartialEq)]
pub struct EndpointTraceObservationV2 {
    pub virtual_time_ms: SafeU53,
    pub effects: Vec<RestorableKernelEffectV2>,
    pub after_snapshot: RestorableKernelSnapshotV2,
    pub rng_audit: Vec<RngDraw>,
    pub internal_events: Vec<InternalEventKindV1>,
    pub live_resources: LiveResourceSnapshot,
    pub failure: Option<TraceFailureEvidenceV2>,
}

/// Post-input evidence supplied by a pair recorder/replay adapter.
#[derive(Clone, Debug, PartialEq)]
pub struct PairTraceObservationV2 {
    pub effects: Vec<PairTraceEffectV2>,
    pub after_snapshot: RestorablePairSnapshotV2,
    pub host_rng_audit: Vec<RngDraw>,
    pub host_internal_events: Vec<InternalEventKindV1>,
    pub host_live_resources: LiveResourceSnapshot,
    pub guest_rng_audit: Vec<RngDraw>,
    pub guest_internal_events: Vec<InternalEventKindV1>,
    pub guest_live_resources: LiveResourceSnapshot,
    pub failure: Option<TraceFailureEvidenceV2>,
}

/// Typed replay adapter for restoring and advancing a pair trace.
pub trait PairTraceReplayDriver {
    type PairState;

    fn restore(&self, snapshot: RestorablePairSnapshotV2)
    -> Result<Self::PairState, SnapshotError>;

    fn step(
        &mut self,
        state: &mut Self::PairState,
        operation: &PairOperationV2,
        virtual_time_ms: SafeU53,
    ) -> Result<PairTraceObservationV2, SnapshotError>;
}

struct SimulatedPairTraceReplayDriver {
    content: Arc<ContentPack>,
}

impl PairTraceReplayDriver for SimulatedPairTraceReplayDriver {
    type PairState = crate::SimulatedPair;

    fn restore(
        &self,
        snapshot: RestorablePairSnapshotV2,
    ) -> Result<Self::PairState, SnapshotError> {
        crate::SimulatedPair::from_snapshot(snapshot, Arc::clone(&self.content))
    }

    fn step(
        &mut self,
        state: &mut Self::PairState,
        operation: &PairOperationV2,
        _virtual_time_ms: SafeU53,
    ) -> Result<PairTraceObservationV2, SnapshotError> {
        state.apply_trace_operation_v2(operation.clone())
    }
}

/// A fail-atomic endpoint trace builder.
///
/// `record` derives all before/after digest-chain fields from the snapshots it
/// owns.  It appends only after the candidate entry validates, so a malformed
/// observation cannot leave a half-recorded trace.
#[derive(Clone, Debug)]
pub struct EndpointKernelTraceRecorder {
    replay_seed: String,
    initial_snapshot: RestorableKernelSnapshotV2,
    current_snapshot: RestorableKernelSnapshotV2,
    entries: Vec<KernelTraceEntryV2>,
    previous_virtual_time_ms: Option<SafeU53>,
    last_rng_sequence: Option<SafeU53>,
    last_live_resources: Option<LiveResourceSnapshot>,
}

/// A fail-atomic pair trace builder.
#[derive(Clone, Debug)]
pub struct PairKernelTraceRecorder {
    initial_snapshot: RestorablePairSnapshotV2,
    current_snapshot: RestorablePairSnapshotV2,
    entries: Vec<PairTraceEntryV2>,
    host_last_rng_sequence: Option<SafeU53>,
    guest_last_rng_sequence: Option<SafeU53>,
}

impl TraceFailureEvidenceV2 {
    pub fn validate(
        &self,
        expected_owner: Option<TraceFailureOwnerV2>,
    ) -> Result<(), SnapshotError> {
        if let Some(expected_owner) = expected_owner
            && self.owner != expected_owner
        {
            return Err(invalid(
                "failure.owner",
                format!("expected {expected_owner:?}, got {:?}", self.owner),
            ));
        }
        if self.code.is_empty() {
            return Err(invalid("failure.code", "must not be empty"));
        }
        if self.path.is_empty() {
            return Err(invalid("failure.path", "must not be empty"));
        }
        if self
            .code
            .chars()
            .chain(self.path.chars())
            .any(|character| character == '\n' || character == '\r' || character == '\0')
        {
            return Err(invalid(
                "failure",
                "code and path must not contain NUL or line-break characters",
            ));
        }
        Ok(())
    }
}

impl PairEnvironmentResourceSnapshotV2 {
    pub fn from_snapshot(snapshot: &RestorablePairSnapshotV2) -> Self {
        Self {
            host_driver: snapshot.host_driver.clone(),
            guest_driver: snapshot.guest_driver.clone(),
            clock: snapshot.clock.clone(),
            network: snapshot.network.clone(),
            presenter: snapshot.presenter.clone(),
            storage: snapshot.storage.clone(),
            fault_script: snapshot.fault_script.clone(),
            fault_rng_state: snapshot.fault_rng_state.clone(),
        }
    }

    pub fn validate(&self) -> Result<(), SnapshotError> {
        self.host_driver.validate()?;
        self.guest_driver.validate()?;
        self.clock.validate()?;
        self.network.validate()?;
        self.presenter.validate()?;
        self.storage.validate()?;
        self.fault_script.validate()?;
        self.fault_rng_state.validate()?;
        Ok(())
    }
}

impl EndpointKernelTraceRecorder {
    pub fn new(
        replay_seed: impl Into<String>,
        initial_snapshot: RestorableKernelSnapshotV2,
    ) -> Result<Self, SnapshotError> {
        let replay_seed = replay_seed.into();
        validate_seed(&replay_seed, "replay_seed")?;
        initial_snapshot
            .validate()
            .map_err(|error| prefix_kernel_snapshot_error("initial_snapshot", error))?;
        Ok(Self {
            replay_seed,
            current_snapshot: initial_snapshot.clone(),
            initial_snapshot,
            entries: Vec::new(),
            previous_virtual_time_ms: None,
            last_rng_sequence: None,
            last_live_resources: None,
        })
    }

    // The frozen recorder boundary keeps every trace field explicit for callers.
    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        input: RestorableKernelInputV2,
        virtual_time_ms: SafeU53,
        effects: Vec<RestorableKernelEffectV2>,
        after_snapshot: RestorableKernelSnapshotV2,
        rng_audit: Vec<RngDraw>,
        internal_events: Vec<InternalEventKindV1>,
        live_resources: LiveResourceSnapshot,
        failure: Option<TraceFailureEvidenceV2>,
    ) -> Result<(), SnapshotError> {
        let sequence = one_based_sequence(self.entries.len(), "entries")?;
        if self
            .previous_virtual_time_ms
            .is_some_and(|previous| virtual_time_ms < previous)
        {
            return Err(invalid(
                "entries.virtual_time_ms",
                "virtual time must not regress",
            ));
        }
        validate_same_endpoint_snapshot(&self.current_snapshot, &after_snapshot)?;
        after_snapshot
            .validate()
            .map_err(|error| prefix_kernel_snapshot_error("after_snapshot", error))?;
        validate_endpoint_input(&input, self.current_snapshot.runtime_identity.local_seat)?;
        validate_endpoint_effects(&effects, self.current_snapshot.runtime_identity.local_seat)?;
        validate_rng_audit(&rng_audit, self.last_rng_sequence, "rng_audit")?;
        let rng_audit_digest_value = rng_audit_digest(&rng_audit)?;
        validate_live_resources(&live_resources)?;
        if let Some(failure) = &failure {
            failure.validate(Some(TraceFailureOwnerV2::Endpoint))?;
            if !effects.is_empty() {
                return Err(invalid(
                    "failure",
                    "a rejected endpoint input must not publish effects",
                ));
            }
            if after_snapshot != self.current_snapshot {
                return Err(invalid(
                    "failure",
                    "a rejected endpoint input must retain the exact before snapshot",
                ));
            }
            if self
                .last_live_resources
                .as_ref()
                .is_some_and(|previous| previous != &live_resources)
            {
                return Err(invalid(
                    "failure",
                    "a rejected endpoint input must retain live resources",
                ));
            }
        }

        let entry = KernelTraceEntryV2 {
            sequence,
            virtual_time_ms,
            input,
            effects,
            mechanical_before: self.current_snapshot.mechanical_digest.clone(),
            mechanical_after: after_snapshot.mechanical_digest.clone(),
            kernel_before: self.current_snapshot.kernel_determinism_digest.clone(),
            kernel_after: after_snapshot.kernel_determinism_digest.clone(),
            presentation_before: self.current_snapshot.presentation_plan_digest.clone(),
            presentation_after: after_snapshot.presentation_plan_digest.clone(),
            rng_audit,
            rng_audit_digest: rng_audit_digest_value,
            internal_events,
            live_resources: live_resources.clone(),
            failure,
        };
        validate_endpoint_entry_shape(&entry, self.current_snapshot.runtime_identity.local_seat)?;

        self.previous_virtual_time_ms = Some(virtual_time_ms);
        self.last_rng_sequence = entry.rng_audit.last().map(|draw| draw.sequence);
        self.last_live_resources = Some(live_resources);
        self.current_snapshot = after_snapshot;
        self.entries.push(entry);
        Ok(())
    }

    pub fn record_observation(
        &mut self,
        input: RestorableKernelInputV2,
        observation: EndpointTraceObservationV2,
    ) -> Result<(), SnapshotError> {
        self.record(
            input,
            observation.virtual_time_ms,
            observation.effects,
            observation.after_snapshot,
            observation.rng_audit,
            observation.internal_events,
            observation.live_resources,
            observation.failure,
        )
    }

    /// Capture the after-state from the owning kernel boundary, then append a
    /// fully validated entry.  The bridge is implemented by the integration
    /// owner; this keeps recorder callers on the real snapshot API.
    // The frozen recorder boundary keeps every trace field explicit for callers.
    #[allow(clippy::too_many_arguments)]
    pub fn record_with_kernel<B: GameKernelSnapshotBridge>(
        &mut self,
        input: RestorableKernelInputV2,
        virtual_time_ms: SafeU53,
        effects: Vec<RestorableKernelEffectV2>,
        kernel: &B,
        rng_audit: Vec<RngDraw>,
        internal_events: Vec<InternalEventKindV1>,
        live_resources: LiveResourceSnapshot,
        failure: Option<TraceFailureEvidenceV2>,
    ) -> Result<(), SnapshotError> {
        let after_snapshot = snapshot_game_kernel(kernel)
            .map_err(|error| invalid("after_snapshot", error.to_string()))?;
        self.record(
            input,
            virtual_time_ms,
            effects,
            after_snapshot,
            rng_audit,
            internal_events,
            live_resources,
            failure,
        )
    }

    pub fn trace(&self) -> EndpointKernelTraceV2 {
        EndpointKernelTraceV2 {
            schema_version: KERNEL_TRACE_SCHEMA_VERSION,
            replay_seed: self.replay_seed.clone(),
            initial_snapshot: self.initial_snapshot.clone(),
            entries: self.entries.clone(),
        }
    }

    pub fn finish(self) -> Result<EndpointKernelTraceV2, SnapshotError> {
        let trace = self.trace();
        trace.validate()?;
        Ok(trace)
    }
}

impl PairKernelTraceRecorder {
    pub fn new(initial_snapshot: RestorablePairSnapshotV2) -> Result<Self, SnapshotError> {
        initial_snapshot
            .validate()
            .map_err(|error| prefix_snapshot_error("initial_snapshot", error))?;
        Ok(Self {
            current_snapshot: initial_snapshot.clone(),
            initial_snapshot,
            entries: Vec::new(),
            host_last_rng_sequence: None,
            guest_last_rng_sequence: None,
        })
    }

    // The frozen recorder boundary keeps both endpoints' evidence explicit.
    #[allow(clippy::too_many_arguments)]
    pub fn record(
        &mut self,
        input: PairOperationV2,
        effects: Vec<PairTraceEffectV2>,
        after_snapshot: RestorablePairSnapshotV2,
        host_rng_audit: Vec<RngDraw>,
        host_internal_events: Vec<InternalEventKindV1>,
        host_live_resources: LiveResourceSnapshot,
        guest_rng_audit: Vec<RngDraw>,
        guest_internal_events: Vec<InternalEventKindV1>,
        guest_live_resources: LiveResourceSnapshot,
        failure: Option<TraceFailureEvidenceV2>,
    ) -> Result<(), SnapshotError> {
        let trace_sequence = one_based_sequence(self.entries.len(), "entries")?;
        validate_same_pair_snapshot(&self.current_snapshot, &after_snapshot)?;
        after_snapshot
            .validate()
            .map_err(|error| prefix_snapshot_error("after_snapshot", error))?;
        validate_pair_operation(&input)?;
        validate_pair_effects(
            &effects,
            self.initial_snapshot.host.runtime_identity.local_seat,
            self.initial_snapshot.guest.runtime_identity.local_seat,
        )?;
        validate_rng_audit(
            &host_rng_audit,
            self.host_last_rng_sequence,
            "host.rng_audit",
        )?;
        validate_rng_audit(
            &guest_rng_audit,
            self.guest_last_rng_sequence,
            "guest.rng_audit",
        )?;
        validate_live_resources(&host_live_resources)?;
        validate_live_resources(&guest_live_resources)?;
        let host_rng_audit_digest = rng_audit_digest(&host_rng_audit)?;
        let guest_rng_audit_digest = rng_audit_digest(&guest_rng_audit)?;
        if let Some(failure) = &failure {
            failure.validate(None)?;
            if matches!(failure.owner, TraceFailureOwnerV2::Endpoint) {
                return Err(invalid(
                    "failure.owner",
                    "pair failures must belong to Host, Guest, or Environment",
                ));
            }
            if !effects.is_empty() {
                return Err(invalid(
                    "failure",
                    "a rejected pair input must not publish effects",
                ));
            }
            if after_snapshot != self.current_snapshot {
                return Err(invalid(
                    "failure",
                    "a rejected pair input must retain the exact before snapshot",
                ));
            }
        }
        let expected_after_sequence = advance_pair_sequence(
            self.current_snapshot.sequence,
            failure.is_none(),
            "after_snapshot.sequence",
        )?;
        if after_snapshot.sequence != expected_after_sequence {
            return Err(invalid(
                "after_snapshot.sequence",
                "pair sequence must increment exactly once for a successful operation and remain unchanged for a rejected operation",
            ));
        }
        let expected_after_time = if failure.is_some() {
            self.current_snapshot.virtual_time_ms
        } else {
            pair_operation_after_time(
                &input,
                self.current_snapshot.virtual_time_ms,
                "after_snapshot.virtual_time_ms",
            )?
        };
        if after_snapshot.virtual_time_ms != expected_after_time {
            return Err(invalid(
                "after_snapshot.virtual_time_ms",
                "pair clock must apply the operation's deterministic time transition",
            ));
        }

        let entry = PairTraceEntryV2 {
            trace_sequence,
            pair_sequence_before: self.current_snapshot.sequence,
            virtual_time_ms: self.current_snapshot.virtual_time_ms,
            input,
            effects,
            host: PairTraceEndpointEvidenceV2 {
                mechanical_before: self.current_snapshot.host.mechanical_digest.clone(),
                mechanical_after: after_snapshot.host.mechanical_digest.clone(),
                kernel_before: self.current_snapshot.host.kernel_determinism_digest.clone(),
                kernel_after: after_snapshot.host.kernel_determinism_digest.clone(),
                presentation_before: self.current_snapshot.host.presentation_plan_digest.clone(),
                presentation_after: after_snapshot.host.presentation_plan_digest.clone(),
                rng_audit: host_rng_audit,
                rng_audit_digest: host_rng_audit_digest,
                internal_events: host_internal_events,
                live_resources: host_live_resources,
            },
            guest: PairTraceEndpointEvidenceV2 {
                mechanical_before: self.current_snapshot.guest.mechanical_digest.clone(),
                mechanical_after: after_snapshot.guest.mechanical_digest.clone(),
                kernel_before: self
                    .current_snapshot
                    .guest
                    .kernel_determinism_digest
                    .clone(),
                kernel_after: after_snapshot.guest.kernel_determinism_digest.clone(),
                presentation_before: self.current_snapshot.guest.presentation_plan_digest.clone(),
                presentation_after: after_snapshot.guest.presentation_plan_digest.clone(),
                rng_audit: guest_rng_audit,
                rng_audit_digest: guest_rng_audit_digest,
                internal_events: guest_internal_events,
                live_resources: guest_live_resources,
            },
            pair_before: PairDeterminismDigest::compute(&self.current_snapshot)?,
            pair_after: PairDeterminismDigest::compute(&after_snapshot)?,
            environment_after: PairEnvironmentResourceSnapshotV2::from_snapshot(&after_snapshot),
            failure,
        };
        validate_pair_entry_shape(
            &entry,
            self.initial_snapshot.host.runtime_identity.local_seat,
            self.initial_snapshot.guest.runtime_identity.local_seat,
            self.host_last_rng_sequence,
            self.guest_last_rng_sequence,
        )?;

        self.host_last_rng_sequence = entry.host.rng_audit.last().map(|draw| draw.sequence);
        self.guest_last_rng_sequence = entry.guest.rng_audit.last().map(|draw| draw.sequence);
        self.current_snapshot = after_snapshot;
        self.entries.push(entry);
        Ok(())
    }

    pub fn record_observation(
        &mut self,
        input: PairOperationV2,
        observation: PairTraceObservationV2,
    ) -> Result<(), SnapshotError> {
        self.record(
            input,
            observation.effects,
            observation.after_snapshot,
            observation.host_rng_audit,
            observation.host_internal_events,
            observation.host_live_resources,
            observation.guest_rng_audit,
            observation.guest_internal_events,
            observation.guest_live_resources,
            observation.failure,
        )
    }

    /// Capture the after-state from the owning pair boundary, then append a
    /// fully validated entry.  Effect origins and endpoint resource evidence
    /// remain explicit because only the pair owner can observe their order.
    // The frozen recorder boundary keeps both endpoints' evidence explicit.
    #[allow(clippy::too_many_arguments)]
    pub fn record_with_pair<B: SimulatedPairSnapshotBridge>(
        &mut self,
        input: PairOperationV2,
        effects: Vec<PairTraceEffectV2>,
        pair: &B,
        host_rng_audit: Vec<RngDraw>,
        host_internal_events: Vec<InternalEventKindV1>,
        host_live_resources: LiveResourceSnapshot,
        guest_rng_audit: Vec<RngDraw>,
        guest_internal_events: Vec<InternalEventKindV1>,
        guest_live_resources: LiveResourceSnapshot,
        failure: Option<TraceFailureEvidenceV2>,
    ) -> Result<(), SnapshotError> {
        let after_snapshot = snapshot_simulated_pair(pair)?;
        self.record(
            input,
            effects,
            after_snapshot,
            host_rng_audit,
            host_internal_events,
            host_live_resources,
            guest_rng_audit,
            guest_internal_events,
            guest_live_resources,
            failure,
        )
    }

    pub fn trace(&self) -> PairKernelTraceV2 {
        PairKernelTraceV2 {
            schema_version: KERNEL_TRACE_SCHEMA_VERSION,
            initial_snapshot: self.initial_snapshot.clone(),
            entries: self.entries.clone(),
        }
    }

    pub fn finish(self) -> Result<PairKernelTraceV2, SnapshotError> {
        let trace = self.trace();
        trace.validate()?;
        Ok(trace)
    }
}

pub fn numbered_pair_effects(
    effects: impl IntoIterator<Item = (PairEndpoint, RestorableKernelEffectV2)>,
) -> Result<Vec<PairTraceEffectV2>, SnapshotError> {
    effects
        .into_iter()
        .enumerate()
        .map(|(index, (origin, effect))| {
            Ok(PairTraceEffectV2 {
                sequence: safe_u53_from_usize(index, "effects.sequence")?,
                origin,
                effect,
            })
        })
        .collect()
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
        Self::compute_components(
            snapshot.schema_version,
            snapshot.sequence,
            &snapshot.replay_seed,
            snapshot.virtual_time_ms,
            &snapshot.host.kernel_determinism_digest,
            &snapshot.guest.kernel_determinism_digest,
            &PairEnvironmentResourceSnapshotV2::from_snapshot(snapshot),
        )
    }

    pub fn compute_components(
        schema_version: u32,
        sequence: SafeU53,
        replay_seed: &str,
        virtual_time_ms: SafeU53,
        host: &KernelDeterminismDigest,
        guest: &KernelDeterminismDigest,
        environment: &PairEnvironmentResourceSnapshotV2,
    ) -> Result<Self, SnapshotError> {
        let raw = content_digest(&PairDigestPreimage {
            domain: PAIR_DETERMINISM_DIGEST_DOMAIN,
            schema_version,
            sequence,
            replay_seed,
            virtual_time_ms,
            host,
            guest,
            host_driver: &environment.host_driver,
            guest_driver: &environment.guest_driver,
            clock: &environment.clock,
            network: &environment.network,
            presenter: &environment.presenter,
            storage: &environment.storage,
            fault_script: &environment.fault_script,
            fault_rng_state: &environment.fault_rng_state,
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
    schema_version: u32,
    sequence: SafeU53,
    replay_seed: &'a str,
    virtual_time_ms: SafeU53,
    host: &'a KernelDeterminismDigest,
    guest: &'a KernelDeterminismDigest,
    host_driver: &'a DetachedKeyboardDriverSnapshotV2,
    guest_driver: &'a DetachedKeyboardDriverSnapshotV2,
    clock: &'a VirtualClockSnapshotV2,
    network: &'a FaultNetworkSnapshotV2,
    presenter: &'a PresenterSnapshotV2,
    storage: &'a StorageSnapshotV2,
    fault_script: &'a FaultScriptSnapshotV2,
    fault_rng_state: &'a FaultRngStateV2,
}

impl EndpointKernelTraceV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != KERNEL_TRACE_SCHEMA_VERSION {
            return Err(invalid(
                "schema_version",
                format!(
                    "expected {KERNEL_TRACE_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        validate_seed(&self.replay_seed, "replay_seed")?;
        self.initial_snapshot
            .validate()
            .map_err(|error| prefix_kernel_snapshot_error("initial_snapshot", error))?;

        let local_seat = self.initial_snapshot.runtime_identity.local_seat;
        let mut previous_virtual_time_ms = None;
        let mut previous_rng_sequence = None;
        let mut previous_live_resources = None;
        let mut previous_mechanical = self.initial_snapshot.mechanical_digest.clone();
        let mut previous_kernel = self.initial_snapshot.kernel_determinism_digest.clone();
        let mut previous_presentation = self.initial_snapshot.presentation_plan_digest.clone();

        for (index, entry) in self.entries.iter().enumerate() {
            let expected_sequence = one_based_sequence(index, "entries.sequence")?;
            if entry.sequence != expected_sequence {
                return Err(invalid(
                    format!("entries[{index}].sequence"),
                    format!(
                        "expected contiguous one-based sequence {expected_sequence}, got {}",
                        entry.sequence
                    ),
                ));
            }
            if previous_virtual_time_ms.is_some_and(|previous| entry.virtual_time_ms < previous) {
                return Err(invalid(
                    format!("entries[{index}].virtual_time_ms"),
                    "virtual time must not regress",
                ));
            }
            if entry.mechanical_before != previous_mechanical {
                return Err(invalid(
                    format!("entries[{index}].mechanical_before"),
                    "mechanical digest chain does not begin at the initial snapshot or prior after digest",
                ));
            }
            if entry.kernel_before != previous_kernel {
                return Err(invalid(
                    format!("entries[{index}].kernel_before"),
                    "kernel digest chain does not begin at the initial snapshot or prior after digest",
                ));
            }
            if entry.presentation_before != previous_presentation {
                return Err(invalid(
                    format!("entries[{index}].presentation_before"),
                    "presentation digest chain does not begin at the initial snapshot or prior after digest",
                ));
            }

            validate_endpoint_entry_shape(entry, local_seat)?;
            validate_rng_audit(
                &entry.rng_audit,
                previous_rng_sequence,
                &format!("entries[{index}].rng_audit"),
            )?;
            if let Some(failure) = &entry.failure {
                failure.validate(Some(TraceFailureOwnerV2::Endpoint))?;
                if !entry.effects.is_empty() {
                    return Err(invalid(
                        format!("entries[{index}].failure"),
                        "a rejected endpoint input must not publish effects",
                    ));
                }
                if entry.mechanical_after != entry.mechanical_before
                    || entry.kernel_after != entry.kernel_before
                    || entry.presentation_after != entry.presentation_before
                {
                    return Err(invalid(
                        format!("entries[{index}].failure"),
                        "a rejected endpoint input must retain every digest",
                    ));
                }
                if previous_live_resources
                    .as_ref()
                    .is_some_and(|previous| previous != &entry.live_resources)
                {
                    return Err(invalid(
                        format!("entries[{index}].failure"),
                        "a rejected endpoint input must retain live resources",
                    ));
                }
            }

            previous_virtual_time_ms = Some(entry.virtual_time_ms);
            previous_rng_sequence = entry.rng_audit.last().map(|draw| draw.sequence);
            previous_live_resources = Some(entry.live_resources.clone());
            previous_mechanical = entry.mechanical_after.clone();
            previous_kernel = entry.kernel_after.clone();
            previous_presentation = entry.presentation_after.clone();
        }
        Ok(())
    }

    pub fn first_divergence(&self, actual: &Self) -> Option<TraceDivergenceV2> {
        if self.schema_version != actual.schema_version {
            return Some(divergence(
                SafeU53::ZERO,
                SafeU53::ZERO,
                TraceFailureOwnerV2::Endpoint,
                "SCHEMA_MISMATCH",
                "schema_version",
                &self.schema_version,
                &actual.schema_version,
            ));
        }
        if self.replay_seed != actual.replay_seed {
            return Some(divergence(
                SafeU53::ZERO,
                SafeU53::ZERO,
                TraceFailureOwnerV2::Endpoint,
                "SEED_MISMATCH",
                "replay_seed",
                &self.replay_seed,
                &actual.replay_seed,
            ));
        }
        if self.initial_snapshot != actual.initial_snapshot {
            return Some(divergence(
                SafeU53::ZERO,
                SafeU53::ZERO,
                TraceFailureOwnerV2::Endpoint,
                "INITIAL_SNAPSHOT_MISMATCH",
                "initial_snapshot",
                &self.initial_snapshot,
                &actual.initial_snapshot,
            ));
        }
        for (expected, observed) in self.entries.iter().zip(&actual.entries) {
            if let Some(divergence) = first_endpoint_entry_divergence(expected, observed) {
                return Some(divergence);
            }
        }
        if self.entries.len() != actual.entries.len() {
            let index = self.entries.len().min(actual.entries.len());
            let sequence = one_based_sequence(index, "entries.sequence").unwrap_or(SafeU53::MAX);
            let virtual_time_ms = self
                .entries
                .get(index)
                .or_else(|| actual.entries.get(index))
                .map(|entry| entry.virtual_time_ms)
                .unwrap_or(SafeU53::ZERO);
            return Some(TraceDivergenceV2 {
                sequence,
                virtual_time_ms,
                owner: TraceFailureOwnerV2::Endpoint,
                code: "ENTRY_COUNT_MISMATCH".to_owned(),
                path: "entries".to_owned(),
                expected: Some(self.entries.len().to_string()),
                actual: Some(actual.entries.len().to_string()),
            });
        }
        None
    }
}

impl PairKernelTraceV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.schema_version != KERNEL_TRACE_SCHEMA_VERSION {
            return Err(invalid(
                "schema_version",
                format!(
                    "expected {KERNEL_TRACE_SCHEMA_VERSION}, got {}",
                    self.schema_version
                ),
            ));
        }
        self.initial_snapshot.validate()?;
        let host_seat = self.initial_snapshot.host.runtime_identity.local_seat;
        let guest_seat = self.initial_snapshot.guest.runtime_identity.local_seat;
        let mut previous_pair_sequence = self.initial_snapshot.sequence;
        let mut previous_virtual_time_ms = self.initial_snapshot.virtual_time_ms;
        let mut previous_pair_digest = PairDeterminismDigest::compute(&self.initial_snapshot)?;
        let mut previous_environment =
            PairEnvironmentResourceSnapshotV2::from_snapshot(&self.initial_snapshot);
        let mut previous_host_mechanical = self.initial_snapshot.host.mechanical_digest.clone();
        let mut previous_guest_mechanical = self.initial_snapshot.guest.mechanical_digest.clone();
        let mut previous_host_kernel = self.initial_snapshot.host.kernel_determinism_digest.clone();
        let mut previous_guest_kernel = self
            .initial_snapshot
            .guest
            .kernel_determinism_digest
            .clone();
        let mut previous_host_presentation =
            self.initial_snapshot.host.presentation_plan_digest.clone();
        let mut previous_guest_presentation =
            self.initial_snapshot.guest.presentation_plan_digest.clone();
        let mut previous_host_live_resources = None;
        let mut previous_guest_live_resources = None;
        let mut host_last_rng_sequence = None;
        let mut guest_last_rng_sequence = None;

        for (index, entry) in self.entries.iter().enumerate() {
            let expected_trace_sequence = one_based_sequence(index, "entries.trace_sequence")?;
            if entry.trace_sequence != expected_trace_sequence {
                return Err(invalid(
                    format!("entries[{index}].trace_sequence"),
                    format!(
                        "expected contiguous one-based sequence {expected_trace_sequence}, got {}",
                        entry.trace_sequence
                    ),
                ));
            }
            if entry.pair_sequence_before != previous_pair_sequence {
                return Err(invalid(
                    format!("entries[{index}].pair_sequence_before"),
                    "pair sequence does not match the initial or prior operation outcome",
                ));
            }
            if entry.virtual_time_ms != previous_virtual_time_ms {
                return Err(invalid(
                    format!("entries[{index}].virtual_time_ms"),
                    "pair entry time must equal the pre-operation pair clock",
                ));
            }
            if entry.pair_before != previous_pair_digest {
                return Err(invalid(
                    format!("entries[{index}].pair_before"),
                    "pair-before digest does not match the prior complete pair state",
                ));
            }
            if entry.host.mechanical_before != previous_host_mechanical
                || entry.host.kernel_before != previous_host_kernel
                || entry.host.presentation_before != previous_host_presentation
            {
                return Err(invalid(
                    format!("entries[{index}].host"),
                    "host before digest chain is not contiguous",
                ));
            }
            if entry.guest.mechanical_before != previous_guest_mechanical
                || entry.guest.kernel_before != previous_guest_kernel
                || entry.guest.presentation_before != previous_guest_presentation
            {
                return Err(invalid(
                    format!("entries[{index}].guest"),
                    "guest before digest chain is not contiguous",
                ));
            }

            validate_pair_entry_shape(
                entry,
                host_seat,
                guest_seat,
                host_last_rng_sequence,
                guest_last_rng_sequence,
            )?;
            validate_rng_audit(
                &entry.host.rng_audit,
                host_last_rng_sequence,
                &format!("entries[{index}].host.rng_audit"),
            )?;
            validate_rng_audit(
                &entry.guest.rng_audit,
                guest_last_rng_sequence,
                &format!("entries[{index}].guest.rng_audit"),
            )?;

            let expected_after_sequence = advance_pair_sequence(
                entry.pair_sequence_before,
                entry.failure.is_none(),
                &format!("entries[{index}].pair_sequence_before"),
            )?;
            let expected_after_time = if entry.failure.is_some() {
                entry.virtual_time_ms
            } else {
                pair_operation_after_time(
                    &entry.input,
                    entry.virtual_time_ms,
                    &format!("entries[{index}].virtual_time_ms"),
                )?
            };
            if entry.environment_after.clock.now_ms != expected_after_time {
                return Err(invalid(
                    format!("entries[{index}].environment_after.clock.now_ms"),
                    "environment clock does not match the operation's deterministic time transition",
                ));
            }
            let expected_pair_after = PairDeterminismDigest::compute_components(
                self.initial_snapshot.schema_version,
                expected_after_sequence,
                &self.initial_snapshot.replay_seed,
                expected_after_time,
                &entry.host.kernel_after,
                &entry.guest.kernel_after,
                &entry.environment_after,
            )?;
            if entry.pair_after != expected_pair_after {
                return Err(invalid(
                    format!("entries[{index}].pair_after"),
                    "pair-after digest does not match endpoint digests and complete environment state",
                ));
            }
            if let Some(failure) = &entry.failure {
                failure.validate(None)?;
                if matches!(failure.owner, TraceFailureOwnerV2::Endpoint) {
                    return Err(invalid(
                        format!("entries[{index}].failure.owner"),
                        "pair failures must belong to Host, Guest, or Environment",
                    ));
                }
                if entry.host.mechanical_after != entry.host.mechanical_before
                    || entry.guest.mechanical_after != entry.guest.mechanical_before
                    || entry.host.kernel_after != entry.host.kernel_before
                    || entry.guest.kernel_after != entry.guest.kernel_before
                    || entry.host.presentation_after != entry.host.presentation_before
                    || entry.guest.presentation_after != entry.guest.presentation_before
                    || entry.environment_after != previous_environment
                {
                    return Err(invalid(
                        format!("entries[{index}].failure"),
                        "a rejected pair input must retain both endpoints and all environment resources",
                    ));
                }
                if previous_host_live_resources
                    .as_ref()
                    .is_some_and(|previous| previous != &entry.host.live_resources)
                    || previous_guest_live_resources
                        .as_ref()
                        .is_some_and(|previous| previous != &entry.guest.live_resources)
                {
                    return Err(invalid(
                        format!("entries[{index}].failure"),
                        "a rejected pair input must retain live resources",
                    ));
                }
            }

            previous_pair_sequence = expected_after_sequence;
            previous_virtual_time_ms = expected_after_time;
            previous_pair_digest = entry.pair_after.clone();
            previous_environment = entry.environment_after.clone();
            previous_host_mechanical = entry.host.mechanical_after.clone();
            previous_guest_mechanical = entry.guest.mechanical_after.clone();
            previous_host_kernel = entry.host.kernel_after.clone();
            previous_guest_kernel = entry.guest.kernel_after.clone();
            previous_host_presentation = entry.host.presentation_after.clone();
            previous_guest_presentation = entry.guest.presentation_after.clone();
            previous_host_live_resources = Some(entry.host.live_resources.clone());
            previous_guest_live_resources = Some(entry.guest.live_resources.clone());
            host_last_rng_sequence = entry.host.rng_audit.last().map(|draw| draw.sequence);
            guest_last_rng_sequence = entry.guest.rng_audit.last().map(|draw| draw.sequence);
        }
        Ok(())
    }

    pub fn first_divergence(&self, actual: &Self) -> Option<TraceDivergenceV2> {
        if self.schema_version != actual.schema_version {
            return Some(divergence(
                SafeU53::ZERO,
                self.initial_snapshot.virtual_time_ms,
                TraceFailureOwnerV2::Environment,
                "SCHEMA_MISMATCH",
                "schema_version",
                &self.schema_version,
                &actual.schema_version,
            ));
        }
        if self.initial_snapshot != actual.initial_snapshot {
            return Some(divergence(
                SafeU53::ZERO,
                self.initial_snapshot.virtual_time_ms,
                TraceFailureOwnerV2::Environment,
                "INITIAL_SNAPSHOT_MISMATCH",
                "initial_snapshot",
                &self.initial_snapshot,
                &actual.initial_snapshot,
            ));
        }
        for (expected, observed) in self.entries.iter().zip(&actual.entries) {
            if let Some(divergence) = first_pair_entry_divergence(expected, observed) {
                return Some(divergence);
            }
        }
        if self.entries.len() != actual.entries.len() {
            let index = self.entries.len().min(actual.entries.len());
            let sequence =
                one_based_sequence(index, "entries.trace_sequence").unwrap_or(SafeU53::MAX);
            let virtual_time_ms = self
                .entries
                .get(index)
                .or_else(|| actual.entries.get(index))
                .map(|entry| entry.virtual_time_ms)
                .unwrap_or(self.initial_snapshot.virtual_time_ms);
            return Some(TraceDivergenceV2 {
                sequence,
                virtual_time_ms,
                owner: TraceFailureOwnerV2::Environment,
                code: "ENTRY_COUNT_MISMATCH".to_owned(),
                path: "entries".to_owned(),
                expected: Some(self.entries.len().to_string()),
                actual: Some(actual.entries.len().to_string()),
            });
        }
        None
    }

    pub fn replay_with<D>(&self, mut driver: D) -> Result<TraceReplayReportV2, SnapshotError>
    where
        D: PairTraceReplayDriver,
    {
        self.validate()?;
        let mut pair_state = driver.restore(self.initial_snapshot.clone())?;
        let mut recorder = PairKernelTraceRecorder::new(self.initial_snapshot.clone())?;
        for (index, expected) in self.entries.iter().enumerate() {
            let observation =
                driver.step(&mut pair_state, &expected.input, expected.virtual_time_ms)?;
            if let Err(error) = recorder.record_observation(expected.input.clone(), observation) {
                return Ok(TraceReplayReportV2 {
                    replayed_entries: one_based_sequence(index, "replayed_entries")?,
                    first_divergence: Some(replay_error_divergence(
                        expected.trace_sequence,
                        expected.virtual_time_ms,
                        TraceFailureOwnerV2::Environment,
                        error,
                    )),
                });
            }
            let actual = recorder
                .trace()
                .entries
                .last()
                .cloned()
                .ok_or_else(|| invalid("replay", "recorder produced no entry"))?;
            if let Some(divergence) = first_pair_entry_divergence(expected, &actual) {
                return Ok(TraceReplayReportV2 {
                    replayed_entries: one_based_sequence(index, "replayed_entries")?,
                    first_divergence: Some(divergence),
                });
            }
        }
        Ok(TraceReplayReportV2 {
            replayed_entries: safe_u53_from_usize(self.entries.len(), "replayed_entries")?,
            first_divergence: None,
        })
    }

    pub fn replay_simulated_pair(
        &self,
        content: Arc<ContentPack>,
    ) -> Result<TraceReplayReportV2, SnapshotError> {
        self.replay_with(SimulatedPairTraceReplayDriver { content })
    }
}

impl KernelTraceV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        match self {
            Self::Endpoint(trace) => trace.validate(),
            Self::Pair(trace) => trace.validate(),
        }
    }

    pub fn first_divergence(&self, actual: &Self) -> Option<TraceDivergenceV2> {
        match (self, actual) {
            (Self::Endpoint(expected), Self::Endpoint(observed)) => {
                expected.first_divergence(observed)
            }
            (Self::Pair(expected), Self::Pair(observed)) => expected.first_divergence(observed),
            (Self::Endpoint(_), Self::Pair(_)) => Some(TraceDivergenceV2 {
                sequence: SafeU53::ZERO,
                virtual_time_ms: SafeU53::ZERO,
                owner: TraceFailureOwnerV2::Environment,
                code: "TRACE_KIND_MISMATCH".to_owned(),
                path: "kind".to_owned(),
                expected: Some("ENDPOINT".to_owned()),
                actual: Some("PAIR".to_owned()),
            }),
            (Self::Pair(_), Self::Endpoint(_)) => Some(TraceDivergenceV2 {
                sequence: SafeU53::ZERO,
                virtual_time_ms: SafeU53::ZERO,
                owner: TraceFailureOwnerV2::Environment,
                code: "TRACE_KIND_MISMATCH".to_owned(),
                path: "kind".to_owned(),
                expected: Some("PAIR".to_owned()),
                actual: Some("ENDPOINT".to_owned()),
            }),
        }
    }
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

fn divergence<T: Serialize, U: Serialize>(
    sequence: SafeU53,
    virtual_time_ms: SafeU53,
    owner: TraceFailureOwnerV2,
    code: &str,
    path: &str,
    expected: &T,
    actual: &U,
) -> TraceDivergenceV2 {
    TraceDivergenceV2 {
        sequence,
        virtual_time_ms,
        owner,
        code: code.to_owned(),
        path: path.to_owned(),
        expected: serde_json::to_string(expected).ok(),
        actual: serde_json::to_string(actual).ok(),
    }
}

fn replay_error_divergence(
    sequence: SafeU53,
    virtual_time_ms: SafeU53,
    owner: TraceFailureOwnerV2,
    error: SnapshotError,
) -> TraceDivergenceV2 {
    let (path, reason) = match error {
        SnapshotError::Invalid { path, reason } | SnapshotError::Canonical { path, reason } => {
            (path, reason)
        }
    };
    TraceDivergenceV2 {
        sequence,
        virtual_time_ms,
        owner,
        code: "REPLAY_OBSERVATION_INVALID".to_owned(),
        path,
        expected: None,
        actual: Some(reason),
    }
}

fn compare_field<T: PartialEq + Serialize>(
    sequence: SafeU53,
    virtual_time_ms: SafeU53,
    owner: TraceFailureOwnerV2,
    path: &str,
    expected: &T,
    actual: &T,
) -> Option<TraceDivergenceV2> {
    if expected == actual {
        None
    } else {
        Some(divergence(
            sequence,
            virtual_time_ms,
            owner,
            "TRACE_DIVERGENCE",
            path,
            expected,
            actual,
        ))
    }
}

fn first_endpoint_entry_divergence(
    expected: &KernelTraceEntryV2,
    actual: &KernelTraceEntryV2,
) -> Option<TraceDivergenceV2> {
    let sequence = expected.sequence;
    let virtual_time_ms = expected.virtual_time_ms;
    macro_rules! check {
        ($path:literal, $expected:expr, $actual:expr) => {
            if let Some(divergence) = compare_field(
                sequence,
                virtual_time_ms,
                TraceFailureOwnerV2::Endpoint,
                $path,
                $expected,
                $actual,
            ) {
                return Some(divergence);
            }
        };
    }

    check!("sequence", &expected.sequence, &actual.sequence);
    check!(
        "virtual_time_ms",
        &expected.virtual_time_ms,
        &actual.virtual_time_ms
    );
    check!("input", &expected.input, &actual.input);
    check!("effects", &expected.effects, &actual.effects);
    check!(
        "mechanical_before",
        &expected.mechanical_before,
        &actual.mechanical_before
    );
    check!(
        "mechanical_after",
        &expected.mechanical_after,
        &actual.mechanical_after
    );
    check!(
        "kernel_before",
        &expected.kernel_before,
        &actual.kernel_before
    );
    check!("kernel_after", &expected.kernel_after, &actual.kernel_after);
    check!(
        "presentation_before",
        &expected.presentation_before,
        &actual.presentation_before
    );
    check!(
        "presentation_after",
        &expected.presentation_after,
        &actual.presentation_after
    );
    check!("rng_audit", &expected.rng_audit, &actual.rng_audit);
    check!(
        "rng_audit_digest",
        &expected.rng_audit_digest,
        &actual.rng_audit_digest
    );
    check!(
        "internal_events",
        &expected.internal_events,
        &actual.internal_events
    );
    check!(
        "live_resources",
        &expected.live_resources,
        &actual.live_resources
    );
    check!("failure", &expected.failure, &actual.failure);
    None
}

fn first_pair_entry_divergence(
    expected: &PairTraceEntryV2,
    actual: &PairTraceEntryV2,
) -> Option<TraceDivergenceV2> {
    let sequence = expected.trace_sequence;
    let virtual_time_ms = expected.virtual_time_ms;
    macro_rules! check {
        ($owner:expr, $path:literal, $expected:expr, $actual:expr) => {
            if let Some(divergence) =
                compare_field(sequence, virtual_time_ms, $owner, $path, $expected, $actual)
            {
                return Some(divergence);
            }
        };
    }

    check!(
        TraceFailureOwnerV2::Environment,
        "trace_sequence",
        &expected.trace_sequence,
        &actual.trace_sequence
    );
    check!(
        TraceFailureOwnerV2::Environment,
        "pair_sequence_before",
        &expected.pair_sequence_before,
        &actual.pair_sequence_before
    );
    check!(
        TraceFailureOwnerV2::Environment,
        "virtual_time_ms",
        &expected.virtual_time_ms,
        &actual.virtual_time_ms
    );
    check!(
        pair_operation_owner(&expected.input),
        "input",
        &expected.input,
        &actual.input
    );
    check!(
        pair_effects_owner(expected, actual),
        "effects",
        &expected.effects,
        &actual.effects
    );

    check!(
        TraceFailureOwnerV2::Host,
        "host.mechanical_before",
        &expected.host.mechanical_before,
        &actual.host.mechanical_before
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.mechanical_after",
        &expected.host.mechanical_after,
        &actual.host.mechanical_after
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.kernel_before",
        &expected.host.kernel_before,
        &actual.host.kernel_before
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.kernel_after",
        &expected.host.kernel_after,
        &actual.host.kernel_after
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.presentation_before",
        &expected.host.presentation_before,
        &actual.host.presentation_before
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.presentation_after",
        &expected.host.presentation_after,
        &actual.host.presentation_after
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.rng_audit",
        &expected.host.rng_audit,
        &actual.host.rng_audit
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.rng_audit_digest",
        &expected.host.rng_audit_digest,
        &actual.host.rng_audit_digest
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.internal_events",
        &expected.host.internal_events,
        &actual.host.internal_events
    );
    check!(
        TraceFailureOwnerV2::Host,
        "host.live_resources",
        &expected.host.live_resources,
        &actual.host.live_resources
    );

    check!(
        TraceFailureOwnerV2::Guest,
        "guest.mechanical_before",
        &expected.guest.mechanical_before,
        &actual.guest.mechanical_before
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.mechanical_after",
        &expected.guest.mechanical_after,
        &actual.guest.mechanical_after
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.kernel_before",
        &expected.guest.kernel_before,
        &actual.guest.kernel_before
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.kernel_after",
        &expected.guest.kernel_after,
        &actual.guest.kernel_after
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.presentation_before",
        &expected.guest.presentation_before,
        &actual.guest.presentation_before
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.presentation_after",
        &expected.guest.presentation_after,
        &actual.guest.presentation_after
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.rng_audit",
        &expected.guest.rng_audit,
        &actual.guest.rng_audit
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.rng_audit_digest",
        &expected.guest.rng_audit_digest,
        &actual.guest.rng_audit_digest
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.internal_events",
        &expected.guest.internal_events,
        &actual.guest.internal_events
    );
    check!(
        TraceFailureOwnerV2::Guest,
        "guest.live_resources",
        &expected.guest.live_resources,
        &actual.guest.live_resources
    );

    check!(
        TraceFailureOwnerV2::Environment,
        "pair_before",
        &expected.pair_before,
        &actual.pair_before
    );
    check!(
        TraceFailureOwnerV2::Environment,
        "pair_after",
        &expected.pair_after,
        &actual.pair_after
    );
    check!(
        TraceFailureOwnerV2::Environment,
        "environment_after",
        &expected.environment_after,
        &actual.environment_after
    );
    let failure_owner = expected
        .failure
        .as_ref()
        .map_or(TraceFailureOwnerV2::Environment, |failure| failure.owner);
    check!(failure_owner, "failure", &expected.failure, &actual.failure);
    None
}

fn pair_operation_owner(operation: &PairOperationV2) -> TraceFailureOwnerV2 {
    let endpoint = match operation {
        PairOperationV2::RawInput { endpoint, .. }
        | PairOperationV2::Disconnect { endpoint }
        | PairOperationV2::Reconnect { endpoint }
        | PairOperationV2::BattlePresentationOutcome { endpoint, .. }
        | PairOperationV2::StorageResult { endpoint, .. }
        | PairOperationV2::Suspend { endpoint }
        | PairOperationV2::Resume { endpoint } => Some(*endpoint),
        PairOperationV2::AdvanceTime { .. } | PairOperationV2::Fault { .. } => None,
    };
    endpoint.map_or(TraceFailureOwnerV2::Environment, pair_endpoint_owner)
}

fn pair_effects_owner(
    expected: &PairTraceEntryV2,
    actual: &PairTraceEntryV2,
) -> TraceFailureOwnerV2 {
    for (expected_effect, actual_effect) in expected.effects.iter().zip(&actual.effects) {
        if expected_effect != actual_effect {
            return pair_endpoint_owner(expected_effect.origin);
        }
    }
    expected
        .effects
        .get(actual.effects.len())
        .or_else(|| actual.effects.get(expected.effects.len()))
        .map_or(TraceFailureOwnerV2::Environment, |effect| {
            pair_endpoint_owner(effect.origin)
        })
}

fn pair_endpoint_owner(endpoint: PairEndpoint) -> TraceFailureOwnerV2 {
    match endpoint {
        PairEndpoint::Host => TraceFailureOwnerV2::Host,
        PairEndpoint::Guest => TraceFailureOwnerV2::Guest,
    }
}

fn prefix_snapshot_error(prefix: &str, error: SnapshotError) -> SnapshotError {
    match error {
        SnapshotError::Invalid { path, reason } => invalid(format!("{prefix}.{path}"), reason),
        SnapshotError::Canonical { path, reason } => SnapshotError::Canonical {
            path: format!("{prefix}.{path}"),
            reason,
        },
    }
}

fn prefix_kernel_snapshot_error(
    prefix: &str,
    error: er_kernel::snapshot::SnapshotError,
) -> SnapshotError {
    match error {
        er_kernel::snapshot::SnapshotError::Invalid { path, reason } => {
            invalid(format!("{prefix}.{path}"), reason)
        }
        er_kernel::snapshot::SnapshotError::Canonical { path, reason } => {
            SnapshotError::Canonical {
                path: format!("{prefix}.{path}"),
                reason,
            }
        }
    }
}

fn safe_u53_from_usize(value: usize, path: &str) -> Result<SafeU53, SnapshotError> {
    let value = u64::try_from(value).map_err(|_| invalid(path, "index exceeds u64"))?;
    SafeU53::new(value).map_err(|_| invalid(path, "index exceeds SafeU53"))
}

fn one_based_sequence(index: usize, path: &str) -> Result<SafeU53, SnapshotError> {
    let value = safe_u53_from_usize(index, path)?.get();
    let value = value
        .checked_add(1)
        .ok_or_else(|| invalid(path, "one-based sequence is exhausted"))?;
    SafeU53::new(value).map_err(|_| invalid(path, "one-based sequence exceeds SafeU53"))
}

fn next_sequence(sequence: SafeU53, path: &str) -> Result<SafeU53, SnapshotError> {
    let value = sequence
        .get()
        .checked_add(1)
        .ok_or_else(|| invalid(path, "sequence is exhausted"))?;
    SafeU53::new(value).map_err(|_| invalid(path, "sequence exceeds SafeU53"))
}

fn validate_same_endpoint_snapshot(
    before: &RestorableKernelSnapshotV2,
    after: &RestorableKernelSnapshotV2,
) -> Result<(), SnapshotError> {
    if before.schema_version != after.schema_version {
        return Err(invalid(
            "after_snapshot.schema_version",
            "schema version changed during one endpoint operation",
        ));
    }
    if before.content_hash != after.content_hash {
        return Err(invalid(
            "after_snapshot.content_hash",
            "content identity changed during one endpoint operation",
        ));
    }
    if before.runtime_identity != after.runtime_identity {
        return Err(invalid(
            "after_snapshot.runtime_identity",
            "runtime identity changed during one endpoint operation",
        ));
    }
    Ok(())
}

fn validate_same_pair_snapshot(
    before: &RestorablePairSnapshotV2,
    after: &RestorablePairSnapshotV2,
) -> Result<(), SnapshotError> {
    if before.schema_version != after.schema_version {
        return Err(invalid(
            "after_snapshot.schema_version",
            "schema version changed during one pair operation",
        ));
    }
    if before.replay_seed != after.replay_seed {
        return Err(invalid(
            "after_snapshot.replay_seed",
            "replay seed changed during one pair operation",
        ));
    }
    if before.host.runtime_identity != after.host.runtime_identity
        || before.guest.runtime_identity != after.guest.runtime_identity
    {
        return Err(invalid(
            "after_snapshot.runtime_identity",
            "endpoint runtime identity changed during one pair operation",
        ));
    }
    Ok(())
}

fn validate_endpoint_input(
    input: &RestorableKernelInputV2,
    local_seat: SeatId,
) -> Result<(), SnapshotError> {
    match input {
        RestorableKernelInputV2::NetworkFrame { endpoint, bytes }
        | RestorableKernelInputV2::ProposalEnvelope { endpoint, bytes } => {
            if *endpoint != local_seat {
                return Err(invalid(
                    "input.endpoint",
                    "endpoint trace input belongs to a different seat",
                ));
            }
            validate_bytes(bytes, "input.bytes")?;
        }
        RestorableKernelInputV2::RejectedCompatibility { bytes, .. } => {
            validate_bytes(bytes, "input.bytes")?;
        }
        RestorableKernelInputV2::StorageResult {
            endpoint, result, ..
        } => {
            if *endpoint != local_seat {
                return Err(invalid(
                    "input.endpoint",
                    "endpoint trace input belongs to a different seat",
                ));
            }
            validate_storage_result(result, "input.result")?;
        }
        RestorableKernelInputV2::RawInput { seat, .. } => {
            if *seat != local_seat {
                return Err(invalid(
                    "input.seat",
                    "endpoint trace input belongs to a different seat",
                ));
            }
        }
        RestorableKernelInputV2::TimerFired { endpoint, .. }
        | RestorableKernelInputV2::BattlePresentationOutcome { endpoint, .. }
        | RestorableKernelInputV2::TransportChanged { endpoint, .. }
        | RestorableKernelInputV2::Suspend { endpoint }
        | RestorableKernelInputV2::Resume { endpoint } => {
            if *endpoint != local_seat {
                return Err(invalid(
                    "input.endpoint",
                    "endpoint trace input belongs to a different seat",
                ));
            }
        }
    }
    Ok(())
}

fn validate_storage_result(
    result: &RestorableStorageResultV2,
    path: &str,
) -> Result<(), SnapshotError> {
    if let RestorableStorageResultV2::Loaded { value: Some(value) } = result {
        validate_bytes(value, path)?;
    }
    if let RestorableStorageResultV2::Failed { reason } = result
        && reason.is_empty()
    {
        return Err(invalid(path, "failure reason must not be empty"));
    }
    Ok(())
}

fn validate_endpoint_effects(
    effects: &[RestorableKernelEffectV2],
    local_seat: SeatId,
) -> Result<(), SnapshotError> {
    for (index, effect) in effects.iter().enumerate() {
        let path = format!("effects[{index}]");
        match effect {
            RestorableKernelEffectV2::SendFrame { from, bytes }
            | RestorableKernelEffectV2::SendProposal { from, bytes } => {
                if *from != local_seat {
                    return Err(invalid(
                        format!("{path}.from"),
                        "endpoint trace may only emit from its local seat",
                    ));
                }
                validate_bytes(bytes, &format!("{path}.bytes"))?;
            }
            RestorableKernelEffectV2::ScheduleTimer { timer } => {
                if timer.registration.endpoint != local_seat {
                    return Err(invalid(
                        format!("{path}.timer.registration.endpoint"),
                        "endpoint trace may only schedule a local timer",
                    ));
                }
                validate_restorable_timer(timer, &path)?;
            }
            RestorableKernelEffectV2::CancelTimer { endpoint, .. }
            | RestorableKernelEffectV2::BattleUiChanged { endpoint, .. }
            | RestorableKernelEffectV2::PresentBattle { endpoint, .. }
            | RestorableKernelEffectV2::Load { endpoint, .. }
            | RestorableKernelEffectV2::Persist { endpoint, .. } => {
                if *endpoint != local_seat {
                    return Err(invalid(
                        format!("{path}.endpoint"),
                        "endpoint trace effect belongs to a different seat",
                    ));
                }
                match effect {
                    RestorableKernelEffectV2::BattleUiChanged { projection, .. } => {
                        projection.validate().map_err(|error| {
                            invalid(format!("{path}.projection"), error.to_string())
                        })?
                    }
                    RestorableKernelEffectV2::Load { request, .. }
                    | RestorableKernelEffectV2::Persist { request, .. } => {
                        request.validate(&format!("{path}.request"))?;
                        match (effect, request) {
                            (
                                RestorableKernelEffectV2::Load { .. },
                                RestorableStorageRequestV2::Load { .. },
                            )
                            | (
                                RestorableKernelEffectV2::Persist { .. },
                                RestorableStorageRequestV2::Persist { .. },
                            ) => {}
                            _ => {
                                return Err(invalid(
                                    format!("{path}.request"),
                                    "Load and Persist effects must retain their matching request variant",
                                ));
                            }
                        }
                    }
                    _ => {}
                }
            }
            RestorableKernelEffectV2::EnterSharedTerminal { terminal } => {
                if terminal.terminal_id.is_empty() || terminal.reason.is_empty() {
                    return Err(invalid(
                        format!("{path}.terminal"),
                        "terminal identity and reason must not be empty",
                    ));
                }
            }
        }
    }
    Ok(())
}

fn validate_timer_owner(owner: &er_types::TimerOwner, path: &str) -> Result<(), SnapshotError> {
    if owner.owner_id.is_empty() || owner.address.is_empty() || owner.reason.is_empty() {
        return Err(invalid(
            path,
            "timer owner ID, address, and reason must all be non-empty",
        ));
    }
    Ok(())
}

fn validate_restorable_timer(
    timer: &RestorableTimerSnapshotV2,
    path: &str,
) -> Result<(), SnapshotError> {
    validate_timer_owner(
        &timer.registration.owner,
        &format!("{path}.registration.owner"),
    )?;
    if timer.registration.delay_ms != timer.original_delay_ms {
        return Err(invalid(
            format!("{path}.original_delay_ms"),
            "scheduled timer original delay must equal its registration delay",
        ));
    }
    if timer.remaining_active_ms > timer.original_delay_ms {
        return Err(invalid(
            format!("{path}.remaining_active_ms"),
            "remaining active duration cannot exceed original delay",
        ));
    }
    Ok(())
}

fn validate_fault_operation(operation: &FaultOperationV2, path: &str) -> Result<(), SnapshotError> {
    match operation {
        FaultOperationV2::Reorder { packet_ids } => {
            let mut sorted = packet_ids.clone();
            sorted.sort_unstable();
            strictly_sorted(&sorted, &format!("{path}.packet_ids"))?;
        }
        FaultOperationV2::Delay { .. }
        | FaultOperationV2::Deliver { .. }
        | FaultOperationV2::DeliverNext
        | FaultOperationV2::Drop { .. }
        | FaultOperationV2::Duplicate { .. } => {}
        FaultOperationV2::Corrupt { corruption, .. } => {
            validate_fault_corruption(corruption, &format!("{path}.corruption"))?;
        }
    }
    Ok(())
}

pub(crate) fn validate_pair_operation(operation: &PairOperationV2) -> Result<(), SnapshotError> {
    match operation {
        PairOperationV2::Fault { operation } => {
            validate_fault_operation(operation, "input.operation")
        }
        PairOperationV2::StorageResult { result, .. } => {
            validate_storage_result(result, "input.result")
        }
        PairOperationV2::RawInput { .. }
        | PairOperationV2::AdvanceTime { .. }
        | PairOperationV2::Disconnect { .. }
        | PairOperationV2::Reconnect { .. }
        | PairOperationV2::BattlePresentationOutcome { .. }
        | PairOperationV2::Suspend { .. }
        | PairOperationV2::Resume { .. } => Ok(()),
    }
}

fn validate_rng_audit(
    draws: &[RngDraw],
    previous_sequence: Option<SafeU53>,
    path: &str,
) -> Result<(), SnapshotError> {
    let mut previous = previous_sequence;
    for (index, draw) in draws.iter().enumerate() {
        draw.validate()
            .map_err(|error| invalid(format!("{path}[{index}]"), error.to_string()))?;
        if let Some(previous) = previous {
            let expected = next_sequence(previous, &format!("{path}[{index}].sequence"))?;
            if draw.sequence != expected {
                return Err(invalid(
                    format!("{path}[{index}].sequence"),
                    format!(
                        "expected contiguous RNG audit sequence {expected}, got {}",
                        draw.sequence
                    ),
                ));
            }
        }
        previous = Some(draw.sequence);
    }
    Ok(())
}

fn rng_audit_digest(draws: &[RngDraw]) -> Result<String, SnapshotError> {
    content_digest(&draws).map_err(|error| SnapshotError::Canonical {
        path: "rng_audit_digest".to_owned(),
        reason: error.to_string(),
    })
}

fn validate_rng_audit_digest(
    draws: &[RngDraw],
    digest: &str,
    path: &str,
) -> Result<(), SnapshotError> {
    let expected = rng_audit_digest(draws)?;
    if digest != expected {
        return Err(invalid(
            path,
            format!(
                "digest does not match the canonical RNG audit vector; expected {expected}, got {digest}"
            ),
        ));
    }
    Ok(())
}

fn validate_endpoint_entry_shape(
    entry: &KernelTraceEntryV2,
    local_seat: SeatId,
) -> Result<(), SnapshotError> {
    if entry.sequence == SafeU53::ZERO {
        return Err(invalid(
            "entry.sequence",
            "endpoint sequences are one-based",
        ));
    }
    validate_endpoint_input(&entry.input, local_seat)?;
    validate_endpoint_effects(&entry.effects, local_seat)?;
    validate_rng_audit_digest(
        &entry.rng_audit,
        &entry.rng_audit_digest,
        "entry.rng_audit_digest",
    )?;
    validate_live_resources(&entry.live_resources)?;
    if let Some(failure) = &entry.failure {
        failure.validate(Some(TraceFailureOwnerV2::Endpoint))?;
    }
    Ok(())
}

fn validate_pair_entry_shape(
    entry: &PairTraceEntryV2,
    host_seat: SeatId,
    guest_seat: SeatId,
    host_last_rng_sequence: Option<SafeU53>,
    guest_last_rng_sequence: Option<SafeU53>,
) -> Result<(), SnapshotError> {
    if entry.trace_sequence == SafeU53::ZERO {
        return Err(invalid(
            "entry.trace_sequence",
            "pair trace sequences are one-based",
        ));
    }
    validate_pair_operation(&entry.input)?;
    validate_pair_effects(&entry.effects, host_seat, guest_seat)?;
    validate_pair_endpoint_evidence(&entry.host, host_last_rng_sequence, "host")?;
    validate_pair_endpoint_evidence(&entry.guest, guest_last_rng_sequence, "guest")?;
    entry.environment_after.validate()?;
    if entry.environment_after.host_driver.seat != host_seat
        || entry.environment_after.guest_driver.seat != guest_seat
    {
        return Err(invalid(
            "environment_after.driver.seat",
            "environment driver seats must equal the pair endpoint identities",
        ));
    }
    validate_pair_environment_projection(
        &entry.environment_after,
        &entry.host.live_resources,
        &entry.guest.live_resources,
    )?;
    let expected_after_time = if entry.failure.is_some() {
        entry.virtual_time_ms
    } else {
        pair_operation_after_time(&entry.input, entry.virtual_time_ms, "entry.virtual_time_ms")?
    };
    if entry.environment_after.clock.now_ms != expected_after_time {
        return Err(invalid(
            "entry.environment_after.clock.now_ms",
            "environment clock does not match the operation's deterministic time transition",
        ));
    }
    Ok(())
}

fn validate_pair_endpoint_evidence(
    evidence: &PairTraceEndpointEvidenceV2,
    previous_rng_sequence: Option<SafeU53>,
    path: &str,
) -> Result<(), SnapshotError> {
    validate_rng_audit(
        &evidence.rng_audit,
        previous_rng_sequence,
        &format!("{path}.rng_audit"),
    )?;
    validate_rng_audit_digest(
        &evidence.rng_audit,
        &evidence.rng_audit_digest,
        &format!("{path}.rng_audit_digest"),
    )?;
    validate_live_resources(&evidence.live_resources)?;
    Ok(())
}

fn validate_pair_effects(
    effects: &[PairTraceEffectV2],
    host_seat: SeatId,
    guest_seat: SeatId,
) -> Result<(), SnapshotError> {
    for (index, effect) in effects.iter().enumerate() {
        let expected_sequence = safe_u53_from_usize(index, &format!("effects[{index}].sequence"))?;
        if effect.sequence != expected_sequence {
            return Err(invalid(
                format!("effects[{index}].sequence"),
                format!(
                    "expected contiguous zero-based sequence {expected_sequence}, got {}",
                    effect.sequence
                ),
            ));
        }
        let path = format!("effects[{index}]");
        let carried_endpoint = pair_effect_endpoint(&effect.effect, host_seat, guest_seat, &path)?;
        if let Some(carried_endpoint) = carried_endpoint
            && carried_endpoint != effect.origin
        {
            return Err(invalid(
                format!("{path}.origin"),
                "effect origin does not agree with the carried seat/endpoint",
            ));
        }
    }
    Ok(())
}

fn pair_effect_endpoint(
    effect: &RestorableKernelEffectV2,
    host_seat: SeatId,
    guest_seat: SeatId,
    path: &str,
) -> Result<Option<PairEndpoint>, SnapshotError> {
    let seat = match effect {
        RestorableKernelEffectV2::SendFrame { from, bytes }
        | RestorableKernelEffectV2::SendProposal { from, bytes } => {
            validate_bytes(bytes, &format!("{path}.bytes"))?;
            *from
        }
        RestorableKernelEffectV2::ScheduleTimer { timer } => {
            validate_restorable_timer(timer, path)?;
            timer.registration.endpoint
        }
        RestorableKernelEffectV2::CancelTimer { endpoint, .. }
        | RestorableKernelEffectV2::BattleUiChanged { endpoint, .. }
        | RestorableKernelEffectV2::PresentBattle { endpoint, .. }
        | RestorableKernelEffectV2::Load { endpoint, .. }
        | RestorableKernelEffectV2::Persist { endpoint, .. } => {
            match effect {
                RestorableKernelEffectV2::BattleUiChanged { projection, .. } => projection
                    .validate()
                    .map_err(|error| invalid(format!("{path}.projection"), error.to_string()))?,
                RestorableKernelEffectV2::Load { request, .. }
                | RestorableKernelEffectV2::Persist { request, .. } => {
                    request.validate(&format!("{path}.request"))?;
                    match (effect, request) {
                        (
                            RestorableKernelEffectV2::Load { .. },
                            RestorableStorageRequestV2::Load { .. },
                        )
                        | (
                            RestorableKernelEffectV2::Persist { .. },
                            RestorableStorageRequestV2::Persist { .. },
                        ) => {}
                        _ => {
                            return Err(invalid(
                                format!("{path}.request"),
                                "Load and Persist effects must retain their matching request variant",
                            ));
                        }
                    }
                }
                _ => {}
            }
            *endpoint
        }
        RestorableKernelEffectV2::EnterSharedTerminal { terminal } => {
            if terminal.terminal_id.is_empty() || terminal.reason.is_empty() {
                return Err(invalid(
                    format!("{path}.terminal"),
                    "terminal identity and reason must not be empty",
                ));
            }
            return Ok(None);
        }
    };
    if seat == host_seat {
        Ok(Some(PairEndpoint::Host))
    } else if seat == guest_seat {
        Ok(Some(PairEndpoint::Guest))
    } else {
        Err(invalid(
            format!("{path}.origin"),
            format!("seat {seat} is not one of the pair endpoint identities"),
        ))
    }
}

fn validate_pair_environment_projection(
    environment: &PairEnvironmentResourceSnapshotV2,
    host_resources: &LiveResourceSnapshot,
    guest_resources: &LiveResourceSnapshot,
) -> Result<(), SnapshotError> {
    let mut timer_keys = BTreeSet::new();
    for timer in &environment.clock.timers {
        if !timer_keys.insert((timer.endpoint, timer.timer_id)) {
            return Err(invalid(
                "environment_after.clock.timers",
                "timer endpoint/ID identities must be unique",
            ));
        }
    }
    let mut expected_timer_keys = host_resources
        .timers
        .iter()
        .copied()
        .map(|timer_id| (environment.host_driver.seat, timer_id))
        .collect::<BTreeSet<_>>();
    expected_timer_keys.extend(
        guest_resources
            .timers
            .iter()
            .copied()
            .map(|timer_id| (environment.guest_driver.seat, timer_id)),
    );
    if timer_keys != expected_timer_keys {
        return Err(invalid(
            "environment_after.clock.timers",
            "clock timer identities must equal the host/guest live-resource projection",
        ));
    }

    let pending_presentations = environment
        .presenter
        .pending
        .iter()
        .map(|entry| entry.event.event_id.clone())
        .collect::<BTreeSet<_>>();
    let mut expected_presentations = host_resources.battle_presentations.clone();
    expected_presentations.extend(guest_resources.battle_presentations.iter().cloned());
    if pending_presentations != expected_presentations {
        return Err(invalid(
            "environment_after.presenter.pending",
            "presenter pending event IDs must equal the endpoint live-resource projection",
        ));
    }

    let pending_storage = environment
        .storage
        .pending_requests
        .iter()
        .map(|request| request.request.request_id())
        .collect::<BTreeSet<_>>();
    let mut expected_storage = host_resources.storage_requests.clone();
    expected_storage.extend(guest_resources.storage_requests.iter().copied());
    if pending_storage != expected_storage {
        return Err(invalid(
            "environment_after.storage.pending_requests",
            "storage request IDs must equal the endpoint live-resource projection",
        ));
    }

    let network_packets = environment
        .network
        .packets
        .iter()
        .map(|packet| packet.packet_id)
        .collect::<BTreeSet<_>>();
    let mut expected_packets = host_resources.network_packets.clone();
    expected_packets.extend(guest_resources.network_packets.iter().copied());
    if network_packets != expected_packets {
        return Err(invalid(
            "environment_after.network.packets",
            "network packet IDs must equal the endpoint live-resource projection",
        ));
    }
    Ok(())
}

fn pair_operation_after_time(
    operation: &PairOperationV2,
    before: SafeU53,
    path: &str,
) -> Result<SafeU53, SnapshotError> {
    match operation {
        PairOperationV2::AdvanceTime { delta_ms } => {
            let value = before
                .get()
                .checked_add(delta_ms.get())
                .ok_or_else(|| invalid(path, "virtual time addition overflowed u64"))?;
            SafeU53::new(value).map_err(|_| invalid(path, "virtual time exceeds SafeU53"))
        }
        PairOperationV2::RawInput { .. }
        | PairOperationV2::Fault { .. }
        | PairOperationV2::Disconnect { .. }
        | PairOperationV2::Reconnect { .. }
        | PairOperationV2::BattlePresentationOutcome { .. }
        | PairOperationV2::StorageResult { .. }
        | PairOperationV2::Suspend { .. }
        | PairOperationV2::Resume { .. } => Ok(before),
    }
}

fn advance_pair_sequence(
    before: SafeU53,
    successful: bool,
    path: &str,
) -> Result<SafeU53, SnapshotError> {
    if successful {
        next_sequence(before, path)
    } else {
        Ok(before)
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
    if seed.is_empty()
        || (seed.len() > 1 && seed.starts_with('0'))
        || !seed.bytes().all(|b| b.is_ascii_digit())
    {
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

fn validate_fault_corruption(
    corruption: &FrameCorruptionV2,
    path: &str,
) -> Result<(), SnapshotError> {
    match corruption {
        FrameCorruptionV2::Replace { body } => {
            validate_canonical_json::<RawFrame>(body, &format!("{path}.body"))?;
        }
        FrameCorruptionV2::MalformedJson { body } => {
            let body_path = format!("{path}.body");
            let bytes = decode_canonical_bytes(body, &body_path)?;
            std::str::from_utf8(&bytes)
                .map_err(|error| invalid(body_path.as_str(), format!("must be UTF-8: {error}")))?;
        }
        FrameCorruptionV2::DeleteField { json_pointer } => {
            validate_json_pointer(json_pointer, &format!("{path}.json_pointer"))?;
        }
        FrameCorruptionV2::ReplaceField {
            json_pointer,
            canonical_value,
        } => {
            validate_json_pointer(json_pointer, &format!("{path}.json_pointer"))?;
            validate_canonical_json::<serde_json::Value>(
                canonical_value,
                &format!("{path}.canonical_value"),
            )?;
        }
    }
    Ok(())
}

fn validate_json_pointer(pointer: &str, path: &str) -> Result<(), SnapshotError> {
    if !pointer.starts_with('/') {
        return Err(invalid(
            path,
            "must be a non-root JSON pointer beginning with '/'",
        ));
    }
    Ok(())
}

fn validate_canonical_json<T>(value: &CanonicalHexBytes, path: &str) -> Result<(), SnapshotError>
where
    T: DeserializeOwned + Serialize,
{
    let bytes = decode_canonical_bytes(value, path)?;
    let decoded =
        serde_json::from_slice::<T>(&bytes).map_err(|error| SnapshotError::Canonical {
            path: path.to_owned(),
            reason: error.to_string(),
        })?;
    let recanonical = canonical_bytes(&decoded).map_err(|error| SnapshotError::Canonical {
        path: path.to_owned(),
        reason: error.to_string(),
    })?;
    if recanonical != bytes {
        return Err(SnapshotError::Canonical {
            path: path.to_owned(),
            reason: "payload is not the exact canonical JSON encoding".to_owned(),
        });
    }
    Ok(())
}

fn decode_canonical_bytes(value: &CanonicalHexBytes, path: &str) -> Result<Vec<u8>, SnapshotError> {
    validate_bytes(value, path)?;
    let encoded = value.as_str().as_bytes();
    if !encoded.len().is_multiple_of(2) {
        return Err(invalid(
            path,
            "canonical payload contains an odd number of hexadecimal digits",
        ));
    }
    let mut bytes = Vec::with_capacity(encoded.len() / 2);
    for pair in encoded.chunks_exact(2) {
        let high = canonical_hex_value(pair[0])
            .ok_or_else(|| invalid(path, "canonical payload contains invalid hexadecimal"))?;
        let low = canonical_hex_value(pair[1])
            .ok_or_else(|| invalid(path, "canonical payload contains invalid hexadecimal"))?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

fn canonical_hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        _ => None,
    }
}

fn validate_live_resources(resources: &LiveResourceSnapshot) -> Result<(), SnapshotError> {
    validate_kernel_live_resources(resources)
        .map_err(|error| invalid("live_resources", error.to_string()))
}

fn endpoint_rank(endpoint: PairEndpoint) -> u8 {
    match endpoint {
        PairEndpoint::Host => 0,
        PairEndpoint::Guest => 1,
    }
}

fn event_key(
    endpoint: PairEndpoint,
    event_id: &BattlePresentationEventId,
) -> (u8, BattlePresentationEventId) {
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
        if !pending.iter().any(|entry| entry.event == planned) {
            return Err(invalid(
                path,
                "presenter is missing the endpoint's exact pending event",
            ));
        }
    }
    let outcomes = presenter
        .outcomes
        .iter()
        .filter(|entry| entry.endpoint == pair_endpoint)
        .collect::<Vec<_>>();
    if outcomes.len() != endpoint.pending_presentations.outcomes.len() {
        return Err(invalid(
            path,
            "presenter and endpoint have different settled outcome counts",
        ));
    }
    for outcome in &endpoint.pending_presentations.outcomes {
        if !outcomes.iter().any(|entry| &entry.outcome == outcome) {
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
        if self.active_holds.iter().any(|hold| {
            hold.remaining_ms == SafeU53::ZERO || !self.pressed_keys.contains(&hold.key)
        }) {
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
        let mut held_ranks = self
            .packets
            .iter()
            .filter_map(|packet| match &packet.reorder_state {
                PacketReorderStateV2::Stable => None,
                PacketReorderStateV2::Held { rank } => Some(*rank),
            })
            .collect::<Vec<_>>();
        held_ranks.sort_unstable();
        for (index, rank) in held_ranks.iter().enumerate() {
            let index = u64::try_from(index).map_err(|_| {
                invalid("network.packets.reorder_state", "reorder rank exceeds u64")
            })?;
            let expected = SafeU53::new(index).map_err(|_| {
                invalid(
                    "network.packets.reorder_state",
                    "reorder rank exceeds SafeU53",
                )
            })?;
            if *rank != expected {
                return Err(invalid(
                    "network.packets.reorder_state",
                    "held reorder ranks must be zero-based, contiguous, and unique",
                ));
            }
        }
        if self.links.len() != 2 {
            return Err(invalid(
                "network.links",
                "pair network must retain exactly host and guest links",
            ));
        }
        if self.disposed
            && (!self.packets.is_empty()
                || self
                    .links
                    .iter()
                    .any(|link| !link.connected || link.suspended))
        {
            return Err(invalid(
                "network",
                "disposed network cannot retain packets or disconnected/suspended links",
            ));
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
            || outcome_keys != tombstone_keys
        {
            return Err(invalid(
                "presenter",
                "pending identities must be unsettled and outcomes must exactly match tombstones",
            ));
        }
        if self.disposed && !self.pending.is_empty() {
            return Err(invalid(
                "presenter",
                "disposed presenter cannot retain pending state",
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
                .map(|request| {
                    (
                        endpoint_rank(request.endpoint),
                        request.request.request_id(),
                    )
                })
                .collect::<Vec<_>>(),
            "storage.pending_requests",
        )?;
        for value in &self.values {
            if value.key.is_empty() {
                return Err(invalid("storage.values.key", "must not be empty"));
            }
            validate_bytes(&value.canonical_value, "storage.values.canonical_value")?;
        }
        for request in &self.pending_requests {
            request
                .request
                .validate("storage.pending_requests.request")?;
        }
        if let Some(next_request_id) = self.next_request_id
            && self
                .pending_requests
                .iter()
                .any(|request| request.request.request_id() >= next_request_id)
        {
            return Err(invalid(
                "storage.next_request_id",
                "allocator must be above every pending request ID",
            ));
        }
        if let Some(fault) = &self.one_shot_fault
            && fault.reason.is_empty()
        {
            return Err(invalid(
                "storage.one_shot_fault.reason",
                "must not be empty",
            ));
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
                validate_fault_corruption(corruption, "fault_script.corruption")?;
            }
        }
        Ok(())
    }
}

impl FaultRngStateV2 {
    pub fn validate(&self) -> Result<(), SnapshotError> {
        if self.algorithm_version != crate::network::FAULT_NETWORK_RNG_ALGORITHM_VERSION
            || self.state_bits.len() != 32
            || !self
                .state_bits
                .bytes()
                .all(|bit| matches!(bit, b'0' | b'1'))
        {
            return Err(invalid(
                "fault_rng_state",
                "the pinned algorithm version and exactly 32 binary state bits are required",
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
            return Err(invalid("virtual_time_ms", "must equal clock.now_ms"));
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
        let host_authority = self
            .host
            .game
            .state
            .battle
            .as_ref()
            .map(|battle| battle.authority_seat);
        let guest_authority = self
            .guest
            .game
            .state
            .battle
            .as_ref()
            .map(|battle| battle.authority_seat);
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
        if self.host.terminal != self.guest.terminal {
            return Err(invalid(
                "host.guest.terminal",
                "both endpoints must retain the exact same shared terminal state",
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
        let host_seat = self.host.runtime_identity.local_seat;
        let guest_seat = self.guest.runtime_identity.local_seat;
        let host_link = self
            .network
            .links
            .iter()
            .find(|link| link.endpoint == PairEndpoint::Host)
            .ok_or_else(|| invalid("network.links", "host link is absent"))?;
        let guest_link = self
            .network
            .links
            .iter()
            .find(|link| link.endpoint == PairEndpoint::Guest)
            .ok_or_else(|| invalid("network.links", "guest link is absent"))?;
        if host_link.generation != guest_link.generation {
            return Err(invalid(
                "network.links.generation",
                "the shared pair transport must use one generation at both endpoints",
            ));
        }
        if self
            .host
            .protocol
            .frame_context
            .context
            .connection_generation
            != host_link.generation
            || self
                .guest
                .protocol
                .frame_context
                .context
                .connection_generation
                != guest_link.generation
        {
            return Err(invalid(
                "network.links.generation",
                "network link generations must equal each endpoint's local protocol generation",
            ));
        }
        let host_peer = self.host.protocol.connections.as_slice();
        let guest_peer = self.guest.protocol.connections.as_slice();
        if host_peer.len() != 1
            || host_peer[0].peer_seat != guest_seat
            || host_peer[0].generation != guest_link.generation
            || guest_peer.len() != 1
            || guest_peer[0].peer_seat != host_seat
            || guest_peer[0].generation != host_link.generation
        {
            return Err(invalid(
                "network.links",
                "network links and endpoint peer bindings must describe the exact same pair topology",
            ));
        }
        let expected_transport = if host_link.connected && guest_link.connected {
            TransportState::Connected
        } else {
            TransportState::Disconnected
        };
        if host_peer[0].state != expected_transport || guest_peer[0].state != expected_transport {
            return Err(invalid(
                "network.links.connected",
                "pair link connectivity must equal both endpoint transport projections",
            ));
        }
        for (path, link, endpoint) in [
            ("network.links.host.suspended", host_link, &self.host),
            ("network.links.guest.suspended", guest_link, &self.guest),
        ] {
            for time_class in [
                TimeClass::Connected,
                TimeClass::Recovery,
                TimeClass::Renderer,
                TimeClass::HumanInput,
            ] {
                let projected = endpoint.scheduler.pauses.iter().any(|pause| {
                    pause.time_class == time_class
                        && pause.reasons.iter().any(|reason| reason == "suspended")
                });
                if projected != link.suspended {
                    return Err(invalid(
                        path,
                        "network suspension must equal every pausable endpoint scheduler class",
                    ));
                }
            }
            if endpoint.scheduler.pauses.iter().any(|pause| {
                pause.time_class == TimeClass::Absolute
                    && pause.reasons.iter().any(|reason| reason == "suspended")
            }) {
                return Err(invalid(
                    path,
                    "absolute time cannot carry the pair suspension reason",
                ));
            }
        }
        for packet in &self.network.packets {
            if packet.enqueued_at_ms > self.virtual_time_ms {
                return Err(invalid(
                    "network.packets.enqueued_at_ms",
                    "queued packet cannot be enqueued after pair virtual time",
                ));
            }
            let ready = packet.delivery_deadline_ms <= self.virtual_time_ms;
            if matches!(packet.disposition, PacketDispositionV2::Ready) != ready {
                return Err(invalid(
                    "network.packets.disposition",
                    "READY must exactly match a deadline at or before pair virtual time",
                ));
            }
            let source_generation = match packet.source {
                PairEndpoint::Host => host_link.generation,
                PairEndpoint::Guest => guest_link.generation,
            };
            let destination_generation = match packet.destination {
                PairEndpoint::Host => host_link.generation,
                PairEndpoint::Guest => guest_link.generation,
            };
            if packet.source_generation != packet.destination_generation
                || packet.source_generation > source_generation
                || packet.destination_generation > destination_generation
            {
                return Err(invalid(
                    "network.packets.connection_generation",
                    "queued packet must retain one transport generation no newer than either endpoint link",
                ));
            }
        }
        self.presenter.validate()?;
        validate_presenter_endpoint(
            &self.presenter,
            PairEndpoint::Host,
            &self.host,
            "presenter.host",
        )?;
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
        for (path, endpoint) in [
            ("host.scheduler", &self.host),
            ("guest.scheduler", &self.guest),
        ] {
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
                    .ok_or_else(|| {
                        invalid(path, "scheduler timer has no pair-clock registration")
                    })?;
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
