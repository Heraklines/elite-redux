/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 2, Tier C calc-modifier with a one-piece effect. See ../PRECEDENTS.md.
//
// "While the game works out how strong a berry I eat is, double it" (Ripen, Apple Pie). The class has no constructor argument, no
// closure and no `canApply` of its own (the inherited one is always true); `apply` is `effectValue.value *= 2`, a literal.
// The engine asks it from berry.ts for four effects of the eater (`pokemon: consumer`): the HP a healing berry gives
// (`hpHealed`), the stages a stat berry gives (`statStages`, `stages`) and the PP a PP berry restores (`ppRestored`), and from
// er-resist-berries.ts for the divisor of a damage-resist berry (`divisor`, so the damage is cut twice as hard). Nothing to bind.
import { DoubleBerryEffectAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(DoubleBerryEffectAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.berry-effect",
  label: "Double the strength of berries I eat",
  summary: () =>
    "Berries I eat work twice as strongly: healing, stat boosts and restored PP are doubled, and berries that soften a hit soften it twice as much. Example: a berry that heals 10 HP heals 20.",
  synonyms: ["ripen", "apple pie", "stronger berries", "double berry", "berry boost", "berries heal more"],
  examples: ["Berries heal and boost twice as much, like Ripen"],
  params: [],
  noParamsReason:
    "All or nothing: the factor 2 is written into the class (`effectValue.value *= 2`) and there is no constructor argument, so there is no number to set (request R-B06-14 asks for a multiplier setting).",
  conditions: [],
  guards: [],
  feasibility: [
    "Only matters when I actually eat a berry",
    "Applies to the berry's healing, stat boost, PP and damage-softening effects",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a low HP holder that eats a berry", axes: { hp: ["max", "50%-1", 1] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect: no library effect multiplies a calculated amount by a fixed factor (R-B06-14: effect.multiply-berry-effect with a factor setting from 1 to 4, default 2, which needs an optional constructor argument that class agents may not add). Users (2 attrs): Ripen (247, attr 0) and Apple Pie (5417, attr 1). The class never reads `simulated`; berry.ts passes no simulated flag. Engine reads: berry.ts lines for healing, stat stages, other stages and PP, plus er-resist-berries.ts for the resist divisor.",
});
