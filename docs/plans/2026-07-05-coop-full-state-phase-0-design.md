# Co-op full-state turn replication - Phase 0 design

Date: 2026-07-05
Status: Phase 0 design, revision 1 after adversarial review. Stop for
maintainer / Oracle review before production code.

## Goal

Make the co-op guest hold zero independently-derived battle state. The host
remains the only battle engine. At every authoritative boundary, the host
streams the complete player-facing battle/run state; the guest applies that
state as data and uses battle events only for presentation.

The normal path must stop relying on checksum mismatch plus `stateSync` as the
healer. Once this lands, a checksum mismatch is a protocol or apply bug, not an
expected recovery mechanism.

The important correction from review is that the full-state payload should not
invent a lossy live-field overlay. `PokemonData` already carries
`PokemonSummonData`, and `PokemonSummonData` serializes the volatile battler
state that matters: stat stages, move queue, serializable battler tags, transform
overrides, changed types, ability overrides, temporary moveset overrides, and
related in-battle state. The new payload should use that existing serialization
instead of rebuilding today's `tags: number[]` channel.

Baseline before this doc:

- `ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-multiwave.test.ts`
- Result: 3 tests passed on 2026-07-05.

No production code is changed in Phase 0.

## Source Facts

These local facts drive the revised design:

- `PokemonData` has `id` and `summonData` fields
  (`src/system/pokemon-data.ts:20`, `:73`).
- `PokemonData` copies the source `id` and rebuilds `PokemonSummonData` from
  serialized input (`src/system/pokemon-data.ts:95`, `:157`).
- `Pokemon` copies `id` and `summonData` from a `dataSource`
  (`src/field/pokemon.ts:287`, `:549`).
- `PokemonSummonData` is the existing serialized live-state container
  (`src/data/pokemon/pokemon-data.ts:207`, `:244`, `:381`).
- ER `BLEED`, `FROSTBITE`, `FEAR`, and `DRENCHED` are
  `SerializableBattlerTag`s, so they ride through `summonData.tags`
  (`src/data/battler-tags.ts:3949`, `:3987`, `:4043`, `:4232`).
- The current co-op full mon snapshot still reduces tags to tag type numbers
  (`src/data/elite-redux/coop/coop-transport.ts:339-376`), which is the lossy
  path this refactor must not preserve.
- `getBattleSpriteKey` is the natural expensive-render gate
  (`src/field/pokemon.ts:1255`).
- The current instance-keyed player modifier reconcile already sets
  `stackCount` directly and adds/removes by instance identity
  (`src/data/elite-redux/coop/coop-battle-engine.ts:2377-2500`).

## Current Turn Flow

The live path is already mostly host-authoritative, but it is not full-state
authoritative.

1. The host records presentation events during the turn.
2. `TurnEndPhase` captures a numeric checkpoint, checksum preimage, checksum, and
   an on-field `fullField` snapshot, then emits `turnResolution`
   (`src/phases/turn-end-phase.ts:225-236`).
3. The guest `CoopReplayTurnPhase` renders live or batched events, then unshifts
   `CoopFinalizeTurnPhase` last (`src/phases/coop-replay-turn-phase.ts:160-184`).
4. `CoopFinalizeTurnPhase` applies `applyCoopCheckpoint`, then
   `applyCoopFieldSnapshot`, then verifies the checksum
   (`src/phases/coop-replay-phases.ts:843-865`).
5. On checksum mismatch, the guest requests a compressed `CoopFullBattleSnapshot`
   and queues `CoopApplyResyncPhase` (`src/phases/coop-replay-phases.ts:887-948`).

The timing model is correct and must be preserved: normal turn animations drain
before ordinary state apply. The state model is the gap: ordinary turn state is
split across a numeric checkpoint plus an on-field-only rich snapshot, while
bench party, full party order, modifiers, module-let substrates, and exact live
`summonData` mostly ride rare `stateSync`.

