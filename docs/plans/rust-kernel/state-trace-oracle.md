# Rust kernel state and trace oracle

This is the PokéRogue Redux Wave 0 state inventory for task M0-0D. It maps the current Redux/Phaser
boundaries to a future deterministic Rust kernel; it does not introduce a production
wire contract or change runtime code.

| item | value |
| --- | --- |
| project | PokéRogue Redux |
| legacy identifier policy | Elite Redux is a legacy source/path/protocol identifier only |
| schema | `schemas/kernel/source/state-fields-v1.json` |
| inventory schema version | `1` |
| oracle game SHA | `3b534099919efae827019d4a3f3c4ab0ecd6d67b` |
| protocol | `er-coop-47` |
| source branch | `wrk/rk-m0-state-inventory-v2` |
| scope | replay, checkpoints, battle-engine state, save/snapshot fields, timers, digests, globals, future layers |

The JSON is the machine-readable source for the field inventory. Every covered field
record carries declaration/observed presence (`required` or `optional`), a `nullable`
bit, source citations, producer, consumer, timer owner, digest treatment, globals, and
future layer. Arrays are kept in deterministic declaration or source order.

## Boundary summary

```text
SessionSaveData / ER substrates ──save/load──> run state and saveDataDigest
                                                │
ReplayTrace ──ordered input + optional window checkpoint──> replay launcher
                                                │
Host battle engine ──checkpoint/full/authoritative carrier──> guest apply
                                                │
                                      checksum canonical preimage
                                                │
Phaser/browser handles <──────── presentation adapter output
```

The host engine is the mechanical authority in the current co-op path. The guest
applies host-authored state and may rebuild presentation, but the Phaser objects are
not themselves canonical state. The capture/apply/hash registry makes this distinction
explicit in `src/data/elite-redux/coop/coop-replication-contract.ts#L8-L31` and
`src/data/elite-redux/coop/coop-replication-contract.ts#L73-L268`.

## ReplayTrace coverage

`ReplayTrace` version 2 accepts versions 1 and 2
(`src/data/elite-redux/replay-trace.ts#L49-L56`). Its required top-level fields are
`version`, `seed`, `gameModeId`, `difficulty`, `challenges`, `roster`, and `events`;
`coop`, `endState`, and `checkpoint` are optional
(`src/data/elite-redux/replay-trace.ts#L214-L244`). The exact field records are in
`replay_trace.types` in the JSON. `gameModeId` is the numeric `GameModes` enum,
`difficulty` is a string, and `challenges` is `CoopChallengeConfig[]`
(`src/data/elite-redux/replay-trace.ts#L219-L224`).

The event log covers two kinds of input:

- `ReplayCommandEvent`: wave, turn, field-slot index, and one move/switch/ball/run
  command (`src/data/elite-redux/replay-trace.ts#L67-L93`).
- `ReplayInteractionEvent`: sequence, interaction kind, choice, and optional numeric
  data (`src/data/elite-redux/replay-trace.ts#L117-L127`). Ownership is derived from
  sequence parity by the current comments, not persisted as a separate owner field
  (`src/data/elite-redux/replay-trace.ts#L26-L29`).

The optional checkpoint is session-save-grade but deliberately narrow: wave, seed,
party, modifiers, money, and ball counts
(`src/data/elite-redux/replay-trace.ts#L145-L171`). It does not contain battle field
topology, enemy party, turn state, status sub-state, stat stages, move PP, arena tags,
ER module-let substrates, or a random-number cursor. The recorder also keeps a ten-wave
window/ring buffer, so older events and checkpoints are not part of the exported trace
(`src/data/elite-redux/replay-recorder.ts#L53-L96`,
`src/data/elite-redux/replay-recorder.ts#L162-L181`).

The raw/environment boundaries that ReplayTrace does not capture are listed in
`replay_trace.raw_environment_boundaries_not_captured` and include:

1. RNG cursor/random-call position. Seed is captured, but the engine separately
   captures and re-sows `seed`/`waveSeed` around authoritative apply
   (`src/data/elite-redux/coop/coop-battle-engine.ts#L3642-L3647`,
   `src/data/elite-redux/coop/coop-battle-engine.ts#L3921-L3926`).
2. Generated enemy/encounter state, battle format, and field seating. These are carried
   by authoritative state, not by ReplayTrace
   (`src/data/elite-redux/coop/coop-battle-engine.ts#L2782-L2847`).
