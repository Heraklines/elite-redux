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
      };
      return statement;
    },
  };
}
