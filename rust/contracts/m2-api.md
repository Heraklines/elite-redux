# PokéRogue Redux Rust kernel M2 contract

Status: revised before G4 by approved CR-0001, CR-0002, CR-0006, CR-0007, CR-0008, CR-0009, CR-0010, and CR-0011; frozen again at the revision commit recorded by worker task cards.

Source baseline:

- G3 commit: `87eb36290675378b7b08c20a09f6cdd757ae9515`
- G3 hosted gate: `30969548111`
- game oracle: `3b534099919efae827019d4a3f3c4ab0ecd6d67b`
- protocol compatibility identifier: `er-coop-47`
- frame protocol: `2`
- source-lock/schema version: `1`
- M2 ownership-manifest version: `6`

Every M2A branch starts from the exact hosted-green bootstrap commit that contains this document, the ownership manifest, shared DTOs, manifests/lockfile, crate-root exports, and compileable public stubs for every M2A lane. The literal SHA is supplied in each worker task card because a commit cannot contain its own hash. Cross-lane imports bind only to those frozen bootstrap types; workers do not wait for another lane's implementation.

`elite-redux` remains only in pinned legacy paths and protocol compatibility identifiers. The project and Rust kernel are PokéRogue Redux.

## Change control

The public items committed with this document are frozen through G5 after the approved pre-G4 revision. An implementation lane may change function bodies, private fields, private helpers, and its exclusively owned tests. It may not rename, remove, or change the type of a public item, add a dependency, alter serialization, or introduce a private wire message. A missing public capability is a contract request to the integration owner; affected lanes restart from a revised gate SHA if the request is approved.

The integration owner alone changes manifests, lockfiles, crate roots, shared DTOs, contracts, the source lock, the integration branch, and the complete hosted gate. Production TypeScript remains read-only.

M2 property/fault tests use dependency-free deterministic exhaustive and seeded generators. A lane may not activate the unused workspace `proptest` declaration or mutate the lockfile.

## Dependency direction and execution boundary

The M2 graph is acyclic:

```text
er-types       -> serde, serde_json, thiserror
er-canonical   -> serde, serde_json, blake3, thiserror
er-protocol    -> er-types, er-canonical
er-kernel      -> er-types, er-canonical, er-protocol
er-testkit     -> er-types, er-canonical, er-kernel, er-protocol
er-sim         -> er-types, er-canonical, er-protocol, er-kernel, er-testkit
er-wasm        -> er-types, er-canonical, er-protocol, er-kernel
```

`er-protocol` is the one production Authority V2 implementation. It never depends on `er-kernel`, `er-sim`, `er-testkit`, or `er-wasm`. `er-sim` is deterministic test/tooling code and never defines protocol meaning. Browser, Phaser, transport handles, callbacks, threads, async runtimes, wall-clock reads, filesystem access, and network access are forbidden in `er-protocol`, `er-kernel`, and `er-sim`.

All protocol APIs are synchronous state transitions. Future work is emitted as values. No protocol object stores a callback. The kernel maps protocol commands to `KernelEffect`; the simulator executes only those effects and feeds resulting boundary events back as `KernelInput`.

## Shared Authority V2 DTOs

`er-types::authority` owns the context-stripped wire bodies and recovery state shared across modules:

- `AuthorityEntryBody`
- `AuthorityReceiptBody`
- `TailRequestBody`
- `RecoveryRequestBody`
- `RecoveryBundleBody`
- `RecoveryBundle`
- `AuthorityRecoverySlice`
- `RecoveryAppliedProof`
- `TerminalFrameBody`
- `AuthorityFrontier`
- `RecoveryPhase`
- `RecoveryFenceState`
- `RecoveryFenceView`

An entry or receipt body never carries a nested context. A validated envelope reattaches its authenticated `FrameContext`. A recovery tail contains context-stripped entry bodies and inherits the envelope context.

