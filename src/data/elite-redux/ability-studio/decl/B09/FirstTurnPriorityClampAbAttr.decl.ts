/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 2. "On my first turn out, my moves go first and slow moves are no longer slow" (On the Prowl, Overwatch).
//
// Source: src/data/elite-redux/archetypes/first-move-priority.ts, class FirstTurnPriorityClampAbAttr (extends
// ChangeMovePriorityAbAttr). Dispatched from Move.getPriority (src/data/moves/move.ts, `applyAbAttrs("ChangeMovePriorityAbAttr")`
// for the USER of the move).
// Clauses of the original canApply: `pokemon.tempSummonData.waveTurnCount === 1`      -> gate (IF), the only clause
// apply: `priority.value = priority.value < 0 ? 0 : priority.value + 1`  (a negative priority becomes 0, anything else gets +1)
// The constructor passes `() => false` and 0 to the parent, so the parent's own rule and amount are dead. No random draw,
// nothing reads `simulated`, no state of its own (waveTurnCount belongs to the engine).
// Tier B: the whole rule is the gate. The gate is the library atom time.first-turn, whose evaluation is
// `holder.tempSummonData.waveTurnCount === 1`, the same expression.
import { FirstTurnPriorityClampAbAttr } from "#data/elite-redux/archetypes/first-move-priority";

export default defineDecl(FirstTurnPriorityClampAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Raise move priority on my first turn and cancel slow moves",
  summary: () =>
    "On my first turn out, my moves get +1 priority. A move that is normally slow (negative priority) just becomes normal priority (0).",
  synonyms: [
    "on the prowl",
    "overwatch",
    "first turn priority",
    "go first on entry",
    "no slow moves on the first turn",
    "negative priority becomes normal",
  ],
  examples: ["Every move gets +1 priority on my first turn and slow moves count as normal speed, like Overwatch"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: the first-turn test, the +1 and the lift of negative priority to 0 are fixed in the class. Staff reach a plain +1 with a composed rule (time.first-turn + effect.change-priority); only the clamp of negative priority has no library effect (R-B09-05).",
  conditions: [{ slot: "gate", ctx: "params", lib: "time.first-turn", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.change-priority", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "my attack against a foe that uses a damaging move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 2 users: On the Prowl (5352 attr 0) and Overwatch (5429 attr 1), both bound to time.first-turn. The effect is not the plain `change priority by N`: a negative priority is set to 0 instead of being raised by 1, so a -1 move ends at 0 and a 0 move at +1. The declared effect id is the closest word (R-B09-05 asks for the clamp). The first turn is `waveTurnCount === 1`, which the engine increments at turn end and decrements on a switch-in that costs the turn; a Pokemon that never gets to act on its first turn loses the bonus. The two classes in this file that share the priority hook (FirstFlagged and this one) are independent: this one reads no memory. Parent ChangeMovePriorityAbAttr (B05) will get its own gate/gateOverride members; at merge this class's gateOverride and gate need the `override` keyword.",
});
