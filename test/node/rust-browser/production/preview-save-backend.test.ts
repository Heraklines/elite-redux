/// <reference path="../../../../workers/er-save-api/src/cloudflare-workers.d.ts" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCanonicalJsonV1 } from "../../../../src/rust-browser/host/message-sequencer";
import previewWorker from "../../../../workers/er-m9-preview-save/src/index";

class SqliteD1 implements D1Database {
  readonly database = new DatabaseSync(":memory:");

  constructor() {
    const schema = readFileSync(
      resolve(import.meta.dirname, "../../../../workers/er-m9-preview-save/schema.sql"),
      "utf8",
    );
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(schema);
  }

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database, query);
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.database.exec(query);
    return { count: 0, duration: 0 };
  }
}

class SqliteD1Statement implements D1PreparedStatement {
  readonly #database: DatabaseSync;
  readonly #query: string;
  #values: SQLInputValue[] = [];

  constructor(database: DatabaseSync, query: string) {
    this.#database = database;
    this.#query = query;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.#values = values.map(toSqlValue);
    return this;
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.#database.prepare(this.#query).get(...this.#values) as Record<string, unknown> | undefined;
    if (row == null) {
      return null;
    }
    return (column == null ? row : row[column]) as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.#database.prepare(this.#query).all(...this.#values) as T[];
    return { results: rows, meta: {} };
  }