`frontierOperationId` and recovery `nextControl` are required nullable fields. At frontier zero both are exactly null and the required tail is empty. At a positive frontier both are non-null. `RecoveryAppliedProof.controlId` and receipt `controlId` are omission-only optionals: absent is valid; explicit null is invalid. `Material.payload` is required and may itself be JSON null.

The existing M1 `NetworkFrame.body: serde_json::Value` remains intact for lossless compatibility. M2 adds a typed validated-frame view; it does not replace or reinterpret the frozen envelope.

## Raw-first frame validation

`FrameValidator` is total over `RawFrame::JsonText` and `RawFrame::JsonValue`. It returns exactly one of:

- `InboundFrameResult::Valid { frame: Box<ValidatedFrame> }`
- `InboundFrameResult::CosmeticDrop { reason }`
- `InboundFrameResult::ProtocolViolation { frame_type, issues }`

Validation order and issue order match `protocol-validator.ts`. Malformed JSON, non-object envelopes, missing/unsupported `v`, and missing/non-string `t` are protocol violations. Unknown string frame types are cosmetic drops. The seven known mechanical types are `authorityEntry`, `authorityReceipt`, `tailRequest`, `recoveryRequest`, `recoveryBundle`, `recoveryApplied`, and `terminal`.

Boundary shape validation is deliberately separate from role/state admission. It validates the eight mandatory context fields and body shape but does not compare against local session identity, peer role, revision cursors, or connection generation. `frame_contexts_equal` compares all eight fields; `frame_contexts_compatible` compares session, run, epoch, seat map, and membership only.

Known-body validation accepts unknown object properties. It preserves the oracle's layered rules: a receipt revision may be zero at the structural boundary even though no committed entry has revision zero; generic material accepts `payload: null`; semantic admission and material adapters apply narrower rules later.

Opaque shared string IDs are non-empty-only. The AuthorityLog semantic entry
and receipt boundary alone applies the 256-JavaScript-UTF-16-unit C0/DEL-free
operation-token rule; its material digest uses the same UTF-16 bound without a
control-character ban. Safe signed and unsigned integers accept every finite
integral JSON number form accepted by `Number.isSafeInteger`, normalize negative
zero to zero, and serialize as integer tokens. Rust's explicit UTF-8 carrier
rejects JavaScript lone surrogates.

## Successor and control identity

`SuccessorValidator` is pure. It exposes structural issue collection, one-error validation, exact `control_id_of`, control equality/address equality, wait authorization, and predecessor-control successor authorization.

`control_id_of` reproduces `next-control.ts` exactly. It is a complete unhashed address string, uses JavaScript `encodeURIComponent` semantics, canonicalizes command targets and set-like lists, preserves replacement-tail order, preserves explicit wildcard `*`, and never substitutes canonical JSON or a content digest.

The five controls retain their existing DTOs. M2 adds their semantic validation:

- positive command coordinates, non-empty targets, unique field indices;
- one ordered replacement chain with matching boundary coordinates, increasing occurrences, and unique operation IDs;
- closed interaction surface/operation-kind compatibility and non-empty unique successor sets;
- address-constrained waits with required nullable expected operation identity and exact N/N+1 rules;
- non-empty terminal identity.

`control_allows_successor_entry` never reads a Phaser phase or ambient queue. It derives only from the predecessor's stated control and the candidate entry's typed identity, coordinates, and material capsule.

## Scheduler and timer ownership

Each independent `GameKernel` owns one `KernelScheduler`, which is the only
allocator and owner of its timer registrations. Producers synchronously call
that scheduler; they never construct a scheduler command or choose an ID.
Every timer records:

- endpoint;
- timer ID;
- owner kind and owner identity;
- exact address;
- reason;
- delay;
- one `TimeClass`.

M2 time classes are exactly `connected`, `recovery`, `renderer`, `humanInput`, and `absolute`. Absolute time never pauses. Disconnect pauses connected time. Endpoint suspension pauses all four mechanical classes. Explicit pause reasons compose as sets, duplicate pauses are idempotent, and a class resumes only when its final reason is removed.

