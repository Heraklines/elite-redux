#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertInversePair, buildGhostPair, readGhostFixture } from "./ghost-gauntlet.mjs";

export const GHOST_EVAL_CONTROLLERS = [
  "selected-tree-v1",
  "outcome-tree-v1",
  "candidate-transformer-v1",
  "smart-default-v1",
];
export const EXPECTED_GHOST_EVAL_PAIRS = 50;

function combatOnlyScenario(scenario) {
  const { eggs: _eggs, ...combatOnly } = scenario;
  return combatOnly;
}

export function buildGhostEvalBatch(fixture, pairStart, pairCount) {
  const availablePairs = fixture.teams.length / 2;
  if (!Number.isInteger(pairStart) || !Number.isInteger(pairCount) || pairStart < 0 || pairCount < 1) {
    throw new Error("pair start must be non-negative and pair count must be positive");
  }
  if (pairStart + pairCount > availablePairs) {
    throw new Error(`pair range ${pairStart}..${pairStart + pairCount - 1} exceeds ${availablePairs} pairs`);
  }
  const manifests = [];
  const episodes = [];
  for (let pairIndex = pairStart; pairIndex < pairStart + pairCount; pairIndex++) {
    const pair = buildGhostPair(fixture, pairIndex);
    assertInversePair(pair);
    const manifest = { ...pair.manifest, playerControllers: GHOST_EVAL_CONTROLLERS };
    manifests.push(manifest);
    episodes.push(
      { id: `${manifest.pairId}-leg-a`, splitGroupId: manifest.pairId, scenario: combatOnlyScenario(pair.legA) },
      { id: `${manifest.pairId}-leg-b`, splitGroupId: manifest.pairId, scenario: combatOnlyScenario(pair.legB) },
    );
  }
  return { version: 1, manifests, batch: { version: 1, episodes } };
}

function main() {
  const [fixturePath, pairStartRaw, pairCountRaw, outputDir, prefix] = process.argv.slice(2);
  if (!fixturePath || pairStartRaw === undefined || pairCountRaw === undefined || !outputDir || !prefix) {
    console.error(
      "usage: node scripts/ai/make-ghost-eval-batch.mjs FIXTURE.json PAIR_START PAIR_COUNT OUTPUT_DIR PREFIX",
    );
    process.exit(2);
  }
  const built = buildGhostEvalBatch(readGhostFixture(fixturePath), Number(pairStartRaw), Number(pairCountRaw));
  mkdirSync(outputDir, { recursive: true });
  for (const manifest of built.manifests) {
    writeFileSync(join(outputDir, `${manifest.pairId}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(join(outputDir, `${prefix}-batch.json`), `${JSON.stringify(built.batch, null, 2)}\n`);
  console.log(`${prefix}: ${built.manifests.length} inverse pairs, ${built.batch.episodes.length} battle legs`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
