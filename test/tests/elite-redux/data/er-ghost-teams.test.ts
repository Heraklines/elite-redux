/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Unit tests for the ER ghost-team gauntlet scheduling (#217).

import { ghostWavesForCurrentRun, isErGhostWave } from "#data/elite-redux/er-ghost-waves";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { afterEach, describe, expect, it } from "vitest";

// Endgame fixed-battle waves the ghost gauntlet must avoid.
const FIXED_WAVES = new Set([182, 184, 186, 188, 190, 195]);

describe("ER ghost teams", () => {
  afterEach(() => {
    resetErDifficulty();
  });

  it("spawns the right number of ghosts per difficulty (Ace 1 / Elite 3 / Hell 8)", () => {
    setErDifficulty("ace");
    expect(ghostWavesForCurrentRun()).toHaveLength(1);
    setErDifficulty("elite");
    expect(ghostWavesForCurrentRun()).toHaveLength(3);
    setErDifficulty("hell");
    expect(ghostWavesForCurrentRun()).toHaveLength(8);
  });

  it("never places a ghost on a fixed / boss / x1 / gym wave", () => {
    for (const d of ["ace", "elite", "hell"] as const) {
      setErDifficulty(d);
      for (const w of ghostWavesForCurrentRun()) {
        expect(FIXED_WAVES.has(w), `${d} wave ${w} collides with a fixed battle`).toBe(false);
        expect(w % 10, `${d} wave ${w} is a boss wave`).not.toBe(0);
        expect(w % 10, `${d} wave ${w} is an x1 wave`).not.toBe(1);
        expect(w % 30, `${d} wave ${w} is a gym wave`).not.toBe(20);
        expect(w, `${d} wave ${w} is the finale`).not.toBe(200);
      }
    }
  });

  it("isErGhostWave matches the schedule and excludes others", () => {
    setErDifficulty("hell");
    expect(isErGhostWave(196)).toBe(true);
    expect(isErGhostWave(176)).toBe(true);
    expect(isErGhostWave(150)).toBe(false);
    expect(isErGhostWave(200)).toBe(false);
    setErDifficulty("ace");
    expect(isErGhostWave(196)).toBe(true);
    expect(isErGhostWave(192)).toBe(false);
  });
});
