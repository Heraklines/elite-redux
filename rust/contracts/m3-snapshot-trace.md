# PokéRogue Redux Rust kernel M3 snapshot and trace contract

Status: normative for `GameConfig::Battle` once the G6 contract-freeze commit
is accepted.

M3 snapshots are complete constructors for deterministic continuation, not
diagnostic summaries. Canonical battle/material/snapshot DTOs contain no
`serde_json::Value`; canonical hex bytes containing an inherited raw Authority
frame/envelope remain the one frozen opaque wire boundary from M2. Protocol
snapshot DTOs retain those exact bytes plus closed generic identity fields and
never embed `Material`, `AuthorityEntry`, `ProposalMessage`, or
`RecoveryBundle` values that transitively expose `serde_json::Value`.

## Snapshot boundary

Public snapshots are taken only after `GameKernel::step` has processed its
private FIFO queue to quiescence. A clone-and-swap transaction, prepared but
unpublished log commit, or half-installed material/control pair can never be a
live public state and therefore is not serialized.

This resolves the apparent conflict between atomicity and "mid-transition"
restoration:

- delayed TURN material is represented as an actual queued transport packet;
- applied material always has its logical control installed in the same atomic
  kernel step;
- a delayed `controlInstalled` receipt is represented as an actual queued
  receipt packet/lease, not as absent logical control;
- presentation-blocked control is represented as installed but non-actionable;
- failure-injection tests prove staged internal states are discarded rather
  than snapshotting partial truth.

Any diagnostic trace captured inside a private transaction is replay evidence,
not a restorable public snapshot.

This quiescent rule is the steward decision for the addendum's apparent
"material applied but control pending" and prepared-transaction examples:
those states are not public M3 states. The restorable equivalent is exact
logical control installed with its receipt packet delayed. Every endpoint
snapshot therefore has `prepared_transaction = None`; deserialization rejects
a live prepared transaction instead of restoring or publishing it.

## Endpoint snapshot V2

The endpoint wire shape is closed and exhaustive:

```rust
pub enum QuiescentPreparedTransaction {}

pub struct BattleKernelRuntimeIdentitySnapshotV1 {
    pub local_seat: SeatId,
    pub protocol_config: BattleProtocolConfig,
}

pub struct RestorableKernelSnapshotV2 {
    pub schema_version: u32,
    pub content_hash: ContentPackHash,
    pub runtime_identity: BattleKernelRuntimeIdentitySnapshotV1,
    pub input_router: InputRouterSnapshotV2,
    pub ui: BattleUiProjection,
    pub scheduler: KernelSchedulerSnapshotV2,
    pub protocol: ProtocolRuntimeSnapshotV2,
    pub game: GameRuntimeSnapshotV2,
    pub pending_presentations: PendingPresentationsSnapshotV1,
    pub terminal: Option<TerminalState>,
    pub disposed: bool,
    pub prepared_transaction: Option<QuiescentPreparedTransaction>,
    pub mechanical_digest: MechanicalStateDigest,
    pub kernel_determinism_digest: KernelDeterminismDigest,
    pub presentation_plan_digest: PresentationPlanDigest,
}
```

`QuiescentPreparedTransaction` is deliberately uninhabited, so the only valid
wire value is `prepared_transaction: null`. Every field is required, including
nullable fields; missing fields, unknown fields, defaults, and flattened owner
blobs are rejected. Struct fields serialize with these snake_case names;
canonical hashing sorts object keys, while every vector below has the explicit
canonical order stated here. Every new struct uses
`#[serde(deny_unknown_fields)]`; every new enum is explicitly tagged with a
closed `SCREAMING_SNAKE_CASE` vocabulary.

`runtime_identity.local_seat` is the exact endpoint seat originally supplied
to `new_battle`; `protocol_config` is the complete role/configuration identity
needed to rebuild the owners. `ui` is not an open UI blob: it must byte-equal
the pure `BattleUiProjection` of `game.current_control` for that local seat,
including actionability after presentation/terminal fences. Restoration
rejects a projection mismatch. These fields make the two-argument
`from_snapshot(snapshot, content)` constructor complete without ambient seat
or protocol configuration.
An Authority role requires `local_seat == game.state.battle.authority_seat`;
a Replica role requires a distinct human seat present in the format. Singles
cannot construct a replica endpoint. Role, seat, frame context, peer bindings,
and `GameState` authority identity must all cross-validate.

### Input router

