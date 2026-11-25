/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 1 / calc-modifier (Tier A: "while the boost timer runs" is a constructor closure).
//
// Read by hand from archetypes/power-boost-on-ally-faint.ts and MovePowerBoostAbAttr in ab-attrs.ts. It extends
// MovePowerBoostAbAttr (WHEN "while the game calculates a move's power"). Second of the three cooperating attrs of Avenger and
// Cursed Spirit. The constructor is now `(factor = 1.5, condition?)` and calls `super(condition, factor, true)` (shows the
// ability banner). The closure sits at constructor argument 1 (slot ctor:1, parent field `condition`); its DEFAULT is the old
// `user => isActive(user)`: the holder's teammate-faint timer is above 0. The argument was added with that default so the
// shipped call `new AllyFaintPowerBoostAbAttr(1.5)` behaves exactly as before.
//   canApply: the parent's `condition(holder, target, move)`                                   (CONDITION, slot ctor:1)
//   apply: the parent's `power.value *= powerMultiplier`. No random draw, no state of its own.
//
// The effect is exactly the library effect "multiply the move's power". The condition reads the private Symbol timer that the
// trigger attr arms, which no library atom can read (request R-B11-C1-09), so both users are bound as legacy closures: reusable
// as a whole, swappable by staff, counted as undecomposed.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AllyFaintPowerBoostAbAttr } from "#data/elite-redux/archetypes/power-boost-on-ally-faint";

export default defineDecl(AllyFaintPowerBoostAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.move-power",
  label: "Stronger moves while the teammate-faint boost lasts",
  summary: params =>
    `While the boost timer runs, the power of all my moves is multiplied by ${params.multiplier} (1.5 = 50% stronger). The timer is started by the 'Start a short power boost when a teammate faints' block.`,
  synonyms: [
    "avenger",
    "cursed spirit",
    "revenge power",
    "boosted after a faint",
    "power up while timer runs",
    "stronger moves",
  ],
  examples: ["All my moves are 50% stronger for a turn after a teammate faints"],
  params: [
    {
      id: "multiplier",
      ctorIndex: 0,
      path: "powerMultiplier",
      control: "number",
      min: 0.1,
      max: 4,
      step: 0.05,
      label: "Power multiplier (1.5 = 50% stronger, 2 = double)",
      editable: true,
      default: 1.5,
    },
  ],
  conditions: [
    // "My teammate-faint boost timer is running" (a legacy closure for now, see the header). Staff swap it for any condition.
    { slot: "ctor:1", ctx: "attack", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [],
  effect: { id: "effect.multiply-power", params: ["multiplier"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a damaging move by the holder", axes: { foeMove: ["TACKLE", "WATER_GUN"] } }],
  status: "decomposed",
  notes:
    "Tier A, justified in the header. Users: Avenger (5030 attr 1) and Cursed Spirit (6095 attr 2), both 1.5; the condition is a legacy closure on both (request R-B11-C1-09: an atom for 'my timed effect is running'). The timer is state of the Pokemon (a Symbol key), so a rebuilt trio shares it with the shipped one. The L1 grid cannot arm the timer (it never has a teammate faint), so test/tests/elite-redux/decomp/B11/chunk1.test.ts drives canApply and apply with the timer off, on and counted down.",
});