## Guest-Derived State Site Map

These are the current sites where the guest computes, infers, reconstructs, or
patches structural state instead of copying a complete host snapshot.

| Area | Site | Current behavior | Full-state target |
|---|---|---|---|
| Field composition from checkpoint | `reconcileCoopEnemyField` in `coop-battle-engine.ts:364-444` | Infers enemy KOs and switches from `bi`, `fainted`, and `speciesId`; finds a matching party member and calls `summonCoopEnemyField`. | Apply explicit host seating: side, battler index, party index, and `pokemonId`. Stop inferring switches from species. |
| Player field composition from checkpoint | `reconcileCoopPlayerField` in `coop-battle-engine.ts:569-675` | Infers player KOs, replacements, and slot repairs from `speciesId` plus `partyIndex`; repositions mons with side-effect-free swaps. | Copy host party order, then seat by `pokemonId`. Duplicate species are resolved by `Pokemon.id`, not by species fallback or a new token. |
| Numeric checkpoint apply | `applyCoopCheckpoint` in `coop-battle-engine.ts:868-999` | Applies hp/status/stages, ER tags, PP by matching move id, form, tera, owner tag, arena tags, and money. | Replace as normal truth source with `PokemonData` plus seating apply. The checkpoint can remain as Phase 1-2 safety, then be deleted after checksum assertion proves zero normal resyncs. |
| On-field rich state | `captureCoopFieldSnapshot` / `applyCoopFieldSnapshot` in `coop-battle-engine.ts:2826-2873` | Carries rich state only for field mons, but tags are reduced to type numbers. No bench party, full party order, full enemy party, or player modifiers. | Do not promote this shape. Replace it with whole-party `PokemonData` snapshots. `field[]` becomes seating only, plus enemy boss segment index if needed. |
| Rare full resync | `captureCoopFullSnapshot` / `applyCoopFullSnapshot` in `coop-battle-engine.ts:1942-1985` and `:2655-2816` | Full-ish repair payload on mismatch: field, arena, money, modifier blobs, pokeballs, bench party, module-let substrates. It still uses field reconcile inference and lossy field mon tags. | Reuse the useful run-state pieces, but make the ordinary payload `PokemonData`-first and seating-exact. Keep compressed `stateSync` only as rare transport recovery. |
| Party order repair | `adoptCoopHostPlayerPartyOrder` in `coop-battle-engine.ts:2529-2605` | Reorders only non-pinned party slots by species to match host order. | Snapshot carries authoritative party arrays in order. Guest adopts that order directly while preserving live objects by `Pokemon.id`. |
| EXP/level/moveset deltas | `expResolved` channel in `coop-runtime.ts:209-234`, `:376-396`, `:1265-1277`; apply in `battle-end-phase.ts:30-53`; `applyCoopExpDeltas` in `coop-battle-engine.ts:2920-3001` | Host streams per-slot deltas after EXP drains; guest applies by slot, then recovers by species if party order diverged. | Delete after the full party snapshot carries level, exp, moveset, hp, and evolved species at the same authoritative boundary. No per-slot/species delta recovery. |
| Capture / bench party reconcile | `applyCoopCaptureParty` in `coop-battle-engine.ts:3361-3470` | Rebuilds guest party by matching host `PokemonData` to live mons by species plus `coopOwner`; constructs or releases bench mons. | Fold into general full-party apply. Match and mutate by `Pokemon.id`; absent host ids reconstruct, extra guest ids remove. |
| Guest voluntary switch | `mirrorGuestOwnSwitch` in `turn-start-phase.ts:97-112` and `:195-220` | Guest eagerly mirrors its own switch with a side-effect-free swap before diverting to replay, so its field order matches host expectation. | Host snapshot remains source of truth. If immediate local feedback is kept, classify it as presentation/speculative and overwrite with the next authoritative seating snapshot. |
| Guest-owned faint replacement | `CoopFaintReplayPhase.maybeOpenOwnReplacementPicker` in `coop-replay-phases.ts:511-570`, `CoopGuestFaintSwitchPhase` in `coop-guest-faint-switch-phase.ts:15-95`, host await in `switch-phase.ts:91-167` | Guest chooses its own replacement from local bench legality; host resolves by slot/species and may auto-pick. Host sends an out-of-band checkpoint to materialize the replacement. | Keep input ownership, but host legality and host seating are authoritative. The resulting intra-turn authoritative snapshot must apply before the replacement can act. |
| Intra-turn replacement apply | `CoopPushReplacementCheckpointPhase` in `coop-push-replacement-checkpoint-phase.ts:12-42`; consumed in `coop-replay-turn-phase.ts:115-148` | Host sends a narrow checkpoint while guest is parked, so the guest can see the replacement and issue its command. | Keep this as a first-class authoritative apply point. Refactor it to carry full or minimal full seating state; do not delete it in the cleanup phase. |
| Reward option reconstruction | `coopAdoptOwnerRewardOptions` in `select-modifier-phase.ts:1105-1145`, `reconstructRewardOptions` in `coop-reward-options.ts:70-116` | Watcher rebuilds the owner's reward options and falls back to local roll on failure. | Option mirroring can stay for UI, but resulting party/modifier/money/item state must come from an authoritative interaction outcome snapshot in a follow-on interaction project. |
| Reward watcher apply | `applyRelayedRewardAction` in `select-modifier-phase.ts:1339-1428` | Watcher applies relayed reward, shop, transfer, lock, and CHECK ops against local objects. | Treat as UI mirroring until an interaction-terminal protocol exists. This battle-state refactor must not claim full deletion of interaction mutation paths. |
| CHECK-team mutations | `applyRelayedCheckOp` in `select-modifier-phase.ts:1466-1538` | Watcher reproduces party reorder, give, release, unfuse, rename, pause-evo, and form-item operations. | Keep separate from battle turns. Full battle snapshots must not advance or repair the interaction counter. |
| Learn-move watcher apply | `LearnMovePhase` owner/watcher paths in `learn-move-phase.ts:93-190` | Watcher opens the same menu and applies relayed forget result against its local mon. | Input relay may stay where the owner must choose, but the final moveset should be copied through the next authoritative party snapshot. |
| Interaction continuation counter | `advanceCoopInteractionForContinuation` in `coop-runtime.ts:488-520`; shop advance in `select-modifier-phase.ts:1147-1182` | Item-specific commit paths locally advance the alternation counter so ownership does not stall. | Out of scope for this refactor. Keep the special-case until a separate interaction-terminal protocol owns continuation advances. Battle snapshots must never touch this counter. |
| Checksum/resync as healer | `verifyChecksum` in `coop-replay-phases.ts:887-953` | Mismatch triggers `requestStateSync`, cancels orphaned waits, then queues full snapshot apply. | Flip to assertion before deleting old healers. Normal runs must prove zero `stateSync` use, including the known PP desync class. |

