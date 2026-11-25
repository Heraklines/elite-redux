/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Reduction, the only class of the ability (Tier B, calc-modifier). "A move that just consumed the field has 1.5x power."
//
// Source: abilities/newcomer-signature-mechanics.ts, ReductionPowerAbAttr (MovePowerBoostAbAttr). The constructor used to be
// `super((pokemon, _target, move) => { const state = REDUCTION_ACTIVE.get(pokemon); return state?.move === move && state.turn === turnKey(); }, 1.5)`;
// it is now `constructor(powerMultiplier = 1.5) { super(() => true, powerMultiplier) }` and the rule moved into the gate.
//   canApply now (ONE clause, pure, no RNG): the gate `REDUCTION_ACTIVE[holder].move === move && .turn === "wave:turn"`, i.e.
//   prepareReductionMove already consumed the field for exactly this move on this turn.
//   apply is the base class's: power.value *= powerMultiplier.
// The rest of the ability is NOT in this class: prepareReductionMove (called by name from phases/move-effect-phase.ts:229,
// finishReductionMove at :1254) looks for this class BY NAME (hasAttr "ReductionPowerAbAttr"), gives a damaging move the field's
// second type and removes the terrain and the non-primal weather.
import { ReductionPowerAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ReductionPowerAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost a move that just used up the weather or terrain",
  summary: params =>
    `While the game calculates a move's power, the move that just used up the weather or terrain has ${params.multiplier} times its power. Example: 100 power becomes ${Math.round(100 * Number(params.multiplier))}.`,
  synonyms: [
    "consume the weather",
    "use up the terrain",
    "field eater power",
    "weather boost",
    "terrain boost",
    "power from the field",
    "reduction",
  ],
  examples: ["My next attack is 1.5x stronger when it eats the weather or terrain"],
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
    // The whole original closure: "the field was consumed for this very move this turn". No library atom reads that memory yet.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The weather or terrain is used up by the game just before the move (it needs an active terrain or a normal weather and a damaging move), not by this block",
    "Only the very move that used up the weather or terrain gets the boost, and only on that turn",
  ],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  l2StaticReason:
    "The trigger's registered dispatch key (MovePowerBoostAbAttr) is never dispatched by the engine, which dispatches VariableMovePowerAbAttr, so the shared reach probe cannot see it (decomp-l2-reach.json, request R-B13-12). The twin still shows the original evaluating this attr when a damaging move is used, and B13/chunk5.test.ts drives the real armed state.",
  probes: [
    {
      // Without terrain or weather nothing is consumed, so the gate stays closed; the armed case is in B13/chunk5.test.ts.
      name: "damaging moves with and without a field to consume",
      axes: { weather: ["RAIN"], foeMove: ["TACKLE"] },
    },
  ],
  status: "decomposed",
  notes:
    "Fully decomposed for what the class does: trigger 'while the game calculates a move's power', effect 'multiply the move's power' (library effect, the multiplier is a param, the base apply is exactly `power *= multiplier`), condition = 'the field was consumed for this move' (legacy-closure gate until R-B13-48 adds the atom, which reads the memory prepareReductionMove writes). The 1.5 was a literal, now constructor argument 0. NOT decomposable here: the consuming step itself (prepareReductionMove / finishReductionMove, called by name from move-effect-phase.ts) which adds the field's second type, clears the terrain and the non-primal weather and queues a message; it finds this class by name, so the class name must not change. Requested: R-B13-48 (an armed-for-this-move atom, shared in spirit with R-B13-22) and R-B13-49 (a WHEN 'Before I use a damaging move' plus effects 'Add a second type to my move' and 'Remove the weather and terrain'). Users: Reduction (5991, attr 0). ODDITIES (not fixed): (1) the gate keeps a memory entry until finishReductionMove runs, so a move that never reaches that call leaves the boost armed until the next turn key; (2) the ability text says 'terrain determines the added type when both were consumed', which reductionSecondaryType() implements outside this class.",
});