The exact input shape is:

```rust
pub enum PhysicalInputSourceV2 {
    Keyboard(PhysicalKey),
    Gamepad(u16),
}

pub struct PressedPhysicalInputSnapshotV2 {
    pub seat: SeatId,
    pub source: PhysicalInputSourceV2,
    pub logical_button: Option<GameButton>,
    pub printable: bool,
    pub accepted: bool,
    pub menu_instance_id: Option<MenuInstanceId>,
}

pub struct HeldLogicalButtonSnapshotV2 {
    pub seat: SeatId,
    pub button: GameButton,
    pub source: PhysicalInputSourceV2,
    pub menu_instance_id: MenuInstanceId,
}

pub struct InputButtonLockSnapshotV2 {
    pub seat: SeatId,
    pub button: GameButton,
    pub menu_instance_id: MenuInstanceId,
}

pub struct InputRepeatSnapshotV2 {
    pub seat: SeatId,
    pub button: GameButton,
    pub source: PhysicalInputSourceV2,
    pub menu_instance_id: MenuInstanceId,
    pub timer_id: TimerId,
}

pub struct InputRouterSnapshotV2 {
    pub focus: InputFocus,
    pub pressed: Vec<PressedPhysicalInputSnapshotV2>,
    pub suppressed_printable_keys: Vec<PhysicalKey>,
    pub held_buttons: Vec<HeldLogicalButtonSnapshotV2>,
    pub locks: Vec<InputButtonLockSnapshotV2>,
    pub repeats: Vec<InputRepeatSnapshotV2>,
    pub disposed: bool,
}
```

The snapshot therefore includes:

- current focus;
- every pressed physical keyboard/gamepad input and whether it was accepted or
  blocked;
- every held logical button;
- every suppressed printable key;
- every logical button lock;
- each repeat timer ID and exact scheduler owner;
- endpoint, physical source, logical button, printable classification, and the
  `MenuInstanceId` that received the original keydown.

Vectors sort by `(seat, source/button)` and reject duplicate owner keys.
`pressed` sorts by `(seat, source)`, `suppressed_printable_keys` lexically,
`held_buttons` and `repeats` by `(seat, button, source)`, and `locks` by
`(seat, button, menu_instance_id)`. Blur removes every `pressed`, suppressed,
`held_buttons`, lock, and repeat entry for the endpoint and cancels each owned
repeat timer in the same atomic step.

### Scheduler

```rust
pub struct RestorableTimerSnapshotV2 {
    pub registration: ScheduledTimer,
    pub original_delay_ms: SafeU53,
    pub remaining_active_ms: SafeU53,
}

pub struct TimeClassPauseSnapshotV2 {
    pub endpoint: SeatId,
    pub time_class: TimeClass,
    pub reasons: Vec<String>,
}

pub struct KernelSchedulerSnapshotV2 {
    pub next_timer_id: Option<SafeU53>,
    pub timers: Vec<RestorableTimerSnapshotV2>,
    pub pauses: Vec<TimeClassPauseSnapshotV2>,
    pub disposed: bool,
}
```

The snapshot includes:

- next timer ID;
- disposed state;
- every registered timer with endpoint, ID, owner, owner address, reason,
  original delay, remaining active duration, and time class;
- every pause reason set for every time class.

Timer deadlines remain the pair clock's responsibility; endpoint scheduler and
clock registrations must cross-validate exactly during pair restoration.
Timers sort by `(endpoint, timer_id)`, pauses by `(endpoint, time_class)`, and
pause reasons lexically. `remaining_active_ms <= original_delay_ms`.

### Protocol runtime

