/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 3 (Tier B, calc-modifier). "The extra-effect chance of my moves that can drench is multiplied (x5 by default)."
//
// Source: fakemon-pitch-mechanics.ts, HydromancyEffectChanceAbAttr (extends MoveEffectChanceMultiplierAbAttr). Dispatched from
// Move.getMoveChance like its sibling. Constructor `(chanceMultiplier = 5)`: the new argument replaces the literal in `super(5)`.
// canApply, original clause order, now `guards && gate`:
//   guards  1. super.canApply: `!(chance.value <= 0 || [ORDER_UP, ELECTRO_SHOT].includes(move.id))`
//   gate    2. move.attrs.some(attr => attr.constructor.name === "ErDrenchAttr")    the move has a part that can drench the target
//                                                                                   -> NO library atom yet (R-B16-16)
// apply (the parent's): `chance.value *= chanceMultiplier; chance.value = Math.min(chance.value, 100)`.
// No random draw, no state; the class never reads `simulated`.
import { HydromancyEffectChanceAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(HydromancyEffectChanceAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.effect-chance",
  label: "Multiply the chance that my moves drench the target",
  summary: params =>
    `The chance of my moves that can drench the target is multiplied by ${params.multiplier}, never above 100%. Example: 5 = a 20% chance becomes 100%.`,
  synonyms: [
    "hydromancy",
    "drench more",
    "soak chance",
    "more drenching",
    "wet the target",
    "water magic",
    "serene grace for drench",
  ],
  examples: ["Make my drenching moves drench five times as often, like Hydromancy"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "chanceMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.1,
      label: "Chance multiplier (5 = five times as likely, 0 = never)",
      editable: true,
      gateIndependent: true,
      default: 5,
    },
  ],
  conditions: [
    // The gate: the move can drench the target. Staff may replace or drop it.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must have an extra effect with a chance above 0 (a guaranteed or missing effect is left alone)",
    "Order Up and Electro Shot are never changed",
    "The result never goes above 100%",
  ],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  l2StaticReason:
    "The shared L2 scenario for this trigger lets the holder attack with Tackle and Double Slap, which have no extra effect with a chance. test/tests/elite-redux/decomp/B16/chunk3.test.ts drives a drenching move (Water Gun with the Drench part added), Ember and Order Up through the original attr and the rebuild.",
  probes: [{ name: "a move with a drench chance", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B: trigger (while the game calculates my move's effect chance), one IF in the gate (the move can drench the target), one effect (multiply the chance; no library block yet, so effect.package with the typed multiplier like the parent class of B02: request B02-10 and R-B16-21 here). The gate has no library atom (it asks whether the move carries the Drench part, found by the attr's CLASS NAME), so its binding is a legacy closure until R-B16-16 (`move.can-drench`) exists. The parent's rule (a real chance above 0, not Order Up or Electro Shot) is `guards` and stays in the class. The class previously had no constructor argument; the new one defaults to the old literal 5. The check uses the string 'ErDrenchAttr' on the attr's constructor name (an Endless Avalanche style name key), so a renamed class would silently stop the boost; not changed. The Drench part has its own chance (`effectChanceOverride`, 20% or the rain chance), and this class multiplies that value. User: Hydromancy (6005, attr 0).",
});
