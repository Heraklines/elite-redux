/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier A calc-modifier with a one-piece effect. See ../PRECEDENTS.md.
//
// "While the game works out how far my stats move, multiply the number of stages" (Simple doubles it, Contrary flips it). The class
// has one constructor argument (the multiplier) and no `canApply` of its own (the inherited one is always true), no closure, no
// random draw and no state. `apply` is `numStages.value *= this.multiplier`. The engine asks it from StatStageChangePhase
// (stat-stage-change-phase.ts, before the per-stat checks) with `{ pokemon, numStages }`, only when the phase does not ignore
// abilities (a reflected drop from Mirror Armor sets `ignoreAbilities`).
// Nothing to bind: there is no closure to turn into a library condition.
import { StatStageChangeMultiplierAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(StatStageChangeMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.stage-change-amount",
  label: "Multiply every stat change that happens to me",
  summary: params =>
    `Every stat raise or drop on me is multiplied by ${params.multiplier} before it lands. Example: 2 turns a +1 into +2 and a -1 into -2; -1 turns a +1 into a -1.`,
  synonyms: [
    "simple",
    "contrary",
    "double stat changes",
    "reverse stat changes",
    "flip stat boosts",
    "stat change multiplier",
    "invert stat drops",
  ],
  examples: [
    "Double every stat change on me, like Simple",
    "Turn raises into drops and drops into raises, like Contrary",
  ],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "multiplier",
      control: "number",
      min: -4,
      max: 4,
      step: 1,
      integer: true,
      label: "Stat change multiplier (2 = doubled, -1 = reversed)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Skipped when the stat change ignores abilities, such as a drop bounced back by a mirror",
    "The stat limits of -6 and +6 still apply to the result",
  ],
  effect: { id: "effect.package", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a self boost and a foe's drop", axes: { stage: ["ATK:0", "ATK:+6", "ATK:-6"] } }],
  status: "decomposed",
  notes:
    "Users (2 attrs): Simple (86, attr 0, x2) and Contrary (126, attr 0, x-1). The effect has no library block (multiply the stages of a stat change, request R-B06-12: effect.multiply-stat-changes with a whole-number multiplier from -4 to 4), so it is effect.package until then. The archetype StatStageChangeModifierAbAttr extends this class and is a separate declaration (another batch). The class never reads `simulated` and the phase dispatches it without that flag, so it is recorded as ignoring it (no preview ever asks).",
});
