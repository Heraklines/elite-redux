#!/usr/bin/env node
/*
 * Rust-kernel baseline harness.
 *
 * This is deliberately a measurement coordinator, not a game runner. Metadata and
 * dry-run modes never launch Vitest, Phaser, Vite, Chromium, or any scenario command.
 * Measurement is fail-closed to a GitHub-hosted runner so an engine benchmark cannot
 * accidentally consume the developer workstation's process-global Phaser state.
 */

import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_MANIFEST = resolve(ROOT, "rust/fixtures/v1/baseline-manifest.json");
const RSS_MARKER = "__RUST_KERNEL_BASELINE_MAX_RSS_KIB__";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const REQUIRED_SCENARIO_IDS = [
  "authority-v2-node-suite",
  "authority-v2-protocol-simulator",
  "headless-single-wave",
  "headless-ten-wave",
  "headless-two-engine",
  "browser-two-context-webrtc",
];

function usage() {
  return [
    "Usage: node scripts/benchmark-kernel-baseline.mjs [options]",
    "",
    "Modes:",
    "  --mode metadata   Resolve the manifest and runner identity; launch nothing (default).",
    "  --mode dry-run    Emit the exact commands/env that measurement would use; launch nothing.",
    "  --mode measure    Execute only on a GitHub-hosted Actions runner.",
    "",
    "Options:",
    "  --manifest FILE            Baseline manifest path (default: rust/fixtures/v1/baseline-manifest.json).",
    "  --oracle-game-sha SHA      Explicit game-source SHA; otherwise GITHUB_SHA, ORACLE_GAME_SHA, or git HEAD.",
    "  --sample-count N           Override every scenario's requested measurement sample count.",
    "  --scenario ID              Measure/describe one manifest scenario instead of all scenarios.",
    "  --help                     Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    mode: "metadata",
    manifest: DEFAULT_MANIFEST,
    oracleGameSha: null,
    sampleCount: null,
    scenario: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--mode") {
      options.mode = argv[++index];
      if (!["metadata", "dry-run", "measure"].includes(options.mode)) {
        throw new Error(`--mode must be metadata, dry-run, or measure; got ${options.mode ?? "<missing>"}`);
      }
      continue;
    }
    if (arg === "--manifest") {
      const value = argv[++index];
      if (!value) {
        throw new Error("--manifest requires a file path");
      }
      options.manifest = resolve(process.cwd(), value);
      continue;
    }
    if (arg === "--oracle-game-sha") {
      const value = argv[++index]?.trim();
      if (!value) {
        throw new Error("--oracle-game-sha requires a non-empty SHA");
      }
      options.oracleGameSha = value;
      continue;
    }
    if (arg === "--sample-count") {
      const value = Number(argv[++index]);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--sample-count must be a positive integer; got ${argv[index] ?? "<missing>"}`);
      }
      options.sampleCount = value;
      continue;
    }
    if (arg === "--scenario") {
      const value = argv[++index]?.trim();
      if (!value) {
        throw new Error("--scenario requires a scenario id");
      }
      options.scenario = value;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function emitJson(value) {
  process.stdout.write(`${JSON.stringify(stableValue(value), null, 2)}\n`);
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function readManifest(path) {
  const contents = readFileSync(path, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(contents);
  } catch (error) {
    throw new Error(`manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest.schema_version !== 1) {
    throw new Error(`manifest schema_version must be 1; got ${manifest.schema_version ?? "<missing>"}`);
  }
  if (!Array.isArray(manifest.scenarios) || manifest.scenarios.length === 0) {
    throw new Error("manifest scenarios must be a non-empty array");
  }

  const ids = new Set();
  for (const scenario of manifest.scenarios) {
    if (typeof scenario.id !== "string" || scenario.id.length === 0 || ids.has(scenario.id)) {
      throw new Error(`manifest scenario ids must be non-empty and unique; got ${scenario.id ?? "<missing>"}`);
    }
    ids.add(scenario.id);
    if (!Array.isArray(scenario.command) || scenario.command.length === 0 || !scenario.command.every(item => typeof item === "string")) {
      throw new Error(`manifest scenario ${scenario.id} command must be a non-empty argv array`);
    }
    if (scenario.environment !== undefined && (scenario.environment === null || typeof scenario.environment !== "object")) {
      throw new Error(`manifest scenario ${scenario.id} environment must be an object`);
    }
    if (!Number.isInteger(scenario.sample_count) || scenario.sample_count < 1) {
      throw new Error(`manifest scenario ${scenario.id} sample_count must be a positive integer`);
    }
    const setupCommands = scenario.setup_commands ?? [];
    if (!Array.isArray(setupCommands)) {
      throw new Error(`manifest scenario ${scenario.id} setup_commands must be an array`);
    }
    for (const setup of setupCommands) {
      if (!Array.isArray(setup.command) || setup.command.length === 0 || !setup.command.every(item => typeof item === "string")) {
        throw new Error(`manifest setup command for ${scenario.id} must be a non-empty argv array`);
      }
    }
  }

  const missing = REQUIRED_SCENARIO_IDS.filter(id => !ids.has(id));
  if (missing.length > 0) {
    throw new Error(`manifest is missing required scenarios: ${missing.join(", ")}`);
  }
  return { manifest, digest: sha256(contents) };
}

