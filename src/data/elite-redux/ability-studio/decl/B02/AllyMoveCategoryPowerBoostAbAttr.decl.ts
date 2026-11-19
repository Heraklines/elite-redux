/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "My ally's physical or special moves are stronger" (Battery, Power Spot).
//
// Source: src/data/abilities/ab-attrs.ts AllyMoveCategoryPowerBoostAbAttr (extends FieldMovePowerBoostAbAttr). Dispatched from
// Move.calculateBattlePower (src/data/moves/move.ts:1342): `for (const ally of source.getAdjacentAllies())
// applyAbAttrs("AllyMoveCategoryPowerBoostAbAttr", { ...abAttrParams, pokemon: ally })`, skipped when the move user's ability is
// ignored. `pokemon` is the ability owner (an adjacent ally of the move user).
// Clauses, in order:
//   canApply: always true (the class comment says the logic lives in move.ts)                    -> nothing
//   apply:    `if (condition(pokemon, opponent, move)) power.value *= powerMultiplier`, with the closure
//             `boostedCategories.includes(move.category)`                                         -> the `categories` setting
// Constructor: (boostedCategories, powerMultiplier). 
// The class is not touched: the live value is read back by asking the closure (boosted-codecs.ts), because a new instance field would change the configuration snapshot that the frozen fingerprints of the saved abilities guard.
// The archetype subclass AllyAttackPowerBoostAbAttr overrides apply and is a separate class.
// No random draw, no state. Tier A.
import { AllyMoveCategoryPowerBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { boostedCategoriesCodec } from "#data/elite-redux/ability-studio/decl/B02/boosted-codecs";
import { CATEGORY_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";

export default defineDecl(AllyMoveCategoryPowerBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Multiply my ally's physical or special move power",
  summary: params =>
    `The base power of my ally's moves of these kinds (${params.categories}) is multiplied by ${params.multiplier}. Example: Special at 1.3 = 30% stronger special moves for my ally, like Battery.`,
  synonyms: [
    "battery",
    "power spot",
    "ally boost",
    "partner boost",
    "boost my ally's special moves",
    "boost my ally's physical moves",
    "doubles support",
  ],
  examples: [
    "Make my ally's special moves 30% stronger, like Battery",
    "Make my ally's physical and special moves 30% stronger, like Power Spot",
  ],
  params: [
    {
      id: "categories",
      ctorIndex: 0,
      path: "condition",
      control: "text",
      label: "Move kinds that are boosted (comma separated: physical, special, status)",
      editable: true,
      default: "SPECIAL",
      options: [...CATEGORY_OPTIONS],
      codec: boostedCategoriesCodec,
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "powerMultiplier",
      control: "number",
      min: 0.05,
      max: 10,
      step: 0.05,
      label: "Power multiplier (1.3 = 30% more power)",
      editable: true,
      default: 1.3,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only helps an ally that is next to me (a far wing of a triple battle does not count)",
    "Does nothing while the move user's own ability is being ignored",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared twin battle is a singles fight, and this class is only dispatched for the adjacent ALLIES of the move user, so the original is never evaluated there. B02/power-boost.test.ts drives the original and the rebuilt attr of both users through the same apply call and compares the power.",
  probes: [{ name: "my ally attacks with a special and a physical move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 2 attrs (Battery: special moves; Power Spot: read from the live attr). Nothing to bind: the constructor takes the list of categories, not a closure, so the category test is the `categories` setting (the same rule as the move.category atom, one entry per kind). Several kinds are allowed because the original takes a list. The ability owner is never boosted by its own ability (the dispatch walks the mover's adjacent allies).",
});
