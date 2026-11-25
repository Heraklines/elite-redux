<!--
SPDX-FileCopyrightText: 2024-2026 Pagefault Games

SPDX-License-Identifier: AGPL-3.0-only
-->

# Built: waves B (guards) and C (effects)

Test file: `test/tests/elite-redux/decomp/library-completion-wave-bc.test.ts` (47 tests). Short paths as in BUILD-LIST.md.
No declaration was changed. The "classes" column lists the declarations a later completion pass can rebind.

## Wave B: guards

| id | kind | requests | formula source | classes that can use it | test |
|---|---|---|---|---|---|
| `not-simulated` | guard | B14 not-simulated, B18 not-while-previewing, B02 | FPM:1812, 1890, 2136, 2176, 2220, 2263; A:7906 | SouthernCrossPunch, BitterDrill, BoobyTrap x2, Ofuda, LowTideWaterSurf, BypassSpeedChance (Quick Draw x2) | not-simulated is !simulated |
| `another-holder-keeps-weather` | guard | B04 4-10 | A:4203-4210 | PreLeaveFieldClearWeatherAbAttr (6 abilities, with C21) | another-holder-keeps-weather: blocked only by ANOTHER holder |
| `foe-can-be-trapped` | guard | R-B13-32 / R-B06-18 | A:6871-6875 | ArenaTrapAbAttr (bundled by C18) | foe-can-be-trapped matches ArenaTrapAbAttr clauses 2 and 3 |

`another-holder-keeps-weather` compares against the current arena weather. Guards have no settings, and the class's first
clause already makes its own weather the current one. `weatherType` is private on the class, so the guard reads it the
same way the class does (through a named cast).

## Wave C: effects

