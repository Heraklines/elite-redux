export const TOP_LIMIT = 100;
export const WIN_RATE_MIN_RUNS = 50;
export const WAVE_MIN_RUNS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const EXCLUDED_PLAYER_KEYS = new Set(["schadetalon", "zyfa"]);

const isExcludedPlayer = player => EXCLUDED_PLAYER_KEYS.has(String(player).trim().toLocaleLowerCase("en-US"));

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseArray = value => {
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const rounded = (value, places = 1) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const median = values => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const starterIds = value => [
  ...new Set(
    parseArray(value)
      .map(number)
      .filter(id => Number.isSafeInteger(id) && id > 0),
  ),
];

const challengeRows = value =>
  parseArray(value)
    .map(entry => {
      if (Array.isArray(entry)) {
        return [number(entry[0]), number(entry[1])];
      }
      return [number(entry?.id), number(entry?.value)];
    })
    .filter(([id, activeValue]) => Number.isSafeInteger(id) && activeValue > 0)
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);

const canonicalChallengeSet = value => {
  const rows = challengeRows(value);
  return rows.length > 0 ? JSON.stringify(rows) : "";
};

const runLine = (map, row) => {
  const key = String(row.user_id ?? row.player ?? "");
  if (!key) {
    return null;
  }
  let line = map.get(key);
  if (!line) {
    line = {
      player: String(row.player ?? "Trainer"),
      completedRuns: 0,
      wins: 0,
      waves: [],
      difficulty: {
        ace: { runs: 0, wins: 0 },
        elite: { runs: 0, wins: 0 },
        hell: { runs: 0, wins: 0 },
      },
      recent30: { runs: 0, wins: 0 },
      recent90: { runs: 0, wins: 0 },
      winningStarters: new Set(),
      challengeCombinations: new Set(),
      monotypeClears: 0,
      hellMonotypeClears: 0,
      noRepeatCurrent: 0,
      noRepeatBest: 0,
      noRepeatSeen: new Set(),
    };
    map.set(key, line);
  }
  return line;
};

export function aggregateRuns(rows, now = Date.now()) {
  const lines = new Map();
  const ordered = rows.toSorted((a, b) => number(a.created_at) - number(b.created_at));
  for (const row of ordered) {
    const line = runLine(lines, row);
    if (!line) {
      continue;
    }
    const won = row.outcome === "victory";
    const wave = number(row.wave);
    const difficulty = String(row.difficulty ?? "").toLowerCase();
    const createdAt = number(row.created_at);
    line.completedRuns++;
    line.wins += won ? 1 : 0;
    if (wave > 0 && wave <= 200) {
      line.waves.push(wave);
    }
    if (Object.hasOwn(line.difficulty, difficulty)) {
      line.difficulty[difficulty].runs++;
      line.difficulty[difficulty].wins += won ? 1 : 0;
    }
    if (createdAt >= now - 30 * DAY_MS) {
      line.recent30.runs++;
      line.recent30.wins += won ? 1 : 0;
    }
    if (createdAt >= now - 90 * DAY_MS) {
      line.recent90.runs++;
      line.recent90.wins += won ? 1 : 0;
    }
    if (!won) {
      line.noRepeatCurrent = 0;
      line.noRepeatSeen.clear();
      continue;
    }
    const starters = starterIds(row.starters);
    for (const starter of starters) {
      line.winningStarters.add(starter);
    }
    const combination = canonicalChallengeSet(row.challenges);
    if (combination) {
      line.challengeCombinations.add(combination);
    }
    const monotype = challengeRows(row.challenges).some(([id]) => id === 1);
    if (monotype) {
      line.monotypeClears++;
      line.hellMonotypeClears += difficulty === "hell" ? 1 : 0;
    }
    if (starters.length === 0 || starters.some(starter => line.noRepeatSeen.has(starter))) {
      line.noRepeatCurrent = 0;
      line.noRepeatSeen.clear();
    }
    if (starters.length > 0) {
      for (const starter of starters) {
        line.noRepeatSeen.add(starter);
      }
      line.noRepeatCurrent++;
      line.noRepeatBest = Math.max(line.noRepeatBest, line.noRepeatCurrent);
    }
  }
  return [...lines.values()].map(line => ({
    ...line,
    averageWave:
      line.waves.length > 0 ? rounded(line.waves.reduce((sum, wave) => sum + wave, 0) / line.waves.length) : 0,
    medianWave: rounded(median(line.waves)),
    winningStarterCount: line.winningStarters.size,
    challengeCombinationCount: line.challengeCombinations.size,
  }));
}

