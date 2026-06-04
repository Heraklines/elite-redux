# Vanilla Move Mechanic Audit (Elite Redux v2.65)

> Audit date: 2026-05-23.
> Source-of-truth: `vendor/elite-redux/v2.65beta.json` (ER move dump — 1032 entries).
> Comparison baseline: `src/data/moves/move.ts::initMoves()` (pokerogue's builder
> chain) + `locales/en/move.json` (effect descriptions).
> Mapping: matched by `MOVE_<NAME>` constant against `src/enums/move-id.ts`
> (re-derived in this audit because the existing
> `src/data/elite-redux/er-id-map.ts` has stale entries for 67 Gen 9 moves
> where ER and pokerogue renumbered Gen 9 differently — see "Caveats" below).

## Scope and method

ER ships 1032 move entries; 844 of them resolve to a vanilla pokerogue MoveId
(< 5000) by constant-name match. `MoveId.NONE` is excluded as a placeholder.
The remaining 188 ER entries are ER-custom moves with no vanilla counterpart
and are handled by `init-elite-redux-custom-moves.ts` + the move-archetype
dispatcher (out of scope for this audit).

For each audited pair we compared:

- **Category** (PHYSICAL / SPECIAL / STATUS, plus the 4 ER-only splits
  `USE_HIGHEST_OFFENSE`, `HITS_DEF`, `USE_HIGHEST_DAMAGE`, `HITS_SPDEF`)
- **Type** (the primary `types[0]` element vs `PokemonType` in the
  AttackMove/StatusMove constructor)
- **Effect / secondary effect** — ER's `eff` index (decoded by
  `vendor/elite-redux/v2.65beta.json#effT`) and short description vs
  pokerogue's chained `.attr(…)` calls
- **Priority** (already numerically patched by B3 — see "Already covered" below)
- **Chance %** (also numerically patched)
- **Flag tags** — ER's flag list (e.g. "Air/Wing Based", "Hammer Based")
  vs pokerogue's `.makesContact()` / `.windMove()` / etc. builder chains
- **Builder chain** (e.g. `.attr(MultiHitAttr)`, `.attr(StatusEffectAttr,…)`)

Audit driven by `scripts/elite-redux/audit-vanilla-moves.mjs` (extracts pg
attrs + side-by-side TSV) and `scripts/elite-redux/audit-vanilla-moves-mech.mjs`
(classifies deltas). Raw outputs:

- `scripts/elite-redux/tmp-move-audit-sidebyside.tsv` — 844 rows, every
  audited pair with parsed pg builder chain and ER metadata.
- `scripts/elite-redux/tmp-move-audit-classified.tsv` — 267 rows, only
  the moves with non-NONE deltas.

### Severity buckets

- **NONE** — mechanic identical; ER description is just a stylistic
  re-phrase. May still have numeric tweaks (power/accuracy/PP/chance/priority)
  which are already handled by `init-elite-redux-vanilla-rebalance.ts`.
