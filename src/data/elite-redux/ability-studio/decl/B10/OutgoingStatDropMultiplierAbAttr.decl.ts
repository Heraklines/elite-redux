/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 / event-effect (Tier C).
//
// Read by hand from archetypes/outgoing-stat-drop-multiplier.ts. The class extends PostAttackAbAttr (WHEN "after my attack
// lands"), constructor `{ factor }` (throws unless factor > 1), `super(undefined, false)`, kept in the private field `factor`.
//     canApply: the move has at least one StatStageChangeAttr that lowers (stages < 0) and does not aim at the user (!selfTarget)
//               (the override never calls super.canApply, so the parent's damaging-move test is NOT used)
//     apply:    simulated, no target or a fainted target -> nothing
//               else for each such attr: extra = floor(attr.stages * (factor - 1)); when extra < 0, queue one StatStageChangePhase
//               on the target with that attr's stats and `extra` stages (unshifted, so it runs right after the move)
// No random draw, no closure.
//
// Why Tier C: the condition ("my move already lowers a stat of its target") and the effect (make that same drop bigger) read the
// same list of the move's own stat attrs, so they cannot be split without the library knowing about a move's stat drops
// (request R-B10-21: condition "the move lowers the target's stats", effect "repeat the move's own stat drops"). Extra IFs
// can still be ANDed on top.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { OutgoingStatDropMultiplierAbAttr } from "#data/elite-redux/archetypes/outgoing-stat-drop-multiplier";

export default defineDecl(OutgoingStatDropMultiplierAbAttr, {
  tier: "C",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Make the stat drops of my moves stronger",
  summary: params =>
    `When my move lowers a stat of its target, the drop is made ${params.factor} times as big with extra stages right after the move. Example: 2 = double, so -1 becomes -2.`,
  synonyms: [
    "subdue",
    "double stat drops",
    "stronger stat lowering",
    "debuff amplifier",
    "bigger stat drops",
    "extra drops on foes",
  ],
  examples: ["Stat-lowering moves I use drop the target's stats twice as much, like Subdue"],
  params: [
    {
      id: "factor",
      ctorIndex: 0,
      ctorOption: "factor",
      path: "factor",
      control: "number",
      min: 1.1,
      max: 6,
      step: 0.1,
      label: "How many times bigger the drops are (2 = double, must be above 1)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only works when the move I used lowers a stat of its target (a drop on myself does not count)",
    "The target must still be standing, and nothing happens in a preview",
    "The extra stages are whole stages, rounded away from zero: a factor of 1.5 on a drop of 1 adds 1 extra stage",
    "The extra drop is a normal stat change, so effects that block stat drops (like Clear Body) still stop it",
  ],
  effect: { id: "effect.package", params: ["factor"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "I use a move that lowers a stat, and one that does not", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C, justified (see the header). Only user: Subdue (factor 2), nothing to bind. Oddities, NOT fixed: extra = Math.floor(stages * (factor - 1)) rounds a negative number DOWN (away from zero), so any factor above 1 adds at least one stage per drop; the extra phase is queued whenever the move HAS such a stat attr, without checking that the move's own drop really landed (a drop that was blocked or that failed a secondary-effect roll still gets its extra phase, which the usual stat-drop blockers can still stop); `showAbility` is false so no banner shows. The parent's attackCondition (damaging move) exists but is never consulted because canApply does not call super. Own test (the shared L1 grid and L2 twin cannot see it all): test/tests/elite-redux/decomp/B10/chunk2-effects.test.ts.",
});
