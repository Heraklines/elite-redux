#!/usr/bin/env node

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  decodeSourceSketch,
  emptySourceSketch,
  estimateSourceSketch,
  mergeSourceSketch,
} from "./combat-gameplay-analytics.mjs";

function increment(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CLI validation is explicit and fail-closed.
function parseArgs(argv) {
  const args = {
    inputs: [],
    output: resolve("ai-report/gameplay-analytics.json"),
    markdownOutput: resolve("ai-report/gameplay-analytics.md"),
    dictionaryDirectory: null,
    dictionaryHashesOutput: null,
    minObservations: 25,
    minSources: 5,
    includeSketches: false,
  };
  const remaining = [...argv];
  while (remaining.length > 0) {
    const name = remaining.shift();
    if (name === "--include-sketches") {
      args.includeSketches = true;
      continue;
    }
    const value = remaining.shift();
    if (name === "--input" && value) {
      args.inputs.push(resolve(value));
    } else if (name === "--out" && value) {
      args.output = resolve(value);
    } else if (name === "--markdown-out" && value) {
      args.markdownOutput = resolve(value);
    } else if (name === "--dictionary-dir" && value) {
      args.dictionaryDirectory = resolve(value);
    } else if (name === "--dictionary-hashes-out" && value) {
      args.dictionaryHashesOutput = resolve(value);
    } else if (name === "--min-observations" && /^\d+$/u.test(value ?? "")) {
      args.minObservations = Number(value);
    } else if (name === "--min-sources" && /^\d+$/u.test(value ?? "")) {
      args.minSources = Number(value);
    } else {
      throw new Error(`invalid argument: ${name ?? "<missing>"}`);
    }
  }
  if (args.inputs.length === 0) {
    throw new Error("at least one --input is required");
  }
  return args;
}

function discoverJson(path) {
  if (statSync(path).isFile()) {
    return [path];
  }
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      return discoverJson(child);
    }
    return entry.isFile() && entry.name.endsWith(".json") ? [child] : [];
  });
}

function loadReports(paths) {
  const reports = [];
  for (const path of paths.flatMap(discoverJson)) {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if ([1, 2].includes(parsed?.reportVersion) && parsed?.contractVersion === 4 && parsed?.tables) {
      reports.push(parsed);
    }
  }
  if (reports.length === 0) {
    throw new Error("no gameplay analytics reports found");
  }
  return reports;
}

function mergeRows(rows) {
  const merged = new Map();
  for (const row of rows) {
    const key = JSON.stringify(row.dimensions);
    const target = merged.get(key) ?? {
      dimensions: row.dimensions,
      observations: 0,
      outcomes: {},
      sums: {},
      sourceSketch: emptySourceSketch(),
    };
    target.observations += Number(row.observations ?? 0);
    for (const [name, value] of Object.entries(row.outcomes ?? {})) {
      increment(target.outcomes, name, value);
    }
    for (const [name, value] of Object.entries(row.sums ?? {})) {
      increment(target.sums, name, value);
    }
    mergeSourceSketch(target.sourceSketch, decodeSourceSketch(row.sourceSketch));
    merged.set(key, target);
  }
  return [...merged.values()];
}

function filterRows(rows, minObservations, minSources, includeSketches) {
  let suppressed = 0;
  const retained = [];
  for (const row of rows) {
    const approximateSources = estimateSourceSketch(row.sourceSketch);
    if (row.observations < minObservations || approximateSources < minSources) {
      suppressed++;
      continue;
    }
    retained.push({
      dimensions: row.dimensions,
      observations: row.observations,
      outcomes: row.outcomes,
      sums: row.sums,
      approximateSources,
      ...(includeSketches ? { sourceSketch: Buffer.from(row.sourceSketch).toString("base64") } : {}),
    });
  }
  retained.sort((left, right) => JSON.stringify(left.dimensions).localeCompare(JSON.stringify(right.dimensions)));
  return { retained, suppressed };
}

function loadDictionaries(directory, hashes) {
  if (directory == null) {
    return {};
  }
  return Object.fromEntries(
    hashes.map(hash => {
      const path = resolve(directory, `${hash}.json`);
      return [hash, JSON.parse(readFileSync(path, "utf8"))];
    }),
  );
}

function entityLabelFromParts(kind, dictionaryHash, value, extra, dictionaries) {
  const dictionary = dictionaries[dictionaryHash];
  if (kind === "species") {
    const entry = dictionary?.speciesForms?.[`${value}:${extra}`];
    return entry ? `${entry.name}${entry.formKey ? ` (${entry.formKey})` : ""}` : `Species ${value}:${extra}`;
  }
  if (kind === "move" || kind === "roster-move" || kind === "chosen-move") {
    return dictionary?.moves?.[value]?.name ?? `Move ${value}`;
  }
  if (kind === "ability") {
    const name = dictionary?.abilities?.[value]?.name ?? `Ability ${value}`;
    return extra ? `${name} [${extra}]` : name;
  }
  if (kind === "item") {
    return dictionary?.items?.[value]?.name ?? `Item ${value}`;
  }
  return `${kind} ${value}`;
}

function entityLabel(dimensions, dictionaries) {
  const [kind, _difficulty, dictionaryHash, value, extra] = dimensions;
  return entityLabelFromParts(kind, dictionaryHash, value, extra, dictionaries);
}

