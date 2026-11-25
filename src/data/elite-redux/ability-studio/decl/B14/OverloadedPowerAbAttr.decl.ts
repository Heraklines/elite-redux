/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. Tier B calc-modifier. "While the game calculates a move's power, if I am at the maximum number of charge stacks and
// the move is Electric, multiply the power" (Overloaded: +25%).
//
// Source: electivire.ts OverloadedPowerAbAttr (extends VariableMovePowerAbAttr, dispatched as the move-power hook). canApply,
// original clause order, is now `guards && gate` with no guard and no residual (the whole original is the gate):
//   gate  1. `getCharge(pokemon) === CHARGE_STACK_MAX`                         I hold exactly 4 stacks     (no atom: R-B14-6.2)
//         2. `pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "OverloadedChipAbAttr")`
//                                                                              I carry the Overloaded chip attr, an active, unsuppressed
//                                                                              ability with that attr (the marker `overloadedActive`
//                                                                              also reads; no atom: R-B14-6.10)
//         3. `pokemon.getMoveType(move) === PokemonType.ELECTRIC`              the move is Electric after ability changes
//                                                                              (library: move.type { ELECTRIC, effective: true })
// (clauses 1 and 2 are the module function `overloadedActive`.) apply: `power.value *= OVERLOADED_POWER_MULTIPLIER` (1.25), now
// `this.powerMultiplier`. Nothing is random, nothing is remembered, nothing reads `simulated`. The class never called super.canApply
// (the parent only reads `skipDuringMovesetGen`, which is false), and still does not.
// The gate binding is LEGACY because clauses 1 and 2 have no atom. Planned tree (clause order kept; every atom is a pure read):
//   all[ mon.charge-stacks { holder, cmp "=", n 4 }, mon.has-active-attr { holder, "OverloadedChipAbAttr" },
//        move.type { ELECTRIC, effective true } ]
// Class edit (pure move of code): the 1.25 is a constructor argument with the old value as default.
import { OverloadedPowerAbAttr } from "#data/elite-redux/abilities/electivire";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(OverloadedPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost Electric move power at full charge",
  summary: params =>
    `While I hold the maximum of 4 charge stacks, my Electric moves have their power multiplied by ${params.multiplier}. Example: 1.25 = 25% more power.`,
  synonyms: [
    "overloaded",
    "full charge bonus",
    "electric power at max stacks",
    "overcharge boost",
    "charged up damage",
    "stronger electric moves",
    "max stacks power",
  ],
  examples: ["While I am fully charged my Electric moves hit 25% harder, like Overloaded"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.25 = 25% more, 0.5 = half)",
      editable: true,
      default: 1.25,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [I hold the maximum stacks, I carry the Overloaded marker, the move is Electric] (bindings.ts, legacy until R-B14-6.2
    // and R-B14-6.10). Removable: "boost every Electric move" and "boost every move at full charge" are valid designs.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "I attack with an Electric and a non-Electric move", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom reads the charge stacks or the Overloaded marker yet), so the twin has no rebuilt attr to compare; B14/chunk6.test.ts proves the Tier B split against a literal copy of the original canApply over every state of its clauses.",
  status: "decomposed",
  notes:
    "Tier B calc-modifier, effect = the library multiply-power. Users (1): Overloaded (5927) attr 0 (attr 1 is OverloadedPriorityAbAttr, attr 2 OverloadedChipAbAttr, both declared in the next chunk; they share the `overloadedActive` rule). The gate is a legacy binding: `mon.charge-stacks` (R-B14-6.2) and `mon.has-active-attr` (R-B14-6.10) are requested with the exact formulas; the third clause maps to move.type with effective true (`getMoveType`). The maximum of 4 stacks is a module constant of the charge store, so the gate's number is not a setting yet (the planned atom takes it as `n`). Oddities, not fixed: (1) the marker test (clause 2) is by attr class NAME, so a rebuilt rule that is not the Overloaded ability would never pass unless the atom or the marker is also present; (2) the hook runs on every power calculation including previews, because the class ignores `simulated` (it only reads state); (3) the class also asks for exactly 4 stacks (`===`), not 'at least', which is the same only because the store clamps at 4.",
});