3. ER substrates such as money streaks, biome structure/map, pending routes, and relic
   battle state. Full snapshots carry additive forms of these fields
   (`src/data/elite-redux/coop/coop-transport.ts#L823-L866`), while ReplayCheckpoint does
   not (`src/data/elite-redux/replay-trace.ts#L158-L171`).
4. Phaser/browser handles, asset promises, animations, tweens, field containers, and
   UI refresh timing (`src/data/elite-redux/coop/coop-battle-engine.ts#L3299-L3387`).
5. Clock, transport queue, timeout, channel replacement, and delivery state. Those are
   owned by the streamer or Authority V2 scheduler
   (`src/data/elite-redux/coop/coop-battle-stream.ts#L185-L204`,
   `src/data/elite-redux/coop/authority-v2/contract.ts#L82-L104`).
6. Command legality. `validateReplayTrace` validates shape and selected checkpoint
   invariants; it does not prove that a command was legal or that its RNG effects match
   the original run (`src/data/elite-redux/replay-trace.ts#L268-L315`).

`makeReplayTrace` supplies a stable object order: fixed required fields first, then
optional `coop`, `endState`, and `checkpoint`
(`src/data/elite-redux/replay-trace.ts#L338-L364`). This is an ordering convention, not
a digest: the trace source defines no replay checksum.

## Checkpoint, engine state, and Phaser handles

### Checkpoint

`coop-battle-checkpoint.ts` is engine-free. It reads a narrow view, clamps numeric
bounds, emits optional sub-state only when supplied/non-default, and keeps arena tags
keyed by tag type and side (`src/data/elite-redux/coop/coop-battle-checkpoint.ts#L28-L85`,
`src/data/elite-redux/coop/coop-battle-checkpoint.ts#L88-L210`). The battle engine
captures a slot-present field and stamps a monotonic tick
(`src/data/elite-redux/coop/coop-battle-engine.ts#L409-L452`).

`CoopBattleCheckpoint` contains:

- `field`: mutable on-field mon state. Required fields are `bi`, `partyIndex`,
  `speciesId`, `hp`, `maxHp`, `status`, `statStages`, and `fainted`; moves/PP, tera,
  ownership, status sub-state, form, ability, and ER tags are optional/additive
  (`src/data/elite-redux/coop/coop-transport.ts#L550-L615`).
- Weather and terrain types plus duration counters. Types contribute to checksum truth;
  duration counters are applied but excluded because a one-tick skew is legitimate
  (`src/data/elite-redux/coop/coop-transport.ts#L618-L645`,
  `src/data/elite-redux/coop/coop-replication-contract.ts#L73-L118`).
- Optional arena tags and money. Both are host-authored repair values; money is gated
  on apply and appears in the checksum projection
  (`src/data/elite-redux/coop/coop-battle-engine.ts#L1002-L1225`).

### Full and authoritative state

`CoopFullBattleSnapshot` is the heavy recovery/state-sync shape. In addition to the
full field mon records, it can carry party order, full bench JSON, money, lock state,
modifier blobs, ball counts, biome/seed/wave seed, and ER substrates
(`src/data/elite-redux/coop/coop-transport.ts#L750-L866`). `captureCoopFullSnapshot`
intentionally does not include ball counts in its legacy capture path, while the
authoritative material path does carry them; this is a source-level compatibility
boundary to preserve in the migration map
(`src/data/elite-redux/coop/coop-battle-engine.ts#L2587-L2666`,
`src/data/elite-redux/coop/coop-battle-engine.ts#L2782-L2847`).

`CoopAuthoritativeBattleStateV1` is the newer id-based state. It carries host-authored
`PokemonData` JSON for player and enemy parties, seating-only field entries, arena
state, economy, modifiers, optional RNG/substrate state, and a tick/wave/turn frontier
(`src/data/elite-redux/coop/coop-transport.ts#L1001-L1049`). The field `presented` is
explicitly a presentation observation; the corresponding `PokemonData` entry remains
the mechanical source (`src/data/elite-redux/coop/coop-transport.ts#L979-L998`).

The engine applies topology before scalar values, admits ticks monotonically, and then
touches Phaser presentation nodes (`src/data/elite-redux/coop/coop-battle-engine.ts#L3746-L3985`).
The future kernel should therefore emit declarative state deltas for an adapter rather
than making asset loading, sprite keys, boss bars, or UI text part of mechanical truth.

