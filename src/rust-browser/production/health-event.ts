import { encodeCanonicalJsonV1 } from "../host/message-sequencer";
import { type BrowserKernelGenerationIdentityV1, validateBrowserGenerationIdentityV1 } from "../hot-reload/contracts";
import type { RolloutRingV1 } from "./contracts";

export type ProductionHealthEventKindV1 =
  | "BOOTSTRAP_SUCCESS"
  | "BOOTSTRAP_FAILURE"
  | "WORKER_INITIALIZATION"
  | "SAVE_MIGRATION"
  | "SAVE_READ"
  | "SAVE_WRITE"
  | "SAVE_CONFLICT"
  | "KERNEL_FAULT"
  | "PROTOCOL_PAIRING"
  | "RECONNECT_RECOVERY"
  | "PRESENTATION_FAILURE"
  | "SERVICE_WORKER_MISMATCH"
  | "CACHE_FAILURE"
  | "TERMINAL_COMPLETION"
  | "PERFORMANCE_OUTLIER";
export type ProductionHardStopRuleV1 =
  | "SAVE_CORRUPTION"
  | "DETERMINISTIC_MIGRATION_FAILURE"
  | "MECHANICAL_DIVERGENCE"
  | "MIXED_ARTIFACT_EXECUTION"
  | "ACCEPTED_PROTOCOL_MISMATCH"
  | "CROSS_GENERATION_MATERIAL"
  | "AUTHORITY_REPLICA_MISMATCH"
  | "UNSIGNED_ASSIGNMENT"
  | "RENDERER_CANONICAL_MUTATION";

export interface BoundedPerformanceSummaryV1 {
  samples: number;
  median_micros: number;
  p95_micros: number;
  p99_micros: number;
  maximum_micros: number;
  memory_bytes: number;
}
export interface PerformanceObservationV1 {
  elapsed_micros: number;
  memory_bytes: number;
}

export interface FailureFingerprintAggregateV1 {
  fingerprint: string;
  count: number;
}

export interface ProductionHealthEventV1 {
  schema_version: 1;
  release_id: string;
  kernel_generation: BrowserKernelGenerationIdentityV1;
  browser_class: "CHROMIUM" | "FIREFOX" | "WEBKIT" | "UNKNOWN";
  platform_class: "DESKTOP" | "MOBILE" | "TABLET" | "UNKNOWN";
  event: ProductionHealthEventKindV1;
  failure_fingerprint: string | null;
  performance: BoundedPerformanceSummaryV1 | null;
  hard_stop_rule: ProductionHardStopRuleV1 | null;
}

export interface ShadowSamplingPolicyV1 {
  schema_version: 1;
  percentage_basis_points: number;
  eligible_rings: string[];
  maximum_events: number;
  maximum_cpu_overhead_percent: number;
}

export interface ReleaseHealthDecisionV1 {
  decision: "PROMOTE" | "PAUSE" | "HALT";
  reasons: string[];
}

export interface ReleaseHealthDecisionEvidenceV1 extends ReleaseHealthDecisionV1 {
  schema_version: 1;
  policy_hash: string;
  release_manifest_hash: string;
  input_event_aggregate_hash: string;
  window_start_ms: number;
  window_end_ms: number;
}

const HEALTH_EVENT_KINDS: Readonly<Record<ProductionHealthEventKindV1, true>> = {
  BOOTSTRAP_SUCCESS: true,
  BOOTSTRAP_FAILURE: true,
  WORKER_INITIALIZATION: true,
  SAVE_MIGRATION: true,
  SAVE_READ: true,
  SAVE_WRITE: true,
  SAVE_CONFLICT: true,
  KERNEL_FAULT: true,
  PROTOCOL_PAIRING: true,
  RECONNECT_RECOVERY: true,
  PRESENTATION_FAILURE: true,
  SERVICE_WORKER_MISMATCH: true,
  CACHE_FAILURE: true,
  TERMINAL_COMPLETION: true,
  PERFORMANCE_OUTLIER: true,
};
const HARD_STOP_RULES: Readonly<Record<ProductionHardStopRuleV1, true>> = {
  SAVE_CORRUPTION: true,
  DETERMINISTIC_MIGRATION_FAILURE: true,
  MECHANICAL_DIVERGENCE: true,
  MIXED_ARTIFACT_EXECUTION: true,
  ACCEPTED_PROTOCOL_MISMATCH: true,
  CROSS_GENERATION_MATERIAL: true,
  AUTHORITY_REPLICA_MISMATCH: true,
  UNSIGNED_ASSIGNMENT: true,
  RENDERER_CANONICAL_MUTATION: true,
};
const HEALTH_KEYS: Readonly<Record<string, true>> = {
  schema_version: true,
  release_id: true,
  kernel_generation: true,
  browser_class: true,
  platform_class: true,
  event: true,
  failure_fingerprint: true,
  performance: true,
  hard_stop_rule: true,
};
const GENERATION_KEYS: Readonly<Record<string, true>> = {
  schema_version: true,
  session_id: true,
  generation: true,
  artifact_sha256: true,
  wasm_sha256: true,
  content_sha256: true,
  source_git_sha: true,
  worker_abi_version: true,
  minimum_snapshot_schema: true,
  maximum_snapshot_schema: true,
  content_identity: true,
  release_id: true,
};
const MAXIMUM_PERFORMANCE_MICROS = 86_400_000_000;
const MAXIMUM_MEMORY_BYTES = 1_099_511_627_776;
const MAXIMUM_AGGREGATE_SAMPLES = 10_000;

