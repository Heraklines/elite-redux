/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StarterDataEntry } from "#types/save-data";
import { resolveSummaryStarterProgress } from "#ui/summary-starter-progress";
import { describe, expect, it } from "vitest";

const progress = (classicWinCount: number, friendship: number, candyCount: number): StarterDataEntry => ({
  moveset: null,
  eggMoves: 0,
  candyCount,
  friendship,
  abilityAttr: 0,
  passiveAttr: 0,
  valueReduction: 0,
  classicWinCount,
});

describe("summary starter progress", () => {
  it("falls back to the true root for forms without their own starter record", () => {
    const trueRoot = progress(1, 80, 4);
    const resolved = resolveSummaryStarterProgress({ 25: trueRoot }, 1025, 25);

    expect(resolved.root).toBe(trueRoot);
    expect(resolved.trueRoot).toBe(trueRoot);
    expect(resolved.current).toBe(trueRoot);
  });

  it("returns undefined progress instead of throwing when neither record exists", () => {
    expect(resolveSummaryStarterProgress({}, 1025, 25)).toEqual({
      root: undefined,
      trueRoot: undefined,
      current: undefined,
    });
  });
});
