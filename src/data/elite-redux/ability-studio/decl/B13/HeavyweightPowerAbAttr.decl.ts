/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Heavyweight, part 1 of 2 (Tier B, package effect). "Heavy Slam, Heat Crash and punches gain 10% power per weight class I am above the target (up to 5)."
//
// Source: abilities/newcomer-signature-mechanics.ts, HeavyweightPowerAbAttr (MovePowerBoostAbAttr; the constructor now
// takes percentPerClass and maxClasses, defaults = the old literals, and still hands the base class a closure and 1).
//   canApply (the original closure, ONE clause, now the gate):
//     move.id === HEAVY_SLAM || move.id === HEAT_CRASH || move.hasFlag(PUNCHING_MOVE)
//       -> library atoms any( move.is-move HEAVY_SLAM, move.is-move HEAT_CRASH, move.flag PUNCHING_MOVE )
//   apply (overridden): power *= 1 + min(maxClasses, max(0, weightClass(holder) - weightClass(target))) * percent/100
//     weightClass(w) = how many of the weights 10, 25, 50, 100, 200 the weight w has reached.
// No RNG, no state. A "ctor:0" slot is impossible (arity 2 is two numbers), so this is Tier B with a gate and no residual.
import { HeavyweightPowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(HeavyweightPowerAbAttr, {
  tier: "B",
  kind: "package",
  when: "calc.move-power",
  label: "Boost power for each weight class I am above the target",
  summary: params =>
    `My move gains ${params.percentPerClass}% power for every weight class I am above the target, up to ${params.maxClasses} classes. Example: 3 classes above at 10% turn 100 power into 130.`,
  synonyms: [
    "weight advantage",
    "heavy slam boost",
    "heavier is stronger",
    "weight class bonus",
    "bulk power",
    "meteor mass",
  ],
  examples: ["Heavy Slam and punching moves hit harder the heavier I am compared to the target"],
  params: [
    {
      id: "percentPerClass",
      ctorIndex: 0,
      path: "percentPerClass",
      control: "number",
      label: "Extra power per weight class (percent)",
      editable: true,
      gateIndependent: true,
      default: 10,
      min: 0,
      max: 100,
      step: 5,
    },
    {
      id: "maxClasses",
      ctorIndex: 1,
      path: "maxClasses",
      control: "number",
      label: "Most weight classes that count",
      editable: true,
      gateIndependent: true,
      default: 5,
      min: 1,
      max: 5,
      step: 1,
      integer: true,
    },
  ],
  conditions: [
    // The whole original closure: Heavy Slam, Heat Crash or a punching move (library atoms, see bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A weight class counts how many of the weights 10, 25, 50, 100 and 200 kg a Pokemon has reached (fixed in the class), so 5 is the most classes that can ever differ",
  ],
  effect: { id: "effect.package", params: ["percentPerClass", "maxClasses"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json, request R-B13-12). The twin still shows the original evaluating this attr when a damaging move is used, and B13/heavyweight.test.ts drives the weight-class maths.",
  probes: [
    {
      // Heavy Slam, a punch and a plain move decide the one condition.
      name: "heavy, punching and ordinary moves",
      axes: { foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT only; the trigger (move power) and the move condition are separate and bound to library atoms. Why the effect cannot be split with today's blocks: the multiplier is computed from the LIVE weights of the holder and of the target (weight classes, capped), not a constant that effect.multiply-power can hold; requested as R-B13-16 (`effect.multiply-power-by-weight-difference`). Review of the numbers: 10% per class and the cap of 5 were literals, now trailing constructor arguments (defaults reproduce the old maths exactly, 10/100 equals 0.1 in floating point) and params; the five weight thresholds stay fixed in the class. Users: Heavyweight (5982, attr 0) and Meteor Mass (5997, attr 1; its first attr is a weight multiplier of 3 that raises the holder's weight class). The shipped ability text says 'up to 50%': that is maxClasses 5 x 10%. Bound gate: the punching atom move.flag asks doesFlagEffectApply while the class asks move.hasFlag; for PUNCHING_MOVE no ability injects the flag today, so the two agree (L1 compares them over the grid). ODDITIES (not fixed): apply has no side effects, so simulated calls make no difference. The ability text promises 'weight-based moves' but only Heavy Slam and Heat Crash are included, not Low Kick or Grass Knot.",
});