  async run<T>(): Promise<D1Result<T>> {
    const result = this.#database.prepare(this.#query).run(...this.#values);
    return { results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }

  async raw<T>(): Promise<T[]> {
    return this.#database.prepare(this.#query).all(...this.#values) as T[];
  }
}

interface TestEnv {
  RUST_PREVIEW_DB: D1Database;
  M9_RELEASES: { get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null> };
  M9_TELEMETRY: { fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> };
  M9_RELEASE_SIGNING_PRIVATE_KEY: string;
  M9_PREVIEW_INVITE_SECRET: string;
  M9_PREVIEW_ONLY_WORKER: string;
  M9_PREVIEW_HEALTH_SECRET: string;
  M9_LEGACY_MIGRATION_ENABLED: string;
  M9_PREVIEW_DATABASE_IDENTITY_HASH: string;
  M9_TELEMETRY_URL: string;
  ALLOWED_ORIGIN: string;
}

const ORIGIN = "https://m9-r1-internal.elite-redux.pages.dev";
const WORKER = "https://er-m9-preview-save.heraklines.workers.dev";
const INVITE = "preview-invite-secret-000000000000";
const DATABASE_IDENTITY = "b860cac56eb16855e2a46fc6ba2f458666f06d0ab4e04ca4c83f0e3962afd36e";

describe("M9 capability-isolated preview save Worker", () => {
  let database: SqliteD1;
  let environment: TestEnv;

  beforeEach(() => {
    database = new SqliteD1();
    environment = testEnv(database);
    vi.spyOn(globalThis.crypto.subtle, "verify").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fails closed without the sole preview D1 capability or with a legacy DB capability", async () => {
    const missing = { ...environment, RUST_PREVIEW_DB: undefined } as unknown as TestEnv;
    const missingResponse = await previewWorker.fetch(new Request(`${WORKER}/api/m9/platform-context`), missing);
    expect(missingResponse.status).toBe(503);

    const forbidden = { ...environment, DB: database } as TestEnv & { DB: D1Database };
    const forbiddenResponse = await previewWorker.fetch(new Request(`${WORKER}/api/m9/platform-context`), forbidden);
    expect(forbiddenResponse.status).toBe(503);

    const wrongIdentity = { ...environment, M9_PREVIEW_DATABASE_IDENTITY_HASH: "0".repeat(64) };
    const wrongIdentityResponse = await previewWorker.fetch(
      new Request(`${WORKER}/api/m9/platform-context`),
      wrongIdentity,
    );
    expect(wrongIdentityResponse.status).toBe(503);
  });

  it("creates a fresh domain-separated account with every legacy import disabled", async () => {
    const account = await bootstrap(environment);
    expect(account.account_id).toMatch(/^rust-preview:[0-9a-f]{32}$/u);
    expect(account.session_token).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
    expect(account.imports).toEqual({
      legacy_save: false,
      legacy_achievements: false,
      legacy_unlocks: false,
      legacy_profile: false,
    });

    const context = await previewWorker.fetch(
      authorizedRequest(`${WORKER}/api/m9/platform-context`, account.session_token),
      environment,
    );
    expect(context.status).toBe(200);
    expect(await context.json()).toMatchObject({
      pseudonymous_account_id: account.account_id,
      default_save_slot: "rust-slot-0",
      rust_save_namespace: "M9_RUST_PREVIEW_V1",
      preview_only: true,
      preview_database_identity_hash: DATABASE_IDENTITY,
    });
  });

  it("signs R1 assignments only for fresh preview accounts", async () => {
    const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
    environment.M9_RELEASE_SIGNING_PRIVATE_KEY = base64(privateKey);
    const account = await bootstrap(environment);
    const response = await previewWorker.fetch(
      authorizedRequest(`${WORKER}/api/m9/runtime-assignment`, account.session_token, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ schema_version: 1, browser_session_id: "browser-session-1" }),
      }),
      environment,
    );
    expect(response.status).toBe(200);
    const value = (await response.json()) as {
      payload: {
        release_id: string;
        authority: string;
        cohort: string;
        sticky_scope: { value: { pseudonymous_account_id: string } };
      };
    };
    expect(value.payload).toMatchObject({
      release_id: "release-1",
      authority: "RUST_CANARY",
      cohort: "R1_PREVIEW_ONLY",
      sticky_scope: { value: { pseudonymous_account_id: account.account_id } },
    });
  });

  it("rejects every legacy route and cannot resolve a legacy account token", async () => {
    const account = await bootstrap(environment);
    const legacyRoute = await previewWorker.fetch(
      authorizedRequest(`${WORKER}/savedata/session/get`, account.session_token),
      environment,
    );
    expect(legacyRoute.status).toBe(404);

    const legacyIdentity = await previewWorker.fetch(
      authorizedRequest(`${WORKER}/api/m9/platform-context`, "legacy-account-token-000000000000000000"),
      environment,
    );
    expect(legacyIdentity.status).toBe(401);
  });

  it("requires a live lease, preserves CAS, and backs up before overwrite", async () => {
    const account = await bootstrap(environment);
    const url = `${WORKER}/api/m9/rust-save?slot=rust-slot-0`;
    const missing = await previewWorker.fetch(saveRequest(url, account.session_token, "GET"), environment);
    expect(missing.status).toBe(404);

    const firstBody = canonicalText(await envelope(account.account_id, "rust-slot-0", 1, Uint8Array.of(1, 2, 3)));
    const unleased = await previewWorker.fetch(
      saveRequest(url, account.session_token, "PUT", firstBody, "*"),
      environment,
    );
    expect(unleased.status).toBe(409);

    const firstLease = await acquireLease(environment, account.session_token, "rust-slot-0", "browser-a");
    const first = await previewWorker.fetch(
      saveRequest(url, account.session_token, "PUT", firstBody, "*", firstLease.lease_token, "browser-a"),
      environment,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("x-er-save-generation")).toBe("1");
    expect(first.headers.get("x-er-preview-database-identity")).toBe(DATABASE_IDENTITY);
    expect((await first.arrayBuffer()).byteLength).toBe(0);
    const firstEtag = first.headers.get("etag") ?? "";

    const secondBody = canonicalText(await envelope(account.account_id, "rust-slot-0", 2, Uint8Array.of(4, 5)));
    const secondLease = await acquireLease(environment, account.session_token, "rust-slot-0", "browser-a");
    const stale = await previewWorker.fetch(
      saveRequest(url, account.session_token, "PUT", secondBody, '"stale"', secondLease.lease_token, "browser-a"),
      environment,
    );
    expect(stale.status).toBe(412);
    expect(backupCount(database)).toBe(0);

    const updated = await previewWorker.fetch(
      saveRequest(url, account.session_token, "PUT", secondBody, firstEtag, secondLease.lease_token, "browser-a"),
      environment,
    );
    expect(updated.status).toBe(200);
    expect(updated.headers.get("x-er-save-generation")).toBe("2");
    expect(backupCount(database)).toBe(1);
    const backup = database.database
      .prepare("SELECT data, revision FROM rust_preview_save_backups WHERE account_id = ? AND slot = ?")
      .get(account.account_id, "rust-slot-0") as { data: string; revision: number };
    expect(backup).toEqual({ data: firstBody, revision: 1 });
  });

  it("rejects expired leases and lets exactly one concurrent first write commit", async () => {
    const account = await bootstrap(environment);
    const slot = "rust-slot-1";
    const url = `${WORKER}/api/m9/rust-save?slot=${slot}`;
    const lease = await acquireLease(environment, account.session_token, slot, "browser-race");
    database.database
      .prepare("UPDATE rust_preview_save_leases SET expires_at = 0 WHERE account_id = ? AND slot = ?")
      .run(account.account_id, slot);
    const body = canonicalText(await envelope(account.account_id, slot, 1, Uint8Array.of(8)));
    const expired = await previewWorker.fetch(
      saveRequest(url, account.session_token, "PUT", body, "*", lease.lease_token, "browser-race"),
      environment,
    );
    expect(expired.status).toBe(409);

    const live = await acquireLease(environment, account.session_token, slot, "browser-race");
    const [left, right] = await Promise.all([
      previewWorker.fetch(
        saveRequest(url, account.session_token, "PUT", body, "*", live.lease_token, "browser-race"),
        environment,
      ),
      previewWorker.fetch(
        saveRequest(url, account.session_token, "PUT", body, "*", live.lease_token, "browser-race"),
        environment,
      ),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const committed = database.database
      .prepare("SELECT COUNT(*) AS count FROM rust_preview_saves WHERE account_id = ? AND slot = ?")
      .get(account.account_id, slot) as { count: number };
    expect(committed.count).toBe(1);
  });

  it("rejects cross-release identity and leaves the old value complete across retry", async () => {
    const account = await bootstrap(environment);
    const slot = "rust-slot-2";
    const url = `${WORKER}/api/m9/rust-save?slot=${slot}`;
    const lease = await acquireLease(environment, account.session_token, slot, "browser-restart");
    const body = await envelope(account.account_id, slot, 1, Uint8Array.of(7, 7));
    const wrong = canonicalText({
      ...body,
      mechanical_identity: { ...body.mechanical_identity, active_model_identity: "wrong-model" },
    });
    const rejected = await previewWorker.fetch(
      saveRequest(url, account.session_token, "PUT", wrong, "*", lease.lease_token, "browser-restart"),
      environment,
    );
    expect(rejected.status).toBe(400);
    expect(saveCount(database)).toBe(0);

    const valid = canonicalText(body);
    const committed = await previewWorker.fetch(
      saveRequest(url, account.session_token, "PUT", valid, "*", lease.lease_token, "browser-restart"),
      environment,
    );
    expect(committed.status).toBe(200);
    const stored = database.database
      .prepare("SELECT data, revision FROM rust_preview_saves WHERE account_id = ? AND slot = ?")
      .get(account.account_id, slot) as { data: string; revision: number };
    expect(stored).toEqual({ data: valid, revision: 1 });
  });

  it("forwards health events without exposing the browser preview token", async () => {
    const account = await bootstrap(environment);
    const forwarded: Array<{ input: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        forwarded.push({ input: String(input), ...(init == null ? {} : { init }) });
        if (ArrayBuffer.isView(init?.body)) {
          structuredClone(init.body.buffer, { transfer: [init.body.buffer] });
        } else if (init?.body instanceof ArrayBuffer) {
          structuredClone(init.body, { transfer: [init.body] });
        }
        return new Response(null, { status: 204 });
      }),
    );
    const response = await previewWorker.fetch(
      authorizedRequest(`${WORKER}/api/m9/health/event`, account.session_token, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-er-health-idempotency-key": "preview-health-1",
        },
        body: JSON.stringify({ schema_version: 1, event: "BOOTSTRAP_SUCCESS" }),
      }),
      environment,
    );
    expect(response.status).toBe(204);
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0].input).toBe("https://er-telemetry.heraklines.workers.dev/m9/health/event");
    const headers = new Headers(forwarded[0].init?.headers);
    expect(headers.get("x-er-preview-health-authorization")).toBe(`Bearer ${"h".repeat(32)}`);
    expect(headers.get("x-er-preview-account")).toBe(account.account_id);
    expect(headers.get("authorization")).toBeNull();
    expect(JSON.stringify(forwarded[0])).not.toContain(account.session_token);
  });
});

