import { readFileSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DATA = process.env.BALANCE_OBSERVATIONS_DATA_DIR
  ? pathToFileURL(`${resolve(process.env.BALANCE_OBSERVATIONS_DATA_DIR)}${sep}`)
  : new URL("./data/", import.meta.url);
const runsExport = JSON.parse(readFileSync(new URL("_runs.json", DATA), "utf8"));
const decisionExport = JSON.parse(readFileSync(new URL("_decisions.json", DATA), "utf8"));
const now = Number(runsExport.until) || Date.now();
const dayMs = 24 * 60 * 60 * 1000;

const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const progressionWave = row => {
  const normalized = Math.floor(number(row.progression_wave));
  if (normalized > 0) {
    return normalized;
  }
  const wave = Math.max(1, Math.floor(number(row.wave)) || 1);
  return row.pacing === "sprint" ? wave * 2 : wave;
};

const median = values => {
  if (!values.length) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const average = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
const rows = Array.isArray(runsExport.rows) ? runsExport.rows : [];
const taggedRows = rows.filter(row => typeof row.er_version === "string" && row.er_version && row.er_version !== "unknown");
const patchOrder = [
  ...new Map(
    taggedRows
      .toSorted((a, b) => number(b.created_at) - number(a.created_at))
      .map(row => [row.er_version, row.er_version]),
  ).values(),
];
const currentPatch = patchOrder[0] ?? null;
const previousPatch = patchOrder[1] ?? null;

function summarize(runRows, label, from, patch) {
  if (!runRows.length) {
    return null;
  }
  const byDifficulty = new Map();
  for (const row of runRows) {
    const difficulty = String(row.difficulty ?? "unknown");
    if (!byDifficulty.has(difficulty)) {
      byDifficulty.set(difficulty, []);
    }
    byDifficulty.get(difficulty).push(row);
  }
  const difficulties = [...byDifficulty.entries()]
    .map(([difficulty, difficultyRows]) => {
      const waves = difficultyRows.map(progressionWave);
      const victories = difficultyRows.filter(row => row.outcome === "victory").length;
      return {
        difficulty,
        runs: difficultyRows.length,
        players: new Set(difficultyRows.map(row => row.playerKey)).size,
        victories,
        winRate: victories / difficultyRows.length,
        medianWave: median(waves),
        averageWave: average(waves),
      };
    })
    .sort((a, b) => a.difficulty.localeCompare(b.difficulty));
  const wipeHotspots = [];
  for (const [difficulty, difficultyRows] of byDifficulty) {
    const defeats = difficultyRows.filter(row => row.outcome !== "victory");
    const bands = new Map();
    for (const row of defeats) {
      const wave = progressionWave(row);
      const start = Math.floor((Math.max(1, wave) - 1) / 10) * 10 + 1;
      bands.set(start, (bands.get(start) ?? 0) + 1);
    }
    wipeHotspots.push(
      ...[...bands.entries()].map(([waveStart, count]) => ({
        difficulty,
        waveStart,
        waveEnd: waveStart + 9,
        defeats: count,
        share: defeats.length ? count / defeats.length : 0,
      })),
    );
  }
  wipeHotspots.sort((a, b) => b.share - a.share || b.defeats - a.defeats || a.waveStart - b.waveStart);
  const victories = runRows.filter(row => row.outcome === "victory").length;
  const waves = runRows.map(progressionWave);
  return {
    label,
    patch,
    from,
    to: now,
    summary: {
      runs: runRows.length,
      players: new Set(runRows.map(row => row.playerKey)).size,
      victories,
      winRate: victories / runRows.length,
      medianWave: median(waves),
      averageWave: average(waves),
    },
    difficulties,
    wipeHotspots: wipeHotspots.slice(0, 18),
    biomeTransitions: [],
    mysteryEvents: [],
  };
}

const previousDaily =
  decisionExport.previous?.daily && typeof decisionExport.previous.daily === "object"
    ? structuredClone(decisionExport.previous.daily)
    : {};

function dayBucket(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function dailyRecord(day) {
  const record = (previousDaily[day] ??= {});
  record.biome ??= {};
  record.biomeDecisions ??= {};
  record.mysteryOpened ??= {};
  record.mysteryChoices ??= {};
  return record;
}

for (const event of Array.isArray(decisionExport.events) ? decisionExport.events : []) {
  const timestamp = number(event.t);
  if (!timestamp) {
    continue;
  }
  const daily = dailyRecord(dayBucket(timestamp));
  const difficulty = String(event.difficulty ?? "unknown");
  const erVersion = String(event.erVersion ?? "unknown");
  if (event.kind === "biome_decision" && event.action === "travel" && Number.isFinite(Number(event.chosenBiome))) {
    const key = [difficulty, erVersion, number(event.currentBiome), number(event.chosenBiome)].join("|");
    daily.biome[key] ??= { count: 0, wavesSpent: 0 };
    daily.biome[key].count++;
    daily.biome[key].wavesSpent += Math.max(0, number(event.wavesSpent));
  }
  if (event.kind === "biome_decision" && (event.action === "stay" || event.action === "leave")) {
    const key = [difficulty, erVersion, number(event.currentBiome), event.action].join("|");
    daily.biomeDecisions[key] = (daily.biomeDecisions[key] ?? 0) + 1;
  }
  if (event.kind === "mystery_encounter" && event.stage === "opened") {
    const key = [difficulty, erVersion, number(event.encounterType)].join("|");
    daily.mysteryOpened[key] = (daily.mysteryOpened[key] ?? 0) + 1;
  }
  if (event.kind === "mystery_encounter" && event.stage === "choice" && event.subSelection !== true) {
    const key = [difficulty, erVersion, number(event.encounterType), number(event.optionIndex)].join("|");
    daily.mysteryChoices[key] = (daily.mysteryChoices[key] ?? 0) + 1;
  }
}

const historyCutoff = now - 120 * dayMs;
for (const day of Object.keys(previousDaily)) {
  if (Date.parse(`${day}T00:00:00Z`) < historyCutoff) {
    delete previousDaily[day];
  }
}

function attachDecisionStats(window, from, patch) {
  if (!window) {
    return;
  }
  const biome = new Map();
  const biomeDecisions = new Map();
  const mysteryOpened = new Map();
  const mysteryChoices = new Map();
  for (const [day, daily] of Object.entries(previousDaily)) {
    if (Date.parse(`${day}T23:59:59Z`) < from) {
      continue;
    }
    for (const [key, value] of Object.entries(daily.biome ?? {})) {
      const [difficulty, erVersion, fromBiome, toBiome] = key.split("|");
      if (patch && erVersion !== patch) {
        continue;
      }
      const aggregateKey = [difficulty, fromBiome, toBiome].join("|");
      biome.set(aggregateKey, {
        difficulty,
        fromBiome,
        toBiome,
        count: (biome.get(aggregateKey)?.count ?? 0) + number(value.count),
        wavesSpent: (biome.get(aggregateKey)?.wavesSpent ?? 0) + number(value.wavesSpent),
      });
    }
    for (const [key, count] of Object.entries(daily.biomeDecisions ?? {})) {
      const [difficulty, erVersion, biomeId, action] = key.split("|");
      if (patch && erVersion !== patch) {
        continue;
      }
      const aggregateKey = [difficulty, biomeId, action].join("|");
      biomeDecisions.set(aggregateKey, (biomeDecisions.get(aggregateKey) ?? 0) + number(count));
    }
    for (const [key, count] of Object.entries(daily.mysteryOpened ?? {})) {
      const [difficulty, erVersion, encounterType] = key.split("|");
      if (patch && erVersion !== patch) {
        continue;
      }
      const aggregateKey = [difficulty, encounterType].join("|");
      mysteryOpened.set(aggregateKey, (mysteryOpened.get(aggregateKey) ?? 0) + number(count));
    }
    for (const [key, count] of Object.entries(daily.mysteryChoices ?? {})) {
      const [difficulty, erVersion, encounterType, optionIndex] = key.split("|");
      if (patch && erVersion !== patch) {
        continue;
      }
      const aggregateKey = [difficulty, encounterType, optionIndex].join("|");
      mysteryChoices.set(aggregateKey, (mysteryChoices.get(aggregateKey) ?? 0) + number(count));
    }
  }
  const sourceTotals = new Map();
  for (const value of biome.values()) {
    const key = [value.difficulty, value.fromBiome].join("|");
    sourceTotals.set(key, (sourceTotals.get(key) ?? 0) + value.count);
  }
  window.biomeTransitions = [...biome.values()]
    .map(value => ({
      difficulty: value.difficulty,
      from: `Biome ${value.fromBiome}`,
      to: `Biome ${value.toBiome}`,
      count: value.count,
      averageWavesSpent: value.count ? value.wavesSpent / value.count : null,
      shareFromSource: value.count / (sourceTotals.get([value.difficulty, value.fromBiome].join("|")) || 1),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  const biomeDecisionTotals = new Map();
  for (const [key, count] of biomeDecisions) {
    const [difficulty, biomeId] = key.split("|");
    const totalKey = [difficulty, biomeId].join("|");
    biomeDecisionTotals.set(totalKey, (biomeDecisionTotals.get(totalKey) ?? 0) + count);
  }
  window.biomeDecisions = [...biomeDecisions.entries()]
    .map(([key, count]) => {
      const [difficulty, biomeId, action] = key.split("|");
      return {
        difficulty,
        biome: `Biome ${biomeId}`,
        action,
        count,
        share: count / (biomeDecisionTotals.get([difficulty, biomeId].join("|")) || 1),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  window.mysteryEvents = [...mysteryChoices.entries()]
    .map(([key, count]) => {
      const [difficulty, encounterType, optionIndex] = key.split("|");
      const opened = mysteryOpened.get([difficulty, encounterType].join("|")) ?? 0;
      return {
        difficulty,
        encounterType: number(encounterType),
        optionIndex: number(optionIndex),
        count,
        share: opened ? count / opened : 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

const currentRows = currentPatch ? taggedRows.filter(row => row.er_version === currentPatch) : [];
const last7From = now - 7 * dayMs;
const last30From = now - 30 * dayMs;
const patches = Object.fromEntries(
  patchOrder.map(patch => {
    const patchRows = taggedRows.filter(row => row.er_version === patch);
    return [
      patch,
      summarize(
        patchRows,
        `ER ${patch}`,
        Math.min(...patchRows.map(row => number(row.created_at))),
        patch,
      ),
    ];
  }),
);
const windows = {
  currentPatch: currentPatch ? patches[currentPatch] : null,
  last7Days: summarize(
    currentRows.filter(row => number(row.created_at) >= last7From),
    currentPatch ? `ER ${currentPatch}, last 7 days` : "Last 7 days",
    last7From,
    currentPatch,
  ),
  last30Days: summarize(
    currentRows.filter(row => number(row.created_at) >= last30From),
    currentPatch ? `ER ${currentPatch}, last 30 days` : "Last 30 days",
    last30From,
    currentPatch,
  ),
  previousPatch: previousPatch ? patches[previousPatch] : null,
};

for (const window of Object.values(patches)) {
  attachDecisionStats(window, window?.from ?? now, window?.patch ?? null);
}
attachDecisionStats(windows.last7Days, last7From, currentPatch);
attachDecisionStats(windows.last30Days, last30From, currentPatch);

const output = {
  schemaVersion: 1,
  generatedAt: new Date(now).toISOString(),
  sourceRevision: process.env.STATS_SOURCE_SHA ?? null,
  currentPatch,
  previousPatch,
  windows,
  patches,
  telemetryState: {
    collectionStartedAt: decisionExport.collectionStartedAt,
    watermark: decisionExport.watermark,
    daily: previousDaily,
    exportError: decisionExport.exportError,
  },
};

writeFileSync(new URL("balance-observations.json", DATA), `${JSON.stringify(output)}\n`, "utf8");
console.log(
  `Generated balance observations for ${rows.length} runs; current patch ${currentPatch ?? "not tagged yet"}`,
);
