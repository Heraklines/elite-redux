# PokéRogue Redux Rust kernel M3 atomic transition contract

Status: normative for `GameConfig::Battle` once the G6 contract-freeze commit
is accepted.

## Transaction boundary

Every external `GameKernel::step` works on cloned deterministic state:

```rust
struct KernelTransaction {
    staged_game: GameRuntime,
    staged_protocol: ProtocolRuntime,
    staged_scheduler: KernelScheduler,
    staged_input: InputRouter,
    staged_ui: BattleUiProjection,
    staged_pending_presentations: PendingPresentations,
    staged_terminal: Option<TerminalState>,
    staged_effects: Vec<KernelEffect>,
}
```

Private caches may be present only when they are derived, validated, and
reconstructed from these values. No callback, clock, transport, filesystem,
browser handle, or mutable content value belongs to the transaction.

The live kernel is replaced only after the internal event queue is empty and
the complete staged state validates. Until then, revision IDs, RNG draws,
timer IDs, menus, receipts, presentation IDs, and effects are invisible.

## Authority TURN transaction

The exact production order is:

1. Clone deterministic kernel state.
2. Validate content capability, canonical before-state, command completeness,
   command fingerprints, and the three before digests.
3. Derive the exact TURN-result operation ID and resolve the turn against the
   staged clone and immutable `ContentPack` with that ID.
4. Build typed `BattleTurnMaterialV1` including content hash, before/after
   mechanical digests, commands, action order, mutations, presentation plan,
   RNG before/after, complete resolver before/after states, outcome,
   authoritative pre-projection menu allocator high-water marks, and next
   control.
5. Canonically serialize the typed material and compute the existing Authority
   V2 compatible material digest.
6. Deserialize those bytes through the production material decoder.
7. Apply the decoded material to the authority's staged game through the
   common production material implementation. The authority-only entry may
   reuse the reducer's sealed digest evidence only after exact equality of the
   decoded before/after states and both stated digests; wire-decoded paths
   independently recompute them.
8. Require resolver candidate state and digest to equal the material-applied
   authority state and digest.
9. Prepare the AuthorityLog commit on the staged protocol state.
10. Install the exact logical next control, per-seat menu allocator high-water
    marks, and presentation barrier in staged game/UI state using the prepared
    revision and operation identity.
11. Allocate every required timer in staged allocators. Derive each
    presentation ID from the material operation ID plus its zero-based plan
    sequence and validate that derivation; M3 has no presentation-ID allocator.
12. Publish the prepared log commit on the staged protocol state and append
    its delivery/receipt/environment effects in returned order.
13. Validate every deterministic subsystem and all cross-subsystem identities.
14. Swap staged state into the live kernel and return staged effects.

Any error discards steps 1–13. `AuthorityLog::prepare_commit` and
`publish_prepared` run only on the cloned protocol runtime; no prepared token
is allowed to survive a failed external step.

## Authority REPLACEMENT transaction

REPLACEMENT uses the same fourteen-step path and the same clone-and-swap
boundary, with these exact substitutions:

1. Resolve the proposal's global `FaintOccurrenceId` to the stored head and
   validate its source epoch, wave, resolved turn, per-turn occurrence, actor,
   owner, field slot, current `ReplacementProgress`, projected replacement
   control tuple, and admitted
   `BattleReplacementProposalV1` when the selection is human-supplied.
2. For an owner with no legal replacement, construct
   `ReplacementSelection::NoLegalReplacement` internally; no proposal or menu
   fallback is accepted.
3. Derive the pinned REPLACEMENT operation ID from the stored occurrence's
   `FaintSource.turn_occurrence`, never its global diagnostic ID, and call
   `resolve_replacement` with that ID. The resolver consumes no RNG.
4. Build, serialize, deserialize, and apply
   `BattleReplacementMaterialV1` through the common production replacement
   applier.
5. Require resolver candidate == authority material-applied result, prepare
   the AuthorityLog entry, install the exact projected next control and
   presentation barrier, allocate required IDs/timers, publish the prepared
   entry, validate, and swap exactly as TURN does. Publication therefore occurs
   after staged control/barrier installation and allocation, never before it.

