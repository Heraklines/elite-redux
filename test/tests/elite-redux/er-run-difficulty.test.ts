/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#368) — Youngster trial mode + per-mode knobs:
//  - Youngster and Ace are the VANILLA difficulties (same encounters/trainers
//    as plain PokeRogue; Elite/Hell are the ER experience);
//  - wild shiny multiplier: Youngster/Ace 1x, Elite 1.5x, Hell 2x;
//  - Youngster temp-unlocks innate slots by level (1 / Lv15 / Lv24), free,
//    run-only; every other difficulty returns 0 (candy gating applies).
// =============================================================================

import {
  erYoungsterFreeInnateSlots,
  getErDifficultyCandyMultiplier,
  getErDifficultyShinyMultiplier,
  isErVanillaDifficulty,
  resetErDifficulty,
  setErDifficulty,
} from "#data/elite-redux/er-run-difficulty";
import { afterEach, describe, expect, it } from "vitest";

describe("ER run difficulty (#368 Youngster mode)", () => {
  afterEach(() => {
    resetErDifficulty();
  });

  it("Youngster and Ace are vanilla; Elite and Hell are not", () => {
    expect(isErVanillaDifficulty("youngster")).toBe(true);
    expect(isErVanillaDifficulty("ace")).toBe(true);
    expect(isErVanillaDifficulty("elite")).toBe(false);
    expect(isErVanillaDifficulty("hell")).toBe(false);
  });

  it("wild shiny multiplier (#402): 1x / 1x / 1.75x / 2x", () => {
    expect(getErDifficultyShinyMultiplier("youngster")).toBe(1);
    expect(getErDifficultyShinyMultiplier("ace")).toBe(1);
    expect(getErDifficultyShinyMultiplier("elite")).toBe(1.75);
    expect(getErDifficultyShinyMultiplier("hell")).toBe(2);
  });

  it("candy multiplier (#402): 2x / 1.5x / 1x / 1x - low difficulties pay candy, high ones pay shinies", () => {
    expect(getErDifficultyCandyMultiplier("youngster")).toBe(2);
    expect(getErDifficultyCandyMultiplier("ace")).toBe(1.5);
    expect(getErDifficultyCandyMultiplier("elite")).toBe(1);
    expect(getErDifficultyCandyMultiplier("hell")).toBe(1);
  });

  it("Youngster innate slots ramp 1 -> 2 (Lv15) -> 3 (Lv24)", () => {
    setErDifficulty("youngster");
    expect(erYoungsterFreeInnateSlots(1)).toBe(1);
    expect(erYoungsterFreeInnateSlots(14)).toBe(1);
    expect(erYoungsterFreeInnateSlots(15)).toBe(2);
    expect(erYoungsterFreeInnateSlots(23)).toBe(2);
    expect(erYoungsterFreeInnateSlots(24)).toBe(3);
    expect(erYoungsterFreeInnateSlots(100)).toBe(3);
  });

  it("free innate slots are 0 on every non-Youngster difficulty", () => {
    for (const difficulty of ["ace", "elite", "hell"] as const) {
      setErDifficulty(difficulty);
      expect(erYoungsterFreeInnateSlots(100)).toBe(0);
    }
  });
});
