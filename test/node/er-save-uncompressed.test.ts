/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Save compression was originally added to the er-save-api worker ONLY to keep the
// D1 under the free-tier 500MB/db cap (gzip ~12x, stored as "GZ1:" + base64(gzip)).
// The account is now on the paid plan (10GB/db; er-saves at ~4%), so saves are stored
// UNCOMPRESSED going forward. This pins the directive contract:
//   1. a NEW system save is stored uncompressed (plaintext JSON, no "GZ1:" prefix),
//   2. an existing LEGACY "GZ1:" compressed row still LOADS (back-compat read),
//   3. the migration is LAZY — a legacy row's next write re-stores it uncompressed,
//   4. a tampered/truncated "GZ1:" blob fails GRACEFULLY (the existing corrupted-save
//      handling: HTTP 500, never a crash or a garbage 200), so the client keeps its
//      in-memory copy.

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import saveWorker from "../../workers/er-save-api/src/index";

interface D1ResultLike {
  success: boolean;
  results: Record<string, unknown>[];
  meta: { changes: number; last_row_id?: number | bigint };
}

class SqliteD1Statement {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly bindings: SQLInputValue[] = [],
  ) {}

  public bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.database, this.sql, values as SQLInputValue[]);
  }

  public async first<T>(): Promise<T | null> {
    return (this.statement().get(...this.bindings) as unknown as T | undefined) ?? null;
  }

  public async all<T extends Record<string, unknown>>(): Promise<D1ResultLike & { results: T[] }> {
    return { success: true, results: this.statement().all(...this.bindings) as unknown as T[], meta: { changes: 0 } };
  }

  public async run(): Promise<D1ResultLike> {
    return this.execute();
  }

  public execute(): D1ResultLike {
    const statement = this.statement();
    if (statement.columns().length > 0) {
      return {
        success: true,
        results: statement.all(...this.bindings) as Record<string, unknown>[],
        meta: { changes: 0 },
      };
    }
    const result = statement.run(...this.bindings);
    return {
      success: true,
      results: [],
      meta: { changes: Number(result.changes), last_row_id: result.lastInsertRowid },
    };
  }

  private statement(): StatementSync {
    return this.database.prepare(this.sql);
  }
}

class SqliteD1Database {
  public constructor(public readonly sqlite: DatabaseSync) {}

  public prepare(sql: string): SqliteD1Statement {
    return new SqliteD1Statement(this.sqlite, sql);
  }

  public async batch(statements: SqliteD1Statement[]): Promise<D1ResultLike[]> {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

const schema = readFileSync(resolve(process.cwd(), "workers/er-save-api/schema.sql"), "utf8");
const secret = "worker-uncompressed-secret";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function authToken(username = "Alice", uid = 1): Promise<string> {
  const body = base64Url(new TextEncoder().encode(JSON.stringify({ uid, u: username, iat: 1 })));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}

/** Build a legacy "GZ1:" + base64(gzip(plain)) blob, exactly as the old worker stored it. */
async function gzipToGz1(plain: string): Promise<string> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  await writer.write(new TextEncoder().encode(plain));
  await writer.close();
  const bytes = new Uint8Array(await new Response(cs.readable).arrayBuffer());
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return `GZ1:${btoa(binary)}`;
}

const SAMPLE_SAVE = JSON.stringify({
  dexData: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, { seenAttr: 0, caughtAttr: 0 }])),
  gameVersion: "1.11.19",
  trainerId: 12345,
});

describe("er-save-api — uncompressed saves + legacy GZ1 back-compat", () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let authorization: string;

  beforeEach(async () => {
    vi.stubGlobal("crypto", webcrypto);
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(schema);
    sqlite
      .prepare("INSERT INTO users (id, username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(1, "Alice", "alice", "test-hash", 1);
    database = new SqliteD1Database(sqlite);
    authorization = await authToken();
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const request = new Request(`https://save.test${path}`, {
      ...init,
      headers: { Authorization: authorization, "Content-Type": "application/json", ...init.headers },
    });
    return saveWorker.fetch(request, { DB: database, SESSION_SECRET: secret } as never);
  }

  function storedData(uid = 1): string | null {
    return (
      (sqlite.prepare("SELECT data FROM system_saves WHERE user_id = ?").get(uid) as { data?: string } | undefined)
        ?.data ?? null
    );
  }

  it("stores a NEW system save UNCOMPRESSED (plaintext JSON, no GZ1: prefix)", async () => {
    const res = await call("/savedata/system/update", { method: "POST", body: SAMPLE_SAVE });
    expect(res.status).toBe(200);
    const stored = storedData();
    expect(stored).not.toBeNull();
    expect(stored?.startsWith("GZ1:")).toBe(false);
    expect(stored?.startsWith("{")).toBe(true);
    expect(stored).toBe(SAMPLE_SAVE);
  });

  it("round-trips a NEW save through get (stored uncompressed, reads back identical)", async () => {
    await call("/savedata/system/update", { method: "POST", body: SAMPLE_SAVE });
    const get = await call("/savedata/system/get");
    expect(get.status).toBe(200);
    await expect(get.text()).resolves.toBe(SAMPLE_SAVE);
  });

  it("still LOADS an existing LEGACY GZ1 compressed row (back-compat read)", async () => {
    const gz1 = await gzipToGz1(SAMPLE_SAVE);
    expect(gz1.startsWith("GZ1:")).toBe(true);
    sqlite.prepare("INSERT INTO system_saves (user_id, data, updated_at) VALUES (?, ?, ?)").run(1, gz1, 1);
    const get = await call("/savedata/system/get");
    expect(get.status).toBe(200);
    await expect(get.text()).resolves.toBe(SAMPLE_SAVE);
  });

  it("LAZILY migrates a legacy GZ1 row to plaintext on its next write", async () => {
    const gz1 = await gzipToGz1(SAMPLE_SAVE);
    sqlite.prepare("INSERT INTO system_saves (user_id, data, updated_at) VALUES (?, ?, ?)").run(1, gz1, 1);
    expect(storedData()?.startsWith("GZ1:")).toBe(true);
    // A newer save (bigger, so the anti-regression guard accepts it) writes plaintext.
    const nextSave = JSON.stringify({ ...JSON.parse(SAMPLE_SAVE), extra: "x".repeat(500) });
    const res = await call("/savedata/system/update", { method: "POST", body: nextSave });
    expect(res.status).toBe(200);
    expect(storedData()?.startsWith("GZ1:")).toBe(false);
    expect(storedData()).toBe(nextSave);
  });

  it("fails GRACEFULLY on a tampered/truncated GZ1 blob (HTTP 500, no crash, no garbage 200)", async () => {
    const gz1 = await gzipToGz1(SAMPLE_SAVE);
    // Truncate the gzip payload so DecompressionStream throws mid-inflate.
    const truncated = gz1.slice(0, "GZ1:".length + 12);
    sqlite.prepare("INSERT INTO system_saves (user_id, data, updated_at) VALUES (?, ?, ?)").run(1, truncated, 1);
    const get = await call("/savedata/system/get");
    expect(get.status).toBe(500);
    await expect(get.text()).resolves.toContain("could not be read");
  });
});
