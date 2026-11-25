/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier B), the "lose the type" half of a pair with OneShotTypeBoostAbAttr (Power Outage).
//
// Read by hand from archetypes/one-shot-type-boost-then-lose-type.ts. The class extends PostAttackAbAttr (WHEN "after my attack
// lands"), constructor `{ type, factor }` kept in the private field `opts`, `super(undefined, false)`. The `factor` is never read
// by this class; it is carried so both halves of the pair are built from the same options object. canApply is now:
//   guards   1. the one-time flag on the Pokemon (Symbol property) is not set
//   gate     2. pokemon.getMoveType(move) === opts.type          the move is of the chosen type (after ability changes)
//   (no prepare, no residual; the parent's damaging-move test is NOT called: the override never calls super.canApply)
//   apply    simulated -> nothing
//            else set the used flag, remove `type` from the Pokemon's types (summonData.types = the other types; if that would
//            leave none, the types stay as they are) and refresh the info box
// No random draw. Together with OneShotTypeBoostAbAttr this is the whole of Power Outage.
//
// Clause classification: "the move is of type T" is a rule staff would change (the first Water move, the first move of any
// type), so it is the replaceable gate and the binding spells it with the library atom move.type. The one-time flag is the guard and
// stays in the class: its memory is the module-private Symbol the power half reads too, and the library has no shared spent flag
// (request R-B10-19). "Lose a type" and "set the flag" are one piece in apply: the library has no such effect (request R-B10-20),
// so the effect stays the class's apply (effect.package).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { OneShotTypeBoostFollowupAbAttr } from "#data/elite-redux/archetypes/one-shot-type-boost-then-lose-type";
import { PokemonType } from "#enums/pokemon-type";
import { optionEnumCodec, optionNumber } from "./b10-codecs";

export default defineDecl(OneShotTypeBoostFollowupAbAttr, {
  tier: "B",
  kind: "event-effect",
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
  // The type setting is also written into the gate's move.type atom, so a moved setting moves the compiled gate.
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [
    // The gate: the move I just used is of the chosen type (bindings.ts, one library atom).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only the first move of the chosen type does this, one time only",
    "A Pokemon whose only type is the chosen one keeps it, but the one-time use is still spent",
    "A preview of the move does nothing",
  ],
  effect: { id: "effect.package", params: ["type"] },
  reusableAlone: { when: true, if: true, do: false },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I use a move of the type, then another one", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B split by hand: the old canApply tested the flag, then the move type; those are now guards (flag) then gate (type), same order, no side effect in either. The type test is a plain IF bound with the library atom move.type (effective type), so staff can recombine it, for example 'after any Fire move'. What stays in the class and why: (1) the 'boost not used up yet' guard, because the flag is a module-private Symbol shared with the power half and the library has no shared spent flag (R-B10-19); (2) the effect, because 'remove one type and mark the one-time boost as used' has no library effect (R-B10-20), so it is effect.package. Only user: Power Outage (attr 1). The override of canApply never calls the parent's damaging-move test, so a STATUS move of the chosen type also counts as the first move and spends the boost: suspected game bug, NOT fixed. The one-time flag is never cleared (see the power half). A Pokemon with a single type of the chosen kind keeps its type but still spends the flag. Own test (the shared L1 grid and L2 twin cannot see it all): test/tests/elite-redux/decomp/B10/chunk2-one-shot.test.ts.",
});
