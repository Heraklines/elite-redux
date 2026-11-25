/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 4. Tier A calc-modifier. "When my OWN move or effect would lower my stats, I take no drop, and every foe still
// standing is lowered by the same amount instead" (Sharing is Scaring, the partner Gimmighoul).
//
// Source: bernerd-roster-mechanics.ts `export class SharingIsScaringAbAttr extends SelfStatDropImmunityAbAttr {}`: an EMPTY subclass.
// It has two halves, and only one of them is in the class:
//   1. DISPATCHED half (inherited, unchanged): StatStageChangePhase asks `applyAbAttrs("SelfStatDropImmunityAbAttr", ...)` in the branch
//      where the holder's own move lowers its own stat (`selfTarget && stages < 0 && !cancelled`). The inherited
//      canApply is `!cancelled.value && stages < 0 && (protectedStat == null || stat === protectedStat)` and apply is
//      `cancelled.value = true`, so the drop is blocked. Constructor argument 0 (protectedStat) is `undefined` for the one user.
//   2. ENGINE half (not in the class): the same phase, a few lines BEFORE that dispatch (stat-stage-change-phase.ts, around line 247),
//      looks for an active attr whose class NAME is "SharingIsScaringAbAttr" and, when the call is not a preview, queues a
//      StatStageChangePhase for every living opponent with the same stat and the same (negative) stages. The class name must never change.
// No random draw, nothing remembered. canApply of the inherited half does not read `simulated`, and the engine half skips previews itself.
//
// Clause classification of the inherited half: `!cancelled.value` is the engine's cancel-chain convention (not a rule); `stages < 0` is
// what the block means ("only DROPS"), so it is feasibility; `protectedStat` is the class's own setting, kept as a param but NOT
// editable here, because the engine half passes the drop on for EVERY stat whatever protectedStat says. Letting staff pick one stat
// would block only that stat and still hand every drop to the foes.
import { SharingIsScaringAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import {
  EVERY_STAT,
  PROTECTED_STAT_CHOICES,
  protectedStatCodec,
} from "#data/elite-redux/ability-studio/decl/B14/chunk4-codecs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(SharingIsScaringAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.stat-protect",
  label: "Pass my own stat drops on to the foes",
  summary: () =>
    "When my own move lowers my stats, I take no drop and every foe still standing gets it instead. This pass-on always happens and cannot be conditioned.",
  synonyms: [
    "sharing is scaring",
    "give my stat drops to the foes",
    "reverse stat drop",
    "no self drops, foes get them",
    "share stat drops",
    "hot potato",
    "spread my stat drops",
    "partner gimmighoul",
  ],
  examples: ["My own Close Combat, Overheat and Draco Meteor drops land on the foes instead of me"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "protectedStat",
      control: "select",
      label: "Which stat of mine is protected (fixed: the foes always get every drop)",
      // Not editable, see the header: the pass-on half of the ability takes every stat.
      editable: false,
      default: EVERY_STAT,
      options: PROTECTED_STAT_CHOICES,
      codec: protectedStatCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The pass-on to the foes always happens together with the block and cannot be limited by an extra condition (the game does not ask conditions before passing it on), so no IF can be added to this block",
    "Only drops I cause myself are handled here (a drop from another Pokemon is the job of the other stat-protection block)",
    "Only stat drops are blocked and passed on (a boost I give myself always lands)",
    "A drop that another ability or effect already blocked is left alone and is not passed on",
    "The drop is passed on only when the game really applies it, not while it only previews (a preview still shows my own drop as blocked)",
    "Foes that already fainted are skipped",
  ],
  effect: { id: "effect.negate", params: ["stat"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe lowers my Attack (Growl), which is not a self drop",
      axes: { foeMove: ["GROWL"] },
    },
  ],
  l2StaticReason:
    "The L2 template of this trigger makes the FOE lower the holder's stat, which never reaches the self-drop branch that calls this class. test/tests/elite-redux/decomp/B14/chunk4.test.ts has the holder use Close Combat in a real battle with the original and the rebuild: the holder keeps its stats and the foe takes both drops.",
  status: "decomposed",
  notes:
    "Tier A (nothing to bind: no closure). Users (1): Sharing is Scaring (6115) attr 0 (its only attr). The dispatched half is exactly the inherited SelfStatDropImmunityAbAttr (declared by B04 as effect Block it); the pass-on half is ENGINE code that finds the attr by class name (StatStageChangePhase, `attr.constructor.name === \"SharingIsScaringAbAttr\"`), so it cannot be a block yet. Request R-B14-4.6: an effect 'Give the same stat drop to every foe still standing' with the engine asking the attr instead of the class name, and a WHEN for the self-drop moment (B04 already asked for cancel.self-stat-drop). Until then a rule built only from library blocks reproduces the BLOCK but not the PASS-ON; the rebuilt attr here is still the real class, so the pass-on is kept. The `stat` setting is shown but locked (see the header). Oddities, not fixed: (1) the pass-on runs BEFORE the inherited block and does not use the protectedStat setting or look at whether the block will apply: it fires for every self drop that nobody cancelled earlier; (2) the passed-on drop is queued as an ordinary StatStageChangePhase on each foe (selfTarget false, no source Pokemon), so foe-side protections such as Clear Body or Mist can stop it, while Mirror Armor cannot reflect it for lack of a source; (3) the self-drop branch is not skipped when abilities are ignored, unlike the foe-drop protections above it.",
});
