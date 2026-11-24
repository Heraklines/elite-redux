/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier C calc-modifier with a one-piece effect. See ../PRECEDENTS.md.
//
// "While the game works out the damage my burn does at the end of the turn, make it 0" (Heatproof, Iron Giant, Thermal Entropy,
// Droideka). The class extends ReduceBurnDamageAbAttr (the vanilla "take less burn damage" class, another declaration) and
// replaces `apply` with `burnDamage.value = 0`; its constructor passes the multiplier 0 to the parent, which is NOT read by the
// replaced `apply`. There is no closure, no `canApply` of its own and no random draw. The engine asks the parent key from
// post-turn-status-effect-phase.ts (`applyAbAttrs("ReduceBurnDamageAbAttr", { pokemon, burnDamage })`), which also runs this
// subclass because the engine finds attrs with `instanceof` (Ability.getAttrs). Nothing to bind.
import { FullBurnDamageImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FullBurnDamageImmunityAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.burn-damage",
  label: "Take no damage from my own burn",
  summary: () =>
    "The damage my burn does at the end of every turn is 0. Example: a burned Pokemon with 160 max HP loses 0 HP instead of 10.",
  synonyms: ["heatproof", "iron giant", "no burn damage", "burn does not hurt", "burn immune damage", "fireproof burn"],
  examples: ["My burn does no damage at the end of the turn, like Iron Giant"],
  params: [],
  noParamsReason:
    "All or nothing: the damage is always set to 0. The constructor passes 0 to its parent class, but the class replaces the calculation and never reads it.",
  conditions: [],
  guards: [],
  feasibility: ["Only matters while I am burned", "Nothing happens to other end-of-turn damage such as poison"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a burned holder at the end of the turn", axes: { status: ["BURN"] } }],
  l2StaticReason:
    "The shared L2 template for this moment (the foe inflicts a status on the holder) is listed as not reaching this moment (decomp-l2-reach.json lists calc.burn-damage as unreached, its carrier probe is never asked); test/tests/elite-redux/decomp/B06/b06-chunk2.test.ts applies the real attr of Heatproof and of its rebuild to a burn damage value and compares them.",
  status: "decomposed",
  notes:
    "PACKAGE for the effect: no library effect sets a calculated amount to zero (request R-B06-13: effect.multiply-burn-damage with a ratio from 0 to 1 would cover this class, ReduceBurnDamageAbAttr and Heatproof's old half at once). Users (5 attrs in 4 abilities): Heatproof (85, attr 1, pushed at init after its vanilla half reducer was removed), Iron Giant (5386, attrs 1 and 5: the ability carries the pair twice), Thermal Entropy (5711, attr 4) and Droideka (5716, attr 1). Every user pairs it with BypassBurnDamageReductionAbAttr. Oddity, not fixed: the engine only reads this through the parent's key, so the class hierarchy IS the dispatch (applyAbAttrs finds it by instanceof); the class must stay a subclass of the reducer. The phase does not pass `simulated` and the class does not read it; it only writes the local damage value, so it is recorded as ignoring `simulated`.",
});