function combineLabelledRows(rows, dictionaries) {
  const combined = new Map();
  for (const row of rows) {
    const difficulty = String(row.dimensions[1] ?? "unknown");
    const label = entityLabel(row.dimensions, dictionaries);
    const key = JSON.stringify([difficulty, label]);
    const target = combined.get(key) ?? {
      difficulty,
      label,
      observations: 0,
      outcomes: {},
      approximateSources: 0,
    };
    target.observations += row.observations;
    target.approximateSources = Math.max(target.approximateSources, row.approximateSources ?? 0);
    for (const [name, value] of Object.entries(row.outcomes ?? {})) {
      increment(target.outcomes, name, value);
    }
    combined.set(key, target);
  }
  return [...combined.values()];
}

function wilson(successes, total, z = 1.96) {
  if (total <= 0) {
    return [0, 0];
  }
  const rate = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = (rate + (z * z) / (2 * total)) / denominator;
  const margin = (z / denominator) * Math.sqrt((rate * (1 - rate)) / total + (z * z) / (4 * total * total));
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function battleBaselines(rows) {
  const baselines = new Map();
  for (const row of rows) {
    const difficulty = String(row.dimensions[0] ?? "unknown");
    const target = baselines.get(difficulty) ?? { victory: 0, defeat: 0 };
    target.victory += Number(row.outcomes?.victory ?? 0);
    target.defeat += Number(row.outcomes?.defeat ?? 0);
    baselines.set(difficulty, target);
  }
  return baselines;
}

function contextKey(dimensions) {
  return JSON.stringify(dimensions.slice(0, 6));
}

function contextBaselines(rows) {
  return new Map(
    rows.map(row => {
      const victory = Number(row.outcomes?.victory ?? 0);
      const defeat = Number(row.outcomes?.defeat ?? 0);
      return [contextKey(row.dimensions), { victory, defeat, total: victory + defeat }];
    }),
  );
}

function normalizedLabel(value) {
  return typeof value === "string" ? { label: value, components: [] } : value;
}

function contextAdjustedRows(rows, baselines, labeler) {
  const groups = new Map();
  for (const row of rows) {
    const baseline = baselines.get(contextKey(row.dimensions));
    const wins = Number(row.outcomes?.victory ?? 0);
    const losses = Number(row.outcomes?.defeat ?? 0);
    const total = wins + losses;
    if (baseline == null || baseline.total === 0 || total === 0) {
      continue;
    }
    const difficulty = String(row.dimensions[0] ?? "unknown");
    const labelled = normalizedLabel(labeler(row.dimensions));
    const key = JSON.stringify([difficulty, labelled.label]);
    const target = groups.get(key) ?? {
      difficulty,
      name: labelled.label,
      components: labelled.components,
      battleExposures: 0,
      wins: 0,
      losses: 0,
      expectedWins: 0,
      variance: 0,
      approximateSources: 0,
      sourceSketch: emptySourceSketch(),
    };
    const expectedRate = baseline.victory / baseline.total;
    target.battleExposures += total;
    target.wins += wins;
    target.losses += losses;
    target.expectedWins += total * expectedRate;
    target.variance += total * expectedRate * (1 - expectedRate);
    if (row.sourceSketch) {
      mergeSourceSketch(target.sourceSketch, decodeSourceSketch(row.sourceSketch));
      target.approximateSources = estimateSourceSketch(target.sourceSketch);
    } else {
      target.approximateSources = Math.max(target.approximateSources, Number(row.approximateSources ?? 0));
    }
    groups.set(key, target);
  }
  return [...groups.values()].map(({ sourceSketch: _sourceSketch, ...row }) => {
    const rawAdjustedLift = (row.wins - row.expectedWins) / row.battleExposures;
    return {
      ...row,
      observedWinRate: row.wins / row.battleExposures,
      expectedWinRate: row.expectedWins / row.battleExposures,
      rawAdjustedLift,
      adjustedLift: rawAdjustedLift * (row.battleExposures / (row.battleExposures + 100)),
      zScore: (row.wins - row.expectedWins) / Math.sqrt(Math.max(row.variance, 1)),
      confidence95: wilson(row.wins, row.battleExposures),
    };
  });
}

function adjustedRanking(rows, { minBattles = 100, minSources = 10, limit = 10 } = {}) {
  const byDifficulty = {};
  for (const row of rows) {
    if (row.battleExposures < minBattles || row.approximateSources < minSources) {
      continue;
    }
    const values = byDifficulty[row.difficulty] ?? [];
    values.push(row);
    byDifficulty[row.difficulty] = values;
  }
  return Object.fromEntries(
    Object.entries(byDifficulty).map(([difficulty, values]) => {
      const sorted = values.sort((left, right) => right.adjustedLift - left.adjustedLift);
      return [
        difficulty,
        {
          positive: sorted.slice(0, limit),
          negative: sorted.slice(-limit).reverse(),
          popular: [...values].sort((left, right) => right.battleExposures - left.battleExposures).slice(0, limit),
        },
      ];
    }),
  );
}

function entityContextLabel(dimensions, dictionaries) {
  return entityLabelFromParts(dimensions[6], dimensions[7], dimensions[8], dimensions[9], dictionaries);
}

function speciesLabel(dictionaryHash, species, form, dictionaries) {
  return entityLabelFromParts("species", dictionaryHash, species, form, dictionaries);
}

function speciesPairLabel(dimensions, dictionaries) {
  const left = speciesLabel(dimensions[6], dimensions[7], dimensions[8], dictionaries);
  const right = speciesLabel(dimensions[6], dimensions[9], dimensions[10], dictionaries);
  return { label: `${left} + ${right}`, components: [left, right] };
}

function speciesItemLabel(dimensions, dictionaries) {
  const species = speciesLabel(dimensions[6], dimensions[7], dimensions[8], dictionaries);
  const item = entityLabelFromParts("item", dimensions[6], dimensions[9], "", dictionaries);
  return { label: `${species} + ${item} [${dimensions[10]} stacks]`, components: [species, item] };
}

function speciesAbilityLabel(dimensions, dictionaries) {
  const species = speciesLabel(dimensions[6], dimensions[7], dimensions[8], dictionaries);
  const ability = entityLabelFromParts("ability", dimensions[6], dimensions[9], dimensions[10], dictionaries);
  return { label: `${species} + ${ability}`, components: [species, ability] };
}

function matchupLabel(dimensions, dictionaries) {
  const self = speciesLabel(dimensions[6], dimensions[7], dimensions[8], dictionaries);
  const opponent = speciesLabel(dimensions[6], dimensions[9], dimensions[10], dictionaries);
  return { label: `${self} vs ${opponent}`, components: [self, opponent] };
}

function interactionRanking(rows, individualRows, options = {}) {
  const individual = new Map(individualRows.map(row => [`${row.difficulty}\0${row.name}`, row.rawAdjustedLift]));
  const enriched = rows.map(row => {
    const componentLift = row.components.reduce(
      (sum, component) => sum + Number(individual.get(`${row.difficulty}\0${component}`) ?? 0),
      0,
    );
    const rawInteractionLift = row.rawAdjustedLift - componentLift;
    return {
      ...row,
      rawInteractionLift,
      adjustedLift: rawInteractionLift * (row.battleExposures / (row.battleExposures + 200)),
    };
  });
  return adjustedRanking(enriched, options);
}

function aggregateImmediateMoveResults(rows, dictionaries) {
  const groups = new Map();
  for (const row of rows) {
    const difficulty = String(row.dimensions[0] ?? "unknown");
    const name = entityLabelFromParts("move", row.dimensions[6], row.dimensions[7], "", dictionaries);
    const key = JSON.stringify([difficulty, name]);
    const target = groups.get(key) ?? {
      difficulty,
      name,
      uses: 0,
      approximateSources: 0,
      sums: {},
    };
    target.uses += row.observations;
    target.approximateSources = Math.max(target.approximateSources, Number(row.approximateSources ?? 0));
    for (const [metric, value] of Object.entries(row.sums ?? {})) {
      increment(target.sums, metric, value);
    }
    groups.set(key, target);
  }
  const supported = [...groups.values()]
    .filter(row => row.uses >= 100 && row.approximateSources >= 10)
    .map(row => ({
      ...row,
      averageDamageRatio: Number(row.sums.damageDealtRatio ?? 0) / row.uses,
      knockoutRate: Number(row.sums.opponentFaints ?? 0) / row.uses,
      healingRatio: Number(row.sums.healingDealtRatio ?? 0) / row.uses,
      statusChangesPerUse: Number(row.sums.statusChanges ?? 0) / row.uses,
      selfFaintRate: Number(row.sums.selfFaints ?? 0) / row.uses,
      shieldBreaksPerUse: Number(row.sums.shieldSegmentsBroken ?? 0) / row.uses,
      averageDamageTaken: Number(row.sums.damageTaken ?? 0) / row.uses,
    }));
  const byDifficulty = {};
  for (const row of supported) {
    const values = byDifficulty[row.difficulty] ?? [];
    values.push(row);
    byDifficulty[row.difficulty] = values;
  }
  const top = (rowsForDifficulty, metric, descending = true) =>
    [...rowsForDifficulty]
      .sort((left, right) => (descending ? 1 : -1) * (Number(right[metric]) - Number(left[metric])))
      .slice(0, 8);
  return Object.fromEntries(
    Object.entries(byDifficulty).map(([difficulty, values]) => [
      difficulty,
      {
        mostUsed: [...values].sort((left, right) => right.uses - left.uses).slice(0, 8),
        damage: top(values, "averageDamageRatio"),
        knockouts: top(values, "knockoutRate"),
        healing: top(values, "healingRatio"),
        status: top(values, "statusChangesPerUse"),
        shieldBreaking: top(values, "shieldBreaksPerUse"),
        selfCost: top(values, "selfFaintRate"),
      },
    ]),
  );
}

function categoricalSummary(rows, labelIndex = 6) {
  const groups = new Map();
  for (const row of rows) {
    const difficulty = String(row.dimensions[0] ?? "unknown");
    const label = String(row.dimensions[labelIndex] ?? "unknown");
    const key = JSON.stringify([difficulty, label]);
    const target = groups.get(key) ?? { difficulty, label, observations: 0, outcomes: {}, sums: {} };
    target.observations += row.observations;
    for (const [name, value] of Object.entries(row.outcomes ?? {})) {
      increment(target.outcomes, name, value);
    }
    for (const [name, value] of Object.entries(row.sums ?? {})) {
      increment(target.sums, name, value);
    }
    groups.set(key, target);
  }
  return Object.fromEntries(
    [...new Set([...groups.values()].map(row => row.difficulty))]
      .sort()
      .map(difficulty => [
        difficulty,
        [...groups.values()]
          .filter(row => row.difficulty === difficulty)
          .sort((left, right) => right.observations - left.observations),
      ]),
  );
}

function runProgressSummary(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify(row.dimensions.slice(0, 3));
    const target = groups.get(key) ?? {
      difficulty: row.dimensions[0],
      gameMode: row.dimensions[1],
      finalWaveBand: row.dimensions[2],
      observations: 0,
      outcomes: {},
    };
    target.observations += row.observations;
    for (const [name, value] of Object.entries(row.outcomes ?? {})) {
      increment(target.outcomes, name, value);
    }
    groups.set(key, target);
  }
  return [...groups.values()].sort((left, right) => {
    return (
      String(left.difficulty).localeCompare(String(right.difficulty))
      || String(left.gameMode).localeCompare(String(right.gameMode))
      || String(left.finalWaveBand).localeCompare(String(right.finalWaveBand))
    );
  });
}

