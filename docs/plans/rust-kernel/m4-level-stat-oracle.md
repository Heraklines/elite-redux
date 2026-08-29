# M4 Growth, Level, and Stat Oracle

- Status: frozen M4-00 oracle evidence
- M4 base SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- TypeScript oracle SHA: `45c89493e7edec9c4da247a98cd7858b1f015c09`
- Evidence mode: read-only source extraction; observed behavior is distinguished from proposed Rust contracts and explicit gaps in the text below.

## Summary

Read-only M4-00 oracle extraction for growth/level/permanent stats at the requested `45c89493e7edec9c4da247a98cd7858b1f015c09` snapshot. Select MEDIUM_SLOW growth id 3 with Bulbasaur species id 1 as the fully observed monotone M4 slice, using Hardy 0, Adamant 3, Timid 10, and Modest 15 as concrete nature candidates. All other growth IDs are observed evidence but outside this selected slice and must fail closed—never normalize/default to id 3. Explicit oracle hazard: FLUCTUATING id 5 cumulative EXP decreases from 1,165,814 at level 99 to 1,052,000 at level 100, so `getLevelRelExp(100)` is -113,814; defer it unless a parity segment specifically requires it. Modifier/challenge/ability callback paths also remain deferred.

## Source evidence

### `src/data/exp.ts:1-107 — `GrowthRate`, `expLevels`, `getLevelTotalExp`, `getLevelRelExp``

Canonical growth IDs, level 1–99 table lookup, level >=100 formulas, 32.5%/67.5% blending, final floors, relative subtraction, and the FLUCTUATING boundary hazard.

### `src/enums/nature.ts:1-27 — `Nature``

Canonical contiguous nature IDs 0–24.

### `src/data/nature.ts:43-115 — `getNatureStatMultiplier``

Exact 1.1/0.9/1 nature mapping by permanent stat.

### `src/enums/stat.ts:4-33 — `Stat`, `PERMANENT_STATS`, `EFFECTIVE_STATS``

Stat indices and iteration order: HP=0, ATK=1, DEF=2, SPATK=3, SPDEF=4, SPD=5; permanent stats are exactly indices 0–5.

### `src/field/pokemon.ts:469-625 — `Pokemon` constructor, `levelExp``

Level/EXP initialization, seeded ID/IV and nature generation order, provided/data-source behavior, final initial stat calculation, and current-level EXP derivation.

### `src/field/pokemon.ts:1837-1878 — `getStats`, `getStat`, `setStat``

Permanent-stat storage and setter failure behavior (`value <= 0` is ignored; summon overrides use zero as no override).

### `src/field/pokemon.ts:2136-2218 — `calculateStats`, `calculateBaseStats`, `getNature``

Exact permanent-stat Number operation order, rounding, modifier/challenge seams, fusion/spliced/cursed branches, Shedinja rule, clamp, HP adjustment, and custom-nature precedence.

### `src/field/pokemon.ts:2217-2241 — `getNature`, `setNature`, `setCustomNature`, `generateNature``

Effective nature selection, immediate recomputation on nature changes, and one seeded nature-index draw when generated.

### `src/field/pokemon.ts:4761-4771 — `addExp``

Level-cap lookup, EXP mutation, multi-level while-loop, and cap overshoot discard behavior.

### `src/phases/exp-phase.ts:11-48 — `ExpPhase.start``

Player-party-index operation identity, EXP callback/multiplier/floor order, synchronous level mutation, and one deferred `LevelUpPhase(lastLevel,newLevel)` for any number of levels.

### `src/phases/level-up-phase.ts:13-137 — `LevelUpPhase.start/end``

Normal final-level stat recomputation and HP adjustment, frozen Rare Candy snapshots, one display delta across multiple EXP levels, and downstream callback-driven learn/evolution behavior.

### `src/modifier/modifier.ts:2827-2868 — `PokemonLevelIncrementModifier.apply``

Rare Candy path: callback-adjusted level count, synchronous level/EXP/stat mutation and frozen pre/post snapshots; outside the clean callback-free subset.

### `src/game-mode.ts:151-178,224-231 — `getStartingLevel`, `getMaxExpLevelForWave`, `getWaveForDifficulty``

Classic/Daily starting levels, exact wave rounding/cap formula, and Daily difficulty-wave adjustment.

### `src/battle-scene.ts:3209-3219 — `BattleScene.getMaxExpLevel``

Override precedence, ignored-cap sentinel, and current-wave/default-wave owner.

### `src/phases/level-cap-phase.ts:6-24 — `LevelCapPhase.start``

Cap phase is presentation only: reads the new cap, displays it, and updates party info; it does not mutate levels or stats.

### `src/utils/common.ts:91-107,191-200 — `randSeedInt`, `getIvsFromId``

