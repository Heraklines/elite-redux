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

/** hp is at most pct% of maxHp. */
export function hpAtMost(hp: number, maxHp: number, pct: number, rounding: HpRounding): boolean {
  return rounding === "floor-half" ? hp <= Math.floor((maxHp * pct) / 100) : hp * 100 <= maxHp * pct;
}

/** hp is at least pct% of maxHp. */
export function hpAtLeast(hp: number, maxHp: number, pct: number, rounding: HpRounding): boolean {
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