export function validateProductionHealthEventV1(event: ProductionHealthEventV1): ProductionHealthEventV1 {
  validateBrowserGenerationIdentityV1(event.kernel_generation);
  const serialized = JSON.stringify(event);
  if (
    event.schema_version !== 1
    || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(event.release_id)
    || event.kernel_generation.release_id !== event.release_id
    || event.kernel_generation.generation < 1
    || !["CHROMIUM", "FIREFOX", "WEBKIT", "UNKNOWN"].includes(event.browser_class)
    || !["DESKTOP", "MOBILE", "TABLET", "UNKNOWN"].includes(event.platform_class)
    || HEALTH_EVENT_KINDS[event.event] !== true
    || (event.failure_fingerprint != null && !/^[0-9a-f]{64}$/u.test(event.failure_fingerprint))
    || (event.hard_stop_rule != null && HARD_STOP_RULES[event.hard_stop_rule] !== true)
    || (event.hard_stop_rule != null && event.failure_fingerprint == null)
    || serialized.length > 16_384
    || Object.keys(event).some(key => HEALTH_KEYS[key] !== true)
    || Object.keys(event.kernel_generation).some(key => GENERATION_KEYS[key] !== true)
  ) {
    throw new Error("production health event is invalid or privacy-unsafe");
  }
  if (event.performance != null) {
    const value = event.performance;
    if (
      !safeCount(value.samples)
      || value.samples === 0
      || !safeMetric(value.median_micros, MAXIMUM_PERFORMANCE_MICROS)
      || !safeMetric(value.p95_micros, MAXIMUM_PERFORMANCE_MICROS)
      || !safeMetric(value.p99_micros, MAXIMUM_PERFORMANCE_MICROS)
      || !safeMetric(value.maximum_micros, MAXIMUM_PERFORMANCE_MICROS)
      || value.median_micros > value.p95_micros
      || value.p95_micros > value.p99_micros
      || value.p99_micros > value.maximum_micros
      || !safeMetric(value.memory_bytes, MAXIMUM_MEMORY_BYTES)
    ) {
      throw new Error("production performance summary is invalid");
    }
  }
  return event;
}

export function evaluateReleaseHealthV1(
  health: {
    observed_sessions: number;
    observed_minutes: number;
    worker_initialization_failure_basis_points: number;
    unrecoverable_kernel_fault_basis_points: number;
    deterministic_migration_failures: number;
    cloud_save_regression_basis_points: number;
    coop_relative_regression_percent: number;
    coop_absolute_regression_basis_points: number;
    input_latency_regression_percent: number;
    crash_free_regression_basis_points: number;
    hard_stop: boolean;
  },
  ring: RolloutRingV1,
): ReleaseHealthDecisionV1 {
  const counts = [
    health.observed_sessions,
    health.observed_minutes,
    health.worker_initialization_failure_basis_points,
    health.unrecoverable_kernel_fault_basis_points,
    health.deterministic_migration_failures,
    health.cloud_save_regression_basis_points,
    health.coop_relative_regression_percent,
    health.coop_absolute_regression_basis_points,
    health.input_latency_regression_percent,
    health.crash_free_regression_basis_points,
  ];
  if (
    counts.some(value => !safeCount(value))
    || health.worker_initialization_failure_basis_points > 10_000
    || health.unrecoverable_kernel_fault_basis_points > 10_000
    || health.cloud_save_regression_basis_points > 10_000
    || health.coop_relative_regression_percent > 100
    || health.coop_absolute_regression_basis_points > 10_000
    || health.input_latency_regression_percent > 100
    || health.crash_free_regression_basis_points > 10_000
  ) {
    throw new Error("production health snapshot is invalid");
  }
  if (health.hard_stop || health.deterministic_migration_failures > 0) {
    return { decision: "HALT", reasons: ["ZERO_TOLERANCE_HARD_STOP"] };
  }
  if (health.observed_sessions < ring.minimum_sessions || health.observed_minutes < ring.minimum_duration_minutes) {
    return { decision: "PAUSE", reasons: ["SOAK_INCOMPLETE"] };
  }
  const budget = ring.required_health;
  const regressed =
    health.worker_initialization_failure_basis_points > budget.worker_initialization_failure_basis_points
    || health.unrecoverable_kernel_fault_basis_points > budget.unrecoverable_kernel_fault_basis_points
    || health.cloud_save_regression_basis_points > budget.cloud_save_regression_basis_points
    || health.coop_relative_regression_percent > budget.coop_relative_regression_percent
    || health.coop_absolute_regression_basis_points > budget.coop_absolute_regression_basis_points
    || health.input_latency_regression_percent > budget.input_latency_regression_percent
    || health.crash_free_regression_basis_points > budget.crash_free_regression_basis_points;
  return regressed ? { decision: "PAUSE", reasons: ["RATE_BUDGET_EXCEEDED"] } : { decision: "PROMOTE", reasons: [] };
}

