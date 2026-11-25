/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 3. "My ally's moves of one type are stronger" (Steely Spirit, Airborne, Voltron).
//
// Source: src/data/abilities/ab-attrs.ts UserFieldMoveTypePowerBoostAbAttr (extends PreAttackFieldMoveTypePowerBoostAbAttr extends
// FieldMovePowerBoostAbAttr; no body of its own). Dispatched from Move.calculateBattlePower (src/data/moves/move.ts:1379):
// `for (const p of source.getAdjacentAllies()) applyAbAttrs("UserFieldMoveTypePowerBoostAbAttr", { pokemon: p, opponent: target, move, simulated, power })`,
// skipped when the move user's ability is ignored. `pokemon` is the ABILITY OWNER (an adjacent ally of the move user), so the
// holder of the frame is the one who has the ability and the move user is its ally.
// Clauses, in order:
//   canApply: always true (the class comment says the logic lives in move.ts)                         -> nothing
//   apply:    `if (condition(pokemon, opponent, move)) power.value *= powerMultiplier`, with the closure
//             `pokemon?.getMoveType(move) === boostedType` asked about the OWNER (an ally's type-changing ability can decide) -> the `type` setting
// Constructor (parent): (boostedType, powerMultiplier?) = `powerMultiplier || 1.5`. 
// The class is not touched: the live value is read back by asking the closure (boosted-codecs.ts), because a new instance field would change the configuration snapshot that the frozen fingerprints of the saved abilities guard.
// No random draw, no state. Tier A.
import { UserFieldMoveTypePowerBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { boostedTypeCodec } from "#data/elite-redux/ability-studio/decl/B02/boosted-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";

export default defineDecl(UserFieldMoveTypePowerBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Multiply one move type's power for my ally",
  summary: params =>
    `The ${params.type}-type moves of the Pokemon next to me have their base power multiplied by ${params.multiplier}. Example: Steel at 1.3 = 30% stronger Steel moves for my ally, like Steely Spirit.`,
  synonyms: ["steely spirit", "ally boost", "partner boost", "boost my ally's moves", "team type boost", "doubles support"],
  examples: ["Make my ally's Steel moves 30% stronger, like Steely Spirit", "Make my ally's Flying moves 30% stronger, like Airborne"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      path: "condition",
      control: "select",
      label: "Move type that is boosted",
      editable: true,
      default: "STEEL",
      options: TYPE_OPTIONS,
      codec: boostedTypeCodec,
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
    "The shared twin battle is a singles fight, and this class is only dispatched for the adjacent ALLIES of the move user, so the original is never evaluated there. B02/power-boost.test.ts drives the original and the rebuilt attr of every user through the same apply call and compares the power.",
  probes: [{ name: "my ally attacks with a move of the boosted type", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 3 attrs (Steely Spirit attr 0, Airborne attr 0, Voltron id 5958 attr 0). Nothing to bind: the constructor takes the type, not a closure. Suspected game bug (not fixed): the dispatch walks `source.getAdjacentAllies()` and passes each ally as the holder, so the owner's OWN moves are never boosted, although the ability descriptions of Steely Spirit and Airborne speak of 'itself and its allies'; and the type test `pokemon.getMoveType(move)` is asked about the ally holder, not about the move user, so an ally with a type-changing ability (Aerilate) decides the type for the user's move.",
});
