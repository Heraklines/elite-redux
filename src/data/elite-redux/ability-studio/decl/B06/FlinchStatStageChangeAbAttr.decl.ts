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
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { Stat } from "#enums/stat";

/** Player words for the stat names shown in the summary. */
const STAT_WORDS: Record<string, string> = {
  ATK: "Attack",
  DEF: "Defense",
  SPATK: "Sp. Attack",
  SPDEF: "Sp. Defense",
  SPD: "Speed",
  ACC: "Accuracy",
  EVA: "Evasiveness",
};

const oneStat = enumCodec(Stat, "stat");
/** One stat name in the editor, a one-item list for the constructor. */
const oneStatListCodec: ParamCodec = {
  toCtor: value => [oneStat.toCtor(value)],
  fromInstance: raw => (Array.isArray(raw) && raw.length === 1 ? oneStat.fromInstance(raw[0]) : undefined),
};

export default defineDecl(FlinchStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.flinched",
  label: "Change my stats when I flinch",
  summary: params =>
    `When I flinch, my ${STAT_WORDS[String(params.stat)] ?? "chosen stat"} changes by ${params.stages} ${Math.abs(Number(params.stages)) === 1 ? "stage" : "stages"} (a negative number lowers it). Example: Steadfast raises Speed by 1 stage.`,
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
      id: "stat",
      ctorIndex: 0,
      path: "stats",
      control: "select",
      label: "Stat that changes",
      editable: true,
      gateIndependent: true,
      default: "SPD",
      options: ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"],
      // The class takes a LIST of stats; the library effect takes one. All three users change exactly one (Speed), so the
      // setting is one stat and the codec wraps it in a one-item list. An instance with several stats is not representable.
      codec: oneStatListCodec,
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
  effect: { id: "effect.stat-stage", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The attr is asked only when a flinched Pokemon loses its move (FlinchedTag.lapse). The shared scenarios have no flinch move, so test/tests/elite-redux/decomp/B06/b06-chunk4.test.ts applies a real flinch to a Steadfast holder and to its rebuild and compares the queued stat change.",
  probes: [{ name: "a foe hits me", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Users (3 attrs, none with a closure): Steadfast (80, attr 0), Rattled (155, attr 2, added by the ER vanilla-rebalance file with `ab.attrs.push`), Superheavy (5549, attr 0). All three are Speed +1. Review fix: the setting is now ONE stat (`stat`, wrapped into a one-item list for the constructor) so it matches `effect.stat-stage` exactly (stat + stages). The class itself can take several stats at once; the editor has no multi-choice control, so a list of stats is request R-B06-24 (a multi-choice control and a stats list on effect.stat-stage). No user needs it. The target is always the holder.",
});
