#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log(
    "Usage: node scripts/run-combat-batch.mjs @batch.json "
      + "[--turns N] [--json-out FILE] [--ai-data-out FILE] "
      + "[--ai-model FILE] [--ai-neural-model DIR] [--ai-policy MODE] [--ai-epsilon P] "
      + "[--record-engine-baseline] [--real-rng]",
  );
  process.exit(argv.length === 0 ? 1 : 0);
}

const batchArg = argv[0];
const batchRaw = batchArg.startsWith("@") ? readFileSync(batchArg.slice(1), "utf8") : batchArg;
const parsed = JSON.parse(batchRaw);
if (parsed?.version !== 1 || !Array.isArray(parsed.episodes) || parsed.episodes.length === 0) {
  console.error("combat batch must be version 1 with at least one episode");
  process.exit(1);
}

let turns = "80";
let jsonOut;
let aiDataOut;
let aiModel;
let aiNeuralModel;
let aiPolicy;
let aiEpsilon;
let recordEngineBaseline = false;
let realRng = false;
for (let index = 1; index < argv.length; index++) {
  const arg = argv[index];
  if (arg === "--turns") {
    turns = argv[++index];
  } else if (arg === "--json-out") {
    jsonOut = argv[++index];
  } else if (arg === "--ai-data-out") {
    aiDataOut = argv[++index];
  } else if (arg === "--ai-model") {
    aiModel = argv[++index];
  } else if (arg === "--ai-neural-model") {
    aiNeuralModel = argv[++index];
  } else if (arg === "--ai-policy") {
    aiPolicy = argv[++index];
    if (!["first-usable", "smart-default", "engine-hardest"].includes(aiPolicy)) {
      console.error("--ai-policy must be first-usable, smart-default, or engine-hardest");
      process.exit(1);
    }
  } else if (arg === "--ai-epsilon") {
    aiEpsilon = argv[++index];
    const value = Number(aiEpsilon);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      console.error("--ai-epsilon must be between 0 and 1");
      process.exit(1);
    }
  } else if (arg === "--record-engine-baseline") {
    recordEngineBaseline = true;
  } else if (arg === "--real-rng") {
    realRng = true;
  } else {
    console.error(`unknown arg: ${arg}`);
    process.exit(1);
  }
}

if (!Number.isInteger(Number(turns)) || Number(turns) < 1) {
  console.error("--turns must be a positive integer");
  process.exit(1);
}

const env = {
  ...process.env,
  ER_SCENARIO: "1",
  ER_RUN_COMBAT_BATCH: batchArg.startsWith("@") ? batchArg : batchRaw,
  ER_RUN_TURNS: turns,
  ER_RUN_QUIET: "1",
};
if (jsonOut) {
  env.ER_RUN_JSON_OUT = jsonOut;
}
if (aiDataOut) {
  env.ER_RUN_AI_DATA_OUT = aiDataOut;
}
if (aiModel) {
  env.ER_AI_POLICY_MODEL = aiModel.startsWith("@") ? aiModel.slice(1) : aiModel;
}
if (aiNeuralModel) {
  env.ER_AI_NEURAL_POLICY_MODEL = aiNeuralModel.startsWith("@") ? aiNeuralModel.slice(1) : aiNeuralModel;
}
if (aiPolicy) {
  env.ER_AI_POLICY_MODE = aiPolicy;
}
if (aiEpsilon) {
  env.ER_AI_POLICY_EPSILON = aiEpsilon;
}
if (recordEngineBaseline) {
  env.ER_AI_RECORD_ENGINE_BASELINE = "1";
}
if (realRng) {
  env.ER_RUN_REAL_RNG = "1";
}

const result = spawnSync(
  "npx",
  ["vitest", "run", "test/tools/run-scenario.test.ts", "--pool=threads", "--silent=true", "--no-color"],
  {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  },
);
process.exit(result.status ?? 1);
