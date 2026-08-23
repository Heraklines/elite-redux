import { speciesStarterCosts } from "#balance/starters";
import { ER_SHINY_LAB_CATEGORIES, getErShinyLabOwnedSet } from "#data/elite-redux/er-shiny-lab-effects";
import { DexAttr } from "#enums/dex-attr";
import { computeAchvProgress } from "#system/achv-category";
import type { GameStats } from "#system/game-stats";
import type { DexData } from "#types/dex-data";
import type { AchvUnlocks, LeaderboardSaveStats, StarterData } from "#types/save-data";

export const LEADERBOARD_SAVE_STATS_VERSION = 1;

const nonNegativeInteger = (value: unknown): number => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
};

export function buildLeaderboardSaveStats(
  achvUnlocks: AchvUnlocks,
  dexData: DexData,
  starterData: StarterData,
  gameStats: GameStats,
): LeaderboardSaveStats {
  const progress = computeAchvProgress(achvUnlocks).overall;
  const shinySpecies = Object.values(dexData).filter(
    entry => ((entry?.caughtAttr ?? 0n) & DexAttr.SHINY) !== 0n,
  ).length;
  let blackShinySpecies = 0;
  let shinyLabEffects = 0;
  for (const rawId of Object.keys(speciesStarterCosts)) {
    const speciesId = Number(rawId);
    const starter = starterData[speciesId];
    if (starter?.erBlackShiny === true) {
      blackShinySpecies++;
    }
    for (const category of ER_SHINY_LAB_CATEGORIES) {
      shinyLabEffects += getErShinyLabOwnedSet(starter?.erShinyLab, category).size;
    }
  }
  return {
    version: LEADERBOARD_SAVE_STATS_VERSION,
    achievementCount: progress.unlocked,
    achievementPoints: progress.earnedScore,
    ribbons: nonNegativeInteger(gameStats.ribbonsOwned),
    sessionsWon: nonNegativeInteger(gameStats.sessionsWon),
    shinySpecies,
    blackShinySpecies,
    shinyCaught: nonNegativeInteger(gameStats.shinyPokemonCaught),
    shinyHatched: nonNegativeInteger(gameStats.shinyPokemonHatched),
    shinyLabEffects,
    uniqueRelics: new Set(gameStats.relicKindsAcquired.filter(value => typeof value === "string" && value.length > 0))
      .size,
    eggsPulled: nonNegativeInteger(gameStats.eggsPulled),
    highestDamage: nonNegativeInteger(gameStats.highestDamage),
    highestHeal: nonNegativeInteger(gameStats.highestHeal),
    blackMarketRuns: nonNegativeInteger(gameStats.blackMarketRunCount),
  };
}
