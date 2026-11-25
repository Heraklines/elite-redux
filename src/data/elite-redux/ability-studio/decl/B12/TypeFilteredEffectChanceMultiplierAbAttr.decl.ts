/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 4. "The extra effects of my moves of one type happen more often" (Corrupted Mind: Psychic moves, x1.4).
//
// Source: src/data/elite-redux/archetypes/type-filtered-effect-chance.ts, TypeFilteredEffectChanceMultiplierAbAttr (extends
// MoveEffectChanceMultiplierAbAttr, the Serene Grace attr). Constructor: `(moveType, chanceMultiplier)`; showAbility is off (the parent's
// `super(false)`). Dispatched while a move's extra-effect chance is calculated (applyAbAttrs("MoveEffectChanceMultiplierAbAttr")).
// Clauses, in the original order (Tier B):
//   canApply 1  `super.canApply`: the chance is above 0 and the move is not Order Up or Electro Shot            GUARD-like (class method `guards`, feasibility text)
//   canApply 2  the move's type AFTER other abilities changed it (`pokemon.getMoveType(move)`) is the type       GATE (replaceable)
//   apply       `chance *= multiplier`, then the chance is capped at 100                                         EFFECT (calc)
// No random draw (the roll happens later, in the move code), no state, no `simulated` test.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { TypeFilteredEffectChanceMultiplierAbAttr } from "#data/elite-redux/archetypes/type-filtered-effect-chance";
import { PokemonType } from "#enums/pokemon-type";

export default defineDecl(TypeFilteredEffectChanceMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.effect-chance",
  label: "Make the extra effects of one move type more likely",
  summary: params =>
    `The chance of the extra effects of my ${params.type} moves is multiplied by ${params.multiplier}, up to 100%. Example: Psychic 1.4, so a 30% chance becomes 42%, like Corrupted Mind.`,
  synonyms: [
    "serene grace for one type",
    "secondary effect chance",
    "side effects more often",
    "flinch chance boost",
    "status chance boost",
    "corrupted mind",
    "more likely extra effects",
  ],
  examples: [
    "Psychic moves have 1.4 times the chance of their extra effects, like Corrupted Mind",
    "Fire moves burn 1.5 times as often",
  ],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "moveType",
      control: "select",
      label: "Move type whose extra effects become more likely",
      editable: true,
      default: "PSYCHIC",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "chanceMultiplier",
      control: "number",
      min: 0.1,
      max: 10,
      step: 0.05,
      label: "Chance multiplier (1.4 = 40% more likely, 2 = twice as likely)",
      editable: true,
      // Only the effect reads it; the gate (the move type) never repeats it.
      gateIndependent: true,
      default: 1.4,
    },
  ],
  // The type setting is the same value as the gate's type: moving the setting moves the compiled gate's type.
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [
    // The gate: the move's type after other abilities changed it is the type (move.type { effective: true }, which needs the move user: R-B12-30).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only moves that have an extra effect (a chance above 0) are changed",
    "Order Up and Electro Shot are never changed",
    "The chance never goes above 100%",
  ],
  // No library effect multiplies the extra-effect chance (R-B12-29), so the effect is a package with a typed number.
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // Moves of the type and of another type; B12's own test also drives the chance holder (zero, small, large).
      name: "psychic and other moves from the shared grid",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier B, 1 attr: Corrupted Mind (5475 attr 1, Psychic x1.4; attr 0 is a type-chart override class that is another block). The old canApply was `super.canApply(params) && getMoveType(move) === moveType`; it is split in that order into `guards` (the parent's: chance above 0, not Order Up or Electro Shot) and `gate` (the type test). The effect is `effect.package` only because no library effect multiplies the extra-effect chance (request R-B12-29, with the clamp at 100); the number and the type are typed params. The gate binding is a legacy-closure until the librarian lets the effect-chance moment read the move's user (request R-B12-30: WHEN_MOVE_USER has no entry for calc.effect-chance, so move.type reads no move user and is always false there). Oddities, not fixed: (a) the multiplied chance is not rounded (the game compares it with a random roll later); (b) the guard `chance <= 0` means a move with a 0 chance, or with no chance at all, is never changed, as with Serene Grace; (c) Sheer Force and Shield Dust act elsewhere; (d) the ability banner is hidden.",
});
