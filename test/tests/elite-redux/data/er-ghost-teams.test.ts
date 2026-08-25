/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Unit tests for the ER ghost-team gauntlet scheduling (#217).

import type { GhostTeamSnapshot } from "#data/elite-redux/er-ghost-teams";
import {
  hasErGhostSavedItems,
  markTrainerAsGhost,
  shouldRequireLateHellGhostItems,
  shouldRestoreErGhostSavedInventory,
  shouldUseLateHellGhostTrainer,
} from "#data/elite-redux/er-ghost-teams";
import { ghostWavesForCurrentRun, isErGhostWave } from "#data/elite-redux/er-ghost-waves";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { resetErRunPacing, setErRunPacing } from "#data/elite-redux/er-run-pacing";
import type { Trainer } from "#field/trainer";
import { afterEach, describe, expect, it } from "vitest";

// Endgame fixed-battle waves the ghost gauntlet must avoid.
const FIXED_WAVES = new Set([182, 184, 186, 188, 190, 195]);

describe("ER ghost teams", () => {
  afterEach(() => {
    resetErDifficulty();
    resetErRunPacing();
  });

  it("spawns the configured ghost schedule only on Elite and Hell", () => {
    setErDifficulty("ace");
    expect(ghostWavesForCurrentRun()).toHaveLength(0);
    setErDifficulty("elite");
    expect(ghostWavesForCurrentRun()).toHaveLength(6);
    setErDifficulty("hell");
    expect(ghostWavesForCurrentRun()).toHaveLength(13);
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

  it("#403: ghost trainers play the piano theme on BOTH music preferences", () => {
    // The #365 wiring only shadowed getBattleBgm, which serves the GEN-5
    // preference - the DEFAULT preference routes through getMixedBattleBgm,
    // so most players never heard the theme.
    const trainer = {} as Trainer;
    const snapshot = { trainerName: "tester", party: [{}] } as unknown as GhostTeamSnapshot;
    markTrainerAsGhost(trainer, snapshot);
    expect(trainer.getBattleBgm()).toBe("battle_ghost_piano");
    expect(trainer.getMixedBattleBgm()).toBe("battle_ghost_piano");
  });

  it("isErGhostWave matches the schedule and excludes others", () => {
    setErDifficulty("hell");
    expect(isErGhostWave(196)).toBe(true);
    expect(isErGhostWave(176)).toBe(true);
    expect(isErGhostWave(150)).toBe(false);
    expect(isErGhostWave(200)).toBe(false);
    setErDifficulty("ace");
    expect(isErGhostWave(196)).toBe(false);
    expect(isErGhostWave(192)).toBe(false);
  });

  it("replaces about half of late Hell trainer encounters deterministically", () => {
    setErDifficulty("hell");
    expect(shouldUseLateHellGhostTrainer(100, "run-a")).toBe(false);
    const normalRolls = Array.from({ length: 100 }, (_, i) => shouldUseLateHellGhostTrainer(101 + i, "run-a"));
    expect(normalRolls.filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(normalRolls.filter(Boolean).length).toBeLessThanOrEqual(60);
    expect(shouldUseLateHellGhostTrainer(137, "run-a")).toBe(shouldUseLateHellGhostTrainer(137, "run-a"));

    setErRunPacing("sprint");
    expect(shouldUseLateHellGhostTrainer(50, "run-a")).toBe(false);
    const sprintRolls = Array.from({ length: 100 }, (_, i) => shouldUseLateHellGhostTrainer(51 + i, "run-a"));
    expect(sprintRolls.filter(Boolean).length).toBeGreaterThanOrEqual(40);
    expect(sprintRolls.filter(Boolean).length).toBeLessThanOrEqual(60);
  });

  it("never enables late replacement outside Hell", () => {
    setErDifficulty("elite");
    expect(shouldUseLateHellGhostTrainer(150, "run-a")).toBe(false);
    setErRunPacing("sprint");
    expect(shouldUseLateHellGhostTrainer(75, "run-a")).toBe(false);
  });

  it("requires saved held items after the Hell threshold while leaving relics optional", () => {
    const base = {
      id: "inventory-check",
      trainerName: "Inventory Ghost",
      difficulty: "hell",
      waveReached: 150,
      isVictory: true,
      timestamp: 1,
      party: [
        {
          speciesId: 25,
          formIndex: 0,
          abilityIndex: 0,
          ivs: [31, 31, 31, 31, 31, 31],
          nature: 0,
          level: 80,
          gender: 0,
          shiny: false,
          variant: 0,
          passive: false,
          moves: [],
        },
      ],
    } satisfies GhostTeamSnapshot;
    expect(hasErGhostSavedItems(base)).toBe(false);
    expect(hasErGhostSavedItems({ ...base, relics: [["bloodPact", 1, null]] })).toBe(false);
    expect(
      hasErGhostSavedItems({
        ...base,
        party: [{ ...base.party[0], heldItems: [["LEFTOVERS", 1]] }],
      }),
    ).toBe(true);
    expect(
      hasErGhostSavedItems({
        ...base,
        party: [{ ...base.party[0], heldItems: [["LEFTOVERS", 1]] }],
        relics: [["bloodPact", 1, null]],
      }),
    ).toBe(true);

    setErDifficulty("hell");
    expect(shouldRequireLateHellGhostItems(100)).toBe(false);
    expect(shouldRequireLateHellGhostItems(101)).toBe(true);
    setErRunPacing("sprint");
    expect(shouldRequireLateHellGhostItems(50)).toBe(false);
    expect(shouldRequireLateHellGhostItems(51)).toBe(true);
  });

  it("restores source-player ghost inventory only after the pacing-normalized midpoint", () => {
    expect(shouldRestoreErGhostSavedInventory(100)).toBe(false);
    expect(shouldRestoreErGhostSavedInventory(101)).toBe(true);

    setErRunPacing("sprint");
    expect(shouldRestoreErGhostSavedInventory(50)).toBe(false);
    expect(shouldRestoreErGhostSavedInventory(51)).toBe(true);
  });
});
