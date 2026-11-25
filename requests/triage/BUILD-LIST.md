<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: AGPL-3.0-only
-->

# Build list for the library completion pass

Sources: every "Justified-unbuilt" row and ranking in `requests/triage/B03,B04,B10,B11,B13-B18.md`, plus
`LIBRARY-DECISIONS.md` section 5. Rows asking for the same block (same formula) are merged, and every request id is kept.
Each formula was re-read in the source on 2026-11-25 (branch `decomp/all`). Where the source disagrees with a triage
row, the entry says so.

Short paths: `A` = `src/data/abilities/ab-attrs.ts`, `V/` = `src/data/elite-redux/ability-studio/vocabulary/`,
`EV/` = `V/evaluate/`, `ER/` = `src/data/elite-redux/`, `RCR` = `ER/ability-upgrades/attrs/requested-combat-riders.ts`,
`FPM` = `ER/abilities/fakemon-pitch-mechanics.ts`, `PM` = `ER/abilities/plusle-minun.ts`, `RAI` =
`ER/abilities/fakemon-pitch-raichu.ts`, `BRM` = `ER/abilities/bernerd-roster-mechanics.ts`, `NSM` =
`ER/abilities/newcomer-signature-mechanics.ts`, `VR` = `ER/init-elite-redux-vanilla-rebalance.ts`.

"Gain" means how many abilities become fully decomposed. The numbers come from the triage rankings; `[INFERENCE]` marks
counts the triage itself did not check.

## Section 5 of LIBRARY-DECISIONS.md: nothing added

Every Deferred item there still has its blocker:

| Item | Status |
| --- | --- |
| WHEN splits | The pass still may not touch declarations. |
| Number-valued form pickers | Need a `build-attr.ts` binding kind. |
| `effect.apply-tag` / `effect.arena-tag` | Need the owner's curated list. B15-8, B15-18, B15-31 and B15-38 depend on this too. |
| `time.once-per` wave | Needs a separate behaviour decision for each class. |
| `accuracy` / `cancelled` slots and `move.is-critical` | `CritUseLowerDefensiveStatAbAttr` gets no crit flag; the call site passes `isCritical` only as the `if` at `field/pokemon.ts:5676`. |
| B15 dispatch WHENs | The triage confirms that each needs an engine change. |

No section 5 alias is justified-but-unbuilt.

Out of scope even though the triage mentions them:
- B14 3.6 (`survive-lethal-hit` `hpFraction`) is triaged *Planned*, not Justified-unbuilt.
- B11-C4-04 (`setTempAbility` on the target) is not triaged Justified-unbuilt. It is the same formula as W-C28, so it
  could join that block later.

## File ownership and shared-file rules (read before any wave starts)

| Wave | Files the builder may edit | Notes |
| --- | --- | --- |
| A conditions | `V/conditions-library.ts` (new atoms), `V/conditions.ts` (only for options on the live atoms `mon.has-type` and `mon.has-ability`), `EV/conditions.ts`, `V/texts-conditions.ts` | Condition texts and browse categories live only in `texts-conditions.ts`. |
| B guards | `V/guards.ts`, `EV/guards.ts`, **`V/texts-effects.ts` (`GUARD_TEXTS`)** | There is no `texts-guards.ts`: guard texts are exported from `texts-effects.ts` (see `V/texts.ts:14`). |
| C effects | `V/effects-library.ts` (new ids and planned entries listed there), `V/effects.ts` (options on the live entries defined there: `cure-status`, `heal-percent`, `set-weather`, `set-terrain`, `force-switch-out`, `hit-n-times`, `steal-item`, `message`, `multiply-stat`), `EV/effects.ts`, `V/texts-effects.ts` (`EFFECT_TEXTS`) | Shares `texts-effects.ts` with Wave B. |
| D WHEN/slot/frame | `V/when-registry.ts`, `V/slots.ts`, `EV/frame.ts`, `V/dispatch-keys.ts`, `V/texts-whens.ts` | Every item in this wave needs a decision (see Wave D). |

Rules every builder follows:
1. **Waves B and C both write to `texts-effects.ts`.** Wave B has only three guards, and W-C18 bundles W-B3. So give B and C
   to one builder, or finish B before C starts.
2. **No edits to `V/enums.ts`, `V/params.ts` or `V/player-names.ts`.**
   - Adding an option to the shared `TARGET_OPTIONS` or `WHO_OPTIONS` puts it on every block that uses the list. That
     changes existing pickers.
   - New choices go in a `selectParam` option list that belongs to one block. Player words go in that setting's own
     `optionLabels` (a per-setting label beats `PLAYER_OPTION_LABELS`, LIBRARY-DECISIONS section 7).
3. Each wave adds its own new test file, `test/tests/elite-redux/decomp/library-completion-wave-{a,b,c}.test.ts`. Nobody
   edits `library-b19.test.ts` or `vocabulary.test.ts`.
4. Generated artifacts (`editor/data/vocabulary.json`, `workers/er-ability-ai/container/vocabulary.json`) are regenerated
   once by the integrator after all waves land, not by each builder.
5. Changes to live blocks are optional settings whose default gives exactly today's result. A live V1 effect path
   (`v1Effect` in `EV/effects.ts:73-82` and `ability-studio-rule-effect-phase.ts`) is never edited in place. A new
   setting gets its own branch in the factory.
6. Planned entries (`implemented: false`) have no running behaviour. Reworking their settings is a pure addition, as long
   as declarations that name them stay valid. Declarations list class parameter names in `params`, not effect setting
   names (for example `HitMultiplierAbAttr.decl.ts:91`), so a setting rename does not break them.

---

## Wave A: condition atoms (27 blocks: 25 buildable, 2 need a decision)

Ranked by gain. All atoms are pure reads. Requires = frame slots.

