#!/usr/bin/env node

/*
 * Hosted M2 Rust-kernel benchmark coordinator.
 *
 * Metadata mode validates the frozen inputs and launches nothing. Measured mode
 * is intentionally restricted to a GitHub-hosted Linux runner and measures only
 * already-compiled libtest executables; Cargo setup is reported separately.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = resolve(import.meta.dirname, "..");
const RUST_ROOT = resolve(ROOT, "rust");
const DEFAULT_MANIFEST = resolve(ROOT, "rust/fixtures/v1/m2-benchmark-manifest.json");
const SOURCE_LOCK = resolve(ROOT, "rust/source-lock.toml");
const RSS_MARKER = "__RUST_KERNEL_M2_MAX_RSS_KIB__";
const RESULT_MARKER = "M2_BENCHMARK_RESULT ";
const SCHEMA_VERSION = 1;
const ORACLE_GAME_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const ORACLE_BRANCH = "ci/coop/v2-showdown-command-coordinate-20260720";
const PROTOCOL_VERSION = "er-coop-47";
const FRAME_PROTOCOL_VERSION = 2;
const OWNERSHIP_SCHEMA_VERSION = 6;
const TOOLCHAIN = Object.freeze({
  channel: "1.97.1",
  profile: "minimal",
  package: "er-sim",
  bench_target: "m2_benchmark",
  build_profile: "release",
});
const MEASURE_ATTESTATION_ENV = "RUST_KERNEL_M2_ATTESTATION";
const MEASURE_ATTESTATION_VALUE = "rust-kernel-m2-v1:measure:github-hosted";
const MAX_U64 = 18_446_744_073_709_551_615n;
const REGRESSION_FACTOR = 1.25;
const REQUIRED_WORKLOADS = Object.freeze([
  Object.freeze({
    id: "raw-input-menu-transitions",
    test_name: "m2_raw_input_menu_transitions",
    iterations: 1000,
    schedules: 0,
    steps: 0,
    seed: "1469598103934665603",
    timeout_ms: 120000,
    target: null,
  }),
  Object.freeze({
    id: "proposal-receipt-cycles",
    test_name: "m2_proposal_receipt_cycles",
    iterations: 1000,
    schedules: 0,
    steps: 0,
    seed: "1099511628211",
    timeout_ms: 900000,
    target: null,
  }),
  Object.freeze({
    id: "fault-network-schedules",
    test_name: "m2_fault_network_schedules",
    iterations: 0,
    schedules: 10000,
    steps: 0,
    seed: "16045690984833335023",
    timeout_ms: 120000,
    target: Object.freeze({ max_elapsed_wall_ms: 60000 }),
  }),
  Object.freeze({
    id: "synthetic-pair-campaign",
    test_name: "m2_synthetic_pair_campaign",
    iterations: 0,
    schedules: 0,
    steps: 100000,
    seed: "81985529216486895",
    timeout_ms: 900000,
    target: null,
  }),
]);

function usage() {
  return [
    "Usage: node scripts/benchmark-kernel-m2.mjs [options]",
    "",
    "Modes:",
    "  --mode metadata   Validate and describe the manifest; launch nothing (default).",
    "  --mode measure    Compile once and measure all four workloads on hosted Linux.",
    "",
    "Options:",
    "  --manifest FILE            Manifest path (default: rust/fixtures/v1/m2-benchmark-manifest.json).",
    "  --oracle-game-sha SHA      Explicit SHA; it must equal the frozen source lock and manifest.",
    "  --baseline FILE            Optional accepted same-input/same-runner artifact for comparison.",
    "  --output FILE              Write compact JSON to FILE instead of stdout.",
    `  ${MEASURE_ATTESTATION_ENV}=${MEASURE_ATTESTATION_VALUE} is required for --mode measure.`,
    "  --help                     Show this help.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {
    mode: "metadata",
    manifest: DEFAULT_MANIFEST,
    oracleGameSha: null,
    baseline: null,
    output: null,
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
      if (!["metadata", "measure"].includes(options.mode)) {
        throw new Error(`--mode must be metadata or measure; got ${options.mode ?? "<missing>"}`);
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
    if (arg === "--baseline") {
      const value = argv[index++];
      if (!value) {
        throw new Error("--baseline requires a file path");
      }
      options.baseline = resolve(process.cwd(), value);
      continue;
    }
    if (arg === "--output") {
      const value = argv[index++];
      if (!value) {
        throw new Error("--output requires a file path");
      }
      options.output = resolve(process.cwd(), value);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

function recoverOutputPath(argv) {
  let outputPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--output") {
      continue;
    }
    const value = argv[index + 1];
    if (value) {
      outputPath = resolve(process.cwd(), value);
      index += 1;
    }
  }
  return outputPath;
}

function failureText(error) {
  const text = error instanceof Error ? error.message : String(error);
  const compact = text.replace(/\s+/gu, " ").trim();
  return (compact.length > 0 ? compact : "unknown failure").slice(0, 4000);
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  throw new Error(message);
}

function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`);
  }
}

function assertCanonicalSeed(value, label) {
  assertString(value, label);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    fail(`${label} must be a canonical unsigned decimal string`);
  }
  if (BigInt(value) > MAX_U64) {
    fail(`${label} must fit in u64`);
  }
}

function projectPath(declaredPath, label) {
  assertString(declaredPath, label);
  if (isAbsolute(declaredPath)) {
    fail(`${label} must be project-relative`);
  }
  const absolute = resolve(ROOT, declaredPath);
  const outside = relative(ROOT, absolute);
  if (outside === "" || outside === ".." || outside.startsWith("..") || isAbsolute(outside)) {
    fail(`${label} escapes the project root`);
  }
  return absolute;
}

function readJsonFile(path, label) {
  let contents;
  try {
    contents = readFileSync(path);
  } catch (error) {
    fail(`cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    return { contents, value: JSON.parse(contents.toString("utf8")) };
  } catch (error) {
    fail(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readSourceLock() {
  let contents;
  try {
    contents = readFileSync(SOURCE_LOCK, "utf8");
  } catch (error) {
    fail(`cannot read rust/source-lock.toml: ${error instanceof Error ? error.message : String(error)}`);
  }

  const values = {};
  for (const [lineNumber, rawLine] of contents.split(/\r?\n/u).entries()) {
    const line = rawLine.replace(/#.*/u, "").trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^(oracle_game_sha|oracle_branch|protocol_version|schema_version|input_repeat_delay_ms|input_repeat_interval_ms)\s*=\s*(?:"([^"]*)"|([0-9]+))$/u.exec(line);
    if (!match) {
      fail(`unsupported source-lock syntax at line ${lineNumber + 1}`);
    }
    const key = match[1];
    if (Object.hasOwn(values, key)) {
      fail(`duplicate source-lock key ${key}`);
    }
    values[key] = match[2] ?? Number(match[3]);
  }

  const expectedKeys = [
    "oracle_game_sha",
    "oracle_branch",
    "protocol_version",
    "schema_version",
    "input_repeat_delay_ms",
    "input_repeat_interval_ms",
  ];
  if (Object.keys(values).length !== expectedKeys.length || expectedKeys.some(key => !Object.hasOwn(values, key))) {
    fail("rust/source-lock.toml is missing a required frozen key");
  }
  if (
    values.oracle_game_sha !== ORACLE_GAME_SHA
    || values.oracle_branch !== ORACLE_BRANCH
    || values.protocol_version !== PROTOCOL_VERSION
    || values.schema_version !== 1
    || values.input_repeat_delay_ms !== 250
    || values.input_repeat_interval_ms !== 250
  ) {
    fail("rust/source-lock.toml does not match the frozen M2 benchmark oracle/protocol inputs");
  }
  return { ...values, sha256: sha256(contents) };
}

