/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. "My super effective moves get stronger" (Winged King, Iron Serpent, Arcane Force, Brain Food, Psychic Supremacy).
//
// Source: src/data/elite-redux/archetypes/super-effective-multiplier-boost.ts, SuperEffectiveMultiplierBoostAbAttr (extends
// MovePowerBoostAbAttr, ab-attrs.ts:1886). Dispatched while the game computes the power of my move (Move.calculateBattlePower,
// applyAbAttrs("MovePowerBoostAbAttr"...)). Constructor: one options object `{ factor }`; it builds its OWN closure for the parent:
//   `(user, target, move) => target && move && target.getMoveEffectiveness(user, move) >= 2`  (an engine error counts as "no")
// Clauses (Tier B, the closure is not a constructor argument so the class had to be split to expose it):
//   gate      the move's effectiveness against the target is 2 or more                     replaceable = move.effectiveness { gte 2 }
//   (none)    no guard, no residual
// apply (inherited): `power.value *= powerMultiplier`. No random draw, no state, no `simulated` test.
// The split moves the closure body into the module function `isSuperEffective`, called by the closure (the parent still holds it) and by
// `gate`: a pure move of code.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SuperEffectiveMultiplierBoostAbAttr } from "#data/elite-redux/archetypes/super-effective-multiplier-boost";

export default defineDecl(SuperEffectiveMultiplierBoostAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Make my super effective moves stronger",
  summary: params =>
    `When my move is super effective, its power is multiplied by ${params.factor}. Example: 1.33 = 33% more power. Other moves are left alone.`,
  synonyms: [
    "stronger super effective hits",
    "boost super effective",
    "weakness exploit",
    "super effective damage bonus",
    "type advantage bonus",
    "winged king",
    "iron serpent",
  ],
  examples: ["Super effective moves deal 33% more damage, like Winged King", "Super effective moves get 10% more power"],
  params: [
    {
      id: "factor",
      ctorIndex: 0,
      ctorOption: "factor",
      path: "powerMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.01,
      label: "Power multiplier (1.33 = 33% more power, 1 = no change)",
      editable: true,
      // Only the effect reads it; the gate (the move is super effective) never repeats it.
      gateIndependent: true,
      default: 1.33,
    },
  ],
  conditions: [
    // The gate: library atom move.effectiveness { gte 2 } (target.getMoveEffectiveness(user, move), the same call).
    { slot: "gate", ctx: "params", lib: "move.effectiveness", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A move without a target is never boosted",
    "If the game cannot work out the matchup, the move counts as not super effective",
  ],
  effect: { id: "effect.multiply-power", params: ["factor"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A super effective, a neutral and a resisted move against the default foe.
      name: "a super effective move, a neutral move and a resisted move",
      axes: { foeMove: ["KARATE_CHOP", "TACKLE", "EMBER"] },
    },
  ],
  l2StaticReason:
    "The shared reach table lists calc.move-power as unreached because the engine dispatches this moment under the key VariableMovePowerAbAttr (same as B02's MovePowerBoostAbAttr, request B02-37); the L2 run shows no other difference between the original and the rebuilt abilities. B12/chunk2.test.ts proves the gate over every move of the game against every defender type.",
  status: "decomposed",
  notes:
    "Tier B, 5 attrs, all bound to move.effectiveness { gte 2 }: Winged King (5294 attr 0, x1.33), Iron Serpent (5295 attr 0, x1.33), Arcane Force (5224 attr 1, x1.1, after StabAddAbAttr), Brain Food (5936 attr 1, x1.1, after StabAddAbAttr, before LifestealOnKoAbAttr) and Psychic Supremacy (a saved editor ability, 20000 attr 1, x1.1). The closure was not a constructor argument, so canApply is now gatedCanApply with `gate` (the old closure body, shared through `isSuperEffective`); the parent's own closure field is unchanged and unused. The atom has one difference from the class: the class wraps the matchup call in try/catch and answers no when the engine throws, the atom does not catch (the engine does not throw for a real move; the L1 grid compares both). `getMoveEffectiveness` ALSO runs the holder's type-matchup abilities (Tera Shell style caps) and the foe's, so 'super effective' means 'effectiveness as the game finally computes it', not the plain type chart. Oddity, not fixed: the class doc says it multiplies the TYPE multiplier, but it multiplies the move POWER (so the extra 33% shows only for moves with a power, and not for fixed-damage or variable-damage moves).",
});