function associationRanking(rows, dictionaries, baselines) {
  const byDifficulty = {};
  for (const row of combineLabelledRows(rows, dictionaries)) {
    const wins = Number(row.outcomes.victory ?? 0);
    const losses = Number(row.outcomes.defeat ?? 0);
    const total = wins + losses;
    const baselineCounts = baselines.get(row.difficulty) ?? { victory: 0, defeat: 0 };
    const baselineTotal = baselineCounts.victory + baselineCounts.defeat;
    if (total < 100 || row.approximateSources < 10 || baselineTotal === 0) {
      continue;
    }
    const baseline = baselineCounts.victory / baselineTotal;
    const posterior = (wins + 50 * baseline) / (total + 50);
    const [low, high] = wilson(wins, total);
    const result = {
      name: row.label,
      battleExposures: total,
      approximateSources: row.approximateSources,
      winRate: wins / total,
      baselineWinRate: baseline,
      smoothedLift: posterior - baseline,
      confidence95: [low, high],
    };
    const difficultyRows = byDifficulty[row.difficulty] ?? [];
    difficultyRows.push(result);
    byDifficulty[row.difficulty] = difficultyRows;
  }
  return Object.fromEntries(
    Object.entries(byDifficulty).map(([difficulty, values]) => {
      const sorted = values.sort((left, right) => right.smoothedLift - left.smoothedLift);
      return [difficulty, { positive: sorted.slice(0, 8), negative: sorted.slice(-8).reverse() }];
    }),
  );
}

