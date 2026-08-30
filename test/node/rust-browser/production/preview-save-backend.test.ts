/// <reference path="../../../../workers/er-save-api/src/cloudflare-workers.d.ts" />

import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeCanonicalJsonV1 } from "../../../../src/rust-browser/host/message-sequencer";
import { handleM9RustPreviewSave } from "../../../../workers/er-save-api/src/m9-production";

interface PreviewRow {
  account_id: string;
  slot: string;
  release_id: string;
  kernel_generation: number;
  content_identity: string;
  active_model_identity: string;
  mechanics_sha256: string;
  save_schema: number;
  payload_sha256: string;
  data: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

class PreviewDatabase implements D1Database {
  readonly rows = new Map<string, PreviewRow>();
  readonly backups: PreviewRow[] = [];

  prepare(query: string): D1PreparedStatement {
    return new PreviewStatement(this, query);
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const results: D1Result<T>[] = [];
    for (const statement of statements) {
      results.push(await statement.run<T>());
    }
    return results;
  }

  async exec(): Promise<{ count: number; duration: number }> {
    return { count: 0, duration: 0 };
  }
}

class PreviewStatement implements D1PreparedStatement {
  readonly #database: PreviewDatabase;
  readonly #query: string;
  #values: unknown[] = [];

  constructor(database: PreviewDatabase, query: string) {
    this.#database = database;
    this.#query = query;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    this.#values = values;
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (!this.#query.includes("FROM rust_preview_saves")) {
      return null;
    }
    return (this.#database.rows.get(key(String(this.#values[0]), String(this.#values[1]))) ?? null) as T | null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return { results: [], meta: {} };
  }

  async run<T>(): Promise<D1Result<T>> {
    if (this.#query.includes("CREATE TABLE")) {
      return result<T>(0);
    }
    if (this.#query.includes("INSERT INTO rust_preview_saves")) {
      const row = rowFromInsert(this.#values);
      const rowKey = key(row.account_id, row.slot);
      if (this.#database.rows.has(rowKey)) {
        return result<T>(0);
      }
      this.#database.rows.set(rowKey, row);
      return result<T>(1);
    }
    if (this.#query.includes("INSERT INTO rust_preview_save_backups")) {
      const row = rowFromBackup(this.#values);
      if (
        !this.#database.backups.some(
          value => value.account_id === row.account_id && value.slot === row.slot && value.revision === row.revision,
        )
      ) {
        this.#database.backups.push(row);
      }
      return result<T>(1);
    }
    if (this.#query.includes("UPDATE rust_preview_saves")) {
      const accountId = String(this.#values[10]);
      const slot = String(this.#values[11]);
      const existing = this.#database.rows.get(key(accountId, slot));
      if (existing == null || existing.revision !== this.#values[12] || existing.payload_sha256 !== this.#values[13]) {
        return result<T>(0);
      }
      this.#database.rows.set(key(accountId, slot), {
        ...existing,
        release_id: String(this.#values[0]),
        kernel_generation: Number(this.#values[1]),
        content_identity: String(this.#values[2]),
        active_model_identity: String(this.#values[3]),
        mechanics_sha256: String(this.#values[4]),
        save_schema: Number(this.#values[5]),
        payload_sha256: String(this.#values[6]),
        data: String(this.#values[7]),
        revision: Number(this.#values[8]),
        updated_at: Number(this.#values[9]),
      });
      return result<T>(1);
    }
    throw new Error(`unexpected preview D1 statement: ${this.#query}`);
  }

  async raw<T>(): Promise<T[]> {
    return [];
  }
}

class LegacyDatabase implements D1Database {
  prepare(): D1PreparedStatement {
    throw new Error("legacy DB must never be accessed by the Rust preview save route");
  }
  async batch<T>(): Promise<D1Result<T>[]> {
    throw new Error("legacy DB must never be accessed by the Rust preview save route");
  }
  async exec(): Promise<{ count: number; duration: number }> {
    throw new Error("legacy DB must never be accessed by the Rust preview save route");
  }
}

describe("M9 isolated Rust preview save backend", () => {
  afterEach(() => vi.restoreAllMocks());

  it("starts absent without legacy fallback and preserves CAS backups", async () => {
    vi.spyOn(globalThis.crypto.subtle, "verify").mockResolvedValue(true);
    const preview = new PreviewDatabase();
    const environment = env(preview);
    const accountId = await account(7);
    const getUrl = new URL("https://save.example/m9/rust-save?slot=rust-slot-0");
    const missing = await handleM9RustPreviewSave(
      request(getUrl, "GET"),
      getUrl,
      { uid: 7, u: "preview" },
      environment,
      {},
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-er-save-namespace")).toBe("M9_RUST_PREVIEW_V1");

    const firstEnvelope = await envelope(accountId, 1, Uint8Array.of(1, 2, 3));
    const firstBytes = canonicalText(firstEnvelope);
    const first = await handleM9RustPreviewSave(
      request(getUrl, "PUT", firstBytes, "*"),
      getUrl,
      { uid: 7, u: "preview" },
      environment,
      {},
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("x-er-save-generation")).toBe("1");
    const firstEtag = first.headers.get("etag");
    expect(firstEtag).not.toBeNull();

    const secondEnvelope = await envelope(accountId, 2, Uint8Array.of(4, 5));
    const secondBytes = canonicalText(secondEnvelope);
    const stale = await handleM9RustPreviewSave(
      request(getUrl, "PUT", secondBytes, '"stale"'),
      getUrl,
      { uid: 7, u: "preview" },
      environment,
      {},
    );
    expect(stale.status).toBe(412);
    expect(preview.backups).toHaveLength(0);

    const updated = await handleM9RustPreviewSave(
      request(getUrl, "PUT", secondBytes, firstEtag ?? ""),
      getUrl,
      { uid: 7, u: "preview" },
      environment,
      {},
    );
    expect(updated.status).toBe(200);
    expect(updated.headers.get("x-er-save-generation")).toBe("2");
    expect(preview.backups).toHaveLength(1);
    expect(preview.backups[0].data).toBe(firstBytes);
  });

  it("rejects legacy or cross-namespace envelopes without writing", async () => {
    vi.spyOn(globalThis.crypto.subtle, "verify").mockResolvedValue(true);
    const preview = new PreviewDatabase();
    const environment = env(preview);
    const accountId = await account(9);
    const url = new URL("https://save.example/m9/rust-save?slot=rust-slot-0");
    const value = await envelope(accountId, 1, Uint8Array.of(9));
    const legacy = { ...value, save_namespace: "LEGACY_PRODUCTION_V1", origin_runtime: "LEGACY_TYPE_SCRIPT" };
    const response = await handleM9RustPreviewSave(
      request(url, "PUT", canonicalText(legacy), "*"),
      url,
      { uid: 9, u: "preview" },
      environment,
      {},
    );
    expect(response.status).toBe(400);
    expect(preview.rows.size).toBe(0);
    const migrated = {
      ...value,
      migration: {
        schema_version: 1,
        source_runtime: "LEGACY_TYPE_SCRIPT",
        source_schema: 1,
        source_hash: "b".repeat(64),
        target_runtime: "RUST",
        target_schema: 1,
        target_hash: value.payload_hash,
        migrator_id: "disabled-migrator",
        validation_digest: "c".repeat(64),
      },
      legacy_backup: "legacy-backup",
    };
    const migratedResponse = await handleM9RustPreviewSave(
      request(url, "PUT", canonicalText(migrated), "*"),
      url,
      { uid: 9, u: "preview" },
      environment,
      {},
    );
    expect(migratedResponse.status).toBe(400);
    expect(preview.rows.size).toBe(0);
    const wrongMechanics = {
      ...value,
      mechanical_identity: { ...value.mechanical_identity, active_model_identity: "model-other" },
    };
    const wrongMechanicsResponse = await handleM9RustPreviewSave(
      request(url, "PUT", canonicalText(wrongMechanics), "*"),
      url,
      { uid: 9, u: "preview" },
      environment,
      {},
    );
    expect(wrongMechanicsResponse.status).toBe(400);
    expect(preview.rows.size).toBe(0);
  });
});

function env(preview: D1Database) {
  const manifest = canonicalText({
    envelope_version: 1,
    key_id: "m9-prod-2026-01",
    payload: {
      release_id: "release-1",
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
  return {
    DB: new LegacyDatabase(),
    M9_RUST_SAVES: preview,
    M9_RELEASES: {
      async get() {
        return {
          async arrayBuffer() {
            return new TextEncoder().encode(manifest).buffer;
          },
          async text() {
            return manifest;
          },
        };
      },
    },
    M9_RELEASE_SIGNING_PRIVATE_KEY: "unused",
  };
}

function request(url: URL, method: "GET" | "PUT", body?: string, etag?: string): Request {
  return new Request(url, {
    method,
    headers: {
      "x-er-release": "release-1",
      "x-er-save-schema": "1",
      "x-er-save-namespace": "M9_RUST_PREVIEW_V1",
      ...(etag == null ? {} : { "if-match": etag }),
    },
    ...(body == null ? {} : { body }),
  });
}

async function envelope(accountId: string, generation: number, payload: Uint8Array) {
  const payloadHash = await hash(payload);
  return {
    envelope_version: 2,
    save_namespace: "M9_RUST_PREVIEW_V1",
    slot: "rust-slot-0",
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

async function account(uid: number): Promise<string> {
  return `account-${(await hash(new TextEncoder().encode(`m9-account:${uid}`))).slice(0, 32)}`;
}

async function hash(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalText(value: unknown): string {
  return new TextDecoder().decode(encodeCanonicalJsonV1(value));
}

function key(accountId: string, slot: string): string {
  return `${accountId}:${slot}`;
}

function result<T>(changes: number): D1Result<T> {
  return { results: [], meta: { changes } };
}

function rowFromInsert(values: unknown[]): PreviewRow {
  return {
    account_id: String(values[0]),
    slot: String(values[1]),
    release_id: String(values[2]),
    kernel_generation: Number(values[3]),
    content_identity: String(values[4]),
    active_model_identity: String(values[5]),
    mechanics_sha256: String(values[6]),
    save_schema: Number(values[7]),
    payload_sha256: String(values[8]),
    data: String(values[9]),
    revision: Number(values[10]),
    created_at: Number(values[11]),
    updated_at: Number(values[12]),
  };
}

function rowFromBackup(values: unknown[]): PreviewRow {
  return {
    account_id: String(values[0]),
    slot: String(values[1]),
    revision: Number(values[2]),
    release_id: String(values[3]),
    kernel_generation: Number(values[4]),
    content_identity: String(values[5]),
    active_model_identity: String(values[6]),
    mechanics_sha256: String(values[7]),
    save_schema: Number(values[8]),
    payload_sha256: String(values[9]),
    data: String(values[10]),
    created_at: Number(values[11]),
    updated_at: Number(values[12]),
  };
}