```rust
pub struct ProtocolRuntimeSnapshotV2 {
    pub role: EndpointRole,
    pub authority_log: Option<AuthorityLogSnapshotV2>,
    pub authority_replica: Option<AuthorityReplicaSnapshotV2>,
    pub proposal_admission: Option<ProposalAdmissionSnapshotV2>,
    pub proposal_leases: Option<ProposalLeaseSnapshotV2>,
    pub recovery: Option<RecoveryRuntimeSnapshotV2>,
    pub frame_context: FrameContextSnapshotV2,
    pub peer_identity: PeerIdentitySnapshotV2,
    pub connections: Vec<ConnectionSnapshotV2>,
    pub pending_correlations: Vec<CorrelatedResponseSnapshotV2>,
    pub pending_material: Option<PendingProtocolMaterialSnapshotV2>,
    pub pending_control: Option<PendingProtocolControlSnapshotV2>,
    pub pending_recoveries: Vec<PendingRecoverySnapshotV2>,
    pub staged_rebinds: Vec<StagedPeerRebindSnapshotV2>,
    pub authority_rebind_pending: bool,
    pub disposed: bool,
}

pub struct PeerBindingSnapshotV2 {
    pub seat: SeatId,
    pub generation: ConnectionGeneration,
}

pub struct AuthorityEntryIdentitySnapshotV2 {
    pub revision: Revision,
    pub context: FrameContext,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub material_digest: String,
    pub next_control_id: String,
    pub subsumes: Vec<Revision>,
}

pub struct OpaqueAuthorityEntrySnapshotV2 {
    pub identity: AuthorityEntryIdentitySnapshotV2,
    pub canonical_entry_bytes: CanonicalHexBytes,
}

pub struct OpaqueProposalEnvelopeSnapshotV2 {
    pub operation_id: OperationId,
    pub canonical_envelope_bytes: CanonicalHexBytes,
}

pub struct OpaqueRecoveryBundleSnapshotV2 {
    pub correlation_id: String,
    pub canonical_bundle_bytes: CanonicalHexBytes,
}

pub struct AuthorityDeliveryPeerStageSnapshotV2 {
    pub seat: SeatId,
    pub generation: ConnectionGeneration,
    pub stage: AuthorityDeliveryStageV2,
}

pub enum AuthorityDeliveryStageV2 {
    None,
    Admitted,
    MaterialApplied,
    ControlInstalled,
    PresentationSettled,
}

pub struct AuthorityDeliveryLeaseSnapshotV2 {
    pub revision: Revision,
    pub entry: OpaqueAuthorityEntrySnapshotV2,
    pub owner: TimerOwner,
    pub peer_stages: Vec<AuthorityDeliveryPeerStageSnapshotV2>,
    pub timer_id: Option<TimerId>,
    pub attempts: CanonicalU64Decimal,
    pub next_delay_ms: SafeU53,
    pub stopped: bool,
    pub subsumption_done: bool,
}

pub struct RetiredOperationStageSnapshotV2 {
    pub operation_id: OperationId,
    pub stage: AuthorityDeliveryStageV2,
}

pub struct AuthorityLogSnapshotV2 {
    pub local_context: FrameContext,
    pub peer_bindings: Vec<PeerBindingSnapshotV2>,
    pub owner_id: String,
    pub retain_capacity: SafeU53,
    pub delivery_backoff: BackoffPolicy,
    pub delivery_time_class: TimeClass,
    pub max_delivery_attempts: Option<SafeU53>,
    pub retained: Vec<AuthorityDeliveryLeaseSnapshotV2>,
    pub next_prepared_token: Option<SafeU53>,
    pub latest_committed: Option<OpaqueAuthorityEntrySnapshotV2>,
    pub head_revision: Revision,
    pub retired_operation_stages: Vec<RetiredOperationStageSnapshotV2>,
    pub retired_operation_order: Vec<OperationId>,
    pub capacity_refusals: SafeU53,
    pub send_failures: SafeU53,
    pub disposed: bool,
}

pub enum PendingReplicaStageV2 {
    Admitted,
    MaterialApplied,
}

pub struct PendingReplicaEntrySnapshotV2 {
    pub entry: OpaqueAuthorityEntrySnapshotV2,
    pub stage: PendingReplicaStageV2,
}

pub struct InstalledControlSnapshotV2 {
    pub revision: Revision,
    pub identity: AuthorityEntryIdentitySnapshotV2,
    pub control_id: String,
}

pub struct AuthorityReplicaSnapshotV2 {
    pub receipt_context: FrameContext,
    pub authority_seat: SeatId,
    pub authority_generation: ConnectionGeneration,
    pub frontier: AuthorityFrontier,
    pub pending: Option<PendingReplicaEntrySnapshotV2>,
    pub requested_tail_from: Option<Revision>,
    pub installed_controls: Vec<InstalledControlSnapshotV2>,
    pub recovery_proof: Option<AuthorityEntryIdentitySnapshotV2>,
    pub disposed: bool,
}

pub struct ProposalFingerprintSnapshotV2 {
    pub operation_id: OperationId,
    pub fingerprint: String,
}

pub struct ProposalAdmissionSnapshotV2 {
    pub capacity: SafeU53,
    pub fingerprints: Vec<ProposalFingerprintSnapshotV2>,
    pub disposed: bool,
}

pub enum ProposalTimerKindV2 {
    Retry,
    Absolute,
}

pub struct ProposalTimerTargetSnapshotV2 {
    pub timer_id: TimerId,
    pub operation_id: OperationId,
    pub kind: ProposalTimerKindV2,
    pub endpoint: SeatId,
    pub owner: TimerOwner,
    pub delay_ms: SafeU53,
    pub time_class: TimeClass,
}

pub struct ActiveProposalLeaseSnapshotV2 {
    pub operation_id: OperationId,
    pub proposal: OpaqueProposalEnvelopeSnapshotV2,
    pub retry_attempt: u32,
    pub retry_timer: Option<TimerId>,
    pub absolute_timer: Option<TimerId>,
    pub timer_endpoint: SeatId,
    pub absolute_delay_ms: SafeU53,
}

pub struct ProposalLeaseSnapshotV2 {
    pub config: ProposalLeaseConfig,
    pub leases: Vec<ActiveProposalLeaseSnapshotV2>,
    pub committed_tombstones: Vec<OperationId>,
    pub timer_targets: Vec<ProposalTimerTargetSnapshotV2>,
    pub disposed: bool,
}

pub struct RecoveryFenceSnapshotV2 {
    pub state: RecoveryFenceState,
    pub control_projection_allowed: bool,
    pub terminal_reason: Option<String>,
}

pub enum RecoveryTimerKindV2 {
    Request,
    Control,
    Pacing,
}

pub struct RecoveryTimerSnapshotV2 {
    pub timer: ScheduledTimer,
    pub kind: RecoveryTimerKindV2,
}

pub struct RecoveryRuntimeSnapshotV2 {
    pub config: RecoveryTransactionConfig,
    pub fence: RecoveryFenceSnapshotV2,
    pub phase: Option<RecoveryPhase>,
    pub request_id: Option<String>,
    pub captured_frontier: Option<Revision>,
    pub captured_state: Option<AuthorityFrontier>,
    pub bundle: Option<OpaqueRecoveryBundleSnapshotV2>,
    pub timers: Vec<RecoveryTimerSnapshotV2>,
    pub disposed: bool,
}

pub struct FrameContextSnapshotV2 {
    pub context: FrameContext,
}

pub struct PeerIdentitySnapshotV2 {
    pub local: FrameContext,
    pub peer: FrameContext,
}

pub struct ConnectionSnapshotV2 {
    pub peer_seat: SeatId,
    pub generation: ConnectionGeneration,
    pub state: TransportState,
}

pub struct CorrelatedResponseSnapshotV2 {
    pub correlation_id: String,
    pub bytes: CanonicalHexBytes,
}

pub struct PendingProtocolMaterialSnapshotV2 {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub kind: AuthorityEntryKind,
    pub bytes: CanonicalHexBytes,
}

pub struct PendingProtocolControlSnapshotV2 {
    pub revision: Revision,
    pub operation_id: OperationId,
    pub expected_control_id: String,
}

pub struct PendingRecoverySnapshotV2 {
    pub correlation_id: String,
    pub bundle: Option<OpaqueRecoveryBundleSnapshotV2>,
}

pub struct StagedPeerRebindSnapshotV2 {
    pub peer_seat: SeatId,
    pub generation: ConnectionGeneration,
}
```

