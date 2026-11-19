/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "The chance of my moves' extra effects is multiplied" (Serene Grace x2, Sheer Force x0).
//
// Source: src/data/abilities/ab-attrs.ts MoveEffectChanceMultiplierAbAttr. Dispatched from Move.getMoveChance
// (src/data/moves/move.ts, `applyAbAttrs("MoveEffectChanceMultiplierAbAttr", { pokemon: user, simulated: !showAbility,
// chance, move })`), the very first modifier of the chance.
// Clauses, in the original order, all in canApply:
//   1. `chance.value <= 0` returns false   -> feasibility: only a real chance (above 0) can be multiplied. A guaranteed
//      effect (-1) or no effect (0) is left alone.
//   2. `[ORDER_UP, ELECTRO_SHOT].includes(move.id)` returns false -> feasibility: two moves whose effect is not a "chance".
// apply: `chance.value *= chanceMultiplier; chance.value = Math.min(chance.value, 100)`.
// No random draw, no state, nothing to bind (no closure). Tier A: the only input is the constructor field.
import { MoveEffectChanceMultiplierAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoveEffectChanceMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.effect-chance",
  label: "Multiply the chance of my moves' extra effects",
  summary: params =>
    `The chance of my moves' extra effects (flinch, burn, stat drops) is multiplied by ${params.multiplier}, never above 100%. Example: 2 = doubled, 0 = no extra effects.`,
  synonyms: [
    "serene grace",
    "sheer force",
    "double effect chance",
    "secondary effect chance",
    "more flinches",
    "remove side effects",
    "extra effect chance",
  ],
  examples: ["Double the chance of extra effects, like Serene Grace", "Remove the extra effects of my moves (x0)"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "chanceMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.1,
      label: "Chance multiplier (2 = doubled, 0 = no extra effects)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The move must have an extra effect with a chance above 0 (a guaranteed or missing effect is left alone)",
    "Order Up and Electro Shot are never changed",
    "The result never goes above 100%",
  ],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared L2 scenario for this trigger lets the holder attack with Tackle and Double Slap, and neither has an extra effect with a chance, so nothing ever asks for the chance. B02's own test (B02/chance-and-effects.test.ts) drives Ember (10% burn) through both the original ability and the rebuild.",
  probes: [{ name: "a move with an extra effect chance", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind. Four users: Serene Grace, Lucky Wings, Free Spirit (x2) and Sheer Force (attr 1, x0). Sheer Force's other attr (the power boost) belongs to another class. The effect has no library block yet (multiply the effect chance with a cap at 100): effect.package, request B02-10 in requests/B02.md; Shield Dust (IgnoreMoveEffectsAbAttr) is the same effect with a 0 multiplier. Subclasses (EffectChanceModifier, TypeFilteredEffectChanceMultiplier, StatusChanceMultiplier archetypes) are separate classes. `canApply` tests `chance.value`, the value AFTER earlier modifiers and the move's own override, not `move.chance`; the library atom move.has-effect-chance (`move.chance >= 0`) is a different test and is NOT used. The class never looks at `simulated` in apply (the dispatch passes simulated true when the ability should not flash); this is existing behaviour.",
});
