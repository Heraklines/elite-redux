# M4 Run Flow Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

M4 run-flow oracle extraction at `45c89493e7edec9c4da247a98cd7858b1f015c09`: the exact continuing-wave spine is `FaintPhase -> VictoryPhase -> [EXP/level/move children] -> BattleEndPhase -> automatic/dialogue/reward children -> interactive reward/market -> optional Crossroads -> SelectBiomePhase -> PartyHealPhase/SwitchBiomePhase -> NewBattlePhase -> NextEncounterPhase|NewBiomeEncounterPhase -> LevelCapPhase (when cap rises) -> TurnInitPhase -> CommandPhase`. `VictoryPhase` constructs the tail; `BattleEndPhase` settles the source battle but does not increment the wave; `NewBattlePhase`/`BattleScene.newBattle()` alone constructs and installs wave N+1. Recommended concrete composed segment is final enemy faint on wave 9 through the first `CommandPhase` on wave 11, with Town biome ID 0 through wave 10, a restored World-Map structure `(startWave=1,length=25,leave=false)`, wave-10 Crossroads choice `Leave`, two already-revealed pending routes including Plains ID 1, and an explicit pick of Plains. This gives a non-placeholder end wave and includes regular reward, lock/reroll, party targeting, x0 fixed rewards, Town market paid purchase, Crossroads, biome choice/switch, new-biome encounter, wave-11 level-cap presentation, and next command. It is a declarative boundary-composition fixture, not yet a certified single-seed natural-play vector: exact reward/reroll options, EXP crossing, route roll, and wave-11 enemy are callback/RNG outputs owned by other M4 oracle lanes and must be supplied as captured vectors. No claim should be made that one natural seed reaches all surfaces until those vectors are joined.

## Source evidence

### `src/phases/faint-phase.ts`

`FaintPhase.start` terminal producer. Player side with no legal Pokémon unshifts `GameOverPhase` (lines 239-245); enemy faint always unshifts `VictoryPhase`, then may queue enemy replacement phases if reserves exist (lines 273-309). This means every enemy faint enters Victory for EXP, but only Victory's no-surviving-enemy guard clears the wave.

### `src/phases/victory-phase.ts`

`VictoryPhase.start` is the authoritative tail constructor (lines 42-396). It increments defeated stats, applies party EXP unless authoritative guest, handles Mystery Encounter separately, detects final enemy clearance, broadcasts co-op resolution, then pushes phases in causal order. Continuing x9 waves push `BattleEndPhase`, optional `TrainerVictoryPhase`, automatic rewards, `SelectModifierPhase`, optional biome choice/Crossroads, then `NewBattlePhase`. Continuing x0 Classic wave 10 pushes two observed `EXP_CHARM` `ModifierRewardPhase`s when `offsetGym=false`, the mid-biome `PartyHealPhase`, `BiomeShopPhase`, `ErCrossroadsPhase` when due, and `NewBattlePhase`. Final Showdown goes to `ShowdownResultPhase`; other run finals set battle type CLEAR, add score bonus, and push winning `GameOverPhase`.

### `src/phases/battle-end-phase.ts`

`BattleEndPhase` source-battle settlement and retained co-op DATA boundary (lines 68-370). Exact solo/host mutation order after retained admission: dedupe BattleEnd; adopt legacy progression if applicable; snapshot money multiplier; increment local battle stats; on victory add battle score and advance money streak/Ward Stone/community/tactical charges; endless >=5850 replaces tail with GameOver; run `PostBattleAbAttr`; recover used balls; pick up scattered money; clear enemy held modifiers; lapse/remove lapsing modifiers; update modifiers; capture/broadcast settled wave state; destroy source enemies; end. Guest retained path applies host DATA and records only account-local stats. It never increments `waveIndex`.

### `src/phases/trainer-victory-phase.ts`

Optional trainer branch (lines 35-238). Resolves immutable source-wave trainer context, then disables menu, starts victory BGM, unshifts `MoneyRewardPhase` followed FIFO by configured modifier rewards/vouchers, applies achievements, and waits for defeated/dialogue callbacks before ending. Missing solo trainer context throws; retained guest mismatches fail the shared session closed.

