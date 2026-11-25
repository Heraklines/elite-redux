/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. Tier A calc-modifier. "While the game calculates a move's power, if the rule holds, multiply it" (Psionic: x1.3 for
// an Electric or Psychic move whose terrain is only virtual).
//
// Source: fakemon-pitch-raichu.ts PsionicTerrainPowerAbAttr (extends MovePowerBoostAbAttr, dispatched as the move-power hook).
// The class has no code of its own; the constructor handed the parent
//   condition = (user, _target, move) => getRaichuTerrainMoveMultiplier(user, user.getMoveType(move)) > 1, powerMultiplier = 1.3
// and the parent does the work:
//   canApply  `this.condition(pokemon, opponent, move)`   (the ONE condition, ctor:0; there is no guard)
//   apply     `power.value *= this.powerMultiplier`
// Clause breakdown of the closure (getRaichuTerrainMoveMultiplier, fakemon-pitch-raichu.ts), with T = Electric for an Electric move,
// Psychic for anything else, and E = the effective move type `user.getMoveType(move)`:
//   a. isRaichuTerrainActiveForMove: E must be Electric or Psychic, and (the real terrain is T  OR  I have Psionic  OR
//      (T is Electric AND I have Electrodynamics AND my slot is charged))
//   b. the real terrain must NOT be T          (the real terrain is boosted by the game itself; this rider is only for a virtual one)
//   c. isRaichuTerrainGrounded: I am grounded  OR  (my slot is charged AND (T is Electric OR I have Psionic))
// Nothing is random. The reads of `isElectrodynamicsPosition` call resetBattleLocalState(), which refreshes module memory.
//
// Tier A: the condition is a constructor closure. The class edit (a pure move of code) makes it, and the multiplier, constructor
// arguments with the old values as defaults, so `builder.attr(PsionicTerrainPowerAbAttr)` builds the same attr as before.
// The closure binding is LEGACY: two atoms are missing (a charged slot, and "has the ability" for an ER ability id), see requests/B14.md
// R-B14-5.2 and R-B14-5.3. With them the exact tree is (checked against the original in B14/chunk5.test.ts):
//   all[ any[ all[type Electric, not terrain Electric], all[type Psychic, not terrain Psychic] ],
//        any[ has-ability Psionic, all[type Electric, has-ability Electrodynamics, slot-charged] ],
//        any[ grounded, all[ slot-charged, any[ type Electric, has-ability Psionic ] ] ] ]
import { PsionicTerrainPowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PsionicTerrainPowerAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost move power from a virtual terrain (Psionic style)",
  summary: params =>
    `The power of my Electric and Psychic moves is multiplied by ${params.multiplier} when their terrain is not really on the field but counts for me. Example: 1.3 = 30% more.`,
  synonyms: [
    "psionic",
    "terrain power boost",
    "psychic terrain boost",
    "electric terrain boost",
    "virtual terrain",
    "terrain move boost",
    "as if terrain were on",
  ],
  examples: ["Electric and Psychic moves get the 30% terrain boost even without the terrain, like Psionic"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "powerMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.3 = 30% more, 0.5 = half)",
      editable: true,
      default: 1.3,
    },
  ],
  conditions: [
    // ctor:0 = the closure above. Legacy until a charged-slot atom and an ER-ability atom exist.
    { slot: "ctor:0", ctx: "attack", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "I attack with an Electric and a Psychic move", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The condition binding is a legacy closure (two library atoms are missing), so the twin has no rebuilt attr to compare; B14/chunk5.test.ts compares the closure with a literal copy of the original rule over every state of its clauses and with the formula requested for the library.",
  status: "decomposed",
  notes:
    "Tier A calc-modifier; the effect is the library multiply-power (the parent's `power.value *= powerMultiplier`). The ONE closure is a legacy binding: it needs `field.slot-charged` (R-B14-5.2) and the ability atom to accept ER ability ids (R-B14-5.3); everything else of it is existing atoms (move type with ability changes, terrain, grounded). Users (1): Psionic (6063) attr 0 (the ability has no other attr). Oddities, not fixed: (1) the closure also tests `hasAbility(Psionic)`, which is always true while this attr is applying, so for the shipped ability the 'active' clause reduces to 'true'; (2) a holder that is neither grounded nor in a charged slot (a flyer) gets nothing even though Psionic is meant to give a virtual Psychic terrain; (3) Electrodynamics' own rider (ElectrodynamicsTerrainPowerAbAttr) skips a holder that has Psionic so the two do not stack, which is why it is a separate class; (4) reading the charged slot refreshes module memory (resetBattleLocalState), so merely evaluating the closure can clear marks of an old battle. The ability-level conditions are none.",
});
