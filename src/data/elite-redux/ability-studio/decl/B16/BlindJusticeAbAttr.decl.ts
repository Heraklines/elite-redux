/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1. Tier C, package. "At the end of every turn, one random other Pokemon on the field loses the use of one random move
// for a turn."
//
// Source: fakemon-pitch-mechanics.ts, BlindJusticeAbAttr (extends PostTurnAbAttr; dispatched as PostTurnAbAttr).
//   canApply  the base class's (always true): no condition, no guard.
//   apply     (1) simulated: nothing.
//             (2) candidates = every ACTIVE Pokemon on the field (`globalScene.getField(true)`, allies of either side included)
//                 that is not me, not fainted and does not carry the Blind Justice lock yet, paired with its moves that are
//                 not empty and `isUsable(target, false, true)[0]` (PP left; restriction tags such as Disable are ignored);
//                 candidates without such a move are dropped.
//             (3) none left: nothing happens and NOTHING is drawn.
//             (4) RANDOM DRAW 1: `pokemon.randBattleSeedInt(candidates.length)` picks the Pokemon.
//                 RANDOM DRAW 2: `pokemon.randBattleSeedInt(moves.length)` picks its move.
//             (5) picked.addTag(ER_BLIND_JUSTICE, 1, moveId, holder.id): a one-turn move lock on that move. The tag class
//                 (ErBlindJusticeTag) ignores the turn count (its own constructor fixes one turn, lapsing at turn end), so the `1`
//                 is not a setting.
// Both draws are in `apply`, in this order. No message of its own.
import { BlindJusticeAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BlindJusticeAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.end-of-turn",
  label: "Lock one random move of a random other Pokemon each turn",
  summary: () =>
    "At the end of every turn I pick a random other Pokemon on the field, and one of its moves that has PP left. It cannot use that move on the next turn.",
  synonyms: [
    "blind justice",
    "disable a random move",
    "random disable",
    "move lock",
    "block a move",
    "jam a move",
    "silence a move",
  ],
  examples: [
    "Every turn, stop a random Pokemon on the field from using one random move for a turn, like Blind Justice",
  ],
  params: [],
  noParamsReason:
    "Nothing is tunable: the lock lasts one turn because the lock's own definition fixes it (the turn count passed in is ignored), and the picks are random. There is no number, type, stat or status in the class.",
  conditions: [],
  guards: [],
  feasibility: [
    "Another Pokemon on the field must be standing, must not already carry this lock and must have at least one move with PP left",
    "Nothing happens while the game only previews the turn",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: [
      "apply: pick which other Pokemon is affected (only when a candidate exists)",
      "apply: pick which of its moves is locked",
    ],
    state: "none",
    simulated: "respects",
  },
  probes: [{ name: "two quiet turns in a single battle", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified: the effect chooses a random Pokemon among the others on the field and then a random usable move of it, and locks exactly that move. The library has no target choice 'a random other Pokemon on the field' and no 'a random usable move of the target' choice for the tag effect, so effect.apply-tag cannot express it (requested as effect.lock-random-move, R-B16-6 in requests/B16.md). The trigger (end of turn) is its own block and the class has no IF. There are no params for a stated reason (see noParamsReason). Users: Blind Justice (6009, attr 0). The two random draws keep their order (Pokemon first, move second), covered by test/tests/elite-redux/decomp/B16/chunk1.test.ts. ODDITIES, not fixed: (1) the candidate list includes the holder's own ally (the ability text says 'other active Pokemon'); (2) `isUsable(target, false, true)` ignores restriction tags, so a move that is already disabled by another effect can be picked.",
});
