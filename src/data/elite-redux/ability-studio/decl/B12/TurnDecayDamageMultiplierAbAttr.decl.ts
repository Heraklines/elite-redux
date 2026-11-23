/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 3. "My moves get weaker every turn I stay in, down to a floor; switching out resets it" (Lethargy).
//
// Source: src/data/elite-redux/archetypes/turn-decay-damage-multiplier.ts, TurnDecayDamageMultiplierAbAttr (extends MovePowerBoostAbAttr).
// Constructor: one options object `{ start?, drop, floor }`. It hands `() => true` and `start` to the parent, so the parent's condition always
// passes (that closure is built inside the constructor, it is not an argument staff could replace: there is nothing to bind).
// Dispatched while a move's power is calculated (applyAbAttrs("MovePowerBoostAbAttr")). Clauses:
//   canApply  the parent's condition, which is always true                      no condition
//   apply     `turn = tempSummonData.turnCount ?? 0`; `power *= max(floor, start - turn * drop)`   EFFECT (calc)
// No random draw, no state of its own (the turn counter is the game's, reset on switch-in). It does not look at `simulated`: the result is only
// the power value.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { TurnDecayDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/turn-decay-damage-multiplier";

const IN_OPTIONS = { ctorIndex: 0 } as const;

export default defineDecl(TurnDecayDamageMultiplierAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Make my moves weaker every turn I stay in",
  summary: params =>
    `My moves' power is x${params.start} minus ${params.drop} for every turn I have been in, but never below x${params.floor}. It starts over when I switch in. Example: 1, 0.2, 0.2 like Lethargy.`,
  synonyms: [
    "lethargy",
    "power fades",
    "weaker each turn",
    "damage decay",
    "slow start",
    "tire out",
    "diminishing damage",
  ],
  examples: [
    "My damage drops by 20% of normal each turn I stay in, down to 20%, and resets on switch-in, like Lethargy",
  ],
  params: [
    {
      id: "start",
      ...IN_OPTIONS,
      ctorOption: "start",
      path: "startMul",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier before any turn has passed (1 = normal power)",
      editable: true,
      default: 1,
    },
    {
      id: "drop",
      ...IN_OPTIONS,
      ctorOption: "drop",
      path: "dropMul",
      control: "number",
      min: 0,
      max: 1,
      step: 0.01,
      label: "Power lost every turn (0.2 = the multiplier falls by 0.2 each turn)",
      editable: true,
      default: 0.2,
    },
    {
      id: "floor",
      ...IN_OPTIONS,
      ctorOption: "floor",
      path: "floorMul",
      control: "number",
      min: 0,
      max: 4,
      step: 0.05,
      label: "Lowest the multiplier can fall to (0.2 = one fifth of normal power)",
      editable: true,
      default: 0.2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [],
  // No library effect changes power by the number of turns passed (R-B12-24); it is shown as one piece until it exists.
  effect: { id: "effect.package", params: ["start", "drop", "floor"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [{ name: "the holder's damaging move at the start and after turns", axes: {} }],
  l2StaticReason:
    "The shared L2 only runs short battles and has no scenario that reaches several end-of-turn counts for a calc.move-power twin; B12's own test (B12/chunk3.test.ts) sets the turn counter 0 to 12 on the original and the rebuild and compares the resulting power.",
  status: "decomposed",
  notes:
    "Tier A, 1 attr, nothing to bind (the parent's 'always true' condition is built inside the constructor): Lethargy (5131 attr 0; start 1, drop 0.2, floor 0.2). No condition exists in the class, so staff may AND extra conditions onto it. The effect is 'effect.package' because the multiplier changes with the turn counter and no library effect does that (R-B12-24, 'Multiply power by a number that shrinks or grows each turn'); the three numbers are typed params and the turn counter is the game's own (tempSummonData.turnCount). Oddities, not fixed: (a) turnCount starts at 1 on the entry turn (it rises by one at the end of each turn and is lowered by one on a mid-turn switch-in), so Lethargy's first turn already has one drop (x0.8) and the 'start' value is only reached at turn 0, which never happens; the floor of 0.2 is reached on the fourth turn; (b) `power.value *= mul` is not rounded, and the parent's own multiplier getter still reports the start value (1) although the class overrides apply; (c) fixed-damage moves are not touched, as for every power boost.",
});