Removing a due timer happens before its event is returned. `cancel`, `cancel_owner`, and `dispose` are idempotent. Disposal rejects new schedules and leaves no live timer registration. The scheduler never invokes a callback and never reads time.

`TimerSpec` carries endpoint, owner, delay, and class. `schedule_batch` validates
the complete batch and ID capacity before mutation, then allocates atomically in
input order; proposal arm uses it for its absolute and retry registrations.
Schedule state and producer state are complete, and schedule actions precede
any send/deliver/project action that can cause synchronous loopback. A fired
registration is consumed once by `GameKernel` and routed as the exact removed
`ScheduledTimer` to its owner.

`TimerId` is unique for one scheduler lifetime. At the shared simulator clock
boundary, registration identity is `(endpoint, timerId)`, allowing two
independent kernels to use the same numeric ID. `VirtualClock` owns the one
monotonic virtual time used by both endpoints, all time classes, the fault
network, traces, and campaigns. It preserves remaining active time across
pauses, orders equal deadlines by deadline, endpoint, then timer ID, and exposes
only arithmetic advancement; it never sleeps.

## Authority log

`AuthorityLog` is the authority-side owner of the one global revision order, bounded retained entries, peer receipt stages, delivery leases, supersession tombstones, and recovery slices.

Commit validates the complete entry draft before consuming a revision. Revisions start at one. Default retention capacity is 512. Capacity exhaustion refuses a commit and does not burn a revision or evict unresolved truth. Entries remain retained until the first three mechanical stages reach full peer quorum or explicit subsumption retires them. `presentationSettled` is observable but never mechanical retirement evidence.

Delivery sends immediately, then redelivery starts after 250 ms of connected time, doubles to 5 s, and stops only on mechanical quorum, subsumption, disposal, or the configured inert attempt ceiling. Receipt intake requires the exact retained revision/operation, receiving non-authority peer, current generation, monotonic stage, and exact control ID at `controlInstalled`. Duplicate stage evidence is idempotent.

Recovery slices come from the same retained log. A lower captured frontier requires a dense contiguous retained tail. An equal nonzero frontier returns the latest entry as a one-entry control reconstruction proof. Recovery proof intake closes only its correlated recovery-bundle lease and never retires authority entries.

Connection rebind validates and prepares the complete replacement before
mutation. `AuthorityRebindOutcome` reports retained lease count and carries one
immediate existing `Deliver` action per retained entry and authenticated peer.
An unchanged binding yields zero/no actions; failure is atomic. Existing lease
timers, attempts, delays, stages, and identities are preserved.

The corrected scheduler-facing authority signatures are frozen as:

```rust
publish_prepared(token, scheduler) -> Result<CommitOutcome, AuthorityLogError>
commit(draft, scheduler) -> Result<CommitOutcome, AuthorityLogError>
accept_receipt_detailed(receipt, scheduler) -> ReceiptOutcome
accept_receipt(receipt, scheduler) -> (bool, Vec<AuthorityLogAction>)
timer_fired(fired: ScheduledTimer, scheduler) -> Result<Vec<AuthorityLogAction>, AuthorityLogError>
rebind_connection(local_context, peer_bindings) -> Result<AuthorityRebindOutcome, AuthorityLogError>
dispose(reason, scheduler) -> Vec<AuthorityLogAction>
```

Every scheduler argument is the owning `GameKernel` scheduler. The log stores
only IDs returned by it. Rebind preserves existing timer registrations and
therefore does not receive or mutate the scheduler.

## Authority replica

`AuthorityReplica` owns three separate monotonic frontiers: received, material, and control. It admits at most one incomplete revision. A duplicate resumes at the exact incomplete stage and never reapplies material. A future revision produces one coalesced tail request; it does not create a replica retry timer. N+1 remains blocked until N's stated control is installed.

