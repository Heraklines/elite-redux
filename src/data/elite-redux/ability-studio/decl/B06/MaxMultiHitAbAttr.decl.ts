/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3, Tier C calc-modifier with a one-piece effect. See ../PRECEDENTS.md.
//
// "While the game rolls how many times a 2 to 5 hit move strikes, give me the top roll" (Skill Link, Ninja's Blade). The class has no
// argument and no closure and its `canApply` is the inherited always-true; `apply` is `hits.value = 0`. The roll is the number from
// `randBattleSeedInt(20)` that `MultiHitAttr.getHitCount` and the ER all-attacks multi-hit class turn into a hit count (13 and up gives 2, 6
// to 12 gives 3, 3 to 5 gives 4, below 3 gives 5), so 0 means five hits. Called with `pokemon: user, hits: hitValue` from move.ts
// (getHitCount, unless the move ignores the user's ability) and from AllAttacksMultiHitAbAttr. The random draw is made BEFORE this runs.
// One engine read by presence: move-effect-phase.ts lets strikes after the first skip the accuracy check of a CHECK_ALL_HITS move
// (Triple Axel) only when the user has this class.
import { MaxMultiHitAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(MaxMultiHitAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.max-multi-hit",
  label: "Always roll the most hits on a 2 to 5 hit move",
  summary: () =>
    "Moves that hit 2 to 5 times always hit 5 times, and moves that check accuracy on every strike, like Triple Axel, check it only once. Example: Skill Link.",
  synonyms: ["skill link", "always five hits", "max hits", "best multi hit roll", "multi hit boost", "ninja"],
  examples: ["Moves like Bullet Seed always hit five times, like Skill Link"],
  params: [],
  noParamsReason:
    "All or nothing: the roll is set to 0 by a literal in the class (the best roll) and there is no constructor argument, so there is no number to set.",
  conditions: [],
  guards: [],
  feasibility: [
    "Only moves that roll 2 to 5 hits are changed; fixed hit counts stay as they are",
    "Does nothing for moves that ignore the user's ability",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "a 2 to 5 hit move against a foe", axes: { foeHp: ["max"] } }],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, written reason: effect.hit-n-times (unimplemented) would set a hit COUNT, while this class rewrites the ROLL that the caller converts (so it also follows any change of the thresholds), and the accuracy rule for CHECK_ALL_HITS moves is read by presence outside the class (request R-B06-18: an effect that sets the best roll). Users (2 attrs): Skill Link (92, attr 0) and Ninja's Blade (5191, attr 1). The class draws no random number itself. The hit-multiplier archetype file says the same class already covers Skill Link style behaviour. The presence read in move-effect-phase.ts is an engine rule about the class name and is untouched.",
});
