#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  appendCombatTimeout,
  initializeCombatCheckpoint,
  readMatchingCombatCheckpoint,
} from "./combat-batch-watchdog.mjs";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  console.log(
    "Usage: node scripts/run-combat-batch.mjs @batch.json "
      + "[--turns N] [--json-out FILE] [--ai-data-out FILE] "
      + "[--ai-model FILE] [--ai-neural-model DIR] [--ai-policy MODE] [--ai-epsilon P] "
      + "[--ai-source SOURCE] [--ai-policy-target 0|1] "
      + "[--opponent-ai-model FILE] [--opponent-ai-neural-model DIR] "
      + "[--opponent-ai-policy MODE] [--opponent-ai-epsilon P] "
      + "[--opponent-ai-source SOURCE] [--opponent-ai-policy-target 0|1] "
      + "[--record-engine-baseline] [--real-rng] [--resume] [--test-timeout-ms N] "
      + "[--episode-timeout-ms N]",
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
let aiSource;
let aiPolicyTarget;
let opponentAiModel;
let opponentAiNeuralModel;
let opponentAiPolicy;
let opponentAiEpsilon;
let opponentAiSource;
let opponentAiPolicyTarget;
let recordEngineBaseline = false;
let realRng = false;
let resume = false;
let testTimeoutMs;
let episodeTimeoutMs = process.env.ER_COMBAT_EPISODE_TIMEOUT_MS
  ? Number(process.env.ER_COMBAT_EPISODE_TIMEOUT_MS)
  : undefined;
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
    if (!["first-usable", "smart-default", "engine-hardest", "random"].includes(aiPolicy)) {
      console.error("--ai-policy must be first-usable, smart-default, engine-hardest, or random");
      process.exit(1);
    }
  } else if (arg === "--ai-epsilon") {
    aiEpsilon = argv[++index];
    const value = Number(aiEpsilon);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      console.error("--ai-epsilon must be between 0 and 1");
      process.exit(1);
    }
  } else if (arg === "--ai-source") {
    aiSource = argv[++index];
  } else if (arg === "--ai-policy-target") {
    aiPolicyTarget = argv[++index];
    if (aiPolicyTarget !== "0" && aiPolicyTarget !== "1") {
      console.error("--ai-policy-target must be 0 or 1");
      process.exit(1);
    }
  } else if (arg === "--opponent-ai-model") {
    opponentAiModel = argv[++index];
  } else if (arg === "--opponent-ai-neural-model") {
    opponentAiNeuralModel = argv[++index];
  } else if (arg === "--opponent-ai-policy") {
    opponentAiPolicy = argv[++index];
    if (!["engine-hardest", "first-usable", "random"].includes(opponentAiPolicy)) {
      console.error("--opponent-ai-policy must be engine-hardest, first-usable, or random");
      process.exit(1);
    }
  } else if (arg === "--opponent-ai-epsilon") {
    opponentAiEpsilon = argv[++index];
    const value = Number(opponentAiEpsilon);
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      console.error("--opponent-ai-epsilon must be between 0 and 1");
      process.exit(1);
    }
  } else if (arg === "--opponent-ai-source") {
    opponentAiSource = argv[++index];
  } else if (arg === "--opponent-ai-policy-target") {
    opponentAiPolicyTarget = argv[++index];
    if (opponentAiPolicyTarget !== "0" && opponentAiPolicyTarget !== "1") {
      console.error("--opponent-ai-policy-target must be 0 or 1");
      process.exit(1);
    }
  } else if (arg === "--record-engine-baseline") {
    recordEngineBaseline = true;
  } else if (arg === "--real-rng") {
    realRng = true;
  } else if (arg === "--resume") {
    resume = true;
  } else if (arg === "--test-timeout-ms") {
    testTimeoutMs = argv[++index];
    if (!Number.isInteger(Number(testTimeoutMs)) || Number(testTimeoutMs) < 1) {
      console.error("--test-timeout-ms must be a positive integer");
      process.exit(1);
    }
  } else if (arg === "--episode-timeout-ms") {
    episodeTimeoutMs = Number(argv[++index]);
    if (!Number.isInteger(episodeTimeoutMs) || episodeTimeoutMs < 1) {
      console.error("--episode-timeout-ms must be a positive integer");
      process.exit(1);
    }
  } else {
    console.error(`unknown arg: ${arg}`);
    process.exit(1);
  }
}

