# M6 state, material, and snapshot V5

## Version roots

- Canonical game/battle/Pokémon state: V4.
- Mechanic-state store: V2.
- Battle turn/replacement material contract: V4.
- Restorable endpoint/pair snapshot: V5.
- Kernel trace: V5.
- Mechanical/kernel/pair digest domains: V4.

Older values are accepted only by explicit versioned migration readers.

## GameStateV4

V4 retains M5 ownership and stable IDs. It adds complete typed state required by the frozen M6 behavior catalog. Every state collection has a canonical order, uniqueness rule, capacity limit, and owner/target validation.

`MechanicStateStoreV2` includes ordered mechanic instances, held items, major status substate, volatile/battler/arena/positional tags, field state, scheduled events, action locks, proxy HP, guard chains, redirection/trap state, form/transform overlays, copied/called move state, damage counters, and source/behavior-unit identity.

Every instance records stable ID, source, behavior unit, owner/target scope, creation ordinal, optional duration/counters, and one closed typed payload. No callback, TypeScript class name, or untyped JSON is canonical.

## V3-to-V4 migration

Migration validates V3 source state and V2 content, builds a V4 candidate against V3 content, preserves stable IDs and creation order, initializes only proven-neutral new fields, binds all existing instances to known source/behavior identities, validates V4 against V3 content, and emits before/after digest evidence. Any loss or unknown identity aborts atomically.

Round-trip and continuation tests cover empty and populated mechanic state, held items, active statuses, open command collection, pending replacement, committed material, recovery, and pending presentation.

## Material V4

Turn and replacement material V4 carries:

- schema/oracle/content/semantic hashes;
- operation, battle, wave and turn identity;
- mechanical before/after digests;
- canonical commands or replacements;
- action/source/behavior-unit order evidence;
- typed mutations and mechanic-instance transitions;
- scheduled-event transitions;
- RNG site/draw audit and before/after frontier;
- complete validated after-state;
- presentation plan and digest;
- exact next control.

Authority serializes then applies V4 through the same production decoder/applier used by replicas. Duplicate material is idempotent only for identical operation identity, canonical bytes, and frontier. Corruption or drift fails closed.

## RestorableKernelSnapshotV5

V5 contains:

- complete input-router focus, held/suppressed keys, locks, repeat timers and menu-instance ownership;
- UI/menu stack and actionable barriers;
- scheduler IDs, timers, owners, deadlines, reasons and pause state;
- protocol log, frontiers, receipts, leases, admissions, recovery and connection generations;
- GameStateV4, prepared-content identity, pending command/replacement collection, RNG and pending transaction metadata;
- pending presentations and terminal state.

A public snapshot is quiescent. A prepared transaction may be represented only as an explicitly serializable pre-publication transaction whose complete replay contract is frozen; otherwise snapshot creation rejects it. M6 retains M5's stricter default: no live prepared transaction escapes.

## RestorablePairSnapshotV5

Pair V5 adds host/guest endpoint snapshots, virtual time/clock, exact queued packet bodies and deadlines, presenter/storage state, fault script and RNG, transport generations, and sequence. Restoration validates both endpoint frontiers and network ownership before exposure.

## Digests

Mechanical digest V4 includes canonical game/battle/mechanic state, RNG, pending command/replacement state, scheduled events, and outcome.

Kernel determinism digest V4 adds protocol, input, UI, scheduler, pending presentation IDs, prepared-content identity, recovery and terminal state.

Pair determinism digest V4 adds both endpoint digests, exact network/clock/fault/presenter/storage state.

Presentation-plan digest remains separate and covers ordered cues plus blocking policy.

## Atomicity and restore proof

For content load, migration, battle resolution, material encode/apply, protocol publication, control installation, scheduler allocation and final validation:

```text
clone deterministic roots
→ stage complete operation
→ validate candidate and evidence
→ swap once
→ emit external effects
```

Injected failure leaves state, RNG, revisions, timers, UI and effects unchanged.

Required restore boundaries include held action across a submenu, one doubles command collected, admitted proposal, delayed material, installed control behind presentation, open replacement, scheduled event pending, recovery fence, terminal-before-teardown, and V3-to-V4 migration. Original and restored continuations must match every later effect and digest on native and Wasm.
