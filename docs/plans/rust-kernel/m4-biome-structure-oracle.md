# M4 Biome Structure and Crossroads Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

Read-only M4-00 extraction for `m4-biome-structure-oracle.md`: the production oracle is a four-field module singleton (`currentLength`, `currentStartWave`, `leaveBiomeNow`, `overstayAnchorWave`) gated to Classic, non-Daily, non-random-biome runs. A seeded length plan makes exactly two inclusive `[7,25]` Phaser RNG draws from the address `${runSeed}:er-biome-length:${startWave}` and keeps their maximum; starts at or after wave 146 receive no roll because the worst case would reach the wave-170 finale-safety threshold. Crossroads candidates are exact in-biome spent-wave multiples of 5, strictly before the rolled end, then Victory additionally suppresses a candidate when the biome is ending or the next wave is fixed. The actual menu is `Stay` index 0 / `Leave` index 1; Stay can arm raw notoriety, while Leave sets an ephemeral exit flag and immediately chains the World Map. Proposed frozen M4 support should be only this closed structure/menu vocabulary over TOWN=0, PLAINS=1, and END=50; all downstream notoriety, relic, encounter, loot, achievement, presentation, routing, heal, and scripted callbacks must remain deferred/fail-closed.

## Source evidence

### `src/data/elite-redux/er-biome-structure.ts`

Primary oracle: constants, four run-scoped state fields, reset/restore semantics, addressable two-draw length plan, waves-in-biome arithmetic, Stay/Leave mutations, end tri-state, and exact Crossroads predicate (lines 59-288).

### `src/data/elite-redux/er-biome-routing.ts`

World Map activation gate is exactly Classic && !Daily && !random-biomes (lines 42-57); routing/pending-node state is separate from biome structure.

### `src/battle-scene.ts`

`isNewBiome` integration and fixed-next-wave deferral (lines 1646-1680); initial biome roll at genuine run start and save-load suppression (lines 2487-2508).

### `src/phases/victory-phase.ts`

Post-reward cadence/order: global-x0 shop, Crossroads scheduling gates, fixed-next-wave suppression, biome selection, warning callback, and NewBattle enqueue (lines 276-374).

### `src/phases/er-crossroads-phase.ts`

Exact Stay/Leave UI, immutable source wave/turn/biome capture, solo mutations, co-op owner/watcher operation identity, chained terminal ownership, legacy fallback, and Authority V2 fail-closed behavior (lines 149-335, 340-520, 570-855, 1032-1144).

### `src/phases/select-biome-phase.ts`

Leave continuation inherits the Crossroads pin/owner and advances once at the map terminal; deterministic END selection and downstream money/heal callbacks are outside the frozen structure vocabulary (lines 180-330, 1540-1605).

### `src/phases/switch-biome-phase.ts`

Host/solo transition order: record source biome, prepare routes, plan/apply the new extent, then materialize the arena; authoritative guest never rolls length locally (lines 130-220, 300-430).

### `src/data/elite-redux/er-map-nodes.ts`

Run reset owns biome-structure reset; save blob persists length/start/overstay anchor but not `leaveBiomeNow`; tolerant restore resets first and defaults an absent old-save start to the current wave (lines 45-70, 230-305).

### `src/data/elite-redux/er-biome-notoriety.ts`

Raw overstay is `max(0, wave-anchor)` outside the late zone; downstream escalation formulas call relic-dependent functions and are explicitly excluded from frozen M4 structure support (lines 45-177).

### `src/data/elite-redux/er-relics.ts`

Unsupported dynamic notoriety hooks: Trailblazer scale is 0.5 and loot multiplier is 1.5 when the relic callback reports held, otherwise 1 (lines 352-355, 1098-1109).

### `src/data/elite-redux/coop/coop-session.ts`

Co-op interaction owner is round-robin `((trunc(counter) % n) + n) % n`; for two players even=host seat 0, odd=guest seat 1 (lines 229-242).

### `src/data/elite-redux/coop/coop-seq-registry.ts`

