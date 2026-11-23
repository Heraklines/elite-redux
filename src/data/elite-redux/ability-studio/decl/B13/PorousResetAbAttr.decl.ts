/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Porous, part 1 of 4 (Tier C, package). "When I enter, forget my stored impact charges."
//
// Source: abilities/newcomer-signature-mechanics.ts, PorousResetAbAttr (PostSummonAbAttr).
//   canApply  the base class's (always true): no condition at all.
//   apply     POROUS.set(holder, { stacks: 0, lastMoveRecord: undefined })   (one assignment; ignores `simulated`)
// No RNG, no constructor arguments, no condition. The effect is pure bookkeeping on the private counter that
// PorousChargeAbAttr fills and PorousPowerAbAttr spends.
import { PorousResetAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PorousResetAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Clear my stored impact charges when I enter",
  summary: () =>
    "When I enter the battle, any impact charges I had stored are lost and my counter starts again from 0.",
  synonyms: [
    "reset charges",
    "reset counter",
    "forget stored power",
    "clear stacks",
    "fresh start on switch in",
    "porous",
  ],
  examples: ["Start every switch-in with no stored impact charges"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments and no number: it resets one private counter to zero. There is nothing to tune.",
  conditions: [],
  guards: [],
  feasibility: [],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  probes: [{ name: "entry as the first Pokemon of the battle", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect is the reset of a private per-Pokemon record (stacks and the last counted foe move) that only the Porous attrs read; the library has no 'charge counter' memory block to express a reset of (requested as `effect.reset-charges` together with the counter in requests/B13.md). It is a single assignment, so there is nothing further to split. The trigger is a normal switch-in WHEN and the class has no condition. Users: Porous (5974, attr 0). ODDITY (not fixed): apply ignores `simulated`, so a simulated PostSummon call would reset the counter; no engine path simulates PostSummon today.",
});
