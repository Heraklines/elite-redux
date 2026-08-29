# M7.1 snapshot, trace, save, replay, and session audit

## Frozen M7 evidence

M7 endpoint state is `er_kernel::snapshot_v6::RestorableKernelSnapshotV6`. It already retains content identity, canonical game state, input router, pressed keys, scheduler, protocol owner snapshot, pending presentation, prepared transactions, replay sequence, and terminal state. `GameKernelV6::from_snapshot` validates before reconstruction.

M7 pair state remains owned by `er-sim`: host/guest endpoint snapshots, virtual clock, fault network with packet bodies/deadlines, presenter, storage, fault script/RNG, transport generations, and resource diagnostics. Existing M3/M4 pair snapshots and continuation tests are reusable implementation evidence; M7.1 wraps rather than copies their mechanics.

`er-save` owns canonical `GameSaveV1`, raw external-event `GameReplayV1`, first-digest-divergence replay, and exact save checksums. Oracle replay trace/recorder state is separate from mechanical save bytes.

## Gaps frozen for M7.1

* no execution identity separating mechanical compatibility from build/adapters;
* no V7 wrapper retaining developer lineage/evidence frontier;
* no one public solo/pair session enum;
* no bounded checkpoint index, seek, fork lineage, or branch comparison;
* no capsule container or exact failure oracle;
* no future model/platform/render trace inputs;
* no public artifact registry;
* no complete pair session facade over existing clock/network/presenter/storage machinery.

## V7 migration

V6 bytes remain unchanged. Migration validates V6, embeds it unchanged, supplies caller-provided execution identity, creates a root lineage, sets external sequence/virtual time from the owning environment, and records no causal frontier when evidence is absent. Reverse projection to V6 is lossless when no V7-only external event has been consumed.

## Session invariants

Solo owns one `GameEnvironment`. Pair owns exactly two environments, one authority and one replica, plus one virtual clock/network/presenter/storage/fault machine. Prepared content is shared immutably. Checkpoint equality requires mechanical identity, session root, sequence, snapshot digest, protocol revision/frontier, virtual time, and transport generation. Restore and fork validate before replacing or exposing mutable state.

Seek restores the nearest checkpoint not after the target and replays every external event with digest verification. Forks share immutable prefix/content and own mutable state/tail. Equal future input must remain equal.

## Required tests

* V6→V7→V6 losslessness;
* held-key, timer, network packet, material, control, recovery, presentation, and terminal continuation;
* save bytes unchanged under all evidence profiles;
* replay first divergence unchanged;
* solo and pair same-input fork equality;
* pair fork preserves clock/network/storage/presenter/generations;
* quota eviction retains pinned checkpoints;
* teardown reaches zero owned resources.
