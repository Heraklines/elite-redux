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
// Class edit (behaviour-identical): seven trailing constructor arguments carry the old literals as defaults (2/3/4/5
// hits, 35/35/15/15 percent) and canApply is the Tier B split gate (clause 1) then residual (clause 2). No state.
import { AllAttacksMultiHitAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AllAttacksMultiHitAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Make my single-hit attacks hit several times",
  summary: params =>
    `My single-hit damaging moves hit ${params.lowHits}, ${params.midHits}, ${params.highHits} or ${params.topHits} times, with ${params.lowPct}%, ${params.midPct}% and ${params.highPct}% chances for the first three. Skill Link: always the last.`,
  synonyms: [
    "unrelenting",
    "hit 2 to 5 times",
    "multi hit",
    "triple kick style",
    "fury swipes for everything",
    "extra hits",
  ],
  examples: ["Every attacking move hits 2 to 5 times, like Unrelenting"],
  params: [
    {
      id: "lowHits",
      ctorIndex: 0,
      path: "lowHits",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of hits in the first outcome (Unrelenting: 2 hits)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
    {
      id: "midHits",
      ctorIndex: 1,
      path: "midHits",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of hits in the second outcome (Unrelenting: 3 hits)",
      editable: true,
      gateIndependent: true,
      default: 3,
    },
    {
      id: "highHits",
      ctorIndex: 2,
      path: "highHits",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of hits in the third outcome (Unrelenting: 4 hits)",
      editable: true,
      gateIndependent: true,
      default: 4,
    },
    {
      id: "topHits",
      ctorIndex: 3,
      path: "topHits",
      control: "number",
      min: 1,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of hits in the last outcome, which gets the remaining chance (Unrelenting: 5 hits)",
      editable: true,
      gateIndependent: true,
      default: 5,
    },
    {
      id: "lowPct",
      ctorIndex: 4,
      path: "lowPct",
      control: "number",
      min: 0,
      max: 100,
      step: 5,
      integer: true,
      label: "Chance in percent of the first number of hits (Unrelenting: 35 percent, steps of 5)",
      editable: true,
      gateIndependent: true,
      default: 35,
    },
    {
      id: "midPct",
      ctorIndex: 5,
      path: "midPct",
      control: "number",
      min: 0,
      max: 100,
      step: 5,
      integer: true,
      label: "Chance in percent of the second number of hits (Unrelenting: 35 percent, steps of 5)",
      editable: true,
      gateIndependent: true,
      default: 35,
    },
    {
      id: "highPct",
      ctorIndex: 6,
      path: "highPct",
      control: "number",
      min: 0,
      max: 100,
      step: 5,
      integer: true,
      label: "Chance in percent of the third number of hits (Unrelenting: 15 percent, steps of 5)",
      editable: true,
      gateIndependent: true,
      default: 15,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", lib: "not move.multi-hit", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The move must be able to take extra strikes: a damaging move that is not a charging move, not a spread move with several targets, not already a multi-hit or self-sacrificing move, and not Fling, Uproar, Rollout, Ice Ball or Endeavor",
  ],
  effect: {
    id: "effect.package",
    params: ["lowHits", "midHits", "highHits", "topHits", "lowPct", "midPct", "highPct"],
  },
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
    "Tier B. One user: Unrelenting (5695, attr 0), all defaults. Clause 1 `hitCount.value === 1` is the gate, bound to the library atom `not move.multi-hit` (hits.count > 1, and the count is never below 1: NumberHolder(1) that is only raised); clause 2 canBeMultiStrikeEnhanced is the residual, in this order. The hit counts and the odds were literals inside apply; they are now trailing constructor arguments with the old values as defaults (behaviour-identical class edit, spec 3.1): one roll of 20 sides, cut-offs 20 - lowPct/5, 20 - (lowPct+midPct)/5 and 20 - (lowPct+midPct+highPct)/5 (13, 6, 3 by default); the last band gets what is left. Staff keep the three chances at a sum of 100 or less. `apply` draws its random number even when `simulated` is true (the class ignores the flag); the dispatch is never simulated today. The effect (a random hit count with set odds) has no library block: effect.package, request B02-13. The same-WHEN class AddSecondStrikeAbAttr (Parental Bond) runs just before; both are dispatched by separate applyAbAttrs calls.",
});