### `src/phase-manager.ts`

Queue semantics (lines 392-450, 578-615, 770-773, 825-839): `pushNew` appends after existing work; `unshiftNew` inserts child work immediately after current phase; multiple unshifts are FIFO. `Phase.end()` shifts. An empty queue creates `TurnInitPhase`. These rules are required to interpret Victory's apparent push order and SelectBiome's immediate SwitchBiome subtree.

### `src/phases/select-modifier-phase.ts`

Regular reward surface. `start` resets/updates seed for first presentation, regenerates thresholds, rolls/adopts options, and opens `MODIFIER_SELECT` (lines 377-619). Negative cursor opens skip confirmation. Lock toggles `globalScene.lockModifierTiers` before recalculating displayed reroll cost (lines 930-957). Reroll deducts money, sets `globalScene.reroll`, unshifts a new `SelectModifierPhase(rerollCount+1, prior tiers, ...)`, changes UI to MESSAGE, then ends (lines 761-834). Party-target selection opens PARTY and only applies after the party callback and return-mode Promise resolve (lines 1271-1355). Free accepted choice changes mode to MESSAGE then ends; a rejected add plays error and stays open/fails shared authority as applicable (lines 1065-1184). Reroll cost uses `ceil(wave/10) * baseValue * 2^rerollCount * multiplier`, caps at MAX_SAFE_INTEGER, applies HealShopCost, then floors after Merchant's Seal (lines 1448-1492).

### `src/phases/biome-shop-phase.ts`

Wave-x0 biome market. `start` builds Town stock and opens `BIOME_SHOP`; callback index <0 enters leave confirmation, valid paid index checks stock/money and reuses modifier purchase plumbing (lines 258-466). Successful paid apply decrements money and exactly one stock count; party-target goods cross the PARTY callback before returning to the shop. Solo leave requires `showText -> CONFIRM -> revert -> setMode(MESSAGE).then(end)` (lines 470-530). Town market stock is a valid paid-purchase surface; choose a direct ball by resolved modifier identity rather than assuming displayed index.

### `src/phases/er-crossroads-phase.ts`

Crossroads lifecycle and callback boundary. On solo start it shows `Stay`/`Leave`, then opens OPTION_SELECT after the text callback (lines 249-289). `Leave` records choice 1, switches UI to MESSAGE, sets the early-leave flag, unshifts `SelectBiomePhase` ahead of queued NewBattle, then ends; `Stay` records 0 and may arm notoriety (lines 1119-1143). Co-op uses one pinned interaction: Stay terminates/advances here, while Leave carries the same pin through SelectBiome and advances exactly once at the map terminal.

### `src/data/elite-redux/er-biome-structure.ts`

World-Map structure facts. State is module-level `currentLength/currentStartWave/leaveBiomeNow/overstayAnchor`. `wavesSinceEnteredBiome = wave-start+1`; biome ends at spent>=length or early leave; Crossroads occurs when positive spent is divisible by 5 and strictly less than length (lines 240-287). Length planner draws twice, inclusive [7,25], and takes max; seeded namespace is `${runSeed}:er-biome-length:${startWave}` (lines 115-148). Restored `(25,1)` therefore makes wave 10 a provable mid-biome Crossroads without asserting a natural seed roll.

### `src/phases/select-biome-phase.ts`

Biome route decision and mechanical handoff (lines 266-490, 1286-1658). It resets the seed, honors final/travel branches, reuses pending World-Map nodes, opens ER_MAP only with >1 revealed route, and otherwise resolves deterministically. After exact destination authority, solo clears travel target, applies MoneyInterest under routing, and on nextWave%10==1 unshifts a challenge-controlled PartyHeal (or replacement SelectModifier), then unshifts `SwitchBiomePhase`, and ends. Because unshift is FIFO, heal precedes switch. In the proposed wave-10 mid-biome/Leave path, Victory already queued a pre-market heal and SelectBiome queues another post-pick heal; this double-heal ordering is observed source behavior, not to be normalized away.

### `src/phases/switch-biome-phase.ts`

