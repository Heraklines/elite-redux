/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, one list setting, no closure (Own Tempo, Inner Focus, Oblivious, Insomnia, Vital
// Spirit, Comatose, Shields Down, ...).
//
// The class body is EMPTY: `class BattlerTagImmunityAbAttr extends PreApplyBattlerTagImmunityAbAttr {}`, which is itself an
// empty subclass of the private BaseBattlerTagImmunityAbAttr (just above it in ab-attrs.ts). Behaviour is the base's:
//   constructor(immuneTagTypes)  one battle effect or a list; `coerceArray` keeps an array as it is and the base calls
//                                super(true), so the ability is shown in the flyout.
//   canApply   `!cancelled.value && this.immuneTagTypes.includes(tag.tagType)`
//              1. `!cancelled.value`: the engine's cancel-chain convention -> not a staff rule.
//              2. `immuneTagTypes.includes(tag.tagType)`: WHICH battle effects are blocked -> the class's SETTING
//                 (constructor argument 0, a list).
//   apply      `cancelled.value = true` -> the EFFECT (library "Block it"). It never reads `simulated`.
//   getTriggerMessage: "<holder>'s <ability> prevents <effect>" (the tag's own descriptor).
// Dispatch: pokemon.ts:6854 (`canAddTag`, a PREVIEW with simulated: true and a stub tag) and :6916 (`addTag`, the real
// attempt), both with the holder's OWN Pokemon. The class is also keyed by name in vanilla-rebalance patches
// (`extendBattlerTagImmunity` appends ER_FEAR to the `immuneTagTypes` ARRAY of Own Tempo, Oblivious, Inner Focus), which is
// why the live dump below already shows the longer lists.
// No RNG, no closure, no binding. Two users carry an attr-level condition (see notes).
import { BattlerTagImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BLOCKABLE_EFFECT_CHOICES, battleEffectListCodec, effectWords } from "./shared-codecs";

export default defineDecl(BattlerTagImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.battle-effect-immunity",
  label: "Be immune to chosen effects such as confusion or flinching",
  summary: params =>
    `Nothing can give me ${effectWords(params.effects)}. Example: choose Confusion and confusion never lands on me.`,
  synonyms: [
    "own tempo",
    "inner focus",
    "oblivious",
    "insomnia",
    "immune to confusion",
    "immune to flinching",
    "flinch immunity",
    "immune to infatuation",
    "yawn immunity",
  ],
  examples: ["Immune to confusion, like Own Tempo", "Immune to flinching, like Inner Focus"],
  params: [
    {
      id: "effects",
      ctorIndex: 0,
      path: "immuneTagTypes",
      control: "text",
      label: "Battle effects I am immune to (comma separated, for example Confusion, Flinch)",
      editable: true,
      default: "Confusion",
      options: BLOCKABLE_EFFECT_CHOICES,
      codec: battleEffectListCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "An effect that another ability or effect already blocked is left alone",
    "The game also asks this block when it only checks whether an effect could land, without applying it",
  ],
  effect: { id: "effect.negate", params: ["effects"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "No L2 template makes a foe put a battle effect on the holder (the shared template only inflicts the statuses Paralysis and Burn), so the engine never evaluates this attr in the shared twin. b04-chunk3.test.ts proves it by hand: every user, every battle effect, cancelled yes/no, and real battles in which a foe uses Confuse Ray and Taunt.",
  probes: [
    {
      name: "the foe confuses (Confuse Ray) me and makes me drowsy (Yawn)",
      axes: { foeMove: ["CONFUSE_RAY", "YAWN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (live dump, 18 attrs of 18 abilities): Oblivious (attr 0: Infatuation, Taunt, Fear), Insomnia (attr 2: Drowsiness), Own Tempo (attr 0: Confusion, Fear), Inner Focus (attr 0: Flinch, Fear), Vital Spirit (attr 2: Drowsiness), Shields Down (attr 4: Drowsiness, with an attr-level condition `p.formIndex < 7`), Comatose (attr 1: Drowsiness), Discipline (attr 2: Confusion), Enlightened (attr 3: Flinch, Fear), Blood Bath (attr 0: Bleed), Bloodlust (attr 0: Bleed), Unlocked Potential (attr 0: Flinch, Fear), Way of Precision (attr 0: Flinch, Fear), Dreamscape (attr 1: Drowsiness), Brainpower (attr 5: Drowsiness), Honk Shoo (attr 1: Drowsiness), Monk (attr 0: Flinch, Fear), Heartless Style (attr 0: Flinch, Fear). The setting `effects` is read back from the live `immuneTagTypes` list. The ER rebalance mutates that list in place (extendBattlerTagImmunity, init-elite-redux-vanilla-rebalance.ts:2676), so the dump shows the final lists. Shields Down: the attr-level condition `formIndex < 7` (Minior in its meteor forms) is added with conditionalAttr, not a constructor argument; it maps onto a library 'form number' condition that does not exist yet (mon.form-index, requested in chunk 1) and the declaration contract has no slot for attr-level conditions (requests/B04.md section 10); the rebuild copies it unchanged. The archetype subclass BattlerTagImmunityAbAttrEr (archetypes/status-immunity.ts) is a separate class of another batch. The shared L1 grid has no engine-parameter builder for this trigger, so the proof is b04-chunk3.test.ts (direct canApply, apply and message over every user and every battle effect).",
});
