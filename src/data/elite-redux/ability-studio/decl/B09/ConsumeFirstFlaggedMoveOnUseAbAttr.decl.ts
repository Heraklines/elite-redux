/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MOVE_FLAG_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// B09 chunk 2. "The moment I use a move with a chosen property, spend my first-move bonus, even if the move misses" (Coil Up,
// Curlipede).
//
// Source: src/data/elite-redux/archetypes/first-move-priority.ts, class ConsumeFirstFlaggedMoveOnUseAbAttr (extends
// ExecutedMoveAbAttr). Dispatched from MoveEffectPhase (src/phases/move-effect-phase.ts:455, `applyAbAttrs("ExecutedMoveAbAttr",
// { pokemon: user })`), right after the move was pushed to the move history and BEFORE the per-target hit checks, so a miss, an
// immunity or a failed move still spends the bonus (issue #632). The engine passes only the holder: there is no move slot.
// Clauses of the original canApply, in order:
//   1. `hasUsedPriority(pokemon)` -> false            the one-shot memory is already spent                  -> guards()
//   2. the last history entry exists and `allMoves[lastMove.move]?.hasFlag(flag)`  the move I just used has the printed
//      property                                                                                            -> gate (IF)
// apply: sets the used-flag. No random draw, nothing reads `simulated`.
// Constructor: (flag), one flag. Tier B: guards = clause 1, gate = clause 2.
//
// Both gate bindings are legacy-closure: the library has no atom that looks at the move I just used (the move slot is empty at
// this trigger) and reads its printed flag (R-B09-04).
import { ConsumeFirstFlaggedMoveOnUseAbAttr } from "#data/elite-redux/archetypes/first-move-priority";
import { MoveFlags } from "#enums/move-flags";

export default defineDecl(ConsumeFirstFlaggedMoveOnUseAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.my-move-starts",
  label: "Spend my first-move bonus when I use a matching move",
  summary: params =>
    `As soon as I use a move of the kind "${params.flag}", even if it misses or fails, my first-move priority bonus is used up.`,
  synonyms: [
    "use up the bonus",
    "spend priority on use",
    "coil up",
    "curlipede",
    "bonus lost even on a miss",
    "consume on use",
  ],
  examples: ["Using a biting move uses up my first-move priority even if it misses, like Coil Up"],
  params: [
    {
      id: "flag",
      ctorIndex: 0,
      path: "flag",
      control: "select",
      label: "Kind of move that spends the bonus",
      // The gate binding will repeat the property once R-B09-04 exists; editable together with that atom.
      editable: false,
      default: "BITING_MOVE",
      options: MOVE_FLAG_OPTIONS,
      codec: enumCodec(MoveFlags, "move property"),
    },
  ],
  conditions: [
    // The gate: "the move I just used has the printed property". Both users are legacy-closure (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["The bonus must not be spent yet"],
  effect: { id: "effect.spend-first-move-bonus", params: [] },
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
    "Tier B. 2 users, both gates legacy-closure pending request R-B09-04: Coil Up (5040 attr 1) and Curlipede (5687 attr 2), both biting. The effect is the new planned word effect.spend-first-move-bonus (R-B09-05, not wired yet): it sets the used-flag in tempSummonData that the first-move priority family shares. The WHEN event.my-move-starts provides only the holder, so the declaration does not claim the move slot: the move is read from the move history (the engine pushes it just before this trigger). The attr never reads `simulated`.",
});