function outcomeSummary(rows, dimensionIndex) {
  const groups = new Map();
  for (const row of rows) {
    const key = String(row.dimensions[dimensionIndex] ?? "unknown");
    const target = groups.get(key) ?? { observations: 0, outcomes: {}, approximateSources: 0 };
    target.observations += row.observations;
    target.approximateSources = Math.max(target.approximateSources, row.approximateSources ?? 0);
    for (const [name, value] of Object.entries(row.outcomes ?? {})) {
      increment(target.outcomes, name, value);
    }
    groups.set(key, target);
  }
  return Object.fromEntries(
    [...groups]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => {
        const resolved = Number(value.outcomes.victory ?? 0) + Number(value.outcomes.defeat ?? 0);
        return [
          key,
          { ...value, resolvedWinRate: resolved > 0 ? Number(value.outcomes.victory ?? 0) / resolved : null },
        ];
      }),
  );
}

function runOutcomeSummary(rows) {
  const summary = outcomeSummary(rows, 0);
  for (const row of Object.values(summary)) {
    const wins = Number(row.outcomes.victory ?? 0);
    const wipes = Number(row.outcomes["player-wiped"] ?? 0);
    row.resolvedWinRate = wins + wipes > 0 ? wins / (wins + wipes) : null;
  }
  return summary;
}

function behaviorSummary(tables) {
  const summarize = (rows, labelIndex, positive) => {
    const groups = new Map();
    for (const row of rows) {
      const difficulty = String(row.dimensions[0] ?? "unknown");
      const label = String(row.dimensions[labelIndex] ?? "unknown");
      const target = groups.get(difficulty) ?? { total: 0, positive: 0 };
      target.total += row.observations;
      if (positive(label)) {
        target.positive += row.observations;
      }
      groups.set(difficulty, target);
    }
    return Object.fromEntries(
      [...groups].map(([difficulty, value]) => [
        difficulty,
        {
          observations: value.total,
          rate: value.total > 0 ? value.positive / value.total : null,
        },
      ]),
    );
  };
  return {
    switchRate: summarize(tables.actionChoice ?? [], 3, label => label === "switch"),
    teraRate: summarize(tables.teraChoice ?? [], 3, label => label === "tera"),
    immuneOrZeroDamageMoveRate: summarize(
      tables.moveChoiceQuality ?? [],
      3,
      label => label === "immune-target" || label === "zero-damage",
    ),
  };
}

function switchByHpSummary(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.dimensions[0], row.dimensions[3]]);
    const target = groups.get(key) ?? {
      difficulty: row.dimensions[0],
      hpBand: row.dimensions[3],
      decisions: 0,
      switches: 0,
    };
    target.decisions += row.observations;
    target.switches += row.dimensions[4] === "switch" ? row.observations : 0;
    groups.set(key, target);
  }
  return [...groups.values()]
    .map(row => ({ ...row, switchRate: row.switches / row.decisions }))
    .sort(
      (left, right) =>
        String(left.difficulty).localeCompare(String(right.difficulty)) || left.hpBand.localeCompare(right.hpBand),
    );
}

function teraTimingSummary(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = JSON.stringify([row.dimensions[0], row.dimensions[2]]);
    const target = groups.get(key) ?? {
      difficulty: row.dimensions[0],
      waveBand: row.dimensions[2],
      decisions: 0,
      teraChoices: 0,
    };
    target.decisions += row.observations;
    target.teraChoices += row.dimensions[3] === "tera" ? row.observations : 0;
    groups.set(key, target);
  }
  return [...groups.values()]
    .map(row => ({ ...row, teraRate: row.teraChoices / row.decisions }))
    .sort(
      (left, right) =>
        String(left.difficulty).localeCompare(String(right.difficulty)) || left.waveBand.localeCompare(right.waveBand),
    );
}

