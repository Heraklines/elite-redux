/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 4, Tier A event-effect. See ../PRECEDENTS.md.
//
// "When I flinch, change my stats" (Steadfast, Rattled, Superheavy). Two constructor arguments, no closure: the list of stats and the
// number of stages. The base FlinchEffectAbAttr has `canApply` true, so nothing can fail before the effect.
//   apply  (skips simulated) queues one StatStageChangePhase for the holder (self-inflicted flag true) with the whole list of stats and the
//          stage count, showing the ability pop-up.
// WHEN: battler-tags.ts (FlinchedTag.lapse) dispatches FlinchEffectAbAttr after the flinch message, only when the Pokemon really loses its
// move to the flinch (the tag lapses before the move).
import { FlinchStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { Stat } from "#enums/stat";

export default defineDecl(FlinchStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.flinched",
  label: "Change my stats when I flinch",
  summary: params =>
    `When I flinch, my ${params.stats} change by ${params.stages} stages. Example: Steadfast raises Speed by 1 stage.`,
  synonyms: [
    "steadfast",
    "rattled",
    "superheavy",
    "boost when flinched",
    "speed up on flinch",
    "stat boost after flinching",
    "flinch reaction",
  ],
  examples: ["Raise Speed by 1 stage when I flinch, like Steadfast"],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      path: "stats",
      control: "text",
      label: "Stats that change (comma separated)",
      editable: true,
      gateIndependent: true,
      default: "SPD",
      options: ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"],
      codec: enumListCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "stages",
      control: "number",
      min: -6,
      max: 6,
      step: 1,
      integer: true,
      label: "Stages the stats change by (negative lowers them)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Each stat can only go up to +6 or down to -6; at the limit the stat change reports that it cannot go further",
    "Does nothing in a simulated preview",
  ],
  effect: { id: "effect.stat-stage", params: ["stats", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The attr is asked only when a flinched Pokemon loses its move (FlinchedTag.lapse). The shared scenarios have no flinch move, so test/tests/elite-redux/decomp/B06/b06-chunk4.test.ts applies a real flinch to a Steadfast holder and to its rebuild and compares the queued stat change.",
  probes: [{ name: "a foe hits me", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Users (3 attrs, none with a closure): Steadfast (80, attr 0), Rattled (155, attr 2, added by the ER vanilla-rebalance file with `ab.attrs.push`), Superheavy (5549, attr 0). All three are Speed +1. Oddity, not fixed: the effect is spelled as `effect.stat-stage` with a stat LIST; the library effect has a single `stat` setting (request R-B06-24: let effect.stat-stage take a list of stats). The target is always the holder.",
});
