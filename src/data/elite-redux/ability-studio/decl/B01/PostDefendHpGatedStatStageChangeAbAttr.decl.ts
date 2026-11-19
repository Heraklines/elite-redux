/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 chunk 3, Tier B event-effect. "After a damaging hit takes my HP down to a line, several stats change."
// The old `canApply` is now `gatedCanApply`: the whole of it is the replaceable `gate` (no guard, no residual), with
// the three clauses in the ORIGINAL order:
//   1. `move.category === STATUS` -> false                                   = "the move deals damage" (move.damaging)
//   2. `guardTag !== undefined && pokemon.getTag(guardTag) !== undefined` -> false
//                                                                            = "I do not have <battle effect> yet"
//   3. `t = toDmgValue(maxHp * hpGate); hp <= t && hp + damage > t`          = "my HP just crossed the line"
// `apply` (skipped when `simulated`, no random draw) queues ONE StatStageChangePhase for ALL the stats on the holder
// (`selfTarget`) or on the attacker.
//
// Honest limit of the gate binding: clause 3 uses `toDmgValue` (floor, but never below 1). The library atom
// hp.crossed-below has only `exact` (a float test with a Shell Bell term) and `floor-half` (floor WITHOUT the minimum
// of 1), which differ from clause 3 for a Pokemon with 1 max HP (Shedinja: threshold 1 versus 0). Using floor-half would
// be a lookalike, so every user's gate is a legacy-closure until the librarian adds the rounding (requests/B01.md,
// R-B01-21). The rest of the gate maps to move.damaging and tag.has.
import { PostDefendHpGatedStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { Stat } from "#enums/stat";

/** "None" reads as no guard battle effect (the constructor argument is left out). */
const guardTagCodec: ParamCodec = {
  toCtor: value => (value === "NONE" ? undefined : String(value)),
  fromInstance: raw => (raw === undefined ? "NONE" : typeof raw === "string" ? raw : undefined),
};

export default defineDecl(PostDefendHpGatedStatStageChangeAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Change several stats when a hit drops me to an HP line",
  summary: params =>
    `The hit that takes my HP to ${Math.round(Number(params.hpGate) * 100)}% or lower changes ${params.stats} by ${params.stages} stages. Example: +1 Attack, Sp. Atk and Speed at half HP, like Anger Shell.`,
  synonyms: [
    "anger shell",
    "no turning back",
    "boost at half hp",
    "stat change at low hp",
    "break the shell",
    "power up when hurt",
    "low hp boost",
  ],
  examples: [
    "Raise Attack, Sp. Atk and Speed by two stages and lower Defense and Sp. Def by one when a hit drops me to half HP, like Anger Shell",
  ],
  params: [
    {
      id: "hpGate",
      ctorIndex: 0,
      path: "hpGate",
      control: "slider",
      min: 0.01,
      max: 0.99,
      step: 0.01,
      label: "HP line (fraction of max HP, 0.5 = half)",
      editable: true,
      default: 0.5,
    },
    {
      id: "stats",
      ctorIndex: 1,
      path: "stats",
      control: "text",
      label: "Stats that change (comma separated, for example Attack, Sp. Atk)",
      editable: true,
      gateIndependent: true,
      default: "ATK",
      options: STAT_OPTIONS,
      codec: enumListCodec(Stat, "stat"),
    },
    {
      id: "stages",
      ctorIndex: 2,
      path: "stages",
      control: "number",
      label: "Number of stages (-6 to 6, negative lowers)",
      editable: true,
      gateIndependent: true,
      default: 1,
      min: -6,
      max: 6,
      step: 1,
      integer: true,
    },
    {
      id: "selfTarget",
      ctorIndex: 3,
      path: "selfTarget",
      control: "boolean",
      label: "Change my own stats (off: change the attacker's stats)",
      editable: true,
      gateIndependent: true,
      default: true,
    },
    {
      id: "guardTag",
      ctorIndex: 4,
      path: "guardTag",
      control: "select",
      label: "Stays quiet while I have this battle effect (None means it can repeat)",
      // Shown, not editable: the gate repeats this effect as a library rule that a slider cannot rewrite from here.
      editable: false,
      default: "NONE",
      options: ["NONE", "NO_RETREAT"],
      codec: guardTagCodec,
    },
  ],
  gateParams: [{ param: "hpGate", block: "hp.crossed-below", field: "ratio" }],
  conditions: [
    // The gate is the group [move.damaging, (not tag.has guardTag), the HP line crossing], in that order.
    { slot: "gate", ctx: "params", lib: "hp.crossed-below", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.stat-stage", params: ["stats", "stages", "selfTarget"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // The line itself (a hit that lands exactly on or just below it) and a hit that stays above it.
      name: "HP around the half line",
      axes: { hp: ["50%+1", "50%", "50%-1", "max"], foeMove: ["TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (3 attrs): Anger Shell (271 attr 0: Attack, Sp. Atk and Speed +2, attr 1: Defense and Sp. Def -1, both at 0.5) and No Turning Back (5372 attr 0: all five stats +1, guard battle effect NO_RETREAT so it fires once, like its sibling PostDefendHpGatedSelfTagAbAttr). All three gates are legacy-closures pending R-B01-21 (the toDmgValue rounding of the HP line). The same HP-line rule is mirrored by the archetype post-defend-hp-gated-self-tag (another batch). Oddities (not fixed): (1) with `selfTarget` false the stats go to the attacker but the phase is queued with selfTarget true (the argument is hard-coded), unlike PostDefendStatStageChangeAbAttr; no user sets it false. (2) the old comment says the effect should wait for the last hit of a multi-hit move (a TODO in the class): it fires on any single hit that crosses the line. (3) `guardTag` is shown but not editable because the gate repeats it as a tag rule. (4) ER rebalance code (init-elite-redux-vanilla-rebalance.ts) reads and rewrites these attrs by class name after construction; the bindings come from the live attrs.",
});
