/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 6. Tier B calc-modifier. "While the game calculates a move's power, if the foe I am aiming at is paralyzed, multiply
// the power" (Positive Feedback: +25%).
//
// Source: plusle-minun.ts PositiveFeedbackPowerAbAttr (extends VariableMovePowerAbAttr, dispatched as the move-power hook).
// canApply, original, is now `guards && gate` with no guard and no residual (the whole original is the gate):
//   gate  1. `opponent?.status?.effect === StatusEffect.PARALYSIS`   the foe is paralyzed (no foe, or a foe with no status: false)
//                                                                    (library: status.has { who: other, status: PARALYSIS })
// apply: `power.value *= POSITIVE_FEEDBACK_POWER_MULTIPLIER` (1.25), now `this.powerMultiplier`. Nothing is random, nothing is
// remembered, nothing reads `simulated`. The class never called super.canApply (the parent only reads `skipDuringMovesetGen`,
// which is false), and still does not.
// The gate maps fully to one library atom, so it is bound (bindings.ts) and the rebuilt attr is rebuilt for real.
// Class edit (pure move of code): the 1.25 is a constructor argument with the old value as default.
import { PositiveFeedbackPowerAbAttr } from "#data/elite-redux/abilities/plusle-minun";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PositiveFeedbackPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost move power against a paralyzed foe",
  summary: params =>
    `My moves have their power multiplied by ${params.multiplier} while the foe I aim at is paralyzed. Example: 1.25 = 25% more power.`,
  synonyms: [
    "positive feedback",
    "bonus against paralysis",
    "hit paralyzed foes harder",
    "power up on a status",
    "paralysis bonus",
    "static boost",
    "stronger against paralyzed",
  ],
  examples: ["My attacks get 25% more power against a paralyzed foe, like Positive Feedback"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.25 = 25% more, 0.5 = half)",
      editable: true,
      default: 1.25,
      // Only the effect reads it; the gate never repeats it.
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [the foe is paralyzed]. Removable: "boost every move" and "boost against a burned foe" are valid designs.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "I attack a foe", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The shared L2 check looks for evaluations of the WHEN's main dispatch key (MovePowerBoostAbAttr), but this class is dispatched under the sibling key VariableMovePowerAbAttr, so the trace cannot show it evaluated; the shared scenarios also cannot put a status on the FOE. B14/chunk6.test.ts proves the gate against a literal copy of the original over every foe status and compares the rebuilt attr in a real battle with a paralyzed foe.",
  status: "decomposed",
  notes:
    "Tier B calc-modifier, effect = the library multiply-power. Users (1): Positive Feedback (5922) attr 0 (attr 1 is PositiveFeedbackAbAttr, the consume-and-drop half). The gate is fully bound to status.has { who: other, status: PARALYSIS }, the same predicate (`status?.effect === PARALYSIS`). The shared L2 scenarios cannot put a status on the FOE (their `status` axis is the holder's), so the paralyzed branch is proven by B14/chunk6.test.ts against a literal copy of the original over every foe status. The class ignores `simulated` (it only reads state, so power previews and the AI see the boost too, as before). The other half of the ability (PositiveFeedbackAbAttr) is what removes the paralysis after the hit, so the boost lasts only until that attr has run.",
});
