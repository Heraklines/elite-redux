/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PRECEDENT: package (a genuine one-off mechanic that is NOT faked into primitives). See ../PRECEDENTS.md.
//
// Trace: pick a copiable foe ability on entry (a random choice with several foes), take it as a temporary ability,
// suppress the source's copy for two turns and show a custom message. The pieces share per-instance state
// (`target`, `targetAbilityName`) between canApply, apply and getTriggerMessage, so splitting them would invent
// behaviour. It is exposed as one block labelled "Works as one piece".
//
// A package still has: a plain label and summary, synonyms and an example, a WHEN, a written reason for having no
// params, and `reusableAlone`. It is Tier C: extra IFs can only be ANDed on top of it.
import { PostSummonCopyAbilityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonCopyAbilityAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-entry",
  label: "Copy a foe's ability when I enter",
  summary: () => "When I enter the battle, I copy an adjacent foe's ability",
  synonyms: ["trace", "copy ability", "mimic ability", "borrow ability", "steal ability on entry"],
  examples: ["Copy the opposing Pokemon's ability when I enter"],
  params: [],
  noParamsReason:
    "The mechanic has no tunable numbers: the copy rules (adjacent foes only, copiable abilities only, two-turn suppression of the source) are fixed.",
  conditions: [],
  guards: [],
  feasibility: [
    "There must be an adjacent foe whose ability can be copied (not Trace itself, Wonder Guard or form-related abilities)",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: ["canApply: pick one of several adjacent foes (never when simulated)"],
    state: "none",
    simulated: "respects",
  },
  probes: [{ name: "enter against a copiable ability", axes: {} }],
  status: "verified",
  notes:
    "Package, justified: the attr keeps `target` and `targetAbilityName` between canApply, apply and getTriggerMessage, and its apply replaces the holder's ability (setTempAbility) and suppresses the source for two turns. Splitting would re-implement the class. Users: Trace only. Honest bucket: package-only.",
});