## Proposed Normal-Turn Wire Format

Add an additive field to `turnResolution` during Phase 1, beside the existing
`checkpoint` and `fullField`:

```ts
interface CoopAuthoritativeBattleStateV1 {
  version: 1;
  tick: number;
  wave: number;
  turn: number;

  // JSON PokemonData[], authoritative order. Each entry includes id,
  // summonData, battleData, base moveset, status, hp, tera, boss metadata, etc.
  playerParty: Record<string, unknown>[];
  enemyParty: Record<string, unknown>[];

  // Seating only. Live per-mon state is not duplicated here.
  field: CoopFieldSeatState[];
  arena: CoopArenaState;

  money: number;
  score?: number;
  pokeballCounts: [number, number][];

  playerModifiers: Record<string, unknown>[];
  enemyModifiers: Record<string, unknown>[];

  erMoneyStreaks?: [number, number][];
  biomeOverstayAnchor?: number;
  erRelicBattleState?: ErRelicBattleStateData;
}

interface CoopFieldSeatState {
  side: "player" | "enemy";
  bi: number;
  partyIndex: number;
  pokemonId: number;
  owner?: "host" | "guest";

  // PokemonData carries boss/bossSegments. Keep the current active segment index
  // here if it is not serialized by PokemonData.
  bossSegmentIndex?: number;
}

interface CoopArenaState {
  biomeId?: number;
  weather: number;
  weatherTurnsLeft: number;
  terrain: number;
  terrainTurnsLeft: number;
  tags: CoopSerializedArenaTag[];
}
```

