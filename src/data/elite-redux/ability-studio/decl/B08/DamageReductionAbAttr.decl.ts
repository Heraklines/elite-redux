/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  REDUCTION_FILTER_NAMES,
  REDUCTION_FILTERS,
  reductionFilterCodec,
} from "#data/elite-redux/ability-studio/decl/B08/chunk4-choices";
// B08 chunk 4 / calc-modifier, Tier B. Read from the source (archetypes/damage-reduction-generic.ts), its parent
// ReceivedMoveDamageMultiplierAbAttr (ab-attrs.ts), the dispatch (Pokemon.getAttackDamage applies "ReceivedMoveDamageMultiplierAbAttr" with
// the holder as the TARGET and the attacker as `opponent`) and the live instances of all 66 attrs of the 53 users.
// The constructor takes ONE options object { reduction, filter, affectsFixedDamage?}. It builds the parent's closure
//   (target, attacker, move) => DamageReductionAbAttr.matchesFilter(filter, target, attacker, move)
// and hands the parent multiplier = 1 - reduction. canApply was the parent's (the closure only), so it is now
//
//   gate      the move matches the filter                          -> one library tree per user (bindings.ts)
//   (no guards, no residual, no random draw)
//   apply     damage = toDmgValue(damage * (1 - reduction)), by the parent; it runs for simulated calls too (it only rewrites the damage)
//
// The nine filter kinds, with the exact expression of the class (matchesFilter) and its library form:
//   all                  move.category !== STATUS                                           -> move.damaging
//   category             move.category === C                                                -> move.category C
//   contact              move.hasFlag(MAKES_CONTACT)  (the move's OWN flag)                  -> move.inherent-flag MAKES_CONTACT
//   full-hp              target.isFullHp() && category !== STATUS                            -> all[hp.full holder, move.damaging]
//   category-in-weather  move.category === C && arena.weather?.weatherType === W              -> all[move.category C, field.weather W]
//   move-type            category !== STATUS && attacker.getMoveType(move) === T             -> all[move.damaging, move.type T (effective)]
//   super-effective      target.getAttackTypeEffectiveness(attacker.getMoveType(move), { source, move }) > 1   (NO status check)  -> legacy
//   resisted             category !== STATUS && 0 < the same chart multiplier < 1            -> legacy
//   crit                 category !== STATUS && !!target.turnData.attacksReceived?.[0]?.critical (the DEFENDER's own record)       -> legacy
// The three legacy kinds need atoms that do not exist yet (requests R-B08-37 and R-B08-38): the chart multiplier through
// getAttackTypeEffectiveness is not what `move.effectiveness` reads (getMoveEffectiveness: a cached value, the requested-type rewrite,
// the status-move rule), and `hit.critical` reads the OTHER Pokemon's record, not the holder's.
//
// The filter decides the SHAPE of the gate (each user's binding spells it out), so it is not editable; the reduction and the
// fixed-damage switch are only read by apply and are editable.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";

