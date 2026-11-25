<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: AGPL-3.0-only
-->

# Librarian decisions (B19)

Written by the librarian pass on branch `decomp/all`. Input: `requests/B01.md` to `requests/B18.md` (about 650
entries, many of them the same ask in other words). Output: the library additions listed here, and a reason for every
cluster that was not built. Batch declarations were NOT changed for the library work (a later completion pass rebinds the
legacy-closure clauses); the only declaration edits of this pass are 10 labels in the naming pass (section 6).

How to read the status words:

- **Implemented**: pure definition, evaluator, a hand-written summary and category, and tests. The formula was lifted
  from the source line the requester cited and re-read there.
- **Alias**: the library already had the atom under another name; the formula is the same, so no new id was added.
- **Planned**: the effect or setting is in the registry with its plain label and settings, `implemented: false`. The class
  keeps the behaviour ("factor, do not re-implement"); the completion pass wires each one to its class.
- **Deferred**: justified, but it needs a change that this pass was told not to make (a declaration, a class edit, an engine
  dispatch site). The reason names the exact change.
- **Rejected**: not a library block. The reason is written.
- **Harness / information**: for B20 or the merge captain, nothing for the library.

## 1. Implemented atoms (conditions)

Tests: `test/tests/elite-redux/decomp/library-b19.test.ts` (44 tests). Numeric atoms have boundary tests; the rounded HP
ratio is checked on every HP of eleven max HP values against the original expression.

