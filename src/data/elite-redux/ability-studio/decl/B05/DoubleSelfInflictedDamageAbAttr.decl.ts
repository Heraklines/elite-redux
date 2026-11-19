/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 / while-active flag. See ../PRECEDENTS.md.
//
// No behaviour in the class. Two engine sites ask the HURTING Pokemon's opponents (the holder is the foe of the one
// that hurts itself):
//   ConfusedTag.lapse (battler-tags.ts): `pokemon.getOpponents().some(o => o?.hasAbilityWithAttr(...))` -> the confusion
//     self-hit damage is multiplied by 2 (toDmgValue(damage * 2)), after the damage roll.
//   ErEnrageTag.lapse: after the recoil blockers (Rock Head style, Magic Guard) did not cancel, the recoil
//     toDmgValue(dealt * 0.33 * mult, 1) uses mult = 2 with this flag.
import { DoubleSelfInflictedDamageAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DoubleSelfInflictedDamageAbAttr, {
  tier: "C",
  kind: "while-active",
  when: "while.active",
  label: "Double the self-hit damage of confused or enraged foes",
  summary: () =>
    "While I am on the field, foes that hurt themselves from confusion or from enrage recoil take twice as much. Example: a 40 damage confusion hit becomes 80.",
  synonyms: [
    "double confusion damage",
    "confusion self hit",
    "enrage recoil",
    "hurt itself",
    "self damage",
    "cosmic daze",
    "cosmic dust",
  ],
  examples: ["Confused foes hit themselves for double damage, like Cosmic Daze"],
  params: [],
  noParamsReason:
    "A pure presence flag: the confusion and enrage code only ask whether any opponent has it (hasAbilityWithAttr), and the factor 2 is a literal there, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only the damage a foe does to itself from confusion or enrage recoil is doubled; hits from my own attacks are not",
    "Enrage recoil that a recoil blocker (Rock Head, Magic Guard) cancels stays cancelled",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a confused foe and an enraged foe next to the holder", axes: {} }],
  l2StaticReason:
    "A flag has no dispatch moment, so the shared twin only compares whole battles. The enrage recoil site (ErEnrageTag.lapse) is driven directly in test/tests/elite-redux/decomp/B05/flag-sites.test.ts for the original and the rebuilt attr.",
  status: "decomposed",
  notes:
    "While-active flag, Tier C. Users: Cosmic Daze (attr 1, after a ConditionalDamageAbAttr) and Cosmic Dust (attr 2). Nothing to bind. Both engine sites call getOpponents() of the self-hurting Pokemon and use hasAbilityWithAttr with the default canApply=true, so a suppressed holder does not double. Observation (not a bug report): the doubled confusion hit is applied to the damage AFTER the 85-100 roll but BEFORE damageAndUpdate; the 1/3 chance of hitting itself is untouched.",
});
