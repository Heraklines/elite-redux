/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 4 / event-effect, Tier B. Read from the source (archetypes/disable-foe-items-on-entry.ts, the second class of the file), its parent
// PostAttackAbAttr (ab-attrs.ts), the dispatch (applyAbAttrs("PostAttackAbAttr") with the holder as the attacker and `opponent` the target) and the one
// live user, Supersweet Syrup (300, attr 1). The parent's constructor takes (attackCondition, showAbility); the class passes neither, so the
// condition is the parent's default `move.category !== STATUS` and the ability bar IS shown. canApply is now `guards && gate`, in the original
// order of the pure reads:
//
//   gate     1. the move deals damage (the parent's attackCondition, which used to run first)       -> atom move.damaging
//   guards   2. the hit landed: hitResult is below NO_EFFECT (EFFECTIVE .. ONE_HIT_KO)              -> else false
//            3. there is a target and it is not the holder itself                                    -> else false
//   gate     4. the move makes contact, move.doesFlagEffectApply(MAKES_CONTACT, user: holder, target)  -> atom move.flag MAKES_CONTACT (Long Reach aware)
//   apply    unless simulated: opponent.addTag(ER_ITEM_DISABLED, turns, undefined, holder.id). No feasibility check, no random draw.
//
// The three pure safety reads (2, 3) are the guards; the damaging-move test (1, which ran first) joins the contact test (4) in the replaceable
// gate, so staff can see both. Every clause is a pure read, so the order cannot change the answer. `turns` is new as a constructor argument
// (default 3, what the user gets).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { DisableTargetItemOnContactAbAttr } from "#data/elite-redux/archetypes/disable-foe-items-on-entry";

export default defineDecl(DisableTargetItemOnContactAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Switch off the held item of a foe I touch for a few turns",
  summary: params =>
    `When my attacking move makes contact with a foe, that foe's held item stops working for a few turns (turn count ${params.turns}; 3 blocks the item for 2 full turns).`,
  synonyms: [
    "supersweet syrup",
    "embargo on contact",
    "disable the foe's item",
    "sticky item lock",
    "block item on touch",
    "contact item disable",
  ],
  examples: ["When I touch a foe, its held item stops working for 2 turns"],
  params: [
    {
      id: "turns",
      ctorIndex: 0,
      path: "turns",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Turn count of the item block (3 = the item stops working for 2 full turns)",
      editable: true,
      gateIndependent: true,
      default: 3,
    },
  ],
  conditions: [
    // The gate is [move.damaging, move.flag MAKES_CONTACT] (bindings.ts), in that order.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must have landed (it did not miss and the target was not immune)",
    "The target must be another Pokemon, not me",
  ],
  effect: { id: "effect.apply-tag", params: ["turns"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", rngOrder: [], state: "none", simulated: "respects" },
  probes: [
    {
      // A contact move, a non-contact move and a status move.
      name: "contact, non-contact and status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "SWORDS_DANCE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards (hit landed, another Pokemon) && gate (damaging move, contact). The parent's damaging-move test, which ran first and was invisible, is now the first atom of the gate (move.damaging) like in the chunk 2 PostAttack classes. The effect is `effect.apply-tag` (ER_ITEM_DISABLED on the target for `turns`); the library effect is still planned (request R-B08-17, extended by R-B08-41 for the choice of battle effect), so it is named with the one setting `turns`. One user, Supersweet Syrup (300, attr 1, after BlockItemTheftAbAttr); gate [move.damaging, move.flag MAKES_CONTACT]. The contact atom is move.flag, i.e. doesFlagEffectApply with the holder as user and the target as target, the same call as the class. The guard `hitResult < NO_EFFECT` is the same set as the atom hit.landed-damage; it stays in the class as a guard (request R-B08-6 asks for the guard form `hit-connected-on-another-pokemon`). `simulated`: canApply ignores it, apply returns before touching the target; PostAttack is never dispatched simulated. showAbility is true (the parent's default). Siblings (ChanceStatusOnAttackAbAttr, AteConditionalStatusAbAttr) are separate classes with their own declaration.",
});