### Timer ownership

There are no timer calls in `coop-battle-engine.ts`; ownership is outside that source.

| state | current owner | canonical treatment |
| --- | --- | --- |
| weather/terrain duration and arena-tag turn/layer counters | host arena/weather/terrain/tag phases | transported/applied, excluded from checksum where the replication contract says so |
| toxic and sleep sub-state counters | host status phase | optional/additive on wire; guest applies host values |
| checkpoint/full-snapshot tick | capture host and guest admission globals | monotonic ordering only, never a mechanical checksum field |
| stream timeout/recovery timeout | `CoopBattleStreamer` injected schedule/clock | runtime ordering; not replay state |
| Authority V2 timers | `CoopScheduler` with owner/address/reason | runtime ordering; every timer needs an explicit owner/address |
| sprite/asset/tween completion | Phaser/browser adapter | presentation only |

The timer source evidence is `src/data/elite-redux/coop/coop-battle-stream.ts#L185-L204`,
`src/data/elite-redux/coop/coop-battle-stream.ts#L713-L716`,
`src/data/elite-redux/coop/authority-v2/contract.ts#L46-L104`, and
`src/data/elite-redux/coop/authority-v2/scheduler.ts#L8-L27`.

## Save and snapshot boundary

The JSON lists every field declared on `SessionSaveData`, plus the directly imported
`PokemonData`, `ModifierData`, `ArenaData`, ER map/routing/relic structures, co-op
control plane, and run configuration types. Methods and helper result types are
explicitly excluded where they are not serialized structures.

`ArenaData` is the runtime class (`tags` and `playerTerasUsed` are class fields), while
`SerializedArenaData` is the plain persistence shape where those two fields are
optional (`src/system/arena-data.ts#L11-L26`). The JSON keeps both records instead of
using the runtime class declaration to erase the serialized presence distinction.

The remaining declaration/producer presence gap in `SessionSaveData` is:

- `mysteryEncounterSaveData` is declared required/non-nullable, while its source comment
  and producer value permit JSON omission when the runtime value is undefined
  (`src/@types/save-data.ts#L119-L120`, `src/system/game-data.ts#L1888-L1888`).

`ModifierData.typePregenArgs` has a similar declared-array versus observed-undefined
edge (`src/system/modifier-data.ts#L38-L56`). The JSON preserves these distinctions
and marks them as unresolved; it does not choose a Rust absent/null/empty meaning.

`PokemonData.status` is a required, nullable serialized `Status` object rather than a
numeric status id (`src/system/pokemon-data.ts#L39-L39`,
`src/system/pokemon-data.ts#L123-L125`). The observed-optional JSON fields are
`nickname`, `fusionSpecies`, `fusionFormIndex`, `fusionAbilityIndex`, `fusionVariant`,
`fusionGender`, `coopOwner`, `summonDataSpeciesFormIndex`, and `natureOverride`; each
can receive `undefined` from the live producer and is therefore omitted by
`JSON.stringify` (`src/system/pokemon-data.ts#L95-L172`). Fusion shiny/luck/tera fields
remain required because the constructor supplies concrete defaults
(`src/system/pokemon-data.ts#L151-L157`).

### Save digest

`captureCoopSaveDataDigest` canonicalizes a normalized SessionSaveData projection and
hashes it with FNV-1a64. The explicit denylist is:

```text
playTime, timestamp, name, coopParticipants, coopRun, arena, party, enemyParty,
enemyModifiers, mysteryEncounterSaveData, mysteryEncounterType,
erAchievementRunState, trainer, score, playerFaints, erUsedTrainerKeys,
waveIndex, battleType, coopControlPlane
```

The exact reasons and field-level treatment are in
`save_snapshot_fields.digest_projection`; the source implementation is
`src/data/elite-redux/coop/coop-battle-engine.ts#L1915-L2251`. New SessionSaveData
fields are included by default unless added to this denylist. This is a projection for
cross-client integrity, not a claim that excluded data is unimportant to persistence.
`name` and `trainer` are not ambiguous in this projection: they are explicit denylist
entries (`src/data/elite-redux/coop/coop-battle-engine.ts#L1936-L1936`,
`src/data/elite-redux/coop/coop-battle-engine.ts#L1974-L1974`).

## Canonicalization and integrity

The current canonicalization rules are:

1. Checkpoint normalization clamps HP, max HP, stages, tag counters, and tag layers
   before emission (`src/data/elite-redux/coop/coop-battle-checkpoint.ts#L88-L210`).