export async function buildReleaseHealthDecisionEvidenceV1(
  health: Parameters<typeof evaluateReleaseHealthV1>[0],
  ring: RolloutRingV1,
  events: readonly ProductionHealthEventV1[],
  identity: {
    policy_hash: string;
    release_manifest_hash: string;
    window_start_ms: number;
    window_end_ms: number;
  },
): Promise<ReleaseHealthDecisionEvidenceV1> {
  if (
    !/^[0-9a-f]{64}$/u.test(identity.policy_hash)
    || !/^[0-9a-f]{64}$/u.test(identity.release_manifest_hash)
    || !safeCount(identity.window_start_ms)
    || !safeCount(identity.window_end_ms)
    || identity.window_start_ms >= identity.window_end_ms
  ) {
    throw new Error("production health decision identity is invalid");
  }
  events.forEach(validateProductionHealthEventV1);
  const aggregate = encodeCanonicalJsonV1(events);
  const inputEventAggregateHash = await sha256Hex(aggregate);
  aggregate.fill(0);
  return {
    schema_version: 1,
    policy_hash: identity.policy_hash,
    release_manifest_hash: identity.release_manifest_hash,
    input_event_aggregate_hash: inputEventAggregateHash,
    window_start_ms: identity.window_start_ms,
    window_end_ms: identity.window_end_ms,
    ...evaluateReleaseHealthV1(health, ring),
  };
}

export async function failureFingerprintV1(
  releaseId: string,
  generation: number,
  subsystem: string,
  errorClass: string,
  causalCode: string,
): Promise<string> {
  if (
    !/^[a-zA-Z0-9._:-]{1,128}$/u.test(releaseId)
    || !Number.isSafeInteger(generation)
    || generation < 1
    || !/^[A-Z_]{1,64}$/u.test(subsystem)
    || !/^[A-Z_]{1,64}$/u.test(errorClass)
    || !/^[A-Z0-9_:-]{1,128}$/u.test(causalCode)
  ) {
    throw new Error("failure fingerprint input is invalid");
  }
  const normalized = `${releaseId}:${generation}:${subsystem}:${errorClass}:${causalCode}`;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function aggregatePerformanceSummaryV1(
  observations: readonly PerformanceObservationV1[],
): BoundedPerformanceSummaryV1 {
  if (observations.length === 0 || observations.length > MAXIMUM_AGGREGATE_SAMPLES) {
    throw new Error("production performance observation count is invalid");
  }
  const elapsed = observations
    .map(value => {
      if (
        !safeMetric(value.elapsed_micros, MAXIMUM_PERFORMANCE_MICROS)
        || !safeMetric(value.memory_bytes, MAXIMUM_MEMORY_BYTES)
      ) {
        throw new Error("production performance observation is invalid");
      }
      return value.elapsed_micros;
    })
    .sort((left, right) => left - right);
  return {
    samples: elapsed.length,
    median_micros: percentile(elapsed, 50),
    p95_micros: percentile(elapsed, 95),
    p99_micros: percentile(elapsed, 99),
    maximum_micros: percentile(elapsed, 100),
    memory_bytes: Math.max(...observations.map(value => value.memory_bytes)),
  };
}

export function aggregateFailureFingerprintsV1(
  events: readonly ProductionHealthEventV1[],
): FailureFingerprintAggregateV1[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    validateProductionHealthEventV1(event);
    if (event.failure_fingerprint != null) {
      counts.set(event.failure_fingerprint, (counts.get(event.failure_fingerprint) ?? 0) + 1);
    }
  }
  return [...counts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fingerprint, count]) => ({ fingerprint, count }));
}

function safeCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function safeMetric(value: number, maximum: number): boolean {
  return safeCount(value) && value <= maximum;
}

function percentile(sorted: readonly number[], percentileValue: number): number {
  const index = Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[index];
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
