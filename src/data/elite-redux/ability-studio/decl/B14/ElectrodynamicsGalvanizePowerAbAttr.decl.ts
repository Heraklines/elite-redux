/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 5. Tier A calc-modifier. "While the game calculates a move's power, if the move is one the Galvanize rule converts,
// multiply the power" (Electrodynamics: x1.2 on a converted Normal move, the standard -ate power rider).
//
// Source: fakemon-pitch-raichu.ts ElectrodynamicsGalvanizePowerAbAttr (extends MovePowerBoostAbAttr). No code of its own; the
// constructor handed the parent
//   condition = (user, _target, move) => canElectrodynamicsConvert(move, user), powerMultiplier = 1.2
// canApply is the parent's `this.condition(pokemon, opponent, move)`; apply is `power.value *= this.powerMultiplier`.
// The closure is EXACTLY the one of ElectrodynamicsGalvanizeAbAttr (the same function, so the type change and the power rider can
// never disagree); its five clauses are written out in ElectrodynamicsGalvanizeAbAttr.decl.ts. It is a LEGACY binding until the
// atoms of R-B14-5.4 to R-B14-5.7 exist. Nothing is random.
// Class edit (pure move of code): the condition and the multiplier are constructor arguments with the old values as defaults.
import { ElectrodynamicsGalvanizePowerAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-raichu";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ElectrodynamicsGalvanizePowerAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost power of the converted move (Electrodynamics style)",
  summary: params =>
    `The power of a Normal move that my type conversion turns into another type is multiplied by ${params.multiplier}. Example: 1.2 = 20% more, like Galvanize.`,
  synonyms: [
    "galvanize power",
    "electrodynamics",
    "ate ability boost",
    "converted move boost",
    "retyped move power",
    "type conversion power",
    "20 percent boost",
  ],
  examples: ["Normal moves that become Electric hit 20% harder, like Galvanize and Electrodynamics"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "powerMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.2 = 20% more, 0.5 = half)",
      editable: true,
      default: 1.2,
    },
  ],
  conditions: [{ slot: "ctor:0", ctx: "attack", removable: true, editable: true }],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "I use a Normal move", axes: { foeMove: ["TACKLE"] } }],
  l2StaticReason:
    "The condition binding is a legacy closure (four library atoms are missing), so the twin has no rebuilt attr to compare; B14/chunk5.test.ts compares the closure with a literal copy of the original rule over normal, Tera and -ate states and with the tree requested for the library.",
  status: "decomposed",
  notes:
    "Tier A calc-modifier; the effect is the library multiply-power. The ONE closure is the same function as ElectrodynamicsGalvanizeAbAttr's (legacy binding, atoms R-B14-5.4 to R-B14-5.7). Users (1): Electrodynamics (6062) attr 5. No oddity found: both closures are the same function, so the boost applies to exactly the moves the type change converts (the test compares them over every state). The ability-level conditions are none.",
});