- **MINOR-flag** — ER mentions an ER-ability boost marker ("Mega Launcher
  boost", "Iron Fist boost", etc) on top of the otherwise-identical
  vanilla mechanic. **Most** of these resolve transparently because
  pokerogue's vanilla move already calls the equivalent builder
  (`.punchingMove()` → `MoveFlags.PUNCHING_MOVE`, which Iron Fist gates
  on). A handful — `field-based`, `throw`, `striker`, `mighty horn`,
  `keen edge` — apply to vanilla moves that *don't* set the
  corresponding `MoveFlags` bit in pokerogue, leaving a gap.
- **MAJOR** — added effect, different trigger, different predicate
  (contact → non-contact), different category-derivation rule (e.g.
  `USE_HIGHEST_OFFENSE`), target widened (single → spread), recoil
  rider, drain rider, hazard rider, or status proc that didn't exist
  in vanilla. Needs a `MoveAttr` to be added alongside (or in place of)
  the vanilla attrs.
- **TOTAL** — ER reuses the name for a fundamentally different move:
  different type **and** different category, or vanilla
  STATUS→damaging swap, or OHKO removed in favor of a regular
  damaging move. The vanilla builder chain must be replaced wholesale.

### Cross-check with existing wiring

`src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts` already
applies the following to vanilla moves:

- `power` (when ER ships a positive value that differs)
- `accuracy` (positive ER values; pokerogue's -1 sentinel preserved)
- `pp` (positive ER values)
- `priority` (signed; 0 is a valid value, compared directly)
- `chance` / `effectChance` (positive ER values; pokerogue's -1 preserved)

It does **NOT** patch:
- Move category (vanilla PHYSICAL/SPECIAL/STATUS stays)
- Move type (the primary `types[0]`)
- Builder chain / `MoveAttr` list (no `attrs` array mutation)
- `MoveFlags` bitmask (e.g. ER-added "Field Based" / "Throw" flags
  aren't OR'd in)
- Target (the `MoveTarget` enum value)

Every entry in this audit's MINOR-flag / MAJOR / TOTAL buckets is
silently running vanilla mechanics in battle beyond the numeric tweaks.

## Summary

- **844** moves audited (vanilla pokerogue MoveIds 1–950, excluding NONE).
- **577** classified **NONE** — mechanic matches; ER may rephrase but
  the builder chain is equivalent.
- **156** classified **MINOR-flag** — ER tags a flag (e.g. "Mega
  Launcher boost", "Iron Fist boost") and otherwise leaves the move
  alone. Most of these resolve transparently because pokerogue's
  vanilla builder already sets the relevant `MoveFlags` bit; the rest
  (~32, the `field-based` / `throw` / `mighty horn` set) silently
  miss ER ability boosts.
- **76** classified **MAJOR** — new effect / new trigger / new
  predicate / category-derivation change / target widening. Needs
  one or more `MoveAttr` additions per move.
- **35** classified **TOTAL** — ER reuses the move name for a
  fundamentally different mechanic (different type AND category, or
  STATUS→damaging, or OHKO→regular damage). Vanilla builder chain
  must be replaced.

Total `MAJOR + TOTAL = 111` vanilla moves whose battle behaviour is
currently more than a numeric tweak away from ER.

### Caveats

1. **`er-id-map.ts` drift.** The auto-generated id-map at
   `src/data/elite-redux/er-id-map.ts` has 67 stale entries for
   moves in the Gen 9 id range (~ER 870–900 ↔ pokerogue 880–910).
   For example, the map sends ER 883 (`MOVE_MAKE_IT_RAIN`) to
   pokerogue id 906 (`PSYBLADE`). This audit re-derives the
   mapping by `MOVE_<NAME>` lookup against `move-id.ts` and ignores
   the map. The id-map should be regenerated against pokerogue's
   current `MoveId` enum positions — that's a follow-up.

2. **`effT` ambiguity.** ER's `eff` field is a numeric index into a
   413-entry effect table whose semantics aren't always 1:1 with
   pokerogue's `MoveAttr` taxonomy. When the effect name is
   self-explanatory ("Multi Hit", "Burn Hit", "Trap") we trust it;
   when it's an arg-driven script ("Argument Hit", "Misc Hit") we
   defer to ER's `desc` / `lDesc` text.

3. **Heuristic limits on description-driven matches.** We only flag a
   delta when (a) the category/type/builder differs structurally, OR
   (b) ER's description mentions a specific numeric chance with a
   status keyword pokerogue doesn't carry. Subtle deltas described in
   prose ("Now ignores Wonder Guard", "Now grounded only") may slip
   through to NONE. ROM-level verification with `gMovesInfo` from
   `src/data/moves_info.h` would close these gaps; see
   "Suggested follow-ups" below.

4. **MINOR-flag noise.** The flag-only bucket is mostly informational
   — ER tags every Iron-Fist-eligible move, every Mega-Launcher
   pulse, every Mighty-Horn-eligible horn move, every Strong-Jaw
   bite. When pokerogue's builder already sets the equivalent
   `MoveFlags` bit, the ER ability still fires correctly in battle
   because abilities filter on `MoveFlags`. We separate this bucket
   so the gap that *isn't* covered (~32 moves with `field-based`,
   `throw`, etc.) is visible.

### Already covered by `init-elite-redux-vanilla-rebalance.ts`

Numeric retunes (power/accuracy/PP/chance/priority) are applied at
runtime to **every** vanilla move with an ER counterpart. Spot-checked
examples that show up in this audit's data:

| Move | Knob | Vanilla → ER |
|---|---|---|
| COMET_PUNCH | priority | 0 → +1 |
| GUST | priority | 0 → +1 |
| QUICK_ATTACK | priority | +1 → +2 |
| MIND_READER | priority | 0 → +4 (since it's still STATUS in ER) |
| CAMOUFLAGE | priority | 0 → +4 |
| SWIFT | priority | 0 → +2 |
| MAGNET_BOMB | power | various |
| HORN_DRILL | accuracy | 30 → 95 (now a real attack, not OHKO) |
| etc. | (847 power/accuracy/PP edits) | |

If a delta is **purely** numeric, it's not listed in the MAJOR/TOTAL
buckets below — the rebalance step already handles it.

## NEEDS PATCH — TOTAL (35)

ER reuses the move name for a different mechanic. Every entry needs
the vanilla builder chain unwired (or significantly rewritten) and
ER's mechanic implemented. Sorted by pokerogue MoveId.

| ID | Move | Vanilla mechanic | ER mechanic | Delta | Suggested wire |
|---|---|---|---|---|---|
| 11 | VISE_GRIP | Physical Normal | Physical Bug; very high crit ratio | TYPE | re-type Move + add HighCritAttr (already there if vanilla `.attr(HighCritAttr)`) |
| 12 | GUILLOTINE | Physical Normal · OHKOAttr/OneHitKOAccuracyAttr | Physical Bug 120bp 95acc; high crit; ER "Keen Edge" boost | TYPE + OHKO→regular + SLICING_MOVE flag | replace OHKOAttr with vanilla AttackMove, add HighCritAttr + `.slicingMove()` |
| 13 | RAZOR_WIND | Special Normal · 2-turn charge · HighCritAttr · WindMove | Special Flying; +1 priority in tailwind; super-effective vs Rock; HighCrit; Keen Edge | TYPE + flat-power (no charge?) + tailwind-priority bespoke | strip ChargingAttack wrap; new "priority +1 in tailwind" condition |
| 15 | CUT | Physical Normal · slicingMove | Physical Steel; always crits; Keen Edge / Field-based | TYPE + always-crit + flag | re-type + add `.attr(AlwaysCritAttr)` + `MoveFlags.FIELD_BASED` |
| 18 | WHIRLWIND | Status Normal · ForceSwitchOutAttr | Special Flying damaging attack; wind move | STA→SPC + TYPE; wholly different mechanic | replace with `new AttackMove(WHIRLWIND, FLYING, SPECIAL, …).windMove()` |
| 32 | HORN_DRILL | Physical Normal · OHKOAttr | Physical Normal 95bp high-crit; ignores abilities/stat changes; Mighty Horn boost | OHKO→regular + abilitybypass + stat-ignore + flag | replace OHKO with regular AttackMove + `MoveAbilityBypassAttr` + `IgnoreOpponentStatStagesAttr` + `HORN_BASED` flag |
| 36 | TAKE_DOWN | Physical Normal · RecoilAttr/recklessMove | Physical Fighting; 20% speed drop on hit | TYPE + adds stat-drop-on-hit | re-type + add `.attr(StatStageChangeAttr, [Stat.SPD], -1, false, …, 20)` |
| 45 | GROWL | Status Normal · StatStageChangeAttr/SoundBased | Special Normal damaging sound move that drops Atk | STA→SPC | replace with `new AttackMove(GROWL, NORMAL, SPECIAL, …).soundBased().attr(StatStageChangeAttr, [Stat.ATK], -1, false, {chance:100})` |
| 70 | STRENGTH | Physical Normal | Physical Rock; drops user defenses on hit; field-based | TYPE + self-stat-drop on hit + flag | re-type + add self stat drop + `MoveFlags.FIELD_BASED` |
| 90 | FISSURE | Physical Ground · OHKOAttr | Physical Ground 120bp spread move (no OHKO) | OHKO→regular + spread | replace OHKO; set target `ALL_NEAR_ENEMIES` |
| 99 | RAGE | Physical Normal · partial (vanilla incomplete) | Physical Fighting; rampage 2-3 turns then confuse self (Thrash variant) | TYPE + add FrenzyAttr | re-type + adapt Thrash's `.attr(FrenzyAttr)` |
| 121 | EGG_BOMB | Physical Normal · makesContact/ballBombMove | Physical Fire; 30% burn chance; 1.5x under gravity; throw-based | TYPE + status proc + gravity-power-mod + flag | re-type + `.attr(StatusEffectAttr, BURN)` + new "gravity power boost" attr + `MoveFlags.THROW_BASED` |
| 131 | SPIKE_CANNON | Physical Normal · MultiHitAttr | Physical Water; multi-hit; Mega Launcher | TYPE + flag | re-type + add `MoveFlags.PULSE_MOVE` |
| 139 | POISON_GAS | Status Poison · StatusEffectAttr (poison) | Special Poison damaging move; super-effective vs Flying; spread; 30% poison | STA→SPC + TYPE | replace with `new AttackMove(POISON_GAS, POISON, SPECIAL, …)` + bespoke "super-effective vs Flying override" + spread target |
| 140 | BARRAGE | Physical Normal · MultiHitAttr/ballBombMove | Physical Steel multi-hit | TYPE | re-type |
| 148 | FLASH | Status Normal · StatStageChange(ACC -1) | Special Electric damaging; 50% Atk drop on hit; field-based | STA→SPC + TYPE + new stat-drop predicate + flag | replace with AttackMove + ACC stat drop on hit |
| 150 | SPLASH | Status Normal · no-op | Physical Water damaging move; 20% drench chance; heavier user = stronger | STA→PHY + TYPE + bespoke "weight-based power" | wholesale replace with new AttackMove with `.attr(WeightPowerAttr)` (Heavy Slam analog) |
| 170 | MIND_READER | Status Normal · LockOnTagAttr | Status Psychic; dodges all attacks + SpDef drop to attackers | TYPE + reworked effect | re-type + replace LockOnTagAttr with new "evasion + counter-stat-drop" tag |
| 171 | NIGHTMARE | Status Ghost · NightmareTagAttr | Special Ghost damaging; heavy damage to sleeping foe + lose 1/4 HP per turn | STA→SPC | wholesale rewrite as AttackMove + sleep-damage rider |
| 218 | FRUSTRATION | Physical Normal · FriendshipPowerAttr | Physical Dark; double damage if last move failed | TYPE + new "double-on-fail" attr | re-type + replace FriendshipPowerAttr with "double-power-after-failed-move" attr |
| 265 | SMELLING_SALTS | Physical Normal · MovePowerMultiplierAttr (2x vs paralyzed)/HealStatusEffectAttr | Physical Fighting; deals damage + cures user status | TYPE; effect simplified | re-type; keep HealStatusEffectAttr (cures self), drop the 2x-vs-paralyzed condition |
| 267 | NATURE_POWER | Status Normal · NaturePowerAttr | Physical Normal damaging "uses terrain-typed move"; STA→PHY (?) | STA→PHY but mechanic is the same morphing logic; ROM check needed | likely keep NaturePowerAttr but route to a PHY attack-shell |
| 329 | SHEER_COLD | Special Ice · OHKOAttr/SheerColdAccuracyAttr | Special Ice 100bp 100acc; 20% frostbite; super-effective on Water | OHKO→regular + new status proc + bespoke type-effectiveness override | replace OHKO with regular AttackMove + frostbite status attr + bespoke "ignore water resistance" |
| 330 | MUDDY_WATER | Special Water · ACC drop | Special Ground+Water dual-type 30% ACC drop | TYPE (dual-type — unique) | re-type primary, bespoke "second type for resolution" attr |
| 431 | ROCK_CLIMB | Physical Normal · ConfuseAttr | Physical Rock; 30% confuse; field-based | TYPE + flag | re-type + add `MoveFlags.FIELD_BASED` |
| 445 | CAPTIVATE | Status Normal · StatStageChangeAttr (opposite-gender) | Special Fairy damaging; 2x damage vs infatuated | STA→SPC + TYPE + new condition | replace with `new AttackMove(CAPTIVATE, FAIRY, SPECIAL, …).attr(MovePowerMultiplierAttr, …, hasInfatuationTag)` |
| 511 | QUASH | Status Dark · ForceLastAttr | Status Psychic; suppresses turn-order effects (broader scope) | TYPE + broader scope | re-type + extend ForceLastAttr scope |
| 593 | HYPERSPACE_HOLE | Special Psychic · ignoresProtect | Special Ghost; +1 priority; ignores protect | TYPE + priority (numeric) | re-type; priority numeric-patched |
| 610 | HOLD_BACK | Physical Normal · SurviveDamageAttr | Physical Fighting; 50% confuse chance | TYPE + status proc | re-type + add ConfuseAttr |
| 746 | JAW_LOCK | Physical Dark · bitingMove/JawLockAttr | Physical Fighting; same trap effect; Strong Jaw | TYPE | re-type |
| 753 | OCTOLOCK | Status Fighting · OctolockTagAttr | Physical Fighting damaging; prevents escape + Def/SpDef drop per turn | STA→PHY | replace with `new AttackMove(OCTOLOCK, FIGHTING, PHYSICAL, …).attr(TrappedAttr).attr(OctolockTagAttr)` |
| 777 | DECORATE | Status Fairy · raises ally Atk/SpAtk | Special Fairy damaging foes + raising allies' Atk/SpAtk/crit | STA→SPC | wholesale rewrite as AttackMove + ally stat boost rider |
| 779 | SNAP_TRAP | Physical Grass · TrapAttr | Physical Steel; same trap effect | TYPE | re-type |
| 810 | CORROSIVE_GAS | Status Poison · partial (vanilla unimplemented) | Special Poison damaging move + melts items | STA→SPC | replace with AttackMove + new "remove held item on hit" attr |
| 884 | AXE_KICK | Physical Fighting · recklessMove/MissEffectAttr/NoEffectAttr | Physical Dark; 30% confuse; striker | TYPE + status proc | re-type + add ConfuseAttr |

## NEEDS PATCH — MAJOR (76)

Mechanic addition / predicate change beyond numerics. Listed in
pokerogue MoveId order. "Vanilla mechanic" shows category+type + the
most informative `MoveAttr` extracted from the builder chain.

| ID | Move | Vanilla | ER addition | Delta | Suggested wire |
|---|---|---|---|---|---|
| 3 | DOUBLE_SLAP | Phys Normal · MultiHitAttr | 10% confuse chance after 2nd hit | new status proc | add ConfuseAttr |
| 20 | BIND | Phys Normal · TrapAttr | Phys → Special category | category | change MoveCategory.SPECIAL on the AttackMove constructor |
| 22 | VINE_WHIP | Phys Grass | 30% flinch chance | new status proc | add `.attr(FlinchAttr)` |
| 23 | STOMP | Phys Normal · FlinchAttr | now destroys terrain | new field-clear rider | add `.attr(ClearTerrainAttr)` |
| 51 | ACID | Spec Poison · SpDef-1 | hits both foes; 30% SpDef drop (chance was already 10) | spread target | change `MoveTarget.BOTH` (ALL_NEAR_ENEMIES); chance is numeric-patched |
| 60 | PSYBEAM | Spec Psychic · ConfuseAttr | lowers SpAtk on hit; Mega Launcher | new stat-drop + flag | add `.attr(StatStageChangeAttr, [Stat.SPATK], -1, false, {chance:100})` + already has `PULSE_MOVE` |
| 64 | PECK | Phys Flying | now multi-hit (2-5); Mighty Horn | new multi-hit | add `.attr(MultiHitAttr)` + `HORN_BASED` flag |
| 75 | RAZOR_LEAF | Phys Grass · slicingMove/spread | hits both foes; always crits; Keen Edge | already spread; add AlwaysCrit | add `.attr(AlwaysCritAttr)` |
| 130 | SKULL_BASH | Phys Normal · charge | now ER form raises Atk first turn + attacks 2nd (already vanilla); ER drops the Def-up rider | stat-target swap | re-tune ChargingAttackMove charge effect from Def to Atk |
| 143 | SKY_ATTACK | Phys Flying · charge | now raises Atk first turn; brutal strike 2nd (was crit-and-flinch) | charge effect change | re-tune charge effect |
| 145 | BUBBLE | Spec Water · Speed-1 | hits both foes (was single); 100% chance unchanged | spread target | change target to `BOTH` |
| 149 | PSYWAVE | Spec Psychic · RandomLevelDamageAttr | +1 priority (numeric-patched); 10% confuse | new status proc | add ConfuseAttr |
| 161 | TRI_ATTACK | Spec Normal · MultiStatusEffectAttr | uses highest-of(Atk,SpAtk) | category-derivation change | new `UseHighestOffenseAttr` (or `PhotonGeyserCategoryAttr` reused) |
| 217 | PRESENT | Phys Normal · makesContact/PresentPowerAttr | Phys → Special; deals typeless damage; heals allies 50% | category + bespoke "typeless damage" + ally heal | change category; rewrite PresentPowerAttr for ER variant |
| 307 | BLAST_BURN | Spec Fire · RechargeAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 308 | HYDRO_CANNON | Spec Water · RechargeAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 314 | AIR_CUTTER | Spec Flying · slicingMove/windMove/spread | Spec → Physical | category | change MoveCategory.PHYSICAL |
| 338 | FRENZY_PLANT | Spec Grass · RechargeAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 345 | MAGICAL_LEAF | Spec Grass | Special-cast but hits Def (like Body Press) | new defender-stat selector | add `.attr(DefDefAttr)` |
| 407 | DRAGON_RUSH | Phys Dragon · FlinchAttr | now 33% recoil | new recoil rider | add `.attr(RecoilAttr, false, 0.33)` |
| 439 | ROCK_WRECKER | Phys Rock · RechargeAttr | uses highest offense; throw-based | category-derivation + flag | new `UseHighestOffenseAttr` + `THROW_BASED` flag |
| 440 | CROSS_POISON | Phys Poison · slicingMove/HighCritAttr | now hits twice; Keen Edge | new multi-hit | add `.attr(MultiHitAttr, MultiHitType.TWO)` |
| 443 | MAGNET_BOMB | Phys Steel · ballBombMove | Phys → Special | category | change MoveCategory.SPECIAL |
| 454 | ATTACK_ORDER | Phys Bug · HighCritAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 496 | ROUND | Spec Normal · soundBased/RoundPowerAttr | 20% flinch chance | new status proc | add FlinchAttr |
| 498 | CHIP_AWAY | Phys Normal · IgnoreOpponentStatStagesAttr | 40% chance to lower Atk and/or Def on hit | new stat-drop proc | add StatStageChangeAttr |
| 518–520 | WATER/FIRE/GRASS_PLEDGE | Spec · combined pledge attrs | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 523 | BULLDOZE | Phys Ground | hits all foes (was single) | spread target | change target |
| 528 | WILD_CHARGE | Phys Electric · RecoilAttr | 10% paralyze chance | new status proc | add `.attr(StatusEffectAttr, PARALYSIS)` |
| 547 | RELIC_SONG | Spec Normal · soundBased/SLEEP | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 586 | BOOMBURST | Spec Normal · soundBased/spread | now 50% recoil after | new recoil rider | add `.attr(RecoilAttr, false, 0.5)` |
| 589 | PLAY_NICE | Status Normal · StatStageChangeAttr (ATK -1) | hits ALL foes (was single ally-side) | spread target | change target |
| 591 | DIAMOND_STORM | Phys Rock · DefUp/spread | Phys → Special | category | change MoveCategory.SPECIAL |
| 605 | DAZZLING_GLEAM | Spec Fairy | now hits ALL foes (was BOTH in vanilla — verify single vs spread) | spread target | already spread, no-op if already ALL_NEAR_ENEMIES; verify |
| 618 | ORIGIN_PULSE | Spec Water · pulseMove/spread | now hits both foes; Mega Launcher | already spread | flag is data-only |
| 619 | PRECIPICE_BLADES | Phys Ground · spread | now hits ALL foes | verify spread | check target value |
| 621 | HYPERSPACE_FURY | Phys Dark · ignoresProtect | +1 priority (numeric-patched); ignores protect (already) | priority numeric | no MoveAttr change beyond what's there |
| 661 | BANEFUL_BUNKER | Status Poison · ProtectAttr | now poisons contact attackers (vanilla is Poison-protect already) | redundant with vanilla; verify | ROM check; likely NONE |
| 687 | CORE_ENFORCER | Spec Dragon · SuppressAbilitiesIfActedAttr | Spec → Physical | category | change MoveCategory.PHYSICAL |
| 690 | BEAK_BLAST | Phys Flying · BeakBlastHeaderAttr | 30% burn chance (vanilla has the chance only on the "header" pre-hit) | new direct status proc | add `.attr(StatusEffectAttr, BURN)` to the strike (not the header) |
| 711 | PRISMATIC_LASER | Spec Psychic · RechargeAttr | uses highest offense; Mega Launcher | category-derivation + flag | new `UseHighestOffenseAttr` + `PULSE_MOVE` flag |
| 718 | MULTI_ATTACK | Phys Normal · FormChangeItemTypeAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 722 | PHOTON_GEYSER | Spec Psychic · ignoresAbilities/PhotonGeyserCategoryAttr | uses highest offense (this is what vanilla does already); Mega Launcher | flag-only; verify category attr | likely NONE — vanilla already implements highest-offense; flag is data |
| 732 | PIKA_PAPOW | Spec Electric · FriendshipPowerAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 736 | GLITZY_GLOW | Spec Psychic · AddArenaTagAttr (Light Screen) | also lowers foe SpAtk on hit (?); sets wall | new stat-drop proc | add StatStageChangeAttr |
| 737 | BADDY_BAD | Spec Dark · AddArenaTagAttr (Reflect) | also lowers foe Atk on hit (?); sets wall | new stat-drop proc | add StatStageChangeAttr |
| 741 | VEEVEE_VOLLEY | Phys Normal · FriendshipPowerAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 784 | BREAKING_SWIPE | Phys Dragon · ATK -1 spread | already spread in vanilla | verify | likely NONE |
| 786 | OVERDRIVE | Spec Electric · soundBased/spread | already spread in vanilla | verify | likely NONE |
| 796 | STEEL_BEAM | Spec Steel · HalfSacrificialAttr (50% self damage on use) | now flat 50% recoil after (different mechanic than half-sacrificial) | new recoil rider | replace HalfSacrificialAttr with RecoilAttr 0.5 |
| 797 | EXPANDING_FORCE | Spec Psychic · isGrounded/MovePowerMultiplierAttr (1.5 on Psychic Terrain) | now hits all foes on Psychic Terrain (target widens dynamically) | dynamic-target | new bespoke "spread under terrain" attr |
| 801 | SHELL_SIDE_ARM | Spec Poison · ShellSideArmCategoryAttr (already uses highest damage) | already uses-highest-damage | likely NONE |
| 806 | SKITTER_SMACK | Phys Bug · SpAtk -1 | Phys → Special | category | change category |
| 807 | BURNING_JEALOUSY | Spec Fire · StatusIfBoostedAttr | hits both foes (already spread in vanilla? verify); 50% burn chance | target verify; likely NONE on damage |
| 830 | STONE_AXE | Phys Rock · slicingMove/AddArenaTrapTagHitAttr (Stealth Rock) | already sets Stealth Rock | likely NONE |
| 831 | SPRINGTIDE_STORM | Spec Fairy · spread/StatStageChange | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 832 | MYSTICAL_POWER | Spec Psychic · SpAtk+1 (user) | uses highest offense + "raises highest atk or def" | category-derivation + bespoke | new `UseHighestOffenseAttr` + bespoke "raise highest of(ATK, DEF)" |
| 836 | MOUNTAIN_GALE | Phys Ice · FlinchAttr | hits both foes; air-based | spread target + flag | change target + `AIR_BASED` flag (vanilla already wind-flagged) |
| 840 | ESPER_WING | Spec Psychic · HighCritAttr/SPD+1 | adds 50% drain | new drain rider | add `.attr(HitHealAttr, 0.5)` |
| 841 | BITTER_MALICE | Spec Ghost · ATK-1 | 30% frostbite chance | new status proc | add frostbite status attr (uses ER's FROSTBITE status — already wired) |
| 845 | CEASELESS_EDGE | Phys Dark · slicingMove/AddArenaTrapTagHitAttr (Spikes) | already sets Spikes | likely NONE |
| 846 | BLEAKWIND_STORM | Spec Flying · windMove/spread/StormAccuracyAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 847 | WILDBOLT_STORM | Spec Electric · windMove/spread/StormAccuracyAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 848 | SANDSEAR_STORM | Spec Ground · windMove/spread/StormAccuracyAttr | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |
| 892 | ICE_SPINNER | Phys Ice · ClearTerrainAttr | already clears terrain; field-based | likely NONE |
| 897 | MORTAL_SPIN | Phys Poison · RemoveBattlerTagAttr (clears wraps/seeds) | Phys → Special; ER also removes hazards | category + field-clear extension | change category + extend to hazard removal |
| 913 | TIDY_UP | Status Normal · StatStageChangeAttr/RemoveArenaTrapAttr/RemoveAllSubstitutesAttr | already does most of this | likely NONE; verify ER's "boost atk" matches |
| 918 | HYPER_DRILL | Phys Normal · ignoresProtect | already bypasses protect | likely NONE |
| 926 | AQUA_CUTTER | Phys Water · slicingMove/HighCritAttr | 20% bleed chance (ER-specific status) | new status proc | add bleed status attr (uses ER's BLEED — needs ER status wiring) |
| 936 | ELECTRO_SHOT | Spec Electric · charge/SpAtk+1 first turn | already raises SpAtk on charge | likely NONE |
| 937 | TERA_STARSTORM | Spec Normal · TeraStarstormCategoryAttr | uses highest offense; spread | category-derivation | new `UseHighestOffenseAttr` + verify spread |
| 941 | MIGHTY_CLEAVE | Phys Rock · slicingMove/ignoresProtect | already bypasses protect | likely NONE |
| 942 | TACHYON_CUTTER | Spec Steel · slicingMove/MultiHitAttr | uses highest offense; multi-hit (already) | category-derivation | new `UseHighestOffenseAttr` |
| 950 | MALIGNANT_CHAIN | Spec Poison · StatusEffectAttr (Toxic) | uses highest offense | category-derivation | new `UseHighestOffenseAttr` |

### Cross-cutting wires required for MAJOR

The 76-entry table above repeatedly invokes a handful of new primitives.
They are listed here so that implementing each one unblocks several
moves at once:

1. **`UseHighestOffenseAttr`** — already exists for PHOTON_GEYSER as
   `PhotonGeyserCategoryAttr`. Generalise so the move's
   physical/special selection is `max(Atk, SpAtk)` and route 19 vanilla
   moves through it (BLAST_BURN, HYDRO_CANNON, FRENZY_PLANT, the three
   pledges, RELIC_SONG, PRISMATIC_LASER, MULTI_ATTACK, PIKA_PAPOW,
   VEEVEE_VOLLEY, TRI_ATTACK, ATTACK_ORDER, ROCK_WRECKER,
   SPRINGTIDE_STORM, MYSTICAL_POWER, BLEAKWIND_STORM, WILDBOLT_STORM,
   SANDSEAR_STORM, TACHYON_CUTTER, MALIGNANT_CHAIN, TERA_STARSTORM,
   FICKLE_BEAM). Many of these are NORMAL/SPECIAL right now and will
   silently always-use-SpAtk.
2. **`UseHighestDamageAttr`** — pokerogue's `ShellSideArmCategoryAttr`
   already implements this for SHELL_SIDE_ARM; verify ER's
   `USE_HIGHEST_DAMAGE` matches semantically. If yes, reuse;
   otherwise widen to a single primitive.
3. **`HitsDefSpDefAttr`** — pokerogue already has `DefDefAttr` for
   Psyshock/Psystrike/Secret Sword (these are *not* deltas — vanilla
   already implements them). The one outstanding entry is MAGICAL_LEAF
   (ER added `DefDefAttr`-equivalent to a move that doesn't have it).
4. **Bleed / Frostbite status attrs.** ER's "bleed" and "frostbite"
   statuses are ER-introduced. Confirm whether pokerogue's
   `init-elite-redux-vanilla-rebalance.ts` or B2 already adds them
   to the `StatusEffect` enum; if not, that's a prerequisite for the
   ~6 MAJOR rows that add bleed/frostbite on hit (AQUA_CUTTER,
   BITTER_MALICE, SHEER_COLD, ICE_PUNCH-equivalents in custom moves,
   plus the ER-only flag tags).
5. **`MoveFlags.FIELD_BASED` etc.** Pokerogue declares the bit but
   doesn't set it on any move. The ~32 MINOR-flag entries that ER
   tags as `field-based` / `throw` / `striker` / `mighty horn` /
   `keen edge` need their `flags` bitmask updated to match ER's
   tagging so ER's flag-gated abilities (e.g. "Strikers" 1.3x on
   `KICKING_MOVE`) fire.

## MINOR-flag (data-only) — 156 vanilla moves

ER tags an ability-boost flag onto a vanilla move that pokerogue
ships without the equivalent `MoveFlags` bit. Listed by tag (with
count) — full per-move list is in
`scripts/elite-redux/tmp-move-audit-classified.tsv`.

| ER flag | Count | Maps to pokerogue `MoveFlags` | Notes |
|---|---|---|---|
| MEGA_LAUNCHER (pulse moves) | 39 | `PULSE_MOVE` | pokerogue already sets the bit via `.pulseMove()` on most; the rest (e.g. SIGNAL_BEAM, OCTAZOOKA, HYPER_BEAM, AURORA_BEAM, BUBBLE_BEAM, HYDRO_PUMP, etc.) need it added |
| KEEN_EDGE (slicing moves) | 20 | `SLICING_MOVE` | pokerogue sets via `.slicingMove()`; verify each entry |
| THROW_BASED | 19 | `THROW_BASED` (declared, unset in pokerogue) | **gap** — every "throw" tag is silently uncovered |
| IRON_FIST (punching moves) | 14 | `PUNCHING_MOVE` | pokerogue sets via `.punchingMove()`; verified-overlapping |
| STRIKER (kicking moves) | 12 | `KICKING_MOVE` | pokerogue sets via `.kickingMove()` (rare); verify ~5 entries that ER tags but vanilla doesn't |
| FIELD_BASED | 12 | `FIELD_BASED` (declared, unset in pokerogue) | **gap** — silently uncovered |
| WIND (wind moves) | 10 | `WIND_MOVE` | pokerogue sets via `.windMove()`; verify |
| MIGHTY_HORN | 8 | `HORN_BASED` | pokerogue declares the bit but rarely sets it; **gap** for ~6 |
| STRONG_JAW (biting) | 7 | `BITING_MOVE` | pokerogue sets via `.bitingMove()` |
| STRONG_JAW + FANG composite | 6 | `BITING_MOVE` | same |
| HAMMER_BASED | 5 | `HAMMER_BASED` (declared, unset) | **gap** — silently uncovered |
| KEEN_EDGE+CLAW | 5 | `SLICING_MOVE` | redundant tag |
| CLAW | 4 | (no MoveFlag) | ER-specific; no wire needed unless ER adds a "claw"-flagged ability |
| BONE_BASED | 3 | `BONE_BASED` (declared, unset) | **gap** — silently uncovered |
| ARROW_BASED | 1 | `ARROW_BASED` (declared, unset) | **gap** |
| SNAP | 1 | (no MoveFlag) | ER-specific |
| RECKLESS | 2 | `RECKLESS_MOVE` | pokerogue sets via `.recklessMove()`; verify |
| FANG | 2 | `BITING_MOVE` | covered |

**Net gap: ~32 vanilla moves** silently miss an ER ability boost
because pokerogue's `MoveFlags` field doesn't have the bit set. Most
of these are routed through ER abilities (e.g. "Mighty Horn 1.3x
to horn moves", "Field Based 1.2x in terrain", "Throw-Based +1
power") — without the bit, those abilities never trigger on the
vanilla move. This is a data-only fix (OR the `MoveFlags` bit into
the move's flag mask at rebalance time), no `MoveAttr` work needed.

## Confirmed unchanged (NONE — sample)

Mechanics match (modulo numeric retunes already handled). Full list
in `tmp-move-audit-sidebyside.tsv` (filter to rows with empty
`categoryDelta`, `typeDelta`, and no MAJOR-flagged issues).

| ID | Move | Notes |
|---|---|---|
| 1 | POUND | identical |
| 2 | KARATE_CHOP | HighCritAttr both sides; identical |
| 5 | MEGA_PUNCH | punchingMove flag matches |
| 7 | FIRE_PUNCH | 10% burn / punching, both sides |
| 8 | ICE_PUNCH | 10% freeze (frostbite in ER — wired via ER status remap) |
| 9 | THUNDER_PUNCH | 10% paralyze / punching |
| 17 | WING_ATTACK | identical |
| 19 | FLY | charge / FLYING semi-invuln; identical |
| 21 | SLAM | identical |
| 33 | TACKLE | identical |
| 38 | DOUBLE_EDGE | RecoilAttr + recklessMove both sides |
| 44 | BITE | FlinchAttr 30% / bitingMove; matches ER |
| 47 | SING | sleep status |
| 49 | SONIC_BOOM | fixed damage |
| 53 | FLAMETHROWER | 10% burn |
| 58 | ICE_BEAM | 10% freeze/frostbite (status remap) |
| 63 | HYPER_BEAM | RechargeAttr |
| 71 | ABSORB | HitHealAttr |
| 81 | STRING_SHOT | SPD-1 |
| 85 | THUNDERBOLT | 10% paralyze |
| 92 | TOXIC | TOXIC status |
| 94 | PSYCHIC | 10% SpDef drop |
| 100 | TELEPORT | SwitchOutTeleport |
| 113 | LIGHT_SCREEN | screen tag |
| 115 | REFLECT | screen tag |
| 153 | EXPLOSION | sacrificial |
| 188 | SLUDGE_BOMB | 30% poison |
| 201 | SANDSTORM | weather change |
| 219 | SAFEGUARD | safeguard tag |
| 226 | BATON_PASS | switch |
| … | … | (~570 more) |

For exhaustive verification consult
`scripts/elite-redux/tmp-move-audit-sidebyside.tsv` — every audited
pair is listed with parsed pokerogue builder chain and ER metadata.

## Suggested follow-ups

1. **Regenerate `er-id-map.ts`.** 67 Gen 9 moves have stale id mappings
   that send `init-elite-redux-vanilla-rebalance.ts` numeric patches
   to the wrong move (e.g. ER MOVE_PSYBLADE's power/accuracy lands on
   pokerogue HYDRO_STEAM). Re-running `pnpm run er:build` against the
   current `move-id.ts` should fix this — but verify the `id-map.mjs`
   builder uses name-based matching (it does — the bug is that the
   committed output is stale, not that the algorithm is wrong).
2. **Wire `UseHighestOffenseAttr`.** ~19 vanilla moves (the gen-1
   elemental starter signatures + the storms + the secret-armor
   variants) currently always use SpAtk; ER routes them through
   `max(Atk, SpAtk)`. Generalise pokerogue's `PhotonGeyserCategoryAttr`
   and apply.
3. **Patch the missing `MoveFlags` bits.** The ~32 vanilla moves
   tagged `field-based` / `throw` / `mighty horn` / `hammer` /
   `bone` / `arrow` in ER need their flag bitmask updated at
   rebalance time so ER ability flag-boosts trigger.
4. **Add bleed / frostbite status hooks** if not already wired in
   B1/B2. The ~6 MAJOR rows that add these statuses on hit can't be
   patched until the `StatusEffect` enum and the corresponding
   battle hook know how to apply them.
5. **TOTAL bucket implementation.** 35 vanilla move slots are
   currently running mechanics nothing like ER ships. Highest-impact
   replacements (most-frequently-used moves):
   GUILLOTINE, HORN_DRILL, FISSURE, SHEER_COLD (all OHKO→regular —
   shared "delete OHKOAttr" treatment),
   WHIRLWIND (force-switch → spec attack),
   GROWL, NIGHTMARE, OCTOLOCK (STA→damaging — shared "replace
   StatusMove with AttackMove" treatment),
   FRUSTRATION (FriendshipPowerAttr → "double-after-fail").

## Appendix — audit scripts

- `scripts/elite-redux/audit-vanilla-moves.mjs` — Pass 1: emits the
  side-by-side TSV by parsing `initMoves()` and joining with the ER
  dump (matched by `MOVE_<NAME>` against `move-id.ts`).
- `scripts/elite-redux/audit-vanilla-moves-mech.mjs` — Pass 2:
  classifies each row's deltas using keyword heuristics on the ER
  description + structural comparisons to the pokerogue builder
  chain. Emits classified TSV + per-issue histogram.
- `scripts/elite-redux/audit-vanilla-moves-render.mjs` — renders
  the classified TSV into the Markdown tables above.

Re-run with `node scripts/elite-redux/audit-vanilla-moves.mjs &&
node scripts/elite-redux/audit-vanilla-moves-mech.mjs`. These are
intentionally one-shot audit scripts and not part of the build —
they're stashed alongside the existing `classify-moves.mjs` for
reproducibility.
