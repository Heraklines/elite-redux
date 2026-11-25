/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Two-Faced Unleashed, part 2 of 2 (Tier B, package effect). "While my other face is out, my damaging move costs me 15% of my max HP (once per move, never to 0)."
//
// Source: abilities/newcomer-signature-mechanics.ts, TwoFacedRecoilAbAttr (PostAttackAbAttr; the recoil percent is a
// trailing constructor argument added in this chunk, default = the old literal 0.15 as 15 / 100, which is the same double).
//   canApply, ORIGINAL order, now guards && gate && residual (every clause is pure, no RNG):
//     guards    1. super.canApply: the base attack condition, by default `move.category !== STATUS`
//                  -> constructor slot "ctor:0" (library atom move.damaging)
//               2. params.damage > 0                                  (no library atom yet: R-B13-3)
//     gate      3. TWO_FACED_ACTIVE_TURN[holder] === "wave:turn"       (my other face is out this turn; private memory
//                  written by prepareTwoFacedMove from phases/move-effect-phase.ts:230: R-B13-22)
//     residual  4. my last move record exists                         (`getLastXMoves(1)[0]`)
//               5. TWO_FACED_RECOIL_RECORD[holder] !== that record    (a multi-hit move counts once: R-B13-5)
//   apply     remember the move record (even when simulated); not simulated: damageAndUpdate(min(hp - 1, floor(maxHp * 15%)),
//             HitResult.INDIRECT), so it can never faint me.
import { TwoFacedRecoilAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(TwoFacedRecoilAbAttr, {
  tier: "B",
  kind: "package",
  when: "event.after-my-hit",
  label: "Take damage equal to a share of my max HP",
  summary: params =>
    `While my other face is out, each damaging move I land costs me ${params.recoilPercent}% of my max HP, once per move. It never takes me below 1 HP.`,
  synonyms: [
    "self damage",
    "backlash",
    "price of power",
    "recoil from max hp",
    "life orb style recoil",
    "jekyll and hyde recoil",
  ],
  examples: ["When my second face is out, every attack I land hurts me for 15% of my max HP"],
  params: [
    // Constructor arguments 0 (attack condition) and 1 (show ability) are the base class's: 0 is the ctor:0 condition
    // slot below, 1 stays undefined for every user (base default).
    {
      id: "recoilPercent",
      ctorIndex: 2,
      path: "recoilPercent",
      control: "number",
      label: "Recoil for each move (percent of my max HP)",
      editable: true,
      gateIndependent: true,
      default: 15,
      min: 0,
      max: 100,
      step: 1,
    },
  ],
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
    // Clause 3: my other face is out this turn. No library atom reads that memory yet, so the binding is legacy.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must really deal damage (checked inside the class until the librarian adds that condition)",
    "Only the first hit of a move counts: a multi-hit move costs HP once (a private memory of the last counted move inside the class)",
    "It never takes me below 1 HP (fixed in the class)",
  ],
  effect: { id: "effect.package", params: ["recoilPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // The face is never out in a plain battle, so the gate decides it; the unleashed case is in B13/chunk3.test.ts.
      name: "damaging hit without the other face out",
      axes: { foeMove: ["TACKLE"], foeHp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (after my hit), the damaging-move condition (ctor:0) and the 'other face is out' condition (gate, legacy-closure until R-B13-22) are separate blocks. Why the effect cannot be split with today's blocks: effect.recoil takes a share of the DAMAGE DEALT, while this takes a share of my MAX HP, never leaves me below 1 HP, and also stores the counted move record that the residual reads in the same apply; requested as R-B13-24 (`effect.take-max-hp-percent-damage`) plus R-B13-5 for the memory. The recoil percent was the literal 0.15, now trailing constructor argument 2 with default 15. Users: Two-Faced Unleashed (5977, attr 1; attr 0 is TwoFacedPowerAbAttr). ODDITIES (not fixed): (1) apply stores the counted move record BEFORE its simulated check, so a simulated call spends the once-per-move memory; no engine path simulates PostAttack today. (2) The unleash memory is written by prepareTwoFacedMove and cleared by finishTwoFacedMove in move-effect-phase.ts (found by class name), so the gate depends on engine call sites the declaration cannot show. (3) finishTwoFacedMove clears the face after the move, so the recoil only fires for hits inside the unleashed move itself.",
});
