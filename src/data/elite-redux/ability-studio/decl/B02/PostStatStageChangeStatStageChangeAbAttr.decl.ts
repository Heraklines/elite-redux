/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "After a foe changes one of my stats, change some of my stats" (Defiant, Competitive, Contempt).
//
// Tier A with a pending request. canApply is `this.condition(holder, stats, stages) && !selfTarget`:
//   ctor:0      the constructor closure, a PokemonStatStageChangeCondition (target, stats, stages). Every user passes
//               `stages < 0` (library atom stage.just-changed { direction: lowered }, formula `frame.stages < 0`).
//   !selfTarget the change was NOT caused by the holder's own move. It sits after the closure and is a real game rule
//               (without it Defiant would answer the drop from its own Superpower); there is no library atom for the
//               "who caused the change" fact yet.
// Both pieces are blocked on the library, so the status is legacy-closure-pending-request:
//   B02-7  a condition context for the (target, stats, stages) signature, so `adaptCondition` can turn a library IF
//          into this closure. Today only attack/defend/holder exist, so every ctor:0 is bound as a legacy closure.
//   B02-8  an atom for "the change came from someone else" (the `selfTarget` flag of the engine parameters).
// No random draw. `apply` (skipped when simulated) queues one StatStageChangePhase on the holder.
import { PostStatStageChangeStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { Stat } from "#enums/stat";

export default defineDecl(PostStatStageChangeStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.stat-changed",
  label: "Change my stats after a foe changes one of mine",
  summary: params =>
    `When a foe lowers one of my stats, my ${params.statsToChange} change by ${params.stages} stages, like Defiant. Swap the "lowered" test for another condition if you want.`,
  synonyms: [
    "defiant",
    "competitive",
    "retaliate on stat drop",
    "boost after stat drop",
    "punish intimidate",
    "stat drop reaction",
  ],
  examples: ["Raise Attack by 2 stages whenever a foe lowers one of my stats"],
  params: [
    {
      id: "statsToChange",
      ctorIndex: 1,
      path: "statsToChange",
      control: "text",
      label: "Stats to change (comma separated list)",
      editable: true,
      default: "ATK",
      codec: enumListCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Number of stages (negative lowers)",
      editable: true,
      default: 2,
    },
  ],
  conditions: [
    // `ctx: none`: the closure signature (target, stats, stages) has no adapter yet. Every user is a legacy closure.
    { slot: "ctor:0", ctx: "none", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only reacts to a change caused by someone else, never to a change from my own move (no library test for this yet)",
    "The stat must be able to move: a stat already at +6 cannot rise further",
  ],
  effect: { id: "effect.stat-stage", params: ["statsToChange", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "foe lowers the holder's stat", axes: {} }],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request. Six attrs in six abilities (Defiant 128, Competitive 172, Contempt 5312, Narcissist 5617, Lucha Libre 5686, Duality 5725). All six closures read `stages < 0` (Narcissist names its parameters `_t, _s, stages`); the single stat written down is ATK (Defiant, Contempt, Lucha Libre), SPATK (Competitive, Duality) or both (Narcissist). The Defiant-style abilities in the archetype dispatcher construct the class too (4007: stages < 0, [ATK, SPATK], 2). The closure is the ability's whole design and does map to stage.just-changed lowered, but build-attr's adaptCondition cannot adapt a (target, stats, stages) closure, so no binding is possible and each is a legacy closure with that reason. `!selfTarget` also has no atom. Both are in requests/B02.md. B02's own test (stat-change-closure.test.ts) rebuilds each attr with its own closure and compares canApply over (stats, stages, selfTarget); the L1 harness has no engine-parameter builder for event.stat-changed (request B02-9). Behaviour note, not changed: the dispatcher hands the REQUESTED stages (this.stages) to the closure, not the stages that were actually gained after clamping at -6.",
});