function validateManifest(manifest, manifestPath) {
  assertObject(manifest, "manifest");
  if (manifest.schema_version !== SCHEMA_VERSION) {
    fail(`manifest schema_version must be ${SCHEMA_VERSION}`);
  }
  assertString(manifest.manifest_id, "manifest.manifest_id");
  if (manifest.oracle_game_sha !== ORACLE_GAME_SHA) {
    fail("manifest oracle_game_sha must equal the frozen oracle SHA");
  }
  if (manifest.oracle_branch !== ORACLE_BRANCH) {
    fail("manifest oracle_branch must equal the frozen oracle branch");
  }
  if (manifest.protocol_version !== PROTOCOL_VERSION) {
    fail("manifest protocol_version must equal er-coop-47");
  }
  if (manifest.frame_protocol_version !== FRAME_PROTOCOL_VERSION) {
    fail("manifest frame_protocol_version must equal 2");
  }
  if (manifest.source_lock_schema_version !== 1) {
    fail("manifest source_lock_schema_version must equal 1");
  }
  if (manifest.ownership_schema_version !== OWNERSHIP_SCHEMA_VERSION) {
    fail(`manifest ownership_schema_version must equal ${OWNERSHIP_SCHEMA_VERSION}`);
  }
  assertObject(manifest.toolchain, "manifest.toolchain");
  for (const [key, expected] of Object.entries(TOOLCHAIN)) {
    if (manifest.toolchain[key] !== expected) {
      fail(`manifest toolchain.${key} must equal ${expected}`);
    }
  }
  assertObject(manifest.content_identity, "manifest.content_identity");
  if (manifest.content_identity.algorithm !== "sha256") {
    fail("manifest content_identity.algorithm must be sha256");
  }

  if (!Array.isArray(manifest.source_paths) || manifest.source_paths.length !== 1) {
    fail("manifest source_paths must contain exactly the benchmark source");
  }
  const sourcePaths = manifest.source_paths.map((path, index) => {
    const absolute = projectPath(path, `manifest.source_paths[${index}]`);
    if (!existsSync(absolute)) {
      fail(`manifest source path does not exist: ${path}`);
    }
    return path;
  });
  if (sourcePaths[0] !== "rust/crates/er-sim/benches/m2_benchmark.rs") {
    fail("manifest source_paths must identify rust/crates/er-sim/benches/m2_benchmark.rs");
  }

  if (!Array.isArray(manifest.workloads) || manifest.workloads.length !== REQUIRED_WORKLOADS.length) {
    fail(`manifest must contain exactly ${REQUIRED_WORKLOADS.length} workloads`);
  }
  const seen = new Set();
  for (const [index, expected] of REQUIRED_WORKLOADS.entries()) {
    const workload = manifest.workloads[index];
    assertObject(workload, `manifest.workloads[${index}]`);
    if (workload.id !== expected.id || seen.has(workload.id)) {
      fail(`manifest workloads must contain ${expected.id} exactly once and in order`);
    }
    seen.add(workload.id);
    if (workload.bench_target !== TOOLCHAIN.bench_target || workload.test_name !== expected.test_name) {
      fail(`workload ${expected.id} has an unexpected bench target or test name`);
    }
    for (const key of ["iterations", "schedules", "steps"]) {
      assertNonNegativeInteger(workload[key], `workload ${expected.id}.${key}`);
      if (workload[key] !== expected[key]) {
        fail(`workload ${expected.id}.${key} must equal ${expected[key]}`);
      }
    }
    assertCanonicalSeed(workload.seed, `workload ${expected.id}.seed`);
    if (workload.seed !== expected.seed) {
      fail(`workload ${expected.id}.seed does not match the frozen deterministic seed`);
    }
    if (workload.requires_linux !== true) {
      fail(`workload ${expected.id}.requires_linux must be true`);
    }
    if (workload.timeout_ms !== expected.timeout_ms) {
      fail(`workload ${expected.id}.timeout_ms must equal ${expected.timeout_ms}`);
    }
    if (JSON.stringify(workload.target) !== JSON.stringify(expected.target)) {
      fail(`workload ${expected.id}.target is not the frozen target declaration`);
    }
    if (!Array.isArray(workload.source_paths) || workload.source_paths.length !== 1 || workload.source_paths[0] !== sourcePaths[0]) {
      fail(`workload ${expected.id}.source_paths must identify the benchmark source`);
    }
    projectPath(workload.source_paths[0], `workload ${expected.id}.source_paths[0]`);
  }

  if (manifestPath === DEFAULT_MANIFEST && sourcePaths.length !== 1) {
    fail("default M2 manifest has an unexpected source list");
  }
}

