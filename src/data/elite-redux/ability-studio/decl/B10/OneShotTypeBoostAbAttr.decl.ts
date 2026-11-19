/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / package (Tier C), the power half of a pair with OneShotTypeBoostFollowupAbAttr (Power Outage).
//
// Read by hand from archetypes/one-shot-type-boost-then-lose-type.ts. The class extends MovePowerBoostAbAttr (WHEN "while the
// game calculates a move's power"), constructor `{ type, factor }` kept in the private field `opts`, and hands the parent
// `() => true` and the factor, so the parent's canApply is always true and its multiplier is never used: `apply` is overridden:
//     used flag set on the Pokemon (a Symbol property, shared with the Followup class)  -> nothing
//     pokemon.getMoveType(move) !== opts.type                                          -> nothing
//     else power.value *= opts.factor
// The checks live in `apply`, not in canApply, and the flag is written by the OTHER class (the Followup, after the first move of
// the type has been used), so this class on its own would boost every move of the type for ever. No random draw, no closure.
//
// Why a package: the used flag is memory shared by two classes through a module-private Symbol, and the library has neither a
// shared "spent" memory nor the effect "lose a type" (requests R-B10-19 and R-B10-20 in requests/B10.md). The pair is one rule.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { OneShotTypeBoostAbAttr } from "#data/elite-redux/archetypes/one-shot-type-boost-then-lose-type";
import { PokemonType } from "#enums/pokemon-type";
import { optionEnumCodec, optionNumber } from "./b10-codecs";

export default defineDecl(OneShotTypeBoostAbAttr, {
  tier: "C",
  kind: "package",
  when: "calc.move-power",
  label: "Boost moves of one type until the first one is used",
  summary: params =>
    `Moves of the ${params.type} type get ${params.factor} times their power until the first one has been used. Needs its partner block to mark it used. Example: 2 = double power.`,
  synonyms: [
    "power outage",
    "one time type boost",
    "first move of a type is stronger",
    "single use power boost",
    "boost the first attack of a type",
    "type boost that runs out",
  ],
  examples: ["My first Electric move does double damage, like Power Outage"],
  params: [
    {
      id: "type",
      ctorIndex: 0,
      ctorOption: "type",
      path: "opts",
      control: "select",
      label: "Type of the boosted moves",
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
      label: "Power multiplier (2 = double power)",
      editable: true,
      default: 2,
      codec: optionNumber("factor"),
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The boost stops only after the partner block (lose the type after the first move of that type) has run once: that block marks the boost as used",
    "A move counts as the chosen type after the Pokemon's own type changes are applied to it",
  ],
  effect: { id: "effect.package", params: ["type", "factor"] },
  reusableAlone: { when: true, if: false, do: false },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I use a move of the type, then another one", axes: {} }],
  l2StaticReason:
    "The shared L2 harness cannot show the move-power hook evaluated (decomp-l2-reach.json lists calc.move-power as unreached) and the used flag is written by the second class of the pair. The B10 test (test/tests/elite-redux/decomp/B10/chunk2-one-shot.test.ts) drives apply of the original and the rebuild for the whole pair before and after the first move of the type.",
  status: "decomposed",
  notes:
    "Package, justified (see the header): one mechanic split over two classes that share a Symbol flag on the Pokemon object. Only user: Power Outage (attr 0 here, attr 1 is the Followup), nothing to bind (no ctor closure; the parent's `() => true` is dead because canApply stays the parent's and apply is overridden). Suspected game bugs, NOT fixed: (1) the flag is a Symbol property on the Pokemon object that nothing ever clears, so it survives into later battles although the header comment says once per battle, and the Pokemon never gets the boost again; (2) the type-loss side is on summonData.types, which is cleared at switch-out, so the type comes back but the boost does not; (3) `apply` does not look at `simulated`, so a damage preview also boosts (harmless, it only reads); (4) the move type is read with pokemon.getMoveType, so a -ate style ability that changes the move type also changes whether the boost applies.",
});