The legacy TypeScript `CoopAuthorityLog` interface combined two endpoint roles in one surface. Rust intentionally splits it without changing meaning: authority-side `commit`, `accept_receipt`, `retained`, retention, and redelivery live on `AuthorityLog`; replica-side `admit`, `record_replica_stage`, frontier accessors, recovery adoption, and recovered-frontier staging live on `AuthorityReplica`. The two are composed only by `GameKernel`; neither is a reference implementation substitute.

Replica application is staged:

```text
admit entry
  -> admitted receipt
  -> request exact material application
  -> materialApplied receipt
  -> request projection of the stated control
  -> controlInstalled receipt with exact control ID
  -> optional presentationSettled receipt
```

Fresh positive recovery validates and atomically stages the complete final
`AuthorityEntry`: received/material become `R`, control becomes `R - 1`, and
the exact material-applied entry remains pending for ordinary control
installation. Terminal-only `adopt_frontier` cannot establish a fresh positive
identity; it is idempotent only for an already complete matching pending
recovery identity. Revision zero remains the empty-frontier no-op. Disposal is
idempotent and clears pending entry, tail request, controls, and tombstones.

## Proposal admission and leases

`ProposalAdmissionLedger` is separate from revision assignment. Its default capacity is 8,192 and it never evicts. Admission returns admitted, duplicate, conflict, invalid, or capacity-exhausted. The same operation ID and same fingerprint execute once; the same ID and a different fingerprint fail closed.

Ordinary proposal fingerprints are the exact JavaScript `JSON.stringify` result of `[sequence, label, choice, wire ?? null, rewardSurface ?? null]`. Biome-shop fingerprints use the pinned sequence plus 7,000,000 and the same five-slot form. Bargain fingerprints use the pinned sequence plus 7,500,000 and `[sequence, "bargain", outcome]`. These strings are not sorted canonical JSON or hashes; raw array order and Bargain outcome object insertion order are load-bearing. The fingerprint is not a material digest and does not assign a revision.

`ProposalLeaseManager` retains an opaque, already-defined outbound proposal value. It emits resend commands but does not invent an Authority V2 frame type. New leases send immediately. Re-arming the same live ID/fingerprint from the same `proposal.from` refreshes and immediately resends; a sender change or conflicting fingerprint fails closed atomically at every generation; a committed tombstone returns already-committed. Connected-time retries begin at 250 ms and cap at 5 s. A separate 20-minute absolute ceiling terminalizes the lease exactly once. Rebind to a new current generation triggers an immediate resend of every retained lease with the same proposal identity. Observation of the exact committed operation creates a session-lifetime tombstone even before a lease exists and cancels both timers. Disposal clears timers, leases, and tombstones and is idempotent.

Proposal absolute/retry timers are allocated atomically by the kernel scheduler
and owned by the sending endpoint (`proposal.from`). Destination/generation
rebind updates retained egress but never moves the sender-local timer endpoint.

The corrected lease signatures are frozen as:

```rust
arm(spec, scheduler) -> Result<ProposalLeaseOutcome, ProposalLeaseError>
observe_committed(operation_id, scheduler) -> (bool, Vec<ProposalLeaseAction>)
timer_fired(fired: ScheduledTimer, scheduler) -> Result<Vec<ProposalLeaseAction>, ProposalLeaseError>
dispose(reason, scheduler) -> Vec<ProposalLeaseAction>
```

`arm` uses one atomic two-spec batch. Scheduler exhaustion is an explicit
`ProposalLeaseError` and leaves both scheduler and lease state unchanged.

## Recovery transaction

Recovery is a fenced transaction, not a second log. The phase order is exactly:

```text
fence-acquired
frontier-captured
requested
validated
material-applied
frontier-installed
control-installed
acked
released
```

Any failure enters `terminalized`. The fence is acquired before capture and before the request effect. While held it freezes command admission, progression, materialization, control-surface start, and authority-wait creation. The narrow control-projection window permits only the bundle's exact stated control and dependent wait.

