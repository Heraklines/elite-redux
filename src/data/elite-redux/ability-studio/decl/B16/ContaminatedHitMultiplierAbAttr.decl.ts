/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B16 chunk 2 (Tier A, calc-modifier). "While the game decides how many times my move hits: if any Pokemon on the field is poisoned,
// my move hits once more for every poisoned Pokemon on the field."
//
// Source: fakemon-pitch-mechanics.ts, ContaminatedHitMultiplierAbAttr (extends HitMultiplierAbAttr, which extends AddSecondStrikeAbAttr;
// dispatched once per move, when the first hit starts: `applyAbAttrs("AddSecondStrikeAbAttr")` in move-effect-phase.ts). The parent
// is constructed with `{ extraStrikes: 1 }` and no filter, so every move is matched; the parent's `extraStrikes` is never read by this
// class (its `apply` is its own).
// canApply, original clause order:
//   1. super.canApply: `move.canBeMultiStrikeEnhanced(...)` (not a charging, spread, native multi-hit or status move, not Fling,
//      Uproar, Rollout, Ice Ball or Endeavor) AND the empty filter (always true)  -> effect-side feasibility, stays in the class
//   2. `globalScene.getField(true).some(poisoned or badly poisoned)`               -> the replaceable IF, now constructor argument 1
//      (`poisonedFieldCondition`, default = exactly that expression). ALL active Pokemon of both sides count, the holder included.
// apply: `hitCount.value += Math.min(field.length, poisoned) * extraHitsPerPoisoned`. The old code had no multiplier (the literal 1 is
// now constructor argument 0, default 1). `min(field.length, poisoned)` equals `poisoned` because the poisoned ones are a subset of the
// field, so the cap never bites. No random draw, no state, nothing reads `simulated`.
// Tier A: the condition is a constructor closure; the class is not otherwise split. The closure has NO library atom ("any Pokemon on the
// field has this status"), so its one binding is a legacy closure until the librarian adds it (R-B16-12).
import { ContaminatedHitMultiplierAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ContaminatedHitMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Hit extra times for each poisoned Pokemon on the field",
  summary: params =>
    `While any Pokemon on the field is poisoned, my moves hit ${params.extraHitsPerPoisoned} extra time(s) for each poisoned Pokemon (both sides count). Charging, status and multi-hit moves are left alone.`,
  synonyms: [
    "contaminated",
    "hit more when poisoned",
    "extra hits per poisoned",
    "poison multi hit",
    "toxic strikes",
    "parental bond",
    "more hits with poison around",
  ],
  examples: ["While a Pokemon is poisoned, my attacks hit one extra time per poisoned Pokemon on the field"],
  params: [
    {
      id: "extraHitsPerPoisoned",
      ctorIndex: 0,
      path: "extraHitsPerPoisoned",
      control: "number",
      label: "Extra hits for each poisoned Pokemon on the field (1 = one extra hit each)",
      editable: true,
      integer: true,
      min: 1,
      max: 4,
      step: 1,
      default: 1,
    },
  ],
  conditions: [
    // Constructor argument 1: "somebody on the field is poisoned". No library atom yet, so the binding is a legacy closure.
    // Not removable: without it the ability would show itself on every move while adding nothing when nobody is poisoned.
    { slot: "ctor:1", ctx: "holder", path: "poisonedFieldCondition", removable: false, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must be one a multi-hit ability can add hits to: not a status move, a charging move (unless I skip the charge), a move aimed at several foes, a move that already hits many times, or Fling, Uproar, Rollout, Ice Ball and Endeavor",
    "The number of extra hits counts every poisoned or badly poisoned Pokemon on both sides, me included",
  ],
  effect: { id: "effect.hit-n-times", params: ["extraHitsPerPoisoned"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // The L2 twin attacks a foe that is never poisoned, so only the holder's own status can switch the ability on: no status,
      // poisoned and badly poisoned cover both sides of the gate.
      name: "nobody poisoned, the holder poisoned, the holder badly poisoned",
      axes: { status: ["NONE", "POISON", "TOXIC"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A. One user: Contaminated (6050, attr 0; attr 1 is HitMultiplierPowerAbAttr with multiplier 0.25 on the extra hits only, a different class). The class edit is behaviour-neutral: the literal `1` became constructor argument 0 `extraHitsPerPoisoned` (default 1, multiplied into the count) and the inline field test became argument 1 `poisonedFieldCondition` (default `anyPoisonedOnField`, the same `getField(true).some(...)`, called at the same position in canApply). The condition binding is legacy-closure, reason: no library atom reads 'any Pokemon on the field is poisoned'; requested as R-B16-12 in requests/B16.md. Status stays legacy-closure-pending-request for that reason only; WHEN, effect and the one number are real, swappable parts. Merge note: B09 declares HitMultiplierAbAttr as Tier B (guards/gate members). This class deliberately has NO `guards` or `gate` member and does not use `gatedCanApply`, so it cannot shadow the parent's split; it only calls `super.canApply`. Oddities, not fixed: (1) `min(field.length, poisoned)` can never differ from `poisoned`; (2) the parent's `getFilter()` is `{}` and the flinch rule of the first strike in move.ts reads it, unaffected here.",
});