Crossroads wire sequence is exactly `9_600_000 + pinned interaction counter`; Leave chains into biome-pick band `9_700_000 + pinned` without a second interaction advance (lines 88-106).

### `src/data/elite-redux/coop/coop-biome-operation.ts`

Crossroads operation identity uses current epoch, parity owner, sequence, and kind; authoritative guest commit rule and deterministic host transition identity are adjacent (lines 367-390).

### `src/data/elite-redux/coop/coop-operation-envelope.ts`

Actual operation wire string is `${epoch}:${owner}:${kind}:${pinnedSeq}` and malformed four-part IDs parse to null (lines 590-625).

### `src/data/elite-redux/coop/coop-battle-engine.ts`

Guest adoption restores host overstay anchor and extent, then host map state; map restore resets/reapplies structure before pending nodes are re-seated (lines 4624-4688).

### `src/utils/common.ts`

Legacy shared RNG helper: `randSeedIntRange(min,max)` delegates to global Phaser seeded RNG with inclusive endpoints and consumes one draw per call (lines 91-116).

### `src/enums/biome-id.ts`

Concrete supported content IDs: TOWN=0, PLAINS=1, END=50; ABYSS=24 is observed but excluded because its Bargain script is not biome-structure vocabulary (lines 3-38).

### `src/data/balance/biomes/town.ts`

Concrete route relevance: TOWN's authored base `biomeLinks` contains PLAINS, and Town's trainerChance is 0 (lines 198-214).

### `src/enums/fixed-boss-waves.ts`

Concrete fixed-wave exception evidence: Town Youngster=5, Rival 1=8, Rival 2=25, with later scripted waves enumerated through Rival 6=195 (lines 1-22).

### `src/game-mode.ts`

Unsupported notoriety trainer callback consumes a global seeded `[0,99]` draw only after its gates and succeeds on `< pct` (lines 317-329); `isFixedBattle` is the caller-used scripted-wave predicate (lines 452-459).

## Architecture and contract guidance

## 1. Frozen M4 structure contract versus observed TypeScript

### Selected content subset
Use the smallest route-relevant observed set:

- `BiomeId.TOWN = 0` — normal run start (`battle-scene.ts:1569`; `biome-id.ts:3-5`).
- `BiomeId.PLAINS = 1` — Town's concrete authored base link (`data/balance/biomes/town.ts:204-214`). World Map extras may add other choices, so this proves only that Plains is a base option, not that it is always the destination.
- `BiomeId.END = 50` — finale destination and the reason variable structure cuts out (`biome-id.ts:37`; `select-biome-phase.ts:319-326`).

Do not include ABYSS=24 in the frozen structure subset. It is observed, but its x0 slot invokes `TheBargainPhase` instead of a market (`victory-phase.ts:329-346`), a scripted callback outside the closed state/menu vocabulary.

The length function accepts a `BiomeId`, but `_biome` is intentionally unused (`er-biome-structure.ts:115-117`); identical seed/start produces identical structure for Town, Plains, or any other biome.

### Proposed Rust-owned state
A faithful closed state is:

- `length: Option<positive integer>` corresponding to `currentLength`.
- `start_wave: positive integer` corresponding to `currentStartWave`.
- `leave_now: bool` corresponding to `leaveBiomeNow`.
- `overstay_anchor_wave: Option<positive integer>` corresponding to `overstayAnchorWave`.

These are TypeScript module globals, not arena or battle fields (`er-biome-structure.ts:63-76`). Reset order/value is length `null`, start `1`, leave `false`, anchor `null` (`:79-84`). Save ownership is additive under `ErMapSaveData`: length/start/anchor are serialized (`er-map-nodes.ts:242-260`); `leave_now` is not serialized anywhere in the production call-site search.

Rust should represent `erIsBiomeEnd` as a three-way result (`NotApplicable`, `Continue`, `End`), not collapse `null` into false, because `BattleScene.isNewBiome` uses `null` to invoke vanilla cadence (`battle-scene.ts:1646-1680`).

## 2. Exact length RNG and mutation order

`planErBiomeStructure(startWave, runSeed?)` (`er-biome-structure.ts:126-148`):

