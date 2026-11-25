/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Setlist, part 3 of 3 (Tier B, package effect). "The move my set list expects next gets 10% more accuracy, 20% at the second step."
//
// Source: abilities/newcomer-signature-mechanics.ts, SetlistAccuracyAbAttr (SetMoveAccuracyAbAttr; the constructor now
// takes bonusPercentPerStep, default = the old literal 0.1 as 10 / 100, which is the same double, and still hands the
// base class [MoveId.NONE] and 0, which the overridden canApply ignores).
//   canApply, ORIGINAL order, now guards && gate (every clause is pure, no RNG):
//     guards    1. accuracy.value > 0                      (a real accuracy, not a move that never misses)
//     gate      2. setlistNextLevel(holder, move) > 0      (the move my set list expects next: private memory, R-B13-25)
//   apply       accuracy.value *= 1 + setlistNextLevel(holder, move) * (bonusPercentPerStep / 100)
import { SetlistAccuracyAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SetlistAccuracyAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.accuracy",
  label: "Boost move accuracy when I use the move my pattern expects",
  summary: params =>
    `Once I have used two different moves, the one my pattern expects next gains ${params.bonusPercentPerStep}% accuracy per step, up to 2 steps. Example: 10% turns 80 accuracy into 88, then 96.`,
  synonyms: ["combo accuracy", "rhythm accuracy", "crescendo", "alternating moves", "setlist", "never miss the beat"],
  examples: ["If I keep alternating between my two attacks in order, each one misses less often"],
  params: [
    {
      id: "bonusPercentPerStep",
      ctorIndex: 0,
      path: "bonusPercentPerStep",
      control: "number",
      label: "Extra accuracy for each step of the pattern (percent)",
      editable: true,
      gateIndependent: true,
      default: 10,
      min: 0,
      max: 100,
      step: 5,
    },
  ],
  conditions: [
    // Clause 2: "this is the move my set list expects next". No library atom reads that memory yet.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move's accuracy must be a real number: moves that never miss are left alone (checked inside the class until the librarian adds that rule, R-B13-28)",
    "The move must be the one my pattern expects next (a private memory inside the class, the same one the power boost reads)",
    "The pattern has at most 2 steps (fixed in the class)",
  ],
  effect: { id: "effect.package", params: ["bonusPercentPerStep"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // The pattern is empty in a plain battle, so the gate decides it; the recorded case is in B13/chunk3.test.ts.
      name: "a move used with an empty pattern",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (my move's accuracy) and the 'expected move' condition are separate blocks (the condition is a legacy-closure gate until R-B13-25). Why the effect cannot be split with today's blocks: the multiplier is 1 + step * 10% where the step (1 or 2) is read from the live pattern memory; requested as R-B13-27 (`effect.multiply-accuracy-per-count`). The first clause (accuracy > 0) is a guard inside the class (R-B13-28 asks for it as a named rule). The 10% was the literal 0.1, now constructor argument 0 with default 10; the cap of 2 steps stays fixed. Users: Setlist (5989, attr 2). The base class's own fields (moveIds [NONE], accuracyValue 0) are inert here because canApply is overridden, so they are not params. ODDITIES (not fixed): (1) the pattern is updated after the move, so the accuracy of a move is judged against the pattern as it was before the move. (2) accuracy.value is the move's base accuracy at this point, before evasion and stat stages, so the 10% is applied to that number.",
});