| Id | Asked by | Formula (source) | Classes that can use it now |
| --- | --- | --- | --- |
| `hp.at-most`, `hp.at-least`, `hp.between` with rounding `rounded-ratio` | B02-21, B03 "third rounding", B05-12, B12-23, B13-31, B13-47, B16-11 | `getHpRatio() <= pct / 100`, `getHpRatio() = Math.round(hp / maxHp * 100) / 100` (`pokemon.ts:2430`). Strict "above" is `not at-most`. | PostSummonFormChange (Zen Mode, Shields Down, Schooling, Revelation, Power Construct), LowHpMoveTypePowerBoost (Overgrow, Blaze, Torrent, Swarm, Lepidopteran), MovePowerBoost (Vengeance, Earthbound, Vengeful Spirit), TypeDamageBoost low-HP branch, ErDefeatistStatMultiplier, RingGeneralTrap, EclipseWingPower |
| the same atoms with `who: any-foe` | B05-12 | true when any opponent matches; any error answers false, as the Opportunist closure wrote it | ChangeMovePriority (Opportunist) |
| `hp.crossed-below` with rounding `damage-value` | B01-21 | `t = max(floor(maxHp * ratio), 1); hp <= t && hp + damage > t` (`ab-attrs.ts` PostDefendHpGatedStatStageChangeAbAttr.gate). Differs from `floor-half` only for a 1 HP Pokemon. | PostDefendHpGatedStatStageChange (Anger Shell x2, No Turning Back), archetype post-defend-hp-gated-self-tag |
| `hit.dealt-damage` | B13-3, B16-4, B17 R6 | `damage > 0` | FoulHarvest, PorousCharge, Ballaster, ConfectiousDefend, Cyberkinetic, Hijack, IrradiatedFist |
| `hit.would-knock-out{who, ignoreOneHpMax}` | B01-2, B10-c4-03, B17 R1 | `damage >= hp`; with the flag `!(maxHp <= 1 \|\| damage < hp)`, written as the class writes it so a NaN damage answers the same | PreDefendFullHpEndure (Sturdy), PreFaintRevive, LingeringMuskEndure, PostFaintDetonate (Aftermath, Perish Body, Unstable Core, Pungency) |
| `hit.first-strike{who}` | B16-18, B17 R24, B15-39 | `turnData.hitCount === turnData.hitsLeft` (`move-effect-phase.ts:296`) | StatDebuffOnFlagAttack, the first-strike users of B16 and B17 |
| `hit.critical` gained `who` (default the other Pokemon, as before) | B08-38, B17 R5 | reads `turnData.attacksReceived[0].critical` of the chosen Pokemon | DamageReduction crit kind (Bad Omen) |
| `move.is-attack-move` | B01-12, B10, B12-35 | `move.is("AttackMove")` | MoveImmunity (Telepathy), NonSuperEffectiveImmunity (Wonder Guard), TypedImmunityWithArenaTag (Evaporate) |
| `move.targets-whole-side` | B01-11 | `[BOTH_SIDES, ENEMY_SIDE, USER_SIDE].includes(moveTarget)` | MoveImmunity (Good as Gold), the TypeImmunity family |
| `move.effective-priority{cmp, n}` | B01-13 | `compare(move.getPriority(moveUser), cmp, n)`; counts Prankster and Gale Wings | FieldPriorityMoveImmunity (15 users: Queenly Majesty, Dazzling, Armor Tail, and 12 more) |
| `move.has-flinch-effect` | B03 | `move.hasAttr("FlinchAttr")` | PostAttackApplyBattlerTag (Stench, Pungency) |
| `move.hits-substitute` | B03 | `move.hitsSubstitute(user, target)` | PostAttackApplyBattlerTag (Stench, Pungency) |
| `move.type-chart-effectiveness{cmp, n}` | B08-37 | `defender.getAttackTypeEffectiveness(moveUser.getMoveType(move), { source, move })`, the chart only | DamageReduction (Permafrost, Primal Armor, Thick Skin, Flame Shield, Dead Bark, Fire Ruler, Cryogenesis, Feathercoat) |
| `move.type-multiplier{cmp, n}` and the new slot `typeMultiplier` | B01-14, B08-37 | `compare(typeMultiplier.value, cmp, n)`; `calc.move-immunity` and `calc.type-matchup` now provide the slot | NonSuperEffectiveImmunity gate (Wonder Guard), DodgeFirstSuperEffective residual (Anticipation, Telepathy), FullHpResistType residual |
| `move.inflicts-status{status}` | B12-11, B16-15 | `getAttrs("StatusEffectAttr").some(effect === status)`, plus the frostbite tag for FREEZE | StatusChanceMultiplier (Pyromancy, Cryomancy, Thermomancy, Chandelier, Cryostasis), ElectromancyEffectChance |
| `move.ability-can-change-type` | B02-14, B14-5.4 | `!noAbilityTypeOverrideMoves.has(move.id)`, the engine's own set | MoveTypeChange (13 legacy users), ElectrodynamicsGalvanize, ElectrodynamicsGalvanizePower |
| `mon.is-first-ally` | B01-12 | `holder.getAlly() === other` | MoveImmunity (Telepathy) |
| `field.weather-in-effect{weathers, reapAndSow}` | B02-35, B05-25, B12-39, B18-27 | not suppressed and in the list; with the flag exactly `getWeatherCondition(...weathers)` (Reap and Sow included) | PostWeatherLapseHeal, PostWeatherLapseDamage (Rain Dish, Dry Skin, Ice Body, Sundae), WeatherStatMultiplier and the three other weather classes, MovePowerBoost (Nika), Flower Gift, WeatherGroundAirborne, FieldPriorityMoveImmunity weather users, RainPump |
| `field.weather-lasting` | B06-15 | `weather.isImmutable()` | PostBiomeChangeWeatherChange (Primordial Sea, Desolate Land, Delta Stream and 3 more) |
| `field.weather-fog` | B03, B09 "field.fog" | `isFogWeather(weatherType)` | Madness Enhancement, FlareBoostSelfBurnOnWeatherChange |
| `field.terrain-unhidden{terrains}` | B02-36, B03 terrain-in-list, B14-3.2 | raw `arena.terrain.terrainType`, not hidden by Clueless | Flourish (MovePowerBoost), Quark Drive, CelestialJelly |
| `field.terrain-just-set{terrains}` | B05-29 | the terrain the trigger passed; a listed NONE never counts, as the class writes it | PostTerrainChangeAddBattlerTag (Quark Drive) |
| `status.has-any{who, statuses}` | B03, B06-3 | empty list = any status problem | PostSummonHealStatus (15 users: Limber, Insomnia, Immunity, Magma Armor, ...), PostTurnResetStatus |
| `tag.has-any{who, tags}` | B03 | `tags.some(getTag)` | PostSummonRemoveBattlerTag (Oblivious, Own Tempo) |
| `status.just-set{statuses}` | B03 | the status the trigger passed | SynchronizeStatus (Synchronize) |
| `mon.fainted{who}` | B09-02, B13-44, B18 | `isFainted()` | BootHill, the B09 and B18 users |
| `mon.level`, `mon.form-number` | B03 | `compare(level or formIndex, cmp, n)` | PostSummonFormChange (Schooling, Zen Mode, Shields Down, Power Construct, Tera Shift), PreSwitchOutFormChange |
| `mon.terastallized{who}` | B14-5.5, B16 | `isTerastallized` | ElectrodynamicsGalvanize, the B16 tera users |
| `party.ally-active`, `party.multi-battle`, `party.bench-count{cmp, n}` | B03, B13-29 | `getAlly()?.isActive(true)`; `getBattlerCount() > 1`; living members off the field | PostSummonCopyAllyStats (Costar), FanFavoritePower and FanFavoriteAccuracy |
| `time.turn-count-multiple{n}` | B17 R26 | `turn > 0 && turn % n === 0` | SomniloquyPostTurn |
| `time.switched-in-this-turn`, `time.failed-run-away` | B06-7 | the turn data flags | SpeedBoost (Speed Boost, Max Acceleration), Stakeout |
| `time.last-move-result`, `time.last-move-was-follow-up` | B17 R17 | `getLastXMoves(1)[0]?.result`, `?.useMode === INDIRECT` | the B17 follow-up users |
| `time.marker-set{scope, key, match}` | B16, B17 R3, B13 | reads `erAbilityProvenance` of battle, switch-in or turn data; never writes | OracleEntry, OracleGuardTick, LingeringMuskPostTurn, Eulogy and the other marker users |
| `rng.chance` gained `alwaysRoll` | B03, B09-35 | draws even at 100 percent (a simulated call still never draws) | PostAttackApplyBattlerTag (Balloon Bomb, Hollow Ice Zone, Wrestle Showman), ScavengerLoot |
| `rng.chance-float{pct}` | B06-4 | one `randSeedFloat()` always, `pct / 100 >= draw` | PostTurnRestoreBerry (Harvest) |
| `move.is-move`, `time.last-move` and `effect.scripted-move` accept Elite Redux moves | B05-13, B08-33, B17 R10 | `MoveId` first, then `ErMoveId` | ChangeMovePriority (Penta-Punch) and every ER move param |

