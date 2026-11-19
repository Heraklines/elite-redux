/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "Attackers that touch me lose a share of their max HP" (Rough Skin, Iron Barbs, Sharp Edges).
//
// Tier B. canApply is now `guards && gate && residual`, in the ORIGINAL clause order (spec 3.1):
//   guards    the call is not simulated (engine plumbing; the class never damages in a simulated call)
//   gate      the move makes contact: move.doesFlagEffectApply({ MAKES_CONTACT, user: attacker, target: holder })
//   residual  the attacker has no BlockNonDirectDamageAbAttr (Magic Guard and the like). Feasibility, stays in the class.
// No random draw anywhere. `apply` deals toDmgValue(attackerMaxHp * (1 / damageRatio)) as INDIRECT damage and adds it
// to the attacker's turn damage.
import { PostDefendContactDamageAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendContactDamageAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Hurt attackers that touch me",
  summary: params =>
    `Attackers that make contact lose 1/${params.damageRatio} of their max HP. Example: 8 = one eighth, 6 = one sixth.`,
  synonyms: ["rough skin", "iron barbs", "rocky helmet", "contact damage", "thorns", "damage on touch", "spiky skin"],
  examples: ["Attackers that make contact lose 1/8 of their max HP, like Rough Skin"],
  params: [
    {
      id: "damageRatio",
      ctorIndex: 0,
      path: "damageRatio",
      control: "number",
      min: 1,
      max: 64,
      step: 1,
      integer: true,
      label: "Attacker loses 1/this number of its max HP (8 = one eighth)",
      editable: true,
      gateIndependent: true,
      default: 8,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true }],
  guards: [],
  feasibility: ["The attacker must be able to take indirect damage (Magic Guard and similar abilities block it)"],
  effect: { id: "effect.package", params: ["damageRatio"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A contact move and a non-contact move: only the contact one may hurt the attacker.
      name: "contact and non-contact hit",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. The gate is the contact test (library atom move.flag MAKES_CONTACT, which calls doesFlagEffectApply so Long Reach style abilities still count). `!simulated` stays in the class as `guards` (engine plumbing, no registry id needed); the Magic Guard test is the residual. The DO has no library effect yet (hurt the attacker for a share of ITS max HP): effect.package, request B02-2 in requests/B02.md. `apply` does not look at the hit result and computes the damage twice (once for the hit, once for turnData.damageTaken); both are existing behaviour, recorded and not changed. The subclass ContactDamageOnHitAbAttr (archetype) overrides canApply entirely and does not call super, so this split cannot reach it; it needs its own declaration. 9 attrs, 2 param signatures (ratio 8 and 6), all gate bindings are the same contact atom.",
});