Each named protocol snapshot is the owning `er-protocol` crate's exhaustive,
versioned serde DTO for the corresponding M2 Authority V2 state machine; it is
not a diagnostic summary or `serde_json::Value`. `canonical_entry_bytes`,
`canonical_envelope_bytes`, and `canonical_bundle_bytes` are the inherited raw
protocol boundary: restore decodes and validates their generic identity fields,
then keeps battle payload bytes opaque to `er-protocol`. Their decoded generic
identity must equal the adjacent closed identity fields exactly. Authority role requires
`authority_log` plus `proposal_admission` and null replica/lease/recovery;
replica role requires `authority_replica`, `proposal_leases`, and `recovery`
with null authority/log admission. Those DTOs include all
authority/replica state needed by the configured role:

- AuthorityLog allocator, retained entries, prepared-token allocator (with no
  live prepared commit at a quiescent boundary), receipt stages, delivery
  leases, and tombstones;
- replica frontiers, incomplete entry, exact pending material/control identity,
  tail request, control, and tombstones;
- proposal admission ledger, proposal leases/timers, and committed tombstones;
- recovery phase, transaction, fence, captured/live frontiers, timers, and
  rebind state;
- frame context, peer identity, connection generations, transport states, and
  pending correlated recovery responses.

Canonical vector order is exact: peer bindings/stages and connections by seat;
retained entries, installed controls, subsumed revisions, and recovery/frontier
lists by revision; proposal fingerprints, active leases, and committed
tombstones by operation ID; timer targets/recovery timers by timer ID;
correlations and pending recoveries by correlation ID; staged rebinds by peer
seat. `retired_operation_order` alone retains causal retirement order while
`retired_operation_stages` sorts by operation ID. Duplicate canonical keys are
invalid. `next_prepared_token` is the next unallocated token (`None` means the
allocator is exhausted), never evidence of a live prepared commit.
`AuthorityDeliveryStageV2` has the exact rank order shown by its declaration.
Stages advance monotonically (forward jumps retain the inherited M2 receipt
semantics), duplicates never regress, and `PresentationSettled` is valid only
after that same peer reached `ControlInstalled`. A retired stage is the minimum
peer/quorum stage captured when its lease retired and may be `None` only for a
lease with no bound peers. `attempts` is the exact inherited saturating `u64`
retry counter encoded by `CanonicalU64Decimal`; it is not a free-form string.
When a finite `max_delivery_attempts` is configured, `stopped`, attempts, and
the presence/absence of a delivery timer must cross-validate that limit.
`pending_material` and `pending_control` are admitted raw-protocol/receipt
records waiting for a later external protocol event; they cannot represent a
game material applied without its logical control. If application begins in an
external step, both are consumed or advanced atomically before quiescence.

