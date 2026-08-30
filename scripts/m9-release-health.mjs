#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const root = resolve(import.meta.dirname, "..");
const input = JSON.parse(readFileSync(resolve(root, required("--input")), "utf8"));
const allowed = new Set([
  "schema_version",
  "release_id",
  "observed_sessions",
  "observed_minutes",
  "worker_initialization_failure_basis_points",
  "unrecoverable_kernel_fault_basis_points",
  "deterministic_migration_failures",
  "cloud_save_regression_basis_points",
  "coop_relative_regression_percent",
  "coop_absolute_regression_basis_points",
  "input_latency_regression_percent",
  "crash_free_regression_basis_points",
  "hard_stop_fingerprints",
]);
if (Object.keys(input).some(key => !allowed.has(key))) {
  throw new Error("M9 health input contains a forbidden/unbounded field");
}
const fingerprints = [...new Set(input.hard_stop_fingerprints ?? [])].sort();
if (fingerprints.some(value => !/^[0-9a-f]{64}$/u.test(value))) {
  throw new Error("M9 health input contains an invalid fingerprint");
}
const output = {
  schema_version: 1,
  observed_sessions: bounded(input.observed_sessions),
  observed_minutes: bounded(input.observed_minutes),
  worker_initialization_failure_basis_points: rate(input.worker_initialization_failure_basis_points),
  unrecoverable_kernel_fault_basis_points: rate(input.unrecoverable_kernel_fault_basis_points),
  deterministic_migration_failures: bounded(input.deterministic_migration_failures),
  cloud_save_regression_basis_points: rate(input.cloud_save_regression_basis_points),
  coop_relative_regression_percent: percent(input.coop_relative_regression_percent),
  coop_absolute_regression_basis_points: rate(input.coop_absolute_regression_basis_points),
  input_latency_regression_percent: percent(input.input_latency_regression_percent),
  crash_free_regression_basis_points: rate(input.crash_free_regression_basis_points),
  hard_stop: fingerprints.length > 0 || input.deterministic_migration_failures > 0,
  hard_stop_fingerprint: fingerprints[0] ?? null,
};
writeFileSync(resolve(root, required("--output")), `${JSON.stringify(output)}\n`);

function bounded(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("M9 health count is invalid");
  }
  return value;
}
function rate(value) {
  const result = bounded(value);
  if (result > 10_000) {
    throw new Error("M9 health rate is invalid");
  }
  return result;
}
function percent(value) {
  const result = bounded(value);
  if (result > 100) {
    throw new Error("M9 health percent is invalid");
  }
  return result;
}
function required(name) {
  const value = args.get(name);
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
