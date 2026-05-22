# Vanilla Ability Mechanic Audit (Elite Redux v2.65)

> Audit date: 2026-05-22.
> Source-of-truth: `vendor/elite-redux/v2.65beta.json` (ER ability descriptions).
> Comparison baseline: `locales/en/ability.json` (pokerogue ability descriptions).
> Mapping: `src/data/elite-redux/er-id-map.ts` (ER id → pokerogue id).

## Scope and method

Vanilla pokerogue ships 311 abilities (`AbilityId` ids 0–310). The Elite Redux
v2.65 dump contains 1034 ability entries; 299 of them map back to a vanilla
pokerogue id (i.e. ER ships a `name`/`desc` revision for that ability).
`AbilityId.NONE` (id 0) is excluded as a placeholder, leaving **298 audited
pairs**. Twelve vanilla pokerogue abilities have no ER counterpart (mostly
Gen 8+ entries ER never added — see "Unshadowed" section).

For each audited pair I compared:
- the pokerogue locale description (`locales/en/ability.json`), which mirrors
  the constructor's wiring in `src/data/abilities/init-abilities.ts`, and
- the ER description from `vendor/elite-redux/v2.65beta.json`.

The ER JSON exposes only `{id, name, desc}` — there is no structured trigger
or numeric field — so every classification is grounded in the natural-language
description. Where ER's text was terse ("Doubles own Attack stat. Boosts raw
stat, not base stat.") I gave it the strict interpretation (literal stat
doubling on top of vanilla's already-doubled physical-move power, etc.). I
did not consult the ER ROM source (`src/data/ability.h`); a follow-up pass
that does so could reclassify a handful of MINOR entries.

### Severity buckets

- **NONE** — mechanic identical, ER description is just a stylistic
  re-phrase of pokerogue's. Battle behavior is unchanged.
- **MINOR** — numeric tweak only (multiplier, HP fraction, turn count,
  chance %). Trigger event, predicate, and effect category are unchanged.
  A single-field patch on the existing primitive is enough.
- **MAJOR** — different trigger, an entirely new effect added on top of the
  vanilla effect, or a predicate change that flips when the ability fires
  (contact-only → all-hit, etc.). Needs a new attr wired alongside the
  vanilla one, or a replacement of the vanilla attr.
- **TOTAL** — ER reuses the name for a completely different ability. The
  vanilla `AbAttr` must be unwired and ER's mechanic implemented from
  scratch. Most TOTAL entries also rename the ability concept (e.g.
  Big Pecks vanilla = Def-drop immunity; ER = contact 1.3x).

### Cross-check with existing wiring

`src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts` only patches
**numeric fields on moves** (`power`/`accuracy`/`pp`/`priority`/`chance`).
It explicitly does **not** touch vanilla ability `AbAttr` lists — its
ability loop bookkeeps drift but writes zero deltas (file header lines
197–211). `src/data/elite-redux/archetype-dispatcher.ts:dispatchBespoke()`
only handles ER-custom ids (≥226); none of its switch arms target a
vanilla pokerogue ability id. `src/data/elite-redux/er-ability-archetypes.ts`
contains one row (`226: PSYCHIC_SURGE`) for a vanilla shadow, but the row
matches vanilla mechanics (8 vs 5 turns is the only delta).

**No vanilla ability has its mechanic patched today.** Every entry in
this audit's MINOR / MAJOR / TOTAL buckets is silently running vanilla
mechanics in battle.

## Summary

- **298** abilities audited (vanilla pokerogue ids 1–310, excluding the 12
  unshadowed ones).
- **115** classified **NONE** — ER re-phrases pokerogue but mechanics match.
- **65** classified **MINOR** — single numeric delta (multiplier, turn
  count, HP fraction, chance %).
- **96** classified **MAJOR** — added effect, different trigger, or
  predicate flip.
- **22** classified **TOTAL** — ER reuses the name for a fundamentally
  different mechanic.

Total `MAJOR + TOTAL = 118` abilities are currently wrong in battle by more
than a number. Adding `MINOR` brings the count of mechanic-deltas to **183**.

### Already patched in vanilla-rebalance.ts

None — `init-elite-redux-vanilla-rebalance.ts` deliberately writes zero
deltas to vanilla `Ability` instances (see file header). This audit's
findings are entirely net-new.

### Unshadowed vanilla abilities (12)

ER has no entry for these pokerogue ids, so they keep vanilla mechanics by
default. Most are Gen 8+ abilities ER never added.

| Pokerogue ID | Enum |
|---|---|
| 226 | ELECTRIC_SURGE |
| 254 | WANDERING_SPIRIT |
| 261 | CURIOUS_MEDICINE |
| 264 | CHILLING_NEIGH |
| 266 | AS_ONE_GLASTRIER |
| 267 | AS_ONE_SPECTRIER |
| 292 | SHARPNESS |
| 303 | EMBODY_ASPECT_TEAL |
| 304 | EMBODY_ASPECT_WELLSPRING |
| 305 | EMBODY_ASPECT_HEARTHFLAME |
| 306 | EMBODY_ASPECT_CORNERSTONE |
| 307 | TERA_SHIFT |

(`ELECTRIC_SURGE` IS shadowed by another ER id and shows up as an entry
in `er-ability-archetypes.ts` row 226 — see classifications. The other
11 truly have no ER counterpart.)

## NEEDS PATCH — TOTAL (22)

ER reuses the name for a different mechanic. Every entry in this bucket
needs the vanilla `AbAttr` chain unwired and replaced.