1. Compute the fixed late threshold `200 - 30 = 170`.
2. If `startWave >= 170` **or** `startWave + 25 - 1 >= 170`, return `{ length:null, startWave }` and consume **zero RNG draws**. Algebraically, only starts `<=145` can roll; every start `>=146` receives `null`.
3. If `runSeed` is truthy, instantiate a fresh `Phaser.Math.RandomDataGenerator` with the one-element seed array ``[`${runSeed}:er-biome-length:${startWave}`]``. This is an addressable local stream and does not consume global RNG. An empty string is false and therefore selects the legacy global path.
4. Draw `a`, then `b`, each by `integerInRange(7,25)`, inclusive. Legacy/no-seed callers instead invoke `randSeedIntRange(7,25)` twice; that helper delegates to global `Phaser.Math.RND.integerInRange(7,25)` (`utils/common.ts:91-116`).
5. Return `length = Math.max(a,b)`. There is no percentage roll, float multiplication, snapping, modulo, or rounding in selection. There are exactly two draws when eligible and zero when clamped.

For independent uniform integer draws, the implied check distribution is `P(length=k)=(2k-13)/361` for integer `k in [7,25]`; this follows directly from max-of-two and is useful as an oracle invariant, not a separate production implementation claim.

`erRollBiomeLength` plans, then calls `restoreErBiomeStructure(plan.length, plan.startWave, null)` (`er-biome-structure.ts:115-117`). Restore mutates in this order: positive numeric length -> `floor`, else null; positive numeric start -> `floor`, else 1; positive numeric anchor -> `floor`, else null; finally leave=false (`:151-159`). It does not throw on ordinary malformed values. `setErBiomeStructureExtent` differs: invalid length becomes null, but invalid start leaves the existing start unchanged, and it preserves anchor/leave (`:198-208`).

At genuine run start, `newArena` rolls the starting structure only when routing is active, there is no current battle, and this is not save restoration; it then rolls/stashes onward routes (`battle-scene.ts:2487-2508`). At solo/host transition, `SwitchBiomePhase` records the source, clears/rolls/reveals routes, rolls the new length with `startWave = clearedWave + 1`, and only afterward materializes the new arena (`switch-biome-phase.ts:146-220`). Because seeded length uses a local address, prior route RNG cannot perturb it. The authoritative guest instead installs a temporary `{length:null,startWave:entryWave}` and never rolls; host state arrives through the carrier/resync (`switch-biome-phase.ts:176-195, 344-402`; `coop-battle-engine.ts:4637-4678`).

The exact internal Phaser 3.90 RandomDataGenerator bit algorithm is not present in production TypeScript or installed dependencies in this worktree. This extraction proves call/seed/range/order, not a Rust bitstream port; bit-exact implementation requires separately pinned Phaser upstream source or captured oracle outputs. Do not guess it.

## 3. Waves-in-biome, end, and cadence

`wavesSinceEnteredBiome(w) = w - currentStartWave + 1` with no clamp (`er-biome-structure.ts:239-242`). The end predicate order is exact (`:257-269`):

1. If `w >= 170`, return `null` even if `leave_now=true`.
2. Else if `leave_now`, return true.
3. Else if length is null, return null.
4. Else return `wavesSinceEnteredBiome(w) >= length`.

`BattleScene.isNewBiome` adds two caller rules (`battle-scene.ts:1654-1680`):

- After a switch has already rolled the next extent, `currentStartWave === clearedWave + 1` returns true so cleanup uses `NewBiomeEncounterPhase`.
- If the structure result is true but `gameMode.isFixedBattle(clearedWave + 1)`, return false and retry naturally on the later cleared wave because `spent >= length` remains true. Thus the documented “hard cap” has an observed scripted-fight override.
- Only a `null` structure result falls back to vanilla: global x10, short-biome x5, or Daily/short-biome x49. The M4 supported gate is Classic only, so its relevant fallback is global `wave % 10 === 0`.

Crossroads substrate predicate (`er-biome-structure.ts:278-288`) is true iff all are true:

