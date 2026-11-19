/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, one list setting plus ONE constructor closure that does not map yet (Flower Veil,
// Jungle's Guard).
//
// Dispatch: the same loop as UserFieldBattlerTagImmunityAbAttr (pokemon.ts:6857 simulated and :6922 real, inside
// `for (const pokemon of this.getAlliesGenerator())`): the holder is an ALLY of the Pokemon that would get the effect, and
// `target` is that Pokemon. The class is found through its parent's dispatch key (vocabulary/dispatch-keys.ts alias).
//
// Constructor `(condition, immuneTagTypes)`. Clause classification, in the ORIGINAL order of
// `canApply = super.canApply(params) && this.condition(params.target)`:
//   1. `super.canApply(params)`   = `!cancelled.value && immuneTagTypes.includes(tag.tagType)`
//        a. `!cancelled.value`    the cancel-chain convention; not a staff rule.
//        b. `includes(tag.tagType)`  WHICH battle effects -> the SETTING (constructor argument 1, a list).
//   2. `condition(target)`        constructor closure ctor:0. Both users pass `target.isOfType(GRASS, true, true)` (third
//                                 argument returnOriginalTypesIfStellar = true, so a Stellar Tera Pokemon keeps its original types).
//                                 No library atom is the same predicate (`mon.has-type` uses the default third argument false)
//                                 and the frame's `other` is the target, which a closure of this shape cannot name; requested in
//                                 requests/B04.md, so the closure is a legacy closure for now (bindings.ts).
//   Note the order differs from the status sibling (there the closure runs first); both closures are pure, so it is not visible.
//   apply     inherited `cancelled.value = true` -> the EFFECT (library "Block it"). Does not read `simulated`.
//   getTriggerMessage: inherited ("<holder>'s <ability> prevents <effect>").
// No RNG.
import { ConditionalUserFieldBattlerTagImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { BLOCKABLE_EFFECT_CHOICES, battleEffectListCodec, effectWords } from "./shared-codecs";

export default defineDecl(ConditionalUserFieldBattlerTagImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.battle-effect-immunity-field",
  label: "Protect a qualifying partner from effects like drowsiness",
  summary: params =>
    `My partner cannot get ${effectWords(params.effects)} while it passes the check (Flower Veil: it is a Grass type). Example: choose Drowsiness and a Grass partner never gets drowsy.`,
  synonyms: [
    "flower veil",
    "jungle's guard",
    "protect grass partner from yawn",
    "grass partner cannot be confused",
    "ally effect shield",
    "partner effect immunity",
    "team yawn protection",
  ],
  examples: ["My Grass-type partner cannot become drowsy, like Flower Veil"],
  params: [
    {
      id: "effects",
      ctorIndex: 1,
      path: "immuneTagTypes",
      control: "text",
      label: "Battle effects my partner is immune to (comma separated, for example Drowsiness, Confusion)",
      editable: true,
      default: "Drowsiness",
      options: BLOCKABLE_EFFECT_CHOICES,
      codec: battleEffectListCodec,
    },
  ],
  conditions: [
    {
      slot: "ctor:0",
      ctx: "none",
      path: "condition",
      removable: false,
      editable: false,
    },
  ],
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
    "Both users keep a legacy closure, so the shared twin has nothing to rebuild for them, and no L2 template puts a battle effect on a partner in a double battle. b04-chunk3.test.ts rebuilds the attr with the original closure, drives every battle effect, cancelled yes/no and target type against the original, and runs a real double battle.",
  probes: [
    {
      name: "the foe makes the Pokemon next to me drowsy (Yawn) or confuses it (Confuse Ray)",
      axes: { foeMove: ["YAWN", "CONFUSE_RAY"] },
    },
  ],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request. Users (live dump): Flower Veil (id 166, attr 1) and Jungle's Guard (id 5194, attr 1): the Grass closure and the single battle effect Drowsiness (Yawn). The closure is a legacy closure until the type atom of requests/B04.md exists; the setting is fully declared. Same oddity as the sibling status block: the holder is never protected itself (only the target's allies are asked), and the Drowsiness-only list means a Grass partner still gets confused or infatuated. The ER description comment in archetype-dispatcher.ts (case 463) mentions only status and stat drops; the Yawn immunity is vanilla behaviour kept as is.",
});