function rankedEntries(rows, valueOf, detailOf = () => "", extraOf = () => ({})) {
  const sorted = rows
    .map(row => ({ row, value: number(valueOf(row)) }))
    .filter(item => item.row.player && !isExcludedPlayer(item.row.player) && item.value > 0)
    .toSorted((a, b) => b.value - a.value || String(a.row.player).localeCompare(String(b.row.player)))
    .slice(0, TOP_LIMIT);
  let previous = null;
  let rank = 0;
  return sorted.map((item, index) => {
    if (previous === null || item.value !== previous) {
      rank = index + 1;
      previous = item.value;
    }
    return {
      rank,
      player: String(item.row.player),
      value: item.value,
      detail: detailOf(item.row),
      ...extraOf(item.row),
    };
  });
}

function rateEntries(rows, sampleOf, winsOf) {
  return rankedEntries(
    rows.filter(row => number(sampleOf(row)) >= WIN_RATE_MIN_RUNS),
    row => rounded((100 * number(winsOf(row))) / number(sampleOf(row)), 2),
    row => `${number(winsOf(row))} wins / ${number(sampleOf(row))} runs`,
    row => ({ sample: number(sampleOf(row)), wins: number(winsOf(row)) }),
  );
}

const board = (id, group, label, description, format, entries) => ({
  id,
  group,
  label,
  description,
  format,
  entries,
});