`RecoveryTransaction` owns one `RecoveryFence` value and exposes its immutable view/predicates to its owning `GameKernel`. This is the shared synchronous seam used by admission and progression; it is deliberately not a callback, subscription, reference-counted handle, or module-global object.

Bundle validation correlates request/context/membership, classifies lower frontiers as stale, proves required-nullable zero/nonzero fields, requires the equal-frontier one-entry reconstruction case, otherwise requires a dense captured+1 through frontier tail, and binds the final entry's revision, operation ID, and next control exactly. Material digest recomputation is adapter-owned and injected as a success/failure boundary; generic recovery validation does not silently substitute BLAKE3 or the fixture SHA.

After material application, recovery stages received/material at R and control at R-1. It sends `recoveryApplied` only after exact control installation and releases the fence only after that proof is emitted. Request timeout is 300 s recovery time, control-install timeout is 30 s recovery time, and pacing is 16 ms recovery time.

`RecoveryLiveState` carries a fresh frontier and frame context into every
continuation after a deferred boundary and is never retained. Exact
`RecoveryFrontierStagingOutcome` reports whether the replica accepted revision
R. All timer transitions use the owning kernel scheduler and receive the exact
removed `ScheduledTimer`. Operational failures return `Ok(actions)` containing
all cancellations, terminal fence change, and exactly one shared terminal
effect; only disposed state, unknown injected timers, and impossible caller
phase misuse return `Err`. One transaction owns one fence and one kernel owns
one transaction per endpoint.

The corrected recovery signatures are frozen as:

```rust
start(request_id, captured, reason, scheduler) -> Result<Vec<RecoveryAction>, RecoveryError>
accept_bundle(bundle, live: RecoveryLiveState, scheduler) -> Result<Vec<RecoveryAction>, RecoveryError>
material_result(outcome, live: RecoveryLiveState, scheduler) -> Result<Vec<RecoveryAction>, RecoveryError>
recovered_frontier_staged(outcome: RecoveryFrontierStagingOutcome, live: RecoveryLiveState, scheduler) -> Result<Vec<RecoveryAction>, RecoveryError>
control_result(outcome, live: RecoveryLiveState, scheduler) -> Result<Vec<RecoveryAction>, RecoveryError>
timer_fired(fired: ScheduledTimer, live: RecoveryLiveState, scheduler) -> Result<Vec<RecoveryAction>, RecoveryError>
abort(reason, scheduler) -> Vec<RecoveryAction>
dispose(reason, scheduler) -> Vec<RecoveryAction>
```

The live state is owned call-scoped data and is never retained. `Staged` carries
the exact accepted revision; `Rejected` carries the adapter reason. A timer
continuation validates the complete removed registration before any mutation.

## Deterministic adapters

`Presenter` and `StorageAdapter` are synchronous environment boundaries. They retain no kernel callback.

Presentation identity is `(endpoint, eventId)`, not the numeric event ID alone.
`present`, `settle`, duplicate-completion injection, and authoritative live
queries are endpoint-qualified. Equal numeric event IDs may be live or settled
independently at both endpoints. `diagnostics_for(endpoint)` and the
endpoint-qualified pending/settled query methods are the live evidence. The
legacy aggregate `diagnostics()` ID sets are only a convenience projection:
they may collapse an equal ID from two endpoints and therefore must never be
used as a live-resource count. Settled IDs are tombstones, not live resources.

`InstantPresenter` settles immediately. `FaultPresenter` may hold, settle,
cancel, fail, reorder, or duplicate completion attempts by endpoint-qualified
presentation identity; it cannot mutate protocol state. `MemoryStorage`
returns explicit load/persist outcomes and applies a recovery update atomically
or fails without a partial write. Its injected atomic-write rejection is
one-shot, is consumed only by the next live atomic recovery write, and leaves
the complete value map unchanged. Synchronous request IDs may be reused after
`execute` returns because pending ownership ends before the result is exposed.

