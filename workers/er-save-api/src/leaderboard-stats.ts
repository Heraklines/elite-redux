export const LEADERBOARD_STATS_VERSION = 1;

const fields = [
  "achievementCount",
  "achievementPoints",
  "ribbons",
  "sessionsWon",
  "shinySpecies",
  "blackShinySpecies",
  "shinyCaught",
  "shinyHatched",
  "shinyLabEffects",
  "uniqueRelics",
  "eggsPulled",
  "highestDamage",
  "highestHeal",
  "blackMarketRuns",
] as const;

export function extractLeaderboardStats(data: string): string | null {
  try {
    const root: unknown = JSON.parse(data);
    if (!root || typeof root !== "object" || Array.isArray(root)) {
      return null;
    }
    const stats = (root as Record<string, unknown>).leaderboardStats;
    if (!stats || typeof stats !== "object" || Array.isArray(stats)) {
      return null;
    }
    const source = stats as Record<string, unknown>;
    if (source.version !== LEADERBOARD_STATS_VERSION) {
      return null;
    }
    const result: Record<string, number> = { version: LEADERBOARD_STATS_VERSION };
    for (const field of fields) {
      const value = source[field];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return null;
      }
      result[field] = value;
    }
    return JSON.stringify(result);
  } catch {
    return null;
  }
}
