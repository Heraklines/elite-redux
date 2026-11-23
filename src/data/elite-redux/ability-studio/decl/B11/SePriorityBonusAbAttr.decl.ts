/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 3 / calc-modifier (Tier A: "which moves get the bonus" is a constructor closure).
//
// Read by hand from archetypes/se-priority-bonus.ts and ChangeMovePriorityAbAttr in ab-attrs.ts. WHEN "while the game
// calculates my move's priority". The constructor takes `(options = { priority }, condition = superEffectiveAgainstTarget)`.
//   canApply (the parent's): `moveFunc(holder, move)`, where moveFunc is the wrapper built in the constructor:
//     `opp = holder.getOpponents()?.[0]; if (!opp || !move) false; try { condition(holder, opp, move) } catch { false }`
//     and the default condition is `opp.getMoveEffectiveness(holder, move) >= 2`.
//   apply (the parent's): `priority.value += changeAmount`.
// The foe is always the FIRST opposing Pokemon (the engine does not pass a target to the priority check). That choice and the two
// safety nets (no foe; the matchup call throws) stay in the class; the rule "the move is super effective against it" is the
// condition block (slot ctor:1), which gets that Pokemon as the target. No random draw.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { SePriorityBonusAbAttr } from "#data/elite-redux/archetypes/se-priority-bonus";

export default defineDecl(SePriorityBonusAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.priority",
  label: "Give my moves extra priority (go first)",
  summary: params =>
    `My moves that pass the condition get ${params.priority} extra priority, so they usually go before slower or ordinary moves (the shipped one: super effective moves). Example: +1 = like a Quick Attack.`,
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
  conditions: [
    // Overzealous: "the move is super effective (2x or more) against the first foe" = move.effectiveness { gte, 2 }.
    { slot: "ctor:1", ctx: "attack", lib: "move.effectiveness", path: "condition", removable: true, editable: true },
  ],
  // The class hands the FIRST opposing Pokemon to the condition as the target, so the condition may read `other` even though the
  // engine's priority check does not provide one.
  provides: ["holder", "move", "moveUser", "other"],
  guards: [],
  feasibility: [
    "The test is made against the first Pokemon on the other side (the game does not know the real target yet); with no foe, or when the game cannot work out the matchup, there is no bonus",
  ],
  effect: { id: "effect.change-priority", params: ["priority"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    { name: "a super effective move, a neutral one and a resisted one", axes: { foeMove: ["TACKLE", "WATER_GUN"] } },
  ],
  status: "decomposed",
  notes:
    "Tier A, justified in the header. Only user: Overzealous (5529), `{ priority: 1 }`, bound to move.effectiveness gte 2; the target the atom reads is the first opposing Pokemon that the class hands to the condition, so it is the same predicate as the original closure (`opp.getMoveEffectiveness(user, move) >= 2`) including the no-foe and throwing nets, which live in the class wrapper. Edge, NOT fixed (the class comment says so too): in doubles only `getOpponents()[0]` is tested, not the target the move will really hit, so a move that is super effective against the second foe only gets no bonus.",
});
