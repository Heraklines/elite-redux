# Co-op structural desync-gap audit (task #833)

Static code trace of the co-op desync sources that live OUTSIDE the per-encounter
interactive surface (which the sibling audit `docs/coop-byte-identical-audit.md`
already covered and shipped fixes for). This audit covers run state and
infrastructure: what the per-turn checksum does and does not capture, the
detached-listener lifecycle, the save/resume path, the relay sub-protocol
addressing space, and the current state of the #809 / #614 known items.

Read-only audit; no src or test was changed producing it. Every claim cites the
file and line it was read from. Items that could not be resolved statically are
marked UNKNOWN with the blocker.

Central mechanism being audited against: the co-op netcode is host-authoritative.
The self-heal is the per-turn checksum (`captureCoopChecksumState`,
`coop-battle-engine.ts:1458`) plus the per-turn checkpoint / full-field snapshot
and the on-mismatch full resync (`applyCoopFullSnapshot`,
`coop-battle-engine.ts:2109`). Anything the checksum does not HASH is never
DETECTED as diverged, and anything the resync/checkpoint does not CARRY is never
HEALED even when a resync fires for another reason. State that satisfies both of
those (not hashed, not carried) drifts silently and only reconverges at a full
session boot (launch snapshot or save/resume), if at all.

---

## Part 1 - Checksum capture set vs the mutable-run-state substrate inventory

### 1a. Exactly what the checksum captures

`captureCoopChecksumState` (`coop-battle-engine.ts:1458-1491`) hashes:

| Field | Source | Granularity |
|-------|--------|-------------|
| `field[]` per on-field mon | `readChecksumMon` :1428 | bi, partyIndex, speciesId, hp, maxHp, status, statStages, fainted, abilityId, formIndex, isTerastallized, teraType, bossSegments, bossSegmentIndex, moves (`[moveId, ppUsed]`), tags |
| `weather` / `terrain` | arena :1467-1468 | type id only |
| `arenaTags` | `readArenaTags` :1309 | `[tagType, side]`, turn counts EXCLUDED |
| `party` | :1470 | speciesId list, slot order |
| `partyLevels` | :1473 | level list, slot order |
| `money` | :1474 | scalar |
| `modifiers` | `readModifiers` :1320 | **`[typeId, stackCount]` ONLY** |
| `heldItems` | `readHeldItemDigest` :1370 | **`[bi, typeId, stackCount]`, on-field mons ONLY** |
| `pokeballCounts` | :1482 | `[ballType, count]` |
| `biomeId` | :1486 | scalar |
| `seed` | :1489 | run seed string |

CRITICAL answer to the framing question - is `modifiers` identity-hashed or
merely counted? It is neither a pure count nor a deep identity hash: it is
`[typeId, stackCount]` sorted by id (`readModifiers`, `coop-battle-engine.ts:1322-1324`).
A modifier's INTERNAL mutable state (a charge counter, a stored weather, a
per-battle proc flag) that changes WITHOUT changing `type.id` or `stackCount` is
INVISIBLE to the checksum. Same for `heldItems`, which is `[bi, typeId, stackCount]`
(`:1382`) and covers on-field mons only. So the checksum can detect "gained /
lost / restacked a modifier" but never "the same modifier's charges changed".

### 1b. What the resync / checkpoint DOES heal (so we know what closes a gap)

- Full resync `applyCoopFullSnapshot` (`coop-battle-engine.ts:2109-2262`) heals:
  per-mon field state incl. `heldItems` reconstructed from `ModifierData` blobs
  (so held-item internal args via `getArgs`, :1750-1758), weather/terrain/arenaTags,
  money (:2185), pokeballCounts (:2190), player-wide persistent modifiers as full
  blobs via `reconcileCoopPlayerModifiers` (:2208, so their `getArgs` internal state
  too), seed/waveSeed, party order, and `benchParty` (:2248).
- Per-turn full-field snapshot `captureCoopFieldSnapshot` is streamed EVERY host
  turn (`turn-end-phase.ts:235`) and applied on the guest (`coop-replay-phases.ts:855`),
  healing ON-FIELD held-item blobs (incl. charges) unconditionally each turn via
  `applyCoopHeldItemsForMon` (`coop-battle-engine.ts:1083`).
- Per-turn checkpoint carries `money` (`coop-battle-checkpoint.ts:150-162`) and
  form/tera (`:107-126`).

Consequence for the inventory below: an ON-FIELD held-item charge (Ward Stone,
Power Herb) heals every turn via the full-field snapshot even though the checksum
cannot detect it. A player-wide persistent modifier's internal args heal ONLY on a
full resync, and a full resync only fires when some OTHER hashed field mismatches.
Module-level `let` substrates and scene/ME-misc state are in NEITHER path.

### 1c. Substrate inventory (17 substrates)

Storage class: MODULE-LET = process-global module `let` (the dangerous class),
MODIFIER = on a modifier instance, POKEMON-DATA = on `customPokemonData`,
ME-MISC/SCENE = on `globalScene.currentBattle.mysteryEncounter.misc` or a
`globalScene` field.