2. Checksum object keys are sorted, array order is preserved, null is explicit, finite
   numbers are normalized (`-0` becomes `0`, integers use integer text, other numbers
   use precision 12), and FNV-1a64 hashes UTF-16 code units
   (`src/data/elite-redux/coop/coop-battle-checksum.ts#L223-L287`).
3. `COOP_CHECKSUM_FIELDS` is the authoritative compact preimage. It includes arena
   identities, player party projections, money, lock state, modifiers, held items,
   balls, biome, seed, and normalized save digest; duration counters and selected host
   accumulators are excluded (`src/data/elite-redux/coop/coop-battle-checksum.ts#L117-L215`,
   `src/data/elite-redux/coop/coop-replication-contract.ts#L235-L268`).
4. A sentinel checksum (`0000000000000000`) means capture/read failure, not equality
   (`src/data/elite-redux/coop/coop-battle-checksum.ts#L215-L215`).
5. ReplayTrace has no independent digest. Its event array order is the input order and
   its optional fields remain optional.

The future Rust serializer must preserve array order where the source says order is
meaningful, retain presence separately from null/zero/empty, and keep the checksum
projection distinct from the full persistence snapshot.

## Producers, consumers, and globals

The machine-readable `producers`, `consumers`, and `global_dependencies` sections map
each boundary to its source and future layer. The key current ownership is:

- `replay-recorder` produces the bounded ordered trace and optional window-start
  checkpoint (`src/data/elite-redux/replay-recorder.ts#L104-L246`).
- `coop-battle-checkpoint` normalizes engine-free views; `coop-battle-engine` captures
  live host state and applies it on the guest
  (`src/data/elite-redux/coop/coop-battle-checkpoint.ts#L221-L294`,
  `src/data/elite-redux/coop/coop-battle-engine.ts#L409-L452`).
- `coop-turn-commit-phase` captures the authoritative carrier, while
  `coop-replay-turn-phase` consumes checkpoint/full-field/authoritative/checksum data
  (`src/phases/coop-turn-commit-phase.ts#L131-L145`,
  `src/phases/coop-replay-turn-phase.ts#L1091-L1120`).
- `game-data.getSessionSaveData` produces the persisted snapshot, and ER serializers
  produce the nested map/relic substrates
  (`src/system/game-data.ts#L1834-L1933`,
  `src/data/elite-redux/er-map-nodes.ts#L226-L276`,
  `src/data/elite-redux/er-relic-battle-state.ts#L94-L118`).
- `globalScene`, `Phaser.Math.RND`, Pokemon/Modifier registries, ER module state, and
  co-op tick/control globals are current dependencies. They are listed as adapter or
  runtime dependencies, not silently promoted to Rust kernel state.

## Future layer classification

The JSON classifies fields into:

- `kernel.run`: seed, rules, progression, economy, inventory, map, and ER substrates.
- `kernel.battle`: authoritative party/battle mechanics, field topology, mutable mon
  state, arena identities, and host-resolved economy effects.
- `kernel.rng`: explicit run seed plus random cursor. This is a known ReplayTrace gap.
- `integrity`: checksum/save-digest/control-digest projections and error sentinels.
- `replay`: ordered input and explicit checkpoint codec; not a complete environment
  snapshot.
- `runtime`: ticks, epochs, membership, control surfaces, timers, delivery, and
  recovery admission.
- `adapter.presentation`: Phaser/browser handles and derived UI/asset/animation state.
- `adapter.persistence.metadata`: wall-clock and cosmetic metadata.

The layer assignment is intentionally a migration map. It does not freeze a new public
contract, and it does not resolve the remaining source presence gaps.

## Known gaps and stop-condition evidence

The required stop-condition evidence is preserved in
`layer_classification.stop_condition_evidence` in the JSON:

- absent/null ambiguity remains for `mysteryEncounterSaveData` and `typePregenArgs`;
- `name` and `trainer` are definitively excluded from the save digest, so their
  persistence declarations do not create a checksum-projection conflict;
- Phaser state is involved in capture/apply, but the cited replication registry gives
  direct mechanical projections and identifies presentation calls as adapter work.

No semantics were invented to resolve these conditions. The next kernel/schema phase
must choose tagged presence/null rules and prove any missing RNG/frontier coverage
before claiming deterministic replay or save compatibility.