function lossPrecursorSummary(rows) {
  return rows
    .map(row => ({
      difficulty: row.dimensions[0],
      format: row.dimensions[1],
      actorHp: row.dimensions[2],
      livingParty: row.dimensions[3],
      defeats: row.observations,
      approximateSources: row.approximateSources,
    }))
    .filter(row => row.defeats >= 25 && row.approximateSources >= 5)
    .sort((left, right) => right.defeats - left.defeats);
}

function waveRisk(rows) {
  return rows
    .map(row => {
      const wins = Number(row.outcomes.victory ?? 0);
      const defeats = Number(row.outcomes.defeat ?? 0);
      const resolved = wins + defeats;
      return {
        difficulty: row.dimensions[0],
        gameMode: row.dimensions[1],
        waveBand: row.dimensions[2],
        battleType: row.dimensions[3],
        format: row.dimensions[4],
        boss: row.dimensions[5],
        battles: resolved,
        defeatRate: resolved > 0 ? defeats / resolved : null,
        approximateSources: row.approximateSources,
      };
    })
    .filter(row => row.battles >= 100 && row.approximateSources >= 10)
    .sort((left, right) => (right.defeatRate ?? -1) - (left.defeatRate ?? -1))
    .slice(0, 20);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Privacy filtering and insight derivation share one report boundary.
export function mergeCombatGameplayAnalytics(
  reports,
  { minObservations = 25, minSources = 5, includeSketches = false, dictionaries = {} } = {},
) {
  const counts = {};
  const metadata = { prefixes: [], listedObjects: 0, selectedObjects: 0, compressedBytes: 0 };
  const dictionaryHashes = new Set();
  const overallSketch = emptySourceSketch();
  const tableNames = new Set();
  for (const report of reports) {
    for (const [name, value] of Object.entries(report.counts ?? {})) {
      increment(counts, name, value);
    }
    for (const prefix of [report.metadata?.prefix, ...(report.metadata?.prefixes ?? [])]) {
      if (prefix && !metadata.prefixes.includes(prefix)) {
        metadata.prefixes.push(prefix);
      }
    }
    for (const name of ["listedObjects", "selectedObjects", "compressedBytes"]) {
      metadata[name] += Number(report.metadata?.[name] ?? 0);
    }
    for (const hash of report.dictionaryHashes ?? []) {
      dictionaryHashes.add(hash);
    }
    mergeSourceSketch(overallSketch, decodeSourceSketch(report.sourceSketch));
    for (const name of Object.keys(report.tables ?? {})) {
      tableNames.add(name);
    }
  }
  metadata.prefixes.sort();
  const tables = {};
  const analysisTables = {};
  const suppressedRows = {};
  for (const name of tableNames) {
    const rows = mergeRows(reports.flatMap(report => report.tables?.[name] ?? []));
    const filtered = filterRows(rows, minObservations, minSources, true);
    analysisTables[name] = filtered.retained;
    tables[name] = includeSketches
      ? filtered.retained
      : filtered.retained.map(({ sourceSketch: _sourceSketch, ...row }) => row);
    suppressedRows[name] = filtered.suppressed;
  }
  const baselines = battleBaselines(analysisTables.battleOutcome ?? []);
  const contextualBaselines = contextBaselines(analysisTables.battleOutcome ?? []);
  const entityRowsByKind = Object.fromEntries(
    ["species", "ability", "item", "roster-move", "chosen-move"].map(kind => [
      kind,
      contextAdjustedRows(
        (analysisTables.entityContext ?? []).filter(row => row.dimensions[6] === kind),
        contextualBaselines,
        dimensions => entityContextLabel(dimensions, dictionaries),
      ),
    ]),
  );
  const opponentThreatRows = contextAdjustedRows(
    analysisTables.opponentThreatContext ?? [],
    contextualBaselines,
    dimensions => speciesLabel(dimensions[6], dimensions[7], dimensions[8], dictionaries),
  );
  const speciesPairRows = contextAdjustedRows(
    analysisTables.speciesPairContext ?? [],
    contextualBaselines,
    dimensions => speciesPairLabel(dimensions, dictionaries),
  );
  const speciesItemRows = contextAdjustedRows(
    analysisTables.speciesItemContext ?? [],
    contextualBaselines,
    dimensions => speciesItemLabel(dimensions, dictionaries),
  );
  const speciesAbilityRows = contextAdjustedRows(
    analysisTables.speciesAbilityContext ?? [],
    contextualBaselines,
    dimensions => speciesAbilityLabel(dimensions, dictionaries),
  );
  const matchupRows = contextAdjustedRows(analysisTables.matchupContext ?? [], contextualBaselines, dimensions =>
    matchupLabel(dimensions, dictionaries),
  );
  const itemStackRows = contextAdjustedRows(analysisTables.itemStackContext ?? [], contextualBaselines, dimensions => {
    const item = entityLabelFromParts("item", dimensions[6], dimensions[7], "", dictionaries);
    return `${item} [${dimensions[8]} stacks]`;
  });
  const teamShapeRows = contextAdjustedRows(
    analysisTables.teamShapeContext ?? [],
    contextualBaselines,
    dimensions => `${dimensions[6]}: ${dimensions[7]}`,
  );
  const fieldRows = contextAdjustedRows(
    analysisTables.fieldContext ?? [],
    contextualBaselines,
    dimensions => `${dimensions[6]} ${dimensions[7]} [${dimensions[8]}]`,
  );
  const strategyRows = contextAdjustedRows(analysisTables.strategyContext ?? [], contextualBaselines, dimensions =>
    String(dimensions[6]),
  );
  const moveTacticRows = contextAdjustedRows(analysisTables.moveTactic ?? [], contextualBaselines, dimensions =>
    String(dimensions[6]),
  );
  const insights = {
    battleOutcomesByDifficulty: outcomeSummary(analysisTables.battleOutcome ?? [], 0),
    runOutcomesByDifficulty: runOutcomeSummary(analysisTables.runOutcome ?? []),
    behaviorByDifficulty: behaviorSummary(analysisTables),
    switchingByHp: switchByHpSummary(analysisTables.switchByHp ?? []),
    teraTiming: teraTimingSummary(analysisTables.teraChoice ?? []),
    lossPrecursors: lossPrecursorSummary(analysisTables.lossPrecursor ?? []),
    highestRiskBattleCohorts: waveRisk(analysisTables.battleOutcome ?? []),
    runProgression: runProgressSummary(analysisTables.runProgress ?? []),
    contextAdjusted: {
      species: adjustedRanking(entityRowsByKind.species),
      abilities: adjustedRanking(entityRowsByKind.ability),
      items: adjustedRanking(entityRowsByKind.item),
      rosterMoves: adjustedRanking(entityRowsByKind["roster-move"]),
      chosenMoves: adjustedRanking(entityRowsByKind["chosen-move"]),
      opponentThreats: adjustedRanking(opponentThreatRows),
      teamCores: interactionRanking(speciesPairRows, entityRowsByKind.species),
      speciesItems: interactionRanking(speciesItemRows, [...entityRowsByKind.species, ...entityRowsByKind.item]),
      speciesAbilities: interactionRanking(speciesAbilityRows, [
        ...entityRowsByKind.species,
        ...entityRowsByKind.ability,
      ]),
      matchups: adjustedRanking(matchupRows),
      itemStacks: adjustedRanking(itemStackRows),
      teamShapes: adjustedRanking(teamShapeRows),
      fieldStates: adjustedRanking(fieldRows),
      strategies: adjustedRanking(strategyRows),
      moveTactics: adjustedRanking(moveTacticRows),
    },
    immediateMoveResults: aggregateImmediateMoveResults(analysisTables.moveExecution ?? [], dictionaries),
    damageOpportunity: categoricalSummary(analysisTables.damageOpportunity ?? []),
    lossSequences: categoricalSummary(analysisTables.lossSequence ?? [], 4),
    associations: {
      species: associationRanking(analysisTables.speciesRoster ?? [], dictionaries, baselines),
      abilities: associationRanking(analysisTables.abilityRoster ?? [], dictionaries, baselines),
      items: associationRanking(analysisTables.itemRoster ?? [], dictionaries, baselines),
      rosterMoves: associationRanking(analysisTables.moveRoster ?? [], dictionaries, baselines),
      chosenMoves: associationRanking(analysisTables.moveChosenBattle ?? [], dictionaries, baselines),
    },
  };
  return {
    reportVersion: 2,
    contractVersion: 4,
    generatedAt: new Date().toISOString(),
    privacy: {
      rawRecordsIncluded: false,
      rawIdentifiersIncluded: false,
      minimumObservationsPerPublishedCohort: minObservations,
      minimumApproximateSourcesPerPublishedCohort: minSources,
      sourceSketchesIncluded: includeSketches,
      associationWarning:
        "Deep rankings are standardized within difficulty, mode, wave band, encounter type, format, and boss context. They remain observational rather than causal balance estimates.",
    },
    metadata,
    counts,
    approximateSources: estimateSourceSketch(overallSketch),
    ...(includeSketches ? { sourceSketch: Buffer.from(overallSketch).toString("base64") } : {}),
    dictionaryHashes: [...dictionaryHashes].sort(),
    suppressedRows,
    tables,
    insights,
  };
}

function percent(value) {
  return value == null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value) {
  if (value == null) {
    return "n/a";
  }
  const points = value * 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)} pp`;
}

function gameModeName(value) {
  return { 0: "Classic", 1: "Endless", 2: "Spliced Endless", 3: "Daily", 4: "Challenge" }[value] ?? String(value);
}

function adjustedRowText(row, metric = "adjustedLift") {
  return `${row.name} (${signedPercent(row[metric])}, observed ${percent(row.observedWinRate)} vs ${percent(row.expectedWinRate)}, ${row.battleExposures.toLocaleString()} battles)`;
}

function renderAdjusted(
  lines,
  title,
  rowsByDifficulty,
  { metric = "adjustedLift", positive = "above context", negative = "below context" } = {},
) {
  lines.push(`### ${title}`, "");
  if (Object.keys(rowsByDifficulty).length === 0) {
    lines.push("No cohort cleared the 100-battle / 10-source ranking gate.", "");
    return;
  }
  for (const [difficulty, groups] of Object.entries(rowsByDifficulty)) {
    lines.push(
      `- **${difficulty}, ${positive}:** ${
        groups.positive
          .slice(0, 6)
          .map(row => adjustedRowText(row, metric))
          .join("; ") || "none"
      }`,
    );
    lines.push(
      `- **${difficulty}, ${negative}:** ${
        groups.negative
          .slice(0, 6)
          .map(row => adjustedRowText(row, metric))
          .join("; ") || "none"
      }`,
    );
    if (groups.popular?.length > 0) {
      lines.push(
        `- **${difficulty}, most exposed:** ${groups.popular
          .slice(0, 6)
          .map(row => `${row.name} (${row.battleExposures.toLocaleString()})`)
          .join("; ")}`,
      );
    }
  }
  lines.push("");
}