function loadContext(manifestPath, explicitOracleGameSha) {
  const { contents, value: manifest } = readJsonFile(manifestPath, "M2 benchmark manifest");
  validateManifest(manifest, manifestPath);
  const sourceLock = readSourceLock();
  if (explicitOracleGameSha !== null && explicitOracleGameSha !== ORACLE_GAME_SHA) {
    fail("--oracle-game-sha does not match the frozen oracle SHA");
  }
  if (explicitOracleGameSha !== null && explicitOracleGameSha !== manifest.oracle_game_sha) {
    fail("--oracle-game-sha does not match manifest.oracle_game_sha");
  }

  const sourceDigests = Object.fromEntries(
    manifest.source_paths
      .slice()
      .sort()
      .map(path => [path, sha256(readFileSync(projectPath(path, `manifest source ${path}`)))]),
  );
  const manifestSha256 = sha256(contents);
  const contentSha256 = sha256(
    Buffer.concat([
      contents,
      Buffer.from("\n"),
      Buffer.from(JSON.stringify(stableValue(sourceDigests)), "utf8"),
    ]),
  );

  return {
    manifest,
    manifestPath,
    sourceLock,
    manifestSha256,
    sourceDigests,
    contentSha256,
    sourceLockSha256: sourceLock.sha256,
    contentIdentity: {
      algorithm: "sha256",
      manifest_sha256: manifestSha256,
      source_sha256: sourceDigests,
      content_sha256: contentSha256,
    },
    toolchain: { ...TOOLCHAIN },
    oracleGameSha: ORACLE_GAME_SHA,
    oracleBranch: ORACLE_BRANCH,
    protocolVersion: PROTOCOL_VERSION,
    frameProtocolVersion: FRAME_PROTOCOL_VERSION,
  };
}