| # | Substrate | Declared | Mutated (ungated?) | Class | In checksum? | Healed by resync/checkpoint? | In launch/save snapshot? | Verdict / player-visible consequence | Sev |
|---|-----------|----------|--------------------|-------|--------------|------------------------------|--------------------------|--------------------------------------|-----|
| 1 | Money streak `STREAKS` + `FAINTED_THIS_WAVE` (#348) | `er-money-streak.ts:34,36` | `advanceErMoneyStreaks` `battle-end-phase.ts:78` + `recordErStreakFaint` `faint-phase.ts:125` - BOTH run on the guest, NOT coop-gated | MODULE-LET | NO | NO | YES (`erMoneyStreaks` in `SessionSaveData`, `save-data.ts:124`; captured `game-data.ts:1394`) | CONFIRMED drift. Both clients advance the streak but keyed on `mon.id`; a FaintPhase timing/order difference diverges the map. Feeds the Summary "P +N%" badge (`er-money-streak.ts:20`) so each player can see a DIFFERENT bonus. Skews the host's `getWaveMoneyAmount`, but the pool stays correct because the guest is healed to the host's money. | P2 |
| 2 | Biome overstay anchor (#504) | `er-biome-structure.ts:76` (`overstayAnchorWave`) | `erMarkBiomeStay` `:161` (Crossroads "Stay"); reset on biome entry `:121` | MODULE-LET | NO | NO | YES (`biomeOverstayAnchor` in `erMapState`, `er-map-nodes.ts:213`; restored `:255`) | PARTIAL. Feeds host-only encounter generation (boss/trainer rate, BST cap, level - `er-biome-notoriety.ts`, all pure functions of the anchor). Guest never rolls encounters, so no field divergence. Residual: a guest-side notoriety WARNING / Crossroads cadence computed off a stale anchor could show a mismatched warning. Latent. | P3 |
| 3 | Relic per-battle lists (Cursed Idol / Pharaoh's Ankh) | `er-relic-battle-state.ts:42-43` (`trackedWave`, `lists`) | `erBattleEntrantOrdinal` `:75`, `erBattleOnce` `:89` | MODULE-LET | NO | NO | YES (`erRelicBattleState`, `save-data.ts:148`) | PARTIAL. The relic EFFECT (e.g. Cursed Idol HP halving) is applied host-authoritatively and the hp is checkpointed, so the guest renders correctly. The list divergence is latent (only matters on host migration / resume). Both re-arm identically from the launch snapshot. | P3 |
| 4 | Ward Stone `charges` / `waveProgress` (#358) | `er-ward-stones.ts:135-136` | consume `:193` (on-field CC block, host-only status pipeline); recharge `advanceErWardStoneCharges` `:453` (`battle-end-phase.ts:80`, both clients) | MODIFIER | NO (digest is `[bi,typeId,stackCount]`) | ON-FIELD: YES per turn via full-field `heldItems` blob (`getArgs` carries charges, `:170`). BENCH: NO per-turn heal (field-only), full resync `benchParty` does not carry held-item charges | YES (`erWardStones`, `save-data.ts:135`; and via `modifiers: ModifierData[]`) | MOSTLY CLOSED. On-field charge heals every turn. Bench charge changes come only from recharge (deterministic, both clients run it) so bench drift is ~nil; consumption is on-field only. Residual: relies wholly on the unconditional full-field heal - the checksum itself is blind. | P3 |
| 5 | Power Herb / Omni Gem `charges` / `waveProgress` | `modifier.ts:2418-2420` (`ErCommunityItemModifier`) | consume `er-community-items.ts:271,235`; recharge `erAdvanceCommunityItemCharges` `:311` (`battle-end-phase.ts:81`, both clients) | MODIFIER | NO | Same as #4 (on-field heals per turn via `getArgs` `modifier.ts:2452`) | YES (via `modifiers: ModifierData[]`) | Same as #4. Power Herb consume is on-field, healed per turn. | P3 |
| 6 | Stormglass chosen weather | `modifier.ts` ~`:2494` (`ErRelicModifier.chosenWeather`) | set during run; `getArgs` `:2520` | MODIFIER (player-wide persistent) | NO (`[typeId,stackCount]` unchanged when only `chosenWeather` mutates) | ONLY on a full resync via `reconcileCoopPlayerModifiers` blob (`coop-battle-engine.ts:2208`); NOT per-turn | YES (`modifiers`) | CONFIRMED blind spot. A `chosenWeather` change is invisible to the checksum and is NOT in the per-turn heal, so it reconverges only if some OTHER field triggers a full resync. If nothing else mismatches, it never heals - the two clients can carry different Stormglass weather until a resync fires for an unrelated reason. | P2 |
| 7 | Bog Witch curse `erCursedStat` | `pokemon-data.ts:111` | `bog-witch-encounter.ts:190`, `er-bargain-sins.ts:181`; cleared `cleansing-font-encounter.ts:63` | POKEMON-DATA (+ ME-misc roll `bog-witch-encounter.ts:111`) | NO | NO per-turn; rides `PokemonData` so a full resync `benchParty`/party reconcile carries it | YES (rides `party: PokemonData[]`) | PARTIAL. The curse effect is applied to a live mon's `customPokemonData`; it rides `PokemonData` so save/resume + full resync carry it, but a MID-battle set is not in the per-turn checkpoint. Applied host-authoritatively; low live risk. | P3 |
| 8 | Resist berry (consumption) (#357) | `er-resist-berries.ts:72` (`resistType`, no counter) | consume `defender.loseHeldItem` `:155` (host-only combat) | MODIFIER | Detected as a held-item REMOVAL (digest `[bi,typeId,stackCount]` loses an entry) | YES - the removal is a stackCount/composition change the digest sees and the full-field heal closes | YES (`erResistBerries`, `save-data.ts:130`) | OK. A single-use berry consume is a composition change the checksum DOES see. | - |
| 9 | Fortune Teller `queuedEncounters` | `mystery-encounter-save-data.ts:27` | `fortune-teller-encounter.ts:153` (host resolves the encounter) | SCENE FIELD (`globalScene.mysteryEncounterSaveData`) | NO | NO | YES (`mysteryEncounterSaveData`, `save-data.ts:99`) | PARTIAL. The guest, as pure renderer, never runs the encounter so its queue stays empty while the host's holds the prophecy. But the prophesied ME is SPAWNED host-authoritatively and the guest adopts it, so the empty guest queue does not affect spawning. Reconverges at launch/save. Latent. | P3 |
| 10 | Colosseum gauntlet `misc.wins` | `colosseum-encounter.ts:230,257` | `enc.misc.wins += 1` `:260` | ME-MISC | NO | NO | NO (`misc` is not in `MysteryEncounterSaveData`, which persists only `encounteredEvents` / `encounterSpawnChance` / `queuedEncounters`, `mystery-encounter-save-data.ts:24-27`) | CONFIRMED gap, but co-op Colosseum is ALREADY broken per the encounter audit (GROUP COLOSSEUM, zero co-op handling for rounds 2+). A save/resume mid-gauntlet loses the round count. Subsumed by that P0. | P1 |
| 11 | Achievement weave streak | `er-achievement-tracker.ts:33` (`weaveStreak`) | `:431,:436` | state object (verify module vs scene) | NO | NO | UNKNOWN - not obviously in `SessionSaveData`; blocker: needs a read of how `er-achievement-tracker` persists | Achievement-only counter, host-authoritative account write; low sync relevance. | P3 |
| 12 | Ghost-teams per-run cache | `er-ghost-teams.ts` / `er-ghost-waves.ts` | per-run | MODULE-LET | n/a | n/a (already handled) | via ClientCtx swap in harness | CLOSED. Documented as the ClientCtx swap target (CLAUDE.md); role-gated hooks. Listed for completeness. | - |
| 13 | ME pin `coopMeInteractionStart` | `coop-me-pin-state.ts:18` | set by `mystery-encounter-phases.ts`; reset only at ME terminal | MODULE-LET | NO | NO | NO | See Part 2/3 - stale across a mid-ME GameOver. | P1 |
| 14 | ME pin `coopMeHostPresentation` | `coop-replay-me-phase.ts:46` | set on present; cleared only at ME terminals `:810,856,918,966` | MODULE-LET | NO | NO | NO | Same as #13; NOT reset by `clearCoopRuntime`. | P1 |
| 15 | ME pin `coopMeBattleInteractionCounter` | `coop-runtime.ts:1187` | during ME | MODULE-LET | NO | NO | NO | IS reset by `clearCoopRuntime` (`coop-runtime.ts:1582`), unlike #13/#14. | - |
| 16 | Interaction counter (relay ordering) | `coop-session-controller.ts:421` | per interaction | instance | NO | NO | NO in `SessionSaveData`; `restoreInteractionCounter` (`:481`) is called ONLY from tests | See Part 3 - production-dead restore; resume relies on both clients re-initializing identically. | P2 |
| 17 | Ungated guest money mutations | `faint-phase.ts:114` (slum 2%-per-faint loss); `battle.ts:304` `pickUpScatteredMoney` (via `battle-end-phase.ts:95`) | run on the authoritative guest, NOT coop-gated | scene money | RESULT (`money`) is hashed | YES - the per-turn checkpoint `money` field heals it | n/a | CONFIRMED. `MoneyRewardPhase` gates the guest out of `addMoney` (`money-reward-phase.ts:52`), but these two OTHER money mutations are NOT gated, so the guest's money drifts and is reconciled by the checkpoint. This is the concrete source of the recurring `money host!=guest -> applied` heal, together with the by-design guest-gated wave money. | P2 |

Substrates inventoried: 17 (13 genuinely mutable run-state + 4 pin/counter/ghost
infra rows). The core systemic finding: the checksum hashes modifier IDENTITY
(`[typeId, stackCount]`) not modifier INTERNAL STATE, and three MODULE-LET
substrates (#1, #2, #3) plus the ME pins (#13, #14) are in neither the checksum
nor any per-turn/resync heal. Most are latent because the guest is a pure renderer
and the effect is host-authoritative; the live-visible ones are the money-streak
Summary badge (#1), Stormglass weather that never heals until an unrelated resync
(#6), and the recurring money reconcile noise (#17).

---

## Part 2 - Detached-listener lifecycle

Every fire-and-forget listener armed by the co-op ME machinery, its guard, and its
teardown. Sources: `coop-replay-me-phase.ts` (under `src/phases/`),
`coop-colosseum.ts`, `coop-interaction-relay.ts`, `coop-runtime.ts`,
`coop-biome-shop.ts`.

| # | Listener | Armed | Guard | Teardown |
|---|----------|-------|-------|----------|
| L1 | ME narration | `coop-replay-me-phase.ts:193` | none (renders text only) | dropped in all 4 terminals `:811,858,919,967` |
| L2 | Reward-options buffered cb | `:223` (`relay.onRewardOptionsBuffered`) | key-prefix `:224` + scene-identity pin `globalScene !== registeringScene` `:227` (#830) + once-only `settledDetached`/`shopHandedOff` `:237-238` | nulled `:844,970,814`; not in quiz-settle (intentional `:890`) |
| L3 | Main outcome/terminal race | `:460` (`void Promise.race(...)`) | `raceDone` latch `:441,461` + `settled && !settledDetached` `:465`; single inherited `liveTerminalArm` `:354,452` | `settled` consumed `:809,855,917,965` |
| L4 | Post-meResync terminal resolves | `:528,542` (`void terminalArm.then`) | `!settled || settledDetached` `:529,543` | via `settled` |
| L5 | Sequential host-terminal await | `:678` (`void relay.awaitInteractionChoice().then`) | `settled` gate; appears superseded by L3 | via `settled` |
| L6 | #822 detached ME-END after battle-handoff | `:756` (`void relayRef?.awaitInteractionChoice(seqTerm).then`) | **pin check** `coopMeInteractionStartValue() === counter` `:757` + idempotent `advanceInteraction` `:766` + `delegateOwnsTerminal` gate `:751` | no cancel; relies on the pin no-op |
| L7 | Quiz-handoff race re-arm | `:916` | inherits live terminal arm | via `settled` |
| L8 | Colosseum guest round-loop | `coop-colosseum.ts:503` (`void runColosseumGuestRoundLoop`) | `isCoopAuthoritativeGuest()` `:497` + type check `:499` + **pin** `coopColosseumStillPinned(counter)` `:252` (checked in the `while` `:277` and before every `leaveAndAdvance` `:462`) | no cancel; loop exits on pin clear `:354` |
| L9/L10 | Colosseum terminal + board arms | `:273,281` | reused single arm (#818 discipline); bounded `COOP_COLOSSEUM_WAIT_MS=1_200_000` `:226` | via pin |
| L11 | ME checksum resync | `coop-runtime.ts:407,416` (`void battleStream.requestStateSync().then`) | **session-generation pin** `gen !== coopSessionGeneration()` `:417` (#808) | gen bump invalidates |

Relay-level waiters (`coop-interaction-relay.ts`) are guarded by a per-await
`settled` latch (`:249,255,318,392`) and a sticky `cancelledSeqs` consumed-set
(`:180`, checked at every await top `:223,293,366`). There are NO module-level
`let`s holding pending waiters/resolvers in either `coop-replay-me-phase.ts` or
`coop-interaction-relay.ts`; all waiter state is phase-instance fields or
relay-instance Maps, disposed by `relay.dispose()` (`:521`).

Lifecycle answers:

- (a) HOT REJOIN mid-encounter (`coop-runtime.ts:703-793`): on channel death the
  disconnect reaction calls `relay.cancelWaiters(() => true)` (`:713`), which
  sticky-cancels ALL parked waiters (incl. L2/L6) so each resolves `null` and
  takes its leave/keep-own path. On rejoin success it does NOT re-arm the ME
  listeners; it heals via a full snapshot `requestStateSync` (`:761`, gen-pinned
  `:762`). The stall watchdog does the same (`:666,673`). So reconnect cancels then
  full-resyncs rather than re-arming - safe.
- (b) RUN END / GameOver mid-listener: `game-over-phase.ts:61` broadcasts
  `broadcastCoopWaveResolved("gameOver")` but does NOT call `clearCoopRuntime`.
  The co-op runtime and its module state are torn down only at the START of the
  next session load (`clearCoopRuntime` call sites: `coop-runtime.ts:1356,1390`;
  `game-data.ts:1619` on loading a NON-co-op save). So the listeners are not
  cleared at GameOver; they self-drop via their pins/settled flags.
- (c) NEW run in the same client session: `clearCoopRuntime`
  (`coop-runtime.ts:1541-1588`) disposes the relay (killing instance waiter Maps),
  resets its own module lets, and resets `coopMeBattleInteractionCounter` (`:1582`),
  BUT it does NOT reset `coopMeInteractionStart` (`coop-me-pin-state.ts:18`) or
  `coopMeHostPresentation` (`coop-replay-me-phase.ts:46`). Those clear ONLY at an ME
  terminal. So a run that ends (GameOver) MID-ME leaves both `>= 0` / non-null into
  the next run in the same client session.

CONFIRMED gap: the pin-guarded detached listeners L6 (`coop-replay-me-phase.ts:757`)
and L8 (`coop-colosseum.ts:252,462`) key their guard on
`coopMeInteractionStartValue()`. If that value survives a mid-ME GameOver as a
stale `>= 0`, the next run's first ME (before its own terminal writes the pin) can
mis-arm those listeners against the new run's state. The residual risk is the stale
pin, not orphaned resolvers (those die with `relay.dispose()`). Fix: reset both in
`clearCoopRuntime`, mirroring the `coopMeBattleInteractionCounter` reset already
there.

---

## Part 3 - Save / resume verdict

- Save trigger: `saveAll` fires at wave start in `EncounterPhase`
  (`encounter-phase.ts:661`), throttled to `waveIndex % 20 === 1` or a >=20-min gap.
  For an ME wave the save lands at wave start, before any ME interaction, so a
  resume re-enters the ME cleanly from the top. There is no separate mid-ME save
  trigger, so a save landing exactly mid-interaction (pins set, quiz mid-session)
  is not a normal event - but the state that WOULD need to survive it is not saved
  (below).
- What resume carries (`SessionSaveData`, `save-data.ts:72-161`): the ER
  side-channel substrates (`erMoneyStreaks`, `erResistBerries`, `erWardStones`,
  `erMapState` incl. the overstay anchor, `erRelicBattleState`,
  `mysteryEncounterSaveData` incl. `queuedEncounters`), plus `modifiers`,
  `party`/`enemyParty`, arena, money, etc. The guest boots from the host's
  `getSessionSaveData()` at launch via `applyCoopLaunchSession`
  (`game-data.ts:1530`), so at LAUNCH every saved substrate is host-synced.
- What resume does NOT carry:
  - The ME pins `coopMeInteractionStart` / `coopMeHostPresentation` /
    `coopMeBattleInteractionCounter` are module state, absent from `SessionSaveData`.
    A resume that lands inside an ME re-derives them when `MysteryEncounterPhase`
    re-runs from the top, which is fine for a fresh ME entry but means an
    IN-PROGRESS ME (mid-quiz, shop handoff pending) is not resumable as a half-state.
  - Colosseum `misc.wins` (`colosseum-encounter.ts:260`) is not persisted (Part 1
    #10); a resume mid-gauntlet loses the round count.
  - The relay interaction counter is not in `SessionSaveData` and
    `restoreInteractionCounter` (`coop-session-controller.ts:481`) is called ONLY
    from tests (`coop-interaction-sync.test.ts:672`, `coop-session-controller.test.ts:228`),
    NEVER from production. So a real resume does not restore the saved counter; it
    relies on BOTH clients re-initializing the counter identically from the fresh
    runtime assembly. If that assumption holds (both re-init to the same base) the
    even/odd ownership parity is preserved; if one client's base differed it would
    desync. VERIFY this assumption in the two-engine harness.

Verdict: co-op save/resume is correct for a resume that re-enters an ME from the
top (the common case), because everything host-authoritative rides the launch
snapshot. It is NOT correct for a resume INSIDE an in-progress ME, colosseum
gauntlet, or pending shop handoff - those transient pins/counters are module/scene
state that no save carries. Given saves only fire at wave start, the practical
exposure is a manual page-reload mid-ME (which drops the live connection anyway and
hits the resume-requires-both gate, `game-data.ts:1503`). PARTIAL, mostly bounded.

---

## Part 4 - Relay sub-protocol registry (seq bands + kind strings)

Routing is by numeric `seq` ONLY; the `kind` string is advisory/logging
(`coop-interaction-relay.ts:275`) and is never compared by any awaiter. So a
collision is a NUMERIC seq collision, not a kind collision.

### 4a. Seq bands (14 constants)

| Constant | Value | Defined | Offset | Max offset magnitude |
|----------|-------|---------|--------|----------------------|
| `COOP_FAINT_SWITCH_SEQ_BASE` | 90_000 | `coop-interaction-relay.ts:128` | `+ fieldIndex/battlerIndex` | 0-3 |
| `COOP_REVIVAL_SEQ_BASE` | 95_000 | `:130` | `+ fieldIndex` | 0-3 |
| `COOP_ABILITY_SEQ_BASE` | 6_000_000 | `coop-ability-picker-relay.ts:75` | `+ shopSeq` (interaction counter) | counter |
| `COOP_BIOME_SHOP_SEQ_BASE` | 7_000_000 | `coop-interaction-relay.ts:46` | `+ pinnedStart` | ME counter |
| `COOP_BARGAIN_SEQ_BASE` | 7_500_000 | `:52` | `+ coopBargainStart` | counter |
| `COOP_COLOSSEUM_SEQ_BASE` | 7_600_000 | `coop-colosseum.ts:87` | `+ pinnedCounter` | ME counter |
| `COOP_ME_PUMP_SEQ_BASE` | 8_000_000 | `coop-replay-me-phase.ts:30` (duplicated in `mystery-encounter-phases.ts:60`, `encounter-phase-utils.ts:80`, `coop-quiz-mirror.ts:45`) | `+ interactionCounter` | ME counter |
| `COOP_ME_QUIZ_SEQ_BASE` | 8_500_000 | `coop-quiz-mirror.ts:61` | `+ (counter%2048)*16 + (index%16)` | BOUNDED <= 32_768 |
| `COOP_ME_TERM_SEQ_BASE` | 9_000_000 | `coop-me-pump.ts:51` | `+ interactionCounter` | ME counter |
| `COOP_LEARN_MOVE_SEQ` | 9_000_001 | `learn-move-phase.ts:33` | FIXED, no offset | none |
| `COOP_LEARN_MOVE_FWD_SEQ_BASE` | 9_100_000 | `learn-move-phase.ts:41` | `+ partySlot` | 0-5 |
| `COOP_DEX_SYNC_SEQ` | 9_200_000 | `coop-interaction-relay.ts:49` | FIXED | none |
| `COOP_REJOIN_SYNC_SEQ_BASE` | 9_300_000 | `coop-runtime.ts:797` | `+ (Date.now() % 100_000)` | 0-99_999 |
| `COOP_BIOME_STOCK_REROLL` | 777 | `coop-interaction-relay.ts:56` | NOT a seq base - a reroll-namespace tag on the reward-options channel (`coop-biome-shop.ts:41`) | n/a |

### 4b. Collision analysis

- The counter-offset bands (6M/7M/7.5M/7.6M/8M/9M) are each 100_000-500_000 apart
  and offset by an interaction counter that increments once per interaction. A
  collision needs the counter to reach 100_000 (the tightest gap, BARGAIN 7.5M ->
  COLOSSEUM 7.6M) - practically impossible in a real run, but the narrowest margin.
- Quiz 8.5M is hard-bounded to <= 8_532_768 (`coop-quiz-mirror.ts:68`), provably
  below 9M.
- CONFIRMED numeric hazard: `COOP_LEARN_MOVE_SEQ = 9_000_001` lies INSIDE the
  `COOP_ME_TERM_SEQ_BASE + counter` band. At ME interaction counter == 1,
  `seqTerm == 9_000_001 == COOP_LEARN_MOVE_SEQ`. It is safe ONLY by lifecycle
  separation (a level-up move-learn and an in-progress ME terminal never overlap);
  the code comments assert temporal, not numeric, disjointness
  (`learn-move-phase.ts:39`, `coop-replay-learn-move-phase.ts:91`).
- Orphans: NONE. Every sent seq has a seq-matched consumer. Two outcomes
  (`learnMoveForward`, `dexSync`) are consumed by `k`-discriminated transport
  listeners (`coop-runtime.ts:800,811`) not `awaitInteractionOutcome`, so a naive
  grep would falsely flag them.

### 4c. Kind strings (18 distinct)

`meBtn`/`me`/`meSub`/`mePresent`/`meResync` (8M/9M), `quizAns` (8.5M), `coloBoard`/
`coloPick` (7.6M), `biomeShop` (7M), `bargain` (7.5M), `abilityPicker` (6M),
`revival` (95k), `switch` (90k + voluntary), `learnMove`/`learnMoveForward`
(9_000_001 / 9.1M), `dexSync` (9.2M), and a dynamic reward `label` on the raw
counter seq. All have matched senders and consumers (full send/consume table in the
seq-band trace).

### 4d. The #820 wiring test does NOT cover this

`test/tests/elite-redux/coop/coop-wiring-completeness.test.ts` asserts only (1)
every `CRITICAL_HOOKS` entry is installed by both factories (`:37-53`) and (2)
every `CoopMessage` wire-union type has a receiver (`:76-109`). It does NOT
enumerate the interactionChoice sub-protocol: no seq-band range check, no numeric
overlap check, no kind send/consume pairing. The `9_000_001`-inside-`9M+counter`
hazard and the 100k BARGAIN/COLOSSEUM margin are unguarded.

PROPOSED GUARD:
- A single registry module `coop-seq-registry.ts` exporting every band as
  `{ name, base, maxOffset }` and a `COOP_SEQ_BANDS` array, with each call site
  importing its base from there (also fixing the 4-way `COOP_ME_PUMP_SEQ_BASE`
  duplication).
- A collision test that, for every ordered pair of bands, asserts
  `base_i + maxOffset_i < base_{i+1}` - i.e. no band's max-offset value can reach
  the next band's base. This turns the `9_000_001` hazard into a hard failure (its
  band would have to declare a non-zero max offset and overlap 9M), forcing an
  explicit fixed-singleton carve-out or a relocation to a free gap (below 90_000,
  in the 5.x M range, or above 9_400_000).

---

## Part 5 - Verified #809 / #614 states

- #809 mega/tera convergence: IMPLEMENTED as a per-turn CHECKPOINT convergence, not
  a live event. The `CoopBattleEvent` union has no form/mega/tera kind
  (`coop-transport.ts:424-450`); `TeraPhase`/`FormChangePhase`/`QuietFormChangePhase`
  never call the recorder. The host writes `formIndex`/`isTerastallized`/`teraType`
  into the per-turn checkpoint (`coop-battle-checkpoint.ts:107-126`) and the guest
  adopts them at the checkpoint boundary (`coop-battle-engine.ts:875-894`, incl.
  `loadAssets`). CONSEQUENCE: the guest does NOT see the mega animation/sprite change
  mid-turn; it pops to the new form when the turn resolves. The tera TEXT line
  streams live (`queueMessage`, `tera-phase.ts:26` -> `phase-manager.ts:524`), but
  the mega text uses `ui.showText` (`form-change-phase.ts:92`) which is not tapped.
  Verdict: correct convergence, cosmetic-only residual (no mid-turn mega animation
  on the guest). NOT broken. P3 (cosmetic) if strict animation parity is required.
- #809 revival-blessing owner-pick: IMPLEMENTED. Host-side partner pick
  `revival-blessing-phase.ts:24-98` (sends `revivalPrompt` `:70`, awaits relayed pick
  `:71`, timeout falls back to the partner's first fainted mon `:87`); guest-side
  picker `coop-guest-revival-phase.ts:25-75` on `COOP_REVIVAL_SEQ_BASE + fieldIndex`.
  Covered by the wiring test (`onRevivalPrompt`, `coop-wiring-completeness.test.ts:40`).
  NOT broken.
- #809 ME-shop reroll relay / resync-during-live-shop unpark: the biome-shop reward
  channel and its 777 reroll namespace exist (`biome-shop-phase.ts:307,348`); the
  encounter audit already flags the embedded-ME-shop handoff hook as debug-gated /
  wrong-branch (that doc's row 10 / P0-item-3). Not re-audited here; defer to the
  encounter audit's fix.
- #614 doubles false game-over: REFUTED (not reproducible in current code). The
  game-over condition is `getPokemonAllowedInBattle().length === 0`
  (`faint-phase.ts:207`, also `turn-init-phase.ts:59`), which filters the WHOLE
  player party (`battle-scene.ts:948`); in co-op that party is the MERGED party of
  both players (`coop-session.ts:279-284`). So game-over fires only when the entire
  merged party is fainted - it DOES account for the partner's usable bench. The
  doubles single-survivor case is handled by the lone-survivor recenter branch
  (`faint-phase.ts:210-223`) with a regression harness
  (`test/tools/repro-doubles-false-gameover.test.ts`). Residual (NOT a game-over):
  the replacement picker is owner-gated (`switch-phase.ts`,
  `coopSwitchBlocksMonForOwner` `coop-session.ts:272`), so an exhausted owner's slot
  stays empty rather than pulling the partner's bench; the run does not end.

---

## Part 6 - Other findings (orphans / hooks / dead code / markers)

- `restoreInteractionCounter` (`coop-session-controller.ts:481`) is PRODUCTION-DEAD:
  called only from two tests. The relay interaction counter is not in
  `SessionSaveData`. Either wire it into resume or delete the unused restore path and
  document that resume re-initializes the counter identically on both clients. P2.
- `COOP_ME_PUMP_SEQ_BASE = 8_000_000` is re-declared as a local const in 4 files
  (Part 4a) instead of imported once - a change-one-miss-the-others hazard. P3.
- No sender-only relay channels and no orphaned awaiters were found (Part 4b).
- No `#809`/`#614` TODO/FIXME/"unfinished" markers remain in
  `src/data/elite-redux/coop/` or `src/phases/`; all references are descriptive
  implementation comments plus green regression/probe tests.

---

## Part 7 - Prioritized fix list

Priority key: P0 = strand / permanent-desync possible in normal single-run play;
P1 = conditional drift / cross-run desync; P2 = live but bounded (visual divergence
or heal-noise); P3 = hygiene / guard.

### P0 - none NEW here

No structural gap in this audit strands within a single normal run beyond what the
sibling encounter audit already tracks (GROUP COLOSSEUM P0, GROUP REPEAT P0, the
#821 embedded-shop hook P0-latent). The infrastructure gaps below are P1 or lower.

### P1 - conditional drift / cross-run desync

1. Mid-ME GameOver leaves stale ME pins into the next run. `clearCoopRuntime`
   (`coop-runtime.ts:1541`) resets `coopMeBattleInteractionCounter` (`:1582`) but NOT
   `coopMeInteractionStart` (`coop-me-pin-state.ts:18`) or `coopMeHostPresentation`
   (`coop-replay-me-phase.ts:46`). A stale `coopMeInteractionStartValue() >= 0` can
   mis-arm the pin-guarded detached listeners L6 (`coop-replay-me-phase.ts:757`) and
   L8 (`coop-colosseum.ts:252,462`) at the next run's first ME. Fix: reset both in
   `clearCoopRuntime`, mirroring the existing counter reset. Low-risk, high-leverage.

2. Colosseum gauntlet `misc.wins` (`colosseum-encounter.ts:260`) is not persisted
   and not synced. Subsumed by the encounter audit's Colosseum P0; when that is
   wired, persist `wins` in the ME save (or the relay's colosseum state) so a
   save/resume mid-gauntlet keeps the round.

### P2 - live but bounded

3. Stormglass `chosenWeather` (`modifier.ts:~2494`) and any other player-wide
   persistent-modifier INTERNAL arg drift is invisible to the checksum
   (`readModifiers` hashes `[typeId, stackCount]` only, `coop-battle-engine.ts:1320`)
   and heals only when an UNRELATED field triggers a full resync. Fix (systemic, see
   below): make the checksum detect modifier internal state.

4. Money-streak Summary badge divergence. `STREAKS` (`er-money-streak.ts:34`) is
   module state advanced on both clients ungated (`battle-end-phase.ts:78`,
   `faint-phase.ts:125`) and not in the checksum, so each player can see a different
   "P +N%" badge (`er-money-streak.ts:20`). Fix: stream the host's streak map in the
   resync payload, or derive the badge from a hashed/streamed value.

5. Recurring `money host!=guest -> applied` reconcile. Driven by the by-design
   guest-gated wave money (`money-reward-phase.ts:52`) PLUS two UNGATED guest money
   mutations - the slum 2%-per-faint loss (`faint-phase.ts:114`) and
   `pickUpScatteredMoney` (`battle.ts:304` via `battle-end-phase.ts:95`). Healed by
   the checkpoint `money` field so it is not a hard desync, but it is per-wave
   reconcile noise that can mask real divergences. Fix: gate those two guest money
   mutations behind `isCoopAuthoritativeGuest()` (like `MoneyRewardPhase`), or stream
   money as a discrete reward event (as EXP already is) instead of relying on the
   reconcile.

6. `restoreInteractionCounter` production-dead (Part 6). Wire it into resume or
   delete + document.

### P3 - hygiene / guard

7. Add the seq registry module + collision test (Part 4d) and consolidate the 4-way
   `COOP_ME_PUMP_SEQ_BASE` duplication. Closes the unguarded `9_000_001`-in-9M-band
   hazard.

8. Guest-side notoriety warning / relic-list / Fortune-Teller-queue latent
   divergences (Part 1 #2, #3, #9): all host-authoritative and reconverging at
   launch/save. Leave as-is unless a guest-side warning UI reads them directly.

9. #809 mega animation is checkpoint-only on the guest (no mid-turn mega animation).
   Cosmetic. Only if strict animation parity is required: add a `formChange`/`tera`
   `CoopBattleEvent` kind emitted from the form-change path, keeping the checkpoint
   convergence as the correctness backstop.

### Single highest-leverage systemic fix

Base the co-op checksum (and the resync snapshot) on a normalized
`getSessionSaveData()` diff rather than the hand-maintained field list in
`captureCoopChecksumState`. `getSessionSaveData` already serializes EVERY substrate
in Part 1 (`erMoneyStreaks`, `erWardStones`, `erRelicBattleState`, `erMapState`,
`mysteryEncounterSaveData`, and all `modifiers` as full `ModifierData` blobs with
their `getArgs` internal state). Hashing that canonical form makes the entire
"modifier internal state / module-let substrate" blind-spot class DETECTABLE and
HEALABLE by construction, closes P2 items 3-5 at once, and is exactly the
correctness definition the co-op rewrite is already moving toward (CLAUDE.md
harness Layer C). It is a bigger change than the P1 quick wins, so ship fix P1-1
(the `clearCoopRuntime` pin reset) first as an immediate, isolated cross-run-desync
close, then pursue the save-data-based checksum as the systemic follow-up.

---

## Part 8 - The switch sync matrix (task #838)

Switching is the codebase's historically richest desync source, and the ten known
fixes below already closed the P0/P1 classes. This part enumerates EVERY switch
pathway, traces it per side (host-owned player mon / guest-owned player mon / enemy
mon) on BOTH clients (host = engine, guest = renderer), and gives a STATE verdict and
a VISUAL sub-verdict per cell. It was produced by a static trace of the engine plus
the coop stream/replay/checkpoint layer; every claim cites the file it was read from.

### 8a. The single convergence mechanism (why most cells are OK by construction)

The netcode is host-authoritative. The HOST is the sole resolution engine: it draws
ALL battle RNG for every incoming pick (forced-switch roll `move.ts:7871`/`:7958`,
enemy `getNextSummonIndex` tie-break `trainer.ts:750`, enemy Revival Blessing target
`move.ts:7747`, flee `attempt-run-phase.ts:24`). The GUEST is a pure renderer that
diverts its whole turn to `CoopReplayTurnPhase` and draws NO RNG and runs NO
resolution phase, so it can NEVER pick an incoming mon locally. It converges the field
composition after every turn through the per-turn CHECKPOINT:

- `reconcileCoopEnemyField` (`coop-battle-engine.ts:363`) and
  `reconcileCoopPlayerField` (`:543`): a SPECIES-keyed reconcile. PASS 1 removes any
  on-field guest mon the host reports NOT present-and-alive (a KO or a switch-out);
  PASS 2 summons/repositions the host's reported species onto each slot via
  `summonCoopEnemyField` (`:455`) / `summonCoopPlayerField` (`:665`); a post-PASS-2
  orphan sweep clears any stale sprite. Both are side-effect-free (no FaintPhase /
  SwitchPhase, so the resolution engine is never re-entered) and IDEMPOTENT (re-apply
  safe), which is why the checkpoint can carry any switch without a fresh divergence.
- A per-mon NUMERIC apply (`applyCoopCheckpoint:852-899`) then writes the host's hp /
  status / STAT STAGES / erTags / PP / form / tera onto the mon now at each bi.
- The end-of-turn `fullField` snapshot (`applyCoopFieldSnapshot:2680`) heals the
  richer per-mon state the numeric apply omits (moveset structure, held items,
  ability, boss, transform, and general battler `tags` via `reconcileTags:1842`).
- The per-turn CHECKSUM (`readChecksumMon:1466`) hashes species / hp / status /
  statStages / abilityId / form / tera / boss / moves / tags, so any residual switch
  drift is DETECTED and a full resync `applyCoopFullSnapshot` HEALS it.

Consequences that hold for EVERY cell below: (1) the guest never rolls RNG for an
incoming pick, so a forced-switch or enemy-AI-switch cannot desync from a divergent
roll; (2) the incoming mon's stat stages, tags, ability, form, and tera all ride the
checkpoint + fullField, so Baton Pass state carry and the Roar of Time slow-start
rider converge; (3) the `coopOwner` tag is carried per mon in the checkpoint
(`serializeMonState:128-131`) and re-asserted, so ownership follows a swapped slot.

The one structural VISUAL limitation: the `switch` `CoopBattleEvent` kind
(`coop-transport.ts:496`) is DECLARED but NEVER emitted (no `recordCoopEvent({k:
"switch"})` call site exists) and NEVER rendered (`coop-replay-turn-phase.ts:301` routes
it to the checkpoint). So a MID-TURN switch (pivot / forced / item / ability / baton)
is not animated on the guest as a recall + ball-throw; the outgoing mon's move plays,
then the incoming mon appears as a CLEAN re-seated summon at the turn-end checkpoint
(no pop-in: `summonCoopPlayerField` re-seats via the real `setFieldPosition` per #791,
and `fieldMonByIdentity` per #796 prevents wrong-mon damage in the interim). This is a
deliberate tradeoff: the checkpoint reconcile is SPECIES-keyed (robust to party-order
drift), whereas an animated mid-turn switch event would have to be `partySlot`-keyed
(fragile), so riding switches on the checkpoint is MORE correct than eventing them.

### 8b. The matrix

Verdict key: OK = covered by a cited mechanism; FRAGILE = correct only via the
every-turn checkpoint / resync heal (note the symptom between heals); BROKEN = a real
desync (severity P0-P2). VISUAL sub-verdict is separate from STATE.

| # | Pathway | Side | STATE | VISUAL | Covering mechanism / note |
|---|---------|------|-------|--------|---------------------------|
| 1 | Voluntary pre-turn switch (command POKEMON) | host-owned player | OK | OK | host runs real SwitchSummonPhase; guest converges via checkpoint PASS 2 (`reconcileCoopPlayerField:584`). Guest does not eagerly mirror the HOST's switch. |
| 1 | Voluntary pre-turn switch | guest-owned player | OK | OK | guest eagerly mirrors its OWN switch side-effect-free + RNG-free (`mirrorGuestOwnSwitch`, `turn-start-phase.ts:195`), #695; host runs the real switch from the relayed command; checkpoint reconciles. |
| 1 | Voluntary pre-turn switch | enemy | n/a | n/a | enemies never voluntarily pre-turn switch (see row 9 for AI switch). |
| 2 | Faint replacement (owner pick) | host-owned player | OK | OK | host FaintPhase -> owner-gated SwitchPhase pick (`switch-phase.ts:173`), real summon path #791; guest animates the faint (`CoopFaintReplayPhase`) then materializes the replacement via the out-of-band replacement checkpoint (#788). |
| 2 | Faint replacement | guest-owned player | OK | OK | guest opens its OWN picker (`CoopGuestFaintSwitchPhase`) and relays the pick #786; host awaits + summons the guest's choice #786; species-resolved on party-order drift #799. Integration-tested: `coop-duo-faint-switch.test.ts`. |
| 2 | Both players' mons faint same turn | both player slots | OK | OK | two FaintPhases -> two owner-gated SwitchPhases; guest opens the picker only for its own slot (`maybeOpenOwnReplacementPicker`, `coop-replay-phases.ts:519`); lone-survivor recenter (`faint-phase.ts:210`), #614 refuted. |
| 3 | Pivot moves (U-turn / Volt Switch / Flip Turn / Parting Shot / Teleport) | host/guest player | OK | FRAGILE | player self-switch = owner-pick SwitchPhase (no RNG); guest plays the move on the outgoing mon then snaps the incoming at the checkpoint. `fieldMonByIdentity` (`coop-replay-phases.ts:481`) skips the incoming mon's hazard/ability damage until it materializes (#796), so no wrong-mon drain. Visual: instant swap at checkpoint, no recall/throw anim, on-entry hazard damage not animated. |
| 3 | Pivot moves | enemy | OK | FRAGILE | enemy self-switch uses `getNextSummonIndex` (seeded RNG, host only); guest converges by species. |
| 4 | Baton Pass (stat-stage / substitute / tag transfer) | host/guest player | OK | FRAGILE | `transferSummon` (`pokemon.ts:5947`) moves stat stages + baton-passable tags on the host. Stat stages ride the checkpoint (`applyCoopCheckpoint:878`); tags (incl. Substitute) ride the fullField `reconcileTags`. Now tested: `coop-switch-sync-matrix.test.ts`. Visual: Substitute doll transfer not animated (instant). |
| 5 | Forced by opponent (Roar / Whirlwind / Dragon Tail / Circle Throw) | host/guest player | OK | FRAGILE | host rolls `randBattleSeedInt` (`move.ts:7871`); #811 narrows the pool to the roared player's OWN bench so the partner's mon is never dragged; guest never rolls, converges by species. Against the PARTNER's slot: #811 holds (`move.ts:7856-7867`). Now tested: `coop-switch-sync-matrix.test.ts`. |
| 5 | Forced (enemy target) | enemy | OK | FRAGILE | host rolls `move.ts:7958`; guest converges by species. Wild target flees the battle instead of switching (`move.ts:7910`) - see the wild-flee note in 8c. |
| 6 | Item-triggered (Eject Button / Eject Pack / Red Card) | all | n/a | n/a | NOT IMPLEMENTED in this fork (no item / modifier for these exists; the only switch-effect held item is Baton). No coverage needed; noted so a future port of these items knows it must ride the checkpoint like every other switch. |
| 7 | Ability-triggered (Emergency Exit / Wimp Out) | host/guest player | OK | OK | `PostDamageForceSwitchAbAttr` -> owner-pick SwitchPhase (player holder, no RNG), host-resolved; guest converges by species. |
| 7 | Ability-triggered | enemy | OK | OK | enemy holder -> `getNextSummonIndex` (host RNG); guest converges by species. |
| 8 | ER Roar of Time / Temporal Rupture (#604 force-switch + slow-start rider) | host/guest/enemy | OK | FRAGILE | `RoarOfTimeForceSwitchOutAttr` (`move.ts:8106`) force-switches (host RNG); Temporal Rupture suppresses it (`move.ts:8107`); the SLOW_START rider sets the incoming mon's active ability, which rides the checkpoint / fullField `abilityId` (`readChecksumMon:1480`), so the rider CONVERGES. |
| 8 | ER No Turning Back (#604) | host/guest player | OK | OK | a self-TRAP + stat boost, NOT a switch (the inverse); stat stages ride the checkpoint, the NO_RETREAT trap tag rides the fullField `tags`. |
| 8 | Other ER self-switch abilities (Restraining Order / Strikeout / Tactical Retreat / Hollow Ice Zone) | all | OK | FRAGILE | all `ForceSwitchOutHelper` (host-resolved); guest converges by species; same mid-turn visual note as row 3. |
| 9 | Enemy AI mid-battle switch | enemy | OK | FRAGILE | `enemy-command-phase.ts:86` + `getNextSummonIndex` (host RNG, seeded offset `turn << 2`); guest converges via `reconcileCoopEnemyField` PASS 2. |
| 9 | Enemy trainer double-switch | enemy | OK | FRAGILE | #790 (stale replay phase parked on a consumed turn) guarded by `isTurnFinalized` + `clearFinalizedMark` (`coop-battle-stream.ts:137-160`); guest converges both slots by species. |
| 9 | Enemy sent out after KO (next trainer mon) | enemy | OK | FRAGILE | host FaintPhase -> SwitchSummonPhase (`faint-phase.ts:250`), `getNextSummonIndex`; guest removes the KOd foe (PASS 1) then summons the replacement (PASS 2). |
| 9 | Wild flee / switch | enemy | FRAGILE | OK | a forced wild flee ends the battle via `BattleEndPhase` + `NewBattlePhase` directly (`move.ts:7929-7935`), NOT `AttemptRunPhase`; see 8c for the wave-advance broadcast verification item. |
| 10 | Revival Blessing / revival item to field | host/guest player | OK / FRAGILE | OK | player revival = owner-pick relay (`revival-blessing-phase.ts:24`), #809 verified; the revived mon reappears via the checkpoint species reconcile. The BENCH mon's un-faint rides `benchParty` on a RESYNC, not the per-turn checkpoint, so between heals the guest's bench copy can lag (FRAGILE, self-heals at the next checksum mismatch). |
| 10 | Revival Blessing (enemy) | enemy | OK | OK | host rolls the revived target (`move.ts:7747`); guest converges by species. |

### 8c. The ten known fixes - re-verified on the current tree

Each was traced and still holds; no fix here weakens any of them (their tests stay
green).

- #695 guest mirrors its OWN voluntary switch: `mirrorGuestOwnSwitch`
  (`turn-start-phase.ts:195-220`), side-effect-free `summonCoopPlayerField`, no RNG.
- #699 faint auto-switch premature-victory deadlock: the authoritative guest advances
  the turn MINIMALLY instead of running the real damaging turn-end phases
  (`coop-replay-phases.ts:1010`, `coop-replay-turn-phase.ts:335`).
- #786 guest-owned faint replacement owner-pick: `CoopGuestFaintSwitchPhase` relays the
  pick; the host's `SwitchPhase` awaits it (`switch-phase.ts:99-157`).
- #788 replacement summons on the chooser's screen: the out-of-band replacement
  checkpoint (`CoopPushReplacementCheckpointPhase` unshifted at `switch-phase.ts:153`)
  is consumed mid-park and materializes the mon on the guest
  (`coop-replay-turn-phase.ts:115-147`).
- #790 enemy double-switch + stale replay phase parked on a consumed turn:
  `isTurnFinalized` / `markTurnFinalized` / `clearFinalizedMark`
  (`coop-battle-stream.ts:137-160`, `coop-replay-turn-phase.ts:70`).
- #791 switch-in seating via the real summon path (no sprite stacking):
  `summonCoopPlayerField` re-seats via `setFieldPosition(...,0)`
  (`coop-battle-engine.ts:711-733`).
- #796 presentation order (came-out-fainted): `fieldMonByIdentity`
  (`coop-replay-phases.ts:481`) resolves the actor by species and defers an
  unmaterialized actor to the checkpoint; guaranteed removal at `:602`.
- #799 party-order transposition + bench reconcile: species + `partyIndex`
  disambiguation in `reconcileCoopPlayerField` (`:598-618`) and the identity resolve in
  `switch-phase.ts:113-127`.
- #811 Roar must not drag the PARTNER's bench mon: pool narrowing to the roared
  player's own `coopOwner` bench (`move.ts:7856-7867`).
- #604 Roar of Time / Temporal Rupture force-switch + slow-start rider:
  `RoarOfTimeForceSwitchOutAttr` (`move.ts:8106`), suppression at `:8107`, rider ability
  carried by the checkpoint `abilityId`.

### 8d. Verdicts that are NOT plainly OK, and their fix or spec

No cell in this matrix is BROKEN at the STATE layer within this task's file scope: the
checkpoint species-reconcile + numeric apply + fullField + checksum + resync cover all
ten rows, and the guest draws no RNG. The residuals are VISUAL (engine-owned) plus one
wave-advance verification item.

FIXED / TESTED in scope:
- Baton Pass state carry (row 4) and forced-switch RNG-free convergence (row 5), the
  two riskiest OK-but-untested cells, now have engine-free wire-contract tests
  (`test/tests/elite-redux/coop/coop-switch-sync-matrix.test.ts`): the incoming mon's
  transferred stat stages round-trip through `serializeMonState` + `normalizeMonState`
  (clamped, length 7, identity preserved), a forced switch is detectable as a
  different `speciesId` at a fixed `bi`, duplicate species are disambiguated by
  `partyIndex` (#799), and the `coopOwner` tag follows the swapped slot.

SPEC handed to the checksum agent (coop-battle-engine.ts, out of this task's edit
scope):

- SPEC-1 (P2, enemy-side #791 seating parity). `summonCoopEnemyField`
  (`coop-battle-engine.ts:499-503`) still seats the incoming enemy with a RAW
  `fieldPosition` write + `setPosition`, the exact pattern #791 replaced on the PLAYER
  side with the real `setFieldPosition(slotFieldPosition, 0)` (which also applies the
  `setMini` / `setSlotOffset` battle-info seating). In an enemy DOUBLE switch the
  incoming foe's HP-bar can render at the wrong slot offset / size (the #791 class,
  enemy side). Fix: mirror `summonCoopPlayerField:719-733` on the enemy path (derive
  the canonical base from a live enemy ally, then seat via `setFieldPosition(...,0)`).

- SPEC-2 (P3, one-frame stale info panel). `summonCoopEnemyField` and
  `summonCoopPlayerField` call `showInfo()` but not `updateInfo()` /
  `updateBossSegments(this)` after the swap, so a freshly-summoned boss or statused mon
  shows a stale bar for one frame until the per-turn numeric apply redraws it. Fix: add
  a `void mon.updateInfo()` (and `battleInfo.updateBossSegments(mon)` for an
  `EnemyPokemon`) at the tail of both summon helpers.

VERIFY (borderline, wave-advance not switch-state):

- VERIFY-1 (row 9 wild flee). A Roar / pivot that makes a WILD foe flee ends the battle
  through `BattleEndPhase(false)` + `NewBattlePhase` directly (`move.ts:7929-7935`),
  bypassing `AttemptRunPhase`. Confirm the host still broadcasts a `waveResolved`
  ("flee") for this path so the guest runs its post-battle tail
  (`maybeRunCoopWaveAdvance`); if `broadcastCoopWaveResolved` is only wired to
  `AttemptRunPhase` / `VictoryPhase`, a Roar-induced wild flee could strand the guest
  on the resolved wave (P1). This is a battle-end concern, not switch-state, but it is
  reachable only through the forced-switch pathway so it is flagged here.

The maintainer's visual-parity checklist maps onto the above as: item 1/7 (animated
recall vs clean summon) = the accepted checkpoint-reconcile tradeoff in 8a; item 2/3
(no stacking, info-panel swap) = #791 on the player side, SPEC-1/SPEC-2 on the enemy
side; item 4 (substitute-doll placeholder) = #836 `loadAssets` in
`adoptCoopEnemiesStructural` plus the `loadAssets(true)` in both summon helpers, no
switch pathway leaves a placeholder; item 5 (shiny / name-FX re-apply) = `playAnim`
after the summon helpers' `loadAssets(true)` refreshes `refreshErShinyLabBattleFx`
(`pokemon.ts:1563`); item 6 (fainted pose) = #796 identity resolve + guaranteed
removal, and the bench replacement is never fainted; item 8 (controller banner) = the
`CoopControllerTag` is only shown on the ME / colosseum / shop paths, never during a
battle faint replacement (which uses a plain `ui.showText` waiting line,
`switch-phase.ts:105`), so it can never overlay the party-pick screen.
