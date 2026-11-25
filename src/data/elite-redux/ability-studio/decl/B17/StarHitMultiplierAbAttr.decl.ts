/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 / Starcrossed, its extra-strike half. Read by hand: fakemon-pitch-mechanics.ts `StarHitMultiplierAbAttr` and `isStarMove`,
// `AstralProjectStarMarkerAbAttr`, its base HitMultiplierAbAttr (archetypes/hit-multiplier.ts, owned by another batch; options
// `{ extraStrikes, filter }`, an empty filter matches every move), the grandparent AddSecondStrikeAbAttr (ab-attrs.ts:1751, canApply =
// `move.canBeMultiStrikeEnhanced(holder, true, foe)`, apply = `hitCount += 1`) and the dispatch `applyAbAttrs("AddSecondStrikeAbAttr", ...)`
// in move-effect-phase.ts (once, on the first hit of a move, before the hit count is fixed).
//
// canApply, clause by clause, in the order they run (the split is `canApply = gate`, no guards, no residual):
//   1. condition  the move can be hit-enhanced: `move.canBeMultiStrikeEnhanced(holder, true, foe)` (not a charging move, not a spread
//                 move with several targets, not a status move, not already multi-hit or sacrificial)   -> `gate`, NO ATOM (request R30)
//   2. condition  the HitMultiplier filter matches: the filter is empty here, so it is always true      -> `gate`, nothing to map
//   3. condition  the move is Star-based: `move.hasFlag(LUNAR_MOVE)` OR the holder has an AstralProjectStarMarkerAbAttr
//                                                                                                      -> `gate`, NO ATOM (request R31)
// apply (inherited from HitMultiplierAbAttr): `hitCount.value += extraStrikes`. No random draw, no side effect.
import { StarHitMultiplierAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(StarHitMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.hit-count",
  label: "Make my Star moves hit extra times",
  summary: params =>
    `While the game decides how many times my move hits, moves that count as Star moves get ${params.extraStrikes} extra strike(s). Example: 1 means they hit twice.`,
  synonyms: [
    "starcrossed",
    "hit twice",
    "extra strike",
    "double hit",
    "parental bond",
    "lunar moves hit twice",
    "star moves hit again",
  ],
  examples: ["Make my Star moves hit twice", "Lunar moves strike one extra time"],
  params: [
    {
      id: "extraStrikes",
      ctorIndex: 0,
      path: "extraStrikes",
      control: "number",
      label: "Extra strikes added (1 = the move hits twice)",
      editable: true,
      gateIndependent: true,
      default: 1,
      min: 1,
      max: 3,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The gate: all[<move can be hit-enhanced (R30)>, <move is Star-based (R31)>], in that order. Neither has an atom yet,
    // so the whole gate is legacy-closure-pending-request.
    {
      slot: "gate",
      ctx: "params",
      lib: "requests R30 (the move can be hit more than once by an ability) and R31 (the move is Star-based)",
      removable: true,
      editable: true,
    },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.hit-n-times", params: ["extraStrikes"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      // calc.hit-count has no engine-parameter builder in harness/world.ts (request R38) and the gate is legacy, so L1/L2 skip
      // this attr; the old rule is compared by hand in test/.../B17/chunk3.test.ts.
      name: "damaging and status foe moves",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  l2StaticReason:
    "The hit-count calculation has no L2 scenario template and the gate is a written legacy-closure, so the rebuild is not compared battle by battle; chunk3.test.ts compares the class with the old canApply and apply by hand.",
  status: "decomposed",
  notes:
    "Tier B, no package: the effect is 'add extra strikes' (effect.hit-n-times, not implemented yet; request R34 says that the class ADDS `extraStrikes` to the hit count, it does not set the total). The literal 1 of the old constructor is now the constructor argument `extraStrikes` (default 1, same behaviour). Source edit (pure move of code, spec 3.1): the whole old canApply moved into `gate`, order kept; there are no guards or feasibility. The gate is legacy-closure-pending-request (R30 hit-enhanceable move, R31 Star-based move). The engine also reads this attr by class: move.ts:8118 looks for `instanceof HitMultiplierAbAttr` to stop flinching on later strikes, and `HitMultiplierAbAttr.matchesFilter(a.getFilter(), ...)` with the empty filter, so the class chain stays HitMultiplierAbAttr -> AddSecondStrikeAbAttr. Users: Starcrossed (6017, attr 0) only. Oddity, not a bug: isStarMove uses the raw `move.hasFlag(LUNAR_MOVE)` while the library atom move.flag uses doesFlagEffectApply (which also asks flag-injecting abilities); no ability injects LUNAR_MOVE today, so they agree, but request R31 records the difference.",
});
