/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Eclipse Wing, part 1 of 3 (Tier B, calc-modifier). "Below a third of my HP, my Dark and Flying moves have 1.5x power."
//
// Source: abilities/newcomer-signature-mechanics.ts, EclipseWingPowerAbAttr (MovePowerBoostAbAttr). The constructor used to be
// `super((pokemon, _target, move) => pokemon.getHpRatio() < 1 / 3 && [DARK, FLYING].includes(pokemon.getMoveType(move)), 1.5)`;
// it is now `constructor(powerMultiplier = 1.5) { super(() => true, powerMultiplier) }`.
//   canApply, the original closure, two pure clauses (no RNG, no side effect), now gate && residual:
//     gate      [DARK, FLYING].includes(holder.getMoveType(move))     -> library atoms any(move.type DARK, move.type FLYING)
//     residual  holder.getHpRatio() < 1 / 3                           (originally FIRST; swapping two pure clauses changes no result)
//       getHpRatio() is Math.round(hp / maxHp * 100) / 100 (field/pokemon.ts:2432), so it reads "my HP in whole percents is
//       33% or less"; the library's hp.at-most uses integer math and differs at the boundary (R-B13-47).
//   apply is the base class's: power.value *= powerMultiplier.
import { EclipseWingPowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EclipseWingPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost Dark and Flying moves while my HP is low",
  summary: params =>
    `While the game calculates a move's power, my Dark and Flying moves have ${params.multiplier} times their power as long as I am below a third of my HP. Example: 100 power becomes ${Math.round(100 * Number(params.multiplier))}.`,
  synonyms: [
    "low hp boost",
    "last stand power",
    "dark and flying boost",
    "desperation",
    "blaze style",
    "pinch power",
    "eclipse wing",
  ],
  examples: ["Dark and Flying moves get 1.5x power when I am nearly knocked out, like Eclipse Wing"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      label: "Power multiplier (times)",
      editable: true,
      gateIndependent: true,
      default: 1.5,
      min: 0,
      max: 8,
      step: 0.05,
    },
  ],
  conditions: [
    // The type rule of the original closure: the move is Dark or Flying (library atoms, see bindings.ts). The HP rule is the residual.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "My HP, rounded to a whole percent, must be below a third of my max HP",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json, request R-B13-12). The twin still shows the original evaluating this attr when a damaging move is used, and B13/chunk5.test.ts drives the HP boundary at several max HP values.",
  probes: [
    {
      // The 33% boundary (rounded to whole percents) is the interesting one; L1 runs every value at several max HP sizes.
      name: "HP around a third of max HP",
      axes: { hp: ["34%", "33%", "max"], foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Fully decomposed: trigger 'while the game calculates a move's power', effect 'multiply the move's power' (library effect, the multiplier is a param), condition 1 = the move is Dark or Flying (editable gate, library atoms), condition 2 = 'my HP is below a third' (stays in the class as the residual, because getHpRatio() rounds to a whole percent and no library atom does the same; requested as R-B13-47 `hp.below-rounded`, the strict twin of R-B13-31). The 1.5 was a literal, now constructor argument 0. Users: Eclipse Wing (5971, attr 0; attr 1 is the turn-end faint, attr 2 the marker). ODDITIES (not fixed): (1) because of the rounding, 33.4% HP counts as 33% and is below a third while 33.4% in exact math is not; (2) the type is read with getMoveType, so a move whose type was changed by another ability uses the changed type.",
});
