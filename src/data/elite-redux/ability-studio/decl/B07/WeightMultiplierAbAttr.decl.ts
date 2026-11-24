/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 / calc modifier, Tier C (no closure, no gate). See ../PRECEDENTS.md.
//
// `Pokemon.getWeight()` (pokemon.ts) builds `weight = species.weight - autotomize` in a NumberHolder, calls
// `applyAbAttrs("WeightMultiplierAbAttr", { pokemon, weight })` and returns `Math.max(0.1, weight.value)`. The class
// has no canApply of its own (AbAttr's default is true) and `apply` does `weight.value *= this.multiplier`. The one
// constructor argument is the multiplier (ctor 0); `showAbility` is not an argument (`super(false)`).
import { WeightMultiplierAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(WeightMultiplierAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.weight",
  label: "Change my weight",
  summary: params =>
    `My weight is multiplied by ${params.multiplier}. Example: 2 makes me twice as heavy, 0.5 makes me half as heavy. Weight-based moves such as Heavy Slam and Low Kick read it.`,
  synonyms: [
    "heavy metal",
    "light metal",
    "heavier",
    "lighter",
    "weigh more",
    "weigh less",
    "body weight",
    "lead coat",
  ],
  examples: ["Twice as heavy, like Heavy Metal", "Half as heavy, like Light Metal"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 10,
      step: 0.1,
      label: "Weight multiplier (2 = twice as heavy, 0.5 = half)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["A Pokemon never weighs less than 0.1 kg, whatever the multiplier"],
  // No library effect changes a weight yet; the package keeps the typed param (request R-B07-3).
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the weight is read while a heavy-weight move is used", axes: {} }],
  l2StaticReason:
    "The weight is asked by Pokemon.getWeight (Heavy Slam, Low Kick and similar), which no scenario template of the battle twin reaches (the engine never evaluates the attr there). It is driven directly for the original, the rebuilt attr and a control in test/tests/elite-redux/decomp/B07/flag-sites.test.ts.",
  status: "decomposed",
  notes:
    "Tier C. The effect is 'package' ONLY because the library has no 'multiply the weight' effect (request R-B07-3); the trigger and the number are separate blocks. Users (live dump): Heavy Metal (134, attr 0, x2), Light Metal (135, attr 0, x0.5), Lead Coat (5034, attr 2, x3), Chrome Coat (5267, attr 2, x3), Superheavy (5549, attr 5, x2) and Meteor Mass (5997, attr 0, x3). The archetype dispatcher also builds `new WeightMultiplierAbAttr(3)` (archetype-dispatcher.ts, two places) and newcomer-signature-mechanics.ts passes METEOR_MASS_WEIGHT_MULTIPLIER; they are the same class and the same param. showAbility is false (`super(false)`), so no flyout shows. The class never reads `simulated`. Observation: the NumberHolder starts at the species weight minus 100 per Autotomize use, and the floor of 0.1 is applied by the caller, not by the class.",
});
