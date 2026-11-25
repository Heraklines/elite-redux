/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Demolitionist and Readied Action (Tier B). "While the game calculates my move power, IF it is my first turn out AND the
// move deals damage, multiply the power".
//
// Source: ability-upgrades/attrs/first-turn-direct-damage.ts over MovePowerBoostAbAttr (ab-attrs.ts:1886).
// The condition used to be a closure built INSIDE the constructor, so it was not a constructor argument and could not be
// swapped from outside. It is now the class's `gate` (the same function the closure calls: `isFirstTurnDamagingMove`), and
// canApply is `gatedCanApply` (no guards, no residual). The constructor still hands the same closure to the parent, so the
// parent's own data (power multiplier, fixed-damage flag) is unchanged.
//
//   gate    holder.tempSummonData.waveTurnCount === 1  &&  move.category !== STATUS     (in this order, no draw)
//   apply   power.value *= multiplier   (the parent's apply; `appliesToFixedDamage()` is true, so a direct fixed-damage
//           move such as Dragon Rage is scaled too, in the engine code that reads that flag)
import { FirstTurnDirectDamageMultiplierAbAttr } from "#data/elite-redux/ability-upgrades/attrs/first-turn-direct-damage";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(FirstTurnDirectDamageMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Hit harder with damaging moves on my first turn out",
  summary: params =>
    `On the first turn after I come in, my damaging moves have their power multiplied by ${params.multiplier}. Example: 2 means double power.`,
  synonyms: [
    "first turn boost",
    "opening strike",
    "demolitionist",
    "readied action",
    "power up on entry",
    "hit hard on arrival",
    "double power first turn",
  ],
  examples: ["Double the power of my attacks on my first turn out, like Demolitionist"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "multiplier",
      control: "number",
      min: 0.05,
      max: 8,
      step: 0.05,
      label: "Power multiplier (2 = double, 0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 2,
    },
  ],
  conditions: [
    // The gate is the group [time.first-turn, move.damaging], in that order (bindings.ts). No single atom.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "an attack and a status move against a foe", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  l2StaticReason:
    "The twin template for this trigger never evaluates this attr of the holder (see decomp-l2-reach.json), so the battle twin would prove nothing; B18/chunk1.test.ts compares the gate with the class on turn 1 and turn 2 and runs the real move power calculation of a Readied Action holder.",
  status: "decomposed",
  notes:
    "Tier B because the test was a closure created inside the constructor (no constructor argument), so the Tier A route (bind a closure) is not available; the gate/residual split exposes it. There is no guard and no residual: both clauses are conditions staff may change. time.first-turn is `waveTurnCount === 1` exactly like the original (its formula text says <= 1 but the evaluator uses === 1). The multiplier is stored twice (the parent's powerMultiplier, used by apply, and this class's multiplier, used by getMultiplier); both come from the one constructor argument, and the L1 identity check compares both. appliesToFixedDamage() is true for this class (it is read by the damage engine, not by this class). Users: Readied Action (5278, attr 0), Demolitionist (5320, attr 0), both x2. The engine also reads this class a second time through the fixed-damage path (pokemon.ts:5945 dispatches MovePowerBoostAbAttr with the fixed damage as the power, filtered by appliesToFixedDamage), so the multiplier also scales fixed-damage moves such as Dragon Rage; the L2 trace only exercises the normal power path. waveTurnCount starts at 1 for every summon and wave (pokemon-data.ts:512, pokemon.ts:8187), so the test is true for the first turn of each stay.",
});