Owns destination biome structure and arena replacement (lines 79-269). Before visuals it records previous biome, rolls/stashes destination onward routes, then rolls destination length with first wave `sourceWave+1`; captures last trainer/ME. Solo uses a 2000 ms outgoing tween, calls `newArena(nextBiome)`, then a delayed 1000 ms fade and only ends in its nested callback. Co-op authority materializes synchronously under an exact permit. Stale/mismatched permits park/fail closed rather than mutate.

### `src/phases/new-battle-phase.ts`

`NewBattlePhase.start` removes duplicate NewBattle phases, calls `globalScene.newBattle()`, applies optional authored/Director overrides, then ends. The core wave transition is the `globalScene.newBattle()` call; callback-heavy LLM/gauntlet branches are outside the selected clean Classic subset.

### `src/battle-scene.ts`

Run-state ownership and construction. Scene owns `arena`, `gameMode`, `score`, `currentBattle`, private player `party`, `money`, player/enemy modifiers, `seed/waveSeed`, and previous trainer/ME (lines 400-459). `newBattle()` computes N+1, resets wave seed, resolves type/format, retains old battle, installs a new `Battle`, increments its turn to 1, then runs old-battle cleanup (lines 1646-1795). Cleanup destroys enemy presentation, spreads Pokerus, resets arena/player battle data when biome/trainer/ME demands, queues Return/ShowTrainer, then pushes `NextEncounterPhase` or `NewBiomeEncounterPhase`; if a new biome raises max EXP cap, `LevelCapPhase` is pushed after NewBiomeEncounter (lines 2371-2467). Player party is the stable scene array; enemy party is owned by `currentBattle`. Field access is party prefix sliced by current arrangement capacity (lines 992-1052).

### `src/battle.ts`

`Battle` state container (lines 68-180): wave index/type/trainer, enemy levels/party, format/arrangement, started/turn/commands, participant IDs, score/loot, seed, scattered money, captured money multiplier, faint histories, and Mystery Encounter fields. Constructor establishes command maps and enemy levels. Replacing `BattleScene.currentBattle` is therefore the wave boundary; retained callbacks must keep explicit source wave/turn instead of consulting ambient currentBattle.

### `src/field/pokemon.ts`

Player party material lives in persistent `PlayerPokemon` objects stored by BattleScene. Shared core fields include numeric Pokémon id, species/form, level, EXP, HP/stats/IVs/nature, moveset, status, friendship, switch/field/transient state, and tera state (`Pokemon` around lines 341-480; `PlayerPokemon` at 8176; `EnemyPokemon` at 8912). The default Classic wave-9 cap cannot reach the post-initialization ER level-17 learn boundary. The frozen composed fixture uses Nacli species 932 at 16→17 under test-only `LEVEL_CAP_OVERRIDE=17`; Nacli has exactly one level-17 candidate (Body Slam 34) and evolves at 23.

### `src/phases/next-encounter-phase.ts`

Same-biome N+1 transition. Resets every player Pokémon's wave data, moves platforms/enemy visuals for 2000 ms, lifetime-checks the captured Battle in callback, cleans prior trainer/ME visuals, then calls encounter common. Weather/terrain setters are intentionally no-ops.

### `src/phases/new-biome-encounter-phase.ts`

New-biome N+1 transition. Host/solo resets all player battle+wave data and runs `PostBiomeChangeAbAttr` for on-field Pokémon, then starts a 2000 ms intro tween; callback calls encounter common with encounter message suppressed (lines 230-339). Co-op has exact permits and bounded watchdog callbacks; renderer never re-runs mechanics.

### `src/phases/encounter-phase.ts`

Common encounter boundary. `start` initializes replay/checkpoint hooks and, on authoritative guest, awaits/adopts host enemy party; otherwise runs encounter construction (lines 524-637). After enemy/trainer/ME assets resolve, it attaches field enemies, generates enemy modifiers/AI, changes UI to MESSAGE, sets weather/terrain, persists the session, and only then enters presentation (lines 1260-1405). Presentation tween/dialogue callbacks end the Encounter; wild encounter common shows/ends, trainer common stages summon phases (lines 1541-1735). Asset/save/UI failures reset solo or fail authoritative shared play closed. Enemy species/loadout/weather outputs are callback/RNG stop conditions unless captured.

