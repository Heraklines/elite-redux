/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "The power of my move is multiplied when a condition is true" (Technician, Iron Fist, Tough Claws, Analytic ...).
//
// Source: src/data/abilities/ab-attrs.ts MovePowerBoostAbAttr (extends VariableMovePowerAbAttr extends PreAttackAbAttr).
// Dispatched from Move.calculateBattlePower (src/data/moves/move.ts:1338, `applyAbAttrs("VariableMovePowerAbAttr", ...)`,
// skipped when the user's ability is ignored), from Move.effectivePowerAbilityCheck (AI moveset generation, opponent =
// the user itself) and, filtered by `appliesToFixedDamage()` (false here), from Pokemon.getAttackDamage for fixed-damage
// moves (src/field/pokemon.ts:5945).
// Clauses, in order:
//   canApply: `this.condition(pokemon, opponent, move)`, the only clause (it does NOT call super.canApply, so the base
//             class's `skipDuringMovesetGen` test is never made for this class and its subclasses)  -> condition (ctor:0)
//   apply:    `power.value *= powerMultiplier`  (no rounding here)                                    -> effect
// Constructor: (condition, powerMultiplier, showAbility = false). showAbility is `false` for every user.
// No random draw, no state. Tier A: the closure is the staff-editable IF; every user is bound in bindings.ts.
import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MovePowerBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Multiply the power of my moves",
  summary: params =>
    `The base power of my move is multiplied by ${params.multiplier} whenever the condition is true. Example: 1.5 = 50% more power, like Technician on weak moves.`,
  synonyms: [
    "technician",
    "iron fist",
    "tough claws",
    "sheer force",
    "analytic",
    "reckless",
    "strong jaw",
    "mega launcher",
    "boost power",
    "base power",
    "power up",
    "stronger moves",
  ],
  examples: [
    "Boost punching moves by 30%, like Iron Fist",
    "Boost moves of 60 base power or less by 50%, like Technician",
    "Boost my physical moves by 50% while I am poisoned, like Toxic Boost",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "powerMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.05,
      label: "Power multiplier (1.5 = 50% more power)",
      editable: true,
      default: 1.3,
    },
  ],
  // ctor 2 is `showAbility`: never exposed, always false for every user.
  fixedCtorArgs: { 2: false },
  conditions: [{ slot: "ctor:0", ctx: "attack", path: "condition", removable: true, editable: true }],
  guards: [],
  feasibility: ["Moves that deal a fixed amount of damage are not changed"],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table (decomp-l2-reach.json) lists calc.move-power as unreached, although the original's attrs ARE evaluated in the shared scenario (the run shows no attr-not-evaluated problem for this class and every twin trace is identical): the engine dispatches the moment under the key VariableMovePowerAbAttr. Request B02-37 asks B20 to move the trigger to reached. B02/power-boost.test.ts proves the closures over a wide move list.",
  probes: [
    {
      name: "my attack burned, poisoned and healthy, in sun and fog",
      axes: { status: ["BURN", "POISON", "TOXIC", "NONE"], weather: ["NONE", "SUNNY", "FOG"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A, 109 attrs in 99 ability ids. 57 closures are bound to library atoms and 52 stay legacy-closure, with the missing atom named on every binding line (bindings.ts, requests B02-14 and B02-21 to B02-36): printed contact flag 10, property granted by another ability 5, fixed power 3, effect chance above 0 1, partner ability 2, same gender 2, illusion 1, moving last 4, switched in this turn 2, Mimicry 1, command ability provenance 3, rounded HP ratio 3, type may be changed by an ability 10, move type is one of mine 1, upcycle 2, weather not suppressed 1, raw terrain 1. The WHEN calc.move-power is dispatched through VariableMovePowerAbAttr; the Ally/UserField boosters are separate classes with their own declarations; the ten archetype subclasses (conditional-damage, stab-add, ...) too. appliesToFixedDamage() is false here, so the fixed-damage dispatch never reaches these attrs. Suspected game oddity (not fixed): the base class `VariableMovePowerAbAttr.canApply` has the `skipDuringMovesetGen` test, but this class overrides canApply without calling super, so the field (true for the low-HP type boosters) has no effect. Several multipliers are not round numbers (Angel's Wrath 2.5, 3, 2.818, 2.333; Giant Shuriken 6.67; Vengeful Spirit 1.1538) and are read back unchanged from the live attr.",
});
