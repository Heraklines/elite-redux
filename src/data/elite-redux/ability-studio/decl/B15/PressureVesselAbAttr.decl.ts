/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 4. Tier B, calc modifier, package for the effect only. "While the game calculates my Defense or Sp. Def, multiply it by an amount that grows with the PP I have left (x1.0 with none, x1.5 with all)."
//
// Source: src/data/elite-redux/abilities/pressure-vessel.ts, class PressureVesselAbAttr (extends StatMultiplierAbAttr; super(Stat.DEF, 1) with showAbility false; the base multiplier 1 and
// the base stat DEF are ignored). It overrides canApply, now guards && gate && residual in the ORIGINAL clause order (no draw):
//   1. gate      stat === Stat.DEF || stat === Stat.SPDEF                                              -> CONDITION (which stat)
//   (no guard, no residual)
// apply (effect): statVal *= multiplierFor(holder) = min + (max - min) * fraction, with fraction = clamp(sum of current PP / sum of maximum PP over my whole move list, 0, 1)
//   (a move with unlimited PP (getMovePp() <= 0) or an unresolved move id is skipped in BOTH sums; no PP-bearing move at all -> fraction 1). Pure read of PP: no draw, no state, no message.
// Constructor change (behaviour-neutral): the two ends of the scale are constructor arguments (default 1.0 and 1.5, the old module constants).
// Refactor (pure move of code, spec 3.1): canApply = gatedCanApply(this, params); `gate` is the clause above verbatim. `gateOverride` is declared for the compiler.
import { PressureVesselAbAttr } from "#data/elite-redux/abilities/pressure-vessel";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PressureVesselAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Raise Defense and Sp. Def the more PP I have left",
  summary: params =>
    `Defense and Sp. Def are multiplied by x${params.maxMultiplier} with all my PP left and x${params.minMultiplier} with none, in a straight line between (half the PP left = x${(Number(params.minMultiplier) + Number(params.maxMultiplier)) / 2}).`,
  synonyms: [
    "pressure vessel",
    "more pp more defense",
    "defense from pp",
    "bulk from remaining pp",
    "pp based defense",
    "scale defense with pp",
  ],
  examples: ["My bulk is x1.5 with every move at full PP and fades to normal as the PP runs out, like Pressure Vessel"],
  params: [
    {
      id: "minMultiplier",
      ctorIndex: 0,
      path: "minMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Multiplier with no PP left (1 = no change)",
      editable: true,
      gateIndependent: true,
      default: 1,
    },
    {
      id: "maxMultiplier",
      ctorIndex: 1,
      path: "maxMultiplier",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Multiplier with all PP left (1.5 = 50% more)",
      editable: true,
      gateIndependent: true,
      default: 1.5,
    },
  ],
  conditions: [
    // The gate is the stat clause (the stat being calculated is Defense or Sp. Def). No library atom reads the stat slot yet (R-B15-28).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The PP share is the PP left of every move added up, divided by the maximum PP of every move added up",
    "A move with unlimited PP, or one that could not be loaded, is left out of both totals",
    "With no move that uses PP the share counts as full",
    "It is worked out again every time the game calculates the stat",
  ],
  effect: { id: "effect.package", params: ["minMultiplier", "maxMultiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // A special and a physical hit make the game ask for Sp. Def and Defense; the PP fractions themselves are driven in the chunk test.
      name: "a special and a physical hit on the holder",
      axes: { foeMove: ["WATER_GUN", "BITE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the effect, justified; the trigger (calculating one of my stats) is a separate WHEN and the stat clause is a separate gate. 1 attr in 1 ability: Pressure Vessel (5914 attr 0, 1.0 to 1.5). The effect cannot be split because the library has no way to scale a stat by the PP share: effect.multiply-stat takes one fixed number, and there is no value block 'the share of my PP that is left'; requested as R-B15-29 (effect 'Multiply a stat by an amount that grows with the PP I have left', both ends typed). The gate is bound as a legacy closure because no atom reads the stat being calculated; requested as R-B15-28 (condition 'The stat being calculated is {stat}', Defense or Sp. Def here). Both scale ends are typed settings (constructor arguments with the old constants as defaults). Suspected oddities, NOT fixed: (1) the class extends StatMultiplierAbAttr but ignores the inherited stat and multiplier (DEF and 1) and the inherited condition, so the base fields are decoration; (2) the stat gate lists DEF and SPDEF only, so the ability text 'Defense and Sp. Def' matches; (3) the factor is recomputed per call from live PP, so using a move changes the bulk at once.",
});
