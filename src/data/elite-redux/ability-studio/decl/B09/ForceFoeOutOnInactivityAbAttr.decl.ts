/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
// B09 chunk 3. "A foe that has not attacked for N turns is forced out" (Strikeout).
//
// Source: src/data/elite-redux/archetypes/force-foe-out-on-inactivity.ts, class ForceFoeOutOnInactivityAbAttr (extends
// PostTurnAbAttr). Dispatched at the end of every turn (`applyAbAttrs("PostTurnAbAttr")`).
// Clauses, in order:
//   canApply: `pokemon.getOpponents().some(o => o && !o.isFainted())`    at least one foe is still standing   -> feasibility
//   apply:    1. simulated -> do nothing
//             2. for each standing foe: look at the move-history entries added since the last look (`SEEN_LEN`); a non-NONE
//                move whose category is not STATUS counts as an attack
//             3. an attack resets that foe's idle counter (`IDLE`) to 0; otherwise the counter goes up by one
//             4. when the counter reaches `turns`: reset the counter and the history mark, then
//                `ForceSwitchOutHelper(SwitchType.SWITCH).switchOutLogic(foe)` forces that foe out
// Both counters are stored on the FOE's own object under module-private Symbols, so they belong to the foe, not to the holder.
// Constructor: (turns = 3). No random draw.
//
// Package: counting idle turns per foe is memory that lives between turns and between calls, mixed with the forced switch, so it
// is not split into a condition and an effect. It keeps a typed setting (the number of turns).
import { ForceFoeOutOnInactivityAbAttr } from "#data/elite-redux/archetypes/force-foe-out-on-inactivity";

export default defineDecl(ForceFoeOutOnInactivityAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.end-of-turn",
  label: "Send a foe out if it has not attacked for several turns",
  summary: params =>
    `At the end of each turn I count the turns a foe goes without using a damaging move. After ${params.turns} turns in a row, that foe is forced out and its count starts again.`,
  synonyms: [
    "strikeout",
    "punish passive play",
    "force a foe to switch",
    "stall breaker",
    "kick out idle foe",
    "no attack no stay",
  ],
  examples: ["Force a foe out after 3 turns without an attack, like Strikeout"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "turns",
      control: "number",
      label: "Turns without a damaging move before the foe is sent out (1-10)",
      editable: true,
      integer: true,
      min: 1,
      max: 10,
      step: 1,
      default: 3,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one foe must still be standing",
    "Only damaging moves count as an attack; a status move or doing nothing counts as idle",
    "The foe must be able to be switched out (the same checks as a forced switch)",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.package", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      name: "two quiet turns at full HP and one HP below full",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Package, justified: the class keeps one idle counter and one history mark PER FOE (Symbols on the foe object), advances them on every end of turn and then forces the switch, which is memory plus effect. 1 attr: Strikeout (5614 attr 0, turns 3). The `idleTurns(foe)` helper exists only for tests. Oddities, not fixed: (a) the counters live on the foe's object and are never cleared when that foe leaves the field on its own, so a foe that switches out and back in resumes its old count although the comment says a fresh foe starts clean; (b) the two Symbols are shared by every holder of this class, so two holders in one battle would both advance the same counter each turn (the second sees no new history, counts the turn as idle and adds one more); (c) the attack test looks at move-history entries, so a foe that is asleep or flinched adds no entry and counts as idle. Simulated calls do nothing.",
});
