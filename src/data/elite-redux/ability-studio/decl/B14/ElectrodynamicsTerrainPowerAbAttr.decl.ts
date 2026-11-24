/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. Tier A calc-modifier. "While the game calculates a move's power, if my slot is charged and I do not have Psionic,
// multiply the power of my Electric moves" (Electrodynamics: x1.3 as if Electric Terrain were on).
//
// Source: fakemon-pitch-raichu.ts ElectrodynamicsTerrainPowerAbAttr (extends MovePowerBoostAbAttr). No code of its own; the
// constructor handed the parent
//   condition = (user, _target, move) => !user.hasAbility(PSIONIC) && getRaichuTerrainMoveMultiplier(user, user.getMoveType(move)) > 1
//   powerMultiplier = 1.3
// canApply is the parent's `this.condition(pokemon, opponent, move)`; apply is `power.value *= this.powerMultiplier`. Clause order of
// the closure: 1. I do not have Psionic (the two riders must not stack)  2. the terrain rule of getRaichuTerrainMoveMultiplier (see
// PsionicTerrainPowerAbAttr.decl.ts for its three clauses). With clause 1 true, the rule reduces to: the move's effective type is
// Electric, the real terrain is not Electric, I have Electrodynamics and my slot is charged (a charged slot also makes me count as
// grounded). Exact tree for the library, checked in B14/chunk5.test.ts:
//   all[ not has-ability Psionic, type Electric, not terrain Electric, has-ability Electrodynamics, slot-charged ]
// Nothing is random. The closure is a LEGACY binding until `field.slot-charged` (R-B14-5.2) and ER ability ids in the ability atom
// (R-B14-5.3) exist. Class edit (pure move of code): condition and multiplier are constructor arguments with the old values as defaults.
import { ElectrodynamicsTerrainPowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ElectrodynamicsTerrainPowerAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost move power from a charged slot (Electrodynamics style)",
  summary: params =>
    `The power of my Electric moves is multiplied by ${params.multiplier} while my battle slot is charged, as if Electric Terrain were on. Example: 1.3 = 30% more.`,
  synonyms: [
    "electrodynamics",
    "electric terrain boost",
    "charged slot power",
    "virtual electric terrain",
    "electric move boost",
    "terrain power boost",
    "slot power up",
  ],
  examples: ["Electric moves get the 30% Electric Terrain boost from my charged slot, like Electrodynamics"],
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
  conditions: [{ slot: "ctor:0", ctx: "attack", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "I attack with an Electric move from a charged slot", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The condition binding is a legacy closure (two library atoms are missing), so the twin has no rebuilt attr to compare; B14/chunk5.test.ts compares the closure with a literal copy of the original rule over every state of its clauses and with the formula requested for the library.",
  status: "decomposed",
  notes:
    "Tier A calc-modifier; the effect is the library multiply-power. The ONE closure is a legacy binding (needs `field.slot-charged` R-B14-5.2 and ER ability ids in the ability atom R-B14-5.3; the rest is existing atoms). Users (1): Electrodynamics (6062) attr 0; its other attrs are ElectrodynamicsPositionAbAttr (1, chunk 4), AttackTypeImmunityAbAttr GROUND (2), GroundedEntryHazardImmunityAbAttr (3), and the two Galvanize classes (4 and 5, this chunk). Oddities, not fixed: (1) the 'not Psionic' clause makes the ability give nothing to a holder that also has Psionic, because Psionic has its own rider; (2) the boost needs the charged slot, which is installed when Electrodynamics enters, so the rider never applies before that entry; (3) reading the charged slot refreshes module memory (resetBattleLocalState), so merely evaluating the closure can clear marks of an old battle. The ability-level conditions are none.",
});
