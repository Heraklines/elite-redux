/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Editor-managed balance tuning (er-balance-tuning.json → the knob registry in
// er-balance-knobs.ts). Tests inject tuning tables via
// setErBalanceTuningForTesting and assert:
//   - a valid override applies (loader AND a real consumer),
//   - absence = the registry default,
//   - ANY invalid override (range, length, ordering, type) is rejected and the
//     default survives - a bad committed value can never break the game.
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-balance-tuning.test.ts
import { getPassiveCandyCount, getStarterValueFriendshipCap } from "#balance/starters";
import { ER_BALANCE_KNOBS } from "#data/elite-redux/er-balance-knobs";
import {
  erBalanceArr,
  erBalanceMap,
  erBalanceNum,
  erBalancePairs,
  setErBalanceTuningForTesting,
} from "#data/elite-redux/er-balance-tuning";
import { getErDifficultyShinyMultiplier } from "#data/elite-redux/er-run-difficulty";
import { afterEach, describe, expect, it } from "vitest";

describe("ER balance tuning (er-balance-tuning.json loader)", () => {
  afterEach(() => {
    setErBalanceTuningForTesting(); // restore the committed JSON ({} in tests)
  });

  it("absence = the registry default, for every knob kind", () => {
    expect(erBalanceNum("er.shiny.multHell")).toBe(2);
    expect(erBalanceArr("vanilla.eggs.rareEggMoveRates")).toEqual([48, 24, 12, 6]);
    expect(erBalancePairs("er.elite.bstCaps")[0]).toEqual([20, 420]);
    expect(erBalanceMap("er.items.resistBerryPct")).toEqual({ ace: 5, elite: 10, hell: 20 });
  });

  it("a valid scalar override applies, through a real consumer", () => {
    setErBalanceTuningForTesting({ "er.shiny.multHell": 4 });
    expect(erBalanceNum("er.shiny.multHell")).toBe(4);
    expect(getErDifficultyShinyMultiplier("hell")).toBe(4);
    // Untouched sibling keeps its default.
    expect(getErDifficultyShinyMultiplier("elite")).toBe(1.5);
  });

  it("array overrides apply through the candy-cost getters", () => {
    setErBalanceTuningForTesting({
      "vanilla.candy.passiveUnlock": [99, 40, 35, 30, 25, 20, 15, 10, 10, 10, 10, 10],
      "vanilla.friendship.capByCost": [30, 50, 75, 100, 150, 200, 300, 450, 450, 600],
    });
    expect(getPassiveCandyCount(1)).toBe(99);
    expect(getPassiveCandyCount(2)).toBe(40);
    expect(getStarterValueFriendshipCap(1)).toBe(30);
    expect(getStarterValueFriendshipCap(12)).toBe(600); // clamps to the cost-10 cap
  });

  it("map overrides merge per key over the defaults", () => {
    setErBalanceTuningForTesting({ "vanilla.eggs.hatchWaves": { legendary: 80 } });
    const waves = erBalanceMap("vanilla.eggs.hatchWaves");
    expect(waves.legendary).toBe(80);
    expect(waves.common).toBe(10); // untouched entries keep their defaults
  });

  it("rejects out-of-range, mis-typed and unknown-key overrides", () => {
    setErBalanceTuningForTesting({
      "er.shiny.multHell": 9999, // over max
      "er.money.streakCapPct": 2.5, // integer required
      "vanilla.eggs.manaphyRate": "8", // wrong type
      "er.items.resistBerryPct": { ace: 200, hell: 50 }, // ace over max, hell fine
    });
    expect(erBalanceNum("er.shiny.multHell")).toBe(2);
    expect(erBalanceNum("er.money.streakCapPct")).toBe(10);
    expect(erBalanceNum("vanilla.eggs.manaphyRate")).toBe(8);
    const berry = erBalanceMap("er.items.resistBerryPct");
    expect(berry.ace).toBe(5); // invalid entry rejected
    expect(berry.hell).toBe(50); // valid entry applied
  });

  it("rejects arrays with wrong length or broken ordering", () => {
    setErBalanceTuningForTesting({
      "vanilla.eggs.rareEggMoveRates": [48, 24, 12], // wrong length
      "er.usageTiers.gates": [0.25, 0.5, 1, 2.25], // must be descending
    });
    expect(erBalanceArr("vanilla.eggs.rareEggMoveRates")).toEqual([48, 24, 12, 6]);
    expect(erBalanceArr("er.usageTiers.gates")).toEqual([2.25, 1, 0.5, 0.25]);
  });

  it("rejects pair ladders that are not ascending in both columns", () => {
    setErBalanceTuningForTesting({
      "er.elite.bstCaps": [
        [40, 480],
        [20, 420], // waves out of order
      ],
    });
    expect(erBalancePairs("er.elite.bstCaps")).toEqual([
      [20, 420],
      [40, 480],
      [60, 540],
      [80, 580],
      [100, 600],
    ]);
    // A valid ladder applies.
    setErBalanceTuningForTesting({
      "er.elite.bstCaps": [
        [30, 450],
        [90, 620],
      ],
    });
    expect(erBalancePairs("er.elite.bstCaps")).toEqual([
      [30, 450],
      [90, 620],
    ]);
  });

  it("every registry default passes its own validation (registry self-consistency)", () => {
    // Inject each knob's DEFAULT as an override - all must be accepted, which
    // proves min/max/length/ordering constraints agree with the defaults.
    const all: Record<string, unknown> = {};
    for (const knob of ER_BALANCE_KNOBS) {
      all[knob.key] = JSON.parse(JSON.stringify(knob.default));
    }
    setErBalanceTuningForTesting(all);
    for (const knob of ER_BALANCE_KNOBS) {
      switch (knob.kind) {
        case "scalar":
          expect(erBalanceNum(knob.key), knob.key).toBe(knob.default);
          break;
        case "array":
          expect(erBalanceArr(knob.key), knob.key).toEqual(knob.default);
          break;
        case "pairs":
          expect(erBalancePairs(knob.key), knob.key).toEqual(knob.default);
          break;
        case "map":
          expect(erBalanceMap(knob.key), knob.key).toEqual(knob.default);
          break;
      }
    }
  });
});