This G6 contract freezes the named protocol
DTOs and their exhaustive inventory above; the integration-owned M3A
shared-root bootstrap must materialize those signatures verbatim before any
protocol worker starts. Workers may not replace them with opaque maps or add
fields.

### Game runtime

```rust
pub struct SeatControlHistorySnapshotV1 {
    pub seat: SeatId,
    pub controls: Vec<BattleControl>,
}

pub struct CommandAdmissionLedgerSnapshotV1 {
    pub command_tombstones: Vec<CommandFingerprintEntry>,
    pub replacement_tombstones: Vec<ReplacementProposalFingerprintEntry>,
}

pub struct GameRuntimeSnapshotV2 {
    pub state: GameState,
    pub current_control: BattleControlPlan,
    pub control_history: Vec<SeatControlHistorySnapshotV1>,
    pub command_admission: CommandAdmissionLedgerSnapshotV1,
    pub scripted_enemy_policy: ScriptedEnemyPolicyV1,
    pub menu_allocators: Vec<SeatMenuInstanceAllocator>,
    pub completed: bool,
}
```

The snapshot includes:

- canonical `GameState` and `BattleState`;
- complete run and battle RNG state plus next draw sequence inside `state`;
- current `BattleControl` and menu history needed for Cancel restoration;
- exact command frontier offers/target sets, retained local or remote
  proposals, admission source/stage, collected commands, and fingerprints;
- deterministic scripted enemy policy cursor;
- faint/replacement queue and occurrence allocator inside `state`;
- battle outcome and completion state.

`control_history` and allocator vectors sort by seat. History keeps causal
stack order. `menu_allocators` must exactly equal the allocator high-water
marks in `current_control`. Command/replacement tombstones are canonical-ID
sorted and duplicate-free.

Pending presentation has one owner and one exact shape:

```rust
pub struct PresentationOutcomeSnapshotV1 {
    pub event_id: BattlePresentationEventId,
    pub outcome: PresentationSettlementOutcome,
}

pub struct PendingPresentationsSnapshotV1 {
    pub plan: Vec<BattlePresentationEvent>,
    pub pending_barrier_ids: Vec<BattlePresentationEventId>,
    pub outcomes: Vec<PresentationOutcomeSnapshotV1>,
}
```

Plan order is causal event sequence; barrier IDs and outcomes sort by event ID.
Every ID must belong to the plan, with exactly one pending/outcome state.

## Pair snapshot V2

