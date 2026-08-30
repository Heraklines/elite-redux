const MAXIMUM_EVENT_BYTES = 16_384;
const MAXIMUM_PERFORMANCE_ROWS = 10_000;
const RELEASE_ID = /^[a-zA-Z0-9._:-]{1,128}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const HEALTH_KINDS: Readonly<Record<string, true>> = {
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
const HARD_STOP_RULES: Readonly<Record<string, true>> = {
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
const TOP_LEVEL_KEYS: Readonly<Record<string, true>> = {
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

export interface M9HealthEnvV1 {
  DB: D1Database;
  M9_HEALTH_TOKEN?: string;
  M9_BASELINE_CLOUD_SAVE_FAILURE_BP?: string;
  M9_BASELINE_COOP_FAILURE_BP?: string;
  M9_BASELINE_INPUT_P95_MICROS?: string;
  M9_BASELINE_CRASH_FAILURE_BP?: string;
}

interface M9HealthEventV1 {
  schema_version: 1;
  release_id: string;
  kernel_generation: {
    schema_version: 1;
    session_id: string;
    generation: number;
    artifact_sha256: string;
    wasm_sha256: string;
    content_sha256: string;
    source_git_sha: string;
    worker_abi_version: 1;
    minimum_snapshot_schema: number;
    maximum_snapshot_schema: number;
    content_identity: string;
    release_id: string;
  };
  browser_class: string;
  platform_class: string;
  event: string;
  failure_fingerprint: string | null;
  performance: PerformanceSummaryV1 | null;
  hard_stop_rule: string | null;
}

interface PerformanceSummaryV1 {
  samples: number;
  median_micros: number;
  p95_micros: number;
  p99_micros: number;
  maximum_micros: number;
  memory_bytes: number;
}

interface AggregateRow {
  observed_sessions: number;
  first_at: number | null;
  worker_total: number | null;
  worker_failures: number | null;
  kernel_faults: number | null;
  migration_failures: number | null;
  save_total: number | null;
  save_failures: number | null;
  coop_total: number | null;
  coop_failures: number | null;
  hard_stop_count: number | null;
  hard_stop_fingerprint: string | null;
}

export async function handleM9HealthRouteV1(options: {
  request: Request;
  url: URL;
  authenticatedUid: number | null;
  env: M9HealthEnvV1;
  cors: Record<string, string>;
}): Promise<Response | null> {
  if (options.url.pathname === "/m9/health/event" && options.request.method === "POST") {
    return ingestEvent(options.request, options.authenticatedUid, options.env, options.cors);
  }
  const match = /^\/m9\/health\/([a-zA-Z0-9._:-]{1,128})$/u.exec(options.url.pathname);
  if (match != null && options.request.method === "GET") {
    return readAggregate(options.request, match[1], options.env, options.cors);
  }
  return null;
}

async function ingestEvent(
  request: Request,
  uid: number | null,
  env: M9HealthEnvV1,
  cors: Record<string, string>,
): Promise<Response> {
  if (uid == null) {
    return response({ error: "unauthorized" }, 401, cors);
  }
  const idempotencyKey = request.headers.get("x-er-health-idempotency-key") ?? "";
  if (!/^[a-zA-Z0-9._:-]{1,128}$/u.test(idempotencyKey)) {
    return response({ error: "invalid idempotency key" }, 400, cors);
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAXIMUM_EVENT_BYTES) {
    return response({ error: "event too large" }, 413, cors);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_EVENT_BYTES) {
    return response({ error: "event too large" }, 413, cors);
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return response({ error: "invalid event" }, 400, cors);
  }
  const event = parseEvent(value);
  if (event == null) {
    return response({ error: "invalid event" }, 400, cors);
  }
  await ensureHealthTable(env.DB);
  const sessionHash = await sha256(`m9-health-session:${uid}:${event.kernel_generation.session_id}`);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO m9_health_events (
       session_hash, idempotency_key, release_id, kernel_generation, event_kind,
       failure_fingerprint, hard_stop_rule, performance_json, recorded_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      sessionHash,
      idempotencyKey,
      event.release_id,
      event.kernel_generation.generation,
      event.event,
      event.failure_fingerprint,
      event.hard_stop_rule,
      event.performance == null ? null : JSON.stringify(event.performance),
      Date.now(),
    )
    .run();
  return new Response(null, { status: 204, headers: cors });
}

async function readAggregate(
  request: Request,
  releaseId: string,
  env: M9HealthEnvV1,
  cors: Record<string, string>,
): Promise<Response> {
  if (!RELEASE_ID.test(releaseId) || !constantTimeToken(request.headers.get("authorization"), env.M9_HEALTH_TOKEN)) {
    return response({ error: "unauthorized" }, 401, cors);
  }
  await ensureHealthTable(env.DB);
  const aggregate = await env.DB.prepare(
    `SELECT
       COUNT(DISTINCT session_hash) AS observed_sessions,
       MIN(recorded_at) AS first_at,
       SUM(CASE WHEN event_kind = 'WORKER_INITIALIZATION' THEN 1 ELSE 0 END) AS worker_total,
       SUM(CASE WHEN event_kind = 'WORKER_INITIALIZATION' AND failure_fingerprint IS NOT NULL THEN 1 ELSE 0 END) AS worker_failures,
       SUM(CASE WHEN event_kind = 'KERNEL_FAULT' THEN 1 ELSE 0 END) AS kernel_faults,
       SUM(CASE WHEN hard_stop_rule = 'DETERMINISTIC_MIGRATION_FAILURE' THEN 1 ELSE 0 END) AS migration_failures,
       SUM(CASE WHEN event_kind IN ('SAVE_READ', 'SAVE_WRITE') THEN 1 ELSE 0 END) AS save_total,
       SUM(CASE WHEN event_kind IN ('SAVE_READ', 'SAVE_WRITE') AND failure_fingerprint IS NOT NULL THEN 1 ELSE 0 END) AS save_failures,
       SUM(CASE WHEN event_kind IN ('PROTOCOL_PAIRING', 'RECONNECT_RECOVERY') THEN 1 ELSE 0 END) AS coop_total,
       SUM(CASE WHEN event_kind IN ('PROTOCOL_PAIRING', 'RECONNECT_RECOVERY') AND failure_fingerprint IS NOT NULL THEN 1 ELSE 0 END) AS coop_failures,
       SUM(CASE WHEN hard_stop_rule IS NOT NULL THEN 1 ELSE 0 END) AS hard_stop_count,
       MIN(CASE WHEN hard_stop_rule IS NOT NULL THEN failure_fingerprint ELSE NULL END) AS hard_stop_fingerprint
     FROM m9_health_events WHERE release_id = ?`,
  )
    .bind(releaseId)
    .first<AggregateRow>();
  if (aggregate == null) {
    return response({ error: "health query failed" }, 503, cors);
  }
  const normalized = {
    ...aggregate,
    worker_total: aggregate.worker_total ?? 0,
    worker_failures: aggregate.worker_failures ?? 0,
    kernel_faults: aggregate.kernel_faults ?? 0,
    migration_failures: aggregate.migration_failures ?? 0,
    save_total: aggregate.save_total ?? 0,
    save_failures: aggregate.save_failures ?? 0,
    coop_total: aggregate.coop_total ?? 0,
    coop_failures: aggregate.coop_failures ?? 0,
    hard_stop_count: aggregate.hard_stop_count ?? 0,
  };
  const performanceRows = await env.DB.prepare(
    `SELECT performance_json FROM m9_health_events
     WHERE release_id = ? AND performance_json IS NOT NULL
     ORDER BY recorded_at ASC LIMIT ?`,
  )
    .bind(releaseId, MAXIMUM_PERFORMANCE_ROWS)
    .all<{ performance_json: string }>();
  const p95 = performanceRows.results
    .map(row => parsePerformance(row.performance_json)?.p95_micros ?? 0)
    .sort((left, right) => left - right);

  const currentCloud = basisPoints(normalized.save_failures, normalized.save_total);
  const currentCoop = basisPoints(normalized.coop_failures, normalized.coop_total);
  const currentCrash = basisPoints(normalized.kernel_faults, normalized.observed_sessions);
  const baselineCloud = environmentCount(env.M9_BASELINE_CLOUD_SAVE_FAILURE_BP, 10_000);
  const baselineCoop = environmentCount(env.M9_BASELINE_COOP_FAILURE_BP, 10_000);
  const baselineInput = environmentCount(env.M9_BASELINE_INPUT_P95_MICROS, Number.MAX_SAFE_INTEGER);
  const baselineCrash = environmentCount(env.M9_BASELINE_CRASH_FAILURE_BP, 10_000);
  const currentInput = p95.length === 0 ? 0 : p95[Math.ceil(p95.length * 0.95) - 1];
  const coopDelta = Math.max(0, currentCoop - baselineCoop);
  const inputRegression =
    baselineInput === 0 ? (currentInput === 0 ? 0 : 100) : percentDelta(currentInput, baselineInput);
  const windowEndMs = Date.now();
  const windowStartMs = aggregate.first_at ?? Math.max(0, windowEndMs - 1);
  const inputEventAggregateHash = await sha256(
    JSON.stringify({
      schema_version: 1,
      release_id: releaseId,
      aggregate: normalized,
      performance_p95_micros: p95,
      window_start_ms: windowStartMs,
      window_end_ms: windowEndMs,
    }),
  );

  return response(
    {
      schema_version: 1,
      release_id: releaseId,
      observed_sessions: normalized.observed_sessions,
      observed_minutes: Math.floor((windowEndMs - windowStartMs) / 60_000),
      worker_initialization_failure_basis_points: basisPoints(normalized.worker_failures, normalized.worker_total),
      unrecoverable_kernel_fault_basis_points: currentCrash,
      deterministic_migration_failures: normalized.migration_failures,
      cloud_save_regression_basis_points: Math.max(0, currentCloud - baselineCloud),
      coop_relative_regression_percent:
        baselineCoop === 0 ? (currentCoop === 0 ? 0 : 100) : percentDelta(currentCoop, baselineCoop),
      coop_absolute_regression_basis_points: coopDelta,
      input_latency_regression_percent: inputRegression,
      crash_free_regression_basis_points: Math.max(0, currentCrash - baselineCrash),
      hard_stop_fingerprints:
        normalized.hard_stop_count > 0 && normalized.hard_stop_fingerprint != null
          ? [normalized.hard_stop_fingerprint]
          : [],
      input_event_aggregate_hash: inputEventAggregateHash,
      window_start_ms: windowStartMs,
      window_end_ms: windowEndMs,
    },
    200,
    cors,
  );
}

async function ensureHealthTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS m9_health_events (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       session_hash TEXT NOT NULL,
       idempotency_key TEXT NOT NULL,
       release_id TEXT NOT NULL,
       kernel_generation INTEGER NOT NULL,
       event_kind TEXT NOT NULL,
       failure_fingerprint TEXT,
       hard_stop_rule TEXT,
       performance_json TEXT,
       recorded_at INTEGER NOT NULL,
       UNIQUE(session_hash, idempotency_key)
     )`,
    )
    .run();
  await db
    .prepare("CREATE INDEX IF NOT EXISTS idx_m9_health_release_time ON m9_health_events (release_id, recorded_at)")
    .run();
}

function parseEvent(value: unknown): M9HealthEventV1 | null {
  if (!record(value) || Object.keys(value).some(key => TOP_LEVEL_KEYS[key] !== true)) {
    return null;
  }
  const generation = value.kernel_generation;
  if (!record(generation) || Object.keys(generation).some(key => GENERATION_KEYS[key] !== true)) {
    return null;
  }
  const performance = value.performance == null ? null : parsePerformance(value.performance);
  if (value.performance != null && performance == null) {
    return null;
  }
  if (
    value.schema_version !== 1
    || typeof value.release_id !== "string"
    || !RELEASE_ID.test(value.release_id)
    || generation.schema_version !== 1
    || typeof generation.session_id !== "string"
    || !RELEASE_ID.test(generation.session_id)
    || !safeInteger(generation.generation, 1, Number.MAX_SAFE_INTEGER)
    || !SHA256.test(String(generation.artifact_sha256))
    || !SHA256.test(String(generation.wasm_sha256))
    || !SHA256.test(String(generation.content_sha256))
    || !/^[0-9a-f]{40}$/u.test(String(generation.source_git_sha))
    || generation.worker_abi_version !== 1
    || !safeInteger(generation.minimum_snapshot_schema, 1, Number.MAX_SAFE_INTEGER)
    || !safeInteger(
      generation.maximum_snapshot_schema,
      Number(generation.minimum_snapshot_schema),
      Number.MAX_SAFE_INTEGER,
    )
    || typeof generation.content_identity !== "string"
    || !RELEASE_ID.test(generation.content_identity)
    || generation.release_id !== value.release_id
    || !["CHROMIUM", "FIREFOX", "WEBKIT", "UNKNOWN"].includes(String(value.browser_class))
    || !["DESKTOP", "MOBILE", "TABLET", "UNKNOWN"].includes(String(value.platform_class))
    || HEALTH_KINDS[String(value.event)] !== true
    || (value.failure_fingerprint != null && !SHA256.test(String(value.failure_fingerprint)))
    || (value.hard_stop_rule != null && HARD_STOP_RULES[String(value.hard_stop_rule)] !== true)
    || (value.hard_stop_rule != null && value.failure_fingerprint == null)
  ) {
    return null;
  }
  return value as unknown as M9HealthEventV1;
}

function parsePerformance(value: unknown): PerformanceSummaryV1 | null {
  if (!record(value)) {
    return null;
  }
  const keys = ["samples", "median_micros", "p95_micros", "p99_micros", "maximum_micros", "memory_bytes"];
  if (Object.keys(value).some(key => !keys.includes(key))) {
    return null;
  }
  const summary = value as unknown as PerformanceSummaryV1;
  if (
    !safeInteger(summary.samples, 1, MAXIMUM_PERFORMANCE_ROWS)
    || !safeInteger(summary.median_micros, 0, 86_400_000_000)
    || !safeInteger(summary.p95_micros, summary.median_micros, 86_400_000_000)
    || !safeInteger(summary.p99_micros, summary.p95_micros, 86_400_000_000)
    || !safeInteger(summary.maximum_micros, summary.p99_micros, 86_400_000_000)
    || !safeInteger(summary.memory_bytes, 0, 1_099_511_627_776)
  ) {
    return null;
  }
  return summary;
}

function response(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors },
  });
}

function basisPoints(failures: number, total: number): number {
  return total <= 0 ? 0 : Math.min(10_000, Math.ceil((failures * 10_000) / total));
}

function percentDelta(current: number, baseline: number): number {
  return Math.min(100, Math.max(0, Math.ceil(((current - baseline) * 100) / baseline)));
}

function environmentCount(value: string | undefined, maximum: number): number {
  if (value == null || value.length === 0) {
    return 0;
  }
  const parsed = Number(value);
  if (!safeInteger(parsed, 0, maximum)) {
    throw new Error("invalid M9 health baseline");
  }
  return parsed;
}

function constantTimeToken(header: string | null, expected: string | undefined): boolean {
  const actual = header?.startsWith("Bearer ") === true ? header.slice(7) : "";
  if (expected == null || expected.length < 32 || actual.length !== expected.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function safeInteger(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