### `src/phases/level-cap-phase.ts`

Wave-11 cap presentation callback: `setMode(MESSAGE).then`, play fanfare, show new cap, update all info, and end only from text callback. In clean Classic, the cap changes from 10 on waves 1-10 to 16 on waves 11-20 (numeric cap fact supplied by the growth oracle).

### `src/phases/turn-init-phase.ts`

Next-command boundary. Empty queue creates TurnInit; it validates active party, dispatches turn-init hooks, adds active player IDs as battle participants, resets turn data, pushes player `CommandPhase`s and enemy command phases in field order, then `TurnStartPhase` (lines 137-243). First pushed player Command is the concrete end of the proposed segment.

### `src/data/elite-redux/coop/coop-operation-envelope.ts`

Exact operation identity format is `${epoch}:${owner}:${kind}:${pinnedSeq}` despite the stale three-component comment (lines 592-626). IDs parse only as four colon-separated parts with integer epoch/owner/pin and known kind.

### `src/data/elite-redux/coop/coop-wave-operation.ts`

Wave ownership rules: host seat is numeric 0; WAVE_ADVANCE ID pins on source wave as `makeCoopOperationId(epoch,0,wave,"WAVE_ADVANCE")`; preflight requires host owner, matching epoch/kind/source wave/envelope, and applied state (lines 118-119, 681-720, 905-937). Payload states win/capture/flee/gameOver, victory kind, biome-change and next-wave tail. Duplicate/stale wave operations do not rebuild the tail; conflicts/unknown kinds reject/fail closed.

## Architecture and contract guidance

OBSERVED CAUSAL GRAPH

1. Terminal production. An enemy `FaintPhase` performs faint/post-faint mechanics and unshifts `VictoryPhase`. Victory is per faint: it awards EXP for that enemy, then returns without a wave tail if any valid enemy remains. Capture also unshifts Victory. A successful flee instead directly pushes `BattleEndPhase(false)`, optional biome selection, and NewBattle. A player wipe unshifts `GameOverPhase` and has no BattleEnd.

2. Wave-clear construction. On the last enemy, Victory freezes source wave (and retained co-op source turn where present), broadcasts host resolution before its own tail, pushes `BattleEndPhase(true)` first, then trainer-victory/automatic rewards/interactions/biome boundary/NewBattle. `applyPartyExp` may unshift EXP, LevelUp, LearnMove and Evolution children, so those drain before the already-pushed BattleEnd. This is why BattleEnd's co-op wave-end image contains settled progression.

3. Source settlement. BattleEnd is still addressed to wave N. It performs the ordered mutations listed above, captures/broadcasts the settled state after modifier lapping/update, destroys source enemies, and ends. It does not replace Battle. Retained co-op BattleEnd stores source wave and trainer-ness at construction because a speculative next Battle may already be ambient.

4. Between-wave surfaces. TrainerVictory, MoneyReward and ModifierReward are automatic child phases. SelectModifier/BiomeShop/Crossroads/SelectBiome are callback-driven public surfaces. A public handler opening is not phase completion; end occurs only after the relevant confirmation/party/Promise/network callback. For normal co-op reward and market surfaces, the interaction counter pinned at open selects the local owner by parity; the normal option owner equals pick owner, while watcher adopts/mirrors. Crossroads pins one owner; Stay advances once there, Leave carries the same pin through SelectBiome and advances once at the biome terminal. A natural multi-node biome pick pins only after the preceding boundary barrier. Deterministic/single-node biome resolution does not create an interaction tick. WAVE_ADVANCE itself is always host seat 0 and pinned to the completed wave, independent of interactive ownership.

5. Biome before wave. SelectBiome unshifts PartyHeal/SelectModifier (if due) and SwitchBiome in FIFO order, ahead of the pre-existing pushed NewBattle. SwitchBiome changes arena and destination structure while `currentBattle` is still N. Only afterward does NewBattle install N+1. This ordering is load-bearing: the destination structure start wave is N+1, and `doPostBattleCleanup(lastBattle)` uses `erBiomeJustEnteredAfterWave(N)` after the roll to choose NewBiomeEncounter.

