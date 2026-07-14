/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErMoveId } from "../../../../src/enums/er-move-id";
import { ErSpeciesId } from "../../../../src/enums/er-species-id";
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

  public async all<T extends Record<string, unknown>>(): Promise<D1ResultLike & { results: T[] }> {
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
const coopIdentitySecret = "coop-worker-integration-secret-at-least-32-bytes";

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

/**
 * This minimal serialized fixture was traced field-by-field from `GameData.getSessionSaveData()`
 * and the `PokemonData`, `ArenaData`, `TrainerData`, `ChallengeData`, and
 * `MysteryEncounterSaveData` constructors it invokes. It includes every property the Worker
 * validates or the current load path immediately dereferences. We intentionally do not call it a
 * runtime capture: AGENTS.md reserves real Phaser execution for isolated remote runners.
 */
function capturedPokemonData(id: number, player: boolean, species: number) {
  return {
    id,
    player,
    species,
    nickname: "",
    formIndex: 0,
    abilityIndex: 0,
    passive: false,
    shiny: false,
    variant: 0,
    pokeball: 0,
    level: 12,
    exp: 1_000,
    levelExp: 100,
    gender: 0,
    hp: 32,
    stats: [32, 18, 17, 16, 15, 14],
    ivs: [31, 30, 29, 28, 27, 26],
    nature: 0,
    moveset: [{ moveId: 1, ppUsed: 0, ppUp: 0 }],
    status: null,
    friendship: 50,
    metLevel: 5,
    metBiome: -1,
    metSpecies: species,
    metWave: -1,
    luck: 0,
    pauseEvolutions: false,
    pokerus: false,
    usedTMs: [],
    teraType: 0,
    isTerastallized: false,
    stellarTypesBoosted: [],
    boss: false,
    bossSegments: 0,
    summonData: {},
    battleData: {},
    customPokemonData: {},
    fusionCustomPokemonData: {},
  };
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
    party: [capturedPokemonData(101, true, 1), capturedPokemonData(102, true, 4)],
    enemyParty: [capturedPokemonData(201, false, 7)],
    modifiers: [],
    enemyModifiers: [],
    arena: { biome: 1, weather: null, terrain: null, tags: [], positionalTags: [], playerTerasUsed: 0 },
    pokeballCounts: { 0: 5 },
    money: 1000,
    score: 50,
    waveIndex,
    battleType: 0,
    trainer: null,
    gameVersion: "1.11.19",
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const request = new Request(`https://save.test${path}`, {
      ...init,
      headers: { Authorization: authorization, "Content-Type": "application/json", ...init.headers },
    });
    return saveWorker.fetch(request, {
      DB: database,
      SESSION_SECRET: secret,
      COOP_IDENTITY_SECRET: coopIdentitySecret,
      COOP_IDENTITY_TTL_MS: "60000",
    } as never);
  }

  it("exposes an immutable account ID and mints a signed, bounded co-op identity ticket", async () => {
    const info = await call("/account/info");
    expect(info.status).toBe(200);
    await expect(info.json()).resolves.toMatchObject({ accountId: "er-account:1", username: "Alice" });

    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const response = await call("/account/coop-ticket");
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      ticket: string;
      identity: { version: number; accountId: string; displayName: string; canonicalUsername: string };
      expiresAt: number;
    };
    expect(result.identity).toEqual({
      version: 1,
      accountId: "er-account:1",
      displayName: "Alice",
      canonicalUsername: "alice",
    });
    expect(result.expiresAt).toBe(70_000);
    const [body, signature] = result.ticket.split(".");
    const payload = JSON.parse(new TextDecoder().decode(Buffer.from(body, "base64url"))) as Record<string, unknown>;
    expect(payload).toMatchObject({
      v: 1,
      sub: "er-account:1",
      displayName: "Alice",
      canonicalUsername: "alice",
      exp: 70_000,
    });
    expect(typeof payload.nonce).toBe("string");
    expect((payload.nonce as string).length).toBeGreaterThanOrEqual(20);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(coopIdentitySecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify("HMAC", key, Buffer.from(signature, "base64url"), new TextEncoder().encode(body)),
    ).toBe(true);
    now.mockRestore();
  });

  it("refuses to mint a ticket without the dedicated shared secret", async () => {
    const request = new Request("https://save.test/account/coop-ticket", {
      headers: { Authorization: authorization },
    });
    const response = await saveWorker.fetch(request, { DB: database, SESSION_SECRET: secret } as never);
    expect(response.status).toBe(503);
  });

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

  it("from-nothing empty-CAS rejects a fresh checkpoint whose mons drop the boolean `passive` key (#P33 layer-5), accepts it with a real boolean", async () => {
    const runId = "run-fresh-passive-drop-123456789";

    // Root of the bug: a FRESHLY-generated Pokemon never assigns its declared-`boolean` `passive`
    // field (Pokemon only sets it via `!!dataSource.passive` on the LOAD path), so PokemonData used to
    // serialize `passive: undefined`, and JSON.stringify DROPS an undefined value -> the key vanishes.
    const monWithUndefinedPassive = { ...capturedPokemonData(101, true, 1), passive: undefined };
    const roundTripped = JSON.parse(JSON.stringify(monWithUndefinedPassive));
    expect("passive" in roundTripped, "JSON.stringify drops an undefined boolean - this is the bug").toBe(false);

    // The client's fresh serialize shape on the UNPATCHED path: valid session, valid two registered
    // accounts, but every party AND enemyParty mon is missing the `passive` key. The worker's fail-closed
    // isPokemonDataShape (typeof passive === "boolean") rejects it -> parseValidResumableCoopSession null
    // -> 409 "incoming resumable co-op checkpoint is invalid" (the exact production first-save 409).
    const droppedPassive = JSON.parse(checkpoint(runId, 0, 1));
    for (const mon of [...droppedPassive.party, ...droppedPassive.enemyParty]) {
      delete mon.passive;
    }
    const rejected = await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
      method: "POST",
      body: JSON.stringify(droppedPassive),
    });
    expect(rejected.status, "a fresh mon missing the boolean passive key is rejected fail-closed").toBe(409);
    await expect(rejected.text()).resolves.toContain("incoming resumable co-op checkpoint is invalid");

    // The PATCHED client shape (pokemon-data.ts now serializes `passive ?? false`): the boolean key
    // survives, the shape validates, and the from-nothing empty-slot CAS commits.
    const patched = await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
      method: "POST",
      body: checkpoint(runId, 0, 1),
    });
    expect(patched.status, "the same fresh save with a real boolean passive commits from nothing").toBe(200);
  });

  it("from-nothing empty-CAS accepts ER-custom move/species ids (P33 layer-7), still rejects out-of-range ids", async () => {
    // ER customs are high-range (moves >= 5000, species >= 10000) and appear the instant RNG rolls one.
    // The worker's resumable allowlists must union the ER enums; without the union this commits 200 only
    // when wave-1 rolled all-vanilla moves and 409s "invalid checkpoint" the moment an ER move is rolled
    // (the observed wave-1 CAS 409). Assert an ER species + ER move validate + commit from nothing.
    const erRunId = "run-er-custom-ids-1234567890";
    const erCustom = JSON.parse(checkpoint(erRunId, 0, 1));
    erCustom.party = [
      {
        ...capturedPokemonData(101, true, ErSpeciesId.PHANTOWL),
        moveset: [{ moveId: ErMoveId.OUTBURST, ppUsed: 0, ppUp: 0 }],
      },
      capturedPokemonData(102, true, 4),
    ];
    const accepted = await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
      method: "POST",
      body: JSON.stringify(erCustom),
    });
    expect(accepted.status, "an ER-custom species (10000) + ER-custom move (5004) validate + commit from nothing").toBe(
      200,
    );

    // The allowlist is still ENFORCED (not allow-all): an id in neither the vanilla nor the ER enum fails closed.
    const garbageRunId = "run-garbage-move-id-1234567890";
    const garbage = JSON.parse(checkpoint(garbageRunId, 0, 1));
    garbage.party = [
      { ...capturedPokemonData(101, true, 1), moveset: [{ moveId: 999_999, ppUsed: 0, ppUp: 0 }] },
      capturedPokemonData(102, true, 4),
    ];
    const rejected = await call("/savedata/session/coop-cas-update?slot=1&coopCasMode=empty", {
      method: "POST",
      body: JSON.stringify(garbage),
    });
    expect(rejected.status, "a move id in neither the vanilla nor the ER enum is still rejected").toBe(409);
  });

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
    const emptyParty = JSON.parse(checkpoint(runId, 0, 1));
    emptyParty.party = [];
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: JSON.stringify(emptyParty),
        })
      ).status,
      "an object that cannot resume a player party never reaches D1",
    ).toBe(409);
    const placeholderPokemon = JSON.parse(checkpoint(runId, 0, 1));
    placeholderPokemon.party = [{}];
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: JSON.stringify(placeholderPokemon),
        })
      ).status,
      "PokemonData({}) would throw during browser materialization",
    ).toBe(409);
    const trainerWithoutData = JSON.parse(checkpoint(runId, 0, 1));
    trainerWithoutData.battleType = 1;
    trainerWithoutData.trainer = null;
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: JSON.stringify(trainerWithoutData),
        })
      ).status,
      "a trainer load dereferences trainerType and therefore requires trainer data",
    ).toBe(409);
    const mysteryWithoutType = JSON.parse(checkpoint(runId, 0, 1));
    mysteryWithoutType.battleType = 3;
    mysteryWithoutType.mysteryEncounterType = -1;
    mysteryWithoutType.enemyParty = [];
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: JSON.stringify(mysteryWithoutType),
        })
      ).status,
      "an empty-enemy Mystery boundary must retain the exact event it will reopen",
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

  it("binds checkpoint identity strings and the signed caller name to canonical D1 usernames", async () => {
    const caseChangedPlayer = checkpoint("run-case-player-route-123456789", 0, 1, ["ALICE", "Bob"], {
      host: "ALICE",
      guest: "Bob",
    });
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: caseChangedPlayer,
        })
      ).status,
      "case-insensitive lookup may find the account but may not rewrite its durable identity",
    ).toBe(409);

    const caseChangedSeat = checkpoint("run-case-seat-route-123456789", 0, 1, ["Alice", "Bob"], {
      host: "ALICE",
      guest: "Bob",
    });
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: caseChangedSeat,
        })
      ).status,
      "seat labels must be the exact canonical account strings too",
    ).toBe(409);

    authorization = await authToken("ALICE", 1);
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=0&coopCasMode=empty", {
          method: "POST",
          body: checkpoint("run-case-token-route-123456789", 0, 1),
        })
      ).status,
      "a signed token whose display identity no longer matches its uid row is stale",
    ).toBe(409);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_saves").get()).toEqual({ count: 0 });
  });

  it("tombstones a truncated checkpoint with valid run metadata and fences delayed resurrection", async () => {
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
    expect(
      sqlite
        .prepare(
          `SELECT slot, run_id, checkpoint_revision, digest
           FROM coop_run_tombstones_v2 WHERE user_id = 1 AND run_id = ?`,
        )
        .get("run-truncated-route-123456789"),
    ).toEqual({
      slot: 3,
      run_id: "run-truncated-route-123456789",
      checkpoint_revision: 1,
      digest: await digest(raw),
    });
    expect(
      (await call(`/savedata/session/legacy-coop-exact-delete?${query}`, { method: "POST" })).status,
      "a lost successful response is idempotent after the row is gone",
    ).toBe(200);
    expect(
      (
        await call("/savedata/session/coop-cas-update?slot=3&coopCasMode=empty", {
          method: "POST",
          body: checkpoint("run-truncated-route-123456789", 2, 5),
        })
      ).status,
      "a delayed writer cannot recreate a recovered invalid run",
    ).toBe(409);
    const status = await call("/savedata/session/coop-run-status?coopRunId=run-truncated-route-123456789");
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      state: "tombstoned",
      runId: "run-truncated-route-123456789",
      slot: 3,
      checkpointRevision: 1,
    });
  });

  it("keeps raw exact recovery for a pre-run-id co-op row", async () => {
    const raw = JSON.stringify({
      gameMode: 6,
      waveIndex: 3,
      timestamp: 3,
      coopParticipants: {
        version: 1,
        players: ["Alice", "Bob"],
        seats: { host: "Alice", guest: "Bob" },
      },
    });
    sqlite.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(1, 2, raw, 1);
    const query = new URLSearchParams({ slot: "2", exactDigest: await digest(raw) });
    expect((await call(`/savedata/session/legacy-coop-exact-delete?${query}`, { method: "POST" })).status).toBe(200);
    expect(sqlite.prepare("SELECT data FROM session_saves WHERE user_id = 1 AND slot = 2").get()).toBeUndefined();
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM coop_run_tombstones_v2").get()).toEqual({ count: 0 });
  });

  it("tombstones a trustworthy lineage when its source revision is missing or malformed", async () => {
    const cases = [
      { slot: 0, runId: "run-missing-revision-route-123456789", checkpointRevision: undefined },
      { slot: 1, runId: "run-invalid-revision-route-123456789", checkpointRevision: "invalid" },
    ] as const;
    for (const testCase of cases) {
      const raw = JSON.stringify({
        gameMode: 6,
        waveIndex: 4,
        timestamp: 4,
        coopRun: {
          version: 1,
          runId: testCase.runId,
          ...(testCase.checkpointRevision === undefined ? {} : { checkpointRevision: testCase.checkpointRevision }),
        },
        coopParticipants: {
          version: 1,
          players: ["Alice", "Bob"],
          seats: { host: "Alice", guest: "Bob" },
        },
      });
      sqlite
        .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
        .run(1, testCase.slot, raw, 1);
      const query = new URLSearchParams({ slot: testCase.slot.toString(), exactDigest: await digest(raw) });
      expect((await call(`/savedata/session/legacy-coop-exact-delete?${query}`, { method: "POST" })).status).toBe(200);
      expect(
        (await call(`/savedata/session/legacy-coop-exact-delete?${query}`, { method: "POST" })).status,
        "the exact recovery remains idempotent after its source row is gone",
      ).toBe(200);
      expect(
        sqlite
          .prepare(
            `SELECT slot, checkpoint_revision, digest FROM coop_run_tombstones_v2
             WHERE user_id = 1 AND run_id = ?`,
          )
          .get(testCase.runId),
      ).toEqual({ slot: testCase.slot, checkpoint_revision: 0, digest: await digest(raw) });
      const status = await call(`/savedata/session/coop-run-status?coopRunId=${testCase.runId}`);
      expect(status.status).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        state: "tombstoned",
        runId: testCase.runId,
        slot: testCase.slot,
        checkpointRevision: 0,
        digest: await digest(raw),
      });
      expect(
        (
          await call(`/savedata/session/coop-cas-update?slot=${testCase.slot}&coopCasMode=empty`, {
            method: "POST",
            body: checkpoint(testCase.runId, 1, 5),
          })
        ).status,
        "a delayed materializable checkpoint cannot resurrect the fenced lineage",
      ).toBe(409);
    }
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
    const caseChangedPlayer = checkpoint(runId, 1, 2, ["ALICE", "Bob"], { host: "ALICE", guest: "Bob" });
    expect(
      (await call(`/savedata/session/coop-cas-update?${query}`, { method: "POST", body: caseChangedPlayer })).status,
      "case-only participant rewrites are mutations, not idempotent account aliases",
    ).toBe(409);
    const caseChangedSeat = checkpoint(runId, 1, 2, ["Alice", "Bob"], { host: "ALICE", guest: "Bob" });
    expect(
      (await call(`/savedata/session/coop-cas-update?${query}`, { method: "POST", body: caseChangedSeat })).status,
      "case-only seat rewrites are mutations",
    ).toBe(409);
    expect(sqlite.prepare("SELECT data FROM session_saves WHERE user_id = 1 AND slot = 0").get()).toEqual({
      data: initial,
    });
  });

  it("serves an authenticated account-scoped missing proof without leaking another account's run", async () => {
    const runId = "run-status-missing-route-123456789";
    const statusUrl = `/savedata/session/coop-run-status?coopRunId=${runId}&slot=2`;
    const environment = {
      DB: database,
      SESSION_SECRET: secret,
      COOP_IDENTITY_SECRET: coopIdentitySecret,
      COOP_IDENTITY_TTL_MS: "60000",
    } as never;

    const unauthenticated = await saveWorker.fetch(new Request(`https://save.test${statusUrl}`), environment);
    expect(unauthenticated.status).toBe(401);

    const missing = await call(statusUrl);
    expect(missing.status).toBe(200);
    expect(missing.headers.get("Content-Type")).toContain("application/json");
    await expect(missing.json()).resolves.toEqual({ state: "missing", runId });

    const aliceCheckpoint = checkpoint(runId, 3, 9);
    sqlite
      .prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)")
      .run(1, 2, aliceCheckpoint, 1);

    authorization = await authToken("Carol", 3);
    const hiddenFromAnotherAccount = await call(statusUrl);
    expect(hiddenFromAnotherAccount.status).toBe(200);
    await expect(hiddenFromAnotherAccount.json()).resolves.toEqual({ state: "missing", runId });

    authorization = await authToken("Alice", 1);
    const activeForOwner = await call(statusUrl);
    expect(activeForOwner.status).toBe(200);
    await expect(activeForOwner.json()).resolves.toEqual({
      state: "active",
      runId,
      slot: 2,
      checkpointRevision: 3,
      digest: await digest(aliceCheckpoint),
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
    expect(
      (await call(`/savedata/session/coop-run-status?coopRunId=${runId}`)).status,
      "an unresolvable peer is never reported as an active resumable run",
    ).toBe(409);
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
    expect(
      (await call(`/savedata/session/coop-run-status?coopRunId=${runId}`)).status,
      "a third live copy still blocks active status",
    ).toBe(409);
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