Explicit non-goals for `field[]`:

- No `tags: number[]`.
- No `statStages`.
- No transform object.
- No moves, PP, ability, type, tera, hp, status, or held item overlay.
- No species fallback identity.

Those fields ride through `PokemonData` and `PokemonData.summonData`. PP is part
of the serialized moveset through `PokemonMove` state. Transform, changed types,
ability overrides, stat stages, move queues, and serializable battler tags ride
through `PokemonSummonData`.

Single-turn tags such as flinch/protect are presentation/event-stream concerns at
normal turn end. If they have already lapsed before the end-of-turn apply, the
snapshot should not resurrect them. If a future mid-turn authoritative boundary
needs them, they must be represented by `summonData` or by that boundary's event
protocol, not by lossy tag-type numbers.

Size estimate:

- Typical two-player battle: up to 6 player party mons plus current enemy party,
  with seating rows for active field mons.
- Essential full-state JSON should be roughly in the same order as the current
  compressed `stateSync` payload plus player/enemy party `PokemonData`.
- If sent compressed like `stateSync`, expected payload is a few KB per turn.
  Phase 1 should log actual byte counts in the duo harness instead of guessing.

Format recommendation:

- Introduce `CoopAuthoritativeBattleStateV1` for clarity during review.
- Build it from the existing `PokemonData` and useful `CoopFullBattleSnapshot`
  substrates.
- After the old checkpoint path is deleted, alias or fold the names if that
  reduces type duplication.

## Apply Model

The guest apply is a two-step operation:

1. Apply authoritative data to live game objects without running resolution
   phases.
2. Reconcile rendering from before/after visible state.

The data apply must:

- Treat `Pokemon.id` as the required cross-client mon identity. Do not add a new
  identity token for this refactor.
- Index all live guest party/field mons by `id`.
- For each host `PokemonData`:
  - if the id exists locally, mutate that existing object in place;
  - if the id is absent, reconstruct from `PokemonData`;
  - if a local id is extra after the host set is applied, remove it.
- Adopt `playerParty` and `enemyParty` order exactly from the host arrays.
- Seat field mons from `field[]` by `pokemonId`, `side`, `partyIndex`, and `bi`.
- Copy per-mon state from `PokemonData`, including `summonData`, `battleData`,
  level, exp, hp, status, base moveset, PP, form, tera, boss fields, and
  `coopOwner`.
- Apply arena weather, terrain, arena tags, money, pokeballs, player/enemy
  modifiers, and ER module-let substrates.
- Use the existing instance-keyed modifier reconcile shape: match by instance
  key, set `stackCount` directly, add missing instances, remove extra instances.
  Never clear-and-re-add modifiers as a bulk strategy, because that can re-fire
  `onAdd`/lapse effects and corrupt temporary booster counters.
- Avoid `MovePhase`, `MoveEffectPhase`, `FaintPhase`, `SwitchPhase`,
  `SwitchSummonPhase`, `LevelUpPhase`, `EvolutionPhase`, and reward item apply
  paths on the guest.
- Be idempotent against duplicate snapshots and guarded by monotonic `tick`.

