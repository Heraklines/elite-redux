#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const root = resolve(import.meta.dirname, "..");
const target = required("--target-ring");
const output = resolve(root, required("--output"));
const health = JSON.parse(readFileSync(resolve(root, required("--health")), "utf8"));
const currentPath = args.get("--current");
const current = currentPath == null ? null : JSON.parse(readFileSync(resolve(root, currentPath), "utf8")).payload;
const rings = [
  ring("R0", 0, "CI_LOCAL", 0, 0),
  ring("R1", 0, "INTERNAL_ALLOWLIST", 50, 60),
  ring("R2", 0, "PREVIEW_ALLOWLIST", 200, 240),
  ring("R3", 100, "PUBLIC", 1_000, 720),
  ring("R4", 500, "PUBLIC", 5_000, 720),
  ring("R5", 2_500, "PUBLIC", 20_000, 1_440),
  ring("R6", 5_000, "PUBLIC", 50_000, 1_440),
  ring("R7", 10_000, "PUBLIC", 100_000, 2_880),
];
const targetIndex = rings.findIndex(value => value.ring === target);
const currentIndex = current == null ? -1 : rings.findIndex(value => value.ring === current.active_ring);
if (targetIndex < 0 || targetIndex !== currentIndex + 1) {
  throw new Error("M9 rollout promotion must advance exactly one ring");
}
const evidenceRing = rings[currentIndex < 0 ? targetIndex : currentIndex];
if (health.hard_stop || health.hard_stop_fingerprint != null || health.deterministic_migration_failures !== 0) {
  throw new Error("M9 rollout is halted by a zero-tolerance health event");
}
const requiredHealth = evidenceRing.required_health;
if (
  health.observed_sessions < evidenceRing.minimum_sessions
  || health.observed_minutes < evidenceRing.minimum_duration_minutes
  || health.worker_initialization_failure_basis_points > requiredHealth.worker_initialization_failure_basis_points
  || health.unrecoverable_kernel_fault_basis_points > requiredHealth.unrecoverable_kernel_fault_basis_points
  || health.cloud_save_regression_basis_points > requiredHealth.cloud_save_regression_basis_points
  || health.coop_relative_regression_percent > requiredHealth.coop_relative_regression_percent
  || health.coop_absolute_regression_basis_points > requiredHealth.coop_absolute_regression_basis_points
  || health.input_latency_regression_percent > requiredHealth.input_latency_regression_percent
  || health.crash_free_regression_basis_points > requiredHealth.crash_free_regression_basis_points
) {
  throw new Error("M9 rollout health or soak budget is incomplete");
}
const now = Date.now();
const policy = {
  schema_version: 1,
  policy_id: args.get("--policy-id") ?? `m9-policy-${now}`,
  policy_version: (current?.policy_version ?? 0) + 1,
  candidate_release: required("--candidate-release"),
  stable_release: required("--stable-release"),
  legacy_release: args.get("--legacy-release") ?? null,
  active_ring: target,
  rings,
  hard_stop_rules: [
    "SAVE_CORRUPTION",
    "DETERMINISTIC_MIGRATION_FAILURE",
    "MECHANICAL_DIVERGENCE",
    "MIXED_ARTIFACT_EXECUTION",
    "ACCEPTED_PROTOCOL_MISMATCH",
    "CROSS_GENERATION_MATERIAL",
    "AUTHORITY_REPLICA_MISMATCH",
    "UNSIGNED_ASSIGNMENT",
    "RENDERER_CANONICAL_MUTATION",
  ],
  soft_stop_rules: [
    "WORKER_FAILURE_RATE",
    "KERNEL_FAULT_RATE",
    "CLOUD_SAVE_REGRESSION",
    "COOP_REGRESSION",
    "INPUT_LATENCY_REGRESSION",
    "CRASH_FREE_REGRESSION",
  ],
  issued_at: now,
  expires_at: now + 2_592_000_000,
};
writeFileSync(output, `${JSON.stringify(policy)}\n`);

function ring(name, percentage, eligibility, minimumSessions, minimumMinutes) {
  return {
    ring: name,
    percentage_basis_points: percentage,
    eligibility,
    minimum_sessions: minimumSessions,
    minimum_duration_minutes: minimumMinutes,
    required_health: {
      worker_initialization_failure_basis_points: 20,
      unrecoverable_kernel_fault_basis_points: 5,
      deterministic_migration_failures: 0,
      cloud_save_regression_basis_points: 10,
      coop_relative_regression_percent: 10,
      coop_absolute_regression_basis_points: 25,
      input_latency_regression_percent: 20,
      crash_free_regression_basis_points: 10,
    },
  };
}

function required(name) {
  const value = args.get(name);
  if (value == null || value.length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