| # | Id | Kind | Formula (source) | Requires | Users (gain) | Pure? | Risk |
|---|---|---|---|---|---|---|---|
| A1 | `move.type-is-mine{includeTera}` | atom | `holder.getTypes(includeTera, false).includes(holder.getMoveType(move))` (`ER/archetypes/stab-add.ts:138-140`, negated form there; StabSuppressAura uses `getTypes(true)`, B11.md:17). Req R-B11-C5-01 | holder, move | StabAdd (59 abilities) + StabSuppressAura (Relic Stone, Titan): **61** | pure | The class reads `pokemon.getMoveType`, where `pokemon` is the holder. On `calc.move-power` the holder is the attacker, so read `frame.holder`, not `moveUser`. |
| A2 | `stat.is{stats}` | atom | `stats.includes(frame.stat)` (A:4327 `stat === protectedStat`; `ER/abilities/pressure-vessel.ts:92`). Reqs B04 8-21, R-B11-C5-03, R-B15-28 (`calc.stat-value`'s `calc.stat-is`) | stat | Enabler: StatBlend (2), Pressure Vessel, World in Pieces, FaintedAllyStatMultiplier, the `cancel.stat-*` rules. Counted with C1/C2 | pure | `frame.stat` is `raw.stat ?? stats[0]` (`EV/frame.ts:113`). Multi-stat WHENs therefore see only the first stat. |
| A3 | `stat.is-highest{stats}` | atom | `highest = stats[0]; for s of rest: if getStat(s,false) > getStat(highest,false) highest = s; return frame.stat === highest` (RCR:446-453; same scan `ER/archetypes/self-highest-stat-multiplier.ts:96-106`). Reqs R-B18-23, R-B11-C4-01 (atom form of "multiply highest") | holder, stat | SelfHighestStatMultiplier (Solar Power, Sand Force, Whiteout, Big Leaves, Ectoplasm, Sand Bender, Rite Of Spring, Sand Fiend, ...: 9+), HigherStatMultiplier. With C2: **9+** | pure | A strict `>` means a tie goes to the first stat listed. `getStat(_, false)` is the raw stat, so it does not recurse into `getEffectiveStat`. The ally form (AllyHigherStat, Flower Gift) waits for `calc.stat-value` to provide `target` (Deferred). |
| A4 | `mon.tera-type{who, type}` | atom | `p.getTeraType() === PokemonType[type]`, STELLAR allowed (RAI:123). Req R-B14-5.6 | holder / other / ally | With A5: 13 MoveTypeChange abilities of B02-14 + Electrodynamics riders: **~14** | pure | none |
| A5 | `mon.species{who, species}` | atom | `p.hasSpecies(SpeciesId[species])` (RAI:124). Req R-B14-5.7 | holder / other / ally | same as A4 | pure | Resolve the setting through `SpeciesId`, failing on unknown names like `moveIdOf` does. |
| A6 | `move.type-counts-as{type}` | atom | `new Set([move.type, ...every active ability attr of the holder's getTriggeredMoveTypes(move)]).has(type)` (`ER/archetypes/post-attack-scripted-move.ts:162-170`). The source iterates `pokemon.getAllActiveAbilityAttrs()`, not one attr. Req R-B10-c3-07 | holder, move | PostAttackScriptedMove: Volcano Rage, Frost Burn, High Tide, Ebb and Flow, Glacial Rage, Frost Dragon, Lunar Wrath: **7** | pure | none |
| A7 | `status.asleep-or-comatose{who}` | atom | `p.status?.effect === SLEEP \|\| isComatoseLike(p)` (A:8460-8463). Req R-B10-23 | holder / other | Sweet Dreams, Peaceful Slumber (**2**), Bad Dreams foe filter | pure | none |
| A8 | `move.accuracy{cmp, n}` | atom | `move.accuracy >= 0 && compare(move.accuracy, cmp, n)` (`ER/archetypes/priority-modifier.ts:227`) | move | Sighting System, Iron Barrage: **2** | pure | -1 (never misses) must stay false for every comparison. |
| A9 | `time.hits-taken{who, cmp, n}` | atom | `compare(p.battleData.hitCount, cmp, n)` (`src/data/pokemon/pokemon-data.ts:537`). Req R-B11-C2-01 | holder | Lucky Halo: **1** | pure | none |
| A10 | `time.last-move-type{who, type}` | atom | `allMoves[p.getLastXMoves(1)[0]?.move]?.type === PokemonType[type]`, false when there is no last move (B11.md:83). Req R-B11-C2-12 | holder / other | Energized: **1** | pure | none |
| A11 | `move.sets-weather` | atom | `move.hasAttr("WeatherChangeAttr")` on `frame.move` (already a `Move`, `EV/frame.ts:95`). Req R-B11-C1-07 | move | Forecast follow-up gate: 1 (full only with C32) | pure | none |
| A12 | `move.spread` | atom | `move.isMultiTarget()` (`src/data/moves/move.ts:484-498`; NSM:1334-1336). Req R-B13-39 | move | CenterSpreadReduction class fully bound; **0** abilities | pure | none |
| A13 | `move.can-be-multi-strike-enhanced` | atom | `move.canBeMultiStrikeEnhanced(holder, true, other)` (A:2012-2013 and A:2067-2068). Req B17 R30 | holder, other, move | With C8: HitMultiplier (~10 constructions) + AddSecondStrike users: **~10 [INFERENCE]** | pure | Read `frame.other` (`opponent`); null is allowed. |
| A14 | `time.acted-before{first, second}` | atom | `pokemonActedBefore(first, second)`: index in `getLastTurnOrder()`; first absent gives false, second absent gives true, otherwise compare (`ER/abilities/relativity.ts:53-62`). Req R-B15-36 (atom only) | holder, other | RelativityDefenseReduction: **1** (Relativity's offence attr stays dispatch-blocked) | pure | Call the exported helper, do not copy it. |
| A15 | `foe.average-defense-not-higher` | atom (feasibility: a foe exists and both averages are > 0) | Over `holder.getAdjacentOpponents()`, skipping nulls: `round(sum DEF_eff / n) <= round(sum SPDEF_eff / n)` (A:3618-3650). Req B03 c3-41 | holder | Download: **1** | pure | `getEffectiveStat` runs the foes' stat abilities. It has no RNG and no writes. |
| A16 | `field.aura-on-field{aura: dark \| fairy \| either}` | atom | `getField(true).some(p => abilityQuery(p, DARK_AURA_FIELD) [\|\| FAIRY_AURA_FIELD])` (`src/data/abilities/init-abilities.ts:1350, 1356, 1365`). Req B03 c2-29 | (none) | Aura Break (3 attrs), Nihil Blaster: **0** until the `extra` binding slot exists | pure | none |
| A17 | `mon.has-type` option `originalIfStellar` | option on live atom | `p.isOfType(type, true, true)` when set; default `isOfType(type)` = today (`EV/conditions.ts:524-527`; `src/field/pokemon.ts:2880-2886`). Req B04 11-31 | as today | Flower Veil, Jungle's Guard: **0** now | pure (default unchanged) | Edits `V/conditions.ts` params of a live atom used by 31 declaration files. The default must stay byte-identical. |
| A18 | `mon.has-ability` / `party.ally-ability` accept Elite Redux abilities, plus option `current` | resolver widening on live atoms | `abilityIdOf(name)`: try `AbilityId`, then `ErAbilityId`, then the registered ability list (for ids missing from the enum, such as 6062/6063 in `ER/.../fakemon-pitch-abilities.ts:68-69`). Same shape as `moveIdOf` (`EV/conditions.ts:90-100`). Test `p.hasAbility(id)`; `current` tests `p.getAbility().id === id`. Reqs R-B11-C4-13, R-B11-14, R-B14-5.3 | as today | Soul Linker (2 classes), Temporal Rupture (3 attrs), Psionic/Electrodynamics riders, Overloaded: **~2** | pure: names that resolve today resolve the same way; only names rejected today start to resolve | `AbilityId` must be tried first (same rule as moves). |
| A19 | `move.chosen-is-damaging` | atom | `m = allMoves[turnCommands[holder.getBattlerIndex()]?.move?.move]` (only when that id is truthy); `m?.category === PHYSICAL \|\| SPECIAL` (A:7900-7904). Req R-B18-3 | holder | Quick Draw (vanilla) + ER provenance class: **2** together with B1, C38 and D4 | pure | Clause order in the class: `!simulated`, then the RNG draw, then this, then `canAddTag`. A rule must keep that order, because the draw happens even for a status move. |
| A20 | `party.any-ally-active` + `party.active-ally-chose-damaging-move` | 2 atoms | `ally = holder.getAllies().find(a => a?.isActive(true))` (PM:111-113). Second atom: `cmd = turnCommands[ally.getBattlerIndex()]; cmd?.command === FIGHT && cmd.move?.move !== undefined && allMoves[cmd.move.move]?.category !== STATUS` (PM:75-87). Reqs R-B14-5.8, 5.9 | holder | SynchronizedCurrentBothAttackPower: 1 attr, **0** abilities | pure, as dedicated atoms | The triage's alternative (`who: first-active-ally` in `holderLikeOf`) is D5 and needs a decision. Different from A19: this one checks `command === FIGHT` and `!== STATUS`. |
| A21 | `time.attacked-this-turn{who}` | atom | `p.turnData.acted && last && last.move !== NONE && allMoves[last.move]?.category !== STATUS` (PM:102-108). Req R-B14-5.10 | holder | SynchronizedCurrentHeal gate: **0** | pure | none |
| A22 | `mon.charge-stacks{who, cmp, n}` | atom | `compare(getCharge(p), cmp, n)` (`ER/abilities/charge-stack.ts:31-33`). Req R-B14-6.2 | holder | Overloaded (Power, Priority, Chip), CapacitorBank: **1** with C37 + A18 | pure | The store is a module `WeakMap` shared by 3 abilities and engine hooks (`pokemon.ts:67, 8724`), so it is not the private memory that section 5 rejects. It is not serialized; that is the same as the class. |
| A23 | `mon.mega-evolved{who}` | atom | `!!p && p.isMega()` (FPM:1367) | holder / other | With A24 and the existing `mon.terastallized`: Stellarize, Bejeweled: **2** | pure | none |
| A24 | `mon.gigantamax-form{who}` | atom | `!!p && /gmax\|gigantamax/i.test(p.getFormKey())` (FPM:1367) | holder / other | as A23 | pure | none |
| A25 | `time.max-uses-per-wave{key, max}` | atom | `count of entries k in holder.waveData.entryEffectsFired with k.startsWith(key + "#") < max` (`ER/archetypes/post-summon-scripted-move.ts:109-117, 137-141`). Req R-B10-c5-01 | holder | Wishmaker, Daydreamer: the triage says 2. **[INFERENCE] 0 alone**: the write (`add(key#n)`, :176-181) stays in the class, and no effect writes it. | pure | The class passes when `simulated` before reading memory (:131-134). A rule has to put the preview check first. |
| A26 | `matchup.defender-has-type{type}` | atom | `frame.defenderTypes.includes(type)` (FPM:2011-2017) | **new slot `defenderTypes`** | MiracleBlade gate: 0 | **needs owner/engine decision: do not build in this pass.** Needs D2. | none |
| A27 | `move.effect-chance-between{above, below}` | atom | `chance > above && chance < below` (`ER/ability-upgrades/attrs/optional-secondary-effect.ts:14-16`). Req R-B18-11 | **new slot `effectChance`** | Aroma Veil (2 classes): 1 | **needs owner/engine decision: do not build in this pass.** Needs D3. | none |

Wave A counts: **25 buildable** (A20 counts as 2 ids), **2 need a decision** (A26, A27).

## Wave B: guards (3 blocks, all buildable)

| # | Id | Formula (source) | Requires | Users (gain) | Pure? | Risk |
|---|---|---|---|---|---|---|
| B1 | `not-simulated` (one id for B14 `not-simulated`, B18 `not-while-previewing`, B02) | `!frame.simulated` (FPM:1812, 1890, 2136, 2176, 2220, 2263; A:7906) | simulated | SouthernCrossPunch, BitterDrill, BoobyTrap (×2), Ofuda, LowTideWaterSurf, Quick Draw ×2: **0 now, up to 6** (their DOs need C32/C36) | pure | No guard reads `simulated` today. Using it on `calc.speed-bypass` needs D4, and that engine call passes no `simulated` at all (`src/phases/turn-start-phase.ts:292`), so it is always true there, as in the class. |
| B2 | `another-holder-keeps-weather{weather}` | `!getField(true).some(p => p !== holder && p.getAbilityAttrs("PreLeaveFieldClearWeatherAbAttr").some(a => a.weatherType === weather))` (A:4203-4210). Req B04 4-10 | holder | PreLeaveFieldClearWeather (6): with C21 **4** (Delta Stream now; Primordial Sea, Desolate Land, Desolate Sun once AiMovegen is exempt) | pure | It reads the class field `weatherType` of OTHER holders. A composed carrier does not have that field, so it is invisible to this scan. That is the same blind spot as the class. |
| B3 | `foe-can-be-trapped` | `!other.isOfType(GHOST, true, true) && !other.hasAbilityWithAttr("RunSuccessAbAttr")` (A:6871-6875). Req R-B13-32 / R-B06-18 | other | Bundled by C18 | pure | `other` comes from `raw.opponent` of `CheckTrappedAbAttr` (`EV/frame.ts:93`). |

Wave B counts: **3 buildable, 0 need a decision.** The texts go in `GUARD_TEXTS` in `texts-effects.ts`.

## Wave C: effects (38 blocks: 36 buildable, 2 need a decision)

Ranked by gain.

### C1 `effect.add-stat-share{stat?, sourceStat, share, replace}`

- **Kind:** calc, `modifies: statValue`, on `calc.stat-value`.
- **Formula:** `bonus = floor(holder.getStat(sourceStat, false) * share); statVal = replace ? bonus : statVal + bonus`. The optional `stat` setting makes it run only when `frame.stat === stat`. Sources: `ER/archetypes/speed-bonus-to-stat.ts:139-145`, `ER/archetypes/stat-blend.ts:64-67` (add only).
- **Requests:** R-B11-C4-06, R-B11-C5-04.
- **Requires:** holder (stat when `stat` is set).
- **Users (gain):** SpeedBonusToStat (15) + StatBlend (Best Offense, Magus Blades, with A2): **17**.
- **Pure?** pure.
- **Risk:** `Math.floor` on the bonus only.

### C2 `effect.multiply-stat`: implement the planned entry, and allow `stat` = "the stat being calculated"

- **Kind:** planned → implemented, calc `statValue`.
- **Formula:** feasibility `frame.stat === stat` (skipped for "the stat being calculated"); run `statVal.value *= multiplier` (A:2416-2421; `self-highest-stat-multiplier.ts:109-111`).
- **Requires:** stat.
- **Users (gain):** StatMultiplierAbAttr family (11 declaration files), SelfHighest (with A3): **9+**.
- **Pure?** pure (planned entry, `V/effects.ts:202-214`).
- **Risk:** Numbers stay unrounded, as in the class.

### C32 `effect.scripted-move-at{moveId, power?, aim, alwaysHit, powerShare?}`: NEW id

- **Kind:** event.
- **Formula, by `aim`:**
  - `first-living-foe` / `every-living-foe` / `holder`: `ER/archetypes/post-summon-scripted-move.ts:157-190` (`getOpponents().filter(!fainted)`, `[0]` or all; none means do nothing).
  - `move-targets`: `getMoveTargets(holder, moveId).targets`, nothing if empty (FPM:2275-2284).
  - `neighbour-ally` with `powerShare`: `max(1, floor(move.power * share))` (FPM:976-984).
  - Fixed move at the first standing foe (FPM:1470-1476).
  - The move's own power and timing FIRST (R-B11-C1-08).
- **Common to every aim:** MovePhase `INDIRECT`, nothing when simulated.
- **Requests:** R-B10-14, c4-07, c5-03; R-B11-C1-05, C1-08; B14 C3-b; B17 R35.
- **Requires:** holder (`other` only for `aim: other`).
- **Users (gain):** PostSummonScriptedMove (40 attrs), PostTurnScriptedMove (Sumo Wrestler, Cool Exit), PostItemLostScriptedMove, OnOpponentSwitchOut, PostWeatherMoveFollowUp (Forecast with A11), Low Tide, Splash Damage / Somniloquy (with C36): **large, abilities not counted [INFERENCE ≥ 10]**.
- **Pure?** pure **as a new id**. Making the live `effect.scripted-move` (`V/effects.ts:425-440`) drop `requires: ["other"]` would change validation for its 14 declaration users. Don't.
- **Risk:**
  - `alwaysHit` has to be the mechanism the archetype uses (re-read `post-summon-scripted-move.ts:183-200` when building).
  - The existing indirect-chain feasibility (`params.useMode !== INDIRECT`, `EV/effects.ts:194-198`) belongs only to the `other` aim. The archetypes do not have it.

### C8 `effect.hit-n-times`: rework the planned entry to "add {extraStrikes} hits"

- **Kind:** planned, calc `hitCount`.
- **Formula:** `hitCount.value += extraStrikes` (`ER/archetypes/hit-multiplier.ts:190`). Today the setting `count` reads as "set to".
- **Request:** B17 R34.
- **Requires:** none (A13 is the gate).
- **Users (gain):** HitMultiplier family: **~10 [INFERENCE]**.
- **Pure?** pure (planned, `V/effects.ts:258-267`; declarations list class parameter names).
- **Risk:** ErMultiHeadedAbAttr.decl (B09) also names this effect with a per-species count. The label and summary must say "add".

### C13 `effect.set-weather` option `turns`

- **Kind:** option on a live effect.
- **Formula:** after the existing V1 set, `if (!simulated && arena.weather?.weatherType === W && arena.weather.turnsLeft > 0) { t = erFieldTurnsWithItems(holder, turns); turnsLeft = maxDuration = t }` (VR:2264-2280, ErWeatherSummonAbAttr).
- **Request:** R-B16-13.
- **Requires:** holder.
- **Users (gain):** ErWeatherSummon / ErBiomeChangeWeather: **10**.
- **Pure?** pure: no `turns` means today's runner path is unchanged.
- **Risk:**
  - **The formula differs from the triage.** B16 proposes `trySetWeather(W, holder, turns)`. The class instead overwrites the turns after the set, including when that weather was already up. Lift the class.
  - `erFieldTurnsWithItems` (VR:2257) is module-private. Export it, or the integrator owns that one-line export.

### C9 `effect.cancel-recharge`

- **Kind:** event.
- **Formula:** `if (!simulated) { removeTag(RECHARGING); q = getMoveQueue(); if (q[0]?.move === NONE) q.shift() }` (`ER/archetypes/post-victory-clear-recharge.ts:50-58`).
- **Request:** R-B11-C1-06.
- **Requires:** holder.
- **Users (gain):** Rampage, Berserker Rage, Master Hand, Raging Goddess, Qigong, Drake Of Rage, Going Berserk: **7**.
- **Pure?** pure.
- **Risk:** none.

### C10 `effect.hurt-percent-of-max-hp`: extend the planned entry

- **Kind:** planned, event.
- **New settings:** `targets: foes | everyone-else` (`getOpponents()` / `getField(true).filter(p => p !== holder)`, `ER/abilities/post-turn-hurt-non-typed.ts:121-126`), `sparedTypes` (skip `isOfType(t)`, :242-246), `poisonHealRecovers`.
- **Formula:** per target, the BlockNonDirectDamage dispatch (:217-221), then `toDmgValue(maxHp * f)` (:201).
- **Request:** R-B15-24.
- **Requires:** holder.
- **Users (gain):** Parasitic Spores, Funeral Pyre, Trash Heap, Flame Coat, Winter Throne, Christmas Nightmare, Decomposer: **7**.
- **Pure?** pure (planned, `V/effects-library.ts:350-356`).
- **Risk:**
  - The effect dispatches `applyAbAttrs("BlockNonDirectDamageAbAttr")`, so it recurses into ability code.
  - Two-Faced / Overloaded must not be rebound to it: it can faint (README).
  - Re-read the Poison Heal branch in full when building.

### C11 `effect.remove-type{who, type, fallback: UNKNOWN | NORMAL}`

- **Kind:** event.
- **Formula:** `rest = getTypes().filter(t => t !== type); summonData.types = rest.length ? rest : [fallback]; updateInfo()`, nothing when simulated. The archetype falls back to NORMAL (`ER/archetypes/post-attack-remove-target-type.ts:73-74`); the ab-attrs class falls back to UNKNOWN (B10.md:164). A Tera target keeps its Tera type.
- **Request:** R-B10-c3-05.
- **Requires:** holder, other.
- **Users (gain):** Illuminate, Refrigerator, Chandelier, Depth Explorer, Spectacle: **5**.
- **Pure?** pure.
- **Risk:** The fallback must be a setting. The two sources disagree.

### C14 `effect.set-terrain` option `turns`

- **Kind:** option on a live effect.
- **Formula:** after the set, `if (terrain.turnsLeft > 0) terrain.turnsLeft = erFieldTurnsWithItems(holder, turns)` (VR:2332-2337, ErTerrainSummonAbAttr).
- **Request:** R-B16-19.
- **Requires:** holder.
- **Users (gain):** ErTerrainSummon: **5**.
- **Pure?** pure (default unchanged).
- **Risk:**
  - Same private helper as C13.
  - Do not use `trySetTerrain`'s own override: it bypasses the extender.

### C6 `effect.set-accuracy{accuracy}`

- **Kind:** calc, `modifies: accuracy`, on `calc.accuracy`.
- **Formula:** feasibility `accuracy.value !== -1 && accuracy.value < N`; run `accuracy.value = N` (A:5134-5140).
- **Request:** B17 R33.
- **Requires:** none (`move.is-move` is the gate).
- **Users (gain):** SetMoveAccuracy (5 constructions: Hypnotist, Lunar Eclipse, ...): **~5 [INFERENCE]**.
- **Pure?** pure.
- **Risk:** The feasibility is the class residual and must be locked.

### C4 `effect.stat-stage-on-highest{target, stats, stages, tie: first | last, source: in-battle | stored}`

- **Kind:** event, NEW id.
- **Formula:** pick by `getStat(s, false)` with a strict `>` scan, first listed wins (`ER/archetypes/self-highest-stat-boost-on-summon.ts:88-102`). Other forms:
  - Positive Feedback: `getStat(DEF) >= getStat(SPDEF) ? DEF : SPDEF` on **stored** stats (PM:380-387).
  - `getStat(SPDEF, false) > getStat(DEF, false) ? SPDEF : DEF` (RCR:569).
  - `ER/archetypes/type-immunity-highest-attack-stat-stage.ts:50-51`.
- **Then:** `StatStageChangePhase`, nothing when simulated.
- **Requests:** R-B11-10, B14 C6-c, R-B18-32 (+ B12-32 twin).
- **Requires:** holder (other for the foe target).
- **Users (gain):** Sun Worship, Sea Guardian, Greater Spirit, Majestic Moth, Berserk DNA, Turf War: **6**. Positive Feedback, Lightning Rod / Storm Drain / Sap Sipper / Reservoir / Lightning Aspect, Wind Rider and B18-32 get partial gains: the immunity ones need two effects on one WHEN.
- **Pure?** pure as a new id. Do not add `statPick` to the live `effect.stat-stage` (V1 runner, 13 users).
- **Risk:**
  - `tie` and `source` really differ per class. Default them to the SelfHighest form.
  - Positive Feedback reads stored stats (`bypassSummonData = true`, `pokemon.ts:1998-2004`).

### C5 `effect.ignore-secondary-effects`

- **Kind:** calc, `modifies: effectChance`, on `calc.incoming-effect-chance` / `calc.effect-chance`.
- **Formula:** feasibility `chance.value > 0`; run `chance.value = 0` (A:1804-1810, 1822-1828).
- **Requests:** R-B18-12, R-B11-07 (`zero-effect-chance` / `noMoveExceptions`).
- **Requires:** none.
- **Users (gain):** IgnoreMoveEffects (Shield Dust, Bad Luck, Scarecrow), UserFieldIgnoreMoveEffects (Desert Cloak), SandSecondaryEffectImmunity (Dune Veil), IgnoreOptional* (Aroma Veil, which also needs A27): **~6**.
- **Pure?** pure (new id).
- **Risk:** This is not `multiply-effect-chance ×0`: that effect refuses Order Up and Electro Shot.

### C3 `effect.multiply-stat-per-fainted-ally{share}`

- **Kind:** calc `statValue`.
- **Formula:** `statVal *= 1 + share * party.filter(a => a.id !== holder.id && a.isFainted()).length`, with the party by side (RCR:411-415).
- **Request:** R-B18-29.
- **Requires:** holder (stat via A2).
- **Users (gain):** FaintedAllyStatMultiplier (2 sites) + Soul Harvest (B12-03): **~2**.
- **Pure?** pure.
- **Risk:** Not `party.fainted-count`: that one counts the holder.

### C21 `effect.clear-weather` setting `keepExtreme` (default true = the B09-20 formula)

- **Kind:** planned.
- **Formula:** for `false`: `if (!simulated) arena.trySetWeather(NONE)` (A:4021-4024, 4214-4217; `arena.ts:465-467` lets NONE past the immutable guard).
- **Request:** B04 2-03.
- **Requires:** none.
- **Users (gain):** Counted with B2: **4**.
- **Pure?** pure (planned).
- **Risk:** The default must be the extreme-keeping B09-20 formula.

### C15 `effect.drain-adjacent-foes{percent, onlyTrapped}`

- **Kind:** event.
- **Formula:** for each adjacent foe that is alive with hp > 0 (and `isTrapped()` if set): `damageAndUpdate(toDmgValue(maxHp * f), {result: INDIRECT})`, then `applyAbilityDrainRecovery(holder, foe, lost, msg)`. Feasibility: some foe qualifies (`ER/archetypes/post-turn-drain.ts:71-94`).
- **Request:** R-B10-c5-05.
- **Requires:** holder.
- **Users (gain):** Life Steal, Soul Tap, Poseidon's Dominion: **3**.
- **Pure?** pure.
- **Risk:**
  - The feasibility scans `getOpponents()`, but the run scans `getAdjacentOpponents()`. Keep both, as written.
  - A foe that reverses draining damages the holder.

### C12 `effect.change-own-type`: widen the planned entry to `{who, type | the move's type}`

- **Kind:** planned.
- **Formula:** `summonData.types = [type]; updateInfo()`, nothing when simulated. The move's type is `moveUser.getMoveType(move)` (B10.md:162).
- **Request:** R-B10-c3-03.
- **Requires:** holder (other, move, moveUser for those choices).
- **Users (gain):** Damp, Magical Dust, Paint Shot: **3**.
- **Pure?** pure: planned entry with 0 declaration references.
- **Risk:** Rename the label to "Change a Pokemon's type to one type".

### C19 `effect.use-weaker-defense`

- **Kind:** calc on `calc.defensive-stat-pick`.
- **Formula:** `d = params.defender; statHolder.value = d.getEffectiveStat(DEF) <= d.getEffectiveStat(SPDEF) ? DEF : SPDEF`; nothing if there is no defender (A:4806-4813, 4838-4845; `pokemon.ts:5686-5688`).
- **Requests:** B04 15-44, R-B13-38b, R-B08-40.
- **Requires:** none. It reads `params.defender` through `holderField`; `frame.other` is **not** filled for this WHEN, because the frame builder does not read `defender` (`EV/frame.ts:93`).
- **Users (gain):** Deadeye now; Hunter's Mark and Celestial Bow after: **1-3**.
- **Pure?** pure **if it declares `modifies: "statValue"`** (the WHEN's current string, `when-registry.ts:720-729`). The `statChoice` rename and the `defender` frame mapping are D6.
- **Risk:** `getEffectiveStat` runs the defender's stat abilities, as in the class.

### C18 `effect.trap-foe`

- **Kind:** calc, `modifies: trapped`, on `calc.trap-check`; bundles guard B3.
- **Formula:** `trapped.value = true` (A:6879).
- **Request:** R-B13-32 (R-B06-18).
- **Requires:** other.
- **Users (gain):** Arena Trap, Salt Circle: **2** now; 5 after R-B06-17.
- **Pure?** pure.
- **Risk:** Depends on B3 existing, because guards are checked at load. Same builder as B3.

### C33 `effect.steal-item` options `from: other | any-foe`, `pick: random-takeable`

- **Kind:** planned.
- **Formula:** candidates are the transferable held items of the opponents that `canTransferHeldItemModifier` allows; `tryTransferHeldItemModifier(c[holder.randBattleSeedInt(c.length)], holder, false)`; no draw when there are no candidates (BRM:353-381).
- **Request:** B17 R39.
- **Requires:** holder.
- **Users (gain):** ErMagicianSteal, VoidPostTurnSteal: **2**.
- **Pure?** pure (planned).
- **Risk:** **RNG:** one `randBattleSeedInt` draw, only when non-empty.

### C17 `effect.force-switch-out` option `who: holder | other`

- **Kind:** option on a live effect.
- **Formula:** for `other`: `helper.switchOutLogic(source)`, feasibility `getSwitchOutCondition(source, holder)` (PostDamageForceAttackerOut, B10.md:163).
- **Request:** R-B10-c3-08.
- **Requires:** holder, other.
- **Users (gain):** Restraining Order, Chuckster: the triage says **2**; the once-per-entry memory part is Deferred (R-B10-18).
- **Pure?** pure: the default `holder` keeps today's run and feasibility (`EV/effects.ts:163-171`).
- **Risk:** The bundled guards of the live entry are holder-oriented. Check which ones apply to `other`; if they differ, use a new id.

### C36 `effect.set-marker{scope: battle | switch-in | turn, key, unique}` + `effect.clear-marker{scope, key}`

- **Kind:** event.
- **Formula:**
  - Set: `if (!simulated) data.erAbilityProvenance.push(key)`, where data is `battleData` / `summonData` / `turnData`.
  - `unique`: skip the push if the key is already present.
  - Clear: `data.erAbilityProvenance = data.erAbilityProvenance.filter(e => e !== key)`.
  - Sources: FPM:2154 (no dedupe), FPM:2357, FPM:978, FPM:273, 326, 328; `ER/ability-upgrades/attrs/innate-slot-suppression.ts:86-102` (`claimProvenance` dedupes).
- **Requests:** B14 C2-b, 3.4; R-B16-2, 3; B17 R9, R15.
- **Requires:** holder.
- **Users (gain):** Ballaster, Oracle **2**; up to 6 with others (Booby Trap, Celestial Jelly, Eulogy, Somniloquy, Splash Damage).
- **Pure?** pure.
- **Risk:**
  - **This reverses a section 5 rejection** (`effect.set-marker`, `effect.reset-memory`). The evidence is that the array is the public memory `time.marker-set` already reads (`EV/conditions.ts:725-736`).
  - The sources disagree on dedupe, so `unique` must be a setting.
  - Booby Trap's in-check `claim` order matters.

### C38 `effect.jump-turn-order{memoName?}`

- **Kind:** on `calc.speed-bypass` (`modifies: bypass`).
- **Formula:** `holder.addTag(BYPASS_SPEED)` (A:7917), then optionally `claimCommandAbilityProvenance` (`innate-slot-suppression.ts:105`). Feasibility: `canAddTag(BYPASS_SPEED)` (A:7907).
- **Request:** R-B18-2.
- **Requires:** holder.
- **Users (gain):** Quick Draw ×2: **2** with A19, B1 (+D4), `rng.chance`.
- **Pure?** pure.
- **Risk:** Order: guard → `rng.chance` → A19 → feasibility (see A19).

### C20 `effect.reflect-stat-drop`

- **Kind:** calc, `modifies: cancelled`, on `cancel.stat-protect`.
- **Formula:** `if (!source) return; if (!simulated) unshiftNew("StatStageChangePhase", source.getBattlerIndex(), false, [stat], stages, true, true, true, null, true); cancelled.value = true` (A:4278-4300).
- **Request:** B04 7-16.
- **Requires:** holder, other (= `source`, `EV/frame.ts:93`), stat, stages.
- **Users (gain):** Mirror Armor **1** (Crystalline Armor and In the Rough keep a package).
- **Pure?** pure.
- **Risk:** `cancelled` is set even when simulated.

### C37 `effect.change-charge-stacks{mode: add | spend | spend-all, amount}`

- **Kind:** event.
- **Formula:** `addCharge(p, n)` (clamped to 4), `consumeCharge(p, n)`, `clearCharge(p)` (`ER/abilities/charge-stack.ts:36-63`), nothing when simulated.
- **Request:** R-B14-6.1.
- **Requires:** holder.
- **Users (gain):** CapacitorBankAbsorb (full), Overloaded (with A22, A18): **1**.
- **Pure?** pure.
- **Risk:** Same store as A22.

### C34 `effect.reset-stat-stages`: settings `onlyRaised` and target `adjacent-foes`, on the planned entry

- **Kind:** planned.
- **Formula:** per foe, for each of ATK..EVA: `if (getStatStage(s) > 0) setStatStage(s, 0)`, then `updateInfo()` (VR:1958-1964).
- **Request:** B17 R21.
- **Requires:** holder.
- **Users (gain):** ClearOpponentStatBuffsOnSummon: **1**.
- **Pure?** pure (planned).
- **Risk:** Keep the README warning: it must not wipe lowered stats.

### C7 `effect.multiply-power-per-count` and `effect.multiply-accuracy-per-count`

These are 2 ids, each with settings `{counter: benched-teammates | weight-classes-above-target, percent, max}`.

- **Kind:** calc (`power`, `accuracy`).
- **Formula:** `x *= 1 + min(max, count) * (percent / 100)`, where count is `party.filter(!fainted && !onField).length` or `max(0, weightClass(holder.getWeight()) - weightClass(target.getWeight()))`, and `weightClass(w)` counts how many of [10, 25, 50, 100, 200] w reaches (NSM:601-614, 643-645, 1098-1101, 1139-1141, 1179-1181).
- **Requests:** R-B13-26, R-B13-16, R-B13-27.
- **Requires:** holder (other for weight).
- **Users (gain):** FanFavoritePower, HeavyweightPower, FanFavoriteAccuracy: **0** now, up to 3.
- **Pure?** pure.
- **Risk:** The weight path calls `getWeight()`, which runs the weight abilities.

### C16 `effect.drain-pp{target, amount | all, which: ko-move | last-used | random}`

- **Kind:** event.
- **Formula:** `m.usePp(amount)` = `ppUsed = min(ppUsed + n, getMovePp())` (`src/data/moves/pokemon-move.ts:106-108`). The "all PP of the move that knocked me out" form is `ppUsed = getMovePp()` plus the MoveUsedEvent and the `battle:ppReduced` message (`ER/archetypes/on-faint-effect.ts:541-551`).
- **Requests:** R-B13-10, R-B10-10, R-B10-c1-04, R-B15-25.
- **Requires:** holder, other (+ move for ko-move).
- **Users (gain):** FoulHarvest, PpReductionOnContact, OnFaintEffect (attacker-pp-drain): **0** now, 1-2 later.
- **Pure?** pure.
- **Risk:** **RNG** for `which: random`: re-read `pp-reduction-on-contact.ts:132-137` for the draw call.

### C22 `effect.match-weather-form`

- **Kind:** event.
- **Formula:** `if (!simulated) triggerPokemonFormChange(holder, SpeciesFormChangeWeatherTrigger)` (A:4048-4052).
- **Request:** B04 2-04.
- **Requires:** holder.
- **Users (gain):** Forecast, Flower Gift: **0**.
- **Pure?** pure.
- **Risk:** Not the planned `follow-weather-form`, which acts on the whole field.

### C23 `effect.cure-status` options `statuses[]`, target `my-side`, `alsoErAilments`

- **Kind:** options on a live V1 effect.
- **Formula:**
  - Side form: for each p in `getAlliesGenerator()` with a listed status: heal message, `resetStatus(false)`, `updateInfo()` (A:3873-3881).
  - Ailments form: feasibility `status != null || hasErAilment(p)`; run `resetStatus(); clearErAilments(p); updateInfo()` (A:4123-4135).
- **Requests:** B03 c4-58, B04 2-06.
- **Requires:** holder.
- **Users (gain):** Sweet Veil users, Natural Cure family: **0** (fidelity).
- **Pure?** pure: new settings run new branches, and the V1 runner is untouched.
- **Risk:** The side target is an option on this effect only (rule 2).

### C24 `effect.heal-percent` option `instant`

- **Kind:** option on a live V1 effect.
- **Formula:** `if (!simulated) { holder.heal(toDmgValue(maxHp * pct / 100)); updateInfo() }` (A:4147-4153).
- **Request:** B04 2-07.
- **Requires:** holder.
- **Users (gain):** Regenerator family: **0**.
- **Pure?** pure (default = the V1 heal phase).
- **Risk:** `33/100 === 0.33`, so the arithmetic is the same.

### C25 `effect.heal-fraction-of-max-hp` options `basedOn: holder` and target "my adjacent active allies"

- **Kind:** planned.
- **Formula:** for each `getAdjacentAllies().filter(isActive(true))`: `PokemonHealPhase(ally, toDmgValue(holder.getMaxHp() / N), msg, true, !showAnim)` (A:3509-3525).
- **Request:** B03 c3-45.
- **Requires:** holder.
- **Users (gain):** Hospitality, Butter Up, Food Lovers: **0**.
- **Pure?** pure (planned).
- **Risk:** none.

### C26 `effect.stat-stages` option `intimidateRules`

- **Kind:** planned.
- **Formula:** A:3456-3472: for each foe, dispatch `IntimidateImmunityAbAttr` and `PostIntimidateStatStageChangeAbAttr`; cancel on Substitute.
- **Request:** B03 c3-46b.
- **Requires:** holder.
- **Users (gain):** 23 PostSummonStatStageChange attrs: **0**.
- **Pure?** pure (planned).
- **Risk:** **Recursion:** the effect calls `applyAbAttrs` on other Pokemon's abilities. Keep the class's order exactly.

### C27 `effect.message` option `announcement`

- **Kind:** planned.
- **Formula:** choose one of the 14 `abilityTriggers:*` keys, interpolating `pokemonNameWithAffix` (+ the stat name for Ruin) (`init-abilities.ts:2128-2133`).
- **Request:** B03 c2-35.
- **Requires:** holder.
- **Users (gain):** 22 PostSummonMessage attrs: **0**.
- **Pure?** pure (planned).
- **Risk:** The i18n keys must exist. List them from the 22 call sites.

### C28 `effect.give-ability{ability}`

- **Kind:** event.
- **Formula:** `if (!simulated) other.setTempAbility(allAbilities[id])`; feasibility `other.getAbility().suppressable && !other.getAbility().hasAttr("PostAttackAbilityGiveAbAttr")` (A:2777-2785).
- **Request:** B03 c1-13.
- **Requires:** holder, other.
- **Users (gain):** Blood Stain, Mummy, Lingering Aroma, Lingering Musk: **0**.
- **Pure?** pure.
- **Risk:** Resolve the ability through A18's `abilityIdOf`. The PostDefend variant checks its own class in the feasibility.

### C29 `effect.remove-arena-tags{tags[], side: mine | foes | both | target's side}`

- **Kind:** event.
- **Formula:** `if (!simulated) arena.removeTagsOnSide(tags, side)` (A:3272-3279 sideMode; RCR:176-179 `opponent.isPlayer()` side; RCR:114 `removeTagOnSide` single tag).
- **Requests:** B03 c2-32, R-B11-03, R-B18-18.
- **Requires:** holder (other for the target's side).
- **Users (gain):** Pickup, Screen Cleaner, Demolitionist, Warrior's Spear, Qigong, linked Tailwind: **~2**.
- **Pure?** pure.
- **Risk:** The tag list must be a vetted list, like `effect.arena-tag`'s pending curated list. Removing tags is safer than adding them. Ask the owner only if they want the same list.

### C30 `effect.multiply-recoil{factor}`

- **Formula:** `multHolder.value *= factor` (`ER/archetypes/recoil-damage-multiplier.ts:37-39`).
- **Request:** R-B11-C2-14.
- **Users:** Limber, Steadfast, Daredevil, Superheavy: 4.
- **Status:** **Needs an owner/engine decision; do not build in this pass.** The engine never dispatches the rule: `move.ts:2572-2580` calls `attr.fire(recoilMult)` on attrs whose `constructor.name` is `RecoilDamageMultiplierAbAttr`. A composed carrier (`Reflect.construct` of that class, `EV/compile-composition.ts:92`) would match the name but has no `opts`, so `fire` would throw. It needs a carrier `fire` bridge or an engine dispatch.

### C31 `effect.use-stat-as-attack{physicalStat, specialStat}` + `effect.change-move-category` setting `by-lower | by-higher attack`

- **Formula:** `isPhysical ? physicalStat : specialStat` (BRM:199-204); `useHigher ? atk >= spatk : atk <= spatk` on `getStat(_, false)` (BRM:158-167).
- **Requests:** B14 C4-a, C4-b.
- **Users:** Grit, Subversion, AttackStatSubstitute users: 2-3.
- **Status:** **Needs an owner/engine decision; do not build in this pass.** The engine calls `resolveCategory(move, user)` and `resolveStat(...)` and uses their return values. Neither is `apply(params)` with a holder object, so `holderField` has nothing to write and the carrier cannot answer.

Wave C counts: **36 buildable** (C7 counts as 2 ids; C36 as one block with 2 ids, counted once), **2 need a decision** (C30, C31).

## Wave D: WHENs, slots, frame (6 items, all need a decision)

| # | Change | Request | Why it needs a decision |
|---|---|---|---|
| D1 | New WHEN `event.move-ended-on-me` on key `PostSummonRemoveEffectAbAttr` (`src/phases/move-end-phase.ts:49` passes only `{pokemon: target}`) | B03 c3-42 | Reverses the recorded reason in `UNEXPOSED_DISPATCH_KEYS` (`V/dispatch-keys.ts:23-24`). Gain 0 (fidelity). |
| D2 | New slot `defenderTypes` (SLOT_IDS, Frame, the `calc.my-attack-matchup` frame builder) | B14 2.2, unblocks A26 | A frame-builder change. Section 5 deferred same-shaped slot work (`accuracy`, `cancelled`) "rather than half-built". Gain 0. |
| D3 | New slot `effectChance` from `raw.chance` on `calc.effect-chance` and `calc.incoming-effect-chance` | R-B18-11, unblocks A27 | Same as D2. Gain 1 (Aroma Veil) with C5. |
| D4 | Add `SIM` to `calc.speed-bypass` provides (`when-registry.ts:349-352`) | R-B18-1 | Changes an existing WHEN's slot list. It changes no behaviour, because the engine never passes `simulated` there (`turn-start-phase.ts:292`). Low risk; needs a yes. |
| D5 | Subject `first-active-ally` in `holderLikeOf` (`EV/frame.ts:138-149`) + `WHO_OPTIONS` | B14 5.8 (D5 there) | Would show up in every `who` picker. A20 is the pure substitute. |
| D6 | `calc.defensive-stat-pick`: rename `modifies` `statValue` → `statChoice`, and map `raw.defender` into `other` | B04 15-44 | The rename is cosmetic; C19 works without it. Mapping `defender` in `firstPokemon` (`EV/frame.ts:93`) would change `other` on every WHEN whose params carry `defender`. |

Wave D counts: **0 buildable, 6 need a decision.**

---

## Counts

| Wave | Buildable pure additions | Needs owner/engine decision |
|---|---|---|
| A conditions | 25 | 2 (A26, A27) |
| B guards | 3 | 0 |
| C effects | 36 | 2 (C30, C31) |
| D WHEN/slot/frame | 0 | 6 (D1 to D6) |
| **Total** | **64** | **10** |

## Top 10 overall (abilities that become fully decomposed)

1. **A1 `move.type-is-mine`**: 61 (StabAdd ×59, StabSuppressAura ×2).
2. **C1 `effect.add-stat-share`** with **A2 `stat.is`**: 17.
3. **A4 `mon.tera-type`** with **A5 `mon.species`**: ~14.
4. **C32 `effect.scripted-move-at`**: the largest number of attrs (~46, including 40 PostSummonScriptedMove). The triage did not count abilities; [INFERENCE] at least 10.
5. **C13 `effect.set-weather` `turns`**: 10.
6. **C8 `hit-n-times` += with A13 `move.can-be-multi-strike-enhanced`**: ~10 [INFERENCE].
7. **A3 `stat.is-highest`** with **C2 `effect.multiply-stat`**: 9+.
8. **C9 `effect.cancel-recharge`**: 7. Tied at 7: **C10 `hurt-percent` extension** and **A6 `move.type-counts-as`**.
9. **C4 `effect.stat-stage-on-highest`**: 6. Tied at ~6: **C5 `effect.ignore-secondary-effects`**.
10. **C14 `set-terrain` `turns`**, **C11 `remove-type`** and **C6 `set-accuracy`**: 5 each.

Build these together, or the gain does not arrive:

| Bundle | Blocks |
|---|---|
| Stat-value stack | A2 + A3 + C1 + C2 |
| Hit count | A13 + C8 |
| Primal weathers | B2 + C21 |
| Arena Trap | B3 + C18 |
| Quick Draw | B1 + A19 + C38 + D4 |
| Marker writers | C36 + C32 |
| Overloaded | A18 + A22 + C37 |
