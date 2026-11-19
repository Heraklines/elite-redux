/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / calc-modifier (Tier C).
//
// Read by hand from archetypes/se-priority-bonus.ts and ChangeMovePriorityAbAttr in ab-attrs.ts. WHEN "while the game
// calculates my move's priority". The constructor takes `{ priority }` and passes the parent the closure below plus
// `options.priority` as `changeAmount`; the closure is NOT a constructor argument, so there is nothing to bind.
//   canApply (the parent's): `moveFunc(pokemon, move)`, where moveFunc is
//     `opp = user.getOpponents()?.[0]; if (!opp || !move) false; try { opp.getMoveEffectiveness(user, move) >= 2 } catch { false }`
//   apply (the parent's): `priority.value += changeAmount`.
// The condition ("the move is super effective against the first foe") is fixed in the class, with its two safety nets (no foe,
// effectiveness throws). No random draw.
//
// Why Tier C: the closure is built in the constructor, so the condition cannot be swapped from outside, and the library atom
// move.effectiveness judges the REAL target of the move while this closure judges the FIRST opponent (request R-B11-08 in
// requests/B11.md). Binding them would not be the same predicate in doubles.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SePriorityBonusAbAttr } from "#data/elite-redux/archetypes/se-priority-bonus";

export default defineDecl(SePriorityBonusAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Move first with super effective moves",
  summary: params =>
    `My super effective moves get ${params.priority} extra priority, so they usually go before slower or ordinary moves. Example: +1 = like a Quick Attack.`,
  synonyms: [
    "overzealous",
    "super effective priority",
    "go first when strong",
    "type advantage speed",
    "priority boost",
    "quick attack",
  ],
  examples: ["Super effective moves have +1 priority"],
  params: [
    {
      id: "priority",
      ctorIndex: 0,
      ctorOption: "priority",
      path: "changeAmount",
      control: "number",
      min: -7,
      max: 7,
      step: 1,
      integer: true,
      label: "Priority change (1 = goes a step earlier, -1 = a step later)",
      editable: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only when the move is super effective (2x or more) against the first Pokemon on the other side",
    "With no foe to judge, or when the game cannot work out the matchup, there is no bonus",
  ],
  effect: { id: "effect.change-priority", params: ["priority"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    { name: "a super effective move, a neutral one and a resisted one", axes: { foeMove: ["TACKLE", "WATER_GUN"] } },
  ],
  status: "decomposed",
  notes:
    "Tier C, justified in the header. Only user: Overzealous (828), `{ priority: 1 }`. Nothing to bind. Edge, NOT fixed (the class comment says so too): in doubles only `getOpponents()[0]` is tested, not the target the move will really hit, so a move that is super effective against the second foe only gets no bonus.",
});
