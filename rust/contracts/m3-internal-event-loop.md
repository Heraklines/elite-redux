# PokéRogue Redux Rust kernel M3 internal event loop

Status: normative for `GameConfig::Battle` once the G6 contract-freeze commit
is accepted.

## One external input, one causal transaction

`GameKernel::step` accepts one environment-originated input, processes all
deterministic causal work in FIFO order to quiescence, and then returns the
ordered external effects. Internal decisions never cross into Phaser, Wasm
glue, `er-sim`, or a test harness.

The M3 external categories are closed:

- raw physical input;
- one delivered transport packet (an existing Authority V2 frame or opaque
  command-proposal envelope);
- one fired timer identified by its exact scheduler registration;
- one presentation settlement outcome;
- one transport/generation change;
- one storage result;
- endpoint suspend;
- endpoint resume.

The serialized compatibility variants `MaterialApplied` and
`ControlProjected` are rejected by Battle mode. A semantic `UiIntent` is never
a `KernelInput`. M2 compatibility may expose those old boundaries only through
`er-testkit::ProtocolFixtureHarness`.

## Internal queue

The production kernel owns a private `VecDeque<InternalEvent>`. Its semantic
variants are frozen as:

```text
Button
Ui
Game
Protocol
BattleResolved
AuthorityEntryReady
MaterialInstalled
ControlInstalled
```

The payload ownership is frozen as:

```text
Button: endpoint seat, captured MenuInstanceId, typed ButtonEvent
Ui: endpoint seat, captured MenuInstanceId, private typed UiIntent
Game: private typed GameIntent plus causal operation/control identity
Protocol: admitted typed protocol action and exact frame/revision identity
BattleResolved: complete PreparedBattleResolution from er-game
AuthorityEntryReady: canonical material bytes, material digest, prepared entry
MaterialInstalled: revision, material kind/operation, common-applier result
ControlInstalled: revision, complete BattleControlPlan, presentation barrier
```

The private prepared payload is closed as:

```rust
enum PreparedBattleResolution {
    Turn {
        digest_evidence: TurnDigestEvidence,
        material_operation_id: OperationId,
        next_control: BattleControlPlan,
    },
    Replacement {
        transition: BattleReplacementTransition,
        material_operation_id: OperationId,
        next_control: BattleControlPlan,
    },
}
```

`TurnDigestEvidence` owns the exact finalized transition, is opaque outside
`er-game`, is created only after final frontier projection, and is never
serialized. `GameRuntime` retains it inside a sealed `PreparedAuthorityTurn`;
other crates receive immutable transition/control/admission access only. The
authority material path may reuse reducer-owned before/after digest work only
after decoded material exactly equals both evidenced state/digest pairs. Every
wire-decoded replica, recovery, local, public, and ordinary trusted material
path retains independent material digest validation.

The `Game` reducer derives and validates the exact material operation ID,
invokes the pure `er-battle` resolver with that ID, then uses the one `er-game`
control-projector to materialize `next_control` from the returned
`BattleNextDecision` and staged per-seat menu allocators. The
`BattleResolved` reducer serializes the matching TURN or REPLACEMENT material;
it does not invent mechanics or a second control projection.

These private payloads contain no callback or `serde_json::Value`; the material
bytes are the one canonical encoded typed payload. Workers may add private
bookkeeping fields only through a contract change request when they alter
observable ordering, identity, snapshots, or effects.

Processing rules:

1. Translate the external input into zero or more internal events.
2. Push them in source order.
3. Pop from the front.
4. Apply exactly one private reducer.
5. Append resulting internal events to the back in returned order.
6. Stage external effects in returned order.
7. Continue until the queue is empty.
8. Validate the complete staged kernel, then swap it into the live kernel and
   return the staged effects.

Reducers do not recursively invoke one another. They return values for the
queue. This prevents hidden call-stack ordering from becoming protocol or
mechanical truth.

This FIFO is the outer kernel causal queue. The resolver's oracle-compatible
dynamic battle agenda is a private value processed entirely inside one `Game`
or `BattleResolved` reduction. It performs its own documented reorder-before-
pop stages and emits ordered action/mutation evidence; kernel FIFO events never
interleave between battle-agenda pops. FIFO therefore does not flatten or
replace the staged ordering contract in `m3-action-order-oracle.md`.

## Fixed event budget

One external step may process at most **4,096 internal events**, including the
initial translated events. Attempting to process event 4,097 is
`KernelInvariantError::InternalEventBudgetExceeded`.

The failure records:

- external trace sequence and input;
- deterministic seed and virtual time supplied by the caller trace;
- every processed internal event kind in order;
- the remaining FIFO queue kinds;
- mechanical, kernel-determinism, and presentation-plan digests from before
  the step.

The staged kernel and every staged external effect are discarded. Increasing
the budget is a versioned contract change, not a worker-local fix.

## Required causal chains

Local human command:

```text
RawInput -> Button -> Ui -> Game -> command admission
```

Authority resolution after the final command:

```text
Game -> BattleResolved -> AuthorityEntryReady -> MaterialInstalled
     -> ControlInstalled -> external transport/presentation effects
```

Replica entry:

```text
transport packet -> Protocol -> common typed material applier
                 -> MaterialInstalled -> ControlInstalled
                 -> ordered receipts/presentation effects
```

Authority replacement, including automatic `NoLegalReplacement`:

```text
Ui -> Game (or deterministic no-legal Game intent)
   -> BattleResolved::Replacement -> AuthorityEntryReady
   -> MaterialInstalled -> ControlInstalled
   -> external transport/presentation effects
```

A human-selected replacement reaches `Game` only after local/remote proposal
admission. `NoLegalReplacement` is generated internally from the stored
occurrence and capability-validated party state and never arrives as external
semantic input.

The authority's own command uses the same admission/fingerprint reducer as a
remote command; only its delivery path is internal. The authority and replica
use the same serialized material decoder/validator/applier.

## External-effect boundary

Only environment work leaves the queue:

- send an existing frame or opaque proposal;
- schedule/cancel a timer already owned by the kernel scheduler;
- immutable UI projection observation;
- immutable presentation request;
- explicit storage request;
- shared terminal notification;
- optional diagnostic trace observation.

Battle mode never emits `ApplyAuthorityMaterial`,
`ProjectAuthorityControl`, or a causal `UiIntent` effect. Logical UI state,
material application, control installation, receipt staging, and battle
resolution are already complete before effects are exposed.
