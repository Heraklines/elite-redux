/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec, enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
// B09 chunk 2. "When I use a chosen move, my first-move bonus is back" (Cutthroat: Sharpen resets it).
//
// Source: src/data/elite-redux/archetypes/first-move-priority.ts, class RearmFirstFlaggedMoveOnMoveAbAttr (extends
// ExecutedMoveAbAttr). Dispatched from MoveEffectPhase (src/phases/move-effect-phase.ts:455) right after the move was pushed to
// the move history, whether or not it lands.
// Clauses of the original canApply:
//   `lastMove != null && lastMove.move === moveId`   with `lastMove = pokemon.getLastXMoves(1)[0]`    -> gate (IF)
// apply: clears the used-flag. No random draw, nothing reads `simulated`.
// Constructor: (moveId). Tier B: the whole rule is the gate; no guard, no residual.
// The gate is the library atom time.last-move (`pokemon.getLastXMoves()[0]?.move === MoveId[moveId]`): same history entry,
// same comparison (getLastXMoves defaults to one move), and "no history" is false in both.
import { RearmFirstFlaggedMoveOnMoveAbAttr } from "#data/elite-redux/archetypes/first-move-priority";
import { MoveId } from "#enums/move-id";

export default defineDecl(RearmFirstFlaggedMoveOnMoveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.my-move-starts",
  label: "Give back my first-move bonus when I use a chosen move",
  summary: params =>
    `Whenever I use "${params.moveId}", my first-move priority bonus is back, so my next matching move goes first again.`,
  synonyms: [
    "reset priority",
    "refresh the bonus",
    "cutthroat",
    "sharpen resets",
    "re-arm priority",
    "bonus comes back",
  ],
  examples: ["Using Sharpen gives my first-move priority back, like Cutthroat"],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      path: "moveId",
      control: "select",
      label: "Move that gives the bonus back (pick it from the list, for example Sharpen)",
      editable: true,
      default: "SHARPEN",
      options: enumOptions(MoveId),
      codec: enumCodec(MoveId, "move"),
    },
  ],
  gateParams: [{ param: "moveId", block: "time.last-move", field: "moveId" }],
  conditions: [{ slot: "gate", ctx: "params", lib: "time.last-move", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.restore-first-move-bonus", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "entry", simulated: "ignores" },
  probes: [
    {
      name: "my attack against a foe at full HP",
      axes: { foeHp: ["max"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 1 user: Cutthroat (5444 attr 2, Sharpen), bound to time.last-move { who: holder, moveId: SHARPEN }. The effect is the new planned word effect.restore-first-move-bonus (R-B09-05, not wired yet): it clears the used-flag in tempSummonData that the first-move priority family shares. Proven by B09/first-move-priority.test.ts (the grid has no move history, so the shared L1 only sees the never-matching case): the gate agrees with the original for the empty history, a Sharpen entry, another move and a Sharpen entry older than the last move, and a rebuild with another move follows the setting. The setting is a pick from the list of moves (not free text), because the library atom time.last-move compares the stored name with the move list; the editor cannot show friendly move names for a select yet (request R-B09-19: a move picker with player names for time.last-move).",
});