- length is non-null;
- leave is false;
- wave is below 170;
- `spent > 0`;
- `spent % 5 === 0`;
- `spent < length` (strictly; never offer on an ending wave).

Victory then requires all of: the host-stated/local `biomeEnding` is false, routing active, substrate predicate true, and `!isFixedBattle(wave+1)` (`victory-phase.ts:283-302`). A Crossroads tick before a fixed next wave is **skipped**, not deferred to the following wave; the next opportunity is the next spent multiple of 5. By contrast, an actual biome end is deferred one wave at a time by `isNewBiome`.

The routing gate is exactly `gameMode.isClassic && !gameMode.isDaily && !gameMode.hasRandomBiomes` (`er-biome-routing.ts:42-57`). Non-Classic, Daily, Endless/short-biome, and random-biome cadences are outside the proposed M4 structure vocabulary.

At an x0 wave that is mid-biome, Victory queues the x0 BiomeShop/Bargain before Crossroads, and NewBattle after Crossroads (`victory-phase.ts:276-374`). Co-op has an explicit `xroads:${wave}` reciprocal barrier so both clients leave the preceding shop before pinning Crossroads ownership (`er-crossroads-phase.ts:340-466`). No guessed “approximately every 5” cadence belongs in the oracle: it is exact spent-wave modulo 5 plus the listed suppressors.

## 4. Stay/Leave menu and causal mutations

The player-facing second label is **`Leave`**, although comments call it “Move on.” Solo menu (`er-crossroads-phase.ts:258-290`):

- index 0 / label `Stay` -> `resolve(false)`;
- index 1 / label `Leave` -> `resolve(true)`;
- menu opens only from the `showText` completion callback, in `UiMode.OPTION_SELECT`, with `delay:500`;
- prompt uses `erHasNotoriety(immutableSourceWave)`: hostile wording only when raw overstay is already >0; otherwise it warns that locals turn hostile over time.

`resolve` is guarded by `resolving`, records replay value Stay=0/Leave=1, changes UI to MESSAGE, then (`er-crossroads-phase.ts:1117-1144`):

- Leave: set `leave_now=true`, then **unshift** `SelectBiomePhase(sourceWave, sourceTurn, pinnedBinding)` ahead of the already queued NewBattle, then end Crossroads.
- Stay: call `erMarkBiomeStay(sourceWave)`, then end. That function preserves an existing anchor; otherwise it sets anchor to sourceWave only if `spent >= 10`. A Stay at spent 5 is state-neutral; the first accepted Stay at spent 10 or later arms the anchor (`er-biome-structure.ts:162-174`). Stay never lengthens or rerolls the hard cap.

On the next biome entry, full restore/roll clears both anchor and leave. Raw overstay is exactly zero in the late zone, zero without an anchor, otherwise `max(0,wave-anchor)` (`er-biome-notoriety.ts:45-68`). Therefore the anchoring Stay wave itself has overstay 0; the following wave has 1.

The solo `showText` callback is UI-owned. If it never fires, production code does not apply a deterministic fallback. Frozen Rust should emit a closed menu descriptor and accept index 0/1 as an external input; it must not emulate Phaser callbacks or invent timeout behavior.

## 5. Co-op operation identity and owner rules

Crossroads constructor captures immutable source wave, source turn, source biome ID, owning runtime, and operation binding before any await (`er-crossroads-phase.ts:149-190`). Explicit non-null source wave/turn must be safe nonnegative integers or construction throws. Recovery projection validates kind, pin range, parity owner, source wave/turn, and preexisting identity; mismatch returns false (`:208-231`).

For pinned interaction counter `p`:

- two-seat owner is seat `p mod 2`: even host=0, odd guest=1 (`coop-session.ts:229-242`);
- Crossroads sequence is `9_600_000 + p` (`coop-seq-registry.ts:88-94`);
- operation ID is exactly `${epoch}:${owner}:CROSSROADS_PICK:${9600000+p}` (`coop-biome-operation.ts:367-375`; `coop-operation-envelope.ts:590-607`).

