/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier A, event-effect on entry, no constructor closure, no canApply of its own.
//
//   canApply   none (AbAttr answers true); the optional attr-level condition (`addCondition`, Furnace and Ice Plumes)
//              is asked by the dispatcher BEFORE canApply and rides along on every rebuild
//   apply      unless simulated:
//                selfTarget  unshift ONE StatStageChangePhase for the holder (stats, stages)
//                otherwise   for every foe (in a triple battle: only the foes NEXT to me), in field order:
//                              intimidate flag set: ask IntimidateImmunityAbAttr then PostIntimidateStatStageChangeAbAttr
//                                on that foe (they may cancel), then a Substitute on the foe cancels
//                              not cancelled: unshift a StatStageChangePhase for that foe, with `onChange` as callback
//   onChange   when present, the phase calls it once the drop has really happened; every shipped user uses the same
//              callback: for each foe whose stat dropped, a 10% roll (`randBattleSeedInt(100) < 10`) puts Fear on it for 2 turns
//
// Every constructor argument is a yes/no flag or a number, so all five are params: which stats, how many stages, who is
// changed (me or the foes), whether the Intimidate rules apply, and the Fear follow-up. There is no yes/no rule inside
// the class, so there is no gate and no guard. What looks like a rule is effect-side: the triple-battle adjacency filter
// (a wing cannot reach the far foe) and the Intimidate cancel checks.
//
// The Fear follow-up cannot be a free number pair: the constructor takes ONE ready closure, so the 10% and the 2 turns
// are part of the one named choice "Fear" (a typed chance and turn count are requested in requests/B03.md).
import { PostSummonStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import {
  BATTLE_STAT_NAMES,
  DROP_FOLLOW_UPS,
  dropFollowUpCodec,
  statListCodec,
  TARGET_SIDES,
  targetSideCodec,
} from "./codecs";

export default defineDecl(PostSummonStatStageChangeAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Raise or lower stats when I enter",
  summary: params =>
    `When I enter the battle, ${params.target} get ${params.stats} changed by ${params.stages} stage(s). Example: Intimidate lowers the foes' Attack by 1; Intrepid Sword raises my own Attack by 1.`,
  synonyms: [
    "intimidate",
    "intrepid sword",
    "dauntless shield",
    "scare",
    "boost on entry",
    "lower foe stats on entry",
    "stat drop on entry",
    "embody aspect",
  ],
  examples: [
    "Lower the foes' Attack by 1 stage when I enter, like Intimidate",
    "Raise my own Speed by 2 stages when I enter",
    "Lower the foes' Sp. Atk by 2 stages when I enter and give them a 10% chance of Fear",
  ],
  params: [
    {
      id: "stats",
      ctorIndex: 0,
      path: "stats",
      control: "text",
      label: "Stats to change (comma separated names)",
      editable: true,
      default: "ATK",
      options: [...BATTLE_STAT_NAMES],
      codec: statListCodec,
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
      label: "Stages to change (+1 raises one stage, -1 lowers one stage)",
      editable: true,
      default: -1,
    },
    {
      id: "target",
      ctorIndex: 2,
      path: "selfTarget",
      control: "select",
      label: "Whose stats change",
      editable: true,
      default: "FOES",
      options: [...TARGET_SIDES],
      codec: targetSideCodec,
    },
    {
      id: "intimidate",
      ctorIndex: 3,
      path: "intimidate",
      control: "boolean",
      label: "Use the Intimidate rules (immune abilities and Substitute block it, reactions like Rattled trigger)",
      editable: true,
      default: false,
    },
    {
      id: "afterDrop",
      ctorIndex: 4,
      path: "onChange",
      control: "select",
      label: "Extra effect on each foe whose stat really dropped",
      editable: true,
      default: "NONE",
      options: [...DROP_FOLLOW_UPS],
      codec: dropFollowUpCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "In a triple battle only the foes standing next to me are affected",
    "With the Intimidate rules, a foe with an immune ability (like Inner Focus) or a Substitute is left alone",
    "A stat that is already at its limit only shows the 'cannot go any higher' message",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.stat-stage", params: ["stats", "stages", "target"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: ["only with the Fear follow-up: one 10% roll per foe whose stat really dropped, inside the stat change"],
    state: "none",
    simulated: "respects",
  },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 23 attrs of 19 ability names, no constructor closure. Self (selfTarget): Intrepid Sword (234, Attack +1), Dauntless Shield (235, Defense +1), Embody Aspect x4 (303 to 306: Speed, Sp. Def, Attack, Defense +1, one per form), Crowned Sword (5256) and Crowned Shield (5257), Furnace (5182 attr 1, Speed +2) and Ice Plumes (5571 attr 1, Speed +2), the last two with an attr-level condition 'Stealth Rock is on my own side' (`arena.getTagOnSide(STEALTH_ROCK, ownSide)`), which has no binding slot yet (the `extra` slot request of chunk 2, requests/B03.md; atom `field.arena-tag` already exists). Foes with the Intimidate rules: Intimidate (22, Attack -1, Fear follow-up added by ability-upgrades), Scare (5067), Terrify (5336, -2), Gleam Eyes (5410 attr 2), Scarecrow (5522), Mob Boss (5714, -2) and Spin To Win (20021 attr 3): Sp. Atk or Attack -1 or -2, all with the Fear follow-up except Fearmonger (5144), Yuki Onna (5227) and Champion's Entrance (5467), which have none; Fire's Wrath (5670 attr 0 Attack -1 without, attr 1 Sp. Atk -1 with the Fear follow-up), Petrify (5381 attr 1, Speed -1). Without the Intimidate rules: none shipped. Supersweet Syrup's vanilla instance is removed by init-elite-redux-vanilla-rebalance.ts (not counted). The Fear follow-up is the same callback in every shipped user (`onSuccessfulStatDrop`, 10%, Fear for 2 turns) and cannot be read back more precisely than 'present'. Quirks recorded, not fixed: the callback fires per foe, so with two foes there are two independent rolls; the live ability list is mutated after construction (Supersweet Syrup, Intimidate and Scare/Terrify are rewritten by upgrade passes), so the live attr is what the dump shows.",
});
