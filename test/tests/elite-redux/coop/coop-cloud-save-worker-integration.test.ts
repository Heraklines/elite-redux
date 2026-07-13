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

async function digest(raw: string): Promise<string> {
  const value = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function checkpoint(
  runId: string,
  checkpointRevision: number,
  waveIndex: number,
  players: [string, string] = ["Alice", "Bob"],
  seats: { host: string; guest: string } = { host: players[0], guest: players[1] },
): string {
  return JSON.stringify({
    seed: "production-shaped-seed",
    playTime: 120,
    gameMode: 6,
    party: [],
    enemyParty: [],
    modifiers: [],
    enemyModifiers: [],
    arena: { biome: 1, weather: null, terrain: null, tags: [], positionalTags: [], playerTerasUsed: 0 },
    pokeballCounts: { 0: 5 },
    money: 1000,
    score: 50,
    waveIndex,
    battleType: 0,
    trainer: null,
    gameVersion: "test-production",
    timestamp: 1_000 + waveIndex,
    challenges: [],
    mysteryEncounterType: -1,
    mysteryEncounterSaveData: { encounteredEvents: [], encounterSpawnChance: 0.1, queuedEncounters: [] },
    playerFaints: 0,
    coopRun: { version: 1, runId, checkpointRevision },
    coopParticipants: {
      version: 1,
      players,
      seats,
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
    sqlite
      .prepare("INSERT INTO users (id, username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(2, "Bob", "bob", "test-hash", 1);
    sqlite
      .prepare("INSERT INTO users (id, username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(3, "Carol", "carol", "test-hash", 1);
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

  async function duplicateDeleteQuery(
    runId: string,
    slot: number,
    duplicateRaw: string,
    survivorSlot: number,
    survivorRaw: string,
  ): Promise<URLSearchParams> {
    return new URLSearchParams({
      slot: slot.toString(),
      coopCasRunId: runId,
      coopCasCheckpointRevision: JSON.parse(duplicateRaw).coopRun.checkpointRevision.toString(),
      coopCasDigest: await digest(duplicateRaw),
      survivorSlot: survivorSlot.toString(),
      survivorCheckpointRevision: JSON.parse(survivorRaw).coopRun.checkpointRevision.toString(),
      survivorDigest: await digest(survivorRaw),
    });
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
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: checkpoint(runId, 0, 1, ["Alice", "MissingPeer"]),
        })
      ).status,
      "both participant account keys must resolve in D1",
    ).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_saves").get()).toEqual({ count: 0 });
  });

  it("uses the account uniqueness key for authorization and rejects NFKC-equivalent impersonation", async () => {
    sqlite
      .prepare("INSERT INTO users (id, username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(4, "Ａlice", "ａlice", "test-hash", 1);
    authorization = await authToken("Ａlice", 4);

    const impersonated = checkpoint("run-account-key-route-123456789", 0, 1);
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: impersonated,
        })
      ).status,
      "full-width Alice is a distinct registered account and cannot authorize ASCII Alice",
    ).toBe(409);
    const ambiguousOwnIdentity = checkpoint("run-ambiguous-account-route-123456789", 0, 1, ["Ａlice", "Carol"], {
      host: "Ａlice",
      guest: "Carol",
    });
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: ambiguousOwnIdentity,
        })
      ).status,
      "an account key that changes under NFKC is refused until stable opaque IDs replace usernames",
    ).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_saves").get()).toEqual({ count: 0 });
  });

  it("keeps a truncated checkpoint recoverable through the exact legacy route", async () => {
    const raw = JSON.stringify({
      gameMode: 6,
      waveIndex: 4,
      timestamp: 4,
      coopRun: { version: 1, runId: "run-truncated-route-123456789", checkpointRevision: 1 },
      coopParticipants: {
        version: 1,
        players: ["Alice", "Bob"],
        seats: { host: "Alice", guest: "Bob" },
      },
    });
    sqlite.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(1, 3, raw, 1);
    const query = new URLSearchParams({ slot: "3", exactDigest: await digest(raw) });
    expect((await call(`/savedata/session/legacy-coop-exact-delete?${query}`, { method: "POST" })).status).toBe(200);
    expect(sqlite.prepare("SELECT data FROM session_saves WHERE user_id = 1 AND slot = 3").get()).toBeUndefined();
  });

  it("keeps participant accounts and gameplay seats immutable across existing CAS", async () => {
    const runId = "run-immutable-identity-route-123456789";
    const initial = checkpoint(runId, 0, 1);
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: initial,
        })
      ).status,
    ).toBe(200);
    const query = new URLSearchParams({
      slot: "0",
      coopCasMode: "existing",
      coopCasRunId: runId,
      coopCasCheckpointRevision: "0",
      coopCasDigest: await digest(initial),
    });
    const changedPeer = checkpoint(runId, 1, 2, ["Alice", "Carol"], { host: "Alice", guest: "Carol" });
    expect(
      (await call(`/savedata/session/coop-cas-update?${query}`, { method: "POST", body: changedPeer })).status,
    ).toBe(409);
    const swappedSeats = checkpoint(runId, 1, 2, ["Alice", "Bob"], { host: "Bob", guest: "Alice" });
    expect(
      (await call(`/savedata/session/coop-cas-update?${query}`, { method: "POST", body: swappedSeats })).status,
    ).toBe(409);
    expect(sqlite.prepare("SELECT data FROM session_saves WHERE user_id = 1 AND slot = 0").get()).toEqual({
      data: initial,
    });
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

  it("exactly tombstones an already-stored resumable row whose peer account no longer resolves", async () => {
    const runId = "run-missing-peer-recovery-123456789";
    const stranded = checkpoint(runId, 3, 7, ["Alice", "MissingPeer"], { host: "Alice", guest: "MissingPeer" });
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 2, stranded, 1);
    expect((await call(`/savedata/session/coop-run-status?coopRunId=${runId}`)).status).toBe(
      409,
      "an unresolvable peer is never reported as an active resumable run",
    );
    const query = new URLSearchParams({
      slot: "2",
      coopCasRunId: runId,
      coopCasCheckpointRevision: "3",
      coopCasDigest: await digest(stranded),
    });
    expect((await call(`/savedata/session/coop-cas-delete?${query}`, { method: "POST" })).status).toBe(200);
    const status = await call(`/savedata/session/coop-run-status?coopRunId=${runId}`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ state: "tombstoned", runId, slot: 2 });
  });

  it("exactly tombstones an already-stored row owned by an NFKC-ambiguous legacy account", async () => {
    sqlite
      .prepare("INSERT INTO users (id, username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(4, "Ａlice", "ａlice", "test-hash", 1);
    authorization = await authToken("Ａlice", 4);
    const runId = "run-ambiguous-owner-recovery-123456789";
    const stranded = checkpoint(runId, 3, 7, ["Ａlice", "Carol"], { host: "Ａlice", guest: "Carol" });
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(4, 2, stranded, 1);
    expect((await call(`/savedata/session/coop-run-status?coopRunId=${runId}`)).status).toBe(409);
    const query = new URLSearchParams({
      slot: "2",
      coopCasRunId: runId,
      coopCasCheckpointRevision: "3",
      coopCasDigest: await digest(stranded),
    });
    expect((await call(`/savedata/session/coop-cas-delete?${query}`, { method: "POST" })).status).toBe(200);
    const status = await call(`/savedata/session/coop-run-status?coopRunId=${runId}`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ state: "tombstoned", runId, slot: 2 });
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

  it("accepts an equal-revision survivor only when the serialized checkpoint is byte-identical", async () => {
    const runId = "run-identical-duplicate-route-123456789";
    const identical = checkpoint(runId, 5, 15);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 0, identical, 1);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 4, identical, 1);
    const query = await duplicateDeleteQuery(runId, 0, identical, 4, identical);
    expect((await call(`/savedata/session/coop-duplicate-exact-delete?${query}`, { method: "POST" })).status).toBe(200);
    expect(sqlite.prepare("SELECT slot FROM session_saves WHERE user_id = 1").all()).toEqual([{ slot: 4 }]);
  });

  it("rejects an older, equal-revision fork, changed pair, changed seats, and same-slot survivor", async () => {
    const cases: {
      label: string;
      duplicate: string;
      survivor: string;
    }[] = [
      {
        label: "older survivor",
        duplicate: checkpoint("run-older-survivor-123456789", 4, 12),
        survivor: checkpoint("run-older-survivor-123456789", 3, 11),
      },
      {
        label: "equal-revision fork",
        duplicate: checkpoint("run-equal-fork-123456789", 4, 12),
        survivor: checkpoint("run-equal-fork-123456789", 4, 13),
      },
      {
        label: "changed participant pair",
        duplicate: checkpoint("run-changed-pair-123456789", 2, 10),
        survivor: checkpoint("run-changed-pair-123456789", 3, 11, ["Alice", "Carol"], {
          host: "Alice",
          guest: "Carol",
        }),
      },
      {
        label: "changed gameplay seats",
        duplicate: checkpoint("run-changed-seats-123456789", 2, 10),
        survivor: checkpoint("run-changed-seats-123456789", 3, 11, ["Alice", "Bob"], { host: "Bob", guest: "Alice" }),
      },
    ];
    for (const [index, testCase] of cases.entries()) {
      sqlite
        .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
        .run(1, 0, testCase.duplicate, index + 1);
      sqlite
        .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
        .run(1, 4, testCase.survivor, index + 1);
      const query = await duplicateDeleteQuery(
        JSON.parse(testCase.duplicate).coopRun.runId,
        0,
        testCase.duplicate,
        4,
        testCase.survivor,
      );
      expect(
        (await call(`/savedata/session/coop-duplicate-exact-delete?${query}`, { method: "POST" })).status,
        testCase.label,
      ).toBe(409);
      expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_saves WHERE user_id = 1").get()).toEqual({
        count: 2,
      });
      sqlite.prepare("DELETE FROM session_saves WHERE user_id = 1").run();
    }

    const same = checkpoint("run-same-slot-survivor-123456789", 2, 10);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 0, same, 1);
    const sameSlotQuery = await duplicateDeleteQuery("run-same-slot-survivor-123456789", 0, same, 0, same);
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${sameSlotQuery}`, { method: "POST" })).status,
    ).toBe(400);
  });

  it("repairs three duplicates one at a time and never reports global convergence early", async () => {
    const runId = "run-three-duplicates-route-123456789";
    const oldest = checkpoint(runId, 1, 10);
    const middle = checkpoint(runId, 2, 11);
    const newest = checkpoint(runId, 3, 12);
    for (const [slot, raw] of [
      [0, oldest],
      [1, middle],
      [4, newest],
    ] as const) {
      sqlite
        .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
        .run(1, slot, raw, 1);
    }
    const removeOldest = await duplicateDeleteQuery(runId, 0, oldest, 4, newest);
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${removeOldest}`, { method: "POST" })).status,
    ).toBe(200);
    expect((await call(`/savedata/session/coop-run-status?coopRunId=${runId}`)).status).toBe(
      409,
      "a third live copy still blocks active status",
    );
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${removeOldest}`, { method: "POST" })).status,
      "the exact first repair remains idempotent while another duplicate exists",
    ).toBe(200);
    const removeMiddle = await duplicateDeleteQuery(runId, 1, middle, 4, newest);
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${removeMiddle}`, { method: "POST" })).status,
    ).toBe(200);
    const status = await call(`/savedata/session/coop-run-status?coopRunId=${runId}`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ state: "active", runId, slot: 4, checkpointRevision: 3 });
  });

  it("makes symmetric duplicate deletion and a concurrent tombstone fail closed", async () => {
    const runId = "run-symmetric-delete-route-123456789";
    const left = checkpoint(runId, 2, 10);
    const right = checkpoint(runId, 3, 11);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 0, left, 1);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 4, right, 1);
    const leftUsingRight = await duplicateDeleteQuery(runId, 0, left, 4, right);
    const rightUsingLeft = await duplicateDeleteQuery(runId, 4, right, 0, left);
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${leftUsingRight}`, { method: "POST" })).status,
    ).toBe(200);
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${rightUsingLeft}`, { method: "POST" })).status,
      "the serialized opposite delete cannot remove the last survivor",
    ).toBe(409);
    expect(sqlite.prepare("SELECT slot FROM session_saves WHERE user_id = 1").all()).toEqual([{ slot: 4 }]);

    sqlite.prepare("DELETE FROM session_saves WHERE user_id = 1").run();
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 0, left, 1);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 4, right, 1);
    sqlite
      .prepare(
        `INSERT INTO coop_run_tombstones_v2
          (user_id, slot, run_id, checkpoint_revision, digest, deleted_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(1, 4, runId, 3, await digest(right), 2);
    expect(
      (await call(`/savedata/session/coop-duplicate-exact-delete?${leftUsingRight}`, { method: "POST" })).status,
      "an interleaved tombstone prevents duplicate repair from selecting a live survivor",
    ).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_saves WHERE user_id = 1").get()).toEqual({ count: 2 });
  });
});