Every adapter exposes a live-resource snapshot and idempotent disposal.

## Kernel composition boundary

`ProtocolKernelConfig` selects exactly one endpoint role. The authority role receives `AuthorityLogConfig`, proposal-admission capacity, and immutable `AuthorityResolutionPlan` values that stand in for game mechanics not ported until M3+. The replica role receives `AuthorityReplicaConfig`, `ProposalLeaseConfig`, and `RecoveryTransactionConfig`. The config also receives immutable `ControlMenuPlan` values for fixture/game-owned command, replacement, and interaction labels; protocol code never invents game options. Each actionable menu maps every exact `MenuOptionId` to one opaque `MenuProposalPlan` fingerprint/payload. The authority resolves only an exact operation-ID/fingerprint pair to its prevalidated `AuthorityEntryDraft`; mismatches fail closed.

`KernelInput` has explicit raw-frame, opaque-proposal, material-result, and control-projection-result boundaries. `KernelEffect` has explicit send-proposal, apply-material, project-control, UI-intent, timer, presentation, storage, and terminal values. These are data, not callbacks. A successful raw-key menu transition may emit a `UiIntent`; campaign code cannot inject one as input.

`GameKernel::dispose` is idempotent, rejects later transitions, and releases every protocol and input resource. The initial M1 compatibility implementation already drains input-repeat timers; the G5 owner extends the same method to every protocol owner without changing its signature.

Input repeat uses the same scheduler allocation domain as protocol timers. The
router keeps no private timer counter; its scheduler-aware transitions return an
effect-facing view of commands already registered or cancelled in scheduler
state. Disposal cancels all owners before disposing the scheduler.

## Fault network

`FaultNetwork` transports raw existing frame values and opaque proposal envelopes between endpoint seats. It owns deterministic packet identities and an internal `u64` seed. It supports enqueue, deliver, drop, duplicate, delay, reorder, corrupt, disconnect, reconnect with a strictly newer connection generation, and endpoint suspend/resume. Frame corruption rejects opaque proposal packets instead of inventing a proposal wire format.

Corruption operates on the raw envelope so malformed known mechanical frames and unknown cosmetic types reach `FrameValidator`. Delivery never bypasses the receiving kernel's frame boundary. Packets retain their send generation; a packet from an old generation remains stale after reconnect. Equal-time delivery order is deterministic. The network never chooses protocol outcomes.

Every serialized diagnostic or pair-snapshot seed is the canonical unsigned
decimal string produced from that `u64`; it is never emitted as a JSON number.
This preserves all 64 seed bits across native, wasm32, JavaScript, and fixture
boundaries. Serialization and deserialization of `PairSnapshot.seed` apply the
same canonical rule; empty, signed, padded, exponential, whitespace-bearing,
overflowing, and numeric JSON forms fail closed.

The network RNG is the pinned `mulberry32` oracle. It truncates only the RNG
state to the low 32 seed bits (`seed >>> 0`), preserves the full `u64` seed in
diagnostics/snapshots, and samples inclusive actions as
`min + floor(next() * (max - min + 1))`. Each packet captures both source and
destination endpoint generations at enqueue, so either endpoint reconnect can
make it stale without changing its public wire shape. Diagnostic counters
remain `SafeU53` and deliberately saturate at
`SafeU53::MAX`. They are observational only: saturation cannot alter RNG state,
packet ordering, delivery, connection state, or any protocol outcome. Packet
IDs, queue-order IDs, deadlines, endpoint generations, and other mechanical
cursors do not saturate; overflow/exhaustion is an explicit fail-atomic error
that leaves RNG, queue, connection, and diagnostic state unchanged.

## Simulated pair and raw-input rule

`SimulatedPair` owns two independent `GameKernel` instances, per-seat keyboard-driver state, one `VirtualClock`, one `FaultNetwork`, one presenter, and one memory storage adapter. Neither kernel holds a reference to the other. They interact only through emitted effects consumed by the pair.

