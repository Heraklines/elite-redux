/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { hpCrossedBelow } from "#abilities/ab-attrs";
import {
  compareNumbers,
  hpAtLeast,
  hpAtMost,
  hpBetween,
  hpCrossedBelowRounded,
} from "#data/elite-redux/ability-studio/vocabulary/hp-math";
import { HitHealModifier } from "#modifiers/modifier";
import { describe, expect, it } from "vitest";

describe("integer HP math (hp.* atoms)", () => {
  it("exact at-most / at-least cross-multiply, so there is no float ratio at the boundary", () => {
    // maxHp 101, 50%: the line sits at 50.5.
    expect(hpAtMost(50, 101, 50, "exact")).toBe(true);
    expect(hpAtMost(51, 101, 50, "exact")).toBe(false);
    expect(hpAtLeast(50, 101, 50, "exact")).toBe(false);
    expect(hpAtLeast(51, 101, 50, "exact")).toBe(true);
    // 33% of 100 is exactly 33.
    expect(hpAtMost(33, 100, 33, "exact")).toBe(true);
    expect(hpAtMost(34, 100, 33, "exact")).toBe(false);
  });

  it("floor-half floors the threshold first and is a different rounding from exact", () => {
    expect(hpAtLeast(50, 101, 50, "floor-half")).toBe(true);
    expect(hpAtLeast(49, 101, 50, "floor-half")).toBe(false);
    expect(hpAtMost(50, 101, 50, "floor-half")).toBe(true);
    expect(hpAtMost(51, 101, 50, "floor-half")).toBe(false);
    // The two roundings disagree somewhere: that is exactly why they are never unified.
    expect(hpAtLeast(50, 101, 50, "exact")).not.toBe(hpAtLeast(50, 101, 50, "floor-half"));
  });

  it("is exact for a large max HP where a float ratio would be risky", () => {
    const max = 999_999;
    expect(hpAtMost(499_999, max, 50, "exact")).toBe(true); // 49999900 <= 49999950
    expect(hpAtMost(500_000, max, 50, "exact")).toBe(false); // 50000000 > 49999950
  });

  it("between combines both bounds with the same rounding", () => {
    expect(hpBetween(25, 100, 25, 75, "exact")).toBe(true);
    expect(hpBetween(24, 100, 25, 75, "exact")).toBe(false);
    expect(hpBetween(76, 100, 25, 75, "exact")).toBe(false);
  });

  it("compares numbers with all five operators", () => {
    expect(compareNumbers(3, "lt", 4)).toBe(true);
    expect(compareNumbers(4, "lte", 4)).toBe(true);
    expect(compareNumbers(4, "eq", 4)).toBe(true);
    expect(compareNumbers(4, "gte", 5)).toBe(false);
    expect(compareNumbers(5, "gt", 4)).toBe(true);
  });
});

describe("hp.crossed-below", () => {
  it("exact: was at or above the line before the damage and is below it now (Wimp Out)", () => {
    // maxHp 100, ratio 0.5, current hp 49 after taking 2: was 51.
    expect(hpCrossedBelowRounded(49, 100, 2, 0.5, "exact", 0)).toBe(true);
    // hp 50 after 1 damage: was 51, but 50 is not below 50.
    expect(hpCrossedBelowRounded(50, 100, 1, 0.5, "exact", 0)).toBe(false);
    // already below before: hp 40 after 5 damage was 45 < 50.
    expect(hpCrossedBelowRounded(40, 100, 5, 0.5, "exact", 0)).toBe(false);
    // the very boundary: was exactly 50 (>= line), now 49.
    expect(hpCrossedBelowRounded(49, 100, 1, 0.5, "exact", 0)).toBe(true);
  });

  it("exact: the Shell Bell term counts the heal as already recovered", () => {
    // hp 50 now (not below 50), but a 2 HP Shell Bell heal means hp - 2 = 48 < 50.
    expect(hpCrossedBelowRounded(50, 100, 5, 0.5, "exact", 0)).toBe(false);
    expect(hpCrossedBelowRounded(50, 100, 5, 0.5, "exact", 2)).toBe(true);
  });

  it("floor-half: hp <= floor(max * ratio) and hp + damage > floor(max * ratio), no Shell Bell term", () => {
    // maxHp 101 -> threshold 50. hp 50 after 1 damage was 51 > 50: crossed.
    expect(hpCrossedBelowRounded(50, 101, 1, 0.5, "floor-half", 99)).toBe(true);
    // hp 51 is above the threshold: not crossed.
    expect(hpCrossedBelowRounded(51, 101, 1, 0.5, "floor-half", 0)).toBe(false);
    // already at or below before the hit (hp 49, damage 1 -> was 50 <= 50): not crossed.
    expect(hpCrossedBelowRounded(49, 101, 1, 0.5, "floor-half", 0)).toBe(false);
  });

  it("matches the shared free function the original class now calls, including a real Shell Bell", () => {
    const shellBell = Object.assign(Object.create(HitHealModifier.prototype), { stackCount: 1 });
    const pokemon = (hp: number, max: number, items: unknown[], dealt: number) =>
      ({
        hp,
        getMaxHp: () => max,
        getHeldItems: () => items,
        turnData: { totalDamageDealt: dealt },
      }) as never;
    for (const max of [1, 7, 100, 101, 400]) {
      for (let hp = 0; hp <= max; hp++) {
        for (const damage of [0, 1, 2, 17, max]) {
          for (const ratio of [0.35, 0.5, 0.9]) {
            for (const [items, dealt, heal] of [
              [[], 0, 0],
              [[shellBell], 80, 10],
            ] as const) {
              expect(hpCrossedBelow(pokemon(hp, max, [...items], dealt), damage, ratio)).toBe(
                hpCrossedBelowRounded(hp, max, damage, ratio, "exact", heal),
              );
            }
          }
        }
      }
    }
  });
});