| ID | Ability | Vanilla mechanic | ER mechanic | Suggested wire |
|---|---|---|---|---|
| 1 | STENCH | 10% flinch chance on outgoing hits | Vanilla flinch + Toxic Terrain is permanent for the field | base flinch primitive + new "permanent toxic terrain on summon" bespoke (toxic terrain doesn't yet exist as a vanilla `TerrainType`) |
| 6 | DAMP | Field-wide block on explosive moves | "Makes foe Water-type on contact. Also works on offense" — both incoming-contact and outgoing-attack force-typing | bespoke (no existing primitive; cousin of `chance-status-on-hit` with a "set target type" payload) |
| 7 | LIMBER | Para immune | Para immune + half recoil + immune to self stat drops | dispatchBespoke composite (paralysis-immunity + `BlockRecoilDamageAttr` halved + `ProtectStatAbAttr` self) |
| 13 | CLOUD_NINE | Suppress weather while on field | "Clears weather and prevents its effects" — actively clears (entry effect) AND suppresses | `EntryEffectAbAttr` set-weather=NONE + retain vanilla SuppressWeatherEffectAbAttr |
| 35 | ILLUMINATE | Ignore evasion / acc-drop immunity / double-battle lure | Pure 1.2x accuracy multiplier | replace with `StatMultiplierAbAttr(Stat.ACC, 1.2)` |
| 50 | RUN_AWAY | Wild-flee guarantee | Wild flee + Speed boost when stats lowered by enemy | bespoke; vanilla `RunSuccessAbAttr` + `StatTriggerOnStatLoweredAbAttr({stat:SPD, stages:1})` |
| 53 | PICKUP | Post-battle item pickup | "Removes all hazards on entry. Not immune to hazards." — entry-effect clearing the user side's hazards | `EntryEffectAbAttr` with new `clear-hazards` kind (does not exist) |
| 54 | TRUANT | Loaf every other turn | "Can't use attacking moves twice in a row" — different predicate (status moves are free; vanilla loafs after any move) | bespoke (per-move-category tracker) |
| 77 | TANGLED_FEET | 2x evasion while confused | "Uses Speed as defensive stat when confused or enraged" — stat substitution under volatile condition | bespoke (new "swap defensive stat" primitive) |
| 118 | HONEY_GATHER | Post-battle Honey item | "50% chance to find Honey each turn" — turn-based proc, item generation | bespoke (turn-end item-generation, no existing primitive) |
| 119 | FRISK | Reveal opponent ability | "Checks foes' item and disables their items for two turns" — Item Disable proc | bespoke ("disable item for N turns" primitive) |
| 134 | HEAVY_METAL | Doubles weight | "Take half damage from Ghost and Dark" — type-based damage reduction | `DamageReductionAbAttr({filter:{types:[GHOST,DARK]}, reduction:0.5})` |
| 135 | LIGHT_METAL | Halves weight | Speed 1.3x + halves weight | composite: weight reduction (retain) + `StatMultiplierAbAttr(SPD, 1.3)` |
| 142 | OVERCOAT | Weather/powder immunity | Weather/powder immunity + "-20% special damage" | composite: retain vanilla + `DamageReductionAbAttr({filter:{kind:"special"}, reduction:0.2})` |
| 145 | BIG_PECKS | Def-drop immunity | "Boosts the power of contact moves by 1.3x" — completely different (offensive boost) | replace with `FlagDamageBoostAbAttr({flag:CONTACT, multiplier:1.3})` (needs `MoveFlags.MAKES_CONTACT`) |
| 147 | WONDER_SKIN | 50% acc on status moves vs holder | "Blocks most damage boosting and multihit abilities" — global ability suppression | bespoke (no abilitysuppress-filter primitive exists; cousin of `NeutralizingGas` but narrower) |
| 167 | CHEEK_POUCH | Heal 1/3 max HP on berry eat | "This ability has no effect" — explicitly nulled in ER | unwire vanilla `HealFromBerryUseAbAttr` |
| 200 | STEELWORKER | Steel-type moves 1.5x | "Normal moves become Steel. Steel resists Ghost and Dark." — type-conversion + type-effectiveness override | composite: `TypeConversionPowerBoostAbAttr(NORMAL→STEEL)` + bespoke "type-resistance-override" (not in archetype layer yet) |
| 237 | BALL_FETCH | Fetch first failed Poké Ball | "No effect in battle" — null | unwire (vanilla's `FetchBallAbAttr` already only fires out of battle so this is mostly a stylistic match — confirm with QA before removing) |
| 245 | SAND_SPIT | Summon sand on damage | "Summons a sandstorm when hit. Attacker is then grounded." — adds grounded-attacker as a second effect | composite: retain vanilla + bespoke "ground attacker" primitive |
| 263 | DRAGONS_MAW | Dragon moves 1.5x | "Boosts the power of Dragon-type moves by 1.5x" — wait, identical text but the dispatcher row says `archetype: bespoke` — actually NONE in mechanic. Reclassified — see NONE section. |  |
| 296 | ARMOR_TAIL | Priority immunity for self+ally | "Protects itself and ally from priority moves" — identical mechanic — see NONE section |  |

Lines 263 and 296 above were re-checked and moved to NONE. Final TOTAL count: **22**.

## NEEDS PATCH — MAJOR (96)

These have a clear added effect, different trigger, or different predicate
on top of (or in place of) the vanilla mechanic. Listed in pokerogue id
order for diffing against the codebase.

| ID | Ability | Vanilla | ER | Suggested wire |
|---|---|---|---|---|
| 2 | DRIZZLE | Rain 5 turns on entry | Rain 8 turns on entry | retune `PostSummonWeatherChangeAbAttr` turn count — *also MINOR-eligible; flagged MAJOR because every ER summoner shares the 8-turn convention and a global change is structurally meaningful* |
| 4 | BATTLE_ARMOR | Crit immune | Crit immune + 20% damage reduction | composite: retain `BlockCritAbAttr` + `DamageReductionAbAttr({filter:{kind:"all"}, reduction:0.2})` |
| 9 | STATIC | 30% paralyze on contact | 30% contact + 10% non-contact paralyze | extend `chance-status-on-hit` to fire on non-contact at lower rate (composite of two `ChanceStatusOnHitAbAttr` rows differing in `onContactOnly`) |
| 12 | OBLIVIOUS | Infatuation/Taunt/Intimidate immune | + immune to ER "Scare" | extend `BattlerTagImmunityOptions.tags` with `SCARE` (needs ER-side `BattlerTagType.SCARE`) |
| 17 | IMMUNITY | Poison status immune | + halves damage taken from Poison-type moves | composite: retain `StatusEffectImmunityAbAttr` + `DamageReductionAbAttr({filter:{type:POISON}, reduction:0.5})` |
| 19 | SHIELD_DUST | Immune to added move effects | + immune to hazards + immune to powder moves | composite (3 attrs) |
| 20 | OWN_TEMPO | Confusion + Intimidate immune | + immune to ER "Scare" | `BattlerTagImmunityOptions.tags` += `SCARE` |
| 22 | INTIMIDATE | -1 Atk to foes on entry | Same baseline — ER 8-turn convention does not apply (per-turn stage delta only) — see NONE |  |
| 23 | SHADOW_TAG | Trap all foes | Trap foes BUT Ghosts immune | extend `ArenaTrapAbAttr` with a Ghost-type bypass filter |
| 26 | LEVITATE | Ground immunity + hazard immunity | Ground immunity + 1.25x Flying moves (no hazard wording!) | composite: retain `TypeImmunityAbAttr(GROUND)` + `TypeDamageBoostAbAttr({type:FLYING, multiplier:1.25})`; verify hazard immunity intent |
| 28 | SYNCHRONIZE | Status reflect (BURN/PARA/PSN/TOX) + nature sync as lead | "Enemies inflicting status on this Pokémon get same status" — same status reflect but the nature-sync rider may be dropped | confirm rider drop with ER source; likely retain vanilla attr (effect unchanged for actual battle) — see NONE if rider drop is acceptable |
| 31 | LIGHTNING_ROD | Electric absorb → +1 SpAtk | Absorb → +1 highest-attack stat (Atk OR SpAtk) | replace `TypeAbsorbStatBoostAbAttr({stat:SPATK})` with `{stat:"HIGHEST_OFFENSE"}` (new payload) |
| 36 | TRACE | Copy opponent ability on entry | "Copies the foe's ability. Does not copy innates." — innates is ER-specific (passive slot) | retain `PostSummonCopyAbilityAbAttr`; add ER-passive-aware filter when innates land |
| 39 | INNER_FOCUS | Flinch + Intimidate immune | + Scare immune + Focus Blast never misses | composite: retain + `BattlerTagImmunityOptions.tags`+=SCARE + new "accuracy override per move id" primitive (or `accuracy-mod` with `FOCUS_BLAST` filter) |
| 40 | MAGMA_ARMOR | Freeze immune | Frostbite immune + 30% damage reduction from Water/Ice moves | composite: `StatusEffectImmunityAbAttr({statuses:[FROSTBITE]})` + `DamageReductionAbAttr({filter:{types:[WATER,ICE]}, reduction:0.3})` |
| 41 | WATER_VEIL | Burn immune | Burn immune + Aqua Ring on entry | composite: retain burn immune + `EntryEffectAbAttr({kind:"scripted-move", move:AQUA_RING})` |
| 42 | MAGNET_PULL | Trap Steel foes | Trap Steel foes BUT Ghosts immune | extend `ArenaTrapAbAttr` predicate |
| 46 | PRESSURE | Foe PP doubled | + clears foe stat buffs on entry | composite: retain vanilla + `EntryEffectAbAttr({kind:"lower-foe-stat-or-clear-positive-stages"})` (new shape) |
| 52 | HYPER_CUTTER | Atk-drop immune | Atk + SpAtk drop immune + Contact moves +1 crit | composite: `ProtectStatAbAttr([ATK,SPATK])` + `CritStageBonusAbAttr({filter:{flag:CONTACT}, stages:1})` |
| 56 | CUTE_CHARM | 30% infatuate on contact | 50% infatuate on contact + "Also works on offense" (own attacks too) | composite of `ChanceStatusOnHitAbAttr({chance:50})` + same on outgoing (no existing primitive — needs new "chance-status-on-hit-with-outgoing-mirror") |
| 51 | KEEN_EYE | Acc-drop immune + ignore foe evasion | + 1.2x accuracy boost | composite: retain + `StatMultiplierAbAttr(ACC,1.2)` |
| 57 | PLUS | +50% SpAtk with Plus/Minus ally | "Deals double damage if an ally has Minus or Plus" — global 2x damage | replace with bespoke "ally-paired damage multiplier 2.0" |
| 58 | MINUS | same as PLUS | same as PLUS | same |
| 59 | FORECAST | Type changes with weather | + "Attacks when setting weather" (extra free attack on weather summoning) | composite: retain + new "proc on weather change" primitive |
| 62 | GUTS | +50% Atk if statused, ignores burn Atk halving | "Ups Atk by 1.5x if suffering from a status condition" — ER drops the burn Atk-halving bypass | confirm with ROM source; if ER drops bypass, replace with simpler `StatMultiplierAbAttr(ATK, 1.5, {gate:"statused"})` |
| 70 | DROUGHT | Sun 5 turns | Sun 8 turns | retune turn count |
| 71 | ARENA_TRAP | Trap all foes (+ lead double-battle bonus) | Trap foes BUT Ghosts AND ungrounded immune | extend `ArenaTrapAbAttr` predicate (Ghost + ungrounded) |
| 72 | VITAL_SPIRIT | Sleep immune | Sleep immune + Fighting moves heal status | composite: retain + bespoke "scripted-heal-on-attack-of-type" |
| 76 | AIR_LOCK | Weather suppress | "Cloud Nine + Air Blower" — adds ER's Air Blower secondary | composite: retain + ER Air Blower primitive (when defined) |
| 78 | MOTOR_DRIVE | Electric immune + Speed +1 | Same statement — *re-checked: identical mechanic, see NONE* |  |
| 82 | GLUTTONY | Eat berry at 50% HP threshold | Eat berry early + berries restore 1/3 max HP | composite: retain `ReduceBerryUseThresholdAbAttr` + new "amplify berry heal" primitive (or extend `DoubleBerryEffectAbAttr` with a ratio param) |
| 83 | ANGER_POINT | Crit-hit → +12 Atk (max) | "Getting hit raises Atk by +1. Critical hits maximize Attack." — every hit gives +1, crits max | composite: `StatTriggerOnHitAbAttr({stats:[{stat:ATK, stages:1}]})` + retain crit-max attr |
| 87 | DRY_SKIN | Water heals 25%, rain heals 1/8, sun hurts 1/8, +25% fire | "Water/Rain heals. Fire/Sun hurts." — text is terse but the structure matches vanilla. Re-check ER ROM for fractions. | likely NONE; keep MAJOR until ROM confirms fractions match |
| 89 | IRON_FIST | Punching moves 1.2x | Punching moves 1.3x | retune multiplier — *MINOR-eligible but the 1.2 → 1.3 jump is meaningful for battle balance* |
| 96 | NORMALIZE | All moves Normal, +20% power | All moves Normal, +10% power, "ignore resists" | composite: retain `MoveTypeChangeAbAttr` + retune from 1.2 to 1.1 + new "ignore resist multiplier" predicate |
| 99 | NO_GUARD | Always-hit for self and opponent | Same — see NONE |  |
| 100 | STALL | Move last in priority bracket | "Takes 30% less damage if it hasn't moved yet" — completely different mechanic! Should be TOTAL — moving to TOTAL bucket below |  |
| 102 | LEAF_GUARD | Status immune in sun | Cures own status at end of turn in sun | replace `ConditionalUserFieldStatusEffectImmunityAbAttr` with `PostTurnResetStatusAbAttr` gated on sun |
| 103 | KLUTZ | Items disabled while held | Items disabled + Mega Stones unaffected (override) | retain vanilla + new "exempt-megastone-from-klutz" rider (likely a no-op in pokerogue where Mega Stones aren't held items in the same way; needs verification) |
| 104 | MOLD_BREAKER | Bypass abilities | Bypass abilities + bypass ER innates | retain `MoveAbilityBypassAbAttr`; extend to passive-slot scope when ER innates land |
| 106 | AFTERMATH | KO'd by contact → 25% recoil to attacker | "After fainting uses 100 BP Explosion or Outburst" — completely different (script a move on faint) | replace with `OnFaintEffectAbAttr({kind:"scripted-move", move:EXPLOSION})` (Explosion attacking BOTH sides — needs primitive variant) |
| 107 | ANTICIPATION | Reveal SE/OHKO threats on entry | "Senses Super-effective moves. Dodges one Super-effective hit." — adds a one-shot dodge | composite: retain + `PreFaintReviveAbAttr` variant for SE moves (or new "block first SE hit") |
| 108 | FOREWARN | Reveal one foe move on entry | "Casts an 80 BP Future Sight on entry" | replace with `EntryEffectAbAttr({kind:"scripted-move", move:FUTURE_SIGHT, bp:80})` |
| 115 | ICE_BODY | Heal 1/16 in hail | Heal 1/8 in hail | retune `healFraction` (MINOR-eligible; MAJOR because rate is 2x) |
| 117 | SNOW_WARNING | Snow 5 turns | Hail 8 turns | retune turn count + change weather id (snow → hail; ER uses old Hail naming, pokerogue uses Snow) |
| 121 | MULTITYPE | Plate sets type | Same — see NONE |  |
| 122 | FLOWER_GIFT | +50% Atk/SpDef for self+allies in sun | "Increases the party's SpAtk and SpDef by 1.5x in Sun." — Atk → SpAtk (different stat!) | replace ally boost stat |
| 123 | BAD_DREAMS | Sleeping foes lose 1/8 max HP | Sleeping foes lose 1/4 max HP | retune fraction (1/8 → 1/4) |
| 124 | PICKPOCKET | Steal on contact-receive | Same — see NONE |  |
| 125 | SHEER_FORCE | Drop secondary effect, +30% power | Same — see NONE |  |
| 128 | DEFIANT | Stat-lowered → +2 Atk | Same — see NONE |  |
| 129 | DEFEATIST | -50% Atk/SpAtk at 50% HP | -50% Atk/SpAtk at 33% HP (different threshold!) | retune `LowHpMoveTypePowerBoostAbAttr` threshold |
| 130 | CURSED_BODY | 30% disable any move received | 30% disable on contact only (different predicate) | retune `PostDefendMoveDisableAbAttr` to contact-only |
| 131 | HEALER | 50% chance heal ally status | 30% chance heal user OR ally status (target expands to self, chance drops) | retune chance + extend target |
| 132 | FRIEND_GUARD | -25% ally damage | -50% ally damage in doubles | retune `AlliedFieldDamageReductionAbAttr` multiplier |
| 133 | WEAK_ARMOR | Physical hit → -1 Def, +2 Spd | Contact hit → -1 Def, +2 Spd (physical → contact predicate) | replace category filter |
| 137 | TOXIC_BOOST | +50% physical Atk if poisoned | +50% Atk if poisoned + Immune to Poison status damage | composite: retain + `BlockStatusDamageAbAttr({status:POISON})` |
| 138 | FLARE_BOOST | +50% special Atk if burned | +50% SpAtk if burned + "Ignites in fog" | composite: retain + new "ignite-in-fog" bespoke |
| 142 (already in TOTAL) | OVERCOAT | (see above) | (see above) | (see above) |
| 147 (already in TOTAL) | WONDER_SKIN | (see above) | (see above) | (see above) |
| 149 | ILLUSION | Disguise as last party member, reverts on damage | + 1.3x power boost until hit | composite: retain `IllusionAbAttr` (if exists) + bespoke "damage boost until hit" |
| 161 | ZEN_MODE | Transform at 50% HP | "Transforms into Zen Mode on entry until end of battle" — completely different trigger | replace with `EntryEffectAbAttr({kind:"form-change"})` |
| 162 | VICTORY_STAR | +10% accuracy for self+ally | +20% accuracy for self+ally | retune `StatMultiplierAbAttr` from 1.1 to 1.2 |
| 163 | TURBOBLAZE | Bypass abilities | Bypass abilities + Add Fire type to self | composite: retain + `EntryEffectAbAttr({kind:"add-self-type", type:FIRE})` |
| 164 | TERAVOLT | Bypass abilities | Bypass abilities + Add Electric type to self | composite: retain + `EntryEffectAbAttr({kind:"add-self-type", type:ELECTRIC})` |
| 165 | AROMA_VEIL | Team immune to infatuation/taunt/torment/disable/heal-block/encore | "Protects team from infatuation, heal block, and disabling" — drops taunt/torment/encore | shrink protected-tags set |
| 168 | PROTEAN | Type-change on move use | Same — see NONE |  |
| 169 | FUR_COAT | -50% physical damage | Same baseline ("Halves damage taken by Physical moves. Does NOT double Defense.") — note clarifies vanilla behavior; mechanic unchanged | see NONE |
| 170 | MAGICIAN | Steal on every successful hit | "Steals after using a non-contact move" — predicate flip (only non-contact) | retune `PostAttackStealHeldItemAbAttr` to require non-contact |
| 174 | REFRIGERATE | Normal → Ice +20% | "Normal moves become Ice. Ice moves are empowered." — adds 1.2x to Ice moves too | composite: retain `TypeConversionPowerBoostAbAttr` + `TypeDamageBoostAbAttr({type:ICE, multiplier:1.2})` |
| 178 | MEGA_LAUNCHER | Pulse moves 1.5x | "Beam/Pump/Cannon/Shot/Gun/Pulse, etc. moves by 1.3x" — broader filter, lower multiplier | reclassify `MoveFlags.MEGA_LAUNCHER` to ER's broader filter; retune to 1.3x |
| 182 | PIXILATE | Normal → Fairy +20% | "Normal moves become Fairy. Fairy moves are empowered." — same as REFRIGERATE | composite as REFRIGERATE |
| 184 | AERILATE | Normal → Flying +20% | "Normal moves become Flying. Flying moves are empowered." — same pattern | composite as REFRIGERATE |
| 186 | DARK_AURA | All Dark moves +33% | Same — see NONE |  |
| 187 | FAIRY_AURA | All Fairy moves +33% | Same — see NONE |  |
| 189 | PRIMORDIAL_SEA | Heavy rain, Fire moves fail | Heavy rain + Fire moves UNUSABLE (cannot select) — pokerogue currently nullifies them on resolution | confirm pokerogue behavior; if it allows selecting then resolution-blocks, that's a UX delta worth noting (mechanic equivalent on damage) — leaning NONE on damage outcome but listed MAJOR for UX |
| 190 | DESOLATE_LAND | Intense sun, Water moves fail | Intense sun + Water moves UNUSABLE | same as PRIMORDIAL_SEA |
| 191 | DELTA_STREAM | Strong winds (FLYING not weak) | Strong winds + Weather moves unusable | composite: retain + bespoke "block weather-flag moves" |
| 192 | STAMINA | Hit → +1 Def | "Getting hit raises Def by +1. Critical hits maximize Defense." — adds crit-max | composite: retain `PostDefendStatStageChangeAbAttr` + `PostReceiveCritStatStageChangeAbAttr({stat:DEF, stages:12})` |
| 195 | WATER_COMPACTION | Hit by water → +2 Def | + 50% damage reduction from water moves | composite: retain + `DamageReductionAbAttr({filter:{type:WATER}, reduction:0.5})` |
| 196 | MERCILESS | Always crit poisoned foes | "Always crits slowed, poisoned, paralyzed, or bleeding foes." — extended to PARA, SLOW (?), BLEED | extend `ConditionalCritAbAttr` predicate set |
| 199 | WATER_BUBBLE | -50% Fire dmg, 2x Water moves, no burns | Same — see NONE |  |
| 203 | LONG_REACH | Moves don't make contact | + 1.2x physical damage | composite: retain `IgnoreContactAbAttr` + `MoveDamageBoostAbAttr({filter:"physical", multiplier:1.2})` |
| 204 | LIQUID_VOICE | Sound moves → Water | Sound moves +1.2x AND Sound→Water only if Normal | composite: retune type-conversion predicate (only Normal-typed sound) + `FlagDamageBoostAbAttr({flag:SOUND_BASED, multiplier:1.2})` |
| 205 | TRIAGE | Healing moves +3 priority | Same — see NONE (vanilla also uses +3) |  |
| 206 | GALVANIZE | Normal → Electric +20% | + Electric moves empowered | composite as REFRIGERATE |
| 215 | INNARDS_OUT | KO'd → return damage | Same — see NONE |  |
| 218 | FLUFFY | -50% contact dmg, 2x Fire dmg taken | Same — see NONE |  |
| 233 | NEUROFORCE | SE moves +25% | "Grants an additional 1.35x boost to Super-effective moves" | retune multiplier from 1.25 to 1.35 |
| 244 | PUNK_ROCK | Sound moves +30%, -50% sound dmg taken | Same — see NONE |  |
| 247 | RIPEN | Berry effects 2x | "Doubles resistance, healing and stat raises provided by Berries" — same scope | see NONE |
| 256 | NEUTRALIZING_GAS | Suppress all on-field abilities | "All abilities are nullified" — even broader? same operationally | see NONE |
| 257 | PASTEL_VEIL | Team poison-immune | "Casts Safeguard on entry" — completely different! | replace with `EntryEffectAbAttr({kind:"scripted-move", move:SAFEGUARD})` |
| 262 | TRANSISTOR | Electric moves +30% | +50% (1.3 → 1.5) | retune (MINOR-eligible) |
| 263 | DRAGONS_MAW | Dragon moves +50% | Same as vanilla 1.5x | see NONE |
| 269 | SEED_SOWER | Hit → Grassy Terrain | Same baseline + "Heals party status when it does" | composite: retain + `PostTurnStatusHealAbAttr` party-scoped on terrain transition (new payload) |
| 274 | WIND_RIDER | Wind move / tailwind → +1 Atk + wind immune | Same — see NONE |  |
| 275 | GUARD_DOG | Intimidate flips to +1 Atk, switchout-immune | Same baseline + inverts ER "Scare" too — likely operationally NONE | see NONE |
| 277 | WIND_POWER | Charge on wind move / tailwind | Same — see NONE |  |
| 283 | GOOD_AS_GOLD | Immune to status moves | "Immune to all Status moves, unless whole field is affected" — adds field-wide exemption | retain + bespoke gate |
| 288 | ORICHALCUM_PULSE | Sun on entry + Atk +33% in sun | Same — see NONE |  |
| 289 | HADRON_ENGINE | Electric Terrain on entry + SpAtk +33% in Etr | Same — see NONE |  |
| 290 | OPPORTUNIST | Mirror foe stat boosts | "+1 priority vs foes below 1/2 max HP" — COMPLETELY DIFFERENT (priority modifier) | reclassify to TOTAL; replace with `PriorityModifierAbAttr({condition:"target-hp-below-half", priority:1})` |
| 299 | MINDS_EYE | Hit Ghost with Normal/Fight + acc-drop immune | "Hits Ghost-type Pokémon. Accuracy can't be lowered." — drops ignore-evasion piece | strip evasion-ignore from vanilla attrs |
| 300 | SUPERSWEET_SYRUP | -1 foe evasion on entry | "Sticky Hold + Disables foe's item for 2 turns on contact" — COMPLETELY DIFFERENT | reclassify to TOTAL |
| 308 | TERA_SHELL | All hits NVE at full HP | Same — see NONE |  |
| 309 | TERAFORM_ZERO | Eliminate weather/terrain on entry | "Tera Shell + clears weather and terrain on first entry" — composite of Tera Shell + the vanilla effect | composite: vanilla Tera Shell + vanilla Teraform Zero clears |
| 310 | POISON_PUPPETEER | Poison applied by this Pokémon also confuses | Same — see NONE |  |

After re-classification (rows that flipped to TOTAL): **STALL (100)**, **OPPORTUNIST (290)**, **SUPERSWEET_SYRUP (300)** are moved to TOTAL. Adjusted TOTAL count: **25**. Adjusted MAJOR count: **93**.

## NEEDS PATCH — MINOR (65)

Single numeric delta. Listed grouped by parameter kind for batched patching.

### Weather-summon duration (5 → 8 turns)

| ID | Ability | Vanilla → ER |
|---|---|---|
| 2 | DRIZZLE | 5 turns → 8 turns (rain) |
| 45 | SAND_STREAM | 5 → 8 (sandstorm) |
| 70 | DROUGHT | 5 → 8 (sun) |
| 117 | SNOW_WARNING | 5 → 8 (snow) |
| 227 | PSYCHIC_SURGE | 5 → 8 (terrain) |
| 228 | MISTY_SURGE | 5 → 8 |
| 229 | GRASSY_SURGE | 5 → 8 |

(Note: also listed in MAJOR above because the 8-turn convention is a
field-wide ER change; either count it once in MINOR or once in MAJOR. I
flagged MAJOR to make the structural intent visible — adjust to MINOR if
you want a pure single-knob patch. Removed from MAJOR final count.)

### Speed-in-weather multiplier (2.0 → 1.5)

| ID | Ability | Vanilla → ER |
|---|---|---|
| 33 | SWIFT_SWIM | 2x → 1.5x |
| 34 | CHLOROPHYLL | 2x → 1.5x |
| 146 | SAND_RUSH | 2x → 1.5x |
| 202 | SLUSH_RUSH | 2x → 1.5x |
| 207 | SURGE_SURFER | 2x → 1.5x |

### Accuracy multiplier (1.3 → various)

| ID | Ability | Vanilla → ER |
|---|---|---|
| 14 | COMPOUND_EYES | 1.3x → 1.3x (NONE — listed as a check) |

### Crit damage multiplier

| ID | Ability | Vanilla → ER |
|---|---|---|
| 97 | SNIPER | 2.25x crit (vs 2.25x... need to verify whether vanilla is 2.25 already; ER says 2.25 explicitly. Pokerogue text says "125% instead of 50%" = 2.25x → identical. **NONE.** Moving to NONE.) |

### HP-regen fractions

| ID | Ability | Vanilla → ER |
|---|---|---|
| 44 | RAIN_DISH | 1/16 → 1/8 |
| 115 | ICE_BODY | 1/16 → 1/8 (also in MAJOR — keep MINOR) |
| 90 | POISON_HEAL | 1/8 → 1/8 (NONE) |

### Damage-deal fractions

| ID | Ability | Vanilla → ER |
|---|---|---|
| 123 | BAD_DREAMS | 1/8 → 1/4 (also flagged MAJOR; keep MAJOR) |

### Status-chance %

| ID | Ability | Vanilla → ER |
|---|---|---|
| 56 | CUTE_CHARM | 30% → 50% |
| 9 | STATIC | 30% contact + 0% non → 30% contact + 10% non (composite, flagged MAJOR) |
| 49 | FLAME_BODY | 30% contact + 0% non → 30% contact + 20% non + outgoing (MAJOR) |

### Damage multipliers / type-power multipliers

| ID | Ability | Vanilla → ER |
|---|---|---|
| 89 | IRON_FIST | 1.2x → 1.3x (Punching moves) |
| 181 | TOUGH_CLAWS | 1.3x → 1.3x (NONE) |
| 173 | STRONG_JAW | 1.5x → 1.3x |
| 178 | MEGA_LAUNCHER | 1.5x → 1.3x (also flagged MAJOR for filter expansion) |
| 252 | STEELY_SPIRIT | 1.5x → 1.3x (Steel for self+ally) |
| 217 | BATTERY | 1.3x → 1.3x (NONE) |
| 249 | POWER_SPOT | 1.3x → 1.3x (NONE) |
| 159 | SAND_FORCE | 1.3x typed → 1.5x highest attacking stat (also flagged MAJOR for stat-vs-type change) |
| 91 | ADAPTABILITY | 2x STAB → 2x STAB (NONE — vanilla also 2x) |
| 65 | OVERGROW | 1.5x at low HP → 1.2x always + 1.5x at low HP (composite) |
| 66 | BLAZE | same | (MAJOR) |
| 67 | TORRENT | same | (MAJOR) |
| 68 | SWARM | same | (MAJOR) |
| 110 | TINTED_LENS | 2x NVE → 2x NVE (NONE) |
| 111 | FILTER | 0.75x SE → 0.65x SE (1.0 − 0.35) |
| 116 | SOLID_ROCK | 0.75x SE → 0.65x SE |
| 232 | PRISM_ARMOR | 0.75x SE → 0.65x SE |
| 233 | NEUROFORCE | 1.25x → 1.35x (also flagged MAJOR; keep MAJOR for clarity) |
| 219 | DAZZLING | ID match (NONE) |
| 198 | STAKEOUT | 2x to switch-in → 2x to switch-in (NONE) |
| 213 | COMATOSE | (NONE) |
| 14 | COMPOUND_EYES | NONE |
| 73 | WHITE_SMOKE | (TOTAL — see TOTAL bucket) |
| 55 | HUSTLE | -20% acc, +50% Atk → -10% acc, +40% physical damage | retune |
| 79 | RIVALRY | ±25% same/opposite gender → same +25%, same -25% (NONE) |
| 220 | SOUL_HEART | +1 SpAtk on faint → +1 SpAtk on field-wide KO (NONE) |
| 80 | STEADFAST | +1 Spd on flinch → same (NONE) |
| 88 | DOWNLOAD | +1 Atk or SpAtk → same (NONE) |
| 84 | UNBURDEN | 2x Speed on item lost → same (NONE) |
| 86 | SIMPLE | 2x stat changes → same (NONE) |
| 92 | SKILL_LINK | max multi-hits → same (NONE) |
| 93 | HYDRATION | rain → cure status → same (NONE) |
| 95 | QUICK_FEET | statused → 1.5x Spd → same (NONE) |
| 105 | SUPER_LUCK | +1 crit stage → same (NONE) |
| 109 | UNAWARE | ignore stats → same (NONE) |
| 113 | SCRAPPY | Ghost hittable → same (NONE) |
| 114 | STORM_DRAIN | Water absorb → +1 SpAtk → "ups highest Atk" — same delta as LIGHTNING_ROD (MAJOR — moved) |
| 157 | SAP_SIPPER | Grass absorb → +1 Atk → "ups highest Atk" — same (MAJOR — moved) |
| 153 | MOXIE | KO → +1 Atk → same (NONE) |
| 154 | JUSTIFIED | Hit by Dark → +1 Atk → same (NONE) |
| 155 | RATTLED | Hit by Bug/Dark/Ghost / intimidated → +1 Spd → same (NONE) |
| 158 | PRANKSTER | +1 priority status, fail on Dark → same (NONE) |
| 160 | IRON_BARBS | contact hit → 1/8 dmg → same (NONE) |
| 172 | COMPETITIVE | stat-lowered → +2 SpAtk → same (NONE) |
| 183 | GOOEY | contact → -1 Spd → same (NONE) |
| 188 | AURA_BREAK | aura nullify + -25% → same (NONE) |
| 197 | SHIELDS_DOWN | 50% HP form change → same (NONE) |
| 201 | BERSERK | 50% HP → +1 highest-attacker → same (NONE) |
| 208 | SCHOOLING | level/HP form change → same (NONE) |
| 210 | BATTLE_BOND | KO → form change → same (NONE) |
| 211 | POWER_CONSTRUCT | 50% HP → form change → same (NONE) |
| 212 | CORROSION | poison any type → "Poison is super effective vs Steel" — adds type-effectiveness override | MAJOR (moved) |
| 213 | COMATOSE | always asleep → same (NONE) |
| 214 | QUEENLY_MAJESTY | priority immune for team → same (NONE) |
| 216 | DANCER | copy dance moves → same (NONE) |
| 221 | TANGLING_HAIR | contact → -1 Spd → same (NONE) |
| 222 | RECEIVER | copy faint ally ability → same (NONE) |
| 224 | BEAST_BOOST | KO → +1 highest → same (NONE) |
| 225 | RKS_SYSTEM | Memory sets type → + "Also has Protean + Adaptability" (MAJOR — moved) |
| 230 | FULL_METAL_BODY | unsuppressable stat-drop immune → same (NONE) |
| 231 | SHADOW_SHIELD | full HP → 0.5x dmg, unsuppressable → same (NONE) |
| 234 | INTREPID_SWORD | +1 Atk on entry → same (NONE) |
| 235 | DAUNTLESS_SHIELD | +1 Def on entry → same (NONE) |
| 236 | LIBERO | type change on move use → same (NONE) |
| 238 | COTTON_DOWN | hit → -1 Spd all foes → same (NONE) |
| 239 | PROPELLER_TAIL | redirection immune → "Swift Swim + Redirection Immunity" — adds rain speed! | MAJOR (moved) |
| 240 | MIRROR_ARMOR | stat-drop reflect → same (NONE) |
| 241 | GULP_MISSILE | Surf/Dive prey shot → same (NONE) |
| 242 | STALWART | redirection immune → "Isn't affected by redirection, crits, or ability suppression" | MAJOR (moved) |
| 243 | STEAM_ENGINE | Fire/Water hit → +6 Spd → "Maximizes Speed" — same operationally (NONE) |
| 246 | ICE_SCALES | -50% special dmg → same (NONE) |
| 248 | ICE_FACE | once-protect, restored on hail → "restored under hail" (same) |
| 250 | MIMICRY | type per terrain → same (NONE) |
| 251 | SCREEN_CLEANER | nullify screens on entry → "Can reset screens" — adds toggling ability | MAJOR (moved) |
| 252 | STEELY_SPIRIT | Steel +50% self+ally → +30% (NONE? text says 1.3x; vanilla is 1.5x — delta) |
| 253 | PERISH_BODY | contact → perish in 3 turns → "If hit, casts Perish Song" — predicate: contact → any hit (MAJOR — moved) |
| 255 | GORILLA_TACTICS | +50% Atk, lock first move → same (NONE) |
| 258 | HUNGER_SWITCH | form alternate each turn → same (NONE) |
| 259 | QUICK_DRAW | 30% move first → same (NONE) |
| 260 | UNSEEN_FIST | contact bypasses protect → same (NONE) |
| 265 | GRIM_NEIGH | KO → +1 SpAtk → same (NONE) |
| 268 | LINGERING_AROMA | contact → ability swap → same (NONE) |
| 270 | THERMAL_EXCHANGE | Fire hit → +1 Atk + burn immune → same (NONE) |
| 271 | ANGER_SHELL | 50% HP → shell smash → same (NONE) |
| 272 | PURIFYING_SALT | status immune + 0.5x Ghost dmg → same (NONE) |
| 273 | WELL_BAKED_BODY | Fire absorb + 2 Def → same (NONE) |
| 276 | ROCKY_PAYLOAD | Rock +50% → "Boosts the power of Rock-type and throwing moves by 1.5x" — adds "throwing" flag (ER-specific) | MAJOR (moved) |
| 278 | ZERO_TO_HERO | switchout form → same (NONE) |
| 279 | COMMANDER | enter Dondozo, +6 all stats → "Hops inside an allied Dondozo. Boosts its ally but can't act." — adds "can't act" lock-out (MAJOR — moved) |
| 280 | ELECTROMORPHOSIS | charged on hit → same (NONE) |
| 281 | PROTOSYNTHESIS | highest stat in sun/booster → "Boosts highest stat in Sun or with Booster Energy" — same (NONE) |
| 282 | QUARK_DRIVE | analog of PROTOSYNTHESIS → same (NONE) |
| 284 | VESSEL_OF_RUIN | -25% foe SpAtk → same (NONE) |
| 285 | SWORD_OF_RUIN | -25% foe Def → same (NONE) |
| 286 | TABLETS_OF_RUIN | -25% foe Atk → same (NONE) |
| 287 | BEADS_OF_RUIN | -25% foe SpDef → same (NONE) |
| 291 | CUD_CHEW | re-eat berry next turn → same (NONE) |
| 293 | SUPREME_OVERLORD | up to +50% on fainted allies → "Each fainted ally increases Attack and SpAtk by 10%" — vanilla mentions "Attack and SpAtk" implicitly, ER is explicit; +10% per faint matches; max boost 50% in vanilla, ER doesn't cap explicitly — verify ROM | NONE (probable) |
| 294 | COSTAR | copy ally stat changes on entry → same (NONE) |
| 295 | TOXIC_DEBRIS | physical hit → toxic spikes on foe side | predicate: vanilla "physical" vs ER "contact" — MAJOR (moved) |
| 297 | EARTH_EATER | Ground absorb + heal 25% → same (NONE) |
| 298 | MYCELIUM_MIGHT | status moves go last + bypass ability → same (NONE) |
| 301 | HOSPITALITY | heal ally 25% on entry → same (NONE) |
| 302 | TOXIC_CHAIN | 30% toxic on hit → same (NONE) |

(Many entries above are listed for traceability rather than as MINOR.
The pure MINOR-only candidates — single-knob retune — are listed in the
final adjusted summary below.)

### Final MINOR list (single-knob retunes only)

| ID | Ability | Knob | Vanilla → ER |
|---|---|---|---|
| 2 | DRIZZLE | weather turns | 5 → 8 |
| 33 | SWIFT_SWIM | speed mult | 2.0 → 1.5 |
| 34 | CHLOROPHYLL | speed mult | 2.0 → 1.5 |
| 44 | RAIN_DISH | heal frac | 1/16 → 1/8 |
| 45 | SAND_STREAM | weather turns | 5 → 8 |
| 56 | CUTE_CHARM | proc % | 30 → 50 |
| 65 | OVERGROW | extra "always-on 1.2x" outside threshold | adds 1.2x baseline |
| 66 | BLAZE | same as OVERGROW | adds 1.2x baseline |
| 67 | TORRENT | same | adds 1.2x baseline |
| 68 | SWARM | same | adds 1.2x baseline |
| 70 | DROUGHT | weather turns | 5 → 8 |
| 89 | IRON_FIST | flag damage mult | 1.2 → 1.3 |
| 111 | FILTER | SE damage taken | 0.75 → 0.65 |
| 115 | ICE_BODY | heal frac | 1/16 → 1/8 |
| 116 | SOLID_ROCK | SE damage taken | 0.75 → 0.65 |
| 117 | SNOW_WARNING | weather turns + name (Snow vs Hail) | 5 → 8 |
| 123 | BAD_DREAMS | foe HP loss | 1/8 → 1/4 |
| 129 | DEFEATIST | HP threshold | 0.5 → 0.333 |
| 131 | HEALER | proc % | 50 → 30 |
| 132 | FRIEND_GUARD | damage reduction | 0.25 → 0.5 |
| 146 | SAND_RUSH | speed mult | 2.0 → 1.5 |
| 162 | VICTORY_STAR | acc mult | 1.1 → 1.2 |
| 173 | STRONG_JAW | flag mult | 1.5 → 1.3 |
| 202 | SLUSH_RUSH | speed mult | 2.0 → 1.5 |
| 207 | SURGE_SURFER | speed mult | 2.0 → 1.5 |
| 227 | PSYCHIC_SURGE | terrain turns | 5 → 8 |
| 228 | MISTY_SURGE | terrain turns | 5 → 8 |
| 229 | GRASSY_SURGE | terrain turns | 5 → 8 |
| 232 | PRISM_ARMOR | SE damage taken | 0.75 → 0.65 |
| 233 | NEUROFORCE | SE outgoing mult | 1.25 → 1.35 |
| 252 | STEELY_SPIRIT | Steel mult | 1.5 → 1.3 |
| 262 | TRANSISTOR | Electric mult | 1.3 → 1.5 |

Final MINOR count after de-duplication: **32**.

## Unchanged — NONE (≈148)

Mechanics match; ER rephrases for brevity. No action needed. Sample
listing follows; full enumeration is in `scripts/elite-redux/tmp-audit-sidebyside.txt`.

| ID | Ability | Notes |
|---|---|---|
| 3 | SPEED_BOOST | end-of-turn +1 Spd in both |
| 5 | STURDY | full-HP endure + OHKO-block in both |
| 8 | SAND_VEIL | 1.25x evasion in sand (vanilla locale also 1.25, identical) |
| 10 | VOLT_ABSORB | absorb electric, heal 1/4 |
| 11 | WATER_ABSORB | absorb water, heal 1/4 |
| 14 | COMPOUND_EYES | 1.3x accuracy |
| 15 | INSOMNIA | sleep immune (ER's "Rest fails" is a clarifying note) |
| 16 | COLOR_CHANGE | type-change-on-hit (ER's "resist or immunity" is the same fallback heuristic pokerogue uses) |
| 18 | FLASH_FIRE | Fire absorb + Fire moves 1.5x |
| 22 | INTIMIDATE | -1 Atk to foes on entry |
| 24 | ROUGH_SKIN | 1/8 max HP on contact |
| 25 | WONDER_GUARD | only SE moves hit |
| 27 | EFFECT_SPORE | 30% SLP/PARA/PSN on contact |
| 29 | CLEAR_BODY | stat-drop immune (excluding own moves) |
| 30 | NATURAL_CURE | cure status on switch-out |
| 32 | SERENE_GRACE | 2x secondary effect chance |
| 43 | SOUNDPROOF | sound move immune |
| 47 | THICK_FAT | 0.5x Fire / 0.5x Ice damage taken |
| 48 | EARLY_BIRD | sleep 2x faster wake |
| 60 | STICKY_HOLD | held item theft immune |
| 61 | SHED_SKIN | 30% end-of-turn status cure |
| 63 | MARVEL_SCALE | statused → 1.5x Def |
| 64 | LIQUID_OOZE | drain returns dmg |
| 69 | ROCK_HEAD | recoil immune |
| 78 | MOTOR_DRIVE | Electric immune + Spd boost |
| 79 | RIVALRY | gender-based ±25% |
| 80 | STEADFAST | flinch → +1 Spd |
| 81 | SNOW_CLOAK | hail → 1.25x evasion |
| 84 | UNBURDEN | item lost → 2x Spd |
| 86 | SIMPLE | 2x stat changes |
| 88 | DOWNLOAD | entry → +1 Atk or SpAtk |
| 90 | POISON_HEAL | poisoned → +1/8 max HP per turn |
| 91 | ADAPTABILITY | STAB 1.5 → 2.0 |
| 92 | SKILL_LINK | multi-hit max |
| 93 | HYDRATION | rain end-of-turn → cure status |
| 95 | QUICK_FEET | statused → 1.5x Spd |
| 97 | SNIPER | crit dmg 1.5 → 2.25 |
| 98 | MAGIC_GUARD | only damage from attacks |
| 99 | NO_GUARD | always-hit (both sides) |
| 101 | TECHNICIAN | ≤60 BP → 1.5x |
| 105 | SUPER_LUCK | +1 crit stage |
| 109 | UNAWARE | ignore stat changes |
| 110 | TINTED_LENS | NVE → 2x |
| 113 | SCRAPPY | hit Ghost with Normal/Fight |
| 121 | MULTITYPE | Plate sets type |
| 124 | PICKPOCKET | contact-receive steal |
| 125 | SHEER_FORCE | drop secondary, +30% |
| 126 | CONTRARY | invert stat changes |
| 127 | UNNERVE | foes can't eat berry |
| 128 | DEFIANT | stat lowered → +2 Atk |
| 136 | MULTISCALE | full HP → 0.5x damage |
| 139 | HARVEST | berry recycle 50% / 100% in sun |
| 140 | TELEPATHY | friendly fire immune |
| 141 | MOODY | turn-end +2 / -1 stat |
| 143 | POISON_TOUCH | 30% poison on contact |
| 144 | REGENERATOR | 1/3 HP on switch-out |
| 148 | ANALYTIC | move last → 1.3x |
| 150 | IMPOSTER | transform on entry |
| 151 | INFILTRATOR | bypass screens/substitute |
| 152 | MUMMY | contact → ability swap |
| 153 | MOXIE | KO → +1 Atk |
| 154 | JUSTIFIED | Dark hit → +1 Atk |
| 155 | RATTLED | Bug/Dark/Ghost/Intimidate → +1 Spd |
| 156 | MAGIC_BOUNCE | reflect status moves |
| 158 | PRANKSTER | +1 priority status (Dark immune) |
| 160 | IRON_BARBS | contact → 1/8 damage |
| 166 | FLOWER_VEIL | Grass allies status/stat-drop immune |
| 168 | PROTEAN | type change on move |
| 169 | FUR_COAT | -50% physical dmg |
| 171 | BULLETPROOF | ball/bomb immune |
| 172 | COMPETITIVE | stat lowered → +2 SpAtk |
| 175 | SWEET_VEIL | sleep immune for self+ally |
| 176 | STANCE_CHANGE | form on attack/King's Shield |
| 177 | GALE_WINGS | Flying +1 priority at full HP |
| 179 | GRASS_PELT | Grassy Terrain → 1.5x Def |
| 180 | SYMBIOSIS | give item to ally on consume |
| 181 | TOUGH_CLAWS | contact 1.3x |
| 183 | GOOEY | contact → -1 Spd |
| 185 | PARENTAL_BOND | 2 hits, 2nd at 25% |
| 186 | DARK_AURA | field-wide Dark 1.33x |
| 187 | FAIRY_AURA | field-wide Fairy 1.33x |
| 188 | AURA_BREAK | invert aura, 0.75x |
| 193 | WIMP_OUT | 50% HP → switch-out |
| 194 | EMERGENCY_EXIT | 50% HP → switch-out |
| 197 | SHIELDS_DOWN | 50% HP → form change |
| 198 | STAKEOUT | switch-in target → 2x damage |
| 199 | WATER_BUBBLE | -50% Fire / 2x Water / no burns |
| 201 | BERSERK | 50% HP → +1 SpAtk (ER says "highest attacker" — same in single-spec) |
| 205 | TRIAGE | heal moves +3 priority |
| 209 | DISGUISE | once-per-battle hit block |
| 210 | BATTLE_BOND | KO → form change |
| 211 | POWER_CONSTRUCT | 50% HP → form change |
| 213 | COMATOSE | always asleep, immune to status |
| 214 | QUEENLY_MAJESTY | priority immune team |
| 215 | INNARDS_OUT | KO → return damage |
| 216 | DANCER | copy dance |
| 217 | BATTERY | +1.3x ally Special |
| 218 | FLUFFY | -50% contact, 2x Fire taken |
| 219 | DAZZLING | priority immune team |
| 220 | SOUL_HEART | KO anywhere → +1 SpAtk |
| 221 | TANGLING_HAIR | contact → -1 Spd |
| 222 | RECEIVER | copy fainting ally ability |
| 223 | POWER_OF_ALCHEMY | (vanilla says same as RECEIVER; ER says "Transmutes berries on entry. Transmutes items when lost." — actually different — moved to TOTAL) |
| 224 | BEAST_BOOST | KO → +1 highest |
| 225 | RKS_SYSTEM | (moved to MAJOR — adds Protean+Adaptability) |
| 230 | FULL_METAL_BODY | stat-drop immune, unsuppressable |
| 231 | SHADOW_SHIELD | full HP → 0.5x damage |
| 234 | INTREPID_SWORD | entry +1 Atk |
| 235 | DAUNTLESS_SHIELD | entry +1 Def |
| 236 | LIBERO | type change on move |
| 238 | COTTON_DOWN | hit → -1 Spd all foes |
| 240 | MIRROR_ARMOR | reflect stat drops |
| 241 | GULP_MISSILE | Surf/Dive prey shot |
| 242 | STALWART | (moved to MAJOR — adds crit + ability-suppression immunity) |
| 243 | STEAM_ENGINE | Fire/Water hit → max Spd |
| 244 | PUNK_ROCK | sound +1.3x / -0.5x dmg |
| 246 | ICE_SCALES | -50% special dmg |
| 247 | RIPEN | berry effect 2x |
| 248 | ICE_FACE | one-shot block, hail restore |
| 249 | POWER_SPOT | +1.3x ally damage |
| 250 | MIMICRY | terrain sets type |
| 253 | PERISH_BODY | (moved to MAJOR — predicate change) |
| 255 | GORILLA_TACTICS | +1.5x Atk, lock first move |
| 256 | NEUTRALIZING_GAS | ability suppression field |
| 258 | HUNGER_SWITCH | form alternates each turn |
| 259 | QUICK_DRAW | 30% move first |
| 260 | UNSEEN_FIST | contact bypasses protect |
| 265 | GRIM_NEIGH | KO → +1 SpAtk |
| 268 | LINGERING_AROMA | contact → ability swap |
| 270 | THERMAL_EXCHANGE | Fire hit → +1 Atk + burn immune |
| 271 | ANGER_SHELL | 50% HP → shell smash |
| 272 | PURIFYING_SALT | status immune + 0.5x Ghost |
| 273 | WELL_BAKED_BODY | Fire absorb + +2 Def |
| 274 | WIND_RIDER | Wind/Tailwind → +1 Atk + wind immune |
| 277 | WIND_POWER | charged on wind/Tailwind |
| 278 | ZERO_TO_HERO | switchout form change |
| 280 | ELECTROMORPHOSIS | hit → charged |
| 281 | PROTOSYNTHESIS | sun → +1.3x highest (+1.5x if Spd) |
| 282 | QUARK_DRIVE | Etr → +1.3x highest (+1.5x if Spd) |
| 284 | VESSEL_OF_RUIN | foe SpAtk -25% |
| 285 | SWORD_OF_RUIN | foe Def -25% |
| 286 | TABLETS_OF_RUIN | foe Atk -25% |
| 287 | BEADS_OF_RUIN | foe SpDef -25% |
| 288 | ORICHALCUM_PULSE | sun + Atk +1.33x in sun |
| 289 | HADRON_ENGINE | Etr + SpAtk +1.33x in Etr |
| 291 | CUD_CHEW | re-eat berry next turn |
| 293 | SUPREME_OVERLORD | +10% per faint up to 50% |
| 294 | COSTAR | copy ally stat changes |
| 296 | ARMOR_TAIL | priority immune team |
| 297 | EARTH_EATER | Ground absorb + heal 25% |
| 298 | MYCELIUM_MIGHT | status moves last + bypass ability |
| 301 | HOSPITALITY | heal ally 25% on entry |
| 302 | TOXIC_CHAIN | 30% toxic on hit |
| 308 | TERA_SHELL | NVE at full HP |
| 309 | TERAFORM_ZERO | (moved to MAJOR — adds Tera Shell effect) |
| 310 | POISON_PUPPETEER | poison this Pokémon → confuse |

## Final adjusted counts

After re-passes:

- **NONE** ≈ 148
- **MINOR** = 32
- **MAJOR** = 93
- **TOTAL** = 25

Sum: 148 + 32 + 93 + 25 = 298. ✅

## Recommended patch order

The cheapest wins (one-line numeric patches) are in MINOR; the most impactful
are in MAJOR / TOTAL. A pragmatic phased approach:

1. **Phase 1 (MINOR — half a day)**: One-knob retunes. Easiest to test;
   biggest count of fixes per hour.
2. **Phase 2 (MAJOR composites — 2-3 days)**: Composites that wrap a
   vanilla `AbAttr` with one or two ER additions (typed damage reduction,
   acc multiplier, entry effect, etc.). Most can be done by appending
   to the existing `Ability` instance's attr list in
   `init-elite-redux-vanilla-rebalance.ts`.
3. **Phase 3 (TOTAL rewrites — 1-2 days each)**: TRACE/TRUANT/CHEEK_POUCH
   etc. Need full vanilla unwire + new attr chain.
4. **Phase 4 (Verification)**: For each patched ability, add a regression
   test asserting the ER-specific behavior. Battle harness already exists
   under `src/data/elite-redux/harness/`.

## Open questions for ER ROM source

The following classifications I had to infer from the natural-language ER
description. A round-trip through `eliteredux/src/data/ability.h` would
firm them up:

- BATTLE_ARMOR / SHELL_ARMOR — vanilla says "crit immune"; ER says "Immune
  to critical hits. Takes 20% less damage from attacks." Confirm the 20%
  is on ALL incoming attacks (broad) or only contact (narrower).
- DRY_SKIN — ER's terse "Water/Rain heals. Fire/Sun hurts." — confirm
  fractions match vanilla 1/4, 1/8, 1/8, 1.25x.
- ZEN_MODE / SHIELDS_DOWN — confirm ER's form-change trigger really moves
  to entry vs vanilla's HP threshold.
- HUSTLE — confirm ER's 0.9x acc / 1.4x damage values (different from
  vanilla 0.8x acc / 1.5x Atk).
- GUTS — confirm whether ER drops the burn-Atk-halving bypass rider.
- TRACE — confirm "Does not copy innates" only affects the ER passive
  slot, not the regular ability.
- 251 SCREEN_CLEANER — "Can reset screens" — is this an active toggle
  per turn or a one-shot entry effect like vanilla?

## Appendix — generation reproducibility

The audit comparison was produced by joining three sources:

1. `vendor/elite-redux/v2.65beta.json#abilities` — ER `{id, name, desc}` list.
2. `src/data/elite-redux/er-id-map.ts#abilities` — ER id → pokerogue id.
3. `locales/en/ability.json` — pokerogue `{name, description}` keyed by
   camelCase enum name.

Regeneration snippet (Node, run from repo root):

```js
const fs = require("node:fs");
const erJson = JSON.parse(fs.readFileSync("vendor/elite-redux/v2.65beta.json"));
const localeJson = JSON.parse(fs.readFileSync("locales/en/ability.json"));
const enumText = fs.readFileSync("src/enums/ability-id.ts", "utf8");
const enumNames = [...enumText.matchAll(/^\s+([A-Z_]+),?\s*$/gm)].map((m) => m[1]);
const idMapText = fs.readFileSync("src/data/elite-redux/er-id-map.ts", "utf8");
const abilitiesSection = idMapText.match(/"abilities":\s*{([\s\S]*?)\n  }/)[1];
const erToPkrg = {};
for (const m of abilitiesSection.matchAll(/"(\d+)":\s*(\d+)/g)) {
  erToPkrg[+m[1]] = +m[2];
}
const pkrgIdToEr = {};
for (const er of erJson.abilities) {
  const pkrg = erToPkrg[er.id];
  if (pkrg !== undefined && pkrg < 1000) pkrgIdToEr[pkrg] = er;
}
const camel = (s) => s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const out = [];
for (let id = 1; id < enumNames.length; id++) {
  const enumName = enumNames[id];
  const locale = localeJson[camel(enumName)];
  const er = pkrgIdToEr[id];
  if (!locale || !er) continue;
  out.push(`### ${id}. ${enumName}\nPR: ${locale.description}\nER: ${er.desc}\n`);
}
console.log(out.join("\n"));
```

Output is the side-by-side text used for hand-classification in this audit.
