/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A calc-modifier, one setting (which stat), no closure (Limber, Lucky Halo, Steadfast, Superheavy, and the
// "own drops" half of Clear Body, Full Metal Body, Unburden, Free Climb, Exosuit).
//
// Dispatch: stat-stage-change-phase.ts:259, only in the branch where the holder's OWN move or effect lowers its OWN stat
// (`selfTarget` and `stages < 0`, `!cancelled`). It is the complement of ProtectStatAbAttr, which that phase calls only for
// drops from somebody else. The same phase also runs the subclass UserFieldSelfStatDropImmunityAbAttr through this base
// pass (it matches by `instanceof`).
//
// Clause classification (SelfStatDropImmunityAbAttr), in the original order:
//   canApply  `!cancelled.value && stages < 0 && (protectedStat == null || stat === protectedStat)`
//             1. `!cancelled.value`: the engine's cancel-chain convention (already blocked) -> not a staff rule.
//             2. `stages < 0`: only DROPS are blocked. This is the meaning of the effect ("Block stat drops"); the call
//                site already guarantees it, so it never differs. It is FEASIBILITY: staff cannot turn this block into a
//                "block stat boosts" block. (Library atom `stage.just-changed{lowered}` reads the same test.)
//             3. `protectedStat == null || stat === protectedStat`: the class's SETTING (constructor argument 0).
//   apply     `cancelled.value = true` -> the EFFECT (library "Block it"). Does not read `simulated`.
//   getTriggerMessage: same "prevents the <stat> loss" text as ProtectStatAbAttr.
// No RNG, no closure, no binding.
import { SelfStatDropImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { EVERY_STAT, oneStatOrEveryCodec, statWords } from "./shared-codecs";

export default defineDecl(SelfStatDropImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.stat-protect",
  label: "Stop my own moves from lowering my stats",
  summary: params =>
    `My own moves and effects cannot lower ${
      statWords(params.stat) === "every stat" ? "any of my stats" : `my ${statWords(params.stat)}`
    }. Example: Close Combat no longer lowers Defense. Other Pokemon can still lower my stats.`,
  synonyms: [
    "limber",
    "lucky halo",
    "no self stat drops",
    "overheat no drop",
    "close combat no drop",
    "ignore recoil stat drops",
    "self drop immunity",
  ],
  examples: ["Moves like Close Combat and Overheat never lower my stats, like Lucky Halo"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "protectedStat",
      control: "select",
      label: "Which stat is protected (or all stats)",
      editable: true,
      default: EVERY_STAT,
      options: [EVERY_STAT, ...STAT_OPTIONS],
      codec: oneStatOrEveryCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only stat drops are blocked (a boost I give myself always lands)",
    "Only drops I cause myself are checked here (a drop from another Pokemon is the job of the other stat-protection block)",
    "A drop that another ability or effect already blocked is left alone",
  ],
  effect: { id: "effect.negate", params: ["stat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe lowers my Attack (Growl), which is not a self drop",
      axes: { foeMove: ["GROWL"] },
    },
  ],
  l2StaticReason:
    "The L2 template for this trigger makes the FOE lower the holder's stat, which never reaches the self-drop branch that calls this class. The self-drop path is proven by b04-chunk2.test.ts, which has a holder use Superpower and Overheat in a real battle against original and rebuild.",
  status: "decomposed",
  notes:
    "Users (live dump): Limber (attr 2, all), Clear Body (attr 1, all), Full Metal Body (attr 1, all), Lucky Halo (attr 0, all), Steadfast (attr 3, all), Superheavy (attr 3, all), Unburden (attr 2, Speed), Free Climb (attr 2, Speed), Exosuit (attr 4, Speed). The subclass UserFieldSelfStatDropImmunityAbAttr (Evaporate) and the Elite Redux SharingIsScaringAbAttr (extends this class, own declaration in a later batch) are separate classes that inherit this check. The trigger is the same WHEN as ProtectStatAbAttr because the registry lists it as an alsoDispatchKey; the moment it describes (a stat drop checked on me) is the right place, but the self-drop branch is a different call: requests/B04.md asks for a separate WHEN. Inventory counts this class 9 times: all nine are plain constructor calls with at most one stat.",
});