Mutate-in-place is mandatory for any id that still exists. It is not only an
optimization: it preserves sprites, bars, battle-info objects, and any other
render-owned identity while replacing the game data underneath.

Implementation guard:

- Although the code comments describe `Pokemon.id` as a PID rather than a formal
  unique id, this branch already treats it as the co-op identity. Phase 1 should
  assert no duplicate ids appear within a host authoritative snapshot and fail
  loudly if that invariant is violated.

## State / Render Differ

The differ should be inverted from a hand-maintained "fields that matter"
signature:

- When a mon's authoritative data changes, run cheap refreshes unconditionally:
  info bars, status/tint, held-item bar visibility, and battle-info labels.
- Gate only expensive work on derived render keys:
  - occupant id / side / slot;
  - `getBattleSpriteKey(...)` inputs for front/back sprite identity;
  - transform/illusion state that changes that sprite key;
  - boss bar mode and segment count;
  - visible field seating.

Renderer rules:

- Same `pokemonId`, same sprite key, same slot: no `loadAssets`, no `leaveField`,
  no `initBattleInfo`, no resummon.
- Same `pokemonId` with hp/status/maxHp/status text changes: refresh info and bars
  only.
- Same `pokemonId`, slot changed: reseat with canonical field positioning and
  update layout, without rebuilding the sprite if the sprite key is unchanged.
- Occupant id or sprite key changed: load/rebind sprite and info panel once.
- Fainted removed from field: hide/remove only if currently visible.
- Weather, terrain, arena tags: update only changed visual elements.

No staging phase may intentionally resummon every turn. If an early
full-apply-with-old-render path is useful for local debugging, keep it behind a
dev-only flag. The Phase 2 staging path must already include the sprite identity
gate so the test team does not see per-turn flicker.

Implementation note:

- Current `applyFullMon` mixes data writes with render calls such as `loadAssets`,
  `updateInfo`, `initBattleInfo`, and modifier-bar refreshes
  (`src/data/elite-redux/coop/coop-battle-engine.ts:2144-2304`). The new apply
  should separate data mutation from render reconciliation.

## Animation Timing Model

Normal battle turn:

1. Host emits `battleEvent` cues during resolution.
2. Guest `CoopReplayTurnPhase` presents live cues as they arrive.
3. When `turnResolution` arrives, guest renders any remaining unplayed cues.
4. Guest enqueues `CoopFinalizeTurnPhase` last.
5. `CoopFinalizeTurnPhase` applies the full authoritative snapshot.
6. Only after snapshot apply does the guest verify checksum/assertion and advance
   the turn or wave tail.

Never apply the normal turn snapshot mid-animation. Doing so would make fainted
mons vanish before faint animation, snap HP bars before drains, or teleport
switch-ins.

Intra-turn authoritative apply:

- Keep the replacement unblock apply as a first-class boundary. A mid-turn
  faint-to-replacement-to-act sequence needs the replacement seated before its
  command UI and before its later move animation.
- The current `CoopPushReplacementCheckpointPhase` / parked replay consumption
  is the correct timing slot. Refactor the payload to full seating/full state as
  needed, but do not delete the phase.
- This boundary is allowed because the guest is parked and no animation is in
  flight.

Resync exception:

- A `stateSync` reply must continue to queue a phase (`CoopApplyResyncPhase`)
  rather than applying inline from the promise continuation. The current code
  documents this race around HP drains (`src/phases/coop-replay-phases.ts:942-948`).

Interactions:

- The co-op interaction counter is not the battle turn. It controls screen
  ownership for shops, rewards, mystery encounters, and continuations.
- Battle full-state snapshots must not advance or restore it implicitly.
- The berry/shop continuation-counter bug is a separate interaction-terminal
  protocol problem. This project can remove battle-state desyncs; it cannot
  honestly claim to close all interaction desyncs.

## Phase Plan

### Phase 1 - Additive authoritative payload

