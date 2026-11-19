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
//   - `apply`: `multiplier.value += 0.5` = the effect. The 0.5 is a literal inside the class (no constructor arg).
// The dispatcher skips this attr when the move ignores the user's ability (ignoreSourceAbility).
import { StabBoostAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(StabBoostAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.stab",
  label: "Same-type moves hit harder (2x instead of 1.5x)",
  summary: () =>
    "My moves that already get the same-type bonus get 0.5 more, so 1.5x becomes 2x. Example: a Water move from a Water type deals 2x.",
  synonyms: ["adaptability", "stab boost", "same type bonus", "stronger stab", "double stab", "stab 2x"],
  examples: ["Same-type moves deal 2x instead of 1.5x, like Adaptability"],
  params: [],
  noParamsReason:
    "The extra 0.5 is a literal in the class (no constructor argument), so there is nothing to set; a bonus setting needs a class change that this batch may not make.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only when the move already gets a same-type bonus (a bonus of more than 1x)",
    "Ignored when the foe's move ignores my ability (Mold Breaker style)",
  ],
  effect: { id: "effect.grant-stab", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a same-type attack", axes: {} }],
  status: "decomposed",
  notes:
    "Users (4 attrs): Adaptability, RKS System (attr pushed at init, attr 2), Waterborne under two ids (attr 3 each). Effect effect.grant-stab is the closest planned effect, but its multiplier (x1.5 default) means 'set the bonus', while this class ADDS 0.5 to a bonus that already exists; see requests/B01.md. Ability studio composition cannot set the 0.5 yet. Relic Stone (engine capability RELIC_STONE_STAB_SUPPRESSION) returns before this attr is reached.",
});
