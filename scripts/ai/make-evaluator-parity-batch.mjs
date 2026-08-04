#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { readGhostFixture } from "./ghost-gauntlet.mjs";
import { buildGhostEvalBatchForPairs } from "./make-ghost-eval-batch.mjs";

export const EVALUATOR_PARITY_PAIR_INDICES = [0, 1, 25, 26, 50, 51, 75, 76];
export const EVALUATOR_PARITY_FIXED_SEEDS = [11, 29, 47, 83];
export const EVALUATOR_PARITY_ARMS = ["random-vs-random", "engine-hardest-vs-native"];

export function buildEvaluatorParityBatch(fixture, shardIndex, shardCount = 4) {
  if (!Number.isInteger(shardIndex) || !Number.isInteger(shardCount) || shardCount < 1) {
    throw new Error("shard index and count must be integers, with a positive shard count");
  }
  if (shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error(`shard index must be from 0 through ${shardCount - 1}`);
  }
  const pairIndices = EVALUATOR_PARITY_PAIR_INDICES.filter((_, index) => index % shardCount === shardIndex);
  if (pairIndices.length === 0) {
    throw new Error(`shard ${shardIndex}/${shardCount} contains no evaluator parity pairs`);
  }
  const built = buildGhostEvalBatchForPairs(fixture, pairIndices, EVALUATOR_PARITY_FIXED_SEEDS, EVALUATOR_PARITY_ARMS);
  return {
    ...built,
    manifests: built.manifests.map(manifest => ({
      ...manifest,
      calibrationArms: EVALUATOR_PARITY_ARMS,
    })),
    pairIndices,
  };
}

function main() {
  const [fixturePath, shardIndexRaw, shardCountRaw, outputDir, prefix] = process.argv.slice(2);
  if (!fixturePath || shardIndexRaw === undefined || shardCountRaw === undefined || !outputDir || !prefix) {
    console.error(
      "usage: node scripts/ai/make-evaluator-parity-batch.mjs "
        + "FIXTURE.json SHARD_INDEX SHARD_COUNT OUTPUT_DIR PREFIX",
    );
    process.exit(2);
  }
  const built = buildEvaluatorParityBatch(readGhostFixture(fixturePath), Number(shardIndexRaw), Number(shardCountRaw));
  mkdirSync(outputDir, { recursive: true });
  for (const manifest of built.manifests) {
    writeFileSync(join(outputDir, `${manifest.pairId}-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  writeFileSync(join(outputDir, `${prefix}-batch.json`), `${JSON.stringify(built.batch, null, 2)}\n`);
  console.log(
    `${prefix}: pairs ${built.pairIndices.join(",")} x ${EVALUATOR_PARITY_FIXED_SEEDS.length} seeds, `
      + `${built.batch.episodes.length} mirrored battle legs per arm`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
