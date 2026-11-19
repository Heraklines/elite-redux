/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1. "Swap abilities with an attacker that touches me" (Wandering Spirit).
//
// Tier B. canApply is now `gate && residual`, in the ORIGINAL clause order:
//   gate      the move makes contact (move.doesFlagEffectApply MAKES_CONTACT)
//   residual  attacker.getAbility().swappable, and NOT (the holder has the Wandering Spirit capability AND the attacker
//             has Mummy, Lingering Aroma or the capability itself). Pure feasibility; the second part is an engine-query
//             (abilityQuery WANDERING_SPIRIT_SWAP) that the foundation owns.
// No random draw. `apply` (skipped when simulated) swaps the two temporary abilities.
// The swap itself is a one-off mechanic with nothing to tune, so the DO is bundled (effect.package, request B02-4).
import { PostDefendAbilitySwapAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostDefendAbilitySwapAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Swap abilities with an attacker that touches me",
  summary: () =>
    "When a contact move hits me, the attacker and I swap abilities. Abilities that cannot be swapped stay where they are.",
  synonyms: ["wandering spirit", "trade abilities", "ability swap", "swap ability on contact", "exchange abilities"],
  examples: ["Swap abilities with any attacker that makes contact, like Wandering Spirit"],
  params: [],
  noParamsReason:
    "The swap has no numbers or choices: it always trades the holder's current ability with the attacker's, and the rules for what may be swapped are fixed.",
  conditions: [{ slot: "gate", ctx: "params", lib: "move.flag", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The attacker's ability must be swappable",
    "A holder with the swapping capability never swaps with an attacker that has Mummy, Lingering Aroma or the swapping capability itself",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "contact and non-contact hit", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier B. Two users with no params: Wandering Spirit (254, attr 0, the ability also carries the swap capability through AbilityStudioSourceAbilityAbAttr) and its ER twin (5001). The identity clauses (attacker.hasAbility(MUMMY / LINGERING_AROMA)) and abilityQuery(WANDERING_SPIRIT_SWAP) are engine-query territory and stay in the residual; none of them is removable by staff. The swap swaps TEMP abilities, so it does not change the party's real ability. `apply` honours `simulated`. Not a package in the coverage sense: its WHEN and IF are library blocks, only the DO is bundled.",
});