## 2. Implemented guards (safety rules)

| Id | Asked by | Formula | Classes |
| --- | --- | --- | --- |
| `not-blocked-by-effect-shield` | B03, B08-6, B08-16 | `!other.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")` | PostAttackApplyBattlerTag, AteConditionalStatus, ChanceStatusOnAttack, ChanceBattlerTagOnAttack |
| `not-self-target` | B03, B08-16 | `holder !== other` | PostAttackApplyBattlerTag, PostAttackAbilityGive |
| `status-set-by-a-pokemon` | B03 | `Boolean(other)` | SynchronizeStatus |
| `hit-connected` | B10 c3-01, B15-26, B16-17 | `hitResult < NO_EFFECT` | PostAttackSetTerrainByMoveType, PostAttackSetHazardByMoveType, Spiteful, RainPump users |
| `hit-connected-on-another-pokemon` | B08-6 | `holder !== other && hitResult < NO_EFFECT` | AteConditionalStatus |
| `hit-dealt-damage` | B14, B15-47, B16-4 | `damage > 0` | Ballaster, ConfectiousDefend, Cyberkinetic, Hijack, IrradiatedFist, WorldInPiecesRemoveType |
| `hit-on-another-living-target` | B15-30 | `holder !== other && !other.isFainted() && damage > 0` | PuppetStrings |
| `after-my-final-hit` | B13-42, B17 R18 | `!(holder.turnData.hitsLeft > 1)` (the existing `after-final-hit` reads the defender frame) | Skyhook, PhoenixFoliageUseFormChange |
| `knocked-out-by-a-move`, `attacker-still-standing` | B18-34, B17 R8 | `!!attacker && !!move`; `!attacker.isFainted()` | OnDirectFaintRetaliation, MutualDestructionPostFaint, PostFaintHPDamage |
| `credited-with-the-knock-out` | B09-32, B12-01 | `victim.turnData.attacksReceived[0].sourceId === holder.id` (`lifesteal.ts:82`) | LifestealOnKo (18 attrs), ScavengerLoot, StatTriggerOnKo (9 users) |
| `not-protected-from-indirect-damage` | B05-28 | `!holder.hasAbilityWithAttr("BlockNonDirectDamageAbAttr")` | PostWeatherLapseDamage |