The owner gets actionable handlers; watcher gets the identical prompt/menu with cosmetic no-op handlers and adopts only the relayed/committed result (`er-crossroads-phase.ts:468-520, 652-700`). Both use choice 0=Stay, 1=Leave. Stay is the terminal and advances the shared counter once in Crossroads. Leave sets the chain pin and does **not** advance there; `SelectBiomePhase` inherits the same pin/owner even for a single-route or travel-target resolution, then advances exactly once at the map terminal and clears the chain marker (`er-crossroads-phase.ts:1032-1109`; `select-biome-phase.ts:300-326, 1560-1578`).

Choice ownership and structural RNG ownership differ: interaction ownership alternates, but host/authority owns the new biome structure roll. An authoritative guest never locally derives it and adopts host extent/anchor/map state (`switch-biome-phase.ts:344-402`; `coop-battle-engine.ts:4637-4678`).

Failure behavior is mode-specific and must not be conflated:

- Authority V2 malformed/missing committed receipt or rejected adoption remains closed, parks retry, and ultimately fails the shared session after the configured recovery ceiling; it does not guess a choice (`er-crossroads-phase.ts:734-829, 886-1029`; default retry delay 250 ms, 2 automatic retries, 125000 ms deadline at `:99-109`).
- The legacy non-V2 watcher path may deterministically fall back to `moveOn = erHasNotoriety(sourceWave)` after timeout/disconnect/reject (`:830-853`): Stay before hostility, Leave once hostile. This uses zero RNG draws.
- The `VITEST` headless auto-resolve branch uses the same predicate synchronously and does not tick the interaction counter (`:305-335`). It is test-only and must not enter the production Rust contract.

## 6. Concrete wave examples (all conditions explicit)

### Example A — rolled Town length 7 with scripted deferral
State on entry: Town(0), start=1, length=7, leave=false, anchor=null.

- Wave 5: spent=5; substrate Crossroads is true because `5 % 5=0` and `5<7`. Wave 6 is not in the fixed-wave enum, so Victory raises it even though wave 5 itself is fixed Town Youngster. Choosing Stay leaves anchor null because spent<10.
- Wave 7: spent=7 and end substrate is true. Next wave 8 is fixed Rival 1 (`fixed-boss-waves.ts:1-4`), so `BattleScene.isNewBiome` returns false; no Crossroads because `spent<length` is false.
- Wave 8: spent=8 still satisfies end. Next wave 9 is not fixed, so the transition now occurs. If the player selects the authored base route Plains(1), the new structure starts at wave 9 and restore clears leave/anchor.

This proves the fixed-fight override can exceed the nominal cap and that the end exception is a one-wave deferral here, not a guessed cadence.

### Example B — length 25, x0 collision, overstay
State: start=1, length=25.

- Substrate candidates are waves 5, 10, 15, 20. Wave 25 is excluded because `spent<length` is false.
- Wave 10 is mid-biome, so the global-x0 market is queued and then Crossroads (wave 11 is not fixed). Stay at wave 10 sets anchor=10 because it is the first Stay with spent>=10.
- Raw overstay is 0 at wave 10, 1 at wave 11, 5 at wave 15, 10 at wave 20. Prompts at waves 15 and 20 use hostile wording. The rolled end occurs at wave 25; Rival 2 is the current wave, but only a fixed **next** wave defers, and wave 26 is not fixed.

### Example C — Leave
At the wave-5 Crossroads, Leave first sets `leave_now=true` and immediately chains map selection ahead of NewBattle. Pre-170 `erIsBiomeEnd(5)` is then true regardless of length. The selected destination's entry wave is 6, and applying its extent clears leave. Town's base route includes Plains, but World Map extra nodes mean destination must remain an explicit selected result; it cannot be hardcoded to Plains.

### Example D — finale clamp

- Entry start=145 may roll. If length=25, nominal end is wave 169.
- Entry start=146 consumes zero length RNG and stores null because `146+24=170`; the Classic fallback ends at the next global x0, wave 150, not after ten in-biome waves.
- Any predicate call at wave>=170 returns structure `NotApplicable`; Crossroads is false and raw notoriety is zero. A biome entering exactly at wave 170 is therefore eligible for the vanilla wave-170 boundary even on its first wave. This global alignment is observed behavior, not “three ten-wave biomes from entry.”

