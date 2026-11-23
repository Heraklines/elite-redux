/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Porous, part 4 of 4 (Tier B, package effect). "My Ground move gains 25% power per stored charge, then the charges are spent."
//
// Source: abilities/newcomer-signature-mechanics.ts, PorousPowerAbAttr (MovePowerBoostAbAttr, constructor takes NO
// arguments and hands the base class a hidden closure and the multiplier 1, which the class's own apply ignores).
//   closure (the original canApply), two clauses in this order:
//     1. holder.getMoveType(move) === GROUND          -> library atom move.type {GROUND}        = the gate
//     2. POROUS[holder].stacks > 0                    -> private memory, no atom: stays in the class = the residual
//   apply (overridden, NOT the base class's):
//     power *= 1 + 0.25 * stacks                      (always, also when simulated)
//     not simulated: stacks = 0 and a message         (the charges are spent)
// No RNG. A "ctor:0" slot is impossible (arity 0), so this is Tier B with the original clause order kept:
// `gate` (move type) first, `residual` (has a charge) second.
import { PorousPowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PorousPowerAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.move-power",
  label: "Spend impact charges to boost my Ground moves",
  summary: () =>
    "My Ground move gains 25% power per stored charge (up to +75% with 3) and all charges are spent. Example: 2 charges turn 100 power into 150.",
  synonyms: [
    "release stored power",
    "ground boost",
    "spend stacks",
    "stored charge bonus",
    "earthquake boost",
    "porous",
  ],
  examples: ["My next Ground move is 25% stronger for every charge I stored"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the 25% per charge, the 'Ground only' test and the spending of all charges are fixed in its code.",
  conditions: [
    // Clause 1 of the original closure: the move is Ground (library atom). Clause 2 is the class's residual.
    { slot: "gate", ctx: "params", lib: "move.type", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["I must have at least one stored impact charge (a private counter, checked inside the class)"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json). The twin still shows the original evaluating this attr when a damaging move is used, and B13/porous.test.ts drives the charge, spend and reset flow.",
  probes: [
    {
      // Attacks of different types; the charge counter is empty in the grid, so the residual decides it.
      name: "moves of different types with no stored charge",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (move power) and the move-type condition are separate and bound to a library atom. Justified: the multiplier is derived from a private counter (1 + 0.25 x charges, not a constant the multiply-power block can hold) and the same effect spends the counter and queues a message; splitting would re-implement the counter. The library has no 'multiply by an amount per stored charge' effect, no 'stored charges' condition and no 'spend charges' effect (requested in requests/B13.md). The 'has a charge' clause stays in the class as the residual (listed under 'also requires') and keeps its original second position. Users: Porous (5974, attr 3). ODDITIES (not fixed): (1) apply multiplies power even when simulated but only spends the charges when not simulated (correct for a preview); (2) the base class's multiplier argument (1) is dead because apply is overridden; (3) the boost is computed from the counter AT the time the power is calculated, so a power calculation that is not followed by the real move (a preview that is not marked simulated) would spend charges early.",
});
