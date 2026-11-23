/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { IncomingAccuracyMultiplierAbAttr } from "#data/elite-redux/archetypes/incoming-accuracy-multiplier";

// B09 chunk 4. "Moves aimed at me are less accurate" (Bad Luck: foes' moves are 5% less accurate; Scarecrow).
//
// Source: src/data/elite-redux/archetypes/incoming-accuracy-multiplier.ts, class IncomingAccuracyMultiplierAbAttr (extends
// WonderSkinAbAttr, which extends PreDefendAbAttr, ab-attrs.ts:683). Dispatched while the game calculates the accuracy of a move
// aimed at the holder (`applyAbAttrs("WonderSkinAbAttr", { pokemon: target, opponent: user, move, accuracy })`, move.ts:1239); a
// subclass is reached through the same call because applyAbAttrs matches by instanceof.
// Clauses of the overridden canApply, in order:
//   1. `accuracy.value < 0`  -> false. -1 is the "never misses" marker (the class comment), so such moves are left alone.  -> built in
//   2. `singleTargetOnly && SPREAD_TARGETS.has(move.moveTarget)` -> false (moves that hit several targets keep normal accuracy)
//                                                                                                      -> a setting the class reads
// apply: `accuracy.value *= multiplier`. No random draw, nothing reads `simulated`, no state.
// Constructor: ({ multiplier, singleTargetOnly }), one options object; throws unless multiplier > 0. The parent's constructor
// takes nothing.
// Tier A: both clauses are the class's own fields (no closure, nothing in canApply that a library condition could replace
// without changing the rule), so both are settings. A staff member who wants "only when the move is a certain kind" ANDs a
// library condition on top.
export default defineDecl(IncomingAccuracyMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.incoming-accuracy",
  label: "Make moves aimed at me less accurate",
  summary: params =>
    `The accuracy of moves aimed at me is multiplied by ${params.multiplier}. Example: 0.95 = 5% less accurate. Moves that never miss are not changed${params.singleTargetOnly ? ", and moves that hit several targets keep their accuracy" : ""}.`,
  synonyms: [
    "bad luck",
    "scarecrow",
    "evasion",
    "dodge more",
    "foes miss more",
    "lower the accuracy of attacks against me",
    "accuracy debuff",
  ],
  examples: [
    "Foes' moves are 5% less accurate against me, like Bad Luck",
    "Single-target moves aimed at me are 20% less accurate",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "multiplier",
      control: "number",
      label: "Accuracy multiplier for moves aimed at me (0.95 = 5% less accurate, 0.8 = 20% less)",
      editable: true,
      min: 0.05,
      max: 2,
      step: 0.05,
      default: 0.95,
    },
    {
      id: "singleTargetOnly",
      ctorIndex: 0,
      ctorOption: "singleTargetOnly",
      path: "singleTargetOnly",
      control: "boolean",
      label: "Only moves with a single target are affected (yes or no)",
      editable: true,
      default: false,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Moves that never miss are not changed",
    "Moves that hit several targets or a whole side count as spread moves for the single-target setting",
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "an ordinary attack, a water attack and a status move aimed at the holder (the foe's accuracy is read from the move)",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "THUNDER_WAVE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A calc-modifier, 2 attrs: Bad Luck (5072 attr 2) and Scarecrow (5522 attr 3), both 0.95 with singleTargetOnly false. Nothing is bound. The library has no 'multiply accuracy' effect, so the declaration names none (request R-B09-31); the block itself is the effect. The archetype comment names Ol (608) as a user of singleTargetOnly, but no ability in the game builds it with true, so that branch is reachable only from a staff rule; the harness checks it by constructing the class directly (B09/chunk4.test.ts). Oddities, not fixed: (a) the class replaces Wonder Skin's status-move rule completely, so a holder that has both abilities applies each attr separately in ability order; (b) a multiplier above 1 raises the accuracy of incoming moves (allowed up to 2, nobody uses it).",
});