## 7. Unsupported notoriety/script callbacks — defer or fail closed

The frozen M4 vocabulary may expose only raw `overstay(wave)` / `has_notoriety(wave)` for menu classification. The following production consumers are not structure transitions and must not be modeled as implicit Rust side effects:

1. **Relic-dependent scaling callbacks:** `erTrailblazerOverstayScale()` and `erTrailblazerLootMultiplier()` query live relic state; observed constants are 0.5 and 1.5 when held (`er-relics.ts:352-355,1098-1109`). Without relic state in the closed input vocabulary, escalation values are not derivable.
2. **Notoriety formulas and scripted mutations:** BST bonus and enemy over-level use `Math.round`; item-rate uses multiplication/cap; boss/trainer rates use step thresholds (`er-biome-notoriety.ts:83-177`). Their consumers mutate trainer species/BST (`er-trainer-runtime-hook.ts:1150-1173`), enemy levels (`battle.ts:176-194`), generic held-item roll count using `Math.ceil` (`battle-scene.ts:4082-4101`), resist berries (`er-resist-berries.ts:258-276`), and ward stones (`er-ward-stones.ts:374-403`). Defer them.
3. **Downstream RNG:** trainer forcing draws global seeded `randSeedInt(100)` after its trainer/fixed/gym gates and succeeds on `<pct` (`game-mode.ts:317-329`). Wild boss forcing runs inside seed offset `wave<<2`, short-circuits every-wave/x10 before a `[0,99]` roll on combined biome+notoriety pct, and can then perform a separate random-boss roll (`battle-scene.ts:2841-2872`). Resist and ward callbacks use per-enemy battle-seeded `[0,99]` draws. These draws are not part of the two-draw structure stream; do not consume placeholder Rust RNG for them.
4. **Notoriety warning presentation:** Victory synchronously tests `erBiomeOverstay(currentWave+1)===1` and queues `MessagePhase` (`victory-phase.ts:356-369`). In the normal first anchoring Stay, Victory evaluates this **before** the later Crossroads callback sets the anchor, so it cannot observe that mutation on the same wave. On the following Victory, `currentWave+1` is already two past the anchor. Reachability through any other production path is unanswered; do not claim or reproduce this warning without a separate callback trace.
5. **Other scripted continuation effects:** map option generation/extra-route RNG, travel events, `MoneyInterestModifier`, challenge-gated heal/reward, map presentation, arena tweens, weather/terrain initialization, x0 market/Bargain, and the Squatter achievement (`wavesSinceEnteredBiome>=20`) are downstream consumers and outside structure support. Return an unsupported/fail-closed outcome if such a callback is requested rather than silently no-oping or inventing a mutation.

## 8. Explicit unanswered gaps / stop conditions

- Phaser 3.90's exact RandomDataGenerator seeding/bit algorithm is external to the inspected production TypeScript. Seed address and draw contract are proven; byte-for-byte RNG output is not.
- `leaveBiomeNow` is not in `ErMapSaveData`, co-op extent, or the explicit resync setter set found by production call-site search. Full `restoreErBiomeStructure` always clears it. The ordinary Leave transaction switches immediately, but save/recovery semantics if interrupted strictly between Leave mutation and transition are not represented; Rust must not infer persistence.
- Comments call length a “hard cap,” but production caller demonstrably overrides it for a fixed next battle. The code, not the comment, is oracle.
- The warning callback's normal reachability is unresolved because of the observed Victory-before-Crossroads mutation order described above.
- Route extras can make Town offer destinations beyond Plains; this extraction proves IDs/base route, not a deterministic destination.
- No production behavior validates plan `startWave` as a positive safe integer before the pure plan call. The proposed Rust subset should accept only valid positive wave inputs and fail closed outside it rather than imitate JavaScript NaN/Infinity arithmetic.
- No tests/builds/fixtures were run or generated, per the read-only oracle-extraction constraint; all claims above are direct production TypeScript evidence at the requested oracle revision.