## 3. Implemented triggers (WHEN) and slots

| Id | Asked by | Notes |
| --- | --- | --- |
| `event.wild-pokemon-created` | B07-5 | key `SyncEncounterNatureAbAttr` moved out of `UNEXPOSED_DISPATCH_KEYS`; provides holder and other. Unblocks the parked `SyncEncounterNatureAbAttr.decl.pending.ts` (Synchronize). |
| `event.ability-lost` | B07-11 | key `IllusionBreakAbAttr` moved out of `UNEXPOSED_DISPATCH_KEYS`. Unblocks `IllusionBreakAbAttr.decl.pending.ts` (Illusion). |
| slot `typeMultiplier` | B01-14, B08-37 | the frame builder copies `params.typeMultiplier.value`; provided by `calc.move-immunity` and `calc.type-matchup`. |

Both new WHENs carry a written static reason in `harness/scenarios.ts` (no scenario can reach a wild-encounter or an
ability-removal moment; B07 drives the dispatch in its own test).

## 4. Effects

Implemented (exact arithmetic of the class, with the class's own "also requires"), tested at the boundaries:

- `effect.raise-crit-stage` (B05-9, B08-30): `critStage.value += stages`. For BonusCrit (Super Luck, Sniper, Fourth Degree, Kagutsuchi).
- `effect.multiply-crit-damage` (B05-10, B08-28): `critMult.value *= multiplier`, only while `critMult.value > 1`. For MultCrit, CritDamageMultiplier.
- `effect.multiply-effect-chance` (B02-10, B08-42, B12-29): `chance *= multiplier`, capped at 100; skipped for chance 0, Order Up, Electro Shot. For MoveEffectChanceMultiplier (Serene Grace), IgnoreMoveEffects (multiplier 0), EffectChanceModifier, TypeFilteredEffectChanceMultiplier.

Planned (plain label, settings with units, summary, category; `implemented: false`): `effect.multiply-ally-damage-taken`
(B01-6), `effect.cap-type-matchup` (B01-15, B12-17), `effect.set-matchup` (B08-11, B12-41), `effect.ignore-stat-changes`,
`effect.ignore-type-immunity` and `effect.ignore-status-type-immunity` (B07-8), `effect.bypass-protections` and
`effect.reflect-move` (B07-7), `effect.ignore-target-abilities` (B07-1), `effect.multiply-weight` (B07-3),
`effect.raise-berry-threshold` (B07-2), `effect.multiply-burn-damage` (B06-13), `effect.multiply-berry-effect` (B06-14),
`effect.multiply-stat-changes` (B06-12), `effect.change-status-duration` (B06-23), `effect.set-turn-order-place` (B05-11),
`effect.hit-random-times` (B02-13), `effect.multiply-accuracy-against-me` (B09-31), `effect.raise-base-accuracy` (B05-1),
`effect.set-power` (B17 R11), `effect.change-move-category` (B09-34), `effect.stat-stages` (B01-24, B03, B06-24, B12-06,
B13-15: several stats and every-adjacent-foe targets), `effect.change-own-type` (B01-22, B07-14), `effect.add-type`
(B08-4, B08-46), `effect.hurt-percent-of-max-hp` (B02-2, B13-24, B15-24, B05-27 with 6.25), `effect.heal-fraction-of-max-hp`
(B05-26, B06-1; `effect.heal-percent` is a whole percent and cannot say 1/8 or 1/16), `effect.clear-weather` (B09-20),
`effect.reset-stat-stages` (B03), `effect.reveal-held-items` (B05-18), `effect.restore-eaten-berry` (B06-5),
`effect.copy-nature` (B07-5), `effect.faint-self` and `effect.faint-other` (B13-35, B17 R4/R7, B18).

## 5. Aliases, rejections and deferrals

### Aliases (already in the library, same formula)

- `hit.connected`, `hit.landed`, `hit.damaged`, `hit.not-blocked`, `hit.dealt-damage` (the `hitResult` form of B01-23, B07-10, B10 c3-01, B13-4, B16-17, B17 R12): all `hitResult < NO_EFFECT`. This is `hit.landed-damage`. (Seed Sower's `!(hitResult >= NO_EFFECT)` is equal for every real result.) The guard form is `hit-connected`.
- `move.has-built-in-flag`, `move.has-flag-intrinsic`, `move.has-own-flag`, `move.has-property-itself` (B01-10, B01-26, B03, B12-04, B12-25, B14, B15-6, B18): `move.inherent-flag`.
- `move.drains-hp` (B01-20): `move.drains`.
- `mon.is-trapped` (B03): `tag.trapped` (`getTag(TrappedTag)`).
- `status.any-problem` (B06-3): `status.has` with ANY (and `status.has-any` with an empty list).
- `hit.critical-taken`, `hit.was-critical` (B08-38, B17 R5): `hit.critical{who}`.
- `effect.block-crits` (B08-27): `effect.block-crit`. `effect.hurt-percent`, `effect.lose-hp-percent`, `effect.damage-share-of-max-hp`, `effect.take-max-hp-percent-damage`, `effect.lose-sixteenths-of-max-hp`: `effect.hurt-percent-of-max-hp`. `effect.heal-sixteenths-of-max-hp`, `effect.heal-fraction`: `effect.heal-fraction-of-max-hp`.
- `time.once-per` with scope wave already reads the class's own wave memory (B08-26, B08-48, B15-7): no new scope needed.
- `matchup.compare` (B01-14), `move.type-multiplier` (B08-37): one atom, `move.type-multiplier`.
- `move.can-inflict-status` (B16-15) and `move.inflicts-status` (B12-11): one atom, `move.inflicts-status`. The only difference is the frostbite tag for FREEZE; the B16 user (Electromancy, paralysis) is unaffected. The B16 `gateParams` must be renamed to `move.inflicts-status` in the completion pass.

### Rejected (the class stays one piece, or the request is not library work)

- Single-mechanic memory that lives in a private `WeakMap` or a module field of one Elite Redux class: `time.armed`, `time.armed-this-turn`, `time.armed-for-this-move`, `time.entered-this-turn`, `time.new-move-of-mine`, `time.new-move-of-foe`, `time.trigger-count`, `time.not-yet-this-turn`, `time.expected-move`, `mon.has-stored-charge`, `time.charges`, `mon.is-my-mark`, `mon.counter-target-fainted`, `mon.shape-memory-covers-move`, `mon.lost-type-count`, `field.weather-set-by-me`, `field.slot-charged`, `effect.store-charge`, `effect.spend-charges`, `effect.reset-charges`, `effect.reset-memory`, `effect.mark-target`, `effect.set-marker`, `effect.tick-marker`, `effect.set-chain`, `time.chain-pending` and similar (B13-2, B13-5, B13-6, B13-7, B13-8, B13-9, B13-14, B13-17, B13-22, B13-23, B13-25, B13-30, B13-34, B13-35, B13-48, B13-50, B14, B15, B16, B17). The identity of a record object or a private owner variable is not a fact a player can name, and an atom for it would read state that only that one class writes. The classes are honest packages (spec 2.2) with typed settings. A general marker atom exists (`time.marker-set`) for the classes that already write to the shared marker memory.
- One-off effects of a single named ability (B13-10 to B13-56, B14-x, B15-4, B15-5, B15-13, B15-17, B15-20 to B15-25, B15-29, B15-36 to B15-48, B16, B17 R9 to R16, B18): each would be a library block with one user. Packages are the intended form for these (315 of the 609 classes).
- `calc.ai-moveset-stats` and the five `effect.ai-*` effects (B07-15): the moment is the enemy moveset generator, not a battle moment; players never see it. Decision: keep `AiMovegenMoveStatsAbAttr` unexposed and mark both parked classes `exempt` (spec 2.2: allowed with a reason and sign-off).
- `not-a-scripted-follow-up` (B13-37): reads a module-private `WeakSet` of one Elite Redux file.
- `accuracy-is-finite` (B13-28) and `not-already-blocked` (B18-24): need new frame slots (`accuracy`, `cancelled`) on every calc WHEN; deferred with the WHEN work below rather than half-built.
- `move.is-critical` (B04, B05-4, B05-16): needs a `crit` slot filled by a frame builder for `calc.defensive-stat-pick`/`calc.crit-multiplier`; the engine only hands over `critMult`, so the atom would be `critMult > 1`. Deferred with the frame-slot work.
- WHENs that need a NEW engine dispatch site (the library can only name a moment the engine already announces): `event.ally-takes-direct-hit`, `event.linked-ally-takes-direct-hit`, `event.linked-ally-faints`, `event.i-am-healed`, `event.leech-seed-planted`, `event.leech-seed-drain`, `event.foe-loses-hp-to-trap`, `event.would-be-knocked-out`, `event.ally-starts-charge`, `event.switch-out-by-choice`, `event.turn-start-after-commands`, `event.my-attack-damages-target`, `calc.offensive-stat`, `calc.drain-heal` (B13-11, B13-38, B13-41, B13-53, B13-54, B13-56, B15 moments). They are engine work for the foundation owner.
- Binding-facility requests (`extra` and `attr` slots, number-valued form closures, closure context `mover`, `ai-rating`): these are changes to `build-attr.ts` and `define-decl.ts`, not to the vocabulary. Forwarded to the merge captain.

### Deferred (justified; the exact change is named)

- WHEN splits that move a dispatch key out of another WHEN's `alsoDispatchKeys`: `calc.priority-bracket` (`ChangeMovePriorityInBracketAbAttr`, B05-11), `cancel.status-damage` (`BlockStatusDamageAbAttr`, B05-14), `cancel.self-stat-drop` and `cancel.partner-self-stat-drop` (B04-6), `calc.side-move-immunity` (`UserFieldFlagImmunityAbAttr`, B12-36), `calc.ally-damage-taken` (`AlliedFieldDamageReductionAbAttr`, B01-6), `calc.entry-hazard-damage`, `calc.self-inflicted-damage`, `calc.move-targets` (B05-6, B05-7; today flag keys of `while.active`). A dispatch key may belong to one WHEN only (L0), so each split must be done together with the `when` of the declaration that names the old WHEN. This pass was told not to touch declarations. Completion pass: add the WHEN, remove the key from the old WHEN, set `when` in that one declaration, run L0 to L2.
- Number-valued picker atoms `form.fixed`, `form.step-back`, `form.colour-of-current`, `form.by-hp-line` (B01-3, B06-8): they are not yes/no atoms; they need a binding kind in `build-attr.ts`. The conditions they pair with (`mon.level`, `mon.form-number`, rounded HP ratio) now exist.
- `effect.apply-tag` and `effect.arena-tag` with curated lists and turn counts (B01-17, B01-25, B01-28, B03, B05-21, B09-19, B15-18): the registry entries exist and stay `implemented: false`; the curated list of vetted battle effects needs the owner to name which effects staff may use.
- Wiring the planned effects of section 4 to their classes, and renaming the legacy-closure bindings to the new atoms.
- Harness items (B01-7, B01-8, B02-9, B02-16, B02-17, B02-37, B02-39 to B02-43, B05-8, B05-17, B05-24, B06-H1 to H3, B09-08, B09-15, B09-27, B09-30, B12-09, B12-18, B12-26, B12-37, B12-38, B12-42): forwarded to B20; no library file is involved.

## 6. Naming consistency pass (spec section 8)

- Every one of the 111 triggers, 103 conditions, 83 effects and 18 safety rules now has a hand-written one-line `summary` with a
  concrete example and one browse category of spec 8.4 (`vocabulary/texts-*.ts`, merged by `vocabulary/texts.ts`; a
  definition without a text fails at load).
- All 605 blocks have a browse category (`vocabulary/block-categories.ts`, in `blocks.json` as `category`).
- Triggers all start with "When" or "While" (35 labels reworded); two triggers that shared a meaning got explicit
  labels ("While the game prepares a hit against me" versus "When a hit is about to land on me").
- Effects start with a verb (4 reworded: "Make my moves never miss", "Land a critical hit every time", "Cap each hit I
  take at N% of max HP", "Put {tag} on {target}", which also removes the code word "apply").
- Safety rule labels are short "Not when ..." and "Only when ..." lines (all 18 are at most 60 characters); the long
  explanation moved into the summary.
- Settings: every label says what it controls and its unit; choices show player words through the new
  `optionLabels` (`PLAYER_OPTION_LABELS`: "at least", "The ability owner", "My side of the field", ...); code
  names in labels ("BattlerTagType name", "Move id (enum name)") were replaced.
- Block labels: one spelling per word ("defense", "knockout"), "foe" for the opposing Pokemon, and the near-duplicate
  pairs now say how they differ (Sturdy: "...while at full HP"; PreFaintRevive: "...at an HP level you set"; the two
  stat-boost wipes: "adjacent foes" versus "every active foe"). 10 declaration files changed, labels and examples only.
- Pairs left as they are, on purpose (two classes with the same visible behaviour, each the live code of different abilities): CritImmunity and BlockCrit, StatusEffectImmunity and StatusEffectImmunityAbAttrEr, IntimidateImmunity and IntimidateImmunityAbAttrEr, TypeAbsorb* and TypeImmunity*. Their labels are unique, and the picker shows "Used by: ..." to tell them apart; merging them is a behaviour decision for the owner.
- L0 now lints the vocabulary entries too (`vocabulary-lint.ts`, test `harness/vocabulary-naming.test.ts`): no code words,
  length limits (label 60, summary 200), unique labels per column, triggers "When/While", effects start with a verb,
  at least 3 search words, an example for every condition and effect, valid category, no code-word choices without
  player words, and no text without an entry. `KO` joins `HP`, `PP`, `STAB` as an allowed capital word.

## 7. Open issues

- Single-use atoms and effects were not built (section 5). Every legacy-closure clause that depends on one of them
  stays legacy until the owner decides whether it deserves a block.
- `optionLabels` are in the data (`vocabulary.json`); the editor picker still prints raw choice values for selects until
  `editor/composition-builder.js` reads them.

## 8. What this pass did not do, stated plainly

- Entries of `B01.md` were read line by line. Of the other files, the library-facing entries were read in full for every
  atom, guard, effect and trigger that was implemented, and the headings of all of them were read. The unnumbered
  or table-form entries of B03, B04, B10, B11, B14 and B16, and the tail entries of B13 to B18, were classified by their
  headings and the cluster rules of section 5, not re-derived line by line. None of them was built; each one that
  names a clause of a legacy closure stays legacy until the completion pass decides.
- No batch declaration was rebound. The atoms of sections 1 and 2 are available, but `decl/**/bindings.ts` still holds
  `bindLegacyClosure` for the clauses that wait for them; section 1 lists which classes can now take which atom.
- The WHEN splits of section 5 and the effect wiring of section 4 are the completion pass's work.

## 9. Request index (ids of the numbered entries, for lookup)

B01: R-B01-1 to R-B01-30. B02: B02-1 to B02-43. B05: R-B05-1 to R-B05-30. B06: R-B06-1 to R-B06-24 (and H1 to H3, F1).
B07: R-B07-1 to R-B07-17. B08: R-B08-1 to R-B08-49. B09: R-B09-01 to R-B09-39. B12: R-B12-01 to R-B12-42.
B13: R-B13-1 to R-B13-56. B15: R-B15-1 to R-B15-48. B17: R1 to R39. B18: R-B18-0 to R-B18-39.
Every id not named in sections 1 to 4 is covered by the cluster rules of section 5.
