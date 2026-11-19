/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: calc-modifier (Tier A, constructor closure). See ../PRECEDENTS.md.
//
// "While the game calculates the damage I take, IF <closure>, multiply it by <multiplier>". The class takes the
// condition as a constructor closure, so this is the textbook Tier A class: `buildAttr` calls the real
// constructor with the compiled library form of the closure. EVERY user of the class is bound individually in
// bindings.ts (64 attrs: Multiscale is `hp.full`, Filter is `move.effectiveness >= 2`, Fluffy is two attrs, ...).
import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ReceivedMoveDamageMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Take less (or more) damage",
  summary: params => `Damage I take is multiplied by ${params.multiplier}`,
  synonyms: ["resist", "half damage", "damage reduction", "tank", "take more damage", "weakness"],
  examples: ["Halve damage at full HP", "Take double damage from Fire moves"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Damage multiplier",
      editable: true,
      default: 0.5,
    },
    {
      id: "affectsFixedDamage",
      ctorIndex: 3,
      path: "affectsFixedDamage",
      control: "boolean",
      label: "Also affects fixed damage",
      editable: true,
      default: false,
    },
  ],
  // ctor 2 is `showAbility`: never exposed, always false for every user.
  fixedCtorArgs: { 2: false },
  conditions: [
    // No single atom: the closure differs per user and each binding names its own (see bindings.ts).
    { slot: "ctor:0", ctx: "defend", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-damage-taken", params: ["multiplier", "affectsFixedDamage"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // L1 uses every hp value (the boundary max / max-1 and 1 HP); L2 takes the first six combinations.
      name: "full HP boundary against a special, a physical contact and a Fire move",
      axes: { hp: ["max", "max-1", 1], foeMove: ["WATER_GUN", "BITE", "EMBER"] },
    },
  ],
  status: "verified",
  notes:
    "Precedent for a calc-modifier with a constructor closure. 61 of 64 closures map to library atoms; Sugar Rush, Madness Enhancement and Oracle stay legacy-closure (they call holderHasUpcycle / isFogWeather / oracleGuardActive, which have no atom yet). Subclasses (ReceivedTypeDamageMultiplierAbAttr, the archetype reductions) are separate classes with their own declarations.",
});