- Add `authoritativeState` to `turnResolution`.
- Capture it on the host at the same boundary as the existing checkpoint.
- Populate parties with serialized `PokemonData` including `summonData`.
- Populate `field[]` with seating only plus `bossSegmentIndex` if needed.
- Keep guest apply unchanged.
- Add snapshot invariant assertions:
  - every seated `pokemonId` exists in the matching host party array;
  - no duplicate `Pokemon.id` appears in a host authoritative snapshot;
  - `field[]` has no lossy per-mon battle-state overlay.
- Harness assertions:
  - payload exists on each host turn;
  - payload normalized state equals host normalized state;
  - logged byte size stays in the expected compressed range.

### Phase 2 - Guest applies full state without flicker

- In `CoopFinalizeTurnPhase`, apply `authoritativeState` after animations.
- Match by `Pokemon.id`, mutate existing objects in place, reconstruct missing
  ids, remove extra ids, and adopt host party order.
- Seat active mons by `field[]`.
- Apply modifiers through the pure-state instance-keyed reconcile.
- Include the minimal render gate in this phase: same id plus same
  `getBattleSpriteKey` result must not resummon.
- Keep old checkpoint/fullField/resync in place as safety during this phase.
- Keep any intentionally flickery full-apply path behind a dev-only flag, never
  as the staging default.
- Duo assertions:
  - host and guest normalized party, enemy party, field seating, modifiers,
    money, inventory, arena, PP, and `summonData` are equal after faints,
    switches, EXP, capture, reward/shop item effects that touch battle/run state,
    and enemy held-item consumption;
  - normal forced `stateSync` count is zero.

### Phase 3 - Render differ hardening

- Finish splitting data apply from visual refresh.
- Make cheap refreshes unconditional for changed mons.
- Gate expensive sprite work only on occupant/sprite-key/slot changes.
- Add counters or spies proving steady snapshots do not call `loadAssets`,
  `leaveField`, `initBattleInfo`, or resummon.
- Verify with duo tests plus battlefield render recipes in `render-ui-page.test.ts`
  where appropriate.

### Phase 4 - Checksum assertion and zero-resync gate

- Before deleting old healers, make normal checksum mismatch and normal `stateSync`
  use fail the duo harness.
- Keep the queued `stateSync` recovery path in code while this phase proves the
  new payload under real scenarios.
- Gate advancement on zero normal resyncs across the full co-op suite, including
  the known PP desync class. The payload should close PP by construction through
  serialized `PokemonMove`/`ppUsed`, but this must be proven before cleanup.

### Phase 5 - Delete superseded battle-state machinery

Delete only after Phase 4 is green:

- `expResolved`, `CoopExpDelta`, `captureCoopExpDeltas`, `applyCoopExpDeltas`,
  `pendingExpDeltas`, and `BattleEndPhase` guest EXP adoption.
- `applyCoopFieldSnapshot` / `fullField` once superseded by the full snapshot.
- `applyCoopCheckpoint` as the normal turn truth source.
- `adoptCoopHostPlayerPartyOrder` as a standalone species-based reorder.
- Bench-only `benchParty` heal as a separate recovery path, replacing it with the
  general party snapshot apply.
- Species-mismatch / identity-recovery patches in EXP and switch application.
- Party-order transposition patches whose only job is to compensate for derived
  state.
- Normal-play dependency on checksum-triggered `stateSync` as a healer. A queued
  `stateSync` phase may remain for rare transport/session recovery, but any use
  in normal harness runs is a failure.

Keep or refactor:

- `CoopPushReplacementCheckpointPhase` or its successor. It remains the
  first-class intra-turn authoritative apply boundary.
- Side-effect-free seating helpers can remain as low-level render/apply utilities
  if they are driven by exact host seating.
- Input relays for guest-owned commands and choices remain necessary.
- Party-item interaction-counter continuation special-casing remains until a
  separate interaction-terminal protocol owns those advances.

