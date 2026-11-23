/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier, Tier B (review round 4), status exempt (the engine never dispatches the class, see notes). Read from the source (archetypes/chance-dodge.ts):
//
//   canApply = guards && gate, in the original clause order:
//     guards  1. attacker === holder, or the move is not an AttackMove  -> false          (feasibility: never dodge my own move or a status move; stays in the class)
//     gate    2. singleTargetOnly && !SINGLE_TARGET_KINDS.has(move.moveTarget) -> false   atom move.aimed-at, any of the four aims (a setting of the class, not a closure)
//             3. holder.randBattleSeedInt(100) < chance                                   atom rng.chance, LAST: the ONE random draw
//   apply: typeMultiplier = 0 and cancelled = true (the hit fails): effect.negate.
//
// SINGLE_TARGET_KINDS is { NEAR_OTHER, OTHER, NEAR_ENEMY, ENEMY_SIDE }. That is NOT the same set as the library atom
// move.target-kind "single" (OTHER, NEAR_OTHER, NEAR_ENEMY, RANDOM_NEAR_ENEMY): it contains ENEMY_SIDE and lacks RANDOM_NEAR_ENEMY. The exact
// set is spelled with the new atom `move.aimed-at` (one exact aim, in an any[...] group), so the gate reproduces it to the letter.
// Like ChanceStatusOnHitAbAttr and AteConditionalStatusAbAttr, the chance roll is the LAST atom of the gate (it only runs when the cheap
// checks before it passed) and the feasibility stays in the class.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ChanceDodgeAbAttr } from "#data/elite-redux/archetypes/chance-dodge";

export default defineDecl(ChanceDodgeAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.incoming-move",
  label: "Sometimes dodge an attack completely",
  summary: params =>
    `Each time an attack ${params.singleTargetOnly === true ? "aimed at one target " : ""}is about to hit me, there is a ${params.chance}% chance it misses completely. Example: 20 means 1 attack in 5.`,
  synonyms: ["evade", "dodge", "avoid attacks", "random miss", "evasion", "sidestep", "ole"],
  examples: ["20% chance to dodge single-target attacks"],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Dodge chance (%)",
      editable: true,
      default: 20,
    },
    {
      id: "singleTargetOnly",
      ctorIndex: 0,
      ctorOption: "singleTargetOnly",
      path: "singleTargetOnly",
      control: "boolean",
      label: "Only dodge attacks aimed at a single target (set by the conditions)",
      // A condition of the gate (the any-of-four-aims group), carried by the user's binding.
      editable: false,
      default: true,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is a group of atoms in the original order (bindings.ts): [any[move.aimed-at x4], rng.chance]. A rule without the
    // single-target setting is just [rng.chance]. The chance roll stays LAST, so a move that is not single-target draws nothing.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only attacking moves can be dodged (a status move is never dodged)",
    "A move I use myself is never dodged",
  ],
  effect: { id: "effect.negate", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "canApply",
    rngOrder: [
      "canApply gate: one roll of 100 against the chance, only after the self, attack-move and target checks passed (the chance atom is the last clause)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      name: "a single-target attack, a spread attack and a status move",
      axes: { foeMove: ["TACKLE", "SURF", "GROWL"] },
    },
  ],
  status: "exempt",
  notes:
    "EXEMPT UNTIL THE OWNER DECIDES (request R-B08-10b, dispatch): the declaration below is faithful to the class and now recomposable (Tier B: guards stay in the class, the gate is the single-target group then the chance roll, bound for Ole! in bindings.ts), but L2 cannot evaluate the attr in a battle because nothing dispatches it, so it is NOT claimed as decomposed and verified. The B08 test (test/tests/elite-redux/decomp/B08/chance-dodge.test.ts) drives canApply and apply on the original and the rebuild draw for draw, and proves with a spy that a real battle never calls the attr. Once the engine dispatches PreDefendAbAttr (or scans for the class), set the status back to decomposed and run L2. SUSPECTED GAME BUG, NOT FIXED: nothing ever dispatches this class. PreDefendAbAttr is excluded from the callable attr strings (@types/ability-types.ts) and no engine site scans for ChanceDodgeAbAttr by name, so Ole! (5304) has no effect in battle; the dispatcher comment says the primitive 'does the correct thing', which holds only if it were called. A spy in the B08 test confirms zero canApply calls over a real battle. SECOND ODDITY, NOT FIXED: the class's own single-target set contains ENEMY_SIDE and lacks RANDOM_NEAR_ENEMY (Outrage, Thrash and Petal Dance), unlike the library atom `move.target-kind single`; the new atom move.aimed-at reproduces the class set exactly. Differences between the library chance atom and the class that no live user reaches: the atom answers true without a draw when simulated and at 100 percent, while the class draws then (Ole! is 20 percent and canApply is never reached with a simulated call). `simulated`: canApply rolls even for a simulated call and apply ignores it. User: Ole! (5304, attr 0), bound.",
});
