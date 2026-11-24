/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01, Tier C calc-modifier. See ../PRECEDENTS.md.
//
// "While the game calculates the same-type attack bonus, add +0.5 when the move already gets one." The dispatch site
// (pokemon.ts calculateStabMultiplier) hands over a multiplier that already holds 1.5 for a typing match, then the
// attr adds 0.5 (1.5 becomes 2.0), and the engine caps the total at 2.25 after Tera. The two clauses:
//   - `canApply`: `multiplier.value > 1` = feasibility, "the move already gets a same-type bonus". It cannot be a
//     library condition today because the calc.stab frame has no move slot and no multiplier slot.
//   - `apply`: `multiplier.value += this.bonus` = the effect. The bonus is the one constructor argument, default 0.5
//     (it was a literal 0.5 before; the defaulted argument keeps Adaptability and every other user identical).
// The dispatcher skips this attr when the move ignores the user's ability (ignoreSourceAbility).
import { StabBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(StabBoostAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.stab",
  label: "Make my same-type bonus bigger",
  summary: params =>
    `My moves that already get the same-type bonus get ${params.bonus} more, so 1.5x becomes ${Math.round((1.5 + Number(params.bonus)) * 100) / 100}x. Example: a Water move from a Water type deals 2x with the default 0.5.`,
  synonyms: ["adaptability", "stab boost", "same type bonus", "stronger stab", "double stab", "stab 2x"],
  examples: ["Same-type moves deal 2x instead of 1.5x, like Adaptability"],
  params: [
    {
      id: "bonus",
      ctorIndex: 0,
      path: "bonus",
      control: "number",
      min: 0,
      max: 2,
      step: 0.05,
      label: "Extra same-type bonus (0.5 = 1.5x becomes 2x)",
      editable: true,
      default: 0.5,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only when the move already gets a same-type bonus (a bonus of more than 1x)",
    "Ignored when the foe's move ignores my ability (Mold Breaker style)",
  ],
  effect: { id: "effect.add-stab-bonus", params: ["bonus"] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a same-type attack", axes: {} }],
  status: "decomposed",
  notes:
    "Users (4 attrs): Adaptability, RKS System (attr pushed at init, attr 2), Waterborne under two ids (attr 3 each), all with the default 0.5. The class got a defaulted constructor argument `bonus = 0.5` stored in a private field (before: literal 0.5), behaviour-identical. The effect is effect.add-stab-bonus (ADDS to a bonus that already exists), not effect.grant-stab, which sets a bonus. canApply (multiplier > 1) stays as feasibility because the calc.stab frame has no multiplier slot yet (R-B01-5). Relic Stone (engine capability RELIC_STONE_STAB_SUPPRESSION) returns before this attr is reached.",
});