The public campaign surface contains only:

- `key_down`, `key_up`, `press`, `hold_for`, `blur`, and `focus` for either seat;
- virtual-time advancement;
- packet deliver/drop/duplicate/delay/reorder/corrupt;
- disconnect/reconnect and endpoint suspend/resume;
- presentation and storage outcomes;
- read-only snapshots, traces, digests, and live-resource evidence;
- teardown.

There is no public `select_command`, `choose_replacement`, `choose_option`, `set_cursor`, `submit_interaction`, or `open_menu`. Tests may not obtain mutable kernel, reducer, protocol-log, or menu handles.

The M1 `UiReducer` and `GameKernel::replace_menu` compatibility surfaces remain available for their pinned low-level M1 contract tests, but `SimulatedPair` exposes no reference—mutable or immutable—to either owned kernel or reducer. Calling those APIs on a separately constructed object cannot affect a campaign pair. The campaign API is therefore structurally limited to `PairOperation`'s raw-input/environment union.

Controls project into the M1 menu reducer at their exact owner/address. Command, replacement, and shared interaction decisions are produced only by raw physical input. Await opens a non-actionable waiting menu. Terminal opens symmetric terminal state and accepts no gameplay input. Menu generation changes on recovery; stale pre-recovery input cannot submit.

## Contract map, properties, campaigns, and parity

`rust/fixtures/v1/authority-v2-test-map.json` lists every one of the 29 pinned `test/node/authority-v2-*.test.ts` files. Each record contains the TypeScript source, Rust equivalent, parity fixture, semantic class, status, and documented reason for any non-portable browser-only boundary. The production 28-file contract and the one simulator/tool test remain visibly distinct.

Property and fault tests assert after every step:

- one global revision order;
- no duplicate material mutation;
- `received >= material >= control` as frontier progress, with material never before admission and control never before material;
- N+1 never executes while N is control-pending;
- proposal duplicate/conflict rules;
- menu seat/generation ownership;
- exact connection generation;
- fence-before-request and release-after-material/control;
- symmetric terminal;
- complete timer metadata;
- zero timers, leases, waits, retained entries, pending controls, packets, presentations, and storage requests after teardown.

The ten required campaigns use only the raw-input/environment surface and cover command lifecycle, delayed replacement, duplicate interaction retries, suspend/resume, reconnect with stable proposal identity, delayed material receipt, delayed control receipt, recovery with an open menu, stale old-menu input, and absolute safety terminal.

Native and wasm32/Node replay the same frozen traces. After every event they compare state, effects, menu, and live-resource digests and report the first divergent sequence with the deterministic seed and virtual time.

## Benchmarks and CI

The M2 benchmark manifest has four Rust-native scenarios:

- 1,000 input/menu transitions;
- 1,000 complete proposal/receipt cycles;
- 10,000 short deterministic fault schedules;
- one 100,000-step synthetic campaign.

The first accepted run reports measurements and runner metadata; it does not enforce a pre-existing numeric baseline. Only a later accepted artifact from the same scenario inputs and runner class enables the 25% regression threshold. The 10,000-schedule target is under 60 seconds on a standard GitHub-hosted Linux runner. Benchmark orchestration may measure wall time; kernel/protocol/simulator code may not read it or sleep. No Vite, Chromium, Phaser, or production bundle is part of M2 Rust measurement.

G4 integrates scheduler, validation, successor, authority log, replica, proposal, recovery, clock, network, and adapters in that order and passes the mapped production core independently. G5 then integrates kernel/menu effects, `SimulatedPair`, driver extensions, campaigns, native/Wasm parity, teardown, and benchmarks.

M2 is complete only at an exact integration SHA for which all six hosted Rust jobs are green, the benchmark job contains measured M2 evidence, the test map is complete, no production file changed, and source lock still names the immutable oracle.
