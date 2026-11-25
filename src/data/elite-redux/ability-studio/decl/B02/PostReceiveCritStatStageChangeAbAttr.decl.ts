/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "When a critical hit lands on me, change one of my stats" (Anger Point, Stamina-style boosts).
//
// Source: src/data/abilities/ab-attrs.ts PostReceiveCritStatStageChangeAbAttr. The class has NO condition of its own:
// `canApply` is the base class's (always true) and `apply` queues one StatStageChangePhase on the holder unless the
// call is simulated. "It was a critical hit" is decided by the caller (move-effect-phase.ts, `if (wasCritical)`
// before `applyAbAttrs("PostReceiveCritStatStageChangeAbAttr")`), so it belongs to the WHEN and not to the class.
// Tier A with nothing to bind: every user is fully described by its two params.
import { PostReceiveCritStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

export default defineDecl(PostReceiveCritStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.after-crit-taken",
  label: "Change a stat when a critical hit lands on me",
  summary: params =>
    `When a critical hit lands on me, my ${params.stat} changes by ${params.stages} stages. Example: 12 stages sends it straight to the maximum.`,
  synonyms: [
    "anger point",
    "crit boost",
    "maximize on crit",
    "rage when crit",
    "stat boost on critical hit",
    "crit received",
  ],
  examples: ["Raise Attack to the maximum when I take a critical hit, like Anger Point"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "stat",
      control: "select",
      label: "Which stat",
      editable: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      min: -12,
      max: 12,
      step: 1,
      integer: true,
      label: "Number of stages (12 = as high as possible, negative lowers)",
      editable: true,
      default: 12,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["The stat must be able to move: a stat already at +6 cannot rise further"],
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "critical hit on the holder", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, nothing to bind. Eleven attrs in nine abilities (stat ATK, DEF, SPATK, SPDEF, SPD with 12 stages, and Rage Point's two +1 attrs). Several users are pushed with ab.attrs.push after construction (init-elite-redux-vanilla-rebalance.ts:940, the archetype dispatcher), so attrIndex is not the line order. `apply` honours `simulated`. The critical-hit test is the dispatch condition in move-effect-phase.ts, so it is part of the WHEN (event.after-crit-taken), not a clause of this class. The harness has no engine-parameter builder for this WHEN, so the L1 attr differential skips the class (canApply is the constant true); B02's own test drives apply directly (request B02-9 asks for a builder).",
});