```rust
pub struct DriverHoldSnapshotV2 {
    pub key: PhysicalKey,
    pub remaining_ms: SafeU53,
}

pub struct DetachedKeyboardDriverSnapshotV2 {
    pub seat: SeatId,
    pub focus: InputFocus,
    pub pressed_keys: Vec<PhysicalKey>,
    pub active_holds: Vec<DriverHoldSnapshotV2>,
}

pub struct VirtualClockSnapshotV2 {
    pub now_ms: SafeU53,
    pub timers: Vec<PairClockTimerSnapshotV2>,
    pub disposed: bool,
}

pub struct PairClockTimerSnapshotV2 {
    pub endpoint: SeatId,
    pub timer_id: TimerId,
    pub time_class: TimeClass,
    pub remaining_active_ms: SafeU53,
    pub paused: bool,
}

pub enum RestorablePacketKindV2 {
    AuthorityFrame,
    CommandProposal,
    ReplacementProposal,
    ControlReceipt,
}

pub enum PacketReorderStateV2 {
    Stable,
    Held { rank: SafeU53 },
}

pub enum PacketDispositionV2 {
    Queued,
    Delayed,
    Ready,
}

pub struct NetworkLinkSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub generation: ConnectionGeneration,
    pub connected: bool,
    pub suspended: bool,
}

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

pub struct FaultNetworkSnapshotV2 {
    pub next_packet_id: SafeU53,
    pub next_queue_order_id: SafeU53,
    pub packets: Vec<QueuedPacketSnapshotV2>,
    pub links: Vec<NetworkLinkSnapshotV2>,
    pub disposed: bool,
}

pub struct PresenterSnapshotV2 {
    pub pending: Vec<PairPresenterEventSnapshotV2>,
    pub outcomes: Vec<PairPresenterOutcomeSnapshotV2>,
    pub tombstones: Vec<PairPresenterTombstoneSnapshotV2>,
    pub disposed: bool,
}

pub struct PairPresenterEventSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub event: BattlePresentationEvent,
}

pub struct PairPresenterOutcomeSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub outcome: PresentationOutcomeSnapshotV1,
}

pub struct PairPresenterTombstoneSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub event_id: BattlePresentationEventId,
}

pub struct StorageValueSnapshotV2 {
    pub key: String,
    pub canonical_value: CanonicalHexBytes,
}

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

pub struct StorageRequestSnapshotV2 {
    pub endpoint: PairEndpoint,
    pub request: RestorableStorageRequestV2,
}

pub struct StorageFaultSnapshotV2 {
    pub reason: String,
}

pub enum RestorableStorageResultV2 {
    Loaded { value: Option<CanonicalHexBytes> },
    Persisted,
    Failed { reason: String },
}

pub struct StorageSnapshotV2 {
    pub next_request_id: Option<SafeU53>,
    pub values: Vec<StorageValueSnapshotV2>,
    pub pending_requests: Vec<StorageRequestSnapshotV2>,
    pub one_shot_fault: Option<StorageFaultSnapshotV2>,
    pub disposed: bool,
}

pub enum FrameCorruptionV2 {
    Replace { body: CanonicalHexBytes },
    DeleteField { json_pointer: String },
    ReplaceField { json_pointer: String, canonical_value: CanonicalHexBytes },
    MalformedJson { body: CanonicalHexBytes },
}

pub enum FaultOperationV2 {
    Deliver { packet_id: SafeU53 },
    DeliverNext,
    Drop { packet_id: SafeU53 },
    Duplicate { packet_id: SafeU53 },
    Delay { packet_id: SafeU53, additional_ms: SafeU53 },
    Reorder { packet_ids: Vec<SafeU53> },
    Corrupt { packet_id: SafeU53, corruption: FrameCorruptionV2 },
}

pub struct FaultScriptSnapshotV2 {
    pub cursor: SafeU53,
    pub operations: Vec<FaultOperationV2>,
}

pub struct FaultRngStateV2 {
    pub algorithm_version: u32,
    pub state_bits: String,
}

pub enum PairOperationV2 {
    RawInput { endpoint: PairEndpoint, event: RawInputEvent },
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
```

The network snapshot stores each packet's full typed payload/body, source and
destination, both captured generations, packet/queue-order IDs, enqueue time,
delivery deadline, reorder state, and disposition. Counts or digests alone are
not restorable. Full-width `u64` seeds/states use canonical unsigned decimal
strings or explicitly versioned exact bit strings, never JSON numbers.

