#!/usr/bin/env node

/*
 * Hosted M3 Rust-kernel benchmark coordinator.
 *
 * Metadata mode validates the frozen workload contract and launches nothing.
 * Measured mode is restricted to an attested GitHub-hosted Linux runner,
 * compiles the bench target once, and measures each already-built libtest
 * workload with GNU /usr/bin/time.  The checked-in manifest intentionally
 * contains null measured fields and an unaccepted state.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const ROOT = resolve(import.meta.dirname, "..");
const RUST_ROOT = resolve(ROOT, "rust");
const DEFAULT_MANIFEST = resolve(ROOT, "rust/fixtures/m3/m3-benchmark-manifest.json");
const SOURCE_LOCK = resolve(ROOT, "rust/source-lock.toml");
const RSS_MARKER = "__RUST_KERNEL_M3_MAX_RSS_KIB__";
const SCHEMA_VERSION = 1;
const ORACLE_GAME_SHA = "3b534099919efae827019d4a3f3c4ab0ecd6d67b";
const ORACLE_BRANCH = "ci/coop/v2-showdown-command-coordinate-20260720";
const ACTIVE_PROTOCOL_VERSION = "er-coop-48";
const ORACLE_PROTOCOL_VERSION = "er-coop-47";
const FRAME_PROTOCOL_VERSION = 2;
const OWNERSHIP_SCHEMA_VERSION = 6;
const TOOLCHAIN = Object.freeze({
  channel: "1.97.1",
  profile: "minimal",
  package: "er-sim",
  bench_target: "m3_benchmark",
  build_profile: "release",
});
const MEASURE_ATTESTATION_ENV = "RUST_KERNEL_M3_ATTESTATION";
const MEASURE_ATTESTATION_VALUE = "rust-kernel-m3-v1:measure:github-hosted";
const MAX_U64 = 18_446_744_073_709_551_615n;
const REGRESSION_FACTOR = 1.25;
const CROSS_TARGET_SUITE_TARGET = Object.freeze({
  metric: "execution_elapsed_ms",
  operator: "<",
  max_exclusive_ms: 30000,
});

const REQUIRED_WORKLOADS = Object.freeze([
  Object.freeze({
    id: "raw-menu-events",
    test_name: "m3_raw_menu_events",
    iterations: 0,
    schedules: 0,
    steps: 100000,
    seed: "81985529216486895",
    timeout_ms: 900000,
    target: Object.freeze({ metric: "execution_elapsed_ns", operator: "<", max_exclusive_ns: 5000000000 }),
    target_counts: Object.freeze({ turns: 0, battles: 1, inputs: 100000, rng_draws: null }),
  }),
  Object.freeze({
    id: "simple-turn-resolutions",
    test_name: "m3_simple_turn_resolutions",
    iterations: 10000,
    schedules: 0,
    steps: 0,
    seed: "81985529216486895",
    timeout_ms: 900000,
    target: Object.freeze({ metric: "execution_elapsed_ns", operator: "<", max_exclusive_ns: 30000000000 }),
    target_counts: Object.freeze({ turns: 10000, battles: 10000, inputs: null, rng_draws: null }),
  }),
  Object.freeze({
    id: "complete-short-battles",
    test_name: "m3_complete_short_battles",
    iterations: 1000,
    schedules: 0,
    steps: 0,
    seed: "81985529216486895",
    timeout_ms: 900000,
    target: Object.freeze({ metric: "execution_elapsed_ns", operator: "<", max_exclusive_ns: 30000000000 }),
    target_counts: Object.freeze({ turns: 1000, battles: 1000, inputs: null, rng_draws: null }),
  }),
  Object.freeze({
    id: "two-client-supported-turns",
    test_name: "m3_two_client_supported_turns",
    iterations: 1000,
    schedules: 0,
    steps: 0,
    seed: "81985529216486895",
    timeout_ms: 900000,
    target: Object.freeze({ metric: "execution_elapsed_ns", operator: "<", max_exclusive_ns: 30000000000 }),
    target_counts: Object.freeze({ turns: 1000, battles: 1000, inputs: null, rng_draws: null }),
  }),
  Object.freeze({
    id: "complete-supported-coop-battle",
    test_name: "m3_complete_supported_coop_battle",
    iterations: 1,
    schedules: 0,
    steps: 0,
    seed: "81985529216486895",
    timeout_ms: 900000,
    target: Object.freeze({ metric: "execution_elapsed_ns", operator: "<", max_exclusive_ns: 100000000 }),
    target_counts: Object.freeze({ turns: 1, battles: 1, inputs: null, rng_draws: null }),
  }),
]);

function usage() {
  return [
    "Usage: node scripts/benchmark-kernel-m3.mjs [options]",
    "",
    "Modes:",
    "  --mode metadata   Validate and describe the manifest; launch nothing (default).",
    "  --mode measure    Compile once and measure all M3 workloads on hosted Linux.",
    "",
    "Options:",
    "  --manifest FILE            Manifest path (default: rust/fixtures/m3/m3-benchmark-manifest.json).",
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
    baseline: null,
    output: null,
  };
  const args = argv.values();
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--mode") {
      options.mode = args.next().value;
      if (!["metadata", "measure"].includes(options.mode)) {
        throw new Error(`--mode must be metadata or measure; got ${options.mode ?? "<missing>"}`);
      }
      continue;
    }
    if (arg === "--manifest") {
      const value = args.next().value;
      if (!value) {
        throw new Error("--manifest requires a file path");
      }
      options.manifest = resolve(process.cwd(), value);
      continue;
    }
    if (arg === "--baseline") {
      const value = args.next().value;
      if (!value) {
        throw new Error("--baseline requires a file path");
      }
      options.baseline = resolve(process.cwd(), value);
      continue;
    }
    if (arg === "--output") {
      const value = args.next().value;
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

function failureText(error) {
  const text = error instanceof Error ? error.message : String(error);
  const compact = text.replace(/\s+/gu, " ").trim();
  return (compact.length > 0 ? compact : "unknown failure").slice(0, 4000);
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

function assertSafeInteger(value, label) {
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

function readJson(path, label) {
  let contents;
  try {
    contents = readFileSync(path);
  } catch (error) {
    fail(`cannot read ${label}: ${failureText(error)}`);
  }
  try {
    return { contents, value: JSON.parse(contents.toString("utf8")) };
  } catch (error) {
    fail(`${label} is not valid JSON: ${failureText(error)}`);
  }
}

function readSourceLock() {
  const text = readFileSync(SOURCE_LOCK, "utf8");
  const values = Object.fromEntries(
    [...text.matchAll(/^([a-z_]+)\s*=\s*"([^"]*)"$/gmu)].map(match => [match[1], match[2]]),
  );
  return values;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function contentIdentity(manifestContents, sourceHashes) {
  const hash = createHash("sha256").update(manifestContents);
  for (const [path, sourceHash] of [...sourceHashes].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path).update("\0").update(sourceHash).update("\0");
  }
  return hash.digest("hex");
}

function validateUnacceptedMeasurement(value, label) {
  assertObject(value, label);
  if (value.status !== "not_measured" || value.accepted !== false) {
    fail(`${label} must remain not_measured and unaccepted until hosted measurement`);
  }
  for (const field of [
    "content_load_elapsed_ns",
    "execution_elapsed_ns",
    "elapsed_wall_ms",
    "peak_rss_bytes",
    "counts",
    "checksum",
  ]) {
    if (value[field] !== null) {
      fail(`${label}.${field} must be null before hosted measurement`);
    }
  }
}

function validateManifest(manifestPath) {
  const { contents, value: manifest } = readJson(manifestPath, "M3 benchmark manifest");
  assertObject(manifest, "manifest");
  if (manifest.schema_version !== SCHEMA_VERSION) {
    fail("manifest schema_version is not 1");
  }
  if (manifest.manifest_id !== "rust-kernel-m3-bench-v1") {
    fail("unexpected M3 benchmark manifest id");
  }
  if (manifest.oracle_game_sha !== ORACLE_GAME_SHA) {
    fail("manifest oracle_game_sha is not frozen M3 SHA");
  }
  if (manifest.oracle_branch !== ORACLE_BRANCH) {
    fail("manifest oracle_branch is not frozen");
  }
  if (manifest.protocol_version !== ACTIVE_PROTOCOL_VERSION) {
    fail("manifest protocol_version is not frozen");
  }
  if (manifest.frame_protocol_version !== FRAME_PROTOCOL_VERSION) {
    fail("manifest frame protocol version is not 2");
  }
  if (manifest.source_lock_schema_version !== 1) {
    fail("manifest source-lock schema version is not 1");
  }
  if (manifest.ownership_schema_version !== OWNERSHIP_SCHEMA_VERSION) {
    fail("manifest ownership schema version is not 6");
  }
  if (JSON.stringify(manifest.cross_target_suite_target) !== JSON.stringify(CROSS_TARGET_SUITE_TARGET)) {
    fail("manifest cross-target continuation-suite target is not the frozen 30-second limit");
  }
  assertObject(manifest.toolchain, "manifest.toolchain");
  for (const [key, expected] of Object.entries(TOOLCHAIN)) {
    if (manifest.toolchain[key] !== expected) {
      fail(`manifest.toolchain.${key} is not ${expected}`);
    }
  }
  assertObject(manifest.content_identity, "manifest.content_identity");
  if (manifest.content_identity.algorithm !== "sha256") {
    fail("manifest content_identity.algorithm is not sha256");
  }
  if (
    manifest.content_identity.definition
      !== "sha256 of the exact manifest bytes plus sorted declared benchmark-source sha256 values"
  ) {
    fail("manifest content_identity.definition is not frozen");
  }
  const lock = readSourceLock();
  if (lock.oracle_game_sha !== ORACLE_GAME_SHA) {
    fail("source lock oracle SHA does not match M3 manifest");
  }
  if (lock.oracle_branch !== ORACLE_BRANCH) {
    fail("source lock oracle branch does not match M3 manifest");
  }
  if (lock.protocol_version !== ORACLE_PROTOCOL_VERSION) {
    fail("source lock oracle protocol does not match the immutable M3 oracle pin");
  }

  if (!Array.isArray(manifest.source_paths) || manifest.source_paths.length !== 1) {
    fail("manifest.source_paths must contain exactly the M3 benchmark source");
  }
  const sourcePaths = manifest.source_paths.map((path, index) => projectPath(path, `manifest.source_paths[${index}]`));
  if (manifest.source_paths[0] !== "rust/crates/er-sim/benches/m3_benchmark.rs") {
    fail("manifest source path is not m3_benchmark.rs");
  }
  const sourceHashes = sourcePaths.map((path, index) => {
    if (!existsSync(path)) {
      fail(`manifest source path does not exist: ${manifest.source_paths[index]}`);
    }
    return [manifest.source_paths[index], sha256(readFileSync(path))];
  });

  assertObject(manifest.measurement_state, "manifest.measurement_state");
  if (manifest.measurement_state.status !== "unaccepted" || manifest.measurement_state.accepted !== false) {
    fail("checked-in M3 manifest must remain unaccepted");
  }
  if (manifest.measurement_state.artifact !== null || manifest.measurement_state.measured_at !== null) {
    fail("checked-in M3 manifest must not carry a hosted artifact or measurement timestamp");
  }

  if (!Array.isArray(manifest.workloads) || manifest.workloads.length !== REQUIRED_WORKLOADS.length) {
    fail("manifest workload count does not match the frozen M3 workload set");
  }
  for (const [index, required] of REQUIRED_WORKLOADS.entries()) {
    const workload = manifest.workloads[index];
    assertObject(workload, `workload ${required.id}`);
    if (workload.id !== required.id) {
      fail(`manifest workload ${index} is not ${required.id} or is out of order`);
    }
    for (const key of ["test_name", "iterations", "schedules", "steps", "seed", "timeout_ms"]) {
      if (workload[key] !== required[key]) {
        fail(`workload ${required.id}.${key} does not match frozen input`);
      }
    }
    if (JSON.stringify(workload.target_counts) !== JSON.stringify(required.target_counts)) {
      fail(`workload ${required.id}.target_counts does not match the published target`);
    }
    assertObject(workload.target_counts, `workload ${required.id}.target_counts`);
    for (const field of ["turns", "battles", "inputs", "rng_draws"]) {
      if (workload.target_counts[field] !== null) {
        assertSafeInteger(workload.target_counts[field], `workload ${required.id}.target_counts.${field}`);
      }
    }
    assertCanonicalSeed(workload.seed, `workload ${required.id}.seed`);
    assertSafeInteger(workload.iterations, `workload ${required.id}.iterations`);
    assertSafeInteger(workload.schedules, `workload ${required.id}.schedules`);
    assertSafeInteger(workload.steps, `workload ${required.id}.steps`);
    assertSafeInteger(workload.timeout_ms, `workload ${required.id}.timeout_ms`);
    if (workload.bench_target !== "m3_benchmark" || workload.requires_linux !== true) {
      fail(`workload ${required.id} has an invalid target contract`);
    }
    if (JSON.stringify(workload.target) !== JSON.stringify(required.target)) {
      fail(`workload ${required.id}.target does not match the frozen hard target`);
    }
    assertObject(workload.target, `workload ${required.id}.target`);
    if (workload.target.metric !== "execution_elapsed_ns" || workload.target.operator !== "<") {
      fail(`workload ${required.id}.target must be an exclusive execution-time limit`);
    }
    assertSafeInteger(workload.target.max_exclusive_ns, `workload ${required.id}.target.max_exclusive_ns`);
    if (JSON.stringify(workload.source_paths) !== JSON.stringify(manifest.source_paths)) {
      fail(`workload ${required.id} must declare the benchmark source path`);
    }
    validateUnacceptedMeasurement(workload.measurement, `workload ${required.id}.measurement`);
  }
  return {
    contents,
    manifest,
    sourceHashes,
    contentIdentity: contentIdentity(contents, sourceHashes),
    manifestSha256: sha256(contents),
    sourceLockSha256: sha256(readFileSync(SOURCE_LOCK)),
  };
}

function runnerIdentity() {
  const hosted = process.env.GITHUB_ACTIONS === "true" && process.env.RUNNER_ENVIRONMENT === "github-hosted";
  return {
    provider: hosted ? "github-hosted" : "local",
    os: process.platform,
    arch: process.arch,
    class: hosted ? `${String(process.env.RUNNER_OS).toLowerCase()}-github-hosted` : "local",
    node_version: process.version,
    github_actions: process.env.GITHUB_ACTIONS === "true",
    hosted,
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

function metadataResult(validated) {
  return {
    schema_version: SCHEMA_VERSION,
    manifest_id: validated.manifest.manifest_id,
    mode: "metadata",
    accepted: false,
    acceptance_status: "unaccepted",
    measured: false,
    runner: runnerIdentity(),
    toolchain: TOOLCHAIN,
    oracle_game_sha: ORACLE_GAME_SHA,
    oracle_branch: ORACLE_BRANCH,
    protocol_version: ACTIVE_PROTOCOL_VERSION,
    frame_protocol_version: FRAME_PROTOCOL_VERSION,
    cross_target_suite_target: CROSS_TARGET_SUITE_TARGET,
    manifest_sha256: validated.manifestSha256,
    source_lock_sha256: validated.sourceLockSha256,
    content_identity_sha256: validated.contentIdentity,
    source_sha256: Object.fromEntries(validated.sourceHashes),
    setup: {
      status: "not_measured",
      accepted: false,
      elapsed_wall_ms: null,
      peak_rss_bytes: null,
    },
    workloads: REQUIRED_WORKLOADS.map(required => ({
      id: required.id,
      bench_target: TOOLCHAIN.bench_target,
      test_name: required.test_name,
      iterations: required.iterations,
      schedules: required.schedules,
      steps: required.steps,
      seed: required.seed,
      target: required.target,
      target_counts: required.target_counts,
      requires_linux: true,
      source_paths: validated.manifest.source_paths,
      status: "not_measured",
      accepted: false,
      content_load_elapsed_ns: null,
      execution_elapsed_ns: null,
      elapsed_wall_ms: null,
      peak_rss_bytes: null,
      counts: null,
      checksum: null,
    })),
  };
}

function requireHostedMeasurement() {
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
    failures.push("RUNNER_OS is not Linux");
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
    failures.push("GNU /usr/bin/time is required for RSS measurement");
  }
  if (failures.length > 0) {
    fail(`measured mode is fail-closed: ${failures.join("; ")}`);
  }
}

function compileBench() {
  const started = performance.now();
  const cargo = process.env.CARGO ?? "cargo";
  const result = spawnSync(
    "/usr/bin/time",
    [
      "-f",
      `${RSS_MARKER}%M`,
      cargo,
      "test",
      "--release",
      "-p",
      "er-sim",
      "--bench",
      "m3_benchmark",
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
  if (result.error) {
    fail(`cargo setup failed: ${failureText(result.error)}`);
  }
  if (result.status !== 0) {
    fail(`cargo setup failed with status ${result.status}: ${result.stderr ?? result.stdout ?? ""}`);
  }
  const rssMatch = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(
    new RegExp(`${RSS_MARKER}(\\d+)`, "u"),
  );
  if (!rssMatch) {
    fail("cargo setup did not emit GNU time RSS marker");
  }
  const setupPeakRssBytes = Number(rssMatch[1]) * 1024;
  assertSafeInteger(setupPeakRssBytes, "setup.peak_rss_bytes");
  for (const line of (result.stdout ?? "").split(/\r?\n/u)) {
    if (!line.trim().startsWith("{")) {
      continue;
    }
    try {
      const message = JSON.parse(line);
      if (
        message.reason === "compiler-artifact"
        && typeof message.executable === "string"
        && message.target?.name === "m3_benchmark"
        && Array.isArray(message.target.kind)
        && message.target.kind.includes("bench")
      ) {
        if (!existsSync(message.executable)) {
          fail("cargo reported a missing m3_benchmark executable");
        }
        return {
          executable: message.executable,
          setup: {
            status: "measured",
            accepted: true,
            elapsed_wall_ms: Math.max(0, Math.round(performance.now() - started)),
            peak_rss_bytes: setupPeakRssBytes,
          },
        };
      }
    } catch {
      // Cargo warnings are allowed around its JSON compiler-artifact stream.
    }
  }
  fail("cargo setup produced no m3_benchmark executable");
}

function parseBenchmarkMarker(output, required) {
  const matches = [...output.matchAll(/^M3_BENCHMARK_RESULT (\{.*\})$/gmu)];
  if (matches.length !== 1) {
    fail(`${required.id} did not emit exactly one M3 benchmark marker`);
  }
  let marker;
  try {
    marker = JSON.parse(matches[0][1]);
  } catch (error) {
    fail(`${required.id} emitted invalid benchmark JSON: ${failureText(error)}`);
  }
  assertObject(marker, `${required.id} benchmark marker`);
  for (const key of [
    "scenario_id",
    "seed",
    "iterations",
    "schedules",
    "steps",
    "checksum",
    "content_load_elapsed_ns",
    "execution_elapsed_ns",
    "counts",
  ]) {
    if (!(key in marker)) {
      fail(`${required.id} marker is missing ${key}`);
    }
  }
  if (marker.scenario_id !== required.id) {
    fail(`${required.id} marker scenario does not match manifest`);
  }
  if (marker.seed !== required.seed) {
    fail(`${required.id} marker seed does not match manifest`);
  }
  if (marker.iterations !== required.iterations) {
    fail(`${required.id} marker iterations do not match manifest`);
  }
  if (marker.schedules !== required.schedules) {
    fail(`${required.id} marker schedules do not match manifest`);
  }
  if (marker.steps !== required.steps) {
    fail(`${required.id} marker steps do not match manifest`);
  }
  if (marker.success !== true || !/^[0-9a-f]{16}$/u.test(marker.checksum)) {
    fail(`${required.id} marker did not report a successful deterministic checksum`);
  }
  for (const field of ["content_load_elapsed_ns", "execution_elapsed_ns"]) {
    assertSafeInteger(marker[field], `${required.id}.${field}`);
  }
  assertObject(marker.counts, `${required.id}.counts`);
  for (const field of ["turns", "battles", "inputs", "rng_draws"]) {
    assertSafeInteger(marker.counts[field], `${required.id}.counts.${field}`);
    const expected = required.target_counts[field];
    if (expected !== null && marker.counts[field] !== expected) {
      fail(`${required.id}.counts.${field} does not match target ${expected}`);
    }
  }
  return marker;
}

function runWorkload(executable, required) {
  const started = performance.now();
  const result = spawnSync(
    "/usr/bin/time",
    ["-f", `${RSS_MARKER}%M`, executable, "--exact", required.test_name, "--nocapture"],
    { cwd: ROOT, encoding: "utf8", timeout: required.timeout_ms, maxBuffer: 64 * 1024 * 1024 },
  );
  const elapsed = Math.max(0, Math.round(performance.now() - started));
  if (result.error) {
    fail(`${required.id} failed to launch: ${failureText(result.error)}`);
  }
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    fail(`${required.id} failed with status ${result.status}: ${combined}`);
  }
  const rssMatch = combined.match(new RegExp(`${RSS_MARKER}(\\d+)`, "u"));
  if (!rssMatch) {
    fail(`${required.id} did not emit GNU time RSS marker`);
  }
  const peakRssBytes = Number(rssMatch[1]) * 1024;
  assertSafeInteger(peakRssBytes, `${required.id}.peak_rss_bytes`);
  const marker = parseBenchmarkMarker(result.stdout ?? "", required);
  if (marker.execution_elapsed_ns >= required.target.max_exclusive_ns) {
    const phaseEvidence = marker.details?.phase_elapsed_ns;
    const phaseSuffix = phaseEvidence && typeof phaseEvidence === "object"
      ? `; phase_elapsed_ns=${JSON.stringify(phaseEvidence)}`
      : "";
    fail(
      `${required.id} execution elapsed ${marker.execution_elapsed_ns}ns `
        + `did not meet the exclusive target ${required.target.max_exclusive_ns}ns${phaseSuffix}`,
    );
  }
  return {
    id: required.id,
    test_name: required.test_name,
    iterations: required.iterations,
    schedules: required.schedules,
    steps: required.steps,
    seed: required.seed,
    target: required.target,
    target_counts: required.target_counts,
    status: "measured",
    accepted: true,
    content_load_elapsed_ns: marker.content_load_elapsed_ns,
    execution_elapsed_ns: marker.execution_elapsed_ns,
    elapsed_wall_ms: elapsed,
    peak_rss_bytes: peakRssBytes,
    counts: marker.counts,
    checksum: marker.checksum,
    details: marker.details ?? null,
  };
}

function compareBaseline(current, baselinePath) {
  if (!baselinePath) {
    return { status: "baseline_created", factor: REGRESSION_FACTOR };
  }
  const { value: baseline } = readJson(baselinePath, "M3 benchmark baseline");
  assertObject(baseline, "baseline");
  if (
    baseline.mode !== "measure"
    || baseline.measured !== true
    || baseline.accepted !== true
    || baseline.acceptance_status !== "accepted"
    || baseline.runner?.hosted !== true
  ) {
    fail("baseline must be an accepted same-runner M3 artifact");
  }
  for (const field of [
    "manifest_id",
    "manifest_sha256",
    "source_lock_sha256",
    "content_identity_sha256",
    "oracle_game_sha",
    "oracle_branch",
    "protocol_version",
  ]) {
    if (baseline[field] !== current[field]) {
      fail(`baseline ${field} does not match current artifact`);
    }
  }
  for (const field of ["os", "arch", "class"]) {
    if (baseline.runner?.[field] !== current.runner[field]) {
      fail(`baseline runner.${field} does not match current hosted runner`);
    }
  }
  if (!Array.isArray(baseline.workloads) || baseline.workloads.length !== current.workloads.length) {
    fail("baseline does not contain exactly the current workload set");
  }
  for (const field of ["elapsed_wall_ms", "peak_rss_bytes"]) {
    const prior = baseline.setup?.[field];
    const measured = current.setup?.[field];
    if (!Number.isFinite(prior) || prior < 0 || !Number.isFinite(measured) || measured < 0) {
      fail(`baseline setup.${field} is invalid`);
    }
    if (measured > prior * REGRESSION_FACTOR) {
      fail(`setup.${field} exceeded the ${REGRESSION_FACTOR}x regression gate`);
    }
  }
  for (const workload of current.workloads) {
    const prior = baseline.workloads.find(candidate => candidate?.id === workload.id);
    if (!prior || prior.accepted !== true) {
      fail(`baseline is missing accepted workload ${workload.id}`);
    }
    for (const field of ["test_name", "iterations", "schedules", "steps", "seed", "checksum"]) {
      if (prior[field] !== workload[field]) {
        fail(`baseline ${workload.id}.${field} does not match current input`);
      }
    }
    if (JSON.stringify(prior.target_counts) !== JSON.stringify(workload.target_counts)) {
      fail(`baseline ${workload.id}.target_counts does not match current input`);
    }
    if (JSON.stringify(prior.counts) !== JSON.stringify(workload.counts)) {
      fail(`baseline ${workload.id}.counts does not match current deterministic counts`);
    }
    for (const field of [
      "content_load_elapsed_ns",
      "execution_elapsed_ns",
      "elapsed_wall_ms",
      "peak_rss_bytes",
    ]) {
      if (!Number.isFinite(prior[field]) || prior[field] < 0) {
        fail(`baseline ${workload.id}.${field} is invalid`);
      }
      if (workload[field] > prior[field] * REGRESSION_FACTOR) {
        fail(`${workload.id}.${field} exceeded the ${REGRESSION_FACTOR}x regression gate`);
      }
    }
  }
  return {
    status: "passed",
    factor: REGRESSION_FACTOR,
    baseline_manifest_sha256: baseline.manifest_sha256,
  };
}

function measuredResult(validated, setup, measurements) {
  return {
    schema_version: SCHEMA_VERSION,
    manifest_id: validated.manifest.manifest_id,
    mode: "measure",
    accepted: true,
    acceptance_status: "accepted",
    measured: true,
    runner: runnerIdentity(),
    toolchain: TOOLCHAIN,
    oracle_game_sha: ORACLE_GAME_SHA,
    oracle_branch: ORACLE_BRANCH,
    protocol_version: ACTIVE_PROTOCOL_VERSION,
    frame_protocol_version: FRAME_PROTOCOL_VERSION,
    cross_target_suite_target: CROSS_TARGET_SUITE_TARGET,
    manifest_sha256: validated.manifestSha256,
    source_lock_sha256: validated.sourceLockSha256,
    content_identity_sha256: validated.contentIdentity,
    source_sha256: Object.fromEntries(validated.sourceHashes),
    setup,
    workloads: measurements,
  };
}

function writeOrPrint(value, outputPath) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, text, "utf8");
    return;
  }
  process.stdout.write(text);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const validated = validateManifest(options.manifest);
  if (options.mode === "metadata") {
    writeOrPrint(metadataResult(validated), options.output);
    return;
  }
  requireHostedMeasurement();
  const compiled = compileBench();
  const measurements = REQUIRED_WORKLOADS.map(required => runWorkload(compiled.executable, required));
  const result = measuredResult(validated, compiled.setup, measurements);
  result.regression_check = compareBaseline(result, options.baseline);
  writeOrPrint(result, options.output);
}

try {
  main();
} catch (error) {
  process.stderr.write(`M3 benchmark coordinator failed: ${failureText(error)}\n`);
  process.exitCode = 1;
}