Seeded Phaser integer source/range and exact six 5-bit IV extraction order.

### `src/utils/enums.ts:43-45 — `getEnumValues``

Nature pool is the numeric values from `Object.values`, filtered to non-strings.

### `src/data/pokemon/pokemon-data.ts:165-188 — `CustomPokemonData` constructor`

Custom nature sentinel is exactly -1; other supplied numeric values are retained.

### `src/data/pokemon-species.ts:97-148,318-334 — `PokemonSpeciesForm` constructor and `setBaseStats``

Base-stat field order and the fact that later ER initialization replaces vanilla base stats.

### `src/data/elite-redux/init-elite-redux-species.ts:232-234 — ER species initialization`

Runtime species mutation: `species.setBaseStats(draft.baseStats)` means oracle vectors must use ER dump stats, not the initial vanilla constructor literals.

### `src/data/elite-redux/er-species.ts:109-123 — Bulbasaur draft`

Final ER Bulbasaur (species id 1) base stats are [47,49,49,65,65,45].

### `src/data/balance/pokemon-species.ts:12,34,78,104,443,482 — selected/evidence species declarations`

Selected slice: Bulbasaur id 1 MEDIUM_SLOW. Additional curve evidence only: Caterpie 10 MEDIUM_FAST; Clefairy 35 FAST; Growlithe 58 SLOW; Nincada 290 ERRATIC; Illumise 314 FLUCTUATING.

### `src/enums/species-id.ts:1-71,485-641 — `SpeciesId` sequence`

Numeric species identity evidence for the candidates.

### `src/data/elite-redux/coop/coop-battle-engine.ts:4127-4170,4187-4267 — `applyFullMon``

Authoritative guest adoption and mutation order: level+EXP (only when level differs), form/ability/state/items, calculate stats, optional max-HP force, status/stages, HP last.

## Architecture and contract guidance

## Observed TypeScript oracle

### Growth functions and JS Number order
`GrowthRate` is contiguous: ERRATIC=0, FAST=1, MEDIUM_FAST=2, MEDIUM_SLOW=3, SLOW=4, FLUCTUATING=5. `getLevelTotalExp(level,growthRate)` returns cumulative EXP at the start of `level`.

For `level < 100`, production first performs `levelExp = expLevels[growthRate][level - 1]`. MEDIUM_FAST returns the table integer directly. Every other growth returns exactly `Math.floor(levelExp * 0.325 + getLevelTotalExp(level, MEDIUM_FAST) * 0.675)`: the two products are added before a single floor.

For `level >= 100`, the selected raw formula is evaluated in the written JS order:
- 0: `(Math.pow(level,4) + Math.pow(level,3) * 2000) / 3500`
- 1: `(Math.pow(level,3) * 4) / 5`
- 2: `Math.pow(level,3)`
- 3: `(Math.pow(level,3) * 6) / 5 - 15 * Math.pow(level,2) + 100 * level - 140`
- 4: `(Math.pow(level,3) * 5) / 4`
- 5: `(Math.pow(level,3) * (level / 2 + 8) * 4) / (100 + level)`
MEDIUM_FAST returns `Math.floor(ret)`. Others return `Math.floor(ret * 0.325 + getLevelTotalExp(level,MEDIUM_FAST) * 0.675)`; selected `ret` is not pre-floored. `getLevelRelExp(level,growth)` is exactly `total(level)-total(level-1)`, with no clamp. `pokemon.levelExp` is `pokemon.exp-total(pokemon.level)`.

Observed cumulative evidence `[L5,L50,L99,L100,L101]`:
- id 0 ERRATIC / Nincada 290: `[161,125000,847313,870000,896457]`
- id 1 FAST / Clefairy 35: `[116,116875,907229,935000,963331]`
- id 2 MEDIUM_FAST / Caterpie 10: `[125,125000,970299,1000000,1030301]`
- id 3 MEDIUM_SLOW / Bulbasaur 1: `[128,122517,988760,1019454,1050777]`
- id 4 SLOW / Growlithe 58: `[135,135156,1049135,1081250,1114012]`
- id 5 FLUCTUATING / Illumise 314: `[105,130687,1165814,1052000,1085276]`
`relExp(100)` is respectively `[22687,27771,29701,30694,32115,-113814]`. The id-5 decrease is an explicit oracle hazard: table index 98 supplies level 99, then level 100 switches to a different dynamic formula. Raw rows contain 100 entries, but index 99 is unreachable because the table branch is strictly `<100`.

