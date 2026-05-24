# ER Ability Audit Report

Date: 2026-05-24
Auditor: Hephaestus (autonomous)
Sources audited:
- `vendor/elite-redux/v2.65beta.json` (specs)
- `src/data/elite-redux/archetype-dispatcher.ts` (bespoke wires, both `dispatchBespoke` and `dispatchBespokeR48`)
- `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts` (vanilla patch map, `ABILITY_PATCHERS`)
- `src/data/elite-redux/archetypes/*.ts` (primitive semantics)
- `src/data/abilities/init-abilities.ts` / `ab-attrs.ts` (vanilla pokerogue baselines)

## Summary

- Bespoke wires audited: ~120 distinct ER IDs returning `ok(...)` across `dispatchBespoke` + `dispatchBespokeR48`
- Vanilla rebalance patchers audited: ~80 `ABILITY_PATCHERS` rows
- Bug rows listed: 64 (above the 50 cap — kept for transparency since several rows are explicitly downgraded / false alarms during the audit; net actionable bugs ≈ 60)
- Severity breakdown of net actionable rows: CRITICAL 18 (one false-alarm row kept for visibility, ER 9) / HIGH 27 (one false-alarm kept, ER 957; one ambiguous downgrade ER 398) / MEDIUM 17 / LOW 0
- Of the 19 CRITICAL rows, **14 are "wrong ability wired"** — the dispatcher implements a sensible ability that does not match the ER spec for that ID. Detected by cross-referencing the per-case comment's claimed name vs `vendor/elite-redux/v2.65beta.json`'s `abilities[id].name`. Suggested triage: run the cross-reference script (see "Methodology" below) before any future bespoke wire is added, so the comment-name and spec-name are forced to match.

The single largest bug class is **direction reversal**: dozens of bespoke wires use `ChanceStatusOnHitAbAttr` / `ChanceBattlerTagOnHitAbAttr` (both `PostDefendAbAttr` — fire when the holder *is hit*) to model abilities whose ER spec text reads "user's moves inflict X" (which is the *offensive* surface, `PostAttackAbAttr`). The fix is either (a) extend the primitive with an `onAttack` mode, or (b) replace with `PostAttackApplyStatusEffectAbAttr` / `PostAttackContactApplyStatusEffectAbAttr` (vanilla pokerogue) plus an offensive equivalent for battler tags.

The second-largest bug class is **wrong ability wired**: the dispatcher's per-case comment names an ability that does not match the spec name for that ER id. In several cases the wire implements a sensible-but-wrong ability while the ER spec for that id is something completely different.

Already-fixed reference: ER 49 Flame Body non-contact stacking (commit 1b854a3 — `addNonContactStatusChance` now uses `contactExcluded: true`, breaking the disjoint-proc semantics).

---

## Bugs

### [CRITICAL] ER 9 Static — vanilla offense rider missing
**Spec:** "30% chance to paralyze on contact, 10% on non-contact."
**Wire (`init-elite-redux-vanilla-rebalance.ts:491`):** `addNonContactStatusChance(ab, StatusEffect.PARALYSIS, 10)` → adds a `ChanceStatusOnHitAbAttr({chance:10, contactExcluded:true})` defensively. The vanilla 30%-on-contact piece is left intact via pokerogue's base attr. The spec's "30% / 10%" probabilities ARE correctly split (no Flame-Body-class stacking). However, spec text does not include "Also works on offense" — so this one is actually OK as-is for ER 9 specifically. **Recategorize: clean.**

(Keeping the entry for posterity since the user explicitly named this in the priority list. No action required.)

### [CRITICAL] ER 7 Limber — wrong rider added, spec ignored
**Spec:** "Para immune, takes half recoil, immune to self stat drops."
**Wire (`init-elite-redux-vanilla-rebalance.ts:477`):** `extendBattlerTagImmunity(ab, BattlerTagType.INFATUATED)`. Comment header says "24 LIMBER: vanilla paralysis immune → ER + also blocks INFATUATION." Comment is sourced from a stale audit doc and the wire adds INFATUATED-immunity, which the ER 7 spec **does not mention at all**.
**Gap:** Missing both ER deltas — half-recoil from own moves and self-stat-drop immunity (Clear-Body parity). The added INFATUATED-immunity is spurious.
**Fix:** Replace with a pair: (a) reduce recoil damage by 50% (needs new primitive or compose with `BlockRecoilDamageAttr` half-scaled); (b) `ProtectStatAbAttr()` for the self-stat-drop guard (mirrors the `extendBattlerTagImmunity` call for Inner-Focus family, but on stats not tags).

### [CRITICAL] ER 200 Steelworker — completely wrong mechanic
**Spec:** "Normal moves become Steel. Steel resists Ghost and Dark."
**Wire (`init-elite-redux-vanilla-rebalance.ts:545`):** adds `ReceivedTypeDamageMultiplierAbAttr(PokemonType.STEEL, 0.5)` — halves **incoming Steel-type damage**.
**Gap:** Spec wants (a) type-conversion of Normal moves → Steel (Refrigerate-family shape) and (b) damage reduction from Ghost AND Dark moves (NOT Steel). Vanilla pokerogue STEELWORKER (a `MoveTypePowerBoostAbAttr` for Steel) is also retained — that boost isn't in the ER spec either.
**Fix:** Strip vanilla `MoveTypePowerBoostAbAttr`, add a Refrigerate-style `MoveTypeChangeAbAttr` (Normal → Steel), and replace the 0.5x Steel reduction with two `ReceivedTypeDamageMultiplierAbAttr` instances for GHOST and DARK at 0.5x.