export default defineDecl(DamageReductionAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less damage from a kind of move",
  summary: params => {
    const kind = String(params.situation);
    return `Damage from ${kind.charAt(0).toLowerCase()}${kind.slice(1)} is cut by ${Math.round(Number(params.reduction) * 1000) / 10}%. Example: 0.5 means half damage, 0.35 means 35% less.`;
  },
  synonyms: [
    "resist",
    "damage reduction",
    "take less damage",
    "half damage",
    "filter",
    "solid rock",
    "thick fat",
    "fluffy",
    "tank",
    "bulky",
  ],
  examples: [
    "Take 35% less damage from super effective moves like Filter",
    "Take half damage from special moves",
    "Take a quarter of the damage from contact moves",
  ],
  params: [
    {
      id: "reduction",
      ctorIndex: 0,
      ctorOption: "reduction",
      path: "reductionAmount",
      control: "number",
      min: 0.01,
      max: 0.99,
      step: 0.001,
      label: "Damage removed (0.5 = half damage, 0.35 = 35% less)",
      editable: true,
      gateIndependent: true,
      default: 0.5,
    },
    {
      id: "affectsFixedDamage",
      ctorIndex: 0,
      ctorOption: "affectsFixedDamage",
      path: "affectsFixedDamage",
      control: "boolean",
      label: "Also reduces fixed damage (like Seismic Toss)",
      editable: true,
      gateIndependent: true,
      default: false,
    },
    {
      id: "situation",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "filterSpec",
      control: "select",
      label: "Which moves are reduced (set by the conditions)",
      // The kind of move IS the gate (each user's binding spells it out with library atoms), so changing it here would not change
      // the compiled rule; staff change the IF block instead.
      editable: false,
      default: REDUCTION_FILTERS[0][0],
      options: REDUCTION_FILTER_NAMES,
      codec: reductionFilterCodec,
    },
  ],
  conditions: [
    // The gate is one library tree per user (bindings.ts), for example [move.category SPECIAL] or [move.damaging, move.type FIRE].
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-damage-taken", params: ["reduction", "affectsFixedDamage"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "respects" },
  probes: [
    {
      // Boundary HP for the full-HP kind; a special, a physical contact and a Fire move that can really hurt the default holder. The status
      // and Ghost moves of the L1 grid cover the kinds that never reach a damage calculation in a battle.
      name: "full HP boundary against a special, a physical contact and a Fire move",
      axes: { hp: ["max", "max-1", 1], foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: the class had no canApply of its own, the parent's was `this.condition(pokemon, attacker, move)`, so the whole rule is the gate (the filter) and the compiled instance overrides it. Params: reduction (ctor option, read back from reductionAmount; the multiplier is 1 - reduction, so Dead Bark's 0.176 gives 0.824 exactly as built), affectsFixedDamage (true only for Gulp Missile) and the kind of move (non-editable, it shapes the gate). Users (53 abilities, 66 attrs): every damaging move (15 attrs: Gulp Missile, Arctic Fur, Parry, Ultra Instinct, Terastal Treasure, Dream State, Crust Coat, Faraday Cage, Dead Bark attr 1, Mucus Membrane, Feathercoat attr 0, Aura Armor, Deflect, Rock Armor, Prickly Armor attr 1), physical (Lead Coat, Jungle's Guard attr 3, Guardian Coat), special (Prism Scales, Chrome Coat, Fire Scales, Aurora's Gale, Rainbow Scales, Angelic Wings), contact (Liquified, Fluffiest, Puffy, Nucleus), full HP (Brain Mass), special or physical in a weather (Sand Guard, Sun Basking, Sepia Lens, Rain Shroud x2 for rain and heavy rain, Sand Fiend), a move type (Fossilized, Stonecutter, Raw Wood, Smoldering Wood, Deep Freeze, Thick Blubber x2, Elemental Aegis x3, Ominous Shroud x2, Foggy Eye, Aegis Ward x3, Paper Talisman x3, Hyper Cleanse, Strong Foundation x2). LEGACY gates (9 attrs, bound as legacy-closure with a reason, pending requests): super effective (Permafrost, Primal Armor, Thick Skin, Flame Shield, Dead Bark attr 2, Fire Ruler, Cryogenesis), resisted (Feathercoat attr 1) and critical hits (Bad Omen). Jungle's Guard attr 3 also carries an attr-level condition (grassy terrain) added with addCondition; it is not part of this class and recompose copies it. DISPATCH NOTE: the effect is shared with ReceivedMoveDamageMultiplierAbAttr (the same hook, the same multiplier maths) but the filter object is this class's own; Fluffiest and Bad Omen show the same 'quarter damage' number through different filters. SUSPECTED ODDITIES, NOT FIXED: (1) 'all' means category !== STATUS but 'contact' has no damaging test, so a status move with the contact flag would match; harmless because damage is only calculated for attacking moves. (2) 'crit' reads only the entry [0] of the DEFENDER's turnData.attacksReceived, not the hit that is being calculated, so with several hits in one turn it may look at another hit than the current one. (3) 'category-in-weather' reads arena.weather directly, not through any weather-suppression rule. (4) Rain Shroud, Elemental Aegis, Aegis Ward, Paper Talisman, Thick Blubber and Strong Foundation are several attrs of one ability, each one reduction on its own. L2: the battle twin runs one pair per distinct setting with a special, a physical contact and a Fire move; the weather, status-move and Ghost-move cases cannot reach the hook in a battle (the default Normal holder is immune to Ghost, a status move calculates no damage, and weather scenarios did not reach every ability), so they are proven by the L1 grid (rain, sun, sandstorm, snow, 20 moves) and by test/tests/elite-redux/decomp/B08/chunk4-gates.test.ts (all 66 attrs against the class's own filter over six weathers, three record states and three holder typings). showAbility is false for every user (the class passes false).",
});
