/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 1, part 2 of 3 of Confectious (Tier B, event-effect). "When my contact attack hurts a foe, the foe becomes Confected."
//
// Source: fakemon-pitch-mechanics.ts, ConfectiousAttackAbAttr (extends PostAttackAbAttr; no constructor of its own, so the
// parent's `(attackCondition, showAbility)` is the constructor). canApply, original clause order, now `guards && gate`:
//   guards  1. super.canApply: the inherited attack condition = constructor argument 0; the default (and the only value any
//              user passes) is `move.category !== STATUS` -> a replaceable library condition (slot ctor:0, bound to move.damaging).
//              It sits in `guards()` in the class only to keep the clause order; staff replace it through the constructor slot.
//           2. damage > 0                            the hit really dealt damage
//   gate    3. appliesContact(holder, foe, move)     = move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: holder, target: foe })
//                                                    -> library atom move.flag (MAKES_CONTACT)
// no residual, no random draw. apply: !simulated: foe.addTag(ER_CONFECTED, 0, MoveId.NONE, holder.id). The marker lasts until the
// foe leaves the field; while it is on, the engine counts the foe as Food-based (food-based.ts).
import { ConfectiousAttackAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ConfectiousAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Make a foe Food-based when my contact attack hurts it",
  summary: () =>
    "After my damaging move touches a foe and hurts it, that foe gets the Confected marker until it leaves the field, so it counts as Food-based.",
  synonyms: [
    "confectious",
    "make the foe food",
    "sugar coat the attacker",
    "candy touch",
    "contact marker",
    "food based foe",
  ],
  examples: ["When my contact move hurts the foe, the foe is coated in sugar and counts as Food-based"],
  params: [],
  noParamsReason:
    "The effect is fixed: it puts one specific marker (Confected) on the foe I hit. The marker has no number, stat, type or status to tune.",
  conditions: [
    // Slot 0 of the constructor: the inherited attack condition (default: a damaging move). Staff may replace or drop it.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // The gate: my move makes contact with the foe. Staff may replace or drop it.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really have dealt damage (more than 0)",
    "Nothing happens while the game only previews a hit",
  ],
  effect: { id: "effect.apply-tag", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks with contact moves", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, fully decomposed: trigger (after my attack lands), two IFs (the inherited damaging-move condition bound to move.damaging in slot ctor:0, and the contact test in the gate, bound to move.flag MAKES_CONTACT) and the effect (apply a battle effect to the foe). Both the constructor condition and the gate are replaceable. The hit-dealt-damage clause (damage above 0) stays in the class as a guard and is listed as feasibility until the librarian registers it (R-B16-4 in requests/B16.md); the effect block effect.apply-tag is planned, not implemented (R-B16-7). No params, for the stated reason. Users: Confectious (6034, attr 1; attr 0 is ConfectiousEntryAbAttr, attr 2 ConfectiousDefendAbAttr in chunk 2). The L2 template makes the holder attack with Tackle and Double Slap (both contact); a non-contact and a status move are proven in test/tests/elite-redux/decomp/B16/chunk1.test.ts.",
});
