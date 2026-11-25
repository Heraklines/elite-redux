/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / calc-modifier (Tier B), the power half of a pair with OneShotTypeBoostFollowupAbAttr (Power Outage).
//
// Read by hand from archetypes/one-shot-type-boost-then-lose-type.ts. The class extends MovePowerBoostAbAttr (WHEN "while the
// game calculates a move's power"), constructor `{ type, factor }` kept in the private field `opts`, and hands the parent
// `() => true`. The old `apply` did two tests and then the multiplication; they are now the Tier B split of `canApply`
// (a pure move of code, the parent's canApply was always true), in the old order:
//   guards   1. the one-time flag on the Pokemon (a Symbol property written by the OTHER class, the follow-up half) is not set
//   gate     2. pokemon.getMoveType(move) === opts.type          the move is of the chosen type (after ability changes)
//   apply    power.value *= opts.factor
// No random draw, no closure, nothing to prepare, no residual.
//
// Clause classification: "the move is of type T" is a rule staff would change (any Fire move, any Water move), so it is the
// replaceable gate and Power Outage's binding spells it with the library atom move.type. "The boost is not used up yet" is the
// identity of the one-shot: it reads a flag the follow-up half writes through a module-private Symbol, and the library has no
// shared "spent" memory (request R-B10-19), so it stays a guard inside the class. The follow-up half is the other block of the pair.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { OneShotTypeBoostAbAttr } from "#data/elite-redux/archetypes/one-shot-type-boost-then-lose-type";
import { PokemonType } from "#enums/pokemon-type";
import { optionEnumCodec, optionNumber } from "./b10-codecs";

export default defineDecl(OneShotTypeBoostAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost moves of one type until the first one is used",
  summary: params =>
    `Moves of the ${params.type} type get ${params.multiplier} times their power until the first one has been used (the condition can be changed). Needs its partner block to mark it used. Example: 2 = double power.`,
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
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "factor",
      path: "opts",
      control: "number",
      min: 0.1,
      max: 8,
      step: 0.05,
      label: "Power multiplier (2 = double power)",
      editable: true,
      // The multiplier is read only by apply; the gate never repeats it.
      gateIndependent: true,
      default: 2,
      codec: optionNumber("factor"),
    },
  ],
  // The type setting is also written into the gate's move.type atom, so a moved setting moves the compiled gate.
  gateParams: [{ param: "type", block: "move.type", field: "type" }],
  conditions: [
    // The gate: the move is of the chosen type (bindings.ts, one library atom).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The boost stops only after the partner block (lose the type after the first move of that type) has run once: that block marks the boost as used",
    "A move counts as the chosen type after the Pokemon's own type changes are applied to it",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "I use a move of the type, then another one", axes: {} }],
  l2StaticReason:
    "The shared L2 harness cannot show the move-power hook evaluated (decomp-l2-reach.json lists calc.move-power as unreached) and the used flag is written by the second class of the pair. The B10 test (test/tests/elite-redux/decomp/B10/chunk2-one-shot.test.ts) drives canApply and apply of the original and the rebuild for the whole pair before and after the first move of the type.",
  status: "decomposed",
  notes:
    "Tier B split by hand: the old `apply` tested the flag, then the move type, then multiplied; those tests are now guards (flag) then gate (type), same order, no side effect in either, and the parent's canApply was always true, so nothing observable moved. The type test is now a plain IF (library atom move.type, effective type) that staff can swap, for example for any Fire move or a category test. The multiplication is the library effect effect.multiply-power. What stays in the class and why: only the 'boost not used up yet' guard, because the flag is a module-private Symbol written by the partner class (OneShotTypeBoostFollowupAbAttr) and the library has no shared spent flag (request R-B10-19). Without the partner block the flag is never set and every move of the type stays boosted. Only user: Power Outage (attr 0, attr 1 is the follow-up). The param was renamed from factor to multiplier so it matches the effect. Suspected game bugs, NOT fixed: (1) the flag is a Symbol property on the Pokemon object that nothing ever clears, so it survives into later battles although the header comment says once per battle, and the Pokemon never gets the boost again; (2) the type-loss side is on summonData.types, which is cleared at switch-out, so the type comes back but the boost does not; (3) the old apply did not look at `simulated`, and canApply does not either, so a damage preview also boosts (harmless, it only reads); (4) the move type is read with pokemon.getMoveType, so a -ate style ability that changes the move type also changes whether the boost applies (the move.type atom has the same effective-type setting, on). Own test: test/tests/elite-redux/decomp/B10/chunk2-one-shot.test.ts.",
});