| id | kind | requests | formula source | classes that can use it | test |
|---|---|---|---|---|---|
| `effect.add-stat-share` (C1) | calc statValue | R-B11-C4-06, C5-04 | speed-bonus-to-stat.ts:139-145; stat-blend.ts:64-67 | SpeedBonusToStat, StatBlend | add-stat-share equals SpeedBonusToStatAbAttr |
| `effect.multiply-stat` (C2, planned → implemented, option "the stat being calculated") | calc statValue | B04 8-21 family | A:2416-2421; self-highest-stat-multiplier.ts:109-111 | StatMultiplier family (11 decls), SelfHighestStatMultiplier (with A3) | multiply-stat equals StatMultiplierAbAttr |
| `effect.multiply-stat-per-fainted-ally` (C3) | calc statValue | R-B18-29 | RCR:411-415 | FaintedAllyStatMultiplier | …equals FaintedAllyStatMultiplierAbAttr |
| `effect.stat-stage-on-highest` (C4) | event | R-B11-10, B14 C6-c, R-B18-32 | self-highest-stat-boost-on-summon.ts:88-102; PM:380; type-immunity-highest-attack-stat-stage.ts:50-51; RCR:569 | SelfHighestStatBoostOnSummon, Positive Feedback, immunity classes (partial) | stat-stage-on-highest: strict scan… |
| `effect.ignore-secondary-effects` (C5) | calc effectChance | R-B18-12, R-B11-07 | A:1804-1810, 1822-1828 | IgnoreMoveEffects, UserFieldIgnoreMoveEffects, SandSecondaryEffectImmunity | …equals IgnoreMoveEffectsAbAttr |
| `effect.set-accuracy` (C6) | calc accuracy | B17 R33 | A:5134-5140 | SetMoveAccuracy | …residual and apply at the boundaries |
| `effect.multiply-power-per-count` (C7) | calc power | R-B13-26, 16 | NSM:608-614, 1098-1141 | FanFavoritePower, HeavyweightPower | multiply-power-per-count uses the class helpers |
| `effect.multiply-accuracy-per-count` (C7) | calc accuracy | R-B13-27 | NSM:1143-1181 | FanFavoriteAccuracy | …keeps the class guard accuracy > 0 |
| `effect.hit-n-times` (C8, planned → implemented, setting `extraStrikes`) | calc hitCount | B17 R34 | hit-multiplier.ts:190 | HitMultiplier family | hit-n-times adds the extra strikes |
| `effect.cancel-recharge` (C9) | event | R-B11-C1-06 | post-victory-clear-recharge.ts:50-58 | PostVictoryClearRecharge (7 abilities) | cancel-recharge removes the tag… |
| `effect.hurt-percent-of-max-hp` (C10, planned → implemented; settings `targets`, `fraction`, `sparedTypes`, `poisonHealRecovers`) | event | R-B15-24 | post-turn-hurt-non-typed.ts:121-126, 160-167, 194-246 | PostTurnHurtNonTyped (7 abilities) | compiles with defaults |
| `effect.remove-type` (C11) | event | R-B10-c3-05 | A:2802-2836 (UNKNOWN, Tera rules); post-attack-remove-target-type.ts:69-76 (NORMAL) | both PostAttackRemoveTargetType classes | remove-type: fallback setting and the Tera rule |
| `effect.change-own-type` (C12, planned → implemented; `who`, type or the move's type) | event | R-B10-c3-03 | post-attack-change-target-type.ts apply | PostAttackChangeTargetType, PostDefendChangeAttackerType | compiles with defaults |
| `effect.set-weather` option `turns` (C13) | live option | R-B16-13 | VR:2264-2281 | ErWeatherSummon, ErBiomeChangeWeather | set-weather with turns lifts ErWeatherSummonAbAttr |
| `effect.set-terrain` option `turns` (C14) | live option | R-B16-19 | VR:2328-2338 | ErTerrainSummon | live entries keep today's V1 path |
| `effect.drain-adjacent-foes` (C15) | event | R-B10-c5-05 | post-turn-drain.ts:71-94 | PostTurnDrain (3 abilities) | compiles with defaults |
| `effect.drain-pp` (C16) | event | R-B13-10, R-B10-10, c1-04, R-B15-25 | pokemon-move.ts:106-108; pp-reduction-on-contact.ts:122-137; on-faint-effect.ts:528-563; NSM:319-339 | PpReductionOnContact (without refund), OnFaintEffect attacker-pp-drain, FoulHarvest drain part | drain-pp used-move is usePp |
| `effect.force-other-out` (C17, NEW id) | event | R-B10-c3-08 | post-damage-force-attacker-out.ts residual/apply | PostDamageForceAttackerOut (without its once-per-switch-in memory) | compiles with defaults |
| `effect.trap-foe` (C18, bundles `foe-can-be-trapped`) | calc trapped | R-B13-32 | A:6879 | ArenaTrap, Salt Circle | trap-foe sets trapped… |
| `effect.use-weaker-defense` (C19) | calc statValue | B04 15-44, R-B13-38b, R-B08-40 | A:4806-4813, 4838-4845 | CritUseLowerDefensiveStat, LowerDefensiveStatVsStatusedFoe | …equals CritUseLowerDefensiveStatAbAttr |
| `effect.reflect-stat-drop` (C20) | calc cancelled | B04 7-16 | A:4274-4300 | ReflectStatStageChange (Mirror Armor) | …equals ReflectStatStageChangeAbAttr |
| `effect.clear-weather` (C21, planned → implemented, `keepExtreme` default true) | event | B04 2-03, B09-20 | entry-tailwind-clear-weather.ts (B09-20); A:4021-4024, 4214-4217 | PostSummonClearWeather, PreLeaveFieldClearWeather (with B2) | clear-weather: keepExtreme… |
| `effect.match-weather-form` (C22) | event | B04 2-04 | A:4031-4052 | PostSummonFormChangeByWeather | compiles with defaults |
| `effect.cure-status` options `scope`, `statuses`, `alsoErAilments` (C23) | live options | B03 c4-58, B04 2-06 | A:3863-3881; A:4123-4135 | PostSummonUserFieldRemoveStatusEffect, PreSwitchOutResetStatus | live entries keep today's V1 path |
| `effect.heal-percent` option `instant` (C24) | live option | B04 2-07 | A:4142-4153 | PreSwitchOutHeal | heal-percent instant equals PreSwitchOutHealAbAttr |
| `effect.heal-fraction-of-max-hp` (C25, planned → implemented; `basedOn`, target "my adjacent allies", `showAnimation`) | event | B03 c3-45 | A:3509-3525 | PostSummonAllyHeal | compiles with defaults |
| `effect.stat-stages` (C26, planned → implemented, `intimidateRules`) | event | B03 c3-46b | A:3424-3486; A:924-955 | PostSummonStatStageChange (23 attrs), PostDefendStatStageChange (Cotton Down) | compiles with defaults |
| `effect.message` (C27, planned → implemented, `announcement`) | event | B03 c2-35 | init-abilities.ts call sites via decl/B03/codecs.ts ANNOUNCEMENTS; PostSummonMessage/UnnamedMessage apply | PostSummonMessage (all but Zero to Hero) | compiles with defaults |
| `effect.give-ability` (C28) | event | B03 c1-13 | A:2777-2785; A:1620-1637 | PostAttackAbilityGive, PostDefendAbilityGive | compiles with defaults |
| `effect.remove-arena-tags` (C29) | event | B03 c2-32, R-B11-03, R-B18-18 | A:3268-3279; RCR:172-179 | PostSummonRemoveArenaTag (Pickup, Screen Cleaner), BreakScreensOnAttack | remove-arena-tags: vetted names only |
| `effect.scripted-move-at` (C32, NEW id) | event | R-B10-14, c4-07, c5-03; R-B11-C1-05, C1-08; B14 C3-b; B17 R35 | post-summon-scripted-move.ts:157-200; FPM:976-984, 1470-1476, 2275-2284 | PostSummonScriptedMove, Low Tide, Splash Damage, Somniloquy (with C36) | scripted-move-at: first standing foe… |
| `effect.steal-item` (C33, planned → implemented, `from: other | any-foe`) | event | B17 R39 | A PostAttackStealHeldItemAbAttr; BRM:353-381 | ErMagicianSteal (other), VoidPostTurnSteal (any-foe) | compiles with defaults |
| `effect.reset-stat-stages` (C34, planned → implemented, `onlyRaised`, target "adjacent foes") | event | B17 R21 | VR:1942-1964 | ClearOpponentStatBuffsOnSummon | compiles with defaults |
| `effect.set-marker` + `effect.clear-marker` (C36) | event | B14 C2-b, 3.4; R-B16-2, 3; B17 R9, R15 | FPM:2154, 273, 326; innate-slot-suppression.ts:86-91 | Ballaster, Oracle (+ Booby Trap, Celestial Jelly, Eulogy, Somniloquy, Splash Damage) | set-marker / clear-marker |
| `effect.change-charge-stacks` (C37) | event | R-B14-6.1 | charge-stack.ts:36-63 | CapacitorBankAbsorb, Overloaded | change-charge-stacks uses the shared store |
| `effect.jump-turn-order` (C38) | calc bypass | R-B18-2 | A:7907, 7917; innate-slot-suppression.ts:105 | BypassSpeedChance (Quick Draw x2, with A19, B1) | jump-turn-order |

Count: 36 blocks (37 ids). All of them compile with default settings (the last test).

### Engine exports (pure `export` keyword additions, no logic change)

- `erFieldTurnsWithItems` in `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts`
- `LAST_EXECUTED_MOVE`, `heavyweightMultiplier` and `livingBenchCount` in `src/data/elite-redux/abilities/newcomer-signature-mechanics.ts`
- `resolveTargets` in `src/phases/ability-studio-rule-effect-phase.ts` (the V1 target resolver, reused by the new branches)

## Skipped

- C30 `effect.multiply-recoil`: needs an owner/engine decision (the carrier has no `fire`).
- C31 `effect.use-stat-as-attack` and the `change-move-category` setting: needs an owner/engine decision (return-value API).
- C17 as an option on `effect.force-switch-out`: the bundled guards of the live entry are holder-oriented, so it is a new id
  (`effect.force-other-out`), as the build list says.
- C33 `pick` setting: it would have only one choice, so it was left out.
- `effect.message` Zero to Hero: the announcement writes per-battle memory that only init-abilities.ts can reach (codecs.ts).

## Changes to live blocks (each default reproduces today)

- `effect.cure-status`: new `scope` (default "target"), `statuses` (default ""), `alsoErAilments` (default false). The
  defaults return the unchanged `v1Effect` call.
- `effect.heal-percent`: `instant` (default false) → unchanged `v1Effect`.
- `effect.set-weather` / `effect.set-terrain`: `turns` (default 0) → unchanged `v1Effect`. With turns > 0 the class runs
  instead: its inherited `canApply` as feasibility (weather: replaceable && `arena.canSetWeather(w)`; terrain:
  `arena.canSetTerrain(t)`), then the synchronous set and the turn overwrite. So an already active weather or terrain
  is left alone, as in ErWeatherSummonAbAttr / ErTerrainSummonAbAttr. (BUILD-LIST C13's "including when that weather was
  already up" was wrong about the class.)
- `effect.multiply-stat`, `effect.hit-n-times`, `effect.steal-item`, `effect.message` were planned (no running behaviour).
  `hit-n-times` replaced its unused `count` with `extraStrikes`. `steal-item` replaced `target` with `from` and dropped
  `requires: ["other"]` (loosening only).

## Review fixes (CompletionReviewBC)

- B1 `effect.scripted-move-at`: every aim refuses to start from a follow-up (`useMode` INDIRECT or FOLLOW_UP), so a rule
  on "after my hit" never answers its own cast. Test: "scripted-move-at never answers its own follow-up hit, for every
  aim". Round 2: moments that pass no `useMode` ("after taking damage": recoil, Rough Skin chip) are refused while the
  move being resolved is the holder's own INDIRECT or FOLLOW_UP move (`phaseManager.getCurrentPhase()` is a
  MoveEffectPhase whose user is the holder; `useMode` is protected there and read through a named cast). Entry, end of
  turn, knockout and faint run in their own phases, so those lifts are unchanged. Test: "scripted-move-at on
  after-taking-damage refuses while the holder's own follow-up move is resolving". Also refused now: a rule that would
  start after a Metronome or Sleep Talk hit (FOLLOW_UP); this matters only when rebinding Low Tide or Splash Damage.
- B2: see `set-weather` / `set-terrain` above. Tests run the real ErWeatherSummonAbAttr / ErTerrainSummonAbAttr on no
  weather, the same weather (already active) and another weather.
- B3 `effect.reflect-stat-drop`: `requires: ["other", "stat", "stages"]`. It belongs on `cancel.stat-reflect` (provides
  `other` = the `source` of the dispatch), never on `cancel.stat-protect`. The test builds its frame with
  `frameFromAttrParams("cancel.stat-reflect", …)` from the dispatch shape of stat-stage-change-phase.ts:211-218.
- `effect.force-other-out`: the feasibility also refuses a fainted other Pokemon (the class's guard).
- `hurt-percent-of-max-hp` and `drain-adjacent-foes`: one module-level re-entrancy latch. While one of them runs, neither
  starts again (from any holder). **The classes have no latch:** with two holders on "after taking damage", the second
  holder's chip rule never answers a chip at all (the classes would chain until someone faints).
- Blocks that need the other Pokemon only for some settings: `remove-type` now defaults to `who: holder`. `steal-item`
  keeps `from: other` as its default (round 2: the Magician / Scavenger / Bandit gates name the block with no settings
  and must keep stealing from the Pokemon hit or knocked out), with `requires: []`. Each summary says that the "other
  Pokemon" choices need a trigger that has one (`steal-item`, `remove-type`, `change-own-type`,
  `stat-stage-on-highest`, `remove-arena-tags`, `scripted-move-at`).
- `multiply-accuracy-per-count`: the weight-class counter was dropped (the accuracy moment carries no target); it counts
  benched teammates only.
- `jump-turn-order`: refuses a preview (BypassSpeedChanceAbAttr's first clause).
- Defaults: `message` text is "The air grows tense!" (no empty line). `set-marker` / `clear-marker` default to
  `battle` / `marker`, the same as `time.marker-set`.
- Tests now use the real class as the oracle for: the live-entry default payloads and context, cure-status my-side
  (PostSummonUserFieldRemoveStatusEffectAbAttr) and ER ailments (PreSwitchOutResetStatusAbAttr), set-weather and
  set-terrain with turns, steal-item from any foe (VoidPostTurnStealAbAttr) and from the other Pokemon
  (PostAttackStealHeldItemAbAttr, same draws), hurt-percent-of-max-hp (PostTurnHurtNonTypedAbAttr) and stat-stages with
  the Intimidate dispatch (PostSummonStatStageChangeAbAttr). The real ability dispatch runs on fakes with no abilities,
  so the tests compare which Pokemon are asked, not a block by an ability.

## Points the integrator should know

- (review 6) `modifies: "statValue"` is shared by moments with different number fields (`statVal` on calc.stat-value;
  `statHolder` on calc.defensive-stat-pick). Once those moments are composable, `multiply-stat` ("the stat being
  calculated"), `add-stat-share` ("any") and `multiply-stat-per-fainted-ally` on calc.defensive-stat-pick or
  calc.attack-stat would throw. `use-weaker-defense` on calc.stat-value would do nothing. Land D6 (`statChoice`) first.
- (review 7) Marking `effect.message` and `effect.steal-item` implemented flips 26 gates in `editor/data/gates.json` to
  `unpackable: true` when the JSON is regenerated. 23 of them carry class parameter names (`message`, `berryOnly`) that
  the editor rejects as effect settings, so Unpack stays off with a confusing reason. Do not drop unknown settings to fix
  it: 82:2 would become "steal any item". Magician 170:0 and Scavenger 5083:1 unpack to `from: other` (the default) and
  are equivalent (pinned by tests against ErMagicianStealAbAttr and ScavengerLootAbAttr). Scavenger 5083:1 and Bandit 5702:1
  unpack without the declaration's `not-fainted` guard (moot in practice: `getField(true)` skips fainted Pokemon).
- (review 8) `scripted-move-at` does not expose `nonReflectable`. `PostSummonScriptedMove.canApply` passes while
  simulated; the block's feasibility does not.
- (review 9) Carriers always show the ability banner on event moments. `PreSwitchOutHeal`, `PreSwitchOutResetStatus`,
  the side cure and `PostAttackRemoveTargetType` are built with `showAbility = false`.
- `effect.clear-marker` does nothing while previewing. BallasterResetAbAttr clears without that check, so rebinding it
  needs that difference reviewed.
- `effect.remove-arena-tags` accepts only Reflect, Light Screen, Aurora Veil, Smokescreen, Spikes, Toxic Spikes, Stealth
  Rock, Sticky Web and Tailwind (every shipped user).
- biome reports 5 cognitive-complexity infos in `EV/effects.ts` (information only, not errors).

## Test counts

Run: wave-bc + vocabulary-naming + l0-lint + evaluate-conditions → 4 files, 93 tests, all passing (wave-bc has 47). biome
reports no errors on my files (infos only); tsc reports nothing in them.