### Selected M4 growth contract and fail-closed boundary
Select only MEDIUM_SLOW id 3 / Bulbasaur id 1 for the current clean M4 slice. It is monotone at all extracted boundaries, concretely totals L5=128, L50=122517, L99=988760, L100=1019454, L101=1050777, with rel100=30694 and rel101=31323. Growth IDs 0,1,2,4,5 are evidence for later expansion, not aliases. An unsupported numeric ID, an unknown enum value, or id 5 in a segment that did not explicitly opt into the hazard must return a typed failure/fail closed; never coerce, clamp, modulo, or default to id 3. If parity later requires id 5, preserve its negative level-100 relative threshold exactly rather than normalizing it.

The TS function itself runtime-validates neither input. Observed outside the supported contract: invalid growth with `level<100` reads a property of `undefined` and throws; non-integral/non-positive levels below 100 address absent array properties (MEDIUM_FAST can return `undefined`, blended curves become NaN); NaN takes the dynamic branch and yields NaN; invalid dynamic growth has no switch default and yields NaN. `getLevelRelExp(1)` calls total level 0 and is NaN. The Rust boundary should accept integer level >=1 only and fail before arithmetic otherwise.

### Nature IDs, field ranges, and RNG
Nature IDs: 0 Hardy, 1 Lonely, 2 Brave, 3 Adamant, 4 Naughty, 5 Bold, 6 Docile, 7 Relaxed, 8 Impish, 9 Lax, 10 Timid, 11 Hasty, 12 Serious, 13 Jolly, 14 Naive, 15 Modest, 16 Mild, 17 Quiet, 18 Bashful, 19 Rash, 20 Calm, 21 Gentle, 22 Sassy, 23 Careful, 24 Quirky.

Multipliers by stat: ATK + ids 1,2,3,4 and - ids 5,10,15,20; DEF + 5,7,8,9 and - 1,11,16,21; SPATK + 15,16,17,19 and - 3,8,13,23; SPDEF + 20,21,22,23 and - 4,9,14,19; SPD + 10,11,13,14 and - 2,7,17,22. Plus is 1.1, minus 0.9, all unmatched/HP 1. Neutral ids are 0,6,12,18,24.

Effective nature is `customNature === -1 ? nature : customNature`; custom defaults -1. Invalid numeric natures fall through as neutral in TS, but the proposed boundary should reject values outside 0–24 rather than silently neutralize. Selected nature fixtures are Hardy 0, Adamant 3 (+ATK/-SPATK), Timid 10 (+SPD/-ATK), Modest 15 (+SPATK/-ATK).

Generated nature makes one `randSeedInt(25)` over numeric enum values. `randSeedInt` delegates to global `Phaser.Math.RND.integerInRange(0,24)`. It occurs after optional ability generation, the ID draw, and conditional gender/form/shiny/variant work, so it is one local draw but no fixed global draw ordinal. Supplied nature consumes no nature draw.

Stat/IV arrays are `[HP,ATK,DEF,SPATK,SPDEF,SPD]`, exactly six entries. New-mon ID uses one `randSeedInt(4294967296)` (0..4,294,967,295 inclusive); IVs are deterministic 5-bit chunks `[25..29],[20..24],[15..19],[10..14],[5..9],[0..4]`, each 0..31, no extra draw. Supplied IVs replace derivation but the ID is still drawn. Data-source construction takes stored fields directly. The core constructor does not validate supplied array length/range; malformed arrays are an unsupported stop condition.

### Permanent-stat computation and exact rounding
Runtime ER initialization overwrites vanilla species stats. Selected Bulbasaur id 1 final base stats are `[47,49,49,65,65,45]`.

For each stat 0..5: `v = Math.floor((2 * baseStat + iv) * level * 0.01)`. There are no EVs. HP then adds `level + 10`; non-HP adds 5. Non-HP obtains nature multiplier, passes it through the nature-weight callback, and if it is not exactly 1 computes `Math.max(Math[m > 1 ? 'ceil' : 'floor'](v*m),1)`. Thus boosts use CEIL, drops FLOOR. JS Number precision is contract-significant: `50*1.1` is `55.00000000000001`, so ceil gives 56.

After branch callbacks, production calls `Phaser.Math.Clamp(v,1,Number.MAX_SAFE_INTEGER)` and `setStat`; supported finite outputs are integers 1..9,007,199,254,740,991. `setStat` ignores `<=0`. Concrete level-50 Bulbasaur with IVs `[0,31,15,16,30,1]`, no modifiers/challenges/fusion/curse:
- Hardy 0: `[107,69,61,78,85,50]`
- Adamant 3: `[107,76,61,70,85,50]`
- Modest 15: `[107,62,61,86,85,50]`
- Timid 10: `[107,62,61,78,85,56]`

