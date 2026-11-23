/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Fan Favorite, part 2 of 2 (Tier B, package effect). "My moves gain 5% accuracy for every healthy teammate waiting on the bench (up to 5)."
//
// Source: abilities/newcomer-signature-mechanics.ts, FanFavoriteAccuracyAbAttr (SetMoveAccuracyAbAttr; the constructor
// now takes bonusPercentPerBenched and maxBenched, defaults = the old literals 0.05 as 5 / 100 and 5, and still hands
// the base class [MoveId.NONE] and 0, which the overridden canApply ignores).
//   canApply, ORIGINAL order, now guards && gate (every clause is pure, no RNG):
//     guards    1. accuracy.value > 0                              (a real accuracy, not a move that never misses)
//     gate      2. livingBenchCount(holder, maxBenched) > 0        (a teammate waits on the bench: R-B13-29)
//   apply       accuracy.value *= 1 + livingBenchCount(holder, maxBenched) * (bonusPercentPerBenched / 100)
// Unlike the power attr, there is NO move-category clause: every move with a real accuracy counts.
import { FanFavoriteAccuracyAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FanFavoriteAccuracyAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.accuracy",
  label: "Boost move accuracy for each teammate waiting on the bench",
  summary: params =>
    `My moves gain ${params.bonusPercentPerBenched}% accuracy for every healthy teammate waiting in the back, up to ${params.maxBenched}. Example: 2 waiting at 5% turns 80 accuracy into 88.`,
  synonyms: [
    "cheering section",
    "bench support",
    "backup accuracy",
    "team spirit",
    "fan favorite",
    "aim from reserves",
    "waiting teammates",
  ],
  examples: ["My moves miss less often for every healthy teammate cheering from the back"],
  params: [
    {
      id: "bonusPercentPerBenched",
      ctorIndex: 0,
      path: "bonusPercentPerBenched",
      control: "number",
      label: "Extra accuracy for each waiting teammate (percent)",
      editable: true,
      gateIndependent: true,
      default: 5,
      min: 0,
      max: 100,
      step: 1,
    },
    {
      id: "maxBenched",
      ctorIndex: 1,
      path: "maxBenched",
      control: "number",
      label: "Most waiting teammates that count (1-5)",
      editable: true,
      gateIndependent: true,
      default: 5,
      min: 1,
      max: 5,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // Clause 2: a healthy teammate waits on the bench. No library atom counts those yet, so the binding is legacy.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move's accuracy must be a real number: moves that never miss are left alone (checked inside the class until the librarian adds that rule, R-B13-28)",
  ],
  effect: { id: "effect.package", params: ["bonusPercentPerBenched", "maxBenched"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The bench size is in B13/chunk3.test.ts; the grid only varies the foe's move.
      name: "a move used with the default party",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (my move's accuracy) and the 'a teammate waits' condition are separate blocks (the condition is a legacy-closure gate until R-B13-29). Why the effect cannot be split with today's blocks: the multiplier is 1 + 5% * (number of waiting teammates), read live from the party; requested as R-B13-27 (`effect.multiply-accuracy-per-count`). The first clause (accuracy > 0) is a guard inside the class (R-B13-28). The 5% and the cap of 5 were literals, now constructor arguments 0 and 1 with the old values as defaults. Users: Fan Favorite (5990, attr 1). ODDITIES (not fixed): (1) this attr has no category test, so physical moves get the bonus too, while the power attr tests for a special move (this matches the ability text: accuracy for all moves, damage for special ones). (2) the bonus is applied to the move's base accuracy before evasion and stat stages (move.ts, calcAccuracy).",
});
