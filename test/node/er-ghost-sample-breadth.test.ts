/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Ghost-pool fetch DE-RESTRICTION (maintainer): the /savedata/run/sample candidate pool
// was optimized for the free-tier D1 rows-read budget — a bounded `min(count*2, 40)`
// set of random-rowid seeks plus a shallow top-up read from the START of the table. That
// capped the pool to ~40 biased probes and re-fielded the same old shallow runs (the
// stale/repetitive-ghost class). On the paid plan the pool now considers ALL eligible
// runs. These tests pin that:
//   1. enumerateEligibleRunRowids returns EVERY eligible run (count red-proof: the old
//      sampler never enumerated the full set — it was capped at ~40), and ONLY eligible
//      runs (correctness filters intact: not-own, wave>=minWave, wave<=200, not endless),
//   2. it holds across keyset PAGES (efficiency at full breadth, not one unbounded query),
//   3. the /savedata/run/sample route draws uniformly across the FULL eligible pool — over
//      repeated calls every eligible run is reachable and no ineligible run ever appears.
//
// Red-proof: revert handleRunSample to the seek-window sampler → (1)/(3) fail, because it
// never builds the full eligible set (≤40 capped probes + shallow top-up).

import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import saveWorker, { enumerateEligibleRunRowids, GHOST_SAMPLE_MAX_WAVE } from "../../workers/er-save-api/src/index";

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
const secret = "ghost-breadth-secret";

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

