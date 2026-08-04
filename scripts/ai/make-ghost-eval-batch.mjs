#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertInversePair, buildGhostPair, readGhostFixture } from "./ghost-gauntlet.mjs";

export const GHOST_EVAL_CONTROLLERS = [
  "random-init-transformer-v4",
  "showdown-transfer-transformer-v4",
  "tree-ensemble-v1",
  "smart-default-v1",
  "engine-hardest-v1",
];
export const GHOST_EVAL_FIXED_SEEDS = [17, 43, 97];
export const EXPECTED_GHOST_EVAL_PAIRS = 100;

function validateControllers(controllers) {
  if (
    !Array.isArray(controllers)
    || controllers.length === 0
    || controllers.some(controller => typeof controller !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(controller))
    || new Set(controllers).size !== controllers.length
  ) {
    throw new Error("controllers must be a non-empty list of unique kebab-case identifiers");
  }
  return [...controllers];
}

function combatOnlyScenario(scenario) {
  const { eggs: _eggs, ...combatOnly } = scenario;
  return combatOnly;
}

export function buildGhostEvalBatch(fixture, pairStart, pairCount, controllers = GHOST_EVAL_CONTROLLERS) {
  const availablePairs = fixture.teams.length / 2;
  if (!Number.isInteger(pairStart) || !Number.isInteger(pairCount) || pairStart < 0 || pairCount < 1) {
    throw new Error("pair start must be non-negative and pair count must be positive");
  }
  if (pairStart + pairCount > availablePairs) {
    throw new Error(`pair range ${pairStart}..${pairStart + pairCount - 1} exceeds ${availablePairs} pairs`);
  }
  return buildGhostEvalBatchForPairs(
    fixture,
    Array.from({ length: pairCount }, (_, index) => pairStart + index),
    GHOST_EVAL_FIXED_SEEDS,
    controllers,
  );
}

export function buildGhostEvalBatchForPairs(
  fixture,
  pairIndices,
  fixedSeeds = GHOST_EVAL_FIXED_SEEDS,
  controllers = GHOST_EVAL_CONTROLLERS,
) {
  const availablePairs = fixture.teams.length / 2;
  if (
    !Array.isArray(pairIndices)
    || pairIndices.length === 0
    || pairIndices.some(pairIndex => !Number.isInteger(pairIndex) || pairIndex < 0 || pairIndex >= availablePairs)
    || new Set(pairIndices).size !== pairIndices.length
  ) {
    throw new Error(`pair indices must be unique integers from 0 through ${availablePairs - 1}`);
  }
  if (
    !Array.isArray(fixedSeeds)
    || fixedSeeds.length === 0
    || fixedSeeds.some(seed => !Number.isInteger(seed) || seed < 0)
    || new Set(fixedSeeds).size !== fixedSeeds.length
  ) {
    throw new Error("fixed seeds must be unique non-negative integers");
  }
  const playerControllers = validateControllers(controllers);
  const manifests = [];
  const episodes = [];
  for (const pairIndex of pairIndices) {
    for (const fixedSeed of fixedSeeds) {
      const pair = buildGhostPair(fixture, pairIndex, fixedSeed);
      assertInversePair(pair);
      const manifest = { ...pair.manifest, playerControllers };
      manifests.push(manifest);
      episodes.push(
        {
          id: `${manifest.pairId}-leg-a`,
          splitGroupId: manifest.pairId,
          scenario: combatOnlyScenario(pair.legA),
        },
        {
          id: `${manifest.pairId}-leg-b`,
          splitGroupId: manifest.pairId,
          scenario: combatOnlyScenario(pair.legB),
        },
      );
    }
  }
  return { version: 1, manifests, batch: { version: 1, episodes } };
}

function main() {
  const [fixturePath, pairStartRaw, pairCountRaw, outputDir, prefix, controllersRaw] = process.argv.slice(2);
  if (!fixturePath || pairStartRaw === undefined || pairCountRaw === undefined || !outputDir || !prefix) {
    console.error(
      "usage: node scripts/ai/make-ghost-eval-batch.mjs FIXTURE.json PAIR_START PAIR_COUNT OUTPUT_DIR PREFIX",
    );
    process.exit(2);
  }
  const controllers = controllersRaw ? controllersRaw.split(",") : GHOST_EVAL_CONTROLLERS;
  const built = buildGhostEvalBatch(
    readGhostFixture(fixturePath),
    Number(pairStartRaw),
    Number(pairCountRaw),
    controllers,
  );
  mkdirSync(outputDir, { recursive: true });
  for (const manifest of built.manifests) {
    writeFileSync(join(outputDir, `${manifest.pairId}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(join(outputDir, `${prefix}-batch.json`), `${JSON.stringify(built.batch, null, 2)}\n`);
  console.log(
    `${prefix}: ${pairCountRaw} roster pairs x ${GHOST_EVAL_FIXED_SEEDS.length} seeds, ${built.batch.episodes.length} battle legs`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