function testEnv(database: D1Database): TestEnv {
  const manifest = canonicalText({
    envelope_version: 1,
    key_id: "m9-prod-2026-01",
    payload: {
      release_id: "release-1",
      channel: "INTERNAL",
      release_epoch: 1,
      save_schema: 1,
      authority_protocol: "er-coop-47",
      mechanical_identity: {
        schema_version: 1,
        mechanics_sha256: "a".repeat(64),
        content_hash: "content-1",
        authority_protocol: "er-coop-47",
        active_model_identity: "model-1",
      },
    },
    signature: Array.from({ length: 64 }, () => 1),
  });
  const policy = canonicalText({
    envelope_version: 1,
    key_id: "m9-prod-2026-01",
    payload: {
      active_ring: "R1",
      candidate_release: "release-1",
      policy_version: 1,
      expires_at: Date.now() + 86_400_000,
    },
    signature: Array.from({ length: 64 }, () => 2),
  });
  return {
    RUST_PREVIEW_DB: database,
    M9_RELEASES: {
      async get(key: string) {
        const value = key === "manifests/release-1.json" ? manifest : key === "policies/current.json" ? policy : null;
        if (value == null) {
          return null;
        }
        return {
          async arrayBuffer() {
            return new TextEncoder().encode(value).buffer;
          },
        };
      },
    },
    M9_TELEMETRY: {
      fetch: (input, init) => fetch(input, init),
    },
    M9_RELEASE_SIGNING_PRIVATE_KEY: "u".repeat(64),
    M9_PREVIEW_INVITE_SECRET: INVITE,
    M9_PREVIEW_ONLY_WORKER: "true",
    M9_PREVIEW_HEALTH_SECRET: "h".repeat(32),
    M9_LEGACY_MIGRATION_ENABLED: "false",
    M9_PREVIEW_DATABASE_IDENTITY_HASH: DATABASE_IDENTITY,
    M9_TELEMETRY_URL: "https://er-telemetry.heraklines.workers.dev/m9/health/event",
    ALLOWED_ORIGIN: ORIGIN,
  };
}

