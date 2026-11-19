/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A calc-modifier, one setting (which stat), no closure (Clear Body, Full Metal Body, White Smoke, Hyper Cutter,
// Keen Eye, Mind's Eye, Unburden, Free Climb, Exosuit).
//
// Dispatch: stat-stage-change-phase.ts:197 inside the OTHER-source drop branch (not a self-drop, `stages < 0`, abilities
// not ignored, no Mist) and arena-tag.ts:1319 (Sticky Web, with stat SPD and stages -1). Both call sites already restrict
// the check to stat DROPS from somebody else, so the class never sees a boost or a self-drop.
//
// Clause classification (ProtectStatAbAttr), in the original order:
//   canApply  `!cancelled.value && (this.protectedStat == null || stat === this.protectedStat)`
//             1. `!cancelled.value`: an earlier effect already blocked the drop -> the engine's cancel-chain convention
//                (every "cancel" class starts with it); not a rule staff would change.
//             2. `protectedStat == null || stat === protectedStat`: WHICH stat is protected. It is the class's SETTING
//                (constructor argument 0), not a swappable IF: the `stat` setting is the whole of it. (A library atom
//                "the stat being changed is {stat}" would let staff express it as an IF; requested, requests/B04.md.)
//   apply     `cancelled.value = true` -> the EFFECT (library `effect.negate`, "Block it"). It never reads `simulated`:
//             the only thing it changes is the caller's own `cancelled` holder.
//   getTriggerMessage: "<holder>'s <ability> prevents the <stat> loss" (the stat name, or "stats" for every stat).
// No RNG, no constructor closure, no binding. Some users carry an attr-level condition added by the game
// (`AbAttr.addCondition`); none of the users of THIS class does (checked in the live dump).
import { ProtectStatAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { EVERY_STAT, oneStatOrEveryCodec, STAT_CHOICES, statWords } from "./shared-codecs";

export default defineDecl(ProtectStatAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.stat-protect",
  label: "Stop other Pokemon from lowering my stats",
  summary: params =>
    `Other Pokemon (and Sticky Web) cannot lower ${
      statWords(params.stat) === "every stat" ? "any of my stats" : `my ${statWords(params.stat)}`
    }. Drops from my own moves still land.`,
  synonyms: [
    "clear body",
    "hyper cutter",
    "keen eye",
    "stat drop immunity",
    "block intimidate",
    "stat protection",
    "cannot be lowered",
  ],
  examples: ["Attack cannot be lowered by foes, like Hyper Cutter", "No stat can be lowered by foes, like Clear Body"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "protectedStat",
      control: "select",
      label: "Which stat is protected (or all stats)",
      editable: true,
      default: EVERY_STAT,
      options: [EVERY_STAT, ...STAT_CHOICES],
      codec: oneStatOrEveryCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only stat drops that other Pokemon or field effects cause are checked (a drop from my own move is not)",
    "A drop that another ability or effect already blocked is left alone",
  ],
  effect: { id: "effect.negate", params: ["stat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Growl lowers Attack (protected by Hyper Cutter-style users), Tackle lowers nothing.
      name: "a foe lowers my Attack (Growl)",
      axes: { foeMove: ["GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (live dump): Clear Body (attr 0, all), Full Metal Body (attr 0, all), White Smoke (attr 0, all), Keen Eye (attr 0, Accuracy), Hyper Cutter (attr 0 Attack and attr 1 Sp. Atk: two instances), Mind's Eye (attr 1, Accuracy), Unburden (attr 1, Speed), Free Climb (attr 1, Speed), Exosuit (attr 3, Speed). The inventory lists 'Hyper Cutter' once with 10 uses. The class has no closure and no gate, so nothing is bound; every user is fully described by the `stat` setting (read back from the live `protectedStat`; undefined means every stat). The constructor only stores the stat when it is not null. Sticky Web (arena-tag.ts:1319) asks the class with stat SPD and stages -1 without `simulated`, so Unburden, Free Climb, Exosuit and the all-stat users also stop Sticky Web (Keen Eye and Hyper Cutter do not: their stat is not Speed). Related but separate: SelfStatDropImmunityAbAttr (own drops), ConditionalUserFieldProtectStatAbAttr (B04 chunk 3). ER rebalances elsewhere reuse the same class (init-elite-redux-vanilla-rebalance.ts adds ProtectStatAbAttr(Stat.SPD) etc.); the live dump above already includes them.",
});
