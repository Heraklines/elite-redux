/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Anneal, part 1 of 2 (Tier C, package). "When I enter, forget how many boosts I have gained."
//
// Source: abilities/newcomer-signature-mechanics.ts, AnnealResetAbAttr (PostSummonAbAttr).
//   canApply  the base class's (always true): no condition at all.
//   apply     ANNEAL.set(holder, { gained: 0, lastMoveRecord: undefined })   (one assignment; ignores `simulated`)
// No RNG, no constructor arguments, no condition. The effect is pure bookkeeping on the private counter that
// AnnealAbAttr fills (at most N boosts per switch-in, one per foe move).
import { AnnealResetAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AnnealResetAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Forget my gained boosts when I enter",
  summary: () =>
    "When I enter the battle, the count of boosts I gained from resisted hits is set back to 0, so I can gain them again.",
  synonyms: ["reset boost counter", "fresh start on switch in", "forget stacks", "clear counter", "anneal"],
  examples: ["Start every switch-in with my boost allowance refilled"],
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
    "PACKAGE, justified: the effect is the reset of a private per-Pokemon record (the raise count and the last counted foe move) that only AnnealAbAttr reads; the library has no 'counter' memory block to express a reset of (requested as `effect.reset-memory`, R-B13-23, the generalised R-B13-9 effect.reset-charges, in requests/B13.md). It is a single assignment, so there is nothing further to split. The trigger is a normal switch-in WHEN and the class has no condition. Users: Anneal (5979, attr 0). ODDITY (not fixed): apply ignores `simulated`, so a simulated PostSummon call would reset the counter; no engine path simulates PostSummon today.",
});