function immediateRowText(row, metric) {
  const value = metric === "uses" ? row.uses.toLocaleString() : Number(row[metric] ?? 0).toFixed(3);
  return `${row.name} (${value}, ${row.uses.toLocaleString()} uses)`;
}

function renderImmediateMoves(lines, results) {
  lines.push("## Resolved move outcomes", "");
  lines.push(
    "Only actions with an unambiguous one-decision transition are included, avoiding double attribution in simultaneous multi-battler turns.",
    "",
  );
  for (const [difficulty, groups] of Object.entries(results)) {
    lines.push(`### ${difficulty}`, "");
    for (const [label, metric] of [
      ["most used", "uses"],
      ["damage dealt", "averageDamageRatio"],
      ["knockouts", "knockoutRate"],
      ["healing", "healingRatio"],
      ["status changes", "statusChangesPerUse"],
      ["boss shield breaks", "shieldBreaksPerUse"],
      ["self-faint cost", "selfFaintRate"],
    ]) {
      const key = {
        "most used": "mostUsed",
        "damage dealt": "damage",
        knockouts: "knockouts",
        healing: "healing",
        "status changes": "status",
        "boss shield breaks": "shieldBreaking",
        "self-faint cost": "selfCost",
      }[label];
      lines.push(
        `- **${label}:** ${
          (groups[key] ?? [])
            .slice(0, 6)
            .map(row => immediateRowText(row, metric))
            .join("; ") || "none"
        }`,
      );
    }
    lines.push("");
  }
}