if (!Number.isInteger(Number(turns)) || Number(turns) < 1) {
  console.error("--turns must be a positive integer");
  process.exit(1);
}
if (episodeTimeoutMs !== undefined && (!Number.isInteger(episodeTimeoutMs) || episodeTimeoutMs < 1)) {
  console.error("ER_COMBAT_EPISODE_TIMEOUT_MS must be a positive integer");
  process.exit(1);
}
if (resume && !jsonOut) {
  console.error("--resume requires --json-out");
  process.exit(1);
}
if (episodeTimeoutMs && !jsonOut) {
  console.error("--episode-timeout-ms requires --json-out");
  process.exit(1);
}
if (episodeTimeoutMs && aiDataOut) {
  console.error("--episode-timeout-ms is not supported while recording policy data");
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
if (aiSource) {
  env.ER_AI_POLICY_SOURCE = aiSource;
}
if (aiPolicyTarget) {
  env.ER_AI_POLICY_TARGET = aiPolicyTarget;
}
if (opponentAiModel) {
  env.ER_AI_OPPONENT_POLICY_MODEL = opponentAiModel.startsWith("@") ? opponentAiModel.slice(1) : opponentAiModel;
}
if (opponentAiNeuralModel) {
  env.ER_AI_OPPONENT_NEURAL_POLICY_MODEL = opponentAiNeuralModel.startsWith("@")
    ? opponentAiNeuralModel.slice(1)
    : opponentAiNeuralModel;
}
if (opponentAiPolicy) {
  env.ER_AI_OPPONENT_POLICY_MODE = opponentAiPolicy;
}
if (opponentAiEpsilon) {
  env.ER_AI_OPPONENT_POLICY_EPSILON = opponentAiEpsilon;
}
if (opponentAiSource) {
  env.ER_AI_OPPONENT_POLICY_SOURCE = opponentAiSource;
}
if (opponentAiPolicyTarget) {
  env.ER_AI_OPPONENT_POLICY_TARGET = opponentAiPolicyTarget;
}
if (recordEngineBaseline) {
  env.ER_AI_RECORD_ENGINE_BASELINE = "1";
}
if (realRng) {
  env.ER_RUN_REAL_RNG = "1";
}
if (resume) {
  env.ER_RUN_RESUME_COMBAT_BATCH = "1";
}
if (testTimeoutMs) {
  env.ER_RUN_TEST_TIMEOUT_MS = testTimeoutMs;
}

const vitestArgs = [
  "vitest",
  "run",
  "test/tools/run-scenario.test.ts",
  "--pool=threads",
  "--silent=true",
  "--no-color",
];

if (!episodeTimeoutMs) {
  const result = spawnSync("npx", vitestArgs, {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  });
  process.exit(result.status ?? 1);
}

const hasCustomOpponent = !!(opponentAiModel || opponentAiNeuralModel || opponentAiPolicy);
if (!resume) {
  initializeCombatCheckpoint(jsonOut, parsed, hasCustomOpponent);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function killChildTree(child) {
  if (!child.pid) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

async function runWatchedChild(childEnv) {
  const child = spawn("npx", vitestArgs, {
    stdio: "inherit",
    env: childEnv,
    detached: process.platform !== "win32",
    shell: process.platform === "win32",
  });
  const exit = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  let observedCount = readMatchingCombatCheckpoint(jsonOut, parsed, hasCustomOpponent)?.episodeCount ?? 0;
  let lastProgressAt = Date.now();
  while (true) {
    const event = await Promise.race([
      exit.then(value => ({ type: "exit", value })),
      delay(5_000).then(() => ({ type: "poll" })),
    ]);
    if (event.type === "exit") {
      return { type: "exit", ...event.value };
    }
    const checkpoint = readMatchingCombatCheckpoint(jsonOut, parsed, hasCustomOpponent);
    if (checkpoint && checkpoint.episodeCount > observedCount) {
      observedCount = checkpoint.episodeCount;
      lastProgressAt = Date.now();
      continue;
    }
    const stalledMs = Date.now() - lastProgressAt;
    if (stalledMs < episodeTimeoutMs) {
      continue;
    }
    console.error(
      `combat batch watchdog: no completed episode for ${stalledMs}ms after ${observedCount}/${parsed.episodes.length}; terminating child`,
    );
    await killChildTree(child);
    await exit;
    const latest = readMatchingCombatCheckpoint(jsonOut, parsed, hasCustomOpponent);
    if (latest && latest.episodeCount > observedCount) {
      return { type: "progress-race" };
    }
    return { type: "timeout", stalledMs };
  }
}

let shouldResume = resume;
while (true) {
  const checkpoint = readMatchingCombatCheckpoint(jsonOut, parsed, hasCustomOpponent);
  if (checkpoint?.complete) {
    process.exit(0);
  }
  const childEnv = shouldResume
    ? { ...env, ER_RUN_RESUME_COMBAT_BATCH: "1" }
    : Object.fromEntries(Object.entries(env).filter(([key]) => key !== "ER_RUN_RESUME_COMBAT_BATCH"));
  const result = await runWatchedChild(childEnv);
  if (result.type === "exit") {
    process.exit(result.code ?? 1);
  }
  if (result.type === "timeout") {
    const updated = appendCombatTimeout(jsonOut, parsed, hasCustomOpponent, result.stalledMs, episodeTimeoutMs);
    console.error(`combat batch watchdog: recorded timeout for ${updated.results.at(-1).id}`);
  }
  shouldResume = true;
}
