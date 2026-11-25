/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 1. Tier A, calc-modifier. "While the game calculates my move's power, IF the move is a Fighting move, multiply its power by 1.2."
//
// Source: src/data/elite-redux/abilities/barbaracle-mechanics.ts, class BrainOverBrawnPowerAbAttr (extends MovePowerBoostAbAttr; canApply is
// `this.condition(pokemon, opponent, move)`, the only clause; apply is `power.value *= powerMultiplier`; showAbility false, skipDuringMovesetGen false).
// The class used to be `constructor() { super(move.type === FIGHTING, 1.2) }` WITH an `apply` override that wrote
// `power = resolveBrainOverBrawnPower(power, move.type)` (x1.2 for a native Fighting move, unchanged otherwise). Two changes, both behaviour-neutral for
// every shipped use:
//   1. the constructor takes (condition, powerMultiplier) with the old values as defaults, so the closure is a constructor slot (ctor:0) and the number is a param;
//   2. the override is gone. It tested the move type a second time inside apply, so a rule with ANOTHER condition would have been silently ignored (the
//      override boosted only native Fighting moves whatever the condition said). The engine calls apply only after canApply is true, and the Fighting
//      condition is exactly the override's test, so the inherited `power *= 1.2` gives the same number (100 -> 120). The Endless Avalanche second apply
//      follows a successful canApply on the same move too. resolveBrainOverBrawnPower stays exported (a unit test reads it).
// Dispatch: Move.calculateBattlePower, key VariableMovePowerAbAttr (WHEN calc.move-power). No random draw, no state.
import { BrainOverBrawnPowerAbAttr } from "#data/elite-redux/abilities/barbaracle-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BrainOverBrawnPowerAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Boost the power of my Fighting moves (Brain Over Brawn)",
  summary: params =>
    `While the game calculates my move's power, a move that passes the condition gets its power multiplied by ${params.multiplier}. By default Fighting moves get x1.2 (100 power becomes 120).`,
  synonyms: [
    "brain over brawn",
    "fighting move boost",
    "power boost",
    "boost fighting moves",
    "stronger fighting moves",
    "base power multiplier",
  ],
  examples: ["My Fighting moves hit 20% harder", "Boost Water moves by 30%, like a custom Torrent-style bonus"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 1,
      path: "powerMultiplier",
      control: "number",
      min: 0,
      max: 10,
      step: 0.05,
      label: "Power multiplier (1.2 = 20% more power)",
      editable: true,
      default: 1.2,
    },
  ],
  conditions: [{ slot: "ctor:0", ctx: "attack", lib: "move.type", path: "condition", removable: true, editable: true }],
  guards: [],
  feasibility: ["Moves that deal a fixed amount of damage are not changed"],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The shared reach table lists calc.move-power as unreached because the engine dispatches the moment under the key VariableMovePowerAbAttr; the twin still compares every trace of the battle where the holder attacks.",
  probes: [{ name: "the holder attacks with a Fighting move and a Normal move", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A. 2 attrs: Bodhisattva (6076 attr 3) and Brain Over Brawn (6080 attr 1); both bind ctor:0 to move.type FIGHTING with effective false (the move's own printed type, same test as the closure). See the header for the removed apply override: it ignored the condition and the multiplier, so it was the one thing that would have made a recomposed rule lie. Pair: BrainOverBrawnTypeAbAttr. Not a bug: the power rider tests the NATIVE type, so it still boosts the move after the type attr turned it into Psychic (intended by the ability text).",
});
