# M5 state, material, snapshot, and trace

## Canonical state V3

V3 preserves V2 ownership and adds `MechanicStateStoreV1`.

```rust
pub struct MechanicStateStoreV1 {
    pub schema_version: u32,
    pub next_instance_id: MechanicInstanceId,
    pub next_creation_ordinal: SafeU53,
    pub instances: Vec<MechanicInstanceStateV1>,
}

pub struct MechanicInstanceStateV1 {
    pub address: MechanicAddress,
    pub program_id: MechanicsProgramId,
    pub owner: MechanicScope,
    pub stored_target: Option<MechanicScope>,
    pub creation_ordinal: SafeU53,
    pub remaining_turns: Option<u16>,
    pub counters: Vec<MechanicCounter>,
    pub payload: MechanicStatePayload,
}
```

Instances are sorted by canonical address and unique. Counters are sorted by closed `MechanicCounterKind` and unique. Payload is a closed enum; it is never JSON value, string-keyed arbitrary data, or opaque bytes.

`PokemonStateV3` adds held-item instances and Pokémon-scoped mechanics. `BattleStateV3` adds battle/side/field mechanics and program/content identity. `GameStateV3` carries V2 run state migrated to `RunContentPackV2` identity and the V3 battle.

## Migration

`migrate_game_v2_to_v3` accepts validated V2 state plus validated M4 and M5 packs. It maps every selected V2 status, arena condition, held/run modifier, and battle field into explicit V3 representations. It then validates V3 and returns migration evidence.

Migration fails on unknown schema, content hash mismatch, unsupported reachable content, absent program, duplicate mechanic address, counter overflow, invalid duration, or any V2 state without an exact mapping. It consumes no RNG and does not mutate input.

## Material V3

Turn and replacement material add:

- BattleContentPackV2 hash and mechanics versions;
- V3 before/after mechanical digests;
- ordered mechanic source evidence;
- query evidence;
- mechanic mutations and instance lifecycle evidence;
- RNG audit;
- V3 after-state;
- presentation-plan digest and exact next control.

Authority and replica canonicalize, serialize, deserialize, and apply identical bytes. Candidate after-state must equal authority-applied state, which must equal replica-applied state. Duplicate application is idempotent; same identity with different bytes fails closed.

## Snapshot V4

`RestorableKernelSnapshotV4` includes all V3 endpoint state plus:

- battle/run pack hashes and mechanics versions;
- pending internal mechanics events and transaction-free prepared material, if any;
- input router, menu stack, locks and repeat ownership;
- scheduler timers and pause reasons;
- protocol logs, leases, stages, retained entries and recovery fences;
- pending presentations and input barriers;
- terminal and teardown state.

`RestorablePairSnapshotV4` includes both endpoint snapshots, exact queued packet bodies/deadlines/dispositions, virtual clock, fault script/RNG, presenter, storage, and replay sequence.

A snapshot never stores a live content pointer. Restoration requires caller-supplied validated packs whose hashes match the snapshot.

## Trace V4

Every external input and returned effect records:

- mechanical digest V3;
- kernel determinism digest V3;
- presentation-plan digest;
- pair determinism digest V3 where applicable;
- ordered mechanics evidence digest;
- RNG audit digest;
- live resource counts.

First-divergence reports identify event sequence and the first differing source, query, mutation, RNG draw, presentation cue, or state path. A final digest mismatch without first-divergence detail fails the diagnostic contract.

## Restoration boundaries

Native and Wasm continuation parity is required with a query in progress before commit, mechanic instance creation/removal staged, multi-hit counter active, held item pending consumption, weather/terrain pending lapse, replacement open, TURN material delayed, recovery fence held, presentation blocked, and terminal teardown pending.