TURN and REPLACEMENT differ only in their typed resolver/material/applier and
operation grammar. Neither may bypass publication, common application, control
installation, or final validation.

## Replica material transaction

The replica never runs `resolve_turn` or `resolve_replacement` for an authority
entry. Its exact path is:

1. Clone deterministic kernel state.
2. Structurally and semantically admit the exact next Authority V2 entry.
3. Select the entry's closed material kind and canonically decode exactly one
   `BattleTurnMaterialV1` or `BattleReplacementMaterialV1`.
4. Verify schema version, oracle/content identity, material digest, battle/wave/
   turn/operation identity, and independently require the digest of the
   material's own complete `before_state` to equal its stated `before_digest`.
   Only after that self-check may the replica reconcile a compatible partial
   TURN command frontier to that complete state (REPLACEMENT requires exact
   local before-state equality) and compare the local mechanical digest.
5. Apply through the same kind-specific production material applier used by
   the authority, with the endpoint's local seat and current per-seat menu
   allocator context.
6. Validate the complete after-state, after RNG state, after digest, mutation
   evidence, and stated outcome/control relationship.
7. Install the exact logical control and presentation barrier.
8. Stage material/control receipts and required timers in mechanical order.
9. Validate every deterministic subsystem.
10. Swap staged state into the live kernel and return staged effects.

An exact duplicate of an already-applied revision is idempotent. A conflicting
duplicate, future gap, malformed material, or digest mismatch follows
`m3-error-policy.md` and never partially replaces state.

## One material applier

There is exactly one production implementation for TURN material application
and one for REPLACEMENT material application. Public/replica TURN calls and the
sealed reducer-issued authority call enter the same implementation with typed
current state, typed decoded material, and immutable content, and return a fully
validated new state/evidence result without mutating their input. Only the
sealed authority call may reuse already-proved state digests.

Both public appliers are owned by `er-game`. They invoke `er-battle`'s pure
mechanical material/evidence validator, then invoke the one `er-game`
`BattleNextDecision`-to-`BattleControlPlan` projector with the staged per-seat
menu allocators and require exact equality with material. This preserves the
crate direction (`er-game` depends on `er-battle`) and prevents either host or
guest from using a second control builder.

The following equality is mandatory in tests and debug evidence:

```text
resolver candidate
== authority serialize -> deserialize -> apply result
== replica deserialize -> apply result
```

The authority retains the candidate transition inside opaque digest evidence,
but may not adopt it directly. Test code may not provide an alternate applier
or construct a digest-skip capability.

## Fail-closed recovery and terminal transitions

Discarding a failed material transaction and entering recovery/terminal are
two ordered atomic operations inside the same external step:

1. discard the material/application clone completely;
2. start again from the unchanged pre-input live snapshot;
3. apply only the exact `m3-error-policy.md` recovery or shared-terminal
   outcome on a fresh clone;
4. validate and swap that outcome atomically.

The second operation may change protocol recovery state/fences/timers or the
shared terminal state and may emit their prescribed external effects. It may
not change canonical mechanics, RNG, command/faint state, installed material,
or pretend a rejected revision committed. If the required fail-closed outcome
itself cannot validate or allocate, the kernel returns a fatal invariant error
without swapping either clone.

## Failure injection acceptance

The hosted M3 gate injects a deterministic failure at each stage:

- battle resolution;
- material encoding;
- material decoding/application;
- log preparation;
- log publication;
- scheduler allocation;
- logical control installation;
- final state validation.

These injections target local authority preparation/application stages whose
error-table outcome is `AtomicTransitionError`, not an authenticated malformed
replica entry. For every injection the gate compares pre/post mechanical state,
RNG, protocol revision/frontiers, scheduler allocator/timers, input state,
UI/menu instance, pending presentations, terminal state, and emitted effects.
Every value must be unchanged and no external effect may escape. Separate
replica tests require the exact recovery/terminal transition above while
proving mechanical state and RNG remain unchanged.

Presentation settlement occurs after the canonical transaction. A later
renderer failure does not roll back material; it follows the separate blocked
input and shared-terminal-only policy in `m3-presentation-control.md`.
