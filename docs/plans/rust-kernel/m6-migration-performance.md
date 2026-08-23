# M6 state, material, snapshot, and performance audit

## Existing M5 roots

At M5 final SHA `200caaee1697fe40a293f0a5da76af8b11f3cea9`:

- `rust/crates/er-content/src/m5_pack.rs` exposes `BattleContentPackV2` and schema version 2.
- `rust/crates/er-state/src/migration_v3.rs` exposes `GameStateV3`.
- `rust/crates/er-state/src/mechanic_state.rs` exposes `MechanicStateStoreV1` and ordered held-item state.
- `rust/crates/er-game/src/material.rs` exposes turn and replacement material V1.
- `rust/crates/er-kernel/src/snapshot_v4.rs` exposes restorable kernel snapshot and trace V4.
- `rust/crates/er-kernel/src/snapshot.rs` forbids a live prepared transaction in a public snapshot.
- `rust/crates/er-battle/src/mechanics_executor.rs`, `mechanics_query.rs`, and `mechanics_mutation.rs` are the prepared/direct execution parity surface.

M6 does not widen these serialized types in place.

## M6 version cut

The G21 contract freeze reserves:

- `BattleContentPackV3` / content schema 3;
- `MechanicsIrV2` / program schema 2;
- `GameStateV4` / game-state schema 4;
- `MechanicStateStoreV2`;
- turn and replacement material V2;
- restorable kernel and pair snapshot V5;
- kernel trace V5;
- benchmark manifest V1 for the M6 workload family.

Legacy readers exist only in explicit migration adapters. Production execution uses the newest typed roots after initialization.

## Migration contract

`GameStateV3 + BattleContentPackV3 -> GameStateV4` must:

1. validate the complete V3 source state and its content hash;
2. map every existing mechanic instance and held item without changing stable identity or creation ordinal;
3. initialize only fields whose M6 default is proven mechanically neutral;
4. bind source identities and behavior-unit identities against the V3 pack;
5. validate the complete V4 candidate against the V3 and V4 packs;
6. emit typed migration evidence with before/after digests and counts;
7. swap atomically.

Unknown source identity, missing behavior unit, lossy value conversion, or unsupported live mechanic fails migration. It never falls back to empty state or `NONE`.

## Material and snapshot contract

Material carries the V4 mechanical after-state or a typed mutation program whose application proves the same digest. Host and replica use the same serialized material applier. Version, oracle SHA, content hash, before digest, behavior-unit identity, and RNG frontier are checked before mutation.

Snapshot V5 contains all V4 game/mechanic state, prepared content identity, protocol state, input/router locks, scheduler state, pending presentations, network packet bodies/deadlines, fault state, and virtual time. Public snapshots remain quiescent: no uncommitted prepared transaction may escape.

Restore tests cover M5-to-M6 migration and M6-native continuation at held-input, admitted-proposal, delayed-material, replacement, recovery, and presentation barriers.

## Atomicity

Content compilation, migration, material application, control installation, and scheduler allocation are staged on cloned deterministic state. Any failure leaves live state, RNG, revisions, timers, UI, and external effects unchanged.

## Performance evidence

M6 records separately:

- static catalog parse;
- runtime oracle initialization/reflection;
- content compile/load;
- prepared index construction;
- M5-to-M6 migration;
- direct query and mutation execution;
- full turn/battle/campaign execution;
- snapshot serialize/restore;
- native/Wasm parity replay;
- peak RSS and output sizes.

The accepted M5 baseline remains the comparison source. M6 creates a new exact-SHA baseline after G25; regressions above 25% require an explicit benchmark-contract revision. Correctness gates cannot be weakened to meet the ceiling.
