/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / event-effect (Tier B: "the boost timer is running" is the gate inside canApply).
//
// Read by hand from archetypes/power-boost-on-ally-faint.ts. Third of the three cooperating attrs of Avenger and Cursed Spirit:
// it counts the timer that the trigger attr armed down. PostTurn hook (WHEN "at the end of every turn"), no constructor of its
// own (`super()`).
//   canApply is now the gate alone (nothing is left as a residual):
//     gate: `isActive(pokemon)` = the holder's timer (a Symbol-keyed number on the Pokemon) is above 0   (CONDITION)
//   apply: not when simulated. Then the timer becomes `max(0, timer - 1)`. No random draw.
//
// The gate reads the private Symbol timer, which no library atom can read (request R-B11-C1-09), so both users are bound as legacy
// closures: reusable as a whole, swappable by staff, counted as undecomposed. The effect is one piece: counting a timer down has
// no library effect (request R-B11-C1-11) and it has nothing to set (one tick per turn end is what a turn clock is).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AllyFaintPowerBoostExpireAbAttr } from "#data/elite-redux/archetypes/power-boost-on-ally-faint";

export default defineDecl(AllyFaintPowerBoostExpireAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.end-of-turn",
  label: "Count the teammate-faint boost down at the end of each turn",
  summary: () =>
    "At the end of every turn, while the boost timer runs, it loses one turn, so a boost of 2 lasts through the next full turn and then stops.",
  synonyms: [
    "avenger timer",
    "cursed spirit timer",
    "boost runs out",
    "tick down the boost",
    "end the boost after a turn",
  ],
  examples: ["The power boost from a fainted teammate ends after the following turn"],
  params: [],
  noParamsReason:
    "The effect removes exactly one turn from the timer at each turn end; there is no number, stat, type or status to set. How long the boost lasts is the setting of the block that starts it.",
  conditions: [
    // "My teammate-faint boost timer is running" (a legacy closure for now, see the header). Staff swap it for any condition.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: ["Never in a preview", "The timer never goes below 0"],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      name: "two quiet turns at full HP and at half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  l2StaticReason:
    "The timer is never armed in an L2 battle (no teammate faints while the holder is out), so the gate is false for both versions and the legacy gate cannot be rebuilt by the shared twin. test/tests/elite-redux/decomp/B11/chunk1.test.ts drives the original and the rebuild with the timer at 0, 1 and 2.",
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Users: Avenger (5030 attr 2) and Cursed Spirit (6095 attr 3); the gate is a legacy closure on both. The class also has a public `turnsRemaining(pokemon)` test helper that reads the same timer.",
});
