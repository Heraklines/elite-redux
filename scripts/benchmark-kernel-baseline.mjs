#!/usr/bin/env node

/*
 * Rust-kernel baseline harness.
 *
 * This is deliberately a measurement coordinator, not a game runner. Metadata and
 * dry-run modes never launch Vitest, Phaser, Vite, Chromium, or any scenario command.
 * Measurement is fail-closed to a GitHub-hosted runner so an engine benchmark cannot
 * accidentally consume the developer workstation's process-global Phaser state.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = resolve(import.meta.dirname, "..");
const DEFAULT_MANIFEST = resolve(ROOT, "rust/fixtures/v1/baseline-manifest.json");
const SOURCE_LOCK = resolve(ROOT, "rust/source-lock.toml");
const RSS_MARKER = "__RUST_KERNEL_BASELINE_MAX_RSS_KIB__";
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const BASELINE_SCHEMA_VERSION = 1;
const BASELINE_PROTOCOL_VERSION = "er-coop-47";
const BASELINE_ORACLE_GAME_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const BASELINE_ORACLE_BRANCH = "ci/coop/v2-showdown-command-coordinate-20260720";
const BASELINE_INPUT_REPEAT_DELAY_MS = 250;
const BASELINE_INPUT_REPEAT_INTERVAL_MS = 250;
const AUTHORITY_V2_FILE_COUNT = 28;
const MEASURE_ATTESTATION_ENV = "RUST_KERNEL_BASELINE_ATTESTATION";
const MEASURE_ATTESTATION_VALUE = "rust-kernel-baseline-v1:measure:github-hosted";
const CHILD_ENV_ALLOWLIST = [
  "APPDATA",
  "CI",
  "COMSPEC",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "COMMONPROGRAMW6432",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "HOMESHARE",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "SYSTEMDRIVE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "USERPROFILE",
  "WINDIR",
];
const FORBIDDEN_SCENARIO_ENV_KEYS = new Set(["NODE_OPTIONS", "NODE_PATH"]);
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
    "  --oracle-game-sha SHA      Explicit oracle SHA; it must exactly match rust/source-lock.toml and the manifest.",
    "  --sample-count N           Override every scenario's requested measurement sample count.",
    "  --scenario ID              Measure/describe one manifest scenario instead of all scenarios.",
    "  RUST_KERNEL_BASELINE_ATTESTATION=rust-kernel-baseline-v1:measure:github-hosted is required for --mode measure.",
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

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index++];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--mode") {
      options.mode = argv[index++];
      if (!["metadata", "dry-run", "measure"].includes(options.mode)) {
        throw new Error(`--mode must be metadata, dry-run, or measure; got ${options.mode ?? "<missing>"}`);
      }
      continue;
    }
    if (arg === "--manifest") {
      const value = argv[index++];
      if (!value) {
        throw new Error("--manifest requires a file path");
      }
      options.manifest = resolve(process.cwd(), value);
      continue;
    }
    if (arg === "--oracle-game-sha") {
      const value = argv[index++]?.trim();
      if (!value) {
        throw new Error("--oracle-game-sha requires a non-empty SHA");
      }
      options.oracleGameSha = value;
      continue;
    }
    if (arg === "--sample-count") {
      const rawValue = argv[index++];
      const value = Number(rawValue);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--sample-count must be a positive integer; got ${rawValue ?? "<missing>"}`);
      }
      options.sampleCount = value;
      continue;
    }
    if (arg === "--scenario") {
      const value = argv[index++]?.trim();
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
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableValue(value[key])]),
    );
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
  if (manifest.schema_version !== BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `manifest schema_version must be ${BASELINE_SCHEMA_VERSION}; got ${manifest.schema_version ?? "<missing>"}`,
    );
  }
  if (manifest.oracle_game_sha !== BASELINE_ORACLE_GAME_SHA) {
    throw new Error("manifest oracle_game_sha must equal the frozen M0 oracle SHA");
  }
  if (manifest.oracle_branch !== BASELINE_ORACLE_BRANCH) {
    throw new Error("manifest oracle_branch must equal the frozen M0 oracle branch");
  }
  if (manifest.protocol_version !== BASELINE_PROTOCOL_VERSION) {
    throw new Error(
      `manifest protocol_version must be ${BASELINE_PROTOCOL_VERSION}; got ${manifest.protocol_version ?? "<missing>"}`,
    );
  }
  if (manifest.input_repeat_delay_ms !== BASELINE_INPUT_REPEAT_DELAY_MS) {
    throw new Error("manifest input_repeat_delay_ms must equal 250");
  }
  if (manifest.input_repeat_interval_ms !== BASELINE_INPUT_REPEAT_INTERVAL_MS) {
    throw new Error("manifest input_repeat_interval_ms must equal 250");
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
    if (
      !Array.isArray(scenario.command)
      || scenario.command.length === 0
      || !scenario.command.every(item => typeof item === "string")
    ) {
      throw new Error(`manifest scenario ${scenario.id} command must be a non-empty argv array`);
    }
    if (scenario.environment !== undefined) {
      normalizeDeclaredEnvironment(scenario.environment, `scenario ${scenario.id}`);
    }
    if (!Number.isInteger(scenario.sample_count) || scenario.sample_count < 1) {
      throw new Error(`manifest scenario ${scenario.id} sample_count must be a positive integer`);
    }
    const setupCommands = scenario.setup_commands ?? [];
    if (!Array.isArray(setupCommands)) {
      throw new Error(`manifest scenario ${scenario.id} setup_commands must be an array`);
    }
    for (const setup of setupCommands) {
      if (
        !Array.isArray(setup.command)
        || setup.command.length === 0
        || !setup.command.every(item => typeof item === "string")
      ) {
        throw new Error(`manifest setup command for ${scenario.id} must be a non-empty argv array`);
      }
      if (setup.environment !== undefined) {
        normalizeDeclaredEnvironment(setup.environment, `setup command for ${scenario.id}`);
      }
    }
  }

  if (
    manifest.scenarios.length !== REQUIRED_SCENARIO_IDS.length
    || manifest.scenarios.some((scenario, index) => scenario.id !== REQUIRED_SCENARIO_IDS[index])
  ) {
    throw new Error(
      `manifest must contain exactly the six required scenarios in order: ${REQUIRED_SCENARIO_IDS.join(", ")}`,
    );
  }

  const authorityScenario = manifest.scenarios.find(scenario => scenario.id === "authority-v2-node-suite");
  const authorityFiles = authorityScenario.command.filter(item =>
    /^test\/node\/authority-v2-[^*]+\.test\.ts$/u.test(item),
  );
  if (
    authorityFiles.length !== AUTHORITY_V2_FILE_COUNT
    || new Set(authorityFiles).size !== AUTHORITY_V2_FILE_COUNT
    || authorityFiles.some(file => file.endsWith("authority-v2-simulator.test.ts"))
  ) {
    throw new Error(
      `authority-v2-node-suite must declare exactly ${AUTHORITY_V2_FILE_COUNT} explicit non-simulator test files`,
    );
  }
  return { manifest, digest: sha256(contents) };
}

function isGithubHostedRunner() {
  return process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted";
}

function nonEmptyEnvironmentValue(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positiveEnvironmentInteger(name) {
  const value = nonEmptyEnvironmentValue(name);
  return value !== null && /^[1-9][0-9]*$/u.test(value) ? value : null;
}

function githubRunMetadata() {
  return {
    server_url: nonEmptyEnvironmentValue("GITHUB_SERVER_URL"),
    repository: nonEmptyEnvironmentValue("GITHUB_REPOSITORY"),
    workflow: nonEmptyEnvironmentValue("GITHUB_WORKFLOW"),
    job: nonEmptyEnvironmentValue("GITHUB_JOB"),
    ref: nonEmptyEnvironmentValue("GITHUB_REF"),
    sha: nonEmptyEnvironmentValue("GITHUB_SHA"),
    run_id: nonEmptyEnvironmentValue("GITHUB_RUN_ID"),
    run_attempt: nonEmptyEnvironmentValue("GITHUB_RUN_ATTEMPT"),
    run_number: nonEmptyEnvironmentValue("GITHUB_RUN_NUMBER"),
  };
}

function measurementGate() {
  const metadata = githubRunMetadata();
  const reasons = [];
  if (!isGithubHostedRunner()) {
    reasons.push("measure mode requires GITHUB_ACTIONS=true and RUNNER_ENVIRONMENT=github-hosted");
  }
  if (process.env[MEASURE_ATTESTATION_ENV] !== MEASURE_ATTESTATION_VALUE) {
    reasons.push("measure mode requires the exact script-specific " + MEASURE_ATTESTATION_ENV + " value");
  }
  if (metadata.server_url !== "https://github.com") {
    reasons.push("GITHUB_SERVER_URL must be https://github.com");
  }
  if (metadata.repository === null || !/^[^/\s]+\/[^/\s]+$/u.test(metadata.repository)) {
    reasons.push("GITHUB_REPOSITORY must identify owner/repository");
  }
  for (const name of ["workflow", "job", "ref"]) {
    if (metadata[name] === null) {
      reasons.push("GITHUB_" + name.toUpperCase() + " is required");
    }
  }
  if (metadata.sha === null || !/^[0-9a-f]{40}$/u.test(metadata.sha)) {
    reasons.push("GITHUB_SHA must be a 40-character lowercase SHA");
  }
  for (const name of ["run_id", "run_attempt", "run_number"]) {
    if (positiveEnvironmentInteger("GITHUB_" + name.toUpperCase()) === null) {
      reasons.push("GITHUB_" + name.toUpperCase() + " must be a positive integer");
    }
  }
  return {
    allowed: reasons.length === 0,
    policy: "accidental-safety policy gate; not a cryptographic trust boundary",
    attestation_env: MEASURE_ATTESTATION_ENV,
    attestation_accepted: process.env[MEASURE_ATTESTATION_ENV] === MEASURE_ATTESTATION_VALUE,
    reasons,
    github_metadata: metadata,
  };
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
    github_run: githubRunMetadata(),
  };
}

function readGitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

function stripTomlComment(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"' && !escaped) {
      quoted = !quoted;
    }
    if (character === "#" && !quoted) {
      return line.slice(0, index);
    }
    escaped = quoted && character === "\\" && !escaped;
    if (character !== "\\") {
      escaped = false;
    }
  }
  return line;
}

function parseSourceLockValue(raw, label) {
  const value = raw.trim();
  if (/^(0|[1-9][0-9]*)$/u.test(value)) {
    const number = Number(value);
    if (Number.isSafeInteger(number)) {
      return number;
    }
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const stringValue = JSON.parse(value);
      if (typeof stringValue === "string") {
        return stringValue;
      }
    } catch {
      // The error below gives the source-lock field a stable diagnostic.
    }
  }
  throw new Error("rust/source-lock.toml has an invalid " + label + " value");
}

function parseSourceLock(contents) {
  const root = new Map();

  for (const [lineNumber, sourceLine] of contents.split(/\r?\n/u).entries()) {
    const line = stripTomlComment(sourceLine).trim();
    if (line.length === 0) {
      continue;
    }
    if (line.startsWith("[") || line.endsWith("]")) {
      throw new Error("rust/source-lock.toml must be a flat file; table found at line " + (lineNumber + 1));
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      throw new Error("rust/source-lock.toml has a malformed assignment at line " + (lineNumber + 1));
    }
    const key = line.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z0-9_-]+$/u.test(key)) {
      throw new Error("rust/source-lock.toml has an invalid key at line " + (lineNumber + 1));
    }
    if (root.has(key)) {
      throw new Error("rust/source-lock.toml repeats the key " + key);
    }
    root.set(key, parseSourceLockValue(line.slice(equalsIndex + 1), key));
  }

  const expectedRootKeys = [
    "input_repeat_delay_ms",
    "input_repeat_interval_ms",
    "oracle_branch",
    "oracle_game_sha",
    "protocol_version",
    "schema_version",
  ];
  const actualRootKeys = [...root.keys()].sort();
  if (actualRootKeys.join("|") !== expectedRootKeys.sort().join("|")) {
    throw new Error("rust/source-lock.toml must contain exactly the six frozen flat fields");
  }
  return {
    input_repeat_delay_ms: root.get("input_repeat_delay_ms"),
    input_repeat_interval_ms: root.get("input_repeat_interval_ms"),
    oracle_branch: root.get("oracle_branch"),
    oracle_game_sha: root.get("oracle_game_sha"),
    protocol_version: root.get("protocol_version"),
    schema_version: root.get("schema_version"),
  };
}

function readSourceLock(manifest) {
  let contents;
  try {
    contents = readFileSync(SOURCE_LOCK, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "required rust/source-lock.toml is missing; the oracle source lock must be supplied by the integration owner",
      );
    }
    throw new Error(
      "could not read required rust/source-lock.toml: " + (error instanceof Error ? error.message : String(error)),
    );
  }
  const sourceLock = parseSourceLock(contents);
  if (!/^[0-9a-f]{40}$/u.test(sourceLock.oracle_game_sha)) {
    throw new Error("rust/source-lock.toml oracle_game_sha must be a 40-character lowercase SHA");
  }
  if (sourceLock.oracle_game_sha !== manifest.oracle_game_sha) {
    throw new Error("rust/source-lock.toml oracle_game_sha does not exactly match the manifest");
  }
  if (sourceLock.oracle_branch !== manifest.oracle_branch) {
    throw new Error("rust/source-lock.toml oracle_branch does not exactly match the manifest");
  }
  if (sourceLock.protocol_version !== manifest.protocol_version) {
    throw new Error("rust/source-lock.toml protocol_version does not exactly match the manifest");
  }
  if (sourceLock.schema_version !== manifest.schema_version) {
    throw new Error("rust/source-lock.toml schema_version does not exactly match the manifest");
  }
  if (sourceLock.input_repeat_delay_ms !== manifest.input_repeat_delay_ms) {
    throw new Error("rust/source-lock.toml input_repeat_delay_ms does not exactly match the manifest");
  }
  if (sourceLock.input_repeat_interval_ms !== manifest.input_repeat_interval_ms) {
    throw new Error("rust/source-lock.toml input_repeat_interval_ms does not exactly match the manifest");
  }
  return { sourceLock, digest: sha256(contents) };
}

function resolveOracleGameSha(explicit, manifest, sourceLock) {
  if (explicit !== null) {
    if (!/^[0-9a-f]{40}$/u.test(explicit)) {
      throw new Error("--oracle-game-sha must be a 40-character lowercase SHA");
    }
    if (explicit !== manifest.oracle_game_sha || explicit !== sourceLock.oracle_game_sha) {
      throw new Error("--oracle-game-sha must exactly match both the manifest and rust/source-lock.toml");
    }
    return { value: explicit, source: "argument+rust/source-lock.toml" };
  }
  return { value: sourceLock.oracle_game_sha, source: "rust/source-lock.toml" };
}

function resolveCandidateGameSha() {
  const githubSha = process.env.GITHUB_SHA?.trim();
  if (githubSha) {
    return { value: githubSha, source: "GITHUB_SHA" };
  }
  const gitHead = readGitHead();
  return gitHead === null ? { value: null, source: "unavailable" } : { value: gitHead, source: "git HEAD" };
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

function normalizeDeclaredEnvironment(environment, label) {
  if (environment === undefined) {
    return {};
  }
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    throw new Error(label + " environment must be an object");
  }
  const normalized = {};
  for (const key of Object.keys(environment).sort()) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      throw new Error(label + " environment has an invalid variable name: " + key);
    }
    if (FORBIDDEN_SCENARIO_ENV_KEYS.has(key.toUpperCase())) {
      throw new Error(label + " environment may not declare " + key);
    }
    if (typeof environment[key] !== "string") {
      throw new Error(label + " environment value for " + key + " must be a string");
    }
    normalized[key] = environment[key].normalize("NFC");
  }
  return normalized;
}

function inheritedAllowlistedEnvironment() {
  const inherited = {};
  for (const name of CHILD_ENV_ALLOWLIST) {
    if (typeof process.env[name] === "string") {
      inherited[name] = process.env[name];
    }
  }
  if (process.platform === "win32" && inherited.PATH === undefined && typeof process.env.Path === "string") {
    inherited.PATH = process.env.Path;
  }
  return inherited;
}

function childEnvironment(declaredScenarioEnvironment, declaredSetupEnvironment = {}) {
  const scenarioEnvironment = normalizeDeclaredEnvironment(declaredScenarioEnvironment, "scenario");
  const setupEnvironment = normalizeDeclaredEnvironment(declaredSetupEnvironment, "setup");
  return Object.fromEntries(
    Object.entries({
      ...inheritedAllowlistedEnvironment(),
      ...scenarioEnvironment,
      ...setupEnvironment,
    }).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function environmentDigest(environment) {
  return sha256(JSON.stringify(stableValue(environment)));
}

function environmentPolicy() {
  return {
    inherited_allowlist: [...CHILD_ENV_ALLOWLIST],
    scenario_variables: "only manifest-declared normalized variables",
    never_inherited_names: ["NODE_OPTIONS", "NODE_PATH"],
    never_inherited_prefixes: ["ER_", "COOP_", "VITE_"],
  };
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
      const spawnLatencyMs = spawnAt === null ? null : Math.max(0, Math.round(spawnAt - startedAt));
      let reason = null;
      if (status === "timeout") {
        reason = `process exceeded timeout of ${timeoutMs} ms`;
      } else if (status === "spawn_error") {
        reason = `process could not be started: ${error?.message ?? "unknown spawn error"}`;
      } else if (status === "failed") {
        reason =
          exitCode === null
            ? `process exited with signal ${signal ?? "unknown"}`
            : `process exited with code ${exitCode}`;
      }
      resolveResult({
        status,
        reason,
        exit_code: exitCode,
        signal,
        spawn_latency_ms: spawnLatencyMs,
        execution_ms: executionMs,
        peak_rss_bytes: parsePeakRssBytes(stderr),
        rss_reason: processCommand.rssReason,
        attempted: spawnAt !== null,
      });
    };

    try {
      child = spawn(processCommand.executable, processCommand.args, {
        cwd: ROOT,
        env: environment,
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
  const declaredEnvironment = normalizeDeclaredEnvironment(scenario.environment ?? {}, "scenario " + scenario.id);
  const effectiveEnvironment = childEnvironment(declaredEnvironment);
  const noMeasurementReason = reason;
  return {
    id: scenario.id,
    name: scenario.name ?? scenario.id,
    execution_class: scenario.execution_class ?? null,
    scenario_size: scenario.scenario_size ?? {
      unit: null,
      value: null,
      reason: "manifest did not define a scenario size",
    },
    requested_sample_count: requestedSampleCount,
    sample_count: null,
    attempted_sample_count: null,
    command: scenario.command,
    environment: declaredEnvironment,
    effective_environment: effectiveEnvironment,
    effective_environment_sha256: environmentDigest(effectiveEnvironment),
    setup_commands: setupCommands.map(setup => ({
      command: setup.command,
      environment: normalizeDeclaredEnvironment(setup.environment ?? {}, "setup command for " + scenario.id),
      effective_environment: childEnvironment(declaredEnvironment, setup.environment ?? {}),
      effective_environment_sha256: environmentDigest(childEnvironment(declaredEnvironment, setup.environment ?? {})),
      timeout_ms: setup.timeout_ms ?? null,
    })),
    setup_build_ms: null,
    cold_start_ms: null,
    warm_start_ms: null,
    spawn_latency_ms: null,
    execution_ms: null,
    peak_rss_bytes: null,
    status,
    reason: noMeasurementReason,
    exit_code: null,
    signal: null,
    metric_reasons: {
      setup_build_ms:
        setupCommands.length > 0 ? noMeasurementReason : "no setup/build command is defined for this scenario",
      cold_start_ms: noMeasurementReason,
      warm_start_ms: noMeasurementReason,
      spawn_latency_ms: noMeasurementReason,
      execution_ms: noMeasurementReason,
      peak_rss_bytes: noMeasurementReason,
      sample_count: noMeasurementReason,
    },
  };
}

function blockedRecord(scenario, requestedSampleCount, mode, reason = null) {
  return baseRecord(
    scenario,
    requestedSampleCount,
    mode === "dry-run" ? "dry_run" : "not_measured",
    reason ?? mode + " mode does not launch scenario processes",
  );
}

async function measureRecord(scenario, requestedSampleCount, gate) {
  if (!gate.allowed) {
    return baseRecord(
      scenario,
      requestedSampleCount,
      "blocked",
      "measure mode blocked: " + gate.reasons.join("; ") + "; no process was launched",
    );
  }

  const record = baseRecord(scenario, requestedSampleCount, "failed", null);
  const setupCommands = scenario.setup_commands ?? [];
  let setupMs = 0;
  for (const [index, setup] of setupCommands.entries()) {
    const result = await runProcess(
      setup.command,
      record.setup_commands[index].effective_environment,
      setup.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    );
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
      record.metric_reasons.spawn_latency_ms = "scenario command was not launched after setup/build failure";
      record.metric_reasons.execution_ms = "scenario command was not launched after setup/build failure";
      record.metric_reasons.peak_rss_bytes =
        result.rss_reason ?? "scenario command was not launched after setup/build failure";
      return record;
    }
  }
  if (setupCommands.length > 0) {
    record.setup_build_ms = setupMs;
    record.metric_reasons.setup_build_ms = null;
  }

  const completeExecutions = [];
  const spawnLatencies = [];
  const completeRss = [];
  let attempted = 0;
  let completed = 0;
  let failure = null;
  for (let sample = 0; sample < requestedSampleCount; sample++) {
    const result = await runProcess(
      scenario.command,
      record.effective_environment,
      scenario.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    );
    if (result.attempted) {
      attempted++;
    }
    if (result.spawn_latency_ms !== null) {
      spawnLatencies.push(result.spawn_latency_ms);
    }
    if (result.status === "passed" && result.execution_ms !== null) {
      completeExecutions.push(result.execution_ms);
      if (result.peak_rss_bytes !== null) {
        completeRss.push(result.peak_rss_bytes);
      }
      completed++;
    }
    if (result.status !== "passed") {
      failure = result;
      break;
    }
  }

  record.attempted_sample_count = attempted > 0 ? attempted : null;
  record.sample_count = completed > 0 ? completed : null;
  record.cold_start_ms = completeExecutions.length > 0 ? completeExecutions[0] : null;
  record.warm_start_ms = completeExecutions.length > 1 ? median(completeExecutions.slice(1)) : null;
  record.spawn_latency_ms = spawnLatencies.length > 0 ? median(spawnLatencies) : null;
  record.execution_ms = completeExecutions.length > 0 ? median(completeExecutions) : null;
  record.peak_rss_bytes = completeRss.length > 0 ? Math.max(...completeRss) : null;
  record.metric_reasons.cold_start_ms =
    record.cold_start_ms === null ? "no complete successful scenario execution was observed" : null;
  record.metric_reasons.warm_start_ms =
    record.warm_start_ms === null ? "no later complete successful scenario execution was observed" : null;
  record.metric_reasons.spawn_latency_ms =
    record.spawn_latency_ms === null ? "the child did not emit a spawn event" : null;
  record.metric_reasons.execution_ms =
    record.execution_ms === null ? "no complete successful scenario execution was observed" : null;
  record.metric_reasons.sample_count =
    record.sample_count === null ? "no complete successful scenario sample was observed" : null;
  record.metric_reasons.peak_rss_bytes =
    record.peak_rss_bytes === null
      ? (failure?.rss_reason ?? "no complete successful scenario execution supplied a peak RSS value")
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
  const { sourceLock, digest: sourceLockDigest } = readSourceLock(manifest);
  const scenarios =
    options.scenario === null ? manifest.scenarios : manifest.scenarios.filter(item => item.id === options.scenario);
  if (scenarios.length === 0) {
    throw new Error(`scenario not found in manifest: ${options.scenario}`);
  }
  const requestedCounts = scenarios.map(scenario => options.sampleCount ?? scenario.sample_count);
  const oracle = resolveOracleGameSha(options.oracleGameSha, manifest, sourceLock);
  const candidate = resolveCandidateGameSha();
  const gate = measurementGate();
  let records;
  if (options.mode === "measure") {
    records = [];
    for (const [index, scenario] of scenarios.entries()) {
      records.push(await measureRecord(scenario, requestedCounts[index], gate));
    }
  } else {
    records = scenarios.map((scenario, index) => blockedRecord(scenario, requestedCounts[index], options.mode));
  }

  const result = {
    schema_version: BASELINE_SCHEMA_VERSION,
    status: topLevelStatus(options.mode, records),
    mode: options.mode,
    oracle_game_sha: oracle.value,
    oracle_game_sha_source: oracle.source,
    oracle_branch: manifest.oracle_branch,
    protocol_version: manifest.protocol_version,
    input_repeat_delay_ms: manifest.input_repeat_delay_ms,
    input_repeat_interval_ms: manifest.input_repeat_interval_ms,
    candidate_game_sha: candidate.value,
    candidate_game_sha_source: candidate.source,
    manifest_id: manifest.manifest_id ?? "rust-kernel-baseline-v1",
    manifest_sha256: digest,
    source_lock_sha256: sourceLockDigest,
    measurement_gate: gate,
    environment_policy: environmentPolicy(),
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
