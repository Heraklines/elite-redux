/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PROPERTY_CHOICES, propertyCodec } from "#data/elite-redux/ability-studio/decl/B08/chunk4-choices";
// B08 chunk 4 / calc-modifier, Tier B. Read from the source (archetypes/effect-chance-modifier.ts), its parent MoveEffectChanceMultiplierAbAttr (ab-attrs.ts),
// the dispatch (data/moves/move.ts getMoveChance: applyAbAttrs("MoveEffectChanceMultiplierAbAttr", { pokemon: user, chance, move })) and the two live users,
// Precise Fist (5112, attr 1) and Way of Precision (5383, attr 4). The constructor takes { multiplier, flag? }, validates multiplier >= 0 and hands the
// multiplier to the parent. canApply is now `gate && residual`, in the ORIGINAL order:
//
//   gate      1. when a move property is configured, the move has it: move.hasFlag(flag)       -> atom move.inherent-flag (no property = no test)
//   residual  2. the parent's checks: chance.value > 0 and the move is not Order Up or Electro Shot  (feasibility)
//   apply     chance = min(chance * multiplier, 100), by the parent. No random draw (the chance is rolled later by the engine).
//
// The property decides which moves are changed and is the gate; it is not editable here (staff change the IF block). The multiplier is only read by
// apply and is editable.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { EffectChanceModifierAbAttr } from "#data/elite-redux/archetypes/effect-chance-modifier";

export default defineDecl(EffectChanceModifierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.effect-chance",
  label: "Change the chance of my moves' extra effects",
  summary: params =>
    `The chance of the extra effect of my moves is multiplied by ${params.multiplier}, at most 100%. Example: 2 doubles it, 0 removes extra effects, 5 makes a 10% chance 50%.`,
  synonyms: [
    "serene grace",
    "sheer force",
    "precise fist",
    "way of precision",
    "more flinches",
    "better secondary effect chance",
    "effect chance multiplier",
  ],
  examples: [
    "Punching moves have 5 times the chance of their extra effects",
    "Double the chance of flinching and status effects",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "configuredMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.25,
      label: "Chance multiplier (2 = double, 0 = no extra effects, 0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 5,
    },
    {
      id: "flag",
      ctorIndex: 0,
      ctorOption: "flag",
      path: "flag",
      control: "select",
      label: "Only for moves with this property (set by the conditions)",
      // The property IS the gate (each user's binding spells it out), so changing it here would not change the compiled rule.
      editable: false,
      default: "Punching moves",
      options: PROPERTY_CHOICES,
      codec: propertyCodec,
    },
  ],
  conditions: [
    // The gate is [move.inherent-flag F] (bindings.ts), or the empty always-true group when no property is configured.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The move must have an extra effect chance above 0", "Order Up and Electro Shot are never changed"],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "ignores" },
  probes: [
    {
      // A punching move with an extra effect, a move with a different property, a damaging move without any extra effect.
      name: "moves with and without the property and with and without an extra effect",
      axes: { foeMove: ["TACKLE", "FLAME_WHEEL", "SWORDS_DANCE", "ROCK_SLIDE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand (gate: the move property; residual: the parent's checks). The EFFECT is a package PLACEHOLDER with the typed setting `multiplier`: written reason: the library has no effect that scales the extra-effect chance (the WHEN calc.effect-chance modifies `effectChance`, no effect writes it); request R-B08-42 asks for `effect.multiply-effect-chance` (chance = min(chance * m, 100)). The effect is one multiplication, nothing more can be split off. Users (2, both bound): Precise Fist (5112, attr 1, between CritStageBonusAbAttr and BreakScreensOnAttackAbAttr) and Way of Precision (5383, attr 4), both with the multiplier 5 and the property Punching moves (gate [move.inherent-flag PUNCHING_MOVE]). A configuration without a property (Serene Grace style, used by nobody here) binds to the empty group, which is always true. The gate is move.hasFlag (the move's own flag), not doesFlagEffectApply, matching the class. `simulated`: the class and its parent ignore it; apply only writes the chance holder. No random draw. The accessors getMultiplier, getFlag and stripsSecondaryEffects stay. showAbility is false (the parent's constructor passes false). Sibling classes StatusChanceMultiplierAbAttr and TypeFilteredEffectChanceMultiplierAbAttr (other batches) also extend the parent and have their own declarations.",
});
