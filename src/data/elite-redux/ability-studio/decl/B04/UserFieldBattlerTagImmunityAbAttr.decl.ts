/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, one list setting, no closure (Aroma Veil, Sweet Veil (P)).
//
// The class body is EMPTY: `class UserFieldBattlerTagImmunityAbAttr extends BaseBattlerTagImmunityAbAttr<...> {}`. Behaviour is
// the base's (just above it in ab-attrs.ts), the same as BattlerTagImmunityAbAttr:
//   constructor(immuneTagTypes)  one battle effect or a list (`coerceArray`); super(true).
//   canApply   `!cancelled.value && this.immuneTagTypes.includes(tag.tagType)`
//              1. `!cancelled.value`: the cancel-chain convention -> not a staff rule.
//              2. `includes(tag.tagType)`: WHICH battle effects are blocked -> the class's SETTING (constructor argument 0).
//   apply      `cancelled.value = true` -> the EFFECT (library "Block it"). Does not read `simulated`.
//   getTriggerMessage: "<holder>'s <ability> prevents <effect>" with the tag's descriptor; the holder named is the PROTECTOR.
// Dispatch: pokemon.ts:6857 (`canAddTag`, simulated) and :6922 (`addTag`), inside `for (const pokemon of
// this.getAlliesGenerator())`: the holder is an ALLY of the Pokemon that would get the effect (`target`), never the Pokemon
// itself. So the holder protects its partner, not itself. The subclass ConditionalUserFieldBattlerTagImmunityAbAttr
// (Flower Veil, Jungle's Guard) is a separate declaration.
// No RNG, no closure, no binding.
import { UserFieldBattlerTagImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BLOCKABLE_EFFECT_CHOICES, battleEffectListCodec, effectWords } from "./shared-codecs";

export default defineDecl(UserFieldBattlerTagImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.battle-effect-immunity-field",
  label: "Protect my partner from effects like taunt or infatuation",
  summary: params =>
    `My partner (not me) cannot get ${effectWords(params.effects)}. Example: choose Taunt and my partner can never be taunted.`,
  synonyms: [
    "aroma veil",
    "sweet veil",
    "protect partner from taunt",
    "ally effect immunity",
    "partner cannot be confused",
    "team effect protection",
    "protect ally from infatuation",
  ],
  examples: ["My partner cannot be taunted, tormented or infatuated, like Aroma Veil"],
  params: [
    {
      id: "effects",
      ctorIndex: 0,
      path: "immuneTagTypes",
      control: "text",
      label: "Battle effects my partner is immune to (comma separated, for example Taunt, Encore)",
      editable: true,
      default: "Taunt",
      options: BLOCKABLE_EFFECT_CHOICES,
      codec: battleEffectListCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only my partner is protected, never myself (my own immunity is a separate block)",
    "An effect that another ability or effect already blocked is left alone",
    "The game also asks this block when it only checks whether an effect could land, without applying it",
  ],
  effect: { id: "effect.negate", params: ["effects"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The partner pass needs a double battle in which a foe puts a battle effect on the holder's partner, and no L2 template does that (the shared template only inflicts Paralysis and Burn, in singles). b04-chunk3.test.ts proves it by hand: every user, every battle effect, cancelled yes/no, and a real double battle in which a foe uses Heal Block.",
  probes: [
    {
      name: "the foe makes the Pokemon next to me drowsy (Yawn) or confuses it (Confuse Ray)",
      axes: { foeMove: ["YAWN", "CONFUSE_RAY"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (live dump): Aroma Veil (id 165, attr 0: Infatuation, Taunt, Disable, Torment, Heal Block, Encore) and Sweet Veil (P) (id 175, attr 2: Drowsiness, after the Sleep immunity at attr 0 and the sleep cure at attr 1). The inventory lists Sweet Veil once as 'Sweet Veil (P)'. Suspected game bug, NOT fixed: as in the real games Aroma Veil should protect its own holder too, but this class is only asked for the target's allies, so a lone Aroma Veil Pokemon can still be taunted (the holder's own BattlerTagImmunityAbAttr list is empty for it). The ER rebalance comment (init-elite-redux-vanilla-rebalance.ts:1057) says Aroma Veil needs no patcher and that the vanilla six-tag list is the ER one; the live dump confirms the six tags. The subclass ConditionalUserFieldBattlerTagImmunityAbAttr instances are also `instanceof` this class (the engine finds them through this dispatch key). The shared L1 grid has no engine-parameter builder for this trigger.",
});