function runnerIdentity() {
  const runnerOs = process.env.RUNNER_OS ?? process.platform;
  const hosted = process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted";
  return {
    provider: hosted ? "github-hosted" : "local",
    os: process.platform,
    arch: process.arch,
    class: hosted ? `${String(runnerOs).toLowerCase()}-github-hosted` : "local",
    node_version: process.version,
    peak_rss_method: process.platform === "linux" && existsSync("/usr/bin/time") ? "gnu-time-%M-kib" : null,
    runner_os: runnerOs,
    runner_arch: process.env.RUNNER_ARCH ?? null,
    github_actions: process.env.GITHUB_ACTIONS === "true",
    hosted: hosted,
    github_run: {
      server_url: process.env.GITHUB_SERVER_URL ?? null,
      repository: process.env.GITHUB_REPOSITORY ?? null,
      workflow: process.env.GITHUB_WORKFLOW ?? null,
      job: process.env.GITHUB_JOB ?? null,
      ref: process.env.GITHUB_REF ?? null,
      sha: process.env.GITHUB_SHA ?? null,
      run_id: process.env.GITHUB_RUN_ID ?? null,
      run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
      run_number: process.env.GITHUB_RUN_NUMBER ?? null,
    },
  };
}

function workloadMetadata(context, spec) {
  return {
    scenario_id: spec.id,
    iterations: spec.iterations,
    schedules: spec.schedules,
    steps: spec.steps,
    seed: spec.seed,
    elapsed_wall_ms: null,
    peak_rss_bytes: null,
    success: null,
    failure: null,
    status: "not_measured",
    checksum: null,
    runner: runnerIdentity(),
    toolchain: context.toolchain,
    oracle_game_sha: context.oracleGameSha,
    oracle_branch: context.oracleBranch,
    protocol_version: context.protocolVersion,
    manifest_id: context.manifest.manifest_id,
    manifest_sha256: context.manifestSha256,
    source_lock_sha256: context.sourceLockSha256,
    content_sha256: context.contentSha256,
    bench_target: spec.bench_target ?? context.toolchain.bench_target,
    test_name: spec.test_name,
  };
}

