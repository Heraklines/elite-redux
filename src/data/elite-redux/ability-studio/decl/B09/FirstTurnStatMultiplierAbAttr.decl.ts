/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { STAT_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
// B09 chunk 2. "A stat is multiplied until I have used my first move after entering" (Violent Rush, Rapid Response, Showdown Mode,
// Champion's Entrance).
//
// Source: src/data/elite-redux/archetypes/first-turn-stat-multiplier.ts, class FirstTurnStatMultiplierAbAttr (extends
// StatMultiplierAbAttr). Dispatched from Pokemon.getEffectiveStat and the accuracy helpers (see StatMultiplierAbAttr).
// Clauses of the original canApply, in order:
//   1. `super.canApply(params)`: `stat === this.stat && (!condition || condition(...))`; this subclass never gives the
//      parent a closure, so it is just "the stat the game asks about is the boosted one"                    -> guards()
//   2. `history = pokemon.summonData?.moveHistory; return !history || history.length === 0`   the holder has not used any
//      move since it came in (not the same as "turn 1": a Pokemon that sleeps through its first turn keeps the boost into
//      later turns, and one that moved on turn 1 loses it for the rest of that turn)                         -> gate (IF)
// apply is the parent's: `statVal.value *= multiplier`. No random draw, no `simulated`, no state of its own.
// Constructor: ({ stat, multiplier }), one options object. Tier B: guards = clause 1, gate = clause 2.
//
// All 8 gate bindings are legacy-closure: no library atom reads the move history for "I have not used a move since I came in"
// (R-B09-06). time.first-turn is NOT that test (it is waveTurnCount === 1).
import { FirstTurnStatMultiplierAbAttr } from "#data/elite-redux/archetypes/first-turn-stat-multiplier";
import { Stat } from "#enums/stat";

export default defineDecl(FirstTurnStatMultiplierAbAttr, {
  tier: "B",
  kind: "calc-modifier",
  when: "calc.stat-value",
  label: "Multiply a stat until I have used a move",
  summary: params =>
    `Until I have used a move since entering, my ${params.stat} is multiplied by ${params.multiplier}. Example: 1.5 = 50% higher, like Violent Rush's Speed.`,
  synonyms: [
    "violent rush",
    "rapid response",
    "showdown mode",
    "champion's entrance",
    "first turn speed",
    "first turn attack",
    "opening boost",
    "stat boost on entry",
  ],
  examples: ["Speed x1.5 until I have moved, like Violent Rush", "Double my Attack until my first move"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      ctorOption: "stat",
      path: "stat",
      control: "select",
      label: "Which stat (Attack, Defense, Sp. Atk, Sp. Def or Speed)",
      editable: true,
      // The gate never reads it; only the guard (the parent's stat test) and the effect do.
      gateIndependent: true,
      default: "SPD",
      options: STAT_OPTIONS,
      codec: enumCodec(Stat, "stat"),
    },
    {
      id: "multiplier",
      ctorIndex: 0,
      ctorOption: "multiplier",
      path: "multiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Stat multiplier (1.5 = 50% higher, 0.5 = half)",
      editable: true,
      gateIndependent: true,
      default: 1.5,
    },
  ],
  conditions: [
    // The gate: "I have not used any move since I came in". All 8 users are legacy-closure (bindings.ts).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Only the chosen stat is changed; accuracy and evasion count as stats here too"],
  effect: { id: "effect.multiply-stat", params: ["stat", "multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    {
      name: "the damage stat is asked while the foe uses a physical and a special move",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 8 attrs in 4 abilities, every gate legacy-closure pending request R-B09-06: Violent Rush (5088 attr 0 Speed x1.5, attr 1 Attack x1.2), Showdown Mode (5270 attr 1 Speed x1.5, attr 2 Attack x1.2), Rapid Response (5288 attr 0 Speed x1.5, attr 1 Sp. Atk x1.2), Champion's Entrance (5467 attr 1 Speed x1.5, attr 2 Attack x1.2). The class never reads `simulated`. The first-turn test is `summonData.moveHistory` empty, so it differs from the atom time.first-turn (waveTurnCount): a Pokemon that stays in on turn 2 without having moved (asleep, flinched, recharging) still gets the boost, and one that moves on turn 1 loses it for the rest of that turn. Suspected game oddity, not fixed: the comment of the class says it mirrors ER's isFirstTurn, which is turn-based. The parent's stat test is run first (guards) to keep the original clause order.",
});