### HP adjustment causal order
HP adjustment happens after new raw HP and HP callback/Shedinja override, but before storing the new max; `getMaxHp()` therefore reads the old stored max.
1. If current `hp > newRawMax` or `hp === undefined`, assign newRawMax.
2. Else if hp is truthy, read old max; if old max is truthy and newRawMax is larger, add `newRawMax-oldMax` to current HP.
3. Else, notably hp=0, leave it unchanged.
Then clamp/store max stat. Valid-state effect: increasing max preserves absolute missing HP, decreasing max only clamps if current HP exceeds new max, fainted stays 0, undefined initializes full. Shedinja species id 292 or Wonder Guard forces raw max 1 before adjustment.

Selected Bulbasaur/IV vector has max HP 19 at level 5 and 29 at level 10: hp12 becomes22, hp0 stays0, undefined becomes29, hp>29 becomes29.

### Cap formula and vectors
`BattleScene.getMaxExpLevel` first reads cap override. Positive override wins even when ignore=true. Otherwise ignore=true or negative override returns MAX_SAFE_INTEGER; otherwise use current battle wave or 1.

Mode cap order: `roundedWave=ceil(max(1,wave)/10)*10`; difficulty wave is roundedWave normally, or Daily `roundedWave+30+floor(roundedWave/5)`; `base=(1+d/2+pow(d/25,2))*1.2`; result `ceil(base/2)*2+2`. Classic: waves 1/10→10, 11/20→16, 21→24, 50→38, 100→84, 200→200. Daily: 1/10→32, 11/20→42, 50→74. Starting level is 5 normally, 20 Daily, 100 Showdown. `LevelCapPhase` only displays/refreshes; no progression mutation.

### EXP mutation and multiple-level behavior
`ExpPhase(partyIndex,expValue)` runs ExpBooster callbacks, multiplies by ability EXP multiplier, floors once, then snapshots lastLevel, calls addExp, snapshots newLevel, and queues exactly one `LevelUpPhase(last,new)` if any levels were crossed.

`addExp`: read cap; save initialExp; add exp; while `level<cap && exp>=total(level+1)`, increment level one at a time; if final level>=cap, replace exp with `max(total(level),initialExp)`. It never decrements. Cap overshoot is discarded; pre-award EXP can be retained if greater than the cap threshold. Normal `LevelUpPhase` snapshots old stats and recomputes exactly once at final level, so level/EXP temporarily advance before stats, then one final HP delta/stat update occurs.

Concrete selected Classic example: Bulbasaur level5/EXP128 +10,000 at cap10 loops to level10, resets EXP to total(10)=857, queues one `(5,10)` phase, and clean Hardy stats become `[29,17,16,19,21,14]`; hp12 becomes22.

Rare Candy is distinct: callback-adjust levelCount, add directly without the normal wave cap, conditionally set threshold EXP, friendship, synchronous recompute, freeze snapshots, queue display. Defer it unless booster semantics are modeled.

### Mutation callbacks and unsupported paths
Clean selected slice: Bulbasaur id1/base form, growth id3 only; finite integer level>=1; six integer IVs 0..31; nature ids 0/3/10/15 (or expand explicitly after fixtures); customNature -1 or valid; no challenges, modifiers, fusion, spliced-only, curse, Shedinja/Wonder Guard, or ability EXP multiplier; ordinary Classic/Daily caps with override disabled.

Deferred in observed causal order: FLIP_STAT challenge; base-stat-total modifier; base-stat-flat modifier; fusion FLIP_STAT and ceil-average; spliced ceil-half; BaseStatModifier/vitamins; cursed-stat `max(1,floor(base*0.9))`; nature-weight and incrementing-stat modifiers; Wonder Guard resolution; EXP boosters/ability multiplier; level-count booster; downstream move/evolution callbacks. Callbacks can produce floats and alter later rounding choice; ambiguity is a stop condition.

### Co-op owner/identity rules
Exp/LevelUp identify the mon by player party index. In authoritative co-op the host owns progression; guest is renderer. `applyFullMon` assigns host level then EXP only when level differs; applies form/ability/tera/items; calculates stats; can force truncated positive host max HP; restores status/stages; then sets HP last as `max(0,min(trunc(hostHp),localMax))`. If level already matches but EXP alone differs, this branch does not repair EXP—an observed gap. Rust must adopt host-owned scalar results, not independently roll guest growth.

### Explicit gaps and verification status
Stop conditions: callback-produced fractional/NaN/infinite values; Phaser Clamp behavior on NaN; extreme-level precision/overflow; malformed arrays/coercive runtime inputs; exact constructor seed state before conditional draws; override values outside ordinary disabled mode; Rare Candy boosters; fusion/challenge/item/curse combinations; callback-driven Wonder Guard; and any unsupported growth ID. Unsupported growth must fail closed, never be normalized. No test/build/fixture was run or generated, per the read-only constraint; numeric vectors were evaluated with JS Number expressions matching the cited production operation order.
