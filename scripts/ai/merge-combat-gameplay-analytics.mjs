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
    if (parsed?.reportVersion === 1 && parsed?.contractVersion === 4 && parsed?.tables) {
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

function entityLabel(dimensions, dictionaries) {
  const [kind, _difficulty, dictionaryHash, value, extra] = dimensions;
  const dictionary = dictionaries[dictionaryHash];
  if (kind === "species") {
    const entry = dictionary?.speciesForms?.[`${value}:${extra}`];
    return entry ? `${entry.name}${entry.formKey ? ` (${entry.formKey})` : ""}` : `Species ${value}:${extra}`;
  }
  if (kind === "move") {
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

function waveRisk(rows) {
  return rows
    .map(row => {
      const wins = Number(row.outcomes.victory ?? 0);
      const defeats = Number(row.outcomes.defeat ?? 0);
      const resolved = wins + defeats;
      return {
        difficulty: row.dimensions[0],
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
  const suppressedRows = {};
  for (const name of tableNames) {
    const rows = mergeRows(reports.flatMap(report => report.tables?.[name] ?? []));
    const filtered = filterRows(rows, minObservations, minSources, includeSketches);
    tables[name] = filtered.retained;
    suppressedRows[name] = filtered.suppressed;
  }
  const baselines = battleBaselines(tables.battleOutcome ?? []);
  const insights = {
    battleOutcomesByDifficulty: outcomeSummary(tables.battleOutcome ?? [], 0),
    runOutcomesByDifficulty: outcomeSummary(tables.runOutcome ?? [], 0),
    behaviorByDifficulty: behaviorSummary(tables),
    highestRiskBattleCohorts: waveRisk(tables.battleOutcome ?? []),
    associations: {
      species: associationRanking(tables.speciesRoster ?? [], dictionaries, baselines),
      abilities: associationRanking(tables.abilityRoster ?? [], dictionaries, baselines),
      items: associationRanking(tables.itemRoster ?? [], dictionaries, baselines),
      rosterMoves: associationRanking(tables.moveRoster ?? [], dictionaries, baselines),
      chosenMoves: associationRanking(tables.moveChosenBattle ?? [], dictionaries, baselines),
    },
  };
  return {
    reportVersion: 1,
    contractVersion: 4,
    generatedAt: new Date().toISOString(),
    privacy: {
      rawRecordsIncluded: false,
      rawIdentifiersIncluded: false,
      minimumObservationsPerPublishedCohort: minObservations,
      minimumApproximateSourcesPerPublishedCohort: minSources,
      sourceSketchesIncluded: includeSketches,
      associationWarning: "Observed associations are not causal balance estimates.",
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

function renderAssociations(lines, title, rowsByDifficulty) {
  lines.push(`### ${title}`, "");
  if (Object.keys(rowsByDifficulty).length === 0) {
    lines.push("No cohort cleared the 100-battle / 10-source ranking gate.", "");
    return;
  }
  for (const [difficulty, groups] of Object.entries(rowsByDifficulty)) {
    const formatRows = rows =>
      rows
        .slice(0, 5)
        .map(row => `${row.name} (${percent(row.winRate)}, ${row.battleExposures.toLocaleString()} battles)`)
        .join("; ");
    lines.push(`- **${difficulty} positive association:** ${formatRows(groups.positive) || "none"}`);
    lines.push(`- **${difficulty} negative association:** ${formatRows(groups.negative) || "none"}`);
  }
  lines.push("");
}

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
    `- Approximate distinct sources: ${report.approximateSources.toLocaleString()}`,
    "",
    "## Outcomes",
    "",
  ];
  for (const [difficulty, row] of Object.entries(report.insights.battleOutcomesByDifficulty)) {
    lines.push(
      `- **${difficulty}:** ${row.observations.toLocaleString()} terminal battles; resolved win rate ${percent(row.resolvedWinRate)}; outcomes ${JSON.stringify(row.outcomes)}`,
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
  lines.push("", "## Highest-risk cohorts", "");
  for (const row of report.insights.highestRiskBattleCohorts.slice(0, 12)) {
    lines.push(
      `- ${row.difficulty}, waves ${row.waveBand}, ${row.battleType}/${row.format}/${row.boss}: ${percent(row.defeatRate)} defeats across ${row.battles.toLocaleString()} resolved battles`,
    );
  }
  lines.push("", "## Observed balance associations", "");
  lines.push(
    "These are support-filtered correlations with battle outcomes, not proof that an entity causes wins or losses.",
    "",
  );
  renderAssociations(lines, "Species/forms", report.insights.associations.species);
  renderAssociations(lines, "Abilities", report.insights.associations.abilities);
  renderAssociations(lines, "Items", report.insights.associations.items);
  renderAssociations(lines, "Moves present on rosters", report.insights.associations.rosterMoves);
  renderAssociations(lines, "Moves actually chosen", report.insights.associations.chosenMoves);
  lines.push("## Quality notes", "");
  lines.push(`- Hard-quarantined episodes: ${Number(report.counts.hardQuarantinedEpisodes ?? 0).toLocaleString()}`);
  lines.push(`- Incomplete episodes: ${Number(report.counts.incompleteEpisodes ?? 0).toLocaleString()}`);
  lines.push(
    `- Battles with no joinable decisions: ${Number(report.counts.battlesWithoutDecisions ?? 0).toLocaleString()}`,
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
