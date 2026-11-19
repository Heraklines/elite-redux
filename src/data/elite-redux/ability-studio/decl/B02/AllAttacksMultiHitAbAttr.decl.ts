/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 2. "My single-hit attacks hit 2 to 5 times" (Unrelenting).
//
// Source: src/data/abilities/ab-attrs.ts AllAttacksMultiHitAbAttr. Dispatched right after Parental Bond from
// MoveEffectPhase (`applyAbAttrs("AllAttacksMultiHitAbAttr", { pokemon: user, move, hitCount, opponent })`, skipped
// when the target suppresses multi-hit abilities).
// canApply, in the original order:
//   1. `hitCount.value === 1`   the move would still hit once (never shrink a move that already hits more often)
//   2. `move.canBeMultiStrikeEnhanced(pokemon, true, opponent)`   feasibility, the same rule as Parental Bond
// apply, in the original order: ONE random draw `randBattleSeedInt(20)`; then `applyAbAttrs("MaxMultiHitAbAttr", ...)`
// (Skill Link forces the roll); then `hitCount = roll >= 13 ? 2 : roll >= 6 ? 3 : roll >= 3 ? 4 : 5`, which is
// 35% for two hits, 35% for three, 15% for four and 15% for five.
// No constructor argument, no state. Tier C: one atomic effect; why not Tier B is in the notes.
import { AllAttacksMultiHitAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AllAttacksMultiHitAbAttr, {
  tier: "C",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Make my single-hit attacks hit 2 to 5 times",
  summary: () =>
    "My single-hit damaging moves hit 2 to 5 times: 2 or 3 hits 35% of the time each, 4 or 5 hits 15% each. Skill Link makes it 5 every time.",
  synonyms: [
    "unrelenting",
    "hit 2 to 5 times",
    "multi hit",
    "triple kick style",
    "fury swipes for everything",
    "extra hits",
  ],
  examples: ["Every attacking move hits 2 to 5 times, like Unrelenting"],
  params: [],
  noParamsReason:
    "The 2 to 5 range and the 35/35/15/15 odds are written inside the class (no constructor argument), so there is nothing to set without editing the class. Request B02-13 asks for a 'hit a random number of times' effect with the range as settings.",
  conditions: [],
  guards: [],
  feasibility: [
    "The move must still be a single hit (it never shrinks a move that already hits more than once)",
    "The move must be able to take extra strikes: a damaging move that is not a charging move, not a spread move with several targets, not already a multi-hit or self-sacrificing move, and not Fling, Uproar, Rollout, Ice Ball or Endeavor",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "apply",
    rngOrder: ["randBattleSeedInt(20) in apply, before the Skill Link check, once per move that passes canApply"],
    state: "none",
    simulated: "ignores",
  },
  probes: [{ name: "the holder attacks with a single-hit and a multi-hit move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C. One user: Unrelenting (5695). Why not Tier B: clause 1 maps to the library atom `not move.multi-hit` (hits.count > 1) as long as the hit count is at least 1, which it always is (NumberHolder(1) then only raised), but the shared L1 refuses Tier B classes whose trigger has no engine-parameter builder (request B02-16), and clause 2 would stay the residual. When the builder exists the split is `gate` = hitCount === 1, `residual` = canBeMultiStrikeEnhanced, in this order. `apply` draws its random number even when `simulated` is true (the class ignores the flag); the dispatch is never simulated today. The effect (a random hit count with fixed odds) has no library block: effect.package, request B02-13. The same-WHEN class AddSecondStrikeAbAttr (Parental Bond) runs just before; both are dispatched by separate applyAbAttrs calls, so with both on one Pokemon the second only fires when the first left the count at 1, which it never does for an eligible move.",
});