Presenter state includes actual pending events, policies, order, outcomes, and
idempotence tombstones. Storage includes the complete value map, pending
requests, next-request allocator, and one-shot fault state. Every pending
request retains its endpoint and closed `Load`/`Persist` operation. `Load`
contains no value; `Persist` always contains one. `next_request_id` is the next
unallocated ID (`None` means exhausted). A storage result must match one exact
pending `(endpoint, request_id)` and operation kind before either owner changes.

Host and guest intentionally derive equal presentation IDs for equal material,
so presenter pending/outcome/tombstone identity is the composite
`(endpoint, event_id)`. Those vectors sort by that key and reject duplicates;
an outcome/tombstone can settle only its matching endpoint's pending event.

`virtual_time_ms` must equal `clock.now_ms`. `sequence` is the next pair
operation sequence and is incremented exactly once after each successful
operation; a failed atomic operation retains it. `CanonicalHexBytes` is validated lowercase even-length hex of the exact
canonical bytes; it is not a JSON `Value`. Full-width seeds and RNG states are
canonical unsigned-decimal or explicitly versioned exact-bit strings. Packet
vectors sort by `queue_order_id`; links by endpoint; driver pressed keys and
holds by physical key; clock timers by `(endpoint, timer_id)`; presenter
pending events, outcomes, and tombstones by
`(endpoint, event_id.operation_id, event_id.sequence)`;
storage values by key and pending requests by `(endpoint, request_id)`; fault
script operations retain script order. Duplicate IDs/owner keys are invalid.
Every pair clock registration cross-validates the matching endpoint timer's
remaining duration, pause state, owner, and time class. The named driver/network/storage
support DTOs are closed enums/structs owned by `er-sim`; unknown variants are
rejected rather than retained as strings.

## Constructors

```rust
GameKernel::from_snapshot(snapshot, Arc<ContentPack>)
    -> Result<GameKernel, SnapshotError>

SimulatedPair::from_snapshot(snapshot, Arc<ContentPack>)
    -> Result<SimulatedPair, SnapshotError>
```

Construction is fail-atomic. It validates schema/content identity, every
owning-crate invariant, all cross-subsystem IDs/frontiers/timers/packets,
recomputes all three digests, and only then returns a live object. It never
repairs, drops, renumbers, or defaults malformed state.
`GameKernel::from_snapshot` reconstructs local seat and the complete authority
or replica owner configuration only from `snapshot.runtime_identity`.
`SimulatedPair::from_snapshot` additionally requires host/guest identities to
name distinct configured seats, the same content hash and authority seat, and
role-compatible protocol configs; no constructor argument or ambient default
may supply missing identity.

## KernelTrace V2

```rust
pub enum RestorableKernelInputV2 {
    RawInput { seat: SeatId, event: RawInputEvent },
    NetworkFrame { endpoint: SeatId, bytes: CanonicalHexBytes },
    ProposalEnvelope { endpoint: SeatId, bytes: CanonicalHexBytes },
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

pub enum RejectedBattleCompatibilityInputV1 {
    MaterialApplied,
    ControlProjected,
}

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

pub enum RestorableKernelEffectV2 {
    SendFrame { from: SeatId, bytes: CanonicalHexBytes },
    SendProposal { from: SeatId, bytes: CanonicalHexBytes },
    ScheduleTimer { timer: RestorableTimerSnapshotV2 },
    CancelTimer { endpoint: SeatId, timer_id: TimerId },
    BattleUiChanged { endpoint: SeatId, projection: BattleUiProjection },
    PresentBattle { endpoint: SeatId, event: BattlePresentationEvent },
    Load { endpoint: SeatId, request: RestorableStorageRequestV2 },
    Persist { endpoint: SeatId, request: RestorableStorageRequestV2 },
    EnterSharedTerminal { terminal: TerminalState },
}

pub enum TraceFailureOwnerV2 {
    Endpoint,
    Host,
    Guest,
    Environment,
}

pub struct TraceFailureEvidenceV2 {
    pub owner: TraceFailureOwnerV2,
    pub code: String,
    pub path: String,
    pub expected: Option<String>,
    pub actual: Option<String>,
}

pub struct KernelTraceEntryV2 {
    pub sequence: SafeU53,
    pub virtual_time_ms: SafeU53,
    pub input: RestorableKernelInputV2,
    pub effects: Vec<RestorableKernelEffectV2>,
    pub mechanical_before: MechanicalStateDigest,
    pub mechanical_after: MechanicalStateDigest,
    pub kernel_before: KernelDeterminismDigest,
    pub kernel_after: KernelDeterminismDigest,
    pub presentation_before: PresentationPlanDigest,
    pub presentation_after: PresentationPlanDigest,
    pub rng_audit: Vec<RngDraw>,
    pub rng_audit_digest: String,
    pub internal_events: Vec<InternalEventKindV1>,
    pub live_resources: LiveResourceSnapshot,
    pub failure: Option<TraceFailureEvidenceV2>,
}

pub struct EndpointKernelTraceV2 {
    pub schema_version: u32,
    pub replay_seed: String,
    pub initial_snapshot: RestorableKernelSnapshotV2,
    pub entries: Vec<KernelTraceEntryV2>,
}

pub struct PairDeterminismDigest(String);

pub struct PairTraceEndpointEvidenceV2 {
    pub mechanical_before: MechanicalStateDigest,
    pub mechanical_after: MechanicalStateDigest,
    pub kernel_before: KernelDeterminismDigest,
    pub kernel_after: KernelDeterminismDigest,
    pub presentation_before: PresentationPlanDigest,
    pub presentation_after: PresentationPlanDigest,
    pub rng_audit: Vec<RngDraw>,
    pub rng_audit_digest: String,
    pub internal_events: Vec<InternalEventKindV1>,
    pub live_resources: LiveResourceSnapshot,
}

pub struct PairTraceEffectV2 {
    pub sequence: SafeU53,
    pub origin: PairEndpoint,
    pub effect: RestorableKernelEffectV2,
}

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
    pub failure: Option<TraceFailureEvidenceV2>,
}

pub struct PairKernelTraceV2 {
    pub schema_version: u32,
    pub initial_snapshot: RestorablePairSnapshotV2,
    pub entries: Vec<PairTraceEntryV2>,
}

pub enum KernelTraceV2 {
    Endpoint(EndpointKernelTraceV2),
    Pair(PairKernelTraceV2),
}
```