function isGithubHostedRunner() {
  return process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted";
}

function runnerMetadata() {
  const rssMethod = process.platform === "linux" && existsSync("/usr/bin/time") ? "gnu-time-%M-kib" : null;
  return {
    provider: isGithubHostedRunner() ? "github-hosted" : "local",
    github_actions: process.env.GITHUB_ACTIONS === "true",
    platform: process.platform,
    arch: process.arch,
    node_version: process.version,
    shell: false,
    peak_rss_method: rssMethod,
  };
}

function resolveOracleGameSha(explicit) {
  if (explicit !== null) {
    return { value: explicit, source: "argument" };
  }
  const environmentSha = process.env.GITHUB_SHA?.trim() || process.env.ORACLE_GAME_SHA?.trim();
  if (environmentSha) {
    return { value: environmentSha, source: process.env.GITHUB_SHA?.trim() ? "GITHUB_SHA" : "ORACLE_GAME_SHA" };
  }

  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { value: null, source: "unavailable" };
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? { value: sha, source: "git HEAD" } : { value: null, source: "unavailable" };
}

function resolveExecutable(executable) {
  if (process.platform !== "win32") {
    return executable;
  }
  const lower = executable.toLowerCase();
  if (["pnpm", "npm", "npx"].includes(lower) && !lower.endsWith(".cmd")) {
    return `${executable}.cmd`;
  }
  return executable;
}

function childEnvironment(extra) {
  const merged = { ...process.env, ...(extra ?? {}) };
  return Object.fromEntries(Object.entries(merged).filter(([, value]) => typeof value === "string"));
}

function appendTail(existing, chunk, limit = 256 * 1024) {
  const next = existing + chunk.toString();
  return next.length <= limit ? next : next.slice(-limit);
}

function parsePeakRssBytes(stderr) {
  const matches = [...stderr.matchAll(new RegExp(`${RSS_MARKER}(\\d+)`, "gu"))];
  if (matches.length === 0) {
    return null;
  }
  const kib = Number(matches.at(-1)[1]);
  return Number.isSafeInteger(kib) ? kib * 1024 : null;
}

function commandForProcess(command) {
  const executable = resolveExecutable(command[0]);
  if (process.platform === "linux" && existsSync("/usr/bin/time")) {
    return {
      executable: "/usr/bin/time",
      args: ["-f", `${RSS_MARKER}%M`, executable, ...command.slice(1)],
      rssReason: null,
    };
  }
  return {
    executable,
    args: command.slice(1),
    rssReason: "peak RSS requires Linux GNU /usr/bin/time; no value was collected on this runner",
  };
}

