/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import saveWorker from "../../../../workers/er-save-api/src/index";

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

  public async all<T>(): Promise<D1ResultLike & { results: T[] }> {
    return {
      success: true,
      results: this.statement().all(...this.bindings) as unknown as T[],
      meta: { changes: 0 },
    };
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
const secret = "worker-integration-secret";

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function authToken(username = "Alice"): Promise<string> {
  const body = base64Url(new TextEncoder().encode(JSON.stringify({ uid: 1, u: username, iat: 1 })));
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

async function digest(raw: string): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function checkpoint(runId: string, checkpointRevision: number, waveIndex: number, players = ["Alice", "Bob"]): string {
  return JSON.stringify({
    gameMode: 6,
    waveIndex,
    timestamp: 1_000 + waveIndex,
    coopRun: { version: 1, runId, checkpointRevision },
    coopParticipants: {
      version: 1,
      players,
      seats: { host: players[0], guest: players[1] },
    },
  });
}

describe("co-op save Worker endpoint integration", () => {
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
    vi.unstubAllGlobals();
  });

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const request = new Request(`https://save.test${path}`, {
      ...init,
      headers: { Authorization: authorization, "Content-Type": "application/json", ...init.headers },
    });
    return saveWorker.fetch(request, { DB: database, SESSION_SECRET: secret } as never);
  }

  it("rejects incomplete, non-canonical, and foreign-account checkpoints through the real route", async () => {
    const runId = "run-structural-route-123456789";
    const incomplete = JSON.stringify({ coopRun: { version: 1, runId, checkpointRevision: 0 } });
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: incomplete,
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: checkpoint(runId, 0, 1, ["Bob", "Alice"]),
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: checkpoint(runId, 0, 1, ["Bob", "Carol"]),
        })
      ).status,
    ).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_saves").get()).toEqual({ count: 0 });
  });

  it("routes create, exact update, status, delete, replay, and resurrection fencing end to end", async () => {
    const runId = "run-endpoint-route-123456789";
    const initial = checkpoint(runId, 0, 1);
    const advanced = checkpoint(runId, 1, 2);
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=2&coopCasMode=empty", {
          method: "POST",
          body: initial,
        })
      ).status,
    ).toBe(200);

    const statusBefore = await call(`/savedata/session/coop-run-status?coopRunId=${runId}&slot=2`);
    expect(statusBefore.status).toBe(200);
    await expect(statusBefore.json()).resolves.toEqual({
      state: "active",
      runId,
      slot: 2,
      checkpointRevision: 0,
      digest: await digest(initial),
    });

    const updateQuery = new URLSearchParams({
      slot: "2",
      coopCasMode: "existing",
      coopCasRunId: runId,
      coopCasCheckpointRevision: "0",
      coopCasDigest: await digest(initial),
    });
    expect(
      (
        await call(`/savedata/session/coop-cas-update?${updateQuery}`, {
          method: "POST",
          body: advanced,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call(`/savedata/session/coop-cas-update?${updateQuery}`, {
          method: "POST",
          body: advanced,
        })
      ).status,
      "a byte-identical lost-response replay is idempotent",
    ).toBe(200);

    const deleteQuery = new URLSearchParams({
      slot: "2",
      coopCasRunId: runId,
      coopCasCheckpointRevision: "1",
      coopCasDigest: await digest(advanced),
    });
    expect((await call(`/savedata/session/coop-cas-delete?${deleteQuery}`, { method: "POST" })).status).toBe(200);
    expect((await call(`/savedata/session/coop-cas-delete?${deleteQuery}`, { method: "POST" })).status).toBe(200);
    const statusAfter = await call(`/savedata/session/coop-run-status?coopRunId=${runId}`);
    await expect(statusAfter.json()).resolves.toMatchObject({ state: "tombstoned", runId, slot: 2 });
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=2&coopCasMode=empty", {
          method: "POST",
          body: advanced,
        })
      ).status,
    ).toBe(409);
  });

  it("converges an exact duplicate without tombstoning and rejects stale survivor evidence", async () => {
    const runId = "run-duplicate-route-123456789";
    const duplicate = checkpoint(runId, 2, 10);
    const staleSurvivor = checkpoint(runId, 3, 11);
    const survivor = checkpoint(runId, 4, 12);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 0, duplicate, 1);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 4, survivor, 1);

    const recoveryQuery = async (survivorRaw: string): Promise<URLSearchParams> =>
      new URLSearchParams({
        slot: "0",
        coopCasRunId: runId,
        coopCasCheckpointRevision: "2",
        coopCasDigest: await digest(duplicate),
        survivorSlot: "4",
        survivorCheckpointRevision: JSON.parse(survivorRaw).coopRun.checkpointRevision.toString(),
        survivorDigest: await digest(survivorRaw),
      });
    expect(
      (
        await call(`/savedata/session/coop-duplicate-exact-delete?${await recoveryQuery(staleSurvivor)}`, {
          method: "POST",
        })
      ).status,
    ).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_saves").get()).toEqual({ count: 2 });

    const exactQuery = await recoveryQuery(survivor);
    expect((await call(`/savedata/session/coop-duplicate-exact-delete?${exactQuery}`, { method: "POST" })).status).toBe(
      200,
    );
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${exactQuery}`, { method: "POST" })).status,
      "a lost duplicate-repair response can be retried exactly",
    ).toBe(200);
    expect(sqlite.prepare("SELECT slot FROM session_saves ORDER BY slot").all()).toEqual([{ slot: 4 }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM coop_run_tombstones_v2").get()).toEqual({ count: 0 });
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: duplicate,
        })
      ).status,
      "the survivor fences a delayed recreation of the removed duplicate",
    ).toBe(409);
  });
});
