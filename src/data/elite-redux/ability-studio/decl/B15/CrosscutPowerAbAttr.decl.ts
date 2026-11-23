/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Tier B, calc-modifier. "While the game calculates my move's power, a single-hit slicing or pulse move gets its power multiplied by 0.7."
//
// Source: src/data/elite-redux/abilities/crosscut.ts, class CrosscutPowerAbAttr (extends VariableMovePowerAbAttr; showAbility true).
// canApply is now `gate && residual` (gatedCanApply), in the ORIGINAL clause order, no guard (it does NOT call super, so skipDuringMovesetGen is not consulted):
//   1. gate       move.category !== STATUS                                         (condition: the move deals damage)
//   2. gate       move.hasFlag(SLICING_MOVE) || move.hasFlag(PULSE_MOVE)            (condition: slicing OR pulse, the PRINTED flag)
//   3. residual   move.canBeMultiStrikeEnhanced(pokemon, true, opponent)            (feasibility: not OHKO, charge, multi-hit or spread)
// apply: power.value *= powerMultiplier (default 0.7, CROSSCUT_POWER_MULTIPLIER). Constructor change (behaviour-neutral): the multiplier is a constructor argument.
// Dispatch: Move.calculateBattlePower, key VariableMovePowerAbAttr (WHEN calc.move-power). The rider applies to BOTH strikes. No random draw, no state.
// The gate is a LEGACY closure for the same reason as CrosscutSecondStrikeAbAttr: clause 2 is the printed flag (move.hasFlag), not doesFlagEffectApply.
import { CrosscutPowerAbAttr } from "#data/elite-redux/abilities/crosscut";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(CrosscutPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Multiply the power of my single-hit slicing and pulse moves",
  summary: params =>
    `While the game calculates my move's power, a single-hit damaging slicing or pulse move gets its power multiplied by ${params.multiplier}. Crosscut uses 0.7 so each of its two strikes is weaker.`,
  synonyms: [
    "crosscut power",
    "weaker strikes",
    "power multiplier",
    "slicing power",
    "pulse power",
    "reduce power of double strike",
  ],
  examples: ["Each of my two strikes lands at 70% power"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.05,
      label: "Power multiplier (0.7 = 30% less power)",
      editable: true,
      default: 0.7,
      gateIndependent: true,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "The move must be one that can be split into strikes: no one-hit KO moves, charge moves, spread moves or moves that already hit several times",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table lists calc.move-power as unreached because the engine dispatches the moment under the key VariableMovePowerAbAttr; the twin still compares every trace of the battle where the holder attacks.",
  probes: [{ name: "the holder attacks with a slicing move, a pulse move and a Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier B, gate LEGACY (pending request R-B15-6). 1 attr: Crosscut (5908 attr 1). Ready for the library: once a printed-flag atom exists the legacy binding becomes all[ move.damaging, any[ printed flag SLICING, printed flag PULSE ] ] with the same residual. Pair: CrosscutSecondStrikeAbAttr, which uses the same eligibility. Constructor change is behaviour-neutral (default 0.7). Power is multiplied as a float (no rounding here, the engine rounds later).",
});
