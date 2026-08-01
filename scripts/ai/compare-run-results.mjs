#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function normalizeRunResult(result) {
  if (result.combatOnly === true) {
    const { totalMs: _totalMs, averageMsPerEpisode: _averageMsPerEpisode, ...stable } = result;
    return {
      ...stable,
      results: stable.results.map(
        ({
          bootMs: _episodeBootMs,
          combatMs: _episodeCombatMs,
          decisions: _decisions,
          phaseMs: _phaseMs,
          slowPhases: _slowPhases,
          ...episode
        }) => episode,
      ),
    };
  }
  const { totalMs: _totalMs, bootMs: _bootMs, msPerWave: _msPerWave, waves = [], ...stable } = result;
  const { biomeOptions: _biomeOptions, ...stableState } = stable.state ?? {};
  return {
    ...stable,
    state: stableState,
    waves: waves.map(({ ms: _ms, ...wave }) => wave),
  };
}

function normalizedResult(path) {
  return normalizeRunResult(JSON.parse(readFileSync(path, "utf8")));
}

function main() {
  const [withoutCapturePath, withCapturePath, datasetPath] = process.argv.slice(2);
  if (!withoutCapturePath || !withCapturePath || !datasetPath) {
    console.error("usage: node scripts/ai/compare-run-results.mjs WITHOUT.json WITH.json DATASET.jsonl");
    process.exit(2);
  }

  const withoutCapture = normalizedResult(withoutCapturePath);
  const withCapture = normalizedResult(withCapturePath);
  if (JSON.stringify(withoutCapture) !== JSON.stringify(withCapture)) {
    console.error("AI capture changed the real-engine result");
    console.error(JSON.stringify({ withoutCapture, withCapture }, null, 2));
    process.exit(1);
  }

  const rows = readFileSync(datasetPath, "utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map(line => JSON.parse(line));
  const decisions = rows.filter(row => row.kind === "combat_decision");
  const terminals = rows.filter(row => row.kind === "episode_terminal");
  if (decisions.length === 0 || terminals.length !== 1) {
    console.error(`invalid smoke dataset: ${decisions.length} decisions, ${terminals.length} terminals`);
    process.exit(1);
  }
  if (decisions.some(row => row.policySource !== "smart-default-v1" || row.policyTarget !== false)) {
    console.error("capture smoke contains an invalid policy source or policy target");
    process.exit(1);
  }
  if (decisions.some(row => row.observation.opponentActive.some(mon => mon.heldItems !== null))) {
    console.error("opponent held-item leakage detected");
    process.exit(1);
  }
  console.log(`capture-neutral: ${decisions.length} decisions and one terminal`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