function metadataResult(context) {
  return {
    schema_version: SCHEMA_VERSION,
    manifest_id: context.manifest.manifest_id,
    mode: "metadata",
    status: "not_measured",
    runner: runnerIdentity(),
    toolchain: context.toolchain,
    oracle_game_sha: context.oracleGameSha,
    oracle_branch: context.oracleBranch,
    protocol_version: context.protocolVersion,
    frame_protocol_version: context.frameProtocolVersion,
    manifest_sha256: context.manifestSha256,
    source_lock_sha256: context.sourceLockSha256,
    content_identity: context.contentIdentity,
    setup: { status: "not_measured", elapsed_wall_ms: null },
    regression_check: { status: "not_requested", factor: REGRESSION_FACTOR },
    workloads: context.manifest.workloads.map(workload => workloadMetadata(context, workload)),
  };
}

function requireHostedLinux() {
  const failures = [];
  if (process.platform !== "linux") {
    failures.push(`process platform is ${process.platform}, not linux`);
  }
  if (process.env.GITHUB_ACTIONS !== "true") {
    failures.push("GITHUB_ACTIONS is not true");
  }
  if (process.env.RUNNER_ENVIRONMENT !== "github-hosted") {
    failures.push("RUNNER_ENVIRONMENT is not github-hosted");
  }
  if (process.env.RUNNER_OS !== "Linux") {
    failures.push(`RUNNER_OS is ${process.env.RUNNER_OS ?? "<missing>"}, not Linux`);
  }
  if (process.env.GITHUB_SERVER_URL !== "https://github.com") {
    failures.push("GITHUB_SERVER_URL must be https://github.com");
  }
  if (typeof process.env.GITHUB_REPOSITORY !== "string" || !/^[^/\s]+\/[^/\s]+$/u.test(process.env.GITHUB_REPOSITORY)) {
    failures.push("GITHUB_REPOSITORY must identify owner/repository");
  }
  for (const name of ["GITHUB_WORKFLOW", "GITHUB_JOB", "GITHUB_REF"]) {
    if (typeof process.env[name] !== "string" || process.env[name].trim().length === 0) {
      failures.push(`${name} is required`);
    }
  }
  if (typeof process.env.GITHUB_SHA !== "string" || !/^[0-9a-f]{40}$/u.test(process.env.GITHUB_SHA)) {
    failures.push("GITHUB_SHA must be a 40-character lowercase SHA");
  }
  for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_NUMBER"]) {
    if (typeof process.env[name] !== "string" || !/^[1-9][0-9]*$/u.test(process.env[name])) {
      failures.push(`${name} must be a positive integer`);
    }
  }
  if (process.env[MEASURE_ATTESTATION_ENV] !== MEASURE_ATTESTATION_VALUE) {
    failures.push(`${MEASURE_ATTESTATION_ENV} does not contain the required measurement attestation`);
  }
  if (!existsSync("/usr/bin/time")) {
    failures.push("/usr/bin/time is unavailable for peak RSS measurement");
  }
  if (failures.length > 0) {
    fail(`measured mode is fail-closed: ${failures.join("; ")}`);
  }
}