/** Deterministic PRNG so the sampled-route coverage test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAYER_TEAM = JSON.stringify([
  {
    speciesId: 25,
    formIndex: 0,
    abilityIndex: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    nature: 0,
    level: 55,
    gender: -1,
    shiny: false,
    variant: 0,
    passive: false,
    moves: [85],
  },
]);

const CALLER_UID = 1;
const MIN_WAVE = 100;

describe("er-save-api — ghost sample considers ALL eligible runs (de-restriction)", () => {
  let sqlite: DatabaseSync;
  let database: SqliteD1Database;
  let authorization: string;
  let eligibleIds: Set<string>;
  let ineligibleIds: Set<string>;

  beforeEach(async () => {
    vi.stubGlobal("crypto", webcrypto);
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(schema);
    for (const [id, name] of [
      [1, "Alice"],
      [2, "Bob"],
      [3, "Carol"],
      [4, "Dave"],
    ] as const) {
      sqlite
        .prepare("INSERT INTO users (id, username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(id, name, name.toLowerCase(), "test-hash", 1);
    }
    database = new SqliteD1Database(sqlite);
    authorization = await authToken();

    eligibleIds = new Set<string>();
    ineligibleIds = new Set<string>();
    let seq = 0;
    const insertRun = (userId: number, wave: number, mode: string | null, eligible: boolean) => {
      const id = `run-${seq.toString().padStart(4, "0")}`;
      seq++;
      sqlite
        .prepare(
          "INSERT INTO runs (id, user_id, username, outcome, difficulty, mode, wave, created_at, player_team) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(id, userId, `Player${userId}`, "victory", "hell", mode, wave, 1_000 + seq, PLAYER_TEAM);
      (eligible ? eligibleIds : ineligibleIds).add(id);
    };

    // Build an INTERLEAVED table so eligible runs span a wide rowid range (incl. a deep
    // tail) with ineligible rows mixed throughout — exactly the shape the old capped
    // seek+shallow-topup sampler could not cover. Every ineligibility reason is present.
    const uploaders = [2, 3, 4];
    let e = 0; // eligible produced
    const TOTAL_ELIGIBLE = 120;
    let step = 0;
    while (e < TOTAL_ELIGIBLE) {
      // 1 shallow ineligible (wave < minWave) — the rows the old shallow top-up refielded.
      insertRun(uploaders[step % 3], 1 + (step % 90), "classic", false);
      // 2 eligible (wave in [minWave, 200], varied mode incl. NULL).
      const modeCycle: (string | null)[] = [null, "classic", "challenge"];
      insertRun(uploaders[step % 3], MIN_WAVE + (step % 101), modeCycle[step % 3], true);
      e++;
      if (e < TOTAL_ELIGIBLE) {
        insertRun(uploaders[(step + 1) % 3], MIN_WAVE + ((step * 7) % 101), modeCycle[(step + 1) % 3], true);
        e++;
      }
      // periodic ineligible: too-deep (endless-depth), own-user, and endless/daily modes.
      if (step % 4 === 0) {
        insertRun(uploaders[step % 3], GHOST_SAMPLE_MAX_WAVE + 5 + (step % 50), "classic", false); // wave > 200
      }
      if (step % 5 === 0) {
        insertRun(CALLER_UID, MIN_WAVE + 20, "classic", false); // caller's own run
      }
      if (step % 3 === 0) {
        const endlessModes = ["endless", "daily", "spliced_endless"];
        insertRun(uploaders[step % 3], MIN_WAVE + 30, endlessModes[step % 3], false); // contamination modes
      }
      step++;
    }
    // A deep, isolated eligible tail (highest rowids) — the class the old top-up (which
    // reads from the table START) systematically missed.
    insertRun(4, 199, "challenge", true);
    insertRun(4, 200, null, true);
  });

  afterEach(() => {
    sqlite.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function callSample(count: number): Promise<string[]> {
    const request = new Request(
      `https://save.test/savedata/run/sample?difficulty=hell&count=${count}&minWave=${MIN_WAVE}`,
      {
        method: "GET",
        headers: { Authorization: authorization, Accept: "application/json" },
      },
    );
    const res = await saveWorker.fetch(request, { DB: database, SESSION_SECRET: secret } as never);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { teams: { id: string }[] };
    return data.teams.map(t => t.id);
  }

  function rowidsToIds(rowids: number[]): string[] {
    return rowids.map(r => (sqlite.prepare("SELECT id FROM runs WHERE rowid = ?").get(r) as { id: string }).id);
  }

  it("enumerates EVERY eligible run and ONLY eligible runs (count red-proof)", async () => {
    const rowids = await enumerateEligibleRunRowids({ DB: database } as never, CALLER_UID, MIN_WAVE);
    // The old sampler was capped at ~40 probes; full enumeration returns all 122 eligible.
    expect(eligibleIds.size).toBe(122);
    expect(rowids.length).toBe(eligibleIds.size);
    const ids = new Set(rowidsToIds(rowids));
    expect(ids).toEqual(eligibleIds);
    // No ineligible run (own / shallow / too-deep / endless) is ever enumerated.
    for (const bad of ineligibleIds) {
      expect(ids.has(bad)).toBe(false);
    }
  });

  it("still returns the FULL eligible set across small keyset PAGES (paginated, not one blob)", async () => {
    const paged = await enumerateEligibleRunRowids({ DB: database } as never, CALLER_UID, MIN_WAVE, 7);
    expect(paged.length).toBe(eligibleIds.size);
    expect(new Set(rowidsToIds(paged))).toEqual(eligibleIds);
  });

  it("honors the minWave floor — a higher floor narrows the pool but never leaks a shallower run", async () => {
    const floor = 150;
    const rowids = await enumerateEligibleRunRowids({ DB: database } as never, CALLER_UID, floor);
    const ids = rowidsToIds(rowids);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const wave = (sqlite.prepare("SELECT wave FROM runs WHERE id = ?").get(id) as { wave: number }).wave;
      expect(wave).toBeGreaterThanOrEqual(floor);
      expect(wave).toBeLessThanOrEqual(GHOST_SAMPLE_MAX_WAVE);
      expect(ineligibleIds.has(id)).toBe(false);
    }
  });

  it("the /savedata/run/sample route draws across the FULL pool — every eligible run reachable, no ineligible ever", async () => {
    vi.spyOn(Math, "random").mockImplementation(mulberry32(0x5eed));
    const seen = new Set<string>();
    for (let call = 0; call < 60; call++) {
      for (const id of await callSample(20)) {
        expect(eligibleIds.has(id)).toBe(true); // correctness: never an ineligible run
        seen.add(id);
      }
    }
    // Full breadth: repeated uniform draws cover EVERY eligible run — impossible for the
    // old ~40-probe/shallow-topup sampler (which re-fielded the same shallow subset).
    expect(seen.size).toBe(eligibleIds.size);
  });
});