export function buildLeaderboardPayload({ saveRows, runRows, generatedAt, eligibleSaveCount, totalSaveCount }) {
  const runs = aggregateRuns(runRows, Date.parse(generatedAt));
  const integer = (id, group, label, description, field) =>
    board(
      id,
      group,
      label,
      description,
      "integer",
      rankedEntries(saveRows, row => row[field]),
    );
  const runInteger = (id, label, description, valueOf, detailOf) =>
    board(id, "Runs", label, description, "integer", rankedEntries(runs, valueOf, detailOf));
  const boards = [
    integer("achievements", "Progress", "Achievements", "Most achievements unlocked.", "achievementCount"),
    integer(
      "achievement-points",
      "Progress",
      "Achievement Points",
      "Highest earned achievement point total.",
      "achievementPoints",
    ),
    integer("ribbons", "Progress", "Ribbons", "Most ribbons owned across all species.", "ribbons"),
    integer(
      "victories",
      "Progress",
      "Total Victories",
      "Most cumulative Classic and Challenge victories.",
      "sessionsWon",
    ),
    integer(
      "black-shiny-species",
      "Shinies",
      "Black Shiny Species",
      "Most starter species lines with a black shiny unlocked.",
      "blackShinySpecies",
    ),
    integer(
      "shiny-lab-effects",
      "Shinies",
      "Shiny Lab Effects",
      "Most purchased Shiny Lab effects across all species.",
      "shinyLabEffects",
    ),
    integer("unique-relics", "Collection", "Unique Relics", "Most distinct relic kinds acquired.", "uniqueRelics"),
    integer("eggs-pulled", "Records", "Eggs Pulled", "Most lifetime gacha eggs pulled.", "eggsPulled"),
    integer("highest-damage", "Records", "Highest Damage", "Highest damage recorded in a single hit.", "highestDamage"),
    integer(
      "highest-healing",
      "Records",
      "Highest Healing",
      "Highest healing recorded in a single action.",
      "highestHeal",
    ),
    integer(
      "black-market-runs",
      "Records",
      "Black Market Runs",
      "Most runs in which the Black Market was used.",
      "blackMarketRuns",
    ),
    board(
      "ace-win-rate",
      "Runs",
      "Ace Win Rate",
      `Highest Ace win rate with at least ${WIN_RATE_MIN_RUNS} recorded Ace runs.`,
      "percent",
      rateEntries(
        runs,
        row => row.difficulty.ace.runs,
        row => row.difficulty.ace.wins,
      ),
    ),
    board(
      "elite-win-rate",
      "Runs",
      "Elite Win Rate",
      `Highest Elite win rate with at least ${WIN_RATE_MIN_RUNS} recorded Elite runs.`,
      "percent",
      rateEntries(
        runs,
        row => row.difficulty.elite.runs,
        row => row.difficulty.elite.wins,
      ),
    ),
    board(
      "hell-win-rate",
      "Runs",
      "Hell Win Rate",
      `Highest Hell win rate with at least ${WIN_RATE_MIN_RUNS} recorded Hell runs.`,
      "percent",
      rateEntries(
        runs,
        row => row.difficulty.hell.runs,
        row => row.difficulty.hell.wins,
      ),
    ),
    board(
      "average-wave",
      "Runs",
      "Average Wave",
      `Highest average finishing wave with at least ${WAVE_MIN_RUNS} recorded runs.`,
      "wave",
      rankedEntries(
        runs.filter(row => row.waves.length >= WAVE_MIN_RUNS),
        row => row.averageWave,
        row => `${row.waves.length} completed runs`,
      ),
    ),
    board(
      "median-wave",
      "Runs",
      "Median Wave",
      `Highest median finishing wave with at least ${WAVE_MIN_RUNS} recorded runs.`,
      "wave",
      rankedEntries(
        runs.filter(row => row.waves.length >= WAVE_MIN_RUNS),
        row => row.medianWave,
        row => `${row.waves.length} completed runs`,
      ),
    ),
    runInteger(
      "unique-winning-starters",
      "Unique Winning Starters",
      "Most distinct opening starter lines used in victories.",
      row => row.winningStarterCount,
      row => `${row.wins} recorded victories`,
    ),
    runInteger(
      "challenge-combinations",
      "Challenge Combinations",
      "Most distinct active challenge combinations cleared.",
      row => row.challengeCombinationCount,
      row => `${row.wins} recorded victories`,
    ),
    runInteger(
      "monotype-clears",
      "Monotype Clears",
      "Most recorded monotype victories.",
      row => row.monotypeClears,
      () => "All difficulties",
    ),
    runInteger(
      "hell-monotype-clears",
      "Hell Monotype Clears",
      "Most recorded Hell-mode monotype victories.",
      row => row.hellMonotypeClears,
      () => "Hell difficulty",
    ),
    runInteger(
      "no-repeat-streak",
      "No-Repeat Victory Streak",
      "Longest consecutive victory streak without reusing an opening starter line. A loss resets the streak.",
      row => row.noRepeatBest,
      row => `${row.wins} recorded victories`,
    ),
    board(
      "form-30-days",
      "Runs",
      "30-Day Form",
      `Highest win rate over the last 30 days with at least ${WIN_RATE_MIN_RUNS} completed runs in that period.`,
      "percent",
      rateEntries(
        runs,
        row => row.recent30.runs,
        row => row.recent30.wins,
      ),
    ),
    board(
      "form-90-days",
      "Runs",
      "90-Day Form",
      `Highest win rate over the last 90 days with at least ${WIN_RATE_MIN_RUNS} completed runs in that period.`,
      "percent",
      rateEntries(
        runs,
        row => row.recent90.runs,
        row => row.recent90.wins,
      ),
    ),
  ];
  return {
    generatedAt,
    source: "Elite Redux production cloud saves and completed run history",
    topLimit: TOP_LIMIT,
    eligibility: {
      winRateMinimumRuns: WIN_RATE_MIN_RUNS,
      waveMinimumRuns: WAVE_MIN_RUNS,
      eligibleSaveCount: number(eligibleSaveCount),
      totalSaveCount: number(totalSaveCount),
    },
    boards,
  };
}
