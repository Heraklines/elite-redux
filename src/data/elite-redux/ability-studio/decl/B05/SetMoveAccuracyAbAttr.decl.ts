/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / calc modifier, Tier B (the gate sits inside canApply). Copy of the PostDamageForceSwitch / contact-status shape.
// See ../PRECEDENTS.md.
//
// canApply is now `gate && residual`, in the ORIGINAL clause order (there is no guard and no prepare step, no random draw):
//   1. gate      the move is one of the listed moves   `moveIds.includes(move.id)`   <- staff may replace it
//   2. residual  the move does not always hit and its base accuracy is below the set value
//                `accuracy.value !== -1 && accuracy.value < accuracyValue`           <- stays in the class
// apply sets `accuracy.value = accuracyValue`. The engine asks in Move.calculateBattleAccuracy (move.ts:1249), after
// VariableAccuracyAttr and WonderSkin and BEFORE the accuracy / evasion stages, so stages still stack on top.
import { SetMoveAccuracyAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { MoveId } from "#enums/move-id";

export default defineDecl(SetMoveAccuracyAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.accuracy",
  label: "Raise a move's base accuracy to a set percent",
  summary: params =>
    `The moves I pick get a base accuracy of at least ${params.accuracy}%. Accuracy and evasion changes still count on top. Example: Hypnosis goes from 60% to ${params.accuracy}%.`,
  synonyms: [
    "better accuracy",
    "accuracy boost",
    "improve accuracy",
    "sleep move accuracy",
    "hypnotist",
    "lullaby",
    "lunar eclipse",
  ],
  examples: ["Hypnosis has 90% accuracy, like Hypnotist", "Sing has 90% accuracy, like Lullaby"],
  params: [
    {
      id: "moves",
      ctorIndex: 0,
      path: "moveIds",
      control: "text",
      // Staff pick the move with the gate ("The move is ..."), which is the editable part; this list only feeds the
      // class's own default gate and is the same data, so editing it alone would not move a replaced gate.
      label: "Moves it improves (comma separated names)",
      editable: false,
      default: "HYPNOSIS",
      codec: enumListCodec(MoveId, "move"),
    },
    {
      id: "accuracy",
      ctorIndex: 1,
      path: "accuracyValue",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Base accuracy (%)",
      editable: true,
      // Only the residual and the effect read it; the gate binding never repeats it.
      gateIndependent: true,
      default: 90,
    },
  ],
  conditions: [
    // The gate: "The move is X" (move.is-move). Each user's binding repeats its own move (bindings.ts).
    { slot: "gate", ctx: "params", lib: "move.is-move", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Moves that never miss are left alone",
    "It only raises accuracy: a move whose accuracy is already at or above the value keeps its own",
  ],
  // No library effect sets a base accuracy yet (effect.always-hit is a never-miss that skips evasion). The package
  // names the block and keeps the typed param; see requests/B05.md R-B05-1 for the effect that replaces it.
  effect: { id: "effect.package", params: ["accuracy"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a listed move with accuracy below, at and above the value, and a never-miss move", axes: {} }],
  l2StaticReason:
    "The shared twin's calc.accuracy scenario never uses the listed move, so the apply branch is not reached there. Move.calculateBattleAccuracy is driven directly for the listed move and an unlisted one in test/tests/elite-redux/decomp/B05/set-move-accuracy.test.ts for the original and the rebuilt attr.",
  status: "decomposed",
  notes:
    "Tier B calc modifier. The effect is 'package' ONLY because the library has no 'raise the base accuracy to N' effect (request R-B05-1); the trigger, the move gate and the number are separate blocks with typed params. Users: Hypnotist (attr 0, HYPNOSIS 90), Lunar Eclipse (attr 2, HYPNOSIS 90), Lullaby (attr 0, SING 90). All three are covered by a gate binding. SleepingInAccuracyAbAttr, SetlistAccuracyAbAttr and FanFavoriteAccuracyAbAttr extend this class but override canApply (and two override apply), so they are separate classes for another batch; the gate/residual split does not touch them because they never call super.canApply. The `moves` param is not editable on purpose: a list cannot be repeated inside the gate atom, so staff change the move through the gate block. The class ignores `simulated` (it only edits the accuracy number, so a simulated call gives the same answer). Observation (not fixed): Hypnotist and Lunar Eclipse comments say 90 but the ER ROM source uses 100; the code follows the description.",
});
