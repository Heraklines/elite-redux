/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "The damage my moves deal is multiplied when a condition is true" (Tinted Lens, Parental Bond's second hit).
//
// Source: src/data/abilities/ab-attrs.ts MoveDamageBoostAbAttr (extends PreAttackAbAttr). Dispatched from
// Pokemon.getAttackDamage (src/field/pokemon.ts, `applyAbAttrs("MoveDamageBoostAbAttr", { pokemon: source, opponent: this,
// move, simulated, damage })`) after the field and crit multipliers, only when the source's ability is not ignored.
// Clauses:
//   canApply: `this.condition(pokemon, target, move)`, the only clause                       -> condition (ctor:1)
//   apply:    `damage.value = toDmgValue(damage.value * damageMultiplier)`  (floor, never below 1) -> effect
// Constructor: (damageMultiplier, condition). `super(false)`: showAbility is hard-coded, not an argument.
// No random draw, no state. Tier A: the closure is the staff-editable IF and every user is bound in bindings.ts.
import { MoveDamageBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MoveDamageBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-dealt",
  label: "Multiply the damage my moves deal",
  summary: params =>
    `The final damage of my attack is multiplied by ${params.multiplier} (rounded down, at least 1) whenever the condition is true. Example: 2 = double damage.`,
  synonyms: [
    "tinted lens",
    "parental bond",
    "damage boost",
    "deal more damage",
    "stronger hits",
    "final damage",
    "double damage",
    "extra damage",
  ],
  examples: [
    "Double the damage of resisted hits, like Tinted Lens",
    "Make the second strike of a two-hit move deal a quarter damage, like Parental Bond",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "damageMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.05,
      label: "Damage multiplier (2 = double, 0.25 = a quarter)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [{ slot: "ctor:1", ctx: "attack", path: "condition", removable: true, editable: true }],
  guards: [],
  feasibility: ["The result is rounded down to a whole number and is never below 1"],
  effect: { id: "effect.multiply-damage-dealt", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "my attack at full HP and at half HP", axes: { hp: ["max", "50%"] } }],
  status: "decomposed",
  notes:
    "Tier A, 4 attrs. Tinted Lens, Sepia Lens and Drake Of Rage pass `(target?.getMoveEffectiveness(user, move) ?? 1) <= .5` (bound to move.effectiveness lte 0.5, a missing target answers false in both forms). Parental Bond (attr 1) passes `user.turnData.hitCount > 1 && user.turnData.hitsLeft === 1 && move.canBeMultiStrikeEnhanced(user, true, target)` (the extra strike of a multi-strike move): no library atom reads the turn's hit counters in an attack frame (the frame has no hits slot there) and the strike-eligibility rule is request B02-12b, so it stays legacy-closure (request B02-18). The subclass HitMultiplierPowerAbAttr (archetype) is a separate class. The class ignores `simulated` in apply (the preview calculation applies the same multiplier). toDmgValue rounds down and never goes below 1.",
});