Endpoint and pair traces are disjoint closed variants: a pair input can never
be paired with single-endpoint digests/effects/resources. Endpoint `sequence`
and pair `trace_sequence` values are one-based and contiguous even when an
input is rejected. `pair_sequence_before` equals the pre-operation pair
snapshot's next sequence; successful operations increment that pair-owned
value once and failed atomic operations retain it. `virtual_time_ms` is sampled
immediately before the input; for pair entries it equals the pre-operation
`clock.now_ms`. Pair effect sequence is zero-based and contiguous within an
entry, preserving the actual host/guest emission order. `SendProposal.from`
and every pair effect `origin` are mandatory.

`PairDeterminismDigest` is exactly `blake3-v1:<64 lowercase hex>`, with a
private field and checked constructor, over domain
`pokerogue-redux/m3/pair-determinism/v1` and the complete canonical pair state:
both endpoint kernel digests, both drivers, sequence/seed/time, clock, network,
presenter, storage, fault script, and fault RNG. `environment_after` retains
the full environment owner state for resource/leak evidence, while `host` and
`guest` retain separate endpoint evidence. A `Load` effect must carry the Load
request variant and `Persist` the Persist variant.

All entries contain every external input plus the resulting ordered external
effects. `failure` names its owner and is the first typed rejection/divergence
only; later differences are not accumulated ahead of it. Trace V2 embeds its
exact matching Restorable V2 origin and never relies on ambient content,
locale, clock, filesystem, or network state.
The endpoint root's `replay_seed` is the sole endpoint trace seed; a pair trace
uses only `initial_snapshot.replay_seed`. Endpoint failures require owner
`Endpoint`; pair failures require `Host`, `Guest`, or `Environment`.
A pair effect's origin must agree with every seat/endpoint carried by that effect.
`host.live_resources`, `guest.live_resources`, and `environment_after` are the
exact post-input projections and must hash consistently with the corresponding
post-state digests and `pair_after`.

## Required continuation boundaries

Hosted native and wasm32/Node tests serialize, destroy, restore, and continue
at least these states:

- physical Action held while Fight opens and before keyup;
- one doubles command collected and the other pending;
- guest proposal admitted with delivery/result pending;
- TURN packet delayed;
- exact logical control installed with its receipt packet delayed;
- replacement menu open;
- recovery fence held;
- blocking presentation pending;
- terminal reached before teardown;
- network queue containing duplicate, delayed, corrupted, and stale-generation
  packets.

Every later effect, RNG draw, mutation, digest, packet order, and resource
snapshot must match uninterrupted execution.
