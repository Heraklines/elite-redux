/// <reference path="../../../../workers/er-telemetry/src/cloudflare-workers.d.ts" />

import { describe, expect, it } from "vitest";
import { handleM9HealthRouteV1 } from "../../../../workers/er-telemetry/src/m9-health";

describe("M9 bounded health Worker", () => {
  it("normalizes an empty D1 aggregate to zero-valued bounded health", async () => {
    const db = emptyDatabase();
    const url = new URL("https://telemetry.example/m9/health/release-empty");
    const response = await handleM9HealthRouteV1({
      request: new Request(url, { headers: { authorization: `Bearer ${"a".repeat(32)}` } }),
      url,
      authenticatedUid: null,
      env: { DB: db, M9_HEALTH_TOKEN: "a".repeat(32) },
      cors: {},
    });
    expect(response?.status).toBe(200);
    const health = await response?.json();
    expect(health).toMatchObject({
      schema_version: 1,
      release_id: "release-empty",
      observed_sessions: 0,
      worker_initialization_failure_basis_points: 0,
      unrecoverable_kernel_fault_basis_points: 0,
      deterministic_migration_failures: 0,
      cloud_save_regression_basis_points: 0,
      coop_relative_regression_percent: 0,
      coop_absolute_regression_basis_points: 0,
      input_latency_regression_percent: 0,
      crash_free_regression_basis_points: 0,
      hard_stop_fingerprints: [],
    });
  });

  it("accepts only the dedicated Worker's domain-separated preview identity", async () => {
    const inserted: unknown[][] = [];
    const db = recordingDatabase(inserted);
    const url = new URL("https://telemetry.example/m9/health/event");
    const event = {
      schema_version: 1,
      release_id: "release-2",
      kernel_generation: {
        schema_version: 1,
        session_id: "session-1",
        generation: 7,
        artifact_sha256: "1".repeat(64),
        wasm_sha256: "2".repeat(64),
        content_sha256: "3".repeat(64),
        source_git_sha: "4".repeat(40),
        worker_abi_version: 1,
        minimum_snapshot_schema: 6,
        maximum_snapshot_schema: 6,
        content_identity: "content-1",
        release_id: "release-2",
      },
      browser_class: "CHROMIUM",
      platform_class: "DESKTOP",
      event: "BOOTSTRAP_SUCCESS",
      failure_fingerprint: null,
      performance: null,
      hard_stop_rule: null,
    };
    const request = new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-er-health-idempotency-key": "preview-session-1",
        "x-er-preview-health-authorization": `Bearer ${"p".repeat(32)}`,
        "x-er-preview-account": `rust-preview:${"a".repeat(32)}`,
      },
      body: JSON.stringify(event),
    });
    const accepted = await handleM9HealthRouteV1({
      request,
      url,
      authenticatedUid: null,
      env: { DB: db, M9_PREVIEW_HEALTH_SECRET: "p".repeat(32) },
      cors: {},
    });
    expect(accepted?.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(String(inserted[0][0])).toMatch(/^[0-9a-f]{64}$/u);
    expect(String(inserted[0][0])).not.toContain("rust-preview:");

    const rejected = await handleM9HealthRouteV1({
      request: new Request(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-er-health-idempotency-key": "preview-session-2",
          "x-er-preview-health-authorization": `Bearer ${"x".repeat(32)}`,
          "x-er-preview-account": `rust-preview:${"a".repeat(32)}`,
        },
        body: JSON.stringify(event),
      }),
      url,
      authenticatedUid: null,
      env: { DB: db, M9_PREVIEW_HEALTH_SECRET: "p".repeat(32) },
      cors: {},
    });
    expect(rejected?.status).toBe(401);
  });
});

function emptyDatabase(): D1Database {
  return {
    prepare(query: string) {
      const statement: D1PreparedStatement = {
        bind() {
          return statement;
        },
        async first<T>() {
          if (!query.includes("COUNT(DISTINCT session_hash)")) {
            return null;
          }
          return {
            observed_sessions: 0,
            first_at: null,
            worker_total: null,
            worker_failures: null,
            kernel_faults: null,
            migration_failures: null,
            save_total: null,
            save_failures: null,
            coop_total: null,
            coop_failures: null,
            hard_stop_count: null,
            hard_stop_fingerprint: null,
          } as T;
        },
        async all<T>() {
          return { results: [] as T[], meta: {} };
        },
        async run<T>() {
          return { results: [] as T[], meta: {} };
        },
        async raw<T>() {
          return [] as T[];
        },
      };
      return statement;
    },
    async batch<T>() {
      return [] as D1Result<T>[];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  };
}

function recordingDatabase(inserted: unknown[][]): D1Database {
  return {
    prepare(query: string) {
      let values: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind(...bound: unknown[]) {
          values = bound;
          return statement;
        },
        async first<_T>() {
          return null;
        },
        async all<T>() {
          return { results: [] as T[], meta: {} };
        },
        async run<T>() {
          if (query.includes("INSERT OR IGNORE INTO m9_health_events")) {
            inserted.push(values);
          }
          return { results: [] as T[], meta: { changes: 1 } };
        },
        async raw<T>() {
          return [] as T[];
        },
      };
      return statement;
    },
    async batch<T>() {
      return [] as D1Result<T>[];
    },
    async exec() {
      return { count: 0, duration: 0 };
    },
  };
}