6. New battle to command. NewBattle installs Battle N+1 with turn 1, cleanup queues Return/ShowTrainer as required, then encounter. Same-biome uses NextEncounter (wave reset; no new weather/terrain); changed biome uses NewBiomeEncounter (battle+wave reset and PostBiomeChange). If max level rises, LevelCap is appended after NewBiomeEncounter. When all presentation/LevelCap callbacks end and the queue empties, PhaseManager synthesizes TurnInit, which pushes player Command first. The first wave-11 CommandPhase is the exact segment endpoint.

CONCRETE PARITY SEGMENT PROPOSAL

- Start: wave 9, final enemy `FaintPhase`, immediately before it queues `VictoryPhase`.
- End: wave 11, turn 1, first player `CommandPhase` starts.
- Mode/state: clean Classic solo mechanics, World Map routing active; arena Town `BiomeId.TOWN=0`; structure restored as `{ biomeStartWave:1, biomeLength:25, leave:false, overstayAnchor:null }`; enough money fixed at ₽1,000,000; pending route carrier contains at least two revealed nodes, including Plains `BiomeId.PLAINS=1` and a second production-valid extra such as Forest `BiomeId.FOREST=5`; select Plains. Keep `offsetGym=false`, no Daily/Endless/Showdown/ME/ghost/Director/gauntlet, no Extra/TempExtra reward-count modifiers, no Merchant's Seal/Scrap Magnet/biome extra slots, neutral PARTY_HEAL challenge.
- Deliberate fixture inventory: pre-seed `LOCK_CAPSULE` (`modifierType:ModifierType.LOCK_CAPSULE`) so lock UI is reachable before natural wave 165; keep a Map/Upgraded-Map-equivalent already-reflected in the frozen two-revealed-node carrier. These are fixture inputs, not natural wave-9 acquisitions.
- Wave 9 interaction: first presented reward count is 3 under the neutral gates. Toggle rarity lock, reroll once, then select a captured party-target option and resolve its party slot callback. The initial and rerolled option arrays must be imported from the reward oracle; full generation cannot be asserted here because threshold/generator callbacks consume RNG.
- Progression: use an oracle-exported wave-9 source battle with test-only `LEVEL_CAP_OVERRIDE=17` where Nacli numeric species ID 932 crosses level 16 to 17 and offers only Body Slam 34. The explicit composed initial loadout is the already supported M3 set `[1,52,77,78]`; raw input replaces slot 0, producing `[34,52,77,78]`. Exact EXP, IVs, nature, stats, ownership, participation, mutation evidence, initial-loadout provenance, and override restoration remain exporter-owned inputs.
- Wave 10: because spent=10<length25, it is mid-biome. Victory runs its observed x0 automatic rewards and mid-biome PartyHeal, then Town BiomeShop. Buy one direct ball selected by resolved identity (Town stock guarantees direct ball candidates, but callback-driven displayed index is not frozen here), then confirm leave. Crossroads is due; choose Leave. ER_MAP opens from the two revealed nodes; choose Plains ID 1. SelectBiome applies interest, queues the global-x0 heal, then SwitchBiome. Switch completes before NewBattle constructs wave 11.
- Wave 11: NewBiomeEncounter for Plains ID 1, then the captured level-cap presentation and TurnInit/first Command. The parity fixture does not claim that a natural unmodified run also performs the selected wave-9 progression and every selected surface; it is explicitly oracle-composed and each join must match exact canonical/RNG/content frontiers.

RNG/DRAW/ROUNDING BOUNDARIES

