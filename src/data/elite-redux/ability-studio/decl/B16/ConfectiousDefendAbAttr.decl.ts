/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2, part 3 of 3 of Confectious (Tier B, event-effect). "When a contact move hurts me, the attacker becomes Confected."
//
// Source: fakemon-pitch-mechanics.ts, ConfectiousDefendAbAttr (extends PostDefendAbAttr; no constructor of its own, so the only
// constructor argument is AbAttr's `showAbility`). canApply, original clause order, now `guards && gate`:
//   guards  1. damage > 0                              the hit really dealt damage
//   gate    2. appliesContact(attacker, holder, move)  = move.doesFlagEffectApply({ flag: MAKES_CONTACT, user: attacker, target: holder })
//                                                      -> library atom move.flag (MAKES_CONTACT). In a "when I am hit" frame the move user is
//                                                      the attacker and the target is me, which is exactly what the atom reads.
// no residual, no random draw. apply: !simulated: attacker.addTag(ER_CONFECTED, 0, MoveId.NONE, holder.id). The marker lasts until the
// attacker leaves the field; while it is on, the engine counts it as Food-based (food-based.ts). The source of the marker is the HOLDER.
// Mirror image of ConfectiousAttackAbAttr (the same marker, but when I am the one being touched).
import { ConfectiousDefendAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ConfectiousDefendAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Make an attacker Food-based when its contact move hurts me",
  summary: () =>
    "After a move that touches me hurts me, the attacker gets the Confected marker until it leaves the field, so it counts as Food-based.",
  synonyms: [
    "confectious",
    "make the attacker food",
    "sugar coat the attacker",
    "candy touch",
    "food based attacker",
    "sticky sweet",
    "contact marker",
  ],
  examples: ["When a contact move hurts me, the attacker is coated in sugar and counts as Food-based"],
  params: [],
  noParamsReason:
    "The effect is fixed: it puts one specific marker (Confected) on the Pokemon that hit me. The marker has no number, stat, type or status to tune; what it does is defined where Food-based Pokemon are checked.",
  conditions: [
    // The gate: the attacker's move makes contact with me. Staff may replace or drop it.
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
  probes: [
    // The shared twin's foe uses a contact attack on the holder; the non-contact and zero-damage cases are driven in chunk2.test.ts.
    { name: "the foe hits the holder with a contact move", axes: { foeMove: ["TACKLE", "WATER_GUN"] } },
  ],
  status: "decomposed",
  notes:
    "Tier B, fully decomposed: trigger (after I am hit), one swappable IF (the move makes contact, the gate, bound to move.flag MAKES_CONTACT) and the effect (put a battle effect on the attacker). The hit-dealt-damage clause (damage above 0) stays in the class as a guard and is listed as feasibility until the librarian registers it (R-B16-4 in requests/B16.md); the effect block effect.apply-tag is planned, not implemented (R-B16-7). No params, for the stated reason. User: Confectious (6034, attr 2; attr 0 is ConfectiousEntryAbAttr, attr 1 ConfectiousAttackAbAttr). Oddity, not fixed: the marker is put on the attacker even when the attacker has already fainted from a recoil or another ability (nothing checks that it is still standing); harmless because a fainted Pokemon leaves the field.",
});