async function bootstrap(environment: TestEnv) {
  const response = await previewWorker.fetch(
    new Request(`${WORKER}/api/m9/preview-account`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${INVITE}`,
        "content-type": "application/json",
        origin: ORIGIN,
      },
      body: JSON.stringify({ schema_version: 1, browser_instance_id: `test-${crypto.randomUUID()}` }),
    }),
    environment,
  );
  expect(response.status).toBe(201);
  return (await response.json()) as {
    account_id: string;
    session_token: string;
    imports: Record<string, boolean>;
  };
}

async function acquireLease(
  environment: TestEnv,
  token: string,
  slot: string,
  holder: string,
): Promise<{ lease_token: string }> {
  const response = await previewWorker.fetch(
    authorizedRequest(`${WORKER}/api/m9/lease`, token, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema_version: 1, slot, holder, duration_ms: 10_000 }),
    }),
    environment,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { lease_token: string };
}

function authorizedRequest(url: string, token: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("origin", ORIGIN);
  return new Request(url, { ...init, headers });
}

function saveRequest(
  url: string,
  token: string,
  method: "GET" | "PUT",
  body?: string,
  etag?: string,
  leaseToken?: string,
  holder?: string,
): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    origin: ORIGIN,
    "x-er-release": "release-1",
    "x-er-save-schema": "1",
    "x-er-save-namespace": "M9_RUST_PREVIEW_V1",
    ...(etag == null ? {} : { "if-match": etag }),
    ...(leaseToken == null ? {} : { "x-er-preview-lease": leaseToken }),
    ...(holder == null ? {} : { "x-er-preview-holder": holder }),
  };
  return new Request(url, { method, headers, ...(body == null ? {} : { body }) });
}

async function envelope(accountId: string, slot: string, generation: number, payload: Uint8Array) {
  const payloadHash = await hash(payload);
  return {
    envelope_version: 2,
    save_namespace: "M9_RUST_PREVIEW_V1",
    slot,
    pseudonymous_account_id: accountId,
    cloud_generation: generation,
    origin_runtime: "RUST",
    release_id: "release-1",
    kernel_generation: 1,
    mechanical_identity: {
      schema_version: 1,
      mechanics_sha256: "a".repeat(64),
      content_hash: "content-1",
      authority_protocol: "er-coop-47",
      active_model_identity: "model-1",
    },
    authority_protocol: "er-coop-47",
    save_schema: 1,
    content_hash: "content-1",
    payload_hash: payloadHash,
    payload: Array.from(payload),
    migration: null,
    legacy_backup: null,
  };
}

function canonicalText(value: unknown): string {
  return new TextDecoder().decode(encodeCanonicalJsonV1(value));
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function toSqlValue(value: unknown): SQLInputValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "bigint"
    || value instanceof Uint8Array
  ) {
    return value;
  }
  throw new Error("preview test D1 binding received an unsupported value");
}

function backupCount(database: SqliteD1): number {
  return countFromQuery(database, "SELECT COUNT(*) AS count FROM rust_preview_save_backups");
}

function saveCount(database: SqliteD1): number {
  return countFromQuery(database, "SELECT COUNT(*) AS count FROM rust_preview_saves");
}

function countFromQuery(database: SqliteD1, query: string): number {
  const value: unknown = database.database.prepare(query).get();
  if (value == null || typeof value !== "object" || !("count" in value) || typeof value.count !== "number") {
    throw new Error("preview test count query returned an invalid row");
  }
  return value.count;
}
