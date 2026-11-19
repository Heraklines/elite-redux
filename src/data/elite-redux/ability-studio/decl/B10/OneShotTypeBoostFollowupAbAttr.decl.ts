/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / package (Tier C), the "lose the type" half of a pair with OneShotTypeBoostAbAttr (Power Outage).
//
// Read by hand from archetypes/one-shot-type-boost-then-lose-type.ts. The class extends PostAttackAbAttr (WHEN "after my attack
// lands"), constructor `{ type, factor }` kept in the private field `opts`, `super(undefined, false)`. The `factor` is never read
// by this class; it is carried so both halves of the pair are built from the same options object.
//     canApply: used flag set on the Pokemon (Symbol property)  -> false
//               otherwise pokemon.getMoveType(move) === opts.type
//               (the parent's damaging-move test is NOT called: the override never calls super.canApply)
//     apply:    simulated -> nothing
//               else set the used flag, remove `type` from the Pokemon's types (summonData.types = the other types; if that would
//               leave none, the types stay as they are) and refresh the info box
// No random draw. Together with OneShotTypeBoostAbAttr this is the whole of Power Outage.
//
// Why a package: the used flag is shared with the power half through a module-private Symbol, and the library has no
// "lose a type" effect and no shared spent memory (requests R-B10-19 and R-B10-20).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { OneShotTypeBoostFollowupAbAttr } from "#data/elite-redux/archetypes/one-shot-type-boost-then-lose-type";
import { PokemonType } from "#enums/pokemon-type";
import { optionEnumCodec, optionNumber } from "./b10-codecs";

export default defineDecl(OneShotTypeBoostFollowupAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.after-my-hit",
  label: "Lose a type after using my first move of that type",
  summary: params =>
    `After my first move of the ${params.type} type, I lose that type (a Pokemon with only that type keeps it). This marks the boost of its partner block as used.`,
  synonyms: [
    "power outage",
    "lose a type after attacking",
    "type removal after use",
    "burn out the type",
    "give up a type",
    "type is spent",
  ],
  examples: ["After my first Electric move I stop being Electric type, like Power Outage"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "opts",
      control: "select",
      label: "Type that is used up and lost",
      editable: true,
      default: "ELECTRIC",
      options: TYPE_OPTIONS,
      codec: optionEnumCodec(PokemonType, "type", "type"),
    },
    {
      id: "factor",
      ctorIndex: 0,
      ctorOption: "factor",
      path: "opts",
      control: "number",
      min: 0.1,
      max: 8,
      step: 0.05,
      label: "Power multiplier of the partner block (not used here, keep both the same)",
      // This half never reads the number; it is kept only so the options object equals the partner's.
      editable: false,
      default: 2,
      codec: optionNumber("factor"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only the first move of the chosen type does this, one time only",
    "A Pokemon whose only type is the chosen one keeps it, but the one-time use is still spent",
    "A preview of the move does nothing",
  ],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: false, do: false },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I use a move of the type, then another one", axes: {} }],
  status: "decomposed",
  notes:
    "Package, justified (see the header and the power half). Only user: Power Outage (attr 1). Nothing to bind: no closure, and the gate is the identity of the mechanic. The override of canApply never calls the parent's damaging-move test, so a STATUS move of the chosen type also counts as the first move and spends the boost: suspected game bug, NOT fixed. The one-time flag is never cleared (see the power half). A Pokemon with a single type of the chosen kind keeps its type but still spends the flag. Own test (the shared L1 grid and L2 twin cannot see it all): test/tests/elite-redux/decomp/B10/chunk2-one-shot.test.ts.",
});
