/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Sleeping In, its accuracy half. Read by hand: fakemon-pitch-mechanics.ts `SleepingInAccuracyAbAttr` and
// `isSleepInducingMove`, its base SetMoveAccuracyAbAttr (ab-attrs.ts, constructor (moveIds, accuracyValue)) and the dispatch
// `applyAbAttrs("SetMoveAccuracyAbAttr", ...)` in Move.calculateBattleAccuracy (move.ts), which runs BEFORE the evasion and
// accuracy-stage multiplier, so those still apply on top. The other two attrs of Sleeping In are
// AbilityStudioRuntimeCapabilityAbAttr (declared by another batch).
//
// canApply, clause by clause, in the order they run (the split is `canApply = guards && gate`):
//   1. guard      the move does not already never miss: `accuracy.value !== -1`     -> `guards`, no registry guard yet (request R32)
//   2. condition  the move can put its target to sleep: some move attr has `effect === SLEEP` or `tagType === DROWSY`
//                                                                                    -> `gate`, NO ATOM (request R27)
// (The base class also tests `moveIds.includes(move.id)` and `accuracy.value < accuracyValue`; this class overrides canApply and drops
// both, with an empty move list: so accuracy 100 is also forced for a move whose own accuracy is above 100, never lowering a -1.)
// apply (the inherited one): `accuracy.value = accuracyValue`. No random draw, no side effect, so `simulated` makes no difference.
import { SleepingInAccuracyAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SleepingInAccuracyAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.accuracy",
  label: "Give my sleep-inducing moves a fixed accuracy",
  summary: params =>
    `While the game calculates accuracy, my moves that put the foe to sleep or make it drowsy get ${params.accuracy}% base accuracy (a move that never misses is left alone). Evasion still applies on top.`,
  synonyms: [
    "sleeping in",
    "yawn accuracy",
    "sleep move accuracy",
    "hypnosis never misses",
    "sleep powder accuracy",
    "accurate sleep moves",
  ],
  examples: ["Make Hypnosis and Sleep Powder hit with 100% accuracy", "Sleep moves get 90% accuracy like Hypnotist"],
  params: [
    {
      id: "accuracy",
      ctorIndex: 0,
      path: "accuracyValue",
      control: "number",
      label: "Accuracy the move gets (%)",
      editable: true,
      gateIndependent: true,
      default: 100,
      min: 1,
      max: 100,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The gate: the move can put its target to sleep. No atom yet (request R27), so it is legacy-closure-pending-request.
    {
      slot: "gate",
      ctx: "params",
      lib: "request R27 (the move can put its target to sleep or make it drowsy)",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: ["A move that already never misses (accuracy shown as a dash) keeps never missing"],
  effect: { id: "effect.package", params: ["accuracy"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // calc.accuracy has no engine-parameter builder in harness/world.ts (request R38) and the gate is legacy, so L1/L2 skip this
      // attr; the old rule is compared by hand in test/.../B17/chunk3.test.ts over sleep and non-sleep moves and accuracy -1, 60, 100.
      name: "sleep and non-sleep foe moves",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The accuracy calculation is not reached by an L2 scenario template and the gate is a written legacy-closure, so the rebuild is not compared battle by battle; chunk3.test.ts compares the class with the old canApply and apply by hand.",
  status: "decomposed",
  notes:
    "Tier B, PACKAGE for the effect only, with a written reason: the library has no 'set the move's accuracy to N' effect. effect.always-hit (unimplemented) means 'never miss' (accuracy -1), which is a different rule from 'accuracy becomes exactly N'; request R33 asks for effect.set-accuracy with a number. The trigger (while the game calculates my move's accuracy) and the condition (sleep-inducing move) are separate blocks; the number is a typed setting, the old literal 100 is now the constructor argument `accuracy` (default 100, same behaviour). The `accuracy !== -1` rule moved from the first clause of canApply into a `guards` method (a pure move of code, same position). The gate is legacy-closure-pending-request (R27). Users: Sleeping In (6056, attr 0) only; its 'no repeat' and 'Yawn style' parts are runtime capability attrs of another batch. Oddity, not a bug: the ability text promises 'the accuracy of Yawn' while the class sets a plain 100; nothing is changed. The accuracy staff set is the BASE accuracy, before evasion and stages.",
});
