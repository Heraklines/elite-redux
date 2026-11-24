/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier C calc-modifier. See ../PRECEDENTS.md.
//
// "While the game rolls the chance of a double battle, make it four times as likely." The dispatch site
// (battle-scene.ts:1746, getDoubleBattleChance) calls applyAbAttrs("DoubleBattleChanceAbAttr", { pokemon, chance }) for
// every player Pokemon, then clamps the result at 1. The class has no `canApply` (always true), no constructor argument
// (`showAbility` is fixed to false) and no closure, so nothing is bound.
//   - `apply`: `chance.value /= 4`. The chance is "1 in N": a double battle starts when a random number from 0 to N is 0,
//     so dividing N by 4 makes it four times as likely. The 4 is a literal in the class; no class change is made here
//     (a setting for it is not worth a constructor change: every user wants 4).
// The WHEN calc.double-battle-chance was added to the registry for this class and the key was removed from
// UNEXPOSED_DISPATCH_KEYS (see requests/B01.md, R-B01-1).
import { DoubleBattleChanceAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DoubleBattleChanceAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.double-battle-chance",
  label: "Make double battles four times as likely",
  summary: () =>
    "Wild encounters are four times more likely to be double battles while I am on the team. Example: a 1 in 8 chance becomes 1 in 2.",
  synonyms: ["more double battles", "double battle chance", "arena trap", "no guard", "wild double encounters"],
  examples: ["Double battles show up four times as often, like Arena Trap"],
  params: [],
  noParamsReason:
    "The divide-by-4 is a literal in the class (no constructor argument); every user wants exactly 4, so there is nothing to set.",
  conditions: [],
  guards: [],
  feasibility: ["The chance can never go below 1 in 1 (the game clamps it afterwards)"],
  effect: { id: "effect.more-double-battles", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a double battle roll", axes: {} }],
  l2StaticReason:
    "Wild encounter generation runs before a battle exists, so no battle scenario reaches this WHEN; the class is checked by L1 and by calling applyAbAttrs with a number holder.",
  status: "decomposed",
  notes:
    "Users (4 attrs, all attr index 1, nothing to bind): Arena Trap (71), No Guard (99), Commander (279) and Brawling Wyvern (5307). Oddity, not fixed: the chance is divided without rounding, so a fractional chance is possible before the caller clamps it. The WHEN is new vocabulary added by this batch because the key was only unexposed, not wired.",
});