function runCargoBench(context) {
  const started = performance.now();
  const result = spawnSync(
    process.env.CARGO ?? "cargo",
    [
      "test",
      "--release",
      "-p",
      context.toolchain.package,
      "--bench",
      context.toolchain.bench_target,
      "--no-run",
      "--message-format=json",
    ],
    {
      cwd: RUST_ROOT,
      encoding: "utf8",
      env: { ...process.env, CARGO_TERM_COLOR: "never" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  const elapsed = Math.round(performance.now() - started);
  if (result.error) {
    fail(`Cargo setup failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? "").trim().slice(-4000);
    fail(`Cargo benchmark compilation failed with exit ${result.status}: ${detail}`);
  }

  const artifacts = [];
  for (const line of String(result.stdout ?? "").split(/\r?\n/u)) {
    if (line.trim().length === 0) {
      continue;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      message.reason === "compiler-artifact"
      && message.target?.name === context.toolchain.bench_target
      && Array.isArray(message.target.kind)
      && message.target.kind.includes("bench")
      && typeof message.executable === "string"
    ) {
      artifacts.push(message.executable);
    }
  }
  if (artifacts.length !== 1) {
    fail(`Cargo did not produce exactly one ${context.toolchain.bench_target} bench executable`);
  }
  if (!existsSync(artifacts[0])) {
    fail(`Cargo reported a missing benchmark executable: ${artifacts[0]}`);
  }
  return {
    executable: artifacts[0],
    setup: {
      status: "passed",
      elapsed_wall_ms: elapsed,
      command: [
        process.env.CARGO ?? "cargo",
        "test",
        "--release",
        "-p",
        context.toolchain.package,
        "--bench",
        context.toolchain.bench_target,
        "--no-run",
        "--message-format=json",
      ],
    },
  };
}

function parseChildMarker(stdout, spec) {
  const output = String(stdout);
  const markerOffsets = [];
  let markerOffset = output.indexOf(RESULT_MARKER);
  while (markerOffset !== -1) {
    markerOffsets.push(markerOffset);
    markerOffset = output.indexOf(RESULT_MARKER, markerOffset + RESULT_MARKER.length);
  }
  if (markerOffsets.length !== 1) {
    fail(`workload ${spec.id} emitted ${markerOffsets.length} benchmark result markers, expected one`);
  }

  const markerStart = markerOffsets[0] + RESULT_MARKER.length;
  const lineEnd = output.indexOf("\n", markerStart);
  const markerJson = output.slice(markerStart, lineEnd === -1 ? undefined : lineEnd).trim();
  let marker;
  try {
    marker = JSON.parse(markerJson);
  } catch (error) {
    fail(`workload ${spec.id} emitted malformed benchmark JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertObject(marker, `workload ${spec.id} benchmark result`);
  if (marker.scenario_id !== spec.id) {
    fail(`workload ${spec.id} reported scenario ${marker.scenario_id ?? "<missing>"}`);
  }
  if (marker.seed !== spec.seed) {
    fail(`workload ${spec.id} reported a mismatched seed`);
  }
  for (const key of ["iterations", "schedules", "steps"]) {
    if (marker[key] !== spec[key]) {
      fail(`workload ${spec.id} reported ${key}=${marker[key] ?? "<missing>"}, expected ${spec[key]}`);
    }
  }
  if (marker.success !== true) {
    fail(`workload ${spec.id} reported success=false`);
  }
  if (typeof marker.checksum !== "string" || !/^[0-9a-f]{16}$/u.test(marker.checksum)) {
    fail(`workload ${spec.id} did not report a non-empty deterministic checksum`);
  }
  return marker;
}

function parseRss(stderr, spec) {
  const matches = [...String(stderr).matchAll(new RegExp(`^${RSS_MARKER}([0-9]+)\\s*$`, "gmu"))];
  if (matches.length !== 1) {
    fail(`workload ${spec.id} emitted ${matches.length} GNU-time RSS markers, expected one`);
  }
  const kib = Number(matches[0][1]);
  if (!Number.isSafeInteger(kib) || kib < 0 || kib > Number.MAX_SAFE_INTEGER / 1024) {
    fail(`workload ${spec.id} emitted an invalid peak RSS value`);
  }
  return kib * 1024;
}

function runOneWorkload(executable, context, spec) {
  return new Promise(resolveResult => {
    const started = performance.now();
    const child = spawn(
      "/usr/bin/time",
      ["-f", `${RSS_MARKER}%M`, executable, "--exact", "--nocapture", "--test-threads=1", spec.test_name],
      {
        cwd: RUST_ROOT,
        env: { ...process.env, LC_ALL: "C", TZ: "UTC", RUST_TEST_NOCAPTURE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    let stdout = "";
    let stderr = "";
    let spawnError = null;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, spec.timeout_ms);
    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });
    child.on("error", error => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const elapsed = Math.round(performance.now() - started);
      let marker = null;
      let peakRssBytes = null;
      let failure = null;
      try {
        if (spawnError) {
          fail(`could not start measured workload: ${spawnError.message}`);
        }
        if (timedOut) {
          fail(`workload exceeded its ${spec.timeout_ms} ms timeout`);
        }
        marker = parseChildMarker(stdout, spec);
        peakRssBytes = parseRss(stderr, spec);
        if (code !== 0 || signal !== null) {
          fail(`workload exited with code ${code ?? "<none>"}${signal ? ` (${signal})` : ""}`);
        }
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      const success = failure === null;
      const record = {
        scenario_id: spec.id,
        iterations: spec.iterations,
        schedules: spec.schedules,
        steps: spec.steps,
        seed: spec.seed,
        elapsed_wall_ms: elapsed,
        peak_rss_bytes: peakRssBytes,
        success,
        failure,
        status: success ? "passed" : "failed",
        checksum: marker?.checksum ?? null,
        details: marker?.details ?? null,
        child_exit_code: code,
        child_signal: signal,
        runner: runnerIdentity(),
        toolchain: context.toolchain,
        oracle_game_sha: context.oracleGameSha,
        oracle_branch: context.oracleBranch,
        protocol_version: context.protocolVersion,
        manifest_id: context.manifest.manifest_id,
        manifest_sha256: context.manifestSha256,
        source_lock_sha256: context.sourceLockSha256,
        content_sha256: context.contentSha256,
        bench_target: context.toolchain.bench_target,
        test_name: spec.test_name,
      };
      if (spec.target !== null && success && elapsed >= spec.target.max_elapsed_wall_ms) {
        record.success = false;
        record.status = "failed";
        record.failure = `elapsed wall time ${elapsed} ms breached target < ${spec.target.max_elapsed_wall_ms} ms`;
      }
      if (failure !== null && stderr.trim().length > 0) {
        record.diagnostic_tail = stderr.replace(new RegExp(`${RSS_MARKER}[0-9]+\\s*$`, "u"), "").trim().slice(-2000);
      }
      resolveResult(record);
    });
  });
}

function readBaseline(path) {
  const { value } = readJsonFile(path, "baseline artifact");
  assertObject(value, "baseline artifact");
  if (value.status !== "passed") {
    fail("baseline artifact must have status=passed");
  }
  if (!Array.isArray(value.workloads)) {
    fail("baseline artifact workloads must be an array");
  }
  return value;
}

function compareBaseline(current, baseline) {
  if (
    baseline.manifest_id !== current.manifest_id
    || baseline.manifest_sha256 !== current.manifest_sha256
    || baseline.source_lock_sha256 !== current.source_lock_sha256
    || baseline.content_identity?.content_sha256 !== current.content_identity.content_sha256
    || baseline.oracle_game_sha !== current.oracle_game_sha
    || baseline.oracle_branch !== current.oracle_branch
    || baseline.protocol_version !== current.protocol_version
  ) {
    fail("baseline artifact does not match manifest/content/oracle/protocol identity");
  }
  if (
    baseline.runner?.os !== current.runner.os
    || baseline.runner?.arch !== current.runner.arch
    || baseline.runner?.class !== current.runner.class
  ) {
    fail("baseline artifact was not produced on the same runner OS/arch/class");
  }
  if (baseline.workloads.length !== current.workloads.length) {
    fail("baseline artifact does not contain exactly the measured workload set");
  }
  const baselineById = new Map(baseline.workloads.map(workload => [workload.scenario_id, workload]));
  const regressions = [];
  for (const workload of current.workloads) {
    const previous = baselineById.get(workload.scenario_id);
    if (!previous || previous.status !== "passed") {
      fail(`baseline artifact is missing accepted workload ${workload.scenario_id}`);
    }
    if (
      !Number.isSafeInteger(previous.elapsed_wall_ms)
      || previous.elapsed_wall_ms < 0
      || !Number.isSafeInteger(previous.peak_rss_bytes)
      || previous.peak_rss_bytes < 0
    ) {
      fail(`baseline workload ${workload.scenario_id} has invalid measured fields`);
    }
    for (const key of ["iterations", "schedules", "steps", "seed"]) {
      if (previous[key] !== workload[key]) {
        fail(`baseline workload ${workload.scenario_id} has mismatched ${key}`);
      }
    }
    if (workload.elapsed_wall_ms > previous.elapsed_wall_ms * REGRESSION_FACTOR) {
      regressions.push({ scenario_id: workload.scenario_id, metric: "elapsed_wall_ms", previous: previous.elapsed_wall_ms, current: workload.elapsed_wall_ms });
    }
    if (workload.peak_rss_bytes > previous.peak_rss_bytes * REGRESSION_FACTOR) {
      regressions.push({ scenario_id: workload.scenario_id, metric: "peak_rss_bytes", previous: previous.peak_rss_bytes, current: workload.peak_rss_bytes });
    }
  }
  return {
    status: regressions.length === 0 ? "passed" : "failed",
    factor: REGRESSION_FACTOR,
    baseline_manifest_sha256: baseline.manifest_sha256,
    regressions,
  };
}

async function measureResult(context, options) {
  requireHostedLinux();
  if (options.oracleGameSha === null) {
    fail("--oracle-game-sha is required in measured mode");
  }
  const compiled = runCargoBench(context);
  const workloads = [];
  for (const spec of context.manifest.workloads) {
    const expected = REQUIRED_WORKLOADS.find(item => item.id === spec.id);
    if (!expected) {
      fail(`manifest workload ${spec.id} is not in the required workload set`);
    }
    workloads.push(await runOneWorkload(compiled.executable, context, { ...expected, ...spec }));
  }

  const result = {
    schema_version: SCHEMA_VERSION,
    manifest_id: context.manifest.manifest_id,
    mode: "measure",
    status: workloads.every(workload => workload.status === "passed") ? "passed" : "failed",
    runner: runnerIdentity(),
    toolchain: context.toolchain,
    oracle_game_sha: context.oracleGameSha,
    oracle_branch: context.oracleBranch,
    protocol_version: context.protocolVersion,
    frame_protocol_version: context.frameProtocolVersion,
    manifest_sha256: context.manifestSha256,
    source_lock_sha256: context.sourceLockSha256,
    content_identity: context.contentIdentity,
    setup: compiled.setup,
    regression_check: { status: "not_requested", factor: REGRESSION_FACTOR },
    workloads,
  };
  if (options.baseline !== null) {
    result.regression_check = compareBaseline(result, readBaseline(options.baseline));
    if (result.regression_check.status === "failed") {
      result.status = "failed";
    }
  }
  if (result.status === "failed") {
    const failures = result.workloads
      .filter(workload => workload.status !== "passed")
      .map(workload => `${workload.scenario_id}: ${workload.failure ?? "workload failed"}`);
    if (result.regression_check.status === "failed") {
      failures.push("baseline regression check failed");
    }
    result.failure = failures.join("; ") || "benchmark measurement failed";
    result.github_sha = process.env.GITHUB_SHA ?? null;
  }
  return result;
}

function emit(value, outputPath) {
  const compact = `${JSON.stringify(stableValue(value))}\n`;
  if (outputPath === null) {
    process.stdout.write(compact);
    return;
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, compact, "utf8");
}

function failureResult(error, mode) {
  return {
    schema_version: SCHEMA_VERSION,
    mode,
    status: "failed",
    failure: failureText(error),
    runner: runnerIdentity(),
    github_sha: process.env.GITHUB_SHA ?? null,
  };
}

function emitFailure(error, outputPath, mode) {
  const result = failureResult(error, mode);
  const compact = `${JSON.stringify(stableValue(result))}\n`;
  let outputFailure = null;
  if (outputPath !== null) {
    try {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, compact, "utf8");
    } catch (writeError) {
      outputFailure = writeError;
    }
  }
  if (outputPath === null || outputFailure !== null) {
    try {
      process.stdout.write(compact);
    } catch (stdoutError) {
      outputFailure = stdoutError;
    }
  }
  let diagnostic = `benchmark-kernel-m2: ${result.failure}`;
  if (outputFailure !== null) {
    diagnostic += `; failure JSON output fallback: ${failureText(outputFailure)}`;
  }
  try {
    process.stderr.write(`${diagnostic}\n`);
  } catch {
    // There is no further reliable output channel.
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const fallbackOutputPath = recoverOutputPath(argv);
  let options = null;
  try {
    options = parseArgs(argv);
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const context = loadContext(options.manifest, options.oracleGameSha);
    const result = options.mode === "metadata"
      ? metadataResult(context)
      : await measureResult(context, options);
    emit(result, options.output);
    if (result.status !== "passed" && options.mode === "measure") {
      process.exitCode = 1;
    }
  } catch (error) {
    emitFailure(error, options?.output ?? fallbackOutputPath, options?.mode ?? null);
    process.exitCode = 1;
  }
}

main().catch(error => {
  emitFailure(error, recoverOutputPath(process.argv.slice(2)), null);
  process.exitCode = 1;
});
