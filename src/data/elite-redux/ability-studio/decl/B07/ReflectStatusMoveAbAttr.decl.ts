/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 2 / calc modifier (a reflect check), Tier C, one-piece effect. See ../PRECEDENTS.md.
//
// Two engine places:
//   - isMoveReflectableBy (move-effect-phase.ts): decides, BEFORE the hit, whether a move is bounced:
//       not a reflected use && target not semi-invulnerable && move has REFLECTABLE && move.category === STATUS
//       && (target has MAGIC_COAT || `target.hasAbilityWithAttr("ReflectStatusMoveAbAttr")`)   <- presence query
//   - MoveReflectPhase.start (move-reflect-phase.ts): Magic Coat wins when the tag is present, otherwise
//       `applyAbAttrs("ReflectStatusMoveAbAttr", { pokemon, opponent, move })`, which runs `apply` below.
// The class (extends PreDefendAbAttr, no constructor, no canApply of its own so the default `true`):
//   apply  queues a MovePhase for the same move id, user = holder, targets = every target for a multi-target move
//          (`getMoveTargets(pokemon, move.id)`) or the original user, use mode REFLECTED, timing FIRST.
// The "which moves bounce" test lives in the engine (the presence query), not in the attr, so there is no condition to extract.
import { ReflectStatusMoveAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ReflectStatusMoveAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "cancel.reflect-status-move",
  label: "Bounce status moves back at the user",
  summary: () =>
    "Status moves that can be bounced and are aimed at me are sent back at the foe who used them, as if I had used them. Example: a foe's Toxic is bounced back onto them.",
  synonyms: [
    "magic bounce",
    "magic coat",
    "reflect status moves",
    "bounce back",
    "send back status moves",
    "duplicity",
    "conjurer of deceit",
  ],
  examples: ["Status moves like Toxic and Stealth Rock are bounced back, like Magic Bounce"],
  params: [],
  noParamsReason:
    "A fixed rule with nothing to choose: every bounceable status move is sent back. The only constructor argument is showAbility, which is never exposed (fixed to true).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves that can be bounced (marked as reflectable) and are status moves are sent back; a move that was itself bounced is never bounced again",
    "A Pokemon that is in the middle of a semi-invulnerable move cannot bounce",
    "Magic Coat, when active, is used instead of this",
  ],
  // No library effect says "send the move back"; request R-B07-7 (effect.reflect-move).
  effect: { id: "effect.package", params: [] },
  fixedCtorArgs: { 0: true },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a reflectable status move is aimed at the holder", axes: { foeMove: ["TOXIC", "TACKLE"] } }],
  l2StaticReason:
    "The bounce is decided by the engine presence query in isMoveReflectableBy and only then dispatched from MoveReflectPhase; the shared twin has no scenario for a reflected move, so the engine sites are driven directly in test/tests/elite-redux/decomp/B07/flag-sites-2.test.ts.",
  status: "decomposed",
  notes:
    'Tier C, one-piece effect (it queues a whole extra move phase). Users (live dump): Magic Bounce (156, attr 0), the second Magic Bounce (5950, attr 0), Conjurer Of Deceit (5464, attr 1) and Duplicity (20010, attr 0); showAbility true for all. No closure, so no binding. ENGINE QUERY ASPECT: `hasAbilityWithAttr("ReflectStatusMoveAbAttr")` in isMoveReflectableBy decides whether the bounce happens at all, so a rebuilt attr must stay on the Pokemon. The class ignores `simulated`.',
});
