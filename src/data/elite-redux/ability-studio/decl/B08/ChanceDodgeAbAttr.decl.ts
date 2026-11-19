/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / calc-modifier, Tier C, status exempt (the engine never dispatches the class, see notes). Read from the source (archetypes/chance-dodge.ts):
//
//   canApply, in order:
//     1. attacker === holder, or the move is not an AttackMove  -> false          (feasibility: never dodge my own move or a status move)
//     2. singleTargetOnly && !SINGLE_TARGET_KINDS.has(move.moveTarget) -> false   (a setting of the class, not a closure)
//     3. holder.randBattleSeedInt(100) < chance                                   (the ONE random draw, last)
//   apply: typeMultiplier = 0 and cancelled = true (the hit fails).
//
// SINGLE_TARGET_KINDS is { NEAR_OTHER, OTHER, NEAR_ENEMY, ENEMY_SIDE }. That is NOT the same set as the library atom
// move.target-kind "single" (OTHER, NEAR_OTHER, RANDOM_NEAR_ENEMY), so it is a param and not an atom (see
// requests/B08.md R-B08-5).
//
// The roll is never split from the dodge it gates (spec 2.3 rule 4), so this is Tier C: two typed params, one effect.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ChanceDodgeAbAttr } from "#data/elite-redux/archetypes/chance-dodge";

export default defineDecl(ChanceDodgeAbAttr, {
  tier: "C",
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
      label: "Only dodge attacks aimed at a single target",
      editable: true,
      default: true,
    },
  ],
  conditions: [],
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
      "canApply: one roll of 100 against the chance, only after the self, attack-move and target checks passed",
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
    "EXEMPT UNTIL THE OWNER DECIDES (request R-B08-10, dispatch): the declaration below is faithful to the class, but L2 cannot evaluate the attr in a battle because nothing dispatches it, so it is NOT claimed as decomposed and verified. The B08 test (test/tests/elite-redux/decomp/B08/chance-dodge.test.ts) drives canApply and apply on the original and the rebuild draw for draw, and proves with a spy that a real battle never calls the attr. Once the engine dispatches PreDefendAbAttr (or scans for the class), set the status back to decomposed and run L2. SUSPECTED GAME BUG, NOT FIXED: nothing ever dispatches this class. PreDefendAbAttr is excluded from the callable attr strings (@types/ability-types.ts) and no engine site scans for ChanceDodgeAbAttr by name, so Ole! (5304) has no effect in battle; the dispatcher comment says the primitive 'does the correct thing', which holds only if it were called. A spy in the B08 test confirms zero canApply calls over a real battle. Tier C because the chance roll must stay with the dodge it gates. `simulated`: canApply rolls even for a simulated call and apply ignores it. User: Ole! (5304, attr 0), nothing to bind.",
});
