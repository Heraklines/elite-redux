/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER achievement expansion wave (#900) - detection logic (engine-free).
//
// The Showdown / co-op / triple / Shiny Lab observers are split into PURE
// evaluators that take a plain context and return the achievement KEYS to unlock.
// These tests drive every evaluator directly - no battle engine, no globalScene -
// so each detection rule (thresholds, difficulty gates, participation vs win,
// team-cost comparison, one-turn / center-slot sweeps) is pinned deterministically.
// =============================================================================

import {
  evaluateCoopWaveWon,
  evaluateLookCollector,
  evaluateShinyLabLoadout,
  evaluateShowdownResult,
  evaluateTripleWaveWon,
  type ShowdownResultContext,
  type TripleWaveContext,
} from "#data/elite-redux/er-social-achievement-tracker";
import { describe, expect, it } from "vitest";

const baseShowdown: ShowdownResultContext = {
  won: true,
  voided: false,
  staked: false,
  stakeShiny: false,
  ownTeamCost: 0,
  oppTeamCost: 0,
  ownTeamMaxCost: 0,
  anyOwnFainted: false,
  // Base wins are treated as mega-used so Raw Talent / budget feats only fire where a test opts in.
  ownMegaUsed: true,
};

describe("#900 evaluateShowdownResult", () => {
  it("a plain first win unlocks First Blood + Flawless (no faints)", () => {
    const ids = evaluateShowdownResult(baseShowdown, { matchesPlayed: 1, wins: 1 });
    expect(ids).toContain("FIRST_BLOOD");
    expect(ids).toContain("FLAWLESS_DUEL");
    expect(ids).not.toContain("HIGH_ROLLER");
    expect(ids).not.toContain("ALL_IN");
    expect(ids).not.toContain("DAVID_AND_GOLIATH");
  });

  it("a win with a fainted mon does NOT unlock Flawless", () => {
    const ids = evaluateShowdownResult({ ...baseShowdown, anyOwnFainted: true }, { matchesPlayed: 1, wins: 1 });
    expect(ids).toContain("FIRST_BLOOD");
    expect(ids).not.toContain("FLAWLESS_DUEL");
  });

  it("a voided match unlocks nothing (no participation, no win)", () => {
    const ids = evaluateShowdownResult({ ...baseShowdown, voided: true }, { matchesPlayed: 10, wins: 100 });
    expect(ids).toEqual([]);
  });

  it("Good Sport is participation-only: fires at 10 played even on a loss", () => {
    const ids = evaluateShowdownResult({ ...baseShowdown, won: false }, { matchesPlayed: 10, wins: 0 });
    expect(ids).toContain("GOOD_SPORT");
    expect(ids).not.toContain("FIRST_BLOOD");
  });

  it("win-record thresholds are inclusive and cumulative", () => {
    expect(evaluateShowdownResult(baseShowdown, { matchesPlayed: 5, wins: 5 })).toContain("DUELIST");
    expect(evaluateShowdownResult(baseShowdown, { matchesPlayed: 4, wins: 4 })).not.toContain("DUELIST");
    const at100 = evaluateShowdownResult(baseShowdown, { matchesPlayed: 100, wins: 100 });
    expect(at100).toEqual(expect.arrayContaining(["DUELIST", "VETERAN_DUELIST", "LEGENDARY_DUELIST"]));
  });

  it("Raw Talent needs a win with no mega evolution", () => {
    expect(evaluateShowdownResult({ ...baseShowdown, ownMegaUsed: false }, { matchesPlayed: 1, wins: 1 })).toContain(
      "RAW_TALENT",
    );
    expect(evaluateShowdownResult({ ...baseShowdown, ownMegaUsed: true }, { matchesPlayed: 1, wins: 1 })).not.toContain(
      "RAW_TALENT",
    );
  });

  it("budget feats gate on the highest team base cost (inclusive, escalating)", () => {
    // maxCost 3: Budget Champion only. maxCost 2: both. maxCost 4 / unknown(0): neither.
    const at3 = evaluateShowdownResult({ ...baseShowdown, ownTeamMaxCost: 3 }, { matchesPlayed: 1, wins: 1 });
    expect(at3).toContain("BUDGET_CHAMPION");
    expect(at3).not.toContain("RAGS_TO_RICHES");
    const at2 = evaluateShowdownResult({ ...baseShowdown, ownTeamMaxCost: 2 }, { matchesPlayed: 1, wins: 1 });
    expect(at2).toEqual(expect.arrayContaining(["BUDGET_CHAMPION", "RAGS_TO_RICHES"]));
    const at4 = evaluateShowdownResult({ ...baseShowdown, ownTeamMaxCost: 4 }, { matchesPlayed: 1, wins: 1 });
    expect(at4).not.toContain("BUDGET_CHAMPION");
    // Unknown manifest (max 0) never qualifies.
    expect(evaluateShowdownResult(baseShowdown, { matchesPlayed: 1, wins: 1 })).not.toContain("BUDGET_CHAMPION");
  });

  it("Apex Predator needs >= 80% win rate over >= 25 matches", () => {
    expect(evaluateShowdownResult(baseShowdown, { matchesPlayed: 25, wins: 20 })).toContain("APEX_PREDATOR");
    // Below the match floor, or below the 80% rate, does not qualify.
    expect(evaluateShowdownResult(baseShowdown, { matchesPlayed: 24, wins: 24 })).not.toContain("APEX_PREDATOR");
    expect(evaluateShowdownResult(baseShowdown, { matchesPlayed: 30, wins: 23 })).not.toContain("APEX_PREDATOR");
  });

  it("High Roller needs a staked win; All In needs a shiny stake win", () => {
    const staked = evaluateShowdownResult({ ...baseShowdown, staked: true }, { matchesPlayed: 1, wins: 1 });
    expect(staked).toContain("HIGH_ROLLER");
    expect(staked).not.toContain("ALL_IN");
    const shinyStake = evaluateShowdownResult(
      { ...baseShowdown, staked: true, stakeShiny: true },
      { matchesPlayed: 1, wins: 1 },
    );
    expect(shinyStake).toEqual(expect.arrayContaining(["HIGH_ROLLER", "ALL_IN"]));
  });

  it("David and Goliath needs a strictly lower own team cost", () => {
    expect(
      evaluateShowdownResult({ ...baseShowdown, ownTeamCost: 12, oppTeamCost: 20 }, { matchesPlayed: 1, wins: 1 }),
    ).toContain("DAVID_AND_GOLIATH");
    // Equal / higher cost, or a missing opponent cost, does not qualify.
    expect(
      evaluateShowdownResult({ ...baseShowdown, ownTeamCost: 20, oppTeamCost: 20 }, { matchesPlayed: 1, wins: 1 }),
    ).not.toContain("DAVID_AND_GOLIATH");
    expect(
      evaluateShowdownResult({ ...baseShowdown, ownTeamCost: 12, oppTeamCost: 0 }, { matchesPlayed: 1, wins: 1 }),
    ).not.toContain("DAVID_AND_GOLIATH");
  });

  it("a loss unlocks no win feats", () => {
    const ids = evaluateShowdownResult(
      { ...baseShowdown, won: false, staked: true, stakeShiny: true, ownTeamCost: 5, oppTeamCost: 30 },
      { matchesPlayed: 3, wins: 0 },
    );
    expect(ids).toEqual([]);
  });
});

describe("#900 evaluateCoopWaveWon", () => {
  const coop = (waveIndex: number, extra: Partial<Parameters<typeof evaluateCoopWaveWon>[0]> = {}) =>
    evaluateCoopWaveWon({ isCoop: true, waveIndex, isWaveFinal: false, difficultyHell: false, ...extra });

  it("does nothing outside co-op", () => {
    expect(evaluateCoopWaveWon({ isCoop: false, waveIndex: 200, isWaveFinal: true, difficultyHell: true })).toEqual([]);
  });

  it("any co-op wave clear unlocks Co-op Initiate", () => {
    expect(coop(1)).toContain("CO_OP_INITIATE");
  });

  it("wave milestones are inclusive thresholds", () => {
    expect(coop(10)).toContain("BETTER_TOGETHER");
    expect(coop(9)).not.toContain("BETTER_TOGETHER");
    expect(coop(50)).toContain("PARTNERS_IN_CRIME");
    expect(coop(100)).toContain("LONG_HAUL_DUO");
    expect(coop(150)).toContain("THE_LONG_ROAD");
    expect(coop(149)).not.toContain("THE_LONG_ROAD");
  });

  it("the final boss unlocks Dynamic Duo", () => {
    expect(coop(200, { isWaveFinal: true })).toContain("DYNAMIC_DUO");
    expect(coop(200, { isWaveFinal: false })).not.toContain("DYNAMIC_DUO");
  });

  it("Double Trouble needs wave 25+ AND Hell", () => {
    expect(coop(25, { difficultyHell: true })).toContain("DOUBLE_TROUBLE_HELL");
    expect(coop(25, { difficultyHell: false })).not.toContain("DOUBLE_TROUBLE_HELL");
    expect(coop(24, { difficultyHell: true })).not.toContain("DOUBLE_TROUBLE_HELL");
  });
});

describe("#900 evaluateTripleWaveWon", () => {
  const base: TripleWaveContext = {
    isTriple: true,
    tripleWins: 1,
    playerFainted: false,
    ghostTrainer: false,
    difficultyHell: false,
    centerMonSweptAll: false,
    oneTurnClear: false,
  };

  it("does nothing off a triple wave", () => {
    expect(evaluateTripleWaveWon({ ...base, isTriple: false })).toEqual([]);
  });

  it("a first triple win unlocks Three's Company + Hold the Line (no faints)", () => {
    const ids = evaluateTripleWaveWon(base);
    expect(ids).toContain("THREES_COMPANY");
    expect(ids).toContain("HOLD_THE_LINE");
  });

  it("a triple win with a player faint does NOT unlock Hold the Line", () => {
    expect(evaluateTripleWaveWon({ ...base, playerFainted: true })).not.toContain("HOLD_THE_LINE");
  });

  it("triple-win tallies are inclusive", () => {
    expect(evaluateTripleWaveWon({ ...base, tripleWins: 10 })).toContain("TRIPLE_THREAT");
    expect(evaluateTripleWaveWon({ ...base, tripleWins: 9 })).not.toContain("TRIPLE_THREAT");
    expect(evaluateTripleWaveWon({ ...base, tripleWins: 25 })).toContain("TRIPLE_DOWN");
  });

  it("ghost / hell / center / one-turn gates each fire independently", () => {
    expect(evaluateTripleWaveWon({ ...base, ghostTrainer: true })).toContain("GHOST_TRIAD");
    expect(evaluateTripleWaveWon({ ...base, difficultyHell: true })).toContain("TRIAD_OF_HELL");
    expect(evaluateTripleWaveWon({ ...base, centerMonSweptAll: true })).toContain("CENTER_STAGE");
    expect(evaluateTripleWaveWon({ ...base, oneTurnClear: true })).toContain("ONE_TURN_CLEAR");
    // None of those gates fire in the base (no-ghost, non-hell, no sweep) case.
    const plain = evaluateTripleWaveWon(base);
    expect(plain).not.toContain("GHOST_TRIAD");
    expect(plain).not.toContain("TRIAD_OF_HELL");
    expect(plain).not.toContain("CENTER_STAGE");
    expect(plain).not.toContain("ONE_TURN_CLEAR");
  });
});

describe("#900 evaluateLookCollector", () => {
  it("crosses each owned-effect threshold inclusively", () => {
    expect(evaluateLookCollector(9)).toEqual([]);
    expect(evaluateLookCollector(10)).toEqual(["LOOK_COLLECTOR_10"]);
    expect(evaluateLookCollector(25)).toEqual(["LOOK_COLLECTOR_10", "LOOK_COLLECTOR_25"]);
    expect(evaluateLookCollector(50)).toEqual(["LOOK_COLLECTOR_10", "LOOK_COLLECTOR_25", "LOOK_COLLECTOR_50"]);
    expect(evaluateLookCollector(100)).toEqual([
      "LOOK_COLLECTOR_10",
      "LOOK_COLLECTOR_25",
      "LOOK_COLLECTOR_50",
      "LOOK_COLLECTOR_100",
    ]);
  });
});

describe("#900 evaluateShinyLabLoadout", () => {
  it("Fashionista needs all three slots filled", () => {
    expect(evaluateShinyLabLoadout({ palette: "aurum", surface: "holofoil", around: "flame" }, 0)).toContain(
      "FASHIONISTA",
    );
    expect(evaluateShinyLabLoadout({ palette: "aurum", surface: "holofoil", around: null }, 0)).not.toContain(
      "FASHIONISTA",
    );
    expect(evaluateShinyLabLoadout({ palette: null, surface: null, around: null }, 0)).toEqual([]);
  });

  it("Curator needs five named presets", () => {
    expect(evaluateShinyLabLoadout({ palette: null, surface: null, around: null }, 5)).toContain("PRESET_CURATOR");
    expect(evaluateShinyLabLoadout({ palette: null, surface: null, around: null }, 4)).not.toContain("PRESET_CURATOR");
  });
});
