/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER achievement-expansion catalog-v2 (#900) - PURE evaluator tests (engine-free).
//
// Every threshold / bitset / ranked-wager rule is a pure function that takes a plain
// count or context and returns the achievement KEYS it unlocks. These tests pin each
// rule deterministically without a battle engine or globalScene.
// =============================================================================

import {
  evaluateBiomeShopTypes,
  evaluateBlackMarketRuns,
  evaluateDailySeeds,
  evaluateGachaSources,
  evaluateHellGhostWin,
  evaluateLabSpecies,
  evaluateMysteryEncounterTypes,
  evaluateNameRecognition,
  evaluateNaturalGhostWin,
  evaluateNaturalTripleWin,
  evaluatePresetJetSet,
  evaluateRelicKinds,
  evaluateSevenSins,
} from "#data/elite-redux/er-achievement-detection";
import {
  evaluateShowdownRankedWager,
  evaluateTripleWaveWon,
  type ShowdownRankedWagerCounters,
  type ShowdownResultContext,
  type TripleWaveContext,
} from "#data/elite-redux/er-social-achievement-tracker";
import { describe, expect, it } from "vitest";

describe("#900 catalog-v2 threshold evaluators", () => {
  it("natural triple wins unlock NATURAL_SELECTION_BIAS at 10", () => {
    expect(evaluateNaturalTripleWin(9)).toEqual([]);
    expect(evaluateNaturalTripleWin(10)).toContain("NATURAL_SELECTION_BIAS");
  });

  it("natural ghost wins unlock EVICTION_NOTICE at 5", () => {
    expect(evaluateNaturalGhostWin(4)).toEqual([]);
    expect(evaluateNaturalGhostWin(5)).toContain("EVICTION_NOTICE");
  });

  it("hell ghost wins unlock HELL_HOUSE at 25", () => {
    expect(evaluateHellGhostWin(24)).toEqual([]);
    expect(evaluateHellGhostWin(25)).toContain("HELL_HOUSE");
  });

  it("mystery encounter types unlock STRANGER_THAN_FICTION at 15", () => {
    expect(evaluateMysteryEncounterTypes(14)).toEqual([]);
    expect(evaluateMysteryEncounterTypes(15)).toContain("STRANGER_THAN_FICTION");
  });

  it("relic kinds unlock MUSEUM_QUALITY at 5", () => {
    expect(evaluateRelicKinds(4)).toEqual([]);
    expect(evaluateRelicKinds(5)).toContain("MUSEUM_QUALITY");
  });

  it("black-market runs unlock BLACK_FRIDAY at 10", () => {
    expect(evaluateBlackMarketRuns(9)).toEqual([]);
    expect(evaluateBlackMarketRuns(10)).toContain("BLACK_FRIDAY");
  });

  it("biome shop types unlock BIOME_TOURIST at 8", () => {
    expect(evaluateBiomeShopTypes(7)).toEqual([]);
    expect(evaluateBiomeShopTypes(8)).toContain("BIOME_TOURIST");
  });

  it("lab species unlock LAB_RAT at 10", () => {
    expect(evaluateLabSpecies(9)).toEqual([]);
    expect(evaluateLabSpecies(10)).toContain("LAB_RAT");
  });

  it("preset wins unlock PRESET_JET_SET at 5 distinct", () => {
    expect(evaluatePresetJetSet(4)).toEqual([]);
    expect(evaluatePresetJetSet(5)).toContain("PRESET_JET_SET");
  });

  it("daily seeds unlock GROUNDHOG_WEEK at 7", () => {
    expect(evaluateDailySeeds(6)).toEqual([]);
    expect(evaluateDailySeeds(7)).toContain("GROUNDHOG_WEEK");
  });

  it("NAME_RECOGNITION needs both 25 wins and 5 species", () => {
    expect(evaluateNameRecognition(25, 4)).toEqual([]);
    expect(evaluateNameRecognition(24, 5)).toEqual([]);
    expect(evaluateNameRecognition(25, 5)).toContain("NAME_RECOGNITION");
  });
});

describe("#900 SEVEN_DEADLY_CHECKBOXES (7 classic sins, curiosity excluded)", () => {
  it("requires all 7 classic sins", () => {
    expect(evaluateSevenSins(["greed", "gluttony", "pride", "wrath", "envy", "sloth"])).toEqual([]);
    // curiosity does not substitute for a classic sin.
    expect(evaluateSevenSins(["greed", "gluttony", "pride", "wrath", "envy", "sloth", "curiosity"])).toEqual([]);
    expect(evaluateSevenSins(["greed", "gluttony", "pride", "wrath", "envy", "sloth", "lust"])).toContain(
      "SEVEN_DEADLY_CHECKBOXES",
    );
  });
});

describe("#900 gacha machine sets (FOUR_MACHINES / GOLDEN_TICKET)", () => {
  it("needs all four machine sources represented", () => {
    expect(evaluateGachaSources([0, 1, 2], [])).toEqual([]);
    expect(evaluateGachaSources([0, 1, 2, 5], [])).toContain("FOUR_MACHINES_ONE_DREAM");
    expect(evaluateGachaSources([0, 1, 2, 5], [0, 1, 2])).not.toContain("GOLDEN_TICKET");
    expect(evaluateGachaSources([0, 1, 2, 5], [0, 1, 2, 5])).toContain("GOLDEN_TICKET");
  });
});

const baseWager: ShowdownResultContext = {
  won: true,
  voided: false,
  staked: false,
  stakeShiny: false,
  ownTeamCost: 0,
  oppTeamCost: 0,
  ownTeamMaxCost: 0,
  anyOwnFainted: false,
  ownMegaUsed: false,
  ranked: false,
  ownSpeciesIds: [],
  stakeWonSpecies: [],
};

const zeroCounters: ShowdownRankedWagerCounters = {
  rankedWinStreak: 0,
  rankedNoMegaWins: 0,
  showdownStakedWins: 0,
  showdownShinyStakeStreak: 0,
};

describe("#900 evaluateShowdownRankedWager", () => {
  it("a 5th consecutive ranked win unlocks FIVE_ALARM_STREAK", () => {
    const r = evaluateShowdownRankedWager({ ...baseWager, ranked: true }, { ...zeroCounters, rankedWinStreak: 4 });
    expect(r.counters.rankedWinStreak).toBe(5);
    expect(r.ids).toContain("FIVE_ALARM_STREAK");
  });

  it("a settled ranked loss resets the win streak but not off-ranked", () => {
    const loss = evaluateShowdownRankedWager(
      { ...baseWager, won: false, ranked: true },
      { ...zeroCounters, rankedWinStreak: 4 },
    );
    expect(loss.counters.rankedWinStreak).toBe(0);
  });

  it("a void neither counts nor resets the ranked win streak", () => {
    const v = evaluateShowdownRankedWager(
      { ...baseWager, voided: true, ranked: true },
      { ...zeroCounters, rankedWinStreak: 4 },
    );
    expect(v.counters.rankedWinStreak).toBe(4);
    expect(v.ids).toEqual([]);
  });

  it("META_BREAKER counts a 10th no-Mega ranked win (need not be consecutive)", () => {
    const r = evaluateShowdownRankedWager(
      { ...baseWager, ranked: true, ownMegaUsed: false },
      { ...zeroCounters, rankedNoMegaWins: 9 },
    );
    expect(r.ids).toContain("META_BREAKER");
  });

  it("a Mega win does not advance the no-Mega counter", () => {
    const r = evaluateShowdownRankedWager(
      { ...baseWager, ranked: true, ownMegaUsed: true },
      { ...zeroCounters, rankedNoMegaWins: 9 },
    );
    expect(r.counters.rankedNoMegaWins).toBe(9);
    expect(r.ids).not.toContain("META_BREAKER");
  });

  it("HOUSE_MONEY counts the 10th settled staked win", () => {
    const r = evaluateShowdownRankedWager({ ...baseWager, staked: true }, { ...zeroCounters, showdownStakedWins: 9 });
    expect(r.ids).toContain("HOUSE_MONEY");
  });

  it("DOUBLE_OR_NOTHING needs 3 consecutive shiny-stake wins; a non-shiny win breaks it", () => {
    const third = evaluateShowdownRankedWager(
      { ...baseWager, staked: true, stakeShiny: true },
      { ...zeroCounters, showdownShinyStakeStreak: 2 },
    );
    expect(third.ids).toContain("DOUBLE_OR_NOTHING");
    const broken = evaluateShowdownRankedWager(
      { ...baseWager, staked: true, stakeShiny: false },
      { ...zeroCounters, showdownShinyStakeStreak: 2 },
    );
    expect(broken.counters.showdownShinyStakeStreak).toBe(0);
  });

  it("a void breaks the shiny-stake streak", () => {
    const v = evaluateShowdownRankedWager(
      { ...baseWager, voided: true },
      { ...zeroCounters, showdownShinyStakeStreak: 2 },
    );
    expect(v.counters.showdownShinyStakeStreak).toBe(0);
  });

  it("CAP_SPACE needs a ranked win at least 8 cost under the opponent", () => {
    expect(
      evaluateShowdownRankedWager({ ...baseWager, ranked: true, ownTeamCost: 5, oppTeamCost: 12 }, zeroCounters).ids,
    ).not.toContain("CAP_SPACE");
    expect(
      evaluateShowdownRankedWager({ ...baseWager, ranked: true, ownTeamCost: 4, oppTeamCost: 12 }, zeroCounters).ids,
    ).toContain("CAP_SPACE");
  });

  it("ZERO_SUM_HERO needs a ranked staked no-Mega win, every mon <=3, opp >= own+8", () => {
    const ctx: ShowdownResultContext = {
      ...baseWager,
      ranked: true,
      staked: true,
      ownMegaUsed: false,
      ownTeamCost: 6,
      ownTeamMaxCost: 3,
      oppTeamCost: 14,
    };
    expect(evaluateShowdownRankedWager(ctx, zeroCounters).ids).toContain("ZERO_SUM_HERO");
    // a cost-4 mon disqualifies it.
    expect(evaluateShowdownRankedWager({ ...ctx, ownTeamMaxCost: 4 }, zeroCounters).ids).not.toContain("ZERO_SUM_HERO");
  });

  it("PRODIGAL_MON fires when a fielded species was previously won as a stake", () => {
    const ctx: ShowdownResultContext = { ...baseWager, ownSpeciesIds: [7, 8], stakeWonSpecies: [8] };
    expect(evaluateShowdownRankedWager(ctx, zeroCounters).ids).toContain("PRODIGAL_MON");
    expect(evaluateShowdownRankedWager({ ...ctx, stakeWonSpecies: [99] }, zeroCounters).ids).not.toContain(
      "PRODIGAL_MON",
    );
  });
});

const baseTriple: TripleWaveContext = {
  isTriple: true,
  tripleWins: 1,
  playerFainted: false,
  ghostTrainer: false,
  difficultyHell: false,
  centerMonSweptAll: false,
  oneTurnClear: false,
};

describe("#900 TRIPLE_EXORCISM", () => {
  it("needs hell + ghost + no allied faint on a triple win", () => {
    expect(evaluateTripleWaveWon({ ...baseTriple, ghostTrainer: true, difficultyHell: true })).toContain(
      "TRIPLE_EXORCISM",
    );
    // an allied faint disqualifies it.
    expect(
      evaluateTripleWaveWon({ ...baseTriple, ghostTrainer: true, difficultyHell: true, playerFainted: true }),
    ).not.toContain("TRIPLE_EXORCISM");
    // not hell -> no.
    expect(evaluateTripleWaveWon({ ...baseTriple, ghostTrainer: true, difficultyHell: false })).not.toContain(
      "TRIPLE_EXORCISM",
    );
  });
});
