/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 7. Tier A calc-modifier. "While the game calculates my move's priority, if I am at the maximum number of charge stacks and
// the move is Electric, add to its priority" (Overloaded: +1).
//
// Source: electivire.ts OverloadedPriorityAbAttr (extends ChangeMovePriorityAbAttr, ab-attrs.ts, dispatched as calc.priority). The
// parent's `canApply` is `this.moveFunc(pokemon, move)` and its `apply` is `priority.value += changeAmount`; this class overrides
// neither. The only clause is the constructor closure (argument 0), in the original order:
//   1. `getCharge(pokemon) === CHARGE_STACK_MAX`                       I hold exactly 4 stacks     (no atom: R-B14-6.2)
//   2. `pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "OverloadedChipAbAttr")`
//                                                                      I carry the Overloaded chip attr (no atom: R-B14-6.10)
//   3. `pokemon.getMoveType(move) === PokemonType.ELECTRIC`            the move is Electric after ability changes
//                                                                      (library: move.type { ELECTRIC, effective: true })
// (clauses 1 and 2 are the module function `overloadedActive`; the closure is now the exported `overloadedPriorityCondition`.)
// Argument 1 is the amount (`OVERLOADED_PRIORITY_BONUS`, 1). Nothing is random, nothing is remembered, nothing reads `simulated`.
// The closure binding is LEGACY because clauses 1 and 2 have no atom. Planned tree (clause order kept, every atom is a pure read):
//   all[ mon.charge-stacks { holder, cmp "=", n 4 }, mon.has-active-attr { holder, "OverloadedChipAbAttr" },
//        move.type { ELECTRIC, effective true } ]
// Class edit (pure move of code): the two literals became constructor arguments `(moveFunc = overloadedPriorityCondition,
// changeAmount = 1)`; the parent receives exactly the old closure and amount.
import { OverloadedPriorityAbAttr } from "#data/elite-redux/abilities/electivire";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(OverloadedPriorityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Move first with Electric moves at full charge",
  summary: params =>
    `While I hold the maximum of 4 charge stacks, my Electric moves get ${params.amount} extra priority. Example: 1 = Electric moves go before normal moves.`,
  synonyms: [
    "overloaded",
    "full charge priority",
    "electric priority at max stacks",
    "go first when charged",
    "gale wings",
    "quick electric moves",
    "max stacks speed",
  ],
  examples: ["While I am fully charged my Electric moves get +1 priority, like Overloaded"],
  params: [
    {
      id: "amount",
      ctorIndex: 1,
      path: "changeAmount",
      control: "number",
      min: -7,
      max: 7,
      step: 1,
      integer: true,
      label: "Priority change (1 = goes before normal moves, -1 = goes after)",
      editable: true,
      default: 1,
      // Only the effect reads it; the closure never repeats it.
      gateIndependent: true,
    },
  ],
  conditions: [
    // Closure = [I hold the maximum stacks, I carry the Overloaded marker, the move is Electric] (bindings.ts, legacy until R-B14-6.2
    // and R-B14-6.10). Removable: "every move gets the priority" and "any move at full charge" are valid designs.
    { slot: "ctor:0", ctx: "attack", path: "moveFunc", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.change-priority", params: ["amount"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "I attack with an Electric and a non-Electric move", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The condition binding is a legacy closure (no atom reads the charge stacks or the Overloaded marker yet), so the twin has no rebuilt attr to compare; B14/chunk7.test.ts compares the closure with a literal copy of the original over every state of its clauses and with the tree planned for the library.",
  status: "decomposed",
  notes:
    "Tier A calc-modifier, effect = the library change-priority. Users (1): Overloaded (5927) attr 1 (attr 0 is OverloadedPowerAbAttr, attr 2 OverloadedChipAbAttr). The closure is the same rule as the power half's gate (the shared `overloadedActive` plus an Electric move). The closure binding is legacy: mon.charge-stacks (R-B14-6.2) and mon.has-active-attr (R-B14-6.10) are requested with the exact formulas, the third clause is move.type with effective true. The 4 stacks are a module constant of the charge store, so the number is not a setting yet. Oddities, not fixed: (1) the marker test is by attr class NAME, so a rebuilt rule that is not the Overloaded ability never passes unless the atom or the marker is also present; (2) the check asks for exactly 4 stacks, not 'at least' (same only because the store clamps at 4); (3) the parent class never looks at `simulated`, so previews of the turn order also see the bonus (they should, the order depends on it).",
});