function renderCategorical(lines, title, summary, limit = 10) {
  lines.push(`## ${title}`, "");
  for (const [difficulty, rows] of Object.entries(summary)) {
    const total = rows.reduce((sum, row) => sum + row.observations, 0);
    lines.push(
      `- **${difficulty}:** ${rows
        .slice(0, limit)
        .map(
          row =>
            `${row.label} ${percent(row.observations / Math.max(total, 1))} (${row.observations.toLocaleString()})`,
        )
        .join("; ")}`,
    );
  }
  lines.push("");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The Markdown renderer mirrors the report sections.
export function gameplayAnalyticsMarkdown(report) {
  const lines = [
    "# Production gameplay analytics",
    "",
    `Generated at \`${report.generatedAt}\` from contract-v4 production telemetry on remote GitHub runners.`,
    "Raw records remained on ephemeral runner storage. Published cohorts passed the configured support/privacy gates.",
    "",
    "## Coverage",
    "",
    `- Date prefixes: ${report.metadata.prefixes.at(0) ?? "n/a"} through ${report.metadata.prefixes.at(-1) ?? "n/a"}`,
    `- Selected telemetry objects: ${report.metadata.selectedObjects.toLocaleString()}`,
    `- Compressed telemetry bytes processed: ${report.metadata.compressedBytes.toLocaleString()}`,
    `- Episodes observed: ${Number(report.counts.episodes ?? 0).toLocaleString()}`,
    `- Human combat decisions: ${Number(report.counts.decisions ?? 0).toLocaleString()}`,
    `- Battle terminals: ${Number(report.counts.battleTerminals ?? 0).toLocaleString()}`,
    `- Approximate distinct source partitions: ${report.approximateSources.toLocaleString()}`,
    "",
    "## Outcomes",
    "",
  ];
  for (const [difficulty, row] of Object.entries(report.insights.battleOutcomesByDifficulty)) {
    lines.push(
      `- **${difficulty}:** ${row.observations.toLocaleString()} terminal battles; resolved win rate ${percent(row.resolvedWinRate)}; outcomes ${JSON.stringify(row.outcomes)}`,
    );
  }
  lines.push("", "### Completed runs", "");
  for (const [difficulty, row] of Object.entries(report.insights.runOutcomesByDifficulty)) {
    lines.push(
      `- **${difficulty}:** ${row.observations.toLocaleString()} run terminals; win rate excluding abandonment ${percent(row.resolvedWinRate)}; outcomes ${JSON.stringify(row.outcomes)}`,
    );
  }
  lines.push("", "## Player behavior", "");
  const behavior = report.insights.behaviorByDifficulty;
  const difficulties = new Set([
    ...Object.keys(behavior.switchRate),
    ...Object.keys(behavior.teraRate),
    ...Object.keys(behavior.immuneOrZeroDamageMoveRate),
  ]);
  for (const difficulty of [...difficulties].sort()) {
    lines.push(
      `- **${difficulty}:** switch ${percent(behavior.switchRate[difficulty]?.rate)}, Tera ${percent(behavior.teraRate[difficulty]?.rate)}, immune/zero-damage damaging choices ${percent(behavior.immuneOrZeroDamageMoveRate[difficulty]?.rate)}`,
    );
  }
  lines.push("", "### Switching by current HP", "");
  for (const difficulty of [...difficulties].sort()) {
    const rows = report.insights.switchingByHp.filter(row => row.difficulty === difficulty);
    lines.push(
      `- **${difficulty}:** ${rows.map(row => `${row.hpBand} ${percent(row.switchRate)} (${row.decisions.toLocaleString()})`).join("; ") || "none"}`,
    );
  }
  lines.push("", "### Tera timing", "");
  for (const difficulty of [...difficulties].sort()) {
    const rows = report.insights.teraTiming
      .filter(row => row.difficulty === difficulty && row.teraChoices > 0)
      .sort((left, right) => right.teraChoices - left.teraChoices);
    lines.push(
      `- **${difficulty}:** ${
        rows
          .slice(0, 8)
          .map(row => `${row.waveBand} ${row.teraChoices.toLocaleString()} uses (${percent(row.teraRate)})`)
          .join("; ") || "no recorded Tera choices"
      }`,
    );
  }
  lines.push("", "### Common final-decision states in defeats", "");
  for (const difficulty of [...difficulties].sort()) {
    const rows = report.insights.lossPrecursors.filter(row => row.difficulty === difficulty).slice(0, 8);
    lines.push(
      `- **${difficulty}:** ${rows.map(row => `${row.format}, actor ${row.actorHp} HP, ${row.livingParty} living (${row.defeats.toLocaleString()})`).join("; ") || "none"}`,
    );
  }
  lines.push("", "## Highest-risk cohorts", "");
  for (const row of report.insights.highestRiskBattleCohorts.slice(0, 12)) {
    lines.push(
      `- ${row.difficulty}/${gameModeName(row.gameMode)}, waves ${row.waveBand}, ${row.battleType}/${row.format}/${row.boss}: ${percent(row.defeatRate)} defeats across ${row.battles.toLocaleString()} resolved battles`,
    );
  }
  lines.push("", "## Run terminal concentrations", "");
  const runGroups = new Map();
  for (const row of report.insights.runProgression ?? []) {
    const key = `${row.difficulty}/${gameModeName(row.gameMode)}`;
    const values = runGroups.get(key) ?? [];
    values.push(row);
    runGroups.set(key, values);
  }
  for (const [label, rows] of runGroups) {
    const wipes = [...rows]
      .filter(row => Number(row.outcomes?.["player-wiped"] ?? 0) > 0)
      .sort((left, right) => Number(right.outcomes["player-wiped"]) - Number(left.outcomes["player-wiped"]))
      .slice(0, 6);
    lines.push(
      `- **${label}:** most wipe terminals at ${wipes.map(row => `${row.finalWaveBand} (${Number(row.outcomes["player-wiped"]).toLocaleString()})`).join("; ") || "none"}`,
    );
  }
  lines.push("", "## Context-adjusted combat patterns", "");
  lines.push(
    "Each ranking compares a cohort against battles at the same difficulty, game mode, wave band, encounter type, format, and boss state. Positive or negative percentage points are shrunk context-adjusted associations, not causal balance estimates.",
    "",
  );
  const adjusted = report.insights.contextAdjusted;
  renderAdjusted(lines, "Species/forms", adjusted.species);
  renderAdjusted(lines, "Opponent threats", adjusted.opponentThreats, {
    positive: "easier than context",
    negative: "more dangerous than context",
  });
  renderAdjusted(lines, "Abilities and innates", adjusted.abilities);
  renderAdjusted(lines, "Held items", adjusted.items);
  renderAdjusted(lines, "Moves carried", adjusted.rosterMoves);
  renderAdjusted(lines, "Moves actually selected", adjusted.chosenMoves);
  lines.push("## Team construction and interactions", "");
  lines.push(
    "Core/item/ability interaction scores subtract the independently observed component lifts after context adjustment. They are exploratory synergy signals and require replay validation.",
    "",
  );
  renderAdjusted(lines, "Species pairs", adjusted.teamCores, {
    positive: "positive interaction",
    negative: "negative interaction",
  });
  renderAdjusted(lines, "Species + item combinations", adjusted.speciesItems, {
    positive: "positive interaction",
    negative: "negative interaction",
  });
  renderAdjusted(lines, "Species + ability combinations", adjusted.speciesAbilities, {
    positive: "positive interaction",
    negative: "negative interaction",
  });
  renderAdjusted(lines, "Active matchups", adjusted.matchups, { positive: "favorable", negative: "unfavorable" });
  renderAdjusted(lines, "Item stack bands", adjusted.itemStacks);
  renderAdjusted(lines, "Team-shape features", adjusted.teamShapes);
  renderAdjusted(lines, "Field states", adjusted.fieldStates);
  renderAdjusted(lines, "Battle strategy signatures", adjusted.strategies);
  renderAdjusted(lines, "Move tactical properties", adjusted.moveTactics);
  renderImmediateMoves(lines, report.insights.immediateMoveResults);
  renderCategorical(lines, "Damage-opportunity choices", report.insights.damageOpportunity);
  renderCategorical(lines, "Final three-action sequences before losses", report.insights.lossSequences);
  lines.push("## Quality notes", "");
  lines.push(`- Hard-quarantined episodes: ${Number(report.counts.hardQuarantinedEpisodes ?? 0).toLocaleString()}`);
  lines.push(`- Incomplete episodes: ${Number(report.counts.incompleteEpisodes ?? 0).toLocaleString()}`);
  lines.push(
    `- Battles with no joinable decisions: ${Number(report.counts.battlesWithoutDecisions ?? 0).toLocaleString()}`,
  );
  lines.push(
    "- Source partitions are stable accounts for logged-in users, but per-browser-session identities for guests.",
  );
  lines.push(
    "- Date-prefix parallelism can split a run crossing UTC midnight; those joins remain incomplete rather than being guessed.",
  );
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reports = loadReports(args.inputs);
  const hashes = [...new Set(reports.flatMap(report => report.dictionaryHashes ?? []))].sort();
  if (args.dictionaryHashesOutput) {
    writeFileSync(args.dictionaryHashesOutput, `${hashes.join("\n")}\n`);
  }
  const dictionaries = loadDictionaries(args.dictionaryDirectory, hashes);
  const merged = mergeCombatGameplayAnalytics(reports, {
    minObservations: args.minObservations,
    minSources: args.minSources,
    includeSketches: args.includeSketches,
    dictionaries,
  });
  writeFileSync(args.output, `${JSON.stringify(merged, null, 2)}\n`);
  writeFileSync(args.markdownOutput, gameplayAnalyticsMarkdown(merged));
  console.log(gameplayAnalyticsMarkdown(merged));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
