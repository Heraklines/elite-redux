/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Integer HP math for the hp.* condition atoms (spec 1.3).
//
// Percent comparisons never go through a float ratio: `hp * 100 <= maxHp * pct` is exact for every
// integer HP. The `floor-half` variant first floors the threshold (`floor(maxHp * pct / 100)`),
// which is the rounding Berserk-style abilities use. The two differ on purpose and are never
// unified. Example at maxHp 101, pct 50: "at least" exact needs hp >= 51 (hp*100 >= 5050) while
// floor-half needs hp >= 50 (floor(50.5) = 50).

import type { CompareOp, HpRounding } from "./enums";

/**
 * The game's own HP ratio: `Pokemon.getHpRatio()` without the `precise` flag (pokemon.ts:2430), a value rounded to
 * TWO decimals. At max HP 1000, 334 HP is 0.33 and 335 HP is 0.34, so "at most 33%" read through this ratio
 * passes at 334 while the exact test (`hp * 100 <= maxHp * 33`) does not.
 */
export function hpRatioRounded(hp: number, maxHp: number): number {
  return Math.round((hp / maxHp) * 100) / 100;
}

/** hp is at most pct% of maxHp. */
export function hpAtMost(hp: number, maxHp: number, pct: number, rounding: HpRounding): boolean {
  if (rounding === "rounded-ratio") {
    return hpRatioRounded(hp, maxHp) <= pct / 100;
  }
  return rounding === "floor-half" ? hp <= Math.floor((maxHp * pct) / 100) : hp * 100 <= maxHp * pct;
}

/** hp is at least pct% of maxHp. */
export function hpAtLeast(hp: number, maxHp: number, pct: number, rounding: HpRounding): boolean {
  if (rounding === "rounded-ratio") {
    return hpRatioRounded(hp, maxHp) >= pct / 100;
  }
  return rounding === "floor-half" ? hp >= Math.floor((maxHp * pct) / 100) : hp * 100 >= maxHp * pct;
}

export function hpBetween(hp: number, maxHp: number, minPct: number, maxPct: number, rounding: HpRounding): boolean {
  return hpAtLeast(hp, maxHp, minPct, rounding) && hpAtMost(hp, maxHp, maxPct, rounding);
}

/**
 * The `hp.crossed-below` atom, both roundings.
 *
 * - `exact` is the PostDamageForceSwitchAbAttr (Wimp Out / Emergency Exit) test, including the
 *   Shell Bell term:  `hp + damage >= maxHp * ratio  &&  hp - shellBellHeal < maxHp * ratio`.
 *   The ratio multiplication stays a float on purpose: it is the original expression.
 * - `floor-half` is the BerserkOnThresholdAbAttr test: `t = floor(maxHp * ratio); hp <= t && hp + damage > t`.
 *   `shellBellHeal` is ignored there, as in the original.
 * - `damage-value` is the Anger Shell test: `t = toDmgValue(maxHp * ratio)` (never below 1), then as `floor-half`.
 *   It differs from `floor-half` only for a 1 HP Pokemon (Shedinja): line 1 versus line 0.
 */
export function hpCrossedBelowRounded(
  hp: number,
  maxHp: number,
  damage: number,
  ratio: number,
  rounding: HpRounding,
  shellBellHeal: number,
): boolean {
  if (rounding === "floor-half") {
    const threshold = Math.floor(maxHp * ratio);
    return hp <= threshold && hp + damage > threshold;
  }
  if (rounding === "damage-value") {
    // toDmgValue(maxHp * ratio) = Math.max(Math.floor(maxHp * ratio), 1): floor-half with a line of at least 1 HP.
    // Source: ab-attrs.ts PostDefendHpGatedStatStageChangeAbAttr.gate (Anger Shell, No Turning Back).
    const threshold = Math.max(Math.floor(maxHp * ratio), 1);
    return hp <= threshold && hp + damage > threshold;
  }
  return hp + damage >= maxHp * ratio && hp - shellBellHeal < maxHp * ratio;
}

export function compareNumbers(value: number, op: CompareOp, n: number): boolean {
  switch (op) {
    case "lt":
      return value < n;
    case "lte":
      return value <= n;
    case "eq":
      return value === n;
    case "gte":
      return value >= n;
    case "gt":
      return value > n;
  }
}