- Victory tail branch decisions themselves are deterministic from game mode/wave/battle state. Trainer flavor uses `executeWithSeedOffset(..., sourceWave)` plus `randSeedItem`; ghost rewards and fixed reward generators are separate oracle surfaces.
- SelectModifier first presentation calls `updateSeed/resetSeed`, regenerates pool thresholds, obtains count, then obtains options. Reroll creates a new phase with `rerollCount+1` and prior tiers; cost formula and floor are stated above. Exact option draws stop at generator callbacks and must be captured, not guessed.
- World-Map Crossroads has no RNG once `(start=1,length=25)` is restored. SelectBiome begins with `resetSeed`; the proposed pending route carrier makes the choice input explicit and consumes no route roll there.
- SwitchBiome first rolls Plains onward routes (`rollErNextBiomeNodes`) and then rolls Plains structure. In the observed solo call, route generation is called without `runSeed`: weighted base links and each eligible extra use shared `randSeedInt`, iterating biome insertion order until at most three successes. Length then uses a separate local Phaser stream seeded `${globalScene.seed}:er-biome-length:11`, takes two inclusive integer draws [7,25], and stores `max(a,b)`. No rounding beyond integral generator outputs; restore floors positive numeric inputs.
- NewBattle resets wave seed to 11 and resolves battle type/format/enemy levels through seeded offsets/callbacks. Encounter species, trainer/ME decision, held items, weather/terrain, asset completion and save completion are deferred unless a captured encounter vector supplies them.

FAILURE AND TERMINAL CONTRACT

- Player wipe: GameOver directly; no BattleEnd/reward/NewBattle. Continuing final clear: ShowdownResult or winning GameOver; no N+1. Endless BattleEnd at wave>=5850 clears queue and unshifts winning GameOver. Mystery Encounter Victory delegates to its encounter callback graph; excluded because `continuousEncounter`/reward continuation is callback-owned. Successful flee has no EXP/reward Victory chain.
- `BattleScene.newBattle()` throws if resolved battle type is absent. Solo encounter asset/UI/save failure resets the run; authoritative co-op failures freeze/fail closed. Stale tween/Promise callbacks compare captured Battle/current phase/runtime and return without mutating a replacement boundary.
- Reward insufficient money/invalid stock/sold-out/rejected modifier does not advance; it errors and keeps the surface (or fails shared authority closed). Skip and market leave require explicit confirmation. Party-target selection is not committed until party callback and mode restoration resolve.
- Co-op operation conflict, wrong owner, wrong source wave/turn, missing retained state, unknown kind or destination permit mismatch is a closed failure. Duplicate/stale accepted IDs are idempotent and cannot re-run a tail.

EXPLICIT UNANSWERED GAPS / STOP CONDITIONS

- No exact natural run seed was observed that simultaneously produces: the required wave-9 initial and locked-reroll options, the EXP threshold/move learn, two revealed Town routes, the selected Town paid stock identity/index, and a specified wave-11 Plains enemy. Therefore this lane does not claim a natural single-seed end-to-end vector. The proposed segment is exact only when those already-resolved callback outputs are frozen as inputs by their owning oracle lanes.
- `restoreErBiomeStructure(25,1)` is a legal production state and guarantees the Crossroads, but it is not asserted as the output of a named run seed. Likewise, the pending route carrier is explicit state; a real route roll needs captured Phaser RNG output and Map visibility state.
- Full modifier generators, ability/challenge hooks (`applyPartyExp`, PostBattle/PostBiomeChange, MoneyInterest, PARTY_HEAL), Trainer/MysteryEncounter objects, asset loaders, save APIs, Phaser tweens, UI callbacks, and encounter generation are callback boundaries. Rust must close them with typed inputs/results or defer them; it must not substitute ambient mutable state or guessed values.
- TrainerVictory is fully traced but not naturally exercised by wave 9-11 Town (Town trainer chance is 0 and fixed trainer wave is 8). If the M4 fixture requires trainer dialogue/money reward execution rather than graph coverage, expand the start to final faint on fixed wave 8; the endpoint remains concrete wave 11. This is the only proposed expansion, not a placeholder.
- Lock Capsule is naturally granted before wave 165, not wave 9. Its wave-9 use is explicit fixture setup. A natural acquisition-only lock scenario requires wave 165 and cannot fit the preferred segment.
- Exact player-party IDs are runtime-generated numbers, distinct from numeric species IDs. Operation/held-item targeting must retain Pokémon runtime `id`, while declarative content uses species ID 1, move ID 6, and biome IDs 0/1/5 as stated.
