/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 2. "Intimidate and Scare cannot lower my stats" (Overwhelm, Discipline).
//
// Source: src/data/elite-redux/archetypes/status-immunity.ts, IntimidateImmunityAbAttrEr: `class X extends IntimidateImmunityAbAttr {}`,
// an empty body (ab-attrs.ts:2709, which extends CancelInteractionAbAttr). Nothing of its own:
//   canApply  `!cancelled.value`  inherited from CancelInteractionAbAttr: nothing blocked it yet   feasibility
//   apply     `cancelled.value = true`                                                             EFFECT "Block it"
//   getTriggerMessage (inherited): "<holder>'s <ability> prevented it from being Intimidated!" (built, never queued: showAbility false)
// Dispatch: the Intimidate-family entry effect (PostSummonStatStageChangeAbAttr) asks each foe it would hit with
// applyAbAttrs("IntimidateImmunityAbAttr", ...) before it lowers the stat, and cancels the drop when the flag is set.
// No constructor argument, no closure, no random draw. Tier A.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { IntimidateImmunityAbAttrEr } from "#data/elite-redux/archetypes/status-immunity";

export default defineDecl(IntimidateImmunityAbAttrEr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.intimidate",
  label: "Stay unaffected by Intimidate and Scare",
  summary: () =>
    "While the game checks whether a foe's Intimidate lands on me, it does not. Example: a foe enters with Intimidate and my Attack stays the same.",
  synonyms: [
    "immune to intimidate",
    "ignore intimidate",
    "no attack drop on entry",
    "inner focus",
    "oblivious",
    "discipline",
    "overwhelm",
  ],
  examples: ["Intimidate and Scare no longer lower my stats, like Overwhelm", "Immune to Intimidate like Inner Focus"],
  params: [],
  noParamsReason:
    "The class has no constructor argument: it is a plain 'Intimidate cannot land on me' switch, so there is no number, type or stat to set.",
  conditions: [],
  guards: [],
  feasibility: ["Nothing else has already blocked the same Intimidate"],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a foe enters with Intimidate", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 2 attrs, nothing to bind: Overwhelm (5066 attr 0, second attr is OffensiveTypeChartOverrideAbAttr) and Discipline (5125 attr 1; attr 0 is SwitchWhileRampagingAbAttr and attr 2 is BattlerTagImmunityAbAttr, Discipline's confusion immunity). Subclass of the vanilla IntimidateImmunityAbAttr, which has its own declaration (B03); this one adds nothing (the archetype layer only keeps the constructor style symmetric), so the behaviour and the quirk B03 recorded are the same: the dispatcher passes ONE shared `cancelled` holder and PostIntimidateStatStageChangeAbAttr.apply later writes `cancelled.value = this.overwrites`, so a non-overwriting reaction of the same holder would undo this block (no shipped ability has both). `apply` ignores `simulated`. The label differs from B03's block on purpose: B03 is the vanilla class, this one is its ER copy.",
});