## Verification Requirements

For each implementation phase:

- Reproduce and prove behavior in the two-engine duo harness first.
- Run the targeted duo tests for the touched behavior.
- Before shipping a production phase, run:
  - `ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/`
  - `npx tsc --noEmit` and confirm no new errors over current branch baseline.
  - `npx biome check --write <touched files>`
- Add or update an in-game dev-suite scenario or note when user-visible behavior
  changes.
- Do not deploy or proceed to the next phase until review signs off.

Field-completeness proof required before Phase 2 can be considered correct:

- Build a test mon carrying every exotic live-state class that has caused or could
  cause co-op loss:
  - Substitute with HP;
  - Encore / Disable with source move and counters;
  - charging/recharging/frenzy move queue;
  - transform / Imposter copied identity;
  - changed types and added type;
  - ability override / suppression;
  - temporary moveset override;
  - stat stages;
  - ER `BLEED`, `FROSTBITE`, `FEAR`, and at least one other serializable ER tag.
- Capture through `PokemonData`, apply to a guest object, and assert normalized
  `PokemonData`/`summonData.toJSON()` is byte-identical.
- Assert the new `field[]` seating payload contains no tag-type-only or
  stat-stage-only fallback.

Additional required probes:

- Duplicate-species party where both same-species mons switch, faint, gain EXP,
  and hold different items. The guest must stay correct by `Pokemon.id`.
- PP use and PP restore across a full turn. No normal `stateSync` may be needed.
- Mid-turn faint replacement where the replacement acts later in the same turn.
  The intra-turn authoritative apply must seat it before command selection.
- Steady-state render replay of several no-op snapshots. Same id plus same sprite
  key must not resummon.
- Interaction-counter invariant. Battle snapshots must leave the interaction
  counter unchanged.

## Risk Register

- Animation timing is the highest-risk area. Normal snapshots must apply after
  event presentation, not when they arrive.
- Intra-turn replacement is a real authoritative boundary, not an exception to
  delete. Removing it breaks mid-turn replacement-then-act flows.
- `Pokemon.id` is already the branch's operational cross-client identity, but the
  base comment calls it a PID. Snapshot duplicate-id assertions should catch the
  theoretical collision case early.
- Serializable coverage must be proven with a completeness test. Do not recreate
  lossy `tags: number[]` in a new payload.
- Current apply code mixes data and rendering. Refactoring that without regressing
  boss bars, transform, held-item bars, and form assets is the main render risk.
- Modifier apply must stay pure-state and instance-keyed. Clear-and-re-add can
  corrupt temporary booster and lapse semantics.
- Interaction state is adjacent but separate. Do not solve counter ownership by
  smuggling it into battle snapshots.

## Scope Truth

This refactor targets battle-state desyncs: party state, field seating, live
`summonData`, PP, EXP, modifiers, arena, money, inventory, and module-let
substrates at battle authoritative boundaries.

It does not fully solve shop/reward/mystery-encounter interaction ownership. The
known party-item continuation-counter class needs a separate interaction-terminal
protocol. Until that exists, battle snapshots must remain forbidden from touching
the interaction counter.

## Review Questions

1. Should `CoopAuthoritativeBattleStateV1` be a new type until cleanup, or should
   it immediately replace/rename `CoopFullBattleSnapshot`?
2. Is `bossSegmentIndex` the only enemy boss field missing from serialized
   `PokemonData`, or should Phase 1 prove that explicitly and omit it if redundant?
3. Which exact normalized byte representation should the field-completeness proof
   use: `PokemonData` JSON, `summonData.toJSON()`, checksum preimage, or a new
   helper shared with the co-op checksum?
4. Which dev flag name should guard any local flickery full-apply experiment so it
   cannot ship to staging by accident?
5. What is the minimum follow-on interaction-terminal protocol needed before the
   party-item continuation-counter special-case can be deleted?