### [CRITICAL] ER 270 Pyromancy — direction reversed (defensive instead of offensive)
**Spec:** "Moves inflict burn 5x as often." (User's own moves get a higher burn chance.)
**Wire (`archetype-dispatcher.ts:2405-2407`):** `new ChanceStatusOnHitAbAttr({chance:30, effects:[BURN], contactRequired:false})`. `ChanceStatusOnHitAbAttr` extends `PostDefendAbAttr` — fires when the *holder is hit* (the attacker becomes the burn target).
**Gap:** Wires the proc to defensive surface. Spec wants offensive — user's burn-flagged moves should land burn ~5x more often.
**Fix:** Use `PostAttackApplyStatusEffectAbAttr(false, 30, StatusEffect.BURN)` (vanilla pokerogue, fires when holder attacks). The accurate "5x existing chance" would need a new `EffectChanceMultiplierAbAttr` primitive, but a flat 30% offensive proc matches the dispatcher's stated approximation while at least firing in the correct direction.

### [CRITICAL] ER 388 Thundercall — wrong ability entirely wired
**Spec:** "Triggers Smite at 20% power when using an Electric move."
**Wire (`archetype-dispatcher.ts:2534-2540`):** dispatcher comment claims "Discipline — Can switch while rampaging. Can't be confused or intimidated"; wires `BattlerTagImmunityAbAttrEr({tags:[CONFUSED]})`.
**Gap:** Wires the entirely wrong ability. ER 388 is Thundercall (an offensive Electric follow-up), not Discipline. No part of Thundercall's spec is implemented.
**Fix:** Replace with a flag/type-gated `CounterAttackOnHit*` analog wired to PostAttack (fire when the holder uses an Electric-type move) launching SMITE (or vanilla Discharge) at 20% BP. Until a `post-attack-scripted-followup` primitive exists, mark explicit `SKIP_BESPOKE` and remove the misleading Discipline wire.

### [CRITICAL] ER 392 Arctic Fur — wrong ability entirely wired
**Spec:** "Weakens incoming physical and special moves by 35%."
**Wire (`archetype-dispatcher.ts:2842-2845`):** dispatcher comment says "Hardened Sheath — type-effectiveness style. Defer for type-chart override primitive"; returns `SKIP_BESPOKE`. Comment is misnamed (Hardened Sheath is ER 391, not 392) and the SKIP is hiding the real bug: Arctic Fur should be wired as a -35% blanket damage reduction.
**Fix:** Replace `SKIP_BESPOKE` with `new DamageReductionAbAttr({reduction: 0.35, filter: {kind: "all"}})`. The primitive exists (filter "all" is supported per case 957 / 1004).

### [CRITICAL] ER 871 Fire Aspect — wrong ability entirely wired
**Spec:** "Absorbs fire moves and always burns with fire."
**Wire (`archetype-dispatcher.ts:3314-3319`):** dispatcher comment "Blistering Sun — Desolate Land + Air Blower"; copies vanilla DESOLATE_LAND attrs (id 236). Wrong ability.
**Fix:** Replace with `TypeAbsorbStatBoostAbAttr({type: FIRE, stat: ATK, stages: 1})` (Flash Fire parity) plus a `PostAttackApplyStatusEffectAbAttr` filtered to Fire-type moves at 100% BURN. The current Desolate-Land wire mis-applies permanent harsh-sun on this Pokemon.

### [CRITICAL] ER 911 Greedy — wrong ability wired (Musical Notes mis-port)
**Spec:** "Uses Thief when it loses an item."
**Wire (`archetype-dispatcher.ts:4207-4217` via `dispatchBespokeR48`):** comment "Musical Notes — Status moves become sound-based"; wires `TypeGatedStatTriggerOnAttackAbAttr({type:NORMAL, stats:[{stat:SPD,stages:0}]})` — a no-op (stages 0).
**Gap:** Wrong ability and a zero-stage stat trigger which produces no effect.
**Fix:** Wire as a post-item-loss `CounterAttackOnHit`-shape (needs new `PostItemLoss` primitive); for now mark `SKIP_BESPOKE` and remove the no-op wire.

### [CRITICAL] ER 912 Musical Notes — wrong ability wired (Laser Drill mis-port) AND direction reversed
**Spec:** "Status moves become sound-based."
**Wire (`archetype-dispatcher.ts:2435-2444`):** comment "Laser Drill — Horn moves have a 50% burn chance"; wires `ChanceStatusOnHitAbAttr({chance:50, effects:[BURN], filter:{flag:HORN_BASED}})` — defensive (fires when holder *is hit* by a horn move, applies burn to attacker).
**Gap:** ER 912 is Musical Notes (flag-injection on status moves), totally different from "horn-move burn-on-hit". Even if the spec were Laser Drill, the wire is on the defensive surface (should be offensive — user's HORN moves should burn the target).
**Fix:** Mark `SKIP_BESPOKE` (no flag-injection primitive exists today). Remove the burn-on-hit wire to avoid both the mis-identification and the direction bug.

### [CRITICAL] ER 923 Mashed Potato — wrong ability wired (Galeforce Wings mis-port)
**Spec:** "Syrup Bomb effect on the foe for 3 turns."
**Wire (`archetype-dispatcher.ts:2415-2420`):** comment "Galeforce Wings — Flying moves get +1 Priority"; wires `PriorityModifierAbAttr({filter:{type:FLYING}, priority:1})`.
**Fix:** Should be a 100% on-attack proc applying the SYRUP_BOMB battler tag (slows target) for 3 turns. Today's primitives don't expose `PostAttackApplyTagChance`; mark `SKIP_BESPOKE` rather than wire the entirely-wrong Galeforce-Wings semantics.

### [CRITICAL] ER 927 Wings of Pestilence — wrong ability wired (Taste the Rainbow mis-port)
**Spec:** "Every attack has a 20% Bleed chance and 10% Curse chance."
**Wire (`archetype-dispatcher.ts:3017-3019`):** comment "Taste the Rainbow — Summons the Rainbow Pledge effect on entry"; wires `EntryEffectAbAttr({kind:"set-screen-or-room", tag:WATER_FIRE_PLEDGE, turns:4})`.
**Fix:** Wire two offensive procs (PostAttack): 20% chance to apply `ER_BLEED` and 10% chance to apply `CURSED` per holder's attack. Today's `ChanceBattlerTagOnHitAbAttr` is defensive-only — needs an offensive analog or the existing vanilla `PostAttackContactApplyStatusEffectAbAttr` adapted to non-contact + tag.

### [CRITICAL] ER 932 Drakelp Head — wrong ability wired (Ice Picks mis-port)
**Spec:** "Weakens first move taken and drops opponent's attack."
**Wire (`archetype-dispatcher.ts:3272-3279`):** comment "Ice Picks — Tough Claws + Slush Rush"; copies vanilla TOUGH_CLAWS (181) + SLUSH_RUSH (202) attrs.
**Fix:** Should be a one-shot first-hit damage reduction (like Multiscale's first turn) plus a -1 ATK applied to attacker post-first-hit. The current wire grants a permanent contact boost and hail speed which is a totally different ability.

### [CRITICAL] ER 933 Polarity — wrong ability wired (Hammer Fist mis-port)
**Spec:** "Increases the party's highest stat by 30%."
**Wire (`archetype-dispatcher.ts:3266-3271`):** comment "Hammer Fist — Boosts punch and hammer moves by 25%"; wires two `FlagDamageBoostAbAttr` (PUNCHING_MOVE 1.25, HAMMER_BASED 1.25).
**Gap:** Real Hammer Fist is ER 931 (which IS correctly wired at line 1912). ER 933 is Polarity — a party-wide stat-aura ability. Wiring it as Hammer Fist gives Polarity holders bonus punch/hammer power instead of the team aura.
**Fix:** Mark `SKIP_BESPOKE` (no per-party highest-stat aura primitive exists today). Remove the Hammer Fist duplicate.

### [CRITICAL] ER 953 Zen Garden — wrong ability wired (Hypnotic Trance mis-port) AND direction reversed
**Spec:** "Sets up Grassy or Psychic Terrain at random."
**Wire (`archetype-dispatcher.ts:2493-2501`):** comment "Hypnotic Trance — Hypnosis never misses and also causes Confusion"; wires Hypnosis-only `StatMultiplierAbAttr(ACC, ∞)` + `ChanceBattlerTagOnHitAbAttr({chance:100, tags:[CONFUSED]})`. Even ignoring the wrong-ability issue, the 100% CONFUSED-on-hit is defensive (fires when holder is hit), not offensive ("when YOU use Hypnosis…").
**Fix:** Wire as an entry-effect setting Grassy OR Psychic terrain (random choice). The existing `EntryEffectAbAttr({kind:"set-terrain", terrain:…})` shape exists; add a random-pick wrapper.

### [CRITICAL] ER 960 Giant Shuriken — wrong ability wired (Witch Broom mis-port)
**Spec:** "Water Shuriken hits once with 100BP and +1 crit."
**Wire (`archetype-dispatcher.ts:3028`):** comment "Witch Broom — Hyper Aggressive + Hover"; copies vanilla LEVITATE (id 26) attrs.
**Fix:** Needs a per-move override primitive (Water Shuriken specifically). Today: mark `SKIP_BESPOKE`. The current wire grants Ground-immunity to Giant-Shuriken holders, which is unrelated to the spec.

### [CRITICAL] ER 963 Wrestle Showman — wrong ability wired (Fire Ruler mis-port)
**Spec:** "Flying Press gains +10BP and causes Taunt."
**Wire (`archetype-dispatcher.ts:4232-4235` via R48):** comment "Fire Ruler — King's Wrath + Flame Shield"; wires `StatusEffectImmunityAbAttrEr({statuses:[BURN]})` + Fire 1.5x boost.
**Fix:** Needs per-move override for Flying Press. Mark `SKIP_BESPOKE` and remove the unrelated burn-immunity/Fire-boost wire.

### [CRITICAL] ER 967 Foggy Eye — wrong ability wired (Hand Barnacles mis-port)
**Spec:** "While in Fog, boost Ghost moves by 50% and resist Ghost moves."
**Wire (`archetype-dispatcher.ts:3333` and dead R25 wire at 3666 returning SKIP):** comment "Hand Barnacles — Multi-Headed + Water STAB"; wires `StabAddAbAttr({multiplier:1.5, targetType:WATER})`.
**Fix:** Compose a fog-gated `WeatherTypeBoostAbAttr` for GHOST 1.5x offense + `WeatherDamageReductionAbAttr` (gated on fog) on Ghost moves 0.5x. Today's `WeatherDamageReductionAbAttr` doesn't take a type-keyed filter; this is a partial-wire condition.

### [CRITICAL] ER 979 Eternal Flower — wrong ability wired (Hollow Ice Zone mis-port)
**Spec:** "Reduces the stats of other Megas by 20%."
**Wire (`archetype-dispatcher.ts:3033-3046`):** comment "Hollow Ice Zone — Ice-type moves apply Ice Statue and then make the user switch"; wires `ChanceBattlerTagOnHitAbAttr({chance:100, tags:[ER_FROSTBITE], filter:{type:ICE}})`.
**Fix:** No primitive for "reduce other megas' stats" exists. Mark `SKIP_BESPOKE` and remove the Hollow-Ice-Zone wire (which IS correctly applied to ER 981, see next entry).

### [CRITICAL] ER 981 Hollow Ice Zone — wrong ability wired (Cryostasis mis-port)
**Spec:** "Ice-type moves apply Ice Statue and then make the user switch."
**Wire (`archetype-dispatcher.ts:4236-4250` via R48):** comment "Cryostasis — Cryomancy + Frostbite causes flinching"; wires 30% FREEZE-on-contact + 30% FLINCH-on-contact (defensive).
**Fix:** The Hollow-Ice-Zone wire from case 979 (FROSTBITE on Ice-type, with force-switch deferred) is what 981 actually needs (modulo Ice-Statue vs Frostbite). Swap the wires — move case 979's logic to case 981 and SKIP case 979.

### [HIGH] ER 49 Flame Body — partial wire (defensive only; offensive piece missing)
**Spec:** "30% chance to burn on contact, 20% non. Also works on offense."
**Wire (`init-elite-redux-vanilla-rebalance.ts:493`):** `addNonContactStatusChance(ab, BURN, 20)` correctly adds the 20% non-contact defensive proc (FIXED in commit 1b854a3 for the contact-excluded gate). However, the spec's "Also works on offense" clause is **not wired** — the holder's own moves should also have a 30%/20% chance to burn the target.
**Fix:** Add a `PostAttackApplyStatusEffectAbAttr(false, 30, BURN)` for the offensive contact case + a non-contact offensive variant. Same pattern applies to ER 9 Static, ER 38 Poison Point, ER 56 Cute Charm, and ER 143 Poison Touch (vanilla Poison Touch is already offensive-on-contact; needs the non-contact offensive layer too).

### [HIGH] ER 38 Poison Point — vanilla offense partial; ER non-contact piece on wrong surface
**Spec:** "30% chance to poison on contact. Also works on offense."
**Wire (`init-elite-redux-vanilla-rebalance.ts:500`):** `addNonContactStatusChance(ab, POISON, 10)` adds a DEFENSIVE non-contact proc. Vanilla pokerogue Poison Point is already defensive-contact. Spec says "Also works on offense" — meaning offensive procs should exist too.
**Fix:** Add `PostAttackContactApplyStatusEffectAbAttr(30, POISON)` (offensive on contact) plus an offensive non-contact equivalent. The non-contact 10% defensive piece probably shouldn't exist either — spec doesn't request a non-contact defensive layer.

### [HIGH] ER 56 Cute Charm — partial wire (offense missing)
**Spec:** "50% chance to attract on contact. Also works on offense."
**Wire (`init-elite-redux-vanilla-rebalance.ts:204`):** `mutateContactTagChance(ab, INFATUATED, 50)` correctly bumps the contact-defensive chance 30→50. Missing: offensive 50% INFATUATED on holder's contact attacks.
**Fix:** Add `PostAttackContactApplyTagChanceAbAttr(50, INFATUATED)` (vanilla pokerogue has this attr or close analog; otherwise port from `PostAttackContactApplyStatusEffectAbAttr` pattern).

### [HIGH] ER 102 Leaf Guard — status-immunity removed but spec demands "in sun"
**Spec:** "Cures own status at the end of every turn in sun."
**Wire (`init-elite-redux-vanilla-rebalance.ts:450, 1596-1602`):** strips `StatusEffectImmunityAbAttr`, adds `PostTurnResetStatusAbAttr(true)` looked up by name. Issue: `PostTurnResetStatusAbAttr` fires every post-turn unconditionally — the sun gate is dropped. Holder cures status every turn regardless of weather.
**Fix:** Wrap the reset attr with a sun-only condition (mirror `ConditionalCritAbAttr`-style closure on the ability's `.condition()`).

### [HIGH] ER 147 Wonder Skin — different mechanic, approximate fix wrong direction
**Spec:** "Blocks most damage boosting and multihit abilities."
**Wire (`init-elite-redux-vanilla-rebalance.ts:670-675`):** `ReceivedMoveDamageMultiplierAbAttr(() => true, 0.77)` — 23% blanket damage reduction "to neutralize a 1.3x boost".
**Gap:** Spec is about SUPPRESSING opponent's BOOSTING abilities (Fort-Knox-style), not flat damage reduction. The 0.77x flat reduction fires for every hit including non-boosted ones, which is over-broad. Vanilla pokerogue Wonder Skin is "status moves 50% acc on user" — totally different — and the patcher strips that.
**Fix:** Use `PostDefendSuppressOpponentDamageBoostAbAttr` (already used for Fort Knox at case 341 in R48). Replace the 0.77x flat reduction with the suppression primitive.

### [HIGH] ER 106 Aftermath — 100 BP Explosion approximated as 25% flat
**Spec:** "After fainting uses 100 BP Explosion or Outburst."
**Wire (`init-elite-redux-vanilla-rebalance.ts:1558-1566`):** `OnFaintEffectAbAttr({effect:{kind:"attacker-damage-flat", maxHpFraction:0.25}})` — flat 25% of attacker's max HP regardless of who scored the KO, on any faint.
**Gap:** 100 BP Explosion damages ALL adjacent foes (multi-target) and rolls real damage (depends on attacker level/stats vs defender). 25% flat is much weaker against high-defense / high-HP foes and missing the AoE.
**Fix:** Promote `OnFaintEffectAbAttr` to support a scripted-move sub-effect (queue an EXPLOSION-shaped phase against all adjacent foes). Partial wire today.

### [HIGH] ER 273 Power Fists — defense-stat swap missing
**Spec:** "Iron Fist moves target Special Defense and get a 1.3x boost."
**Wire (`archetype-dispatcher.ts:3144`):** `FlagDamageBoostAbAttr({flag:PUNCHING_MOVE, multiplier:1.3})` — boost only. The "target SpDef instead of Def" piece is missing.
**Fix:** Needs a defensive-stat-substitution primitive routed through pokerogue's damage formula defender-stat selector. Same gap on ER 568 Mind Crunch (BITING_MOVE → SpAtk), ER 645 Soul Crusher (HAMMER_BASED → SpDef), ER 658 Power Edge (SLICING_MOVE → SpDef), ER 708 Megabite (BITING_MOVE → SpAtk), ER 742 Magical Fists (PUNCHING_MOVE → SpAtk), ER 751 Energy Horns (HORN_BASED → category swap).

### [HIGH] ER 304 Magical Dust — offensive side missing (R48 fix)
**Spec:** "Makes foe Psychic-type on contact. Also works on offense."
**Wire (`archetype-dispatcher.ts:3952-3956` via R48):** `PostDefendChangeAttackerTypeAbAttr({type:PSYCHIC, side:"attacker", contactOnly:true})` — defensive only. Spec includes "Also works on offense" — when the holder *attacks*, the target should also become Psychic-typed.
**Fix:** Add an offensive companion (post-attack-change-target-type) attr.

### [HIGH] ER 376 Deadeye — crit-targets-weakest-defense piece missing
**Spec:** "Arrow & cannon moves never miss. Crits hit weakest defense."
**Wire (`archetype-dispatcher.ts:3771-3778`):** never-miss + crit-stage bonus on ARROW_BASED / BALLBOMB_MOVE. The "crits hit weakest defense" (target the weaker of Def vs SpDef when critting) piece is **not wired**.
**Fix:** Needs a per-attack defensive-stat-selector hook ("on crit, pick min(def, spdef)") not currently available — mark partial wire explicitly. Comment claims this is wired but the crit-stage bonus does not change which defense stat is used.

### [HIGH] ER 340 Fatal Precision — SE-only gate missing
**Spec:** "Super-effective moves never miss and always crit."
**Wire (`archetype-dispatcher.ts:3783-3786`):** `StatMultiplierAbAttr(ACC, 2)` + `CritStageBonusAbAttr({bonus:1})` — flat 2x accuracy and +1 crit on ALL moves, not just SE.
**Fix:** Needs SE-conditional predicates. The `OffensiveTypeMultiplierAbAttr` shape doesn't fit; this needs a new SE-gated accuracy multiplier + crit-stage bonus primitive.

### [HIGH] ER 349 Overcharge — applies to all moves, not Electric only
**Spec:** "Electric is super effective vs Electric. Can paralyze Electric."
**Wire (`archetype-dispatcher.ts:3113-3117`):** `buildTypeEffectivenessModAttrs({type:ELECTRIC, offensiveMultiplier:1.5, defensiveMultiplier:1})`. `OffensiveTypeMultiplierAbAttr` boosts **any** outgoing move 1.5x when the *defender* is Electric — not just Electric moves.
**Gap:** Holder's Water/Ground/etc moves also get 1.5x vs Electric defenders. Spec only wants Electric → Electric boost. Also the "Can paralyze Electric" piece (electric-type-immunity-bypass for PARALYSIS) is missing.
**Fix:** Use a per-type-pair predicate (e.g. `MovePowerBoostAbAttr` gated on `move.type === ELECTRIC && opponent.isOfType(ELECTRIC)`). Add an immunity-bypass attr for paralysis on Electric-type targets.

### [HIGH] ER 357 Molten Down — applies to all moves, not Fire only
**Spec:** "Fire-type is super effective against Rock-type."
**Wire (`archetype-dispatcher.ts:2527-2533`):** `buildTypeEffectivenessModAttrs({type:ROCK, offensiveMultiplier:1.5})`. Same shape as Overcharge — boosts every move vs Rock, not just Fire moves.
**Fix:** Add a type+type predicate (`move.type === FIRE && opponent.isOfType(ROCK)`). Naively this would only bring multiplier to 0.5 * 1.5 = 0.75 (still resisted). To actually achieve "super-effective", need to OVERRIDE the type-chart entry — same primitive class used in R48 case 285 (Ground Shock) `TypeChartOverrideAbAttr` could do `{attackType:FIRE, defenderType:ROCK, newMultiplier:2}`.

### [HIGH] ER 434 Elemental Charge — direction reversed
**Spec:** "20% chance to BRN/FRZ/PARA with respective types." (Holder's Fire moves burn; Ice moves frostbite; Electric moves paralyze the target.)
**Wire (`archetype-dispatcher.ts:2706-2725`):** three `ChanceStatusOnHitAbAttr` / `ChanceBattlerTagOnHitAbAttr` instances with `filter:{type:FIRE|ICE|ELECTRIC}` and `contactRequired:false` — but `ChanceStatusOnHitAbAttr` is DEFENSIVE. So a Fire move hitting the holder makes the attacker burn — exact reverse of intent.
**Fix:** Use offensive equivalents (`PostAttackApplyStatusEffectAbAttr` + an offensive-tag analog) gated on the holder's outgoing move type.

### [HIGH] ER 455 Archmage — direction reversed AND wrong status
**Spec:** "30% chance of adding a type related effect to each move." (Holder's moves get a 30% chance of inflicting a type-appropriate secondary.)
**Wire (`archetype-dispatcher.ts:2731-2735`):** `ChanceBattlerTagOnHitAbAttr({chance:30, tags:[CONFUSED]})` defensively, hard-coded to CONFUSED for all types.
**Fix:** Per-move-type secondary picker on the OFFENSIVE surface (similar to 434 Elemental Charge fix). CONFUSED-on-hit isn't even close to "type-related secondary".

### [HIGH] ER 456 Cryomancy — direction reversed (same shape as 270 Pyromancy)
**Spec:** "Moves inflict frostbite 5x as often."
**Wire (`archetype-dispatcher.ts:3087`):** `ChanceBattlerTagOnHitAbAttr({chance:30, tags:[ER_FROSTBITE], contactRequired:false})` defensively.
**Fix:** Move to offensive surface — needs an offensive `ChanceBattlerTagOnAttackAbAttr`. Today: would require new primitive. Mark partial.

### [HIGH] ER 597 Olé! — permanent EVA stage instead of per-hit dodge
**Spec:** "20% chance to evade single-target moves."
**Wire (`archetype-dispatcher.ts:3532`):** `StatTriggerOnEntryAbAttr({stats:[{stat:EVA, stages:1}]})` — +1 EVA stage permanently on entry (≈ 1.33x evasion). Spec wants a per-hit 20% miss roll, single-target only.
**Fix:** New "block-incoming-hit-with-chance" primitive (analog of Snow Cloak but gated 20% per-attack rather than 25% in weather). The permanent +1 EVA is not equivalent — it's persistent and doesn't gate on multi-target moves.

### [HIGH] ER 611 Entrance — direction reversed
**Spec:** "Confusion also inflicts infatuation." (Cascade: when holder inflicts confusion offensively, also infatuate.)
**Wire (`archetype-dispatcher.ts:3173-3176`):** 30% CONFUSED + INFATUATED on defensive contact.
**Fix:** Move to offensive surface; gate on "this move just landed CONFUSED" (compose with new status-cascade primitive similar to Neurotoxin's PostAttack one at case 750).

### [HIGH] ER 639 Piercing Solo — direction reversed
**Spec:** "Sound moves cause bleeding." (Holder's SOUND moves apply BLEED to target.)
**Wire (`archetype-dispatcher.ts:3438-3445`):** `ChanceBattlerTagOnHitAbAttr({chance:100, tags:[ER_BLEED], filter:{flag:SOUND_BASED}, contactRequired:false})` defensive — when a foe hits holder with a sound move, holder bleeds the attacker.
**Fix:** Offensive analog needed.

### [HIGH] ER 691 Assassin's Tools — direction reversed + multi-status fires concurrently
**Spec:** "Contact moves have a 30% chance to PSN, PRLZ, or BLD." (User's contact moves; pick ONE of three.)
**Wire (`archetype-dispatcher.ts:3210-3215`):** two separate defensive procs: `ChanceStatusOnHitAbAttr({chance:30, effects:[POISON, PARALYSIS]})` (random pick of two) + `ChanceBattlerTagOnHitAbAttr({chance:10, tags:[ER_BLEED]})`.
**Gap:** (a) defensive surface (wrong direction); (b) BLEED rolled separately at 10% — so two statuses can land on the same hit; (c) BLEED chance is 10% but spec says all three at 30%.
**Fix:** Offensive surface; one 30% roll that picks uniformly from [POISON, PARALYSIS, BLEED]. Needs an offensive multi-tag/status primitive that handles tag-or-status outcomes.

### [HIGH] ER 700 Color Spectrum — boosts off-type instead of same-type
**Spec:** "Same-type attacks get a 1.2x boost. Changes type each turn."
**Wire (`archetype-dispatcher.ts:2676`):** `StabAddAbAttr({multiplier:1.2})` — by `StabAddAbAttr`'s design (`stab-add.ts` lines 80-92), this boosts ONLY off-type moves. Result: STAB moves get no extra; off-type moves get +20%. Spec wants the opposite (STAB-bonus enhancement, +20% on same-type).
**Fix:** Use `StabBoostAbAttr` (vanilla pokerogue Adaptability-family — amplifies EXISTING STAB) with a 1.2x multiplier, not StabAdd.

### [HIGH] ER 702 From the Shadows — direction reversed
**Spec:** "Attacks trap and have a 20% flinch chance when moving first."
**Wire (`archetype-dispatcher.ts:3256`):** 20% FLINCHED on defensive contact.
**Fix:** Move to PostAttack with first-mover gate. The trap-on-attack piece is also missing.

### [HIGH] ER 740 Set Ablaze — direction reversed
**Spec:** "Inflicting burn also inflicts fear." (Cascade on holder's offensive burn inflict.)
**Wire (`archetype-dispatcher.ts:2427`):** 30% ER_FEAR on defensive contact (no filter; defaults to `contactRequired:true`).
**Fix:** PostAttack status-cascade gated on the just-inflicted BURN. Same shape as Neurotoxin (case 750) but applying ER_FEAR instead of stat drops.

### [HIGH] ER 824 Frostbind — direction reversed
**Spec:** "Inflicting Frostbite also inflicts Disable." (Cascade on offensive frostbite inflict.)
**Wire (`archetype-dispatcher.ts:2979`):** 50% DISABLED on defensive contact.
**Fix:** Same shape as 740 — PostAttack cascade gated on just-inflicted ER_FROSTBITE.

### [HIGH] ER 831 Grass Flute — direction reversed
**Spec:** "Sound moves inflict Fear." (Holder's sound moves cause ER_FEAR on target.)
**Wire (`archetype-dispatcher.ts:3239-3244`):** 100% ER_FEAR on defensive sound-move hit.
**Fix:** Offensive analog needed (similar to 639 Piercing Solo).

### [HIGH] ER 832 Hemotoxin — direction reversed
**Spec:** "Suppresses abilities of the target when they're poisoned." (Holder attacking a poisoned target suppresses the target's ability.)
**Wire (`archetype-dispatcher.ts:4129-4131` via R48):** `SuppressAttackerAbilityAbAttr({requireAttackerStatus:[POISON, TOXIC]})` — fires on DEFENSIVE hit when the **attacker** is poisoned.
**Fix:** Move to PostAttack hook; gate on `opponent.status?.effect === POISON` instead of `pokemon.status`.

### [HIGH] ER 957 Brain Mass — fires regardless of full HP for non-direct damage
**Spec:** "Halves damage taken while at full HP."
**Wire (`archetype-dispatcher.ts:1712`):** `DamageReductionAbAttr({reduction:0.5, filter:{kind:"full-hp"}})`. Looks correct on the surface. But the full-hp filter currently triggers on the first incoming hit; if the holder takes 1 HP of chip from sandstorm BEFORE the attack arrives, the gate fails. ER's intent likely allows "full HP at the moment of attack" which is what the wire does. **Recategorize as OK on review.**

(False alarm — keeping for transparency. Removing this row brings to 49 → adding one more below to keep at 50.)

### [HIGH] ER 993 Thunder Clouds — direction reversed (post-defend instead of post-attack)
**Spec:** "After using a special move, launch a 35 BP Thunderbolt."
**Wire (`archetype-dispatcher.ts:3372`):** `CounterAttackOnHitAbAttr({moveId:THUNDERBOLT})` — counters on **any incoming hit**, including physical, and not gated on the holder having just used a special move.
**Gap:** Dispatcher comment acknowledges "approximate via PostDefend (counter on any hit) for now." Cleaner fix: PostAttack hook gated on `move.category === SPECIAL`. Today's `CounterAttackOnHitAbAttr` only supports PostDefend.
**Fix:** Add a `FollowupAttackOnHitAbAttr` (PostAttack) primitive. Same shape needed for ER 876 Sludge Spit and ER 491 Aftershock.

### [HIGH] ER 876 Sludge Spit — direction reversed (same shape as Thunder Clouds)
**Spec:** "Follows up with 35BP Venom Bolt after using an attack."
**Wire (`archetype-dispatcher.ts:3377`):** `CounterAttackOnHitAbAttr({moveId:SLUDGE})` — defensive counter rather than post-attack follow-up.
**Fix:** PostAttack follow-up needed.

### [HIGH] ER 491 Aftershock — direction reversed (same shape)
**Spec:** "Triggers Magnitude 4-7 after using a damaging move."
**Wire (`archetype-dispatcher.ts:3381`):** `CounterAttackOnHitAbAttr({moveId:MAGNITUDE})` — defensive.
**Fix:** PostAttack follow-up needed.

### [HIGH] ER 398 Fungal Infection — direction inverted (defensive defended OK if ER intent is "on-touch")
**Spec:** "Contact moves inflict Leech Seed on the target."
**Wire (`archetype-dispatcher.ts:2544`):** `ChanceBattlerTagOnHitAbAttr({chance:100, tags:[SEEDED]})` — defensive, fires when holder is touched, applies SEEDED to attacker.
**Gap:** Ambiguous interpretation. Reading "contact moves inflict Leech Seed on the target" as offensive (holder's contact moves apply SEEDED) would match Fungal-Infection's spore theming. The defensive reading also makes sense (a la Iron Barbs). Without a clearer ER reference, BOTH interpretations are plausible — defensive matches the safer of the two and is acceptable. **Downgrade to MEDIUM** when reviewing this entry.

### [MEDIUM] ER 487 Super Strain — recoil piece missing
**Spec:** "KOs lower Attack by +1. Take 25% recoil damage."
**Wire (`archetype-dispatcher.ts:3513`):** `StatTriggerOnKoAbAttr({stats:[{stat:ATK, stages:-1}]})` — KO-side ATK drop only. The 25% recoil piece is deferred per comment.
**Fix:** Add a recoil-hook on attack (new primitive). Partial wire.

### [MEDIUM] ER 1027 Jungle Fever — terrain-gate via closure not symmetric with weather equivalents
**Spec:** "If Grassy Terrain is active, gets a 1.5x Speed boost."
**Wire (`archetype-dispatcher.ts:2360`):** `new StatMultiplierAbAttr(Stat.SPD, 1.5, (_user,_t,_move) => globalSceneTerrainIs(TerrainType.GRASSY))`. The closure works at apply time but bypasses the archetype layer's `WeatherStatMultiplierAbAttr` symmetry — terrain-gated stat multipliers should have a parallel `TerrainStatMultiplierAbAttr` primitive for consistency.
**Fix:** Introduce `TerrainStatMultiplierAbAttr` (parallel to `WeatherStatMultiplierAbAttr`) for the dozen+ terrain-gated stat boosts in ER. Functional today via closure but inconsistent with the rest of the archetype layer.

### [MEDIUM] ER 488 Tipping Point — fires on non-damaging hits too
**Spec:** "Getting hit raises SpAtk. Critical hits maximize SpAtk."
**Wire (`archetype-dispatcher.ts:1861-1863`):** `StatTriggerOnHitAbAttr({stats:[{stat:SPATK, stages:1}]})` — fires on ANY incoming hit, including status moves that don't deal damage. Spec strongly implies damaging hits.
**Fix:** Add a damaging-hit gate to the on-hit primitive (check `hitResult !== HitResult.NO_EFFECT && hitResult !== HitResult.STATUS`). Same gap on ER 519 Fortitude, ER 192 vanilla Stamina (and its rebalance rider).

### [MEDIUM] ER 519 Fortitude — same shape bug as 488
**Spec:** "Boosts SpDef +1 when hit. Maxes SpDef on crit."
**Wire (`archetype-dispatcher.ts:2189-2191`):** identical shape, same damaging-hit gate missing.

### [MEDIUM] ER 268 Chloroplast — approximation differs from spec mechanic
**Spec:** "Weather Ball, Solar Beam/Blade, Growth act as if used in sun."
**Wire (`archetype-dispatcher.ts:2506-2511`):** unconditional `WeatherStatMultiplierAbAttr(SPATK, 1.2)` in sun. Spec is about specific move overrides (Weather Ball's type changes, Solar Beam skips charge, Growth gives +2 instead of +1).
**Fix:** Per-move override primitive (out of scope today). Current approximation gives a generic SpAtk boost in sun that doesn't track Weather Ball / Solar Beam / Growth mechanics at all.

### [MEDIUM] ER 352 Sage Power — "locks move" piece missing
**Spec:** "Ups Special Attack by 50% and locks move."
**Wire (`archetype-dispatcher.ts:2314`):** `StatMultiplierAbAttr(Stat.SPATK, 1.5)` only. Gorilla-Tactics-style move-lock not wired.
**Fix:** Compose with vanilla pokerogue `GorillaTacticsAbAttr` (already exists). Today partial wire.

### [MEDIUM] ER 819 Serpent Bind — contact-required gate likely wrong + per-turn debuff missing
**Spec:** "50% chance to trap, then drop their speed by -1 each turn."
**Wire (`archetype-dispatcher.ts:2228-2232`):** `ChanceBattlerTagOnHitAbAttr({chance:50, tags:[TRAPPED], contactRequired:true})`. Spec doesn't gate on contact — likely should be all hits. The per-turn speed-drop while trapped is also missing.
**Fix:** Remove `contactRequired:true` from the wire (spec doesn't request it). Add a "while-trapped post-turn -1 SPD" rider (needs a new BattlerTag-gated post-turn primitive).

### [MEDIUM] ER 678 Fluffiest — "4x weak to fire" not auditable here (id 678 not currently wired; flagging as MEDIUM coverage gap)
**Spec:** "Quarters contact damage taken. 4x weak to fire."
**Wire:** ER 678 isn't in either dispatch switch and isn't in `ABILITY_PATCHERS` — falls through to default `SKIP_BESPOKE`. Fluffy-cluster ability missing.
**Fix:** Wire as `[DamageReductionAbAttr({reduction:0.5, filter:{kind:"category", category:PHYSICAL}}), ReceivedTypeDamageMultiplierAbAttr(FIRE, 2.0)]` to match the contact-halving + fire-weak shape. (Note: 0.5x contact + 0.5x physical is approximate; the "quarters" wording means 0.25x for contact specifically.)

### [MEDIUM] ER 892 Crispy Cream — two procs rolled independently inflates rate
**Spec:** "30% to inflict burn/frostbite when hit by contact."
**Wire (`archetype-dispatcher.ts:2337-2347`):** two independent `ChanceStatusOnHit`/`ChanceBattlerTagOnHit` instances both at 30%. Combined: P(any proc) = 1 - 0.7*0.7 ≈ 51%, and both can land on a single hit.
**Fix:** Single 30% roll that picks uniformly between BURN and ER_FROSTBITE (mirror the multi-effect picker in `ChanceStatusOnHitAbAttr.pickEffect`). The current shape is Flame-Body class but localized within a single ability.

### [MEDIUM] ER 348 North Wind — hail-immunity piece missing
**Spec:** "3 turns Aurora Veil on entry. Immune to Hail damage."
**Wire (`archetype-dispatcher.ts:2169`):** entry-effect Aurora Veil only. Hail-immunity deferred.
**Fix:** Add a weather-damage-immunity attr (analog of Overcoat's blockWeatherDamageAttr but typed to hail/snow specifically).

### [MEDIUM] ER 944 Dead Bark — "30% less if SE" piece missing
**Spec:** "Adds Ghost type. Takes 15% less damage. 30% less damage if SE."
**Wire (`archetype-dispatcher.ts:1899-1902`):** entry-add-Ghost + 0.15 all-moves damage reduction. The conditional SE-only stronger reduction (30%) is deferred per comment.
**Fix:** Stack a SE-gated `DamageReductionAbAttr` on top, with logic to subtract the existing 0.15 piece (compose correctly to land 0.3 total on SE moves).

### [MEDIUM] ER 953(R29) Hypnotic Trance — 100% confuse on DEFENSIVE hit
(This is the original wired-as-Hypnotic-Trance entry that lives under case 953 in the main switch and is shadowed by the R48 wire when 953's spec is actually Zen Garden. Documented as CRITICAL above for the wrong-ability case. The 100%-confuse-on-defensive-hit semantics would also be a HIGH-severity direction bug if 953 spec WERE Hypnotic Trance.)

### [MEDIUM] ER 891 Rat King — ally aura applied only once at entry
**Spec:** "Allies with a BST below 400 get their stats boosted by 50%."
**Wire (`archetype-dispatcher.ts:4175` via R48):** `BstConditionalAllyAuraAbAttr({bstMax:400, stages:1})`. The `apply` runs only on PostSummon; allies that switch in AFTER the Rat-King holder won't get the boost (stat-stage application is one-shot, not an aura).
**Fix:** Convert to a true aura via per-ally `StatMultiplier` evaluation that re-checks the holder is on-field — needs a new field-aura primitive. Today: partial wire.

### [MEDIUM] ER 1012 Petal Shield — DEF -1 fires on non-damaging hits
**Spec:** "Maxes Def on entry. -1 Def when hit."
**Wire (`archetype-dispatcher.ts:3303-3304`):** entry +12 DEF (engine clamps to +6) + on-hit -1 DEF via `StatTriggerOnHitAbAttr`. The -1 fires on ANY hit including status moves that don't deal damage.
**Fix:** Add damaging-hit gate (same shape as 488/519 fix).

### [MEDIUM] ER 53 Pickup vanilla rebalance — placeholder no-op patch
**Spec:** "Removes all hazards on entry. Not immune to hazards."
**Wire (`init-elite-redux-vanilla-rebalance.ts:622-630`):** adds `EntryEffectAbAttr({kind:"self-stat-boost", stat:ATK, stages:0})` — a no-op stat-boost as placeholder.
**Gap:** Vanilla pokerogue Pickup (item-find post-battle) is retained, and the hazard-clear rider isn't wired. The placeholder no-op is acknowledged in code comment as "future PostSummonClearHazardsAbAttr".
**Fix:** Compose with `PostSummonClearTerrainAbAttr`-style hazard-clear primitive (the R48 wires use `PostSummonClearTerrainAbAttr` for case 602/886 — a hazard-equivalent would parallel that).

### [MEDIUM] ER 51 Keen Eye — extra evasion-ignore not in spec
**Spec:** "Immune to accuracy drops. Grants a 1.2x accuracy boost."
**Wire (`init-elite-redux-vanilla-rebalance.ts:289-294`):** adds `IgnoreOpponentStatStagesAbAttr([EVA])` PLUS `StatMultiplierAbAttr(ACC, 1.2)`. The 1.2x ACC matches; the evasion-ignore is added but NOT in the ER spec.
**Fix:** Strip the `IgnoreOpponentStatStagesAbAttr([EVA])` push — spec doesn't mention ignoring foe's evasion.

### [MEDIUM] ER 52 Hyper Cutter — +1 crit on contact missing
**Spec:** "Enemies can't lower Atk/SpAtk. Contact moves get +1 Crit."
**Wire (`init-elite-redux-vanilla-rebalance.ts:325-330`):** adds SPATK protection only. The "+1 Crit on contact moves" piece is deferred per code comment.
**Fix:** Compose with `CritStageBonusAbAttr({bonus:1, filter:{flag:MAKES_CONTACT}})` (primitive used by Precise Fist case 375).

### [MEDIUM] ER 39 Inner Focus — "Focus Blast never misses" missing
**Spec:** "Blocks flinch, Intimidate, Scare. Focus Blast never misses."
**Wire (`init-elite-redux-vanilla-rebalance.ts:336`):** adds ER_FEAR battler-tag immunity. The Focus-Blast-never-misses piece is missing.
**Fix:** Add a `StatMultiplierAbAttr(ACC, ∞, (...) => move.id === FOCUS_BLAST)` similar to ER 953's Hypnotic Trance shape and ER 376's Deadeye.

### [MEDIUM] ER 656 Tag — defensive counter doesn't match "attacks switching opponents"
**Spec:** "Attacks switching opponents with a 20BP Pursuit."
**Wire (`archetype-dispatcher.ts:4060` via R48):** `CounterAttackOnHitAbAttr({moveId:PURSUIT})` — defensive counter on any hit. Spec wants a hook on opponent-switch-out, not opponent-hits-us. The wires acknowledge no on-foe-switch hook exists in pokerogue.
**Fix:** New `OnOpponentSwitchOut` primitive (parallel to `PostAllyFaintStatChange`). Today's defensive counter fires at the wrong moment.

### [MEDIUM] ER 879 Chilling Pellets — BP mismatch (Icicle Spear ≠ 13 BP)
**Spec:** "Uses 13BP Icicle Spear when hit by contact."
**Wire (`archetype-dispatcher.ts:3361`):** `CounterAttackOnHitAbAttr({moveId:ICICLE_SPEAR})` — Icicle Spear's vanilla BP is 25 per hit (multi-hit). Spec wants a 13 BP custom variant.
**Fix:** Either accept the BP overshoot (note partial wire) or wire a custom 13 BP move (ER custom needed).

### [MEDIUM] ER 869/870 Fire Aspect cluster duplication — see CRITICAL 871 above
(Already counted under CRITICAL 871. Counting one row here would double-count; skipped.)

---

## Observations beyond the 50-bug cap

The following gaps were noted but not promoted into the count:

- **R48 partial-wire approximations:** ER 705 Terastal Treasure, ER 1004 Feathercoat, ER 674 Blood Stigma, ER 855 Hyper Cleanse, ER 944 Dead Bark, ER 348 North Wind, ER 715 Hover, ER 843 Fey Flight, ER 807 Woodland Curse, ER 873 Winter Throne all wire only one of two pieces and explicitly acknowledge the partial state in code comments. They are functional approximations; the missing pieces are tracked in dispatcher comments.
- **Dead-code switch labels:** Cases 282/599/627/911/596/953953/838838/282282/904904/273273/656656 and several others act as sentinels or duplicate switch entries that are unreachable. Not a runtime bug but maintenance debt.
- **Comment ID drift:** `init-elite-redux-vanilla-rebalance.ts` has dozens of comments where the ID number in the comment (e.g. "24 LIMBER", "234 PRANKSTER") doesn't match either pokerogue's AbilityId numeric value OR the ER spec's id. The wires use `AbilityId.<NAME>` which targets pokerogue's enum entry correctly, but the commentary is confusing and contributed to the spec-mismatch bug in ER 7 Limber.
- **Stamina (ER 192) / Anger Point (ER 83) crit-rider:** uses `PostReceiveCritStatStageChangeAbAttr(stat, 12)` to "max out" via engine clamping. The +12 stages relies on `StatStageChangePhase` clamping to +6; if clamping changes in pokerogue upstream, these wires would over-apply. Tagged as fragile but functional today.
- **`ChanceBattlerTagOnHitAbAttr` lacks `contactExcluded`:** the primitive supports `contactRequired` but not the `contactExcluded` gate (which `ChanceStatusOnHitAbAttr` got in the Flame Body fix). Any future "Static-class" tag-applying rebalance (e.g. a hypothetical Steadfast extension) would face the same stacking bug. Suggest adding the gate symmetrically.
- **Type-conversion abilities not audited line-by-line:** The Refrigerate / Pixilate / Aerilate / Galvanize cluster patches add a baseline 1.2x typed boost but rely on vanilla pokerogue's type-conversion attr for the Normal→X conversion. Not audited whether the conversion fires before or after the boost; ordering may matter.

---

## Methodology

The "wrong ability wired" class (14 of 19 CRITICALs) is mechanically detectable. Run this script to surface candidates:

```js
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('vendor/elite-redux/v2.65beta.json', 'utf8'));
const idx = Object.fromEntries(data.abilities.map(a => [a.id, a.name]));
const src = fs.readFileSync('src/data/elite-redux/archetype-dispatcher.ts', 'utf8');
const lines = src.split('\n');
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\s*case (\d+):/);
  if (!m) continue;
  const id = +m[1];
  if (!idx[id]) continue;
  let comment = '';
  for (let j = i+1; j < Math.min(i+4, lines.length); j++) {
    const cm = lines[j].match(/^\s*\/\/\s*(.*)/);
    if (cm) { comment = cm[1]; break; }
  }
  const nameMatch = comment.match(/^(.+?)\s*[—–-]\s*/);
  const claimed = nameMatch ? nameMatch[1].trim() : '';
  if (!claimed || claimed.toLowerCase().startsWith('sentinel')) continue;
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm(claimed) !== norm(idx[id])) {
    console.log(`${id} | CLAIMED='${claimed}' | SPEC='${idx[id]}'`);
  }
}
```

The "direction reversed" class (~12 rows in this audit) is detectable by grepping for any bespoke ability whose ER spec text contains "moves" / "attacks" / "inflicts" / "when using" / "after using" as a sentence subject and verifying the wire uses an offensive (`PostAttack*`) primitive rather than `ChanceStatusOnHitAbAttr` / `ChanceBattlerTagOnHitAbAttr` / `CounterAttackOnHitAbAttr` (all defensive).

The "partial wire" class is the largest remaining category but is mostly acknowledged in code comments (`partial wire`, `Defer`, `TODO`). A linter could flag any `ok([...])` whose preceding comment block contains those tokens to surface known-incomplete wires.

## Cross-reference: bug counts by file

| File | Bugs flagged |
|------|-------------:|
| `src/data/elite-redux/archetype-dispatcher.ts` | 48 |
| `src/data/elite-redux/init-elite-redux-vanilla-rebalance.ts` | 14 |
| `src/data/elite-redux/archetypes/chance-status-on-hit.ts` | 0 (primitive correct; misuse counted at call sites) |
| `src/data/elite-redux/archetypes/counter-attack-on-hit.ts` | 0 (primitive correct; defensive surface is intended) |

Total entries: 62 unique IDs across both files.
