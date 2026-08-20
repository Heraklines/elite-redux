# M4 snapshot and trace contract

## Version roots

M4 introduces `RestorableKernelSnapshotV3`, `RestorablePairSnapshotV3`, and `KernelTraceV3`. V2 roots remain immutable migration inputs. Mixed root or nested versions are rejected.

## Endpoint snapshot

V3 contains every deterministic owner required to resume without inference:

- input focus, physical keys, suppressed keys, button locks, repeat timers, and bound menu instances;
- complete UI state, control plan, allocator state, and presentation barriers;
- scheduler IDs, registered timers, remaining durations, owners, addresses, reasons, time classes, and pause reasons;
- protocol log, frontiers, retained entries, receipts, admissions, leases, recovery transaction/fence, and connection generations;
- `GameState` V2, progression queue, active run surface, battle, all RNG states/audits, and counters;
- prepared but unpublished atomic transaction, including a transaction-local encounter plan when capture occurs after generation and before it is folded into material;
- pending presentations and terminal state.

A snapshot contains no callbacks, threads, wall-clock instants, filesystem handles, network handles, browser objects, or renderer objects.

## Pair snapshot

V3 additionally contains:

- host and guest endpoint snapshots;
- virtual clock and sequence;
- complete queued packet bodies, source/destination, delivery deadlines, generations, and fault dispositions;
- fault script cursor and fault RNG state;
- presenter pending/settled state;
- storage request/result state.

Counts or diagnostics cannot replace actual queued bodies or deadlines.

## Restoration protocol

`from_snapshot` validates schema and both content hashes before allocating live resources. It constructs a fresh owner graph, rebinds no external callback, captures a second snapshot, and requires canonical equality with the input before publication. Failure returns an error and leaks no resource.

After restore, identical external inputs and fault schedule produce identical:

- mechanical digest;
- kernel determinism digest;
- pair determinism digest;
- presentation-plan digest;
- M4 surface digest;
- RNG audits;
- external effect sequence.

Required boundaries include held input during surface replacement, progression partially complete, reroll locks active, purchase target overlay, Crossroads open, biome routes committed, encounter prepared before battle start, wave material delayed, battle start committed, presentation blocked, recovery fenced, and terminal before teardown.

## Trace V3

Every external event records sequence, virtual time, source, input, expected pre-digests, produced effects, post-digests, RNG audit delta, authority revision, active operation/control/menu identities, live-resource census, and optional causal first-divergence evidence. Semantic test shortcuts are not trace events.

A first mismatch report names the subsystem and earliest ordered difference. RNG diagnostics retain the M3 exact before/after fingerprints; surface diagnostics name surface kind/ID, option ID, action ordinal, owner, price/target when applicable, and expected/actual surface digest.

## Digest separation

- `MechanicalStateDigestV2`: complete canonical game/run/battle state, all mechanics RNG, progression, surfaces, encounter, counters, and outcome.
- `KernelDeterminismDigestV2`: mechanical state plus protocol, input, UI, scheduler, pending presentation IDs, terminal, and prepared transaction.
- `PairDeterminismDigestV2`: both endpoints plus virtual clock, network, fault, presenter, and storage state.
- `PresentationPlanDigestV1`: ordered presentation events and blocking policies.
- `SurfaceDigestV1`: ordered logical options/stock, stable IDs, enabled/sold/lock state, prices, targets, navigation graph, owner, operation identity, ordinal, and allocator state.

Renderer geometry, localized strings, and transient animation pixels are excluded.

## Teardown

Every restored or uninterrupted campaign must end with zero timers, waits, proposals, deliveries, retained entries, controls, menus, pending presentations, progression tasks, active surfaces, prepared encounter transactions, battle collectors, replacement queues, recovery owners, network packets, presenter work, and storage work.