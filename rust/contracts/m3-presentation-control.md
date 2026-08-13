# PokéRogue Redux Rust kernel M3 presentation/control contract

Status: normative for `GameConfig::Battle` once the G6 contract-freeze commit
is accepted.

Canonical mechanics, logical control, and renderer presentation are distinct
state machines. Presentation is never authority for a revision, material
application, control identity, or protocol retirement.

## Required order

For an accepted TURN or REPLACEMENT entry:

```text
typed material applied
-> exact logical BattleControl installed
-> replica control frontier may advance and controlInstalled receipt may stage
-> exact local BattleUiProjection for that control exists
-> ordered presentation requests are emitted
-> blocking presentation barrier settles
-> the already-installed menu becomes actionable
```

`controlInstalled` means that the exact stated logical control exists in Rust.
It does not mean an animation completed. Conversely, a settled animation never
authorizes a control or retires protocol truth.

## Typed policy

Every `BattlePresentationEvent` has a stable event ID, stable Pokémon/field
identities, a closed event kind, and:

```rust
pub enum PresentationBlockingPolicy {
    NonBlocking,
    BlocksHumanInput,
}

pub enum PresentationSkipPolicy {
    Forbidden,
    Allowed,
}

pub enum PresentationSettlementOutcome {
    Settled,
    IntentionallySkipped,
    Failed { reason: String },
}
```

The event ID is the causal TURN/REPLACEMENT `OperationId` plus the zero-based
event position in the ordered plan. It is not allocated from mechanical state.

The ordered plan and both policies are included in
`PresentationPlanDigest`. Renderer-only geometry/text is not canonical battle
state and may not alter the plan digest.

When a logical control is installed, all `BlocksHumanInput` events from its
causal presentation plan become an exact barrier set keyed by event ID. The UI
is actionable only when:

- the control belongs to the local human seat;
- the kernel is not terminal, suspended, or recovery-fenced;
- the input router is focused for gameplay;
- the barrier set is empty.

Nonblocking events never enter the barrier set.

## Settlement outcomes

`Settled`:

- require the exact pending `(endpoint, event_id)`;
- record settlement once;
- remove that event from the barrier;
- make the menu actionable only when every other condition is satisfied.

`IntentionallySkipped`:

- require `PresentationSkipPolicy::Allowed` for that exact event;
- record the intentional skip distinctly from rendering success;
- clear its barrier exactly as `Settled` does;
- reject an unauthorized skip without unlocking input.

`Failed`:

- keep already-committed canonical state, RNG, revision, and logical control;
- keep human input blocked;
- record the exact failed event and renderer diagnostic;
- enter the M3 shared terminal reason `M3_PRESENTATION_FAILED` symmetrically.

M3 does not implement a second renderer-recovery protocol, so shared terminal
is the one frozen failure outcome. A later milestone may version this policy.
Failure never pretends the event rendered and never rolls back battle material.

Duplicate settlement for an already-settled identity is an idempotent
diagnostic duplicate. A conflicting later outcome is rejected and cannot
change actionability.

## Presentation plan requirements

The supported M3 slice has closed events for:

- move used;
- ability activated;
- HP changed;
- status applied/changed;
- stat stage changed;
- switched;
- fainted;
- battle won;
- battle lost.

Events carry typed stable IDs and values; no `serde_json::Value`, Phaser object,
callback, text script, or mutable actor reference is allowed in production
event payloads. Events cannot mutate mechanics. Their order must match the
oracle fixture even when the final mechanical state would be the same.

## Snapshot and teardown

Restorable snapshots include the complete ordered presentation plan, exact
pending event identities, policies, outcomes/tombstones needed for idempotence,
and the control actionability barrier. Restoration during a pending barrier
must continue identically.

A transport disconnect, reconnect, or authenticated generation rebind does not
cancel or replace the local presentation epoch. Its exact plans, pending event
identities, settled outcomes, presenter requests, and protocol revision
correlation survive the rebind. The recovery fence controls actionability until
the new generation is reconciled; only typed settlement or terminal teardown
retires presentation work.

Teardown cancels every live presentation and clears every barrier while
retaining no live event. Settled tombstones are diagnostic history and are not
counted as live resources.