function runProcess(command, environment, timeoutMs) {
  const processCommand = commandForProcess(command);
  const startedAt = performance.now();

  return new Promise(resolveResult => {
    let child;
    let spawnAt = null;
    let timedOut = false;
    let settled = false;
    let timeoutHandle;
    let killHandle;
    let stderr = "";

    const finish = ({ status, exitCode = null, signal = null, error = null }) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      const endedAt = performance.now();
      const executionMs = spawnAt === null ? null : Math.max(0, Math.round(endedAt - spawnAt));
      const startMs = spawnAt === null ? null : Math.max(0, Math.round(spawnAt - startedAt));
      let reason = null;
      if (status === "timeout") {
        reason = `process exceeded timeout of ${timeoutMs} ms`;
      } else if (status === "spawn_error") {
        reason = `process could not be started: ${error?.message ?? "unknown spawn error"}`;
      } else if (status === "failed") {
        reason = exitCode !== null ? `process exited with code ${exitCode}` : `process exited with signal ${signal ?? "unknown"}`;
      }
      resolveResult({
        status,
        reason,
        exit_code: exitCode,
        signal,
        start_ms: startMs,
        execution_ms: executionMs,
        peak_rss_bytes: parsePeakRssBytes(stderr),
        rss_reason: processCommand.rssReason,
        attempted: spawnAt !== null,
      });
    };

    try {
      child = spawn(processCommand.executable, processCommand.args, {
        cwd: ROOT,
        env: childEnvironment(environment),
        shell: false,
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      finish({ status: "spawn_error", error });
      return;
    }

    child.stderr?.on("data", chunk => {
      stderr = appendTail(stderr, chunk);
    });
    child.once("spawn", () => {
      spawnAt = performance.now();
    });
    child.once("error", error => {
      finish({ status: "spawn_error", error });
    });
    child.once("close", (exitCode, signal) => {
      if (timedOut) {
        finish({ status: "timeout", exitCode, signal });
      } else if (exitCode === 0 && signal === null) {
        finish({ status: "passed", exitCode, signal });
      } else {
        finish({ status: "failed", exitCode, signal });
      }
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      killHandle = setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, timeoutMs);
  });
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : Math.round((ordered[middle - 1] + ordered[middle]) / 2);
}

function baseRecord(scenario, requestedSampleCount, status, reason) {
  const setupCommands = scenario.setup_commands ?? [];
  const noMeasurementReason = reason;
  return {
    id: scenario.id,
    name: scenario.name ?? scenario.id,
    execution_class: scenario.execution_class ?? null,
    scenario_size: scenario.scenario_size ?? { unit: null, value: null, reason: "manifest did not define a scenario size" },
    requested_sample_count: requestedSampleCount,
    sample_count: null,
    attempted_sample_count: null,
    command: scenario.command,
    environment: scenario.environment ?? {},
    setup_commands: setupCommands.map(setup => ({
      command: setup.command,
      environment: setup.environment ?? {},
      timeout_ms: setup.timeout_ms ?? null,
    })),
    setup_build_ms: null,
    cold_start_ms: null,
    warm_start_ms: null,
    execution_ms: null,
    peak_rss_bytes: null,
    status,
    reason: noMeasurementReason,
    exit_code: null,
    signal: null,
    metric_reasons: {
      setup_build_ms: setupCommands.length > 0 ? noMeasurementReason : "no setup/build command is defined for this scenario",
      cold_start_ms: noMeasurementReason,
      warm_start_ms: noMeasurementReason,
      execution_ms: noMeasurementReason,
      peak_rss_bytes: noMeasurementReason,
      sample_count: noMeasurementReason,
    },
  };
}

function blockedRecord(scenario, requestedSampleCount, mode) {
  return baseRecord(
    scenario,
    requestedSampleCount,
    mode === "dry-run" ? "dry_run" : "not_measured",
    `${mode} mode does not launch scenario processes`,
  );
}

async function measureRecord(scenario, requestedSampleCount) {
  if (!isGithubHostedRunner()) {
    return baseRecord(
      scenario,
      requestedSampleCount,
      "blocked",
      "measure mode requires GITHUB_ACTIONS=true and RUNNER_ENVIRONMENT=github-hosted; no process was launched locally",
    );
  }

  const record = baseRecord(scenario, requestedSampleCount, "failed", null);
  const setupCommands = scenario.setup_commands ?? [];
  let setupMs = 0;
  for (const [index, setup] of setupCommands.entries()) {
    const result = await runProcess(setup.command, { ...(scenario.environment ?? {}), ...(setup.environment ?? {}) }, setup.timeout_ms ?? DEFAULT_TIMEOUT_MS);
    if (result.execution_ms !== null) {
      setupMs += result.execution_ms;
    }
    if (result.status !== "passed") {
      record.status = result.status === "timeout" ? "timeout" : "failed";
      record.reason = `setup command ${index + 1}/${setupCommands.length} failed: ${result.reason}`;
      record.exit_code = result.exit_code;
      record.signal = result.signal;
      record.metric_reasons.setup_build_ms = "setup/build did not complete successfully";
      record.metric_reasons.cold_start_ms = "scenario command was not launched after setup/build failure";
      record.metric_reasons.warm_start_ms = "scenario command was not launched after setup/build failure";
      record.metric_reasons.execution_ms = "scenario command was not launched after setup/build failure";
      record.metric_reasons.peak_rss_bytes = result.rss_reason ?? "scenario command was not launched after setup/build failure";
      return record;
    }
  }
  if (setupCommands.length > 0) {
    record.setup_build_ms = setupMs;
    record.metric_reasons.setup_build_ms = null;
  }

  const starts = [];
  const executions = [];
  const rss = [];
  let attempted = 0;
  let completed = 0;
  let failure = null;
  for (let sample = 0; sample < requestedSampleCount; sample++) {
    const result = await runProcess(scenario.command, scenario.environment ?? {}, scenario.timeout_ms ?? DEFAULT_TIMEOUT_MS);
    if (result.attempted) {
      attempted++;
    }
    if (result.start_ms !== null) {
      starts.push(result.start_ms);
    }
    if (result.execution_ms !== null) {
      executions.push(result.execution_ms);
    }
    if (result.peak_rss_bytes !== null) {
      rss.push(result.peak_rss_bytes);
    }
    if (result.status === "passed" || result.status === "failed") {
      completed++;
    }
    if (result.status !== "passed") {
      failure = result;
      break;
    }
  }

  record.attempted_sample_count = attempted > 0 ? attempted : null;
  record.sample_count = completed > 0 ? completed : null;
  record.cold_start_ms = starts.length > 0 ? starts[0] : null;
  record.warm_start_ms = starts.length > 1 ? median(starts.slice(1)) : null;
  record.execution_ms = executions.length > 0 ? median(executions) : null;
  record.peak_rss_bytes = rss.length > 0 ? Math.max(...rss) : null;
  record.metric_reasons.cold_start_ms = record.cold_start_ms === null ? "the child did not emit a spawn event" : null;
  record.metric_reasons.warm_start_ms = record.warm_start_ms === null ? "no second completed launch was requested or observed" : null;
  record.metric_reasons.execution_ms = record.execution_ms === null ? "no child execution interval was observed" : null;
  record.metric_reasons.sample_count = record.sample_count === null ? "no completed child sample was observed" : null;
  record.metric_reasons.peak_rss_bytes =
    record.peak_rss_bytes === null
      ? (failure?.rss_reason ?? "GNU time did not report a peak RSS value")
      : null;

  if (failure !== null) {
    record.status = failure.status === "timeout" ? "timeout" : "failed";
    record.reason = failure.reason;
    record.exit_code = failure.exit_code;
    record.signal = failure.signal;
  } else if (completed === requestedSampleCount) {
    record.status = "passed";
    record.reason = null;
  } else {
    record.status = "failed";
    record.reason = `only ${completed} of ${requestedSampleCount} samples completed`;
  }
  return record;
}

function topLevelStatus(mode, records) {
  if (mode === "metadata") {
    return "not_measured";
  }
  if (mode === "dry-run") {
    return "dry_run";
  }
  if (records.some(record => record.status === "blocked")) {
    return "blocked";
  }
  if (records.some(record => record.status === "failed" || record.status === "timeout")) {
    return "failed";
  }
  return "passed";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const { manifest, digest } = readManifest(options.manifest);
  const scenarios = options.scenario === null ? manifest.scenarios : manifest.scenarios.filter(item => item.id === options.scenario);
  if (scenarios.length === 0) {
    throw new Error(`scenario not found in manifest: ${options.scenario}`);
  }
  const requestedCounts = scenarios.map(scenario => options.sampleCount ?? scenario.sample_count);
  const oracle = resolveOracleGameSha(options.oracleGameSha);
  let records;
  if (options.mode === "measure") {
    records = [];
    for (const [index, scenario] of scenarios.entries()) {
      records.push(await measureRecord(scenario, requestedCounts[index]));
    }
  } else {
    records = scenarios.map((scenario, index) => blockedRecord(scenario, requestedCounts[index], options.mode));
  }

  const result = {
    schema_version: 1,
    status: topLevelStatus(options.mode, records),
    mode: options.mode,
    oracle_game_sha: oracle.value,
    oracle_game_sha_source: oracle.source,
    manifest_id: manifest.manifest_id ?? "rust-kernel-baseline-v1",
    manifest_sha256: digest,
    runner: runnerMetadata(),
    scenario_filter: options.scenario,
    scenarios: records,
  };
  emitJson(result);
  if (options.mode === "measure" && result.status === "blocked") {
    process.exitCode = 2;
  }
}

main().catch(error => {
  process.stderr.write(`benchmark-kernel-baseline: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
