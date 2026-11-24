/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier B event-effect with a one-piece effect. See ../PRECEDENTS.md.
//
// "After anyone uses a dance move, I use the same move right away" (Dancer, Samba). `canApply` is now `gate` then `residual`
// (gatedCanApply), in the ORIGINAL clause order; there are no guards, no prepare step and no random draw:
//   1. gate      `move.getMove().doesFlagEffectApply({ flag: DANCE_MOVE, user: source })`: the replaceable IF "the move is a dance
//                move", bound as `move.flag DANCE_MOVE`, which calls the same engine predicate with the move user (ER injects the
//                flag into Taekkyeon's attacks through that predicate, so a raw flag read would drift).
//   2. residual  `source.getBattlerIndex() !== pokemon.getBattlerIndex()`: the move cannot come from the Dancer (feasibility; without
//                it the Dancer would repeat its own copy forever)
//   3. residual  none of the tags FLYING, UNDERWATER, UNDERGROUND or HIDDEN on the Dancer (feasibility: it cannot act while it is in
//                the semi-invulnerable turn of a move such as Fly or Dive)
//   apply        (skipped when `simulated`) queues a MovePhase of the same move for the Dancer, as an indirect move that goes first:
//                aimed at the Dancer itself when the move targets the user or its allies, otherwise at the opposite side of the
//                original user (getTarget). Only attack and status moves are replicated.
// Both residual clauses are listed as feasibility rather than guards because the guard registry has no id for them
// (request R-B06-11); they stay in the class either way.
import { PostDancingMoveAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDancingMoveAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-any-move",
  label: "Copy a dance move that was just used",
  summary: () =>
    "After any Pokemon uses a dance move, I use the same move right away, aimed the same way. Example: a foe uses Swords Dance, then I use Swords Dance too.",
  synonyms: ["dancer", "samba", "copy dance", "repeat the move", "echo a move", "copycat dance", "copy move"],
  examples: ["Use the same move right after any dance move, like Dancer"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: the 'is it a dance move' test is the replaceable IF, and the way the copied move is aimed is part of the one-piece effect.",
  conditions: [
    // The gate: "the move is a dance move". Bound per user in bindings.ts.
    { slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move cannot come from me, so I never copy my own move",
    "I cannot copy while I am flying, diving or underground",
    "Only attack moves and status moves are copied",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a dance move, a plain move, and a move that targets the user",
      axes: { foeMove: ["SWORDS_DANCE", "TACKLE", "HOWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the effect only: the copy builds a MovePhase whose target depends on the move's own target kind and on which side the Dancer and the original user stand (getTarget); no library effect says 'use the move that was just used'. Request R-B06-11 asks for it (effect.copy-last-move) and for two guards (not-my-own-move, not-semi-invulnerable). The trigger is the shared 'After anyone uses a move' block. Users (2 attrs): Dancer (216, attr 0) and Samba (5469, attr 1). The ER archetype CopyMoveByFilterAbAttr extends this class, overrides canApply completely and reuses only `apply`, so it is a separate declaration (its own batch) and the new gate and residual methods are never called for it. Detail kept as it is: apply branches on the move's real target (isAllyTarget) and not on its class, because a sound move such as Howl is a plain status move whose target is the user and its allies (the Parroting bug noted in the code). The class respects `simulated` in apply only; canApply is pure.",
});
