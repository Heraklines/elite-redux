/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PokerogueSessionSavedataApi } from "#api/session-savedata-api";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COOP_EMPTY_SESSION_INSERT_SQL,
  COOP_EXACT_SESSION_REPLAY_SQL,
  COOP_EXISTING_SESSION_UPDATE_SQL,
  COOP_TOMBSTONE_INSERT_SQL,
  COOP_TOMBSTONED_SESSION_DELETE_SQL,
  classifySessionProtection,
  UPDATE_ALL_CONDITIONAL_SYSTEM_SQL,
} from "../../../../workers/er-save-api/src/index";

const saveApiSchema = readFileSync(resolve(process.cwd(), "workers/er-save-api/schema.sql"), "utf8");

function session(runId: string, checkpointRevision: number, wave = 1): string {
  return JSON.stringify({
    gameMode: 6,
    waveIndex: wave,
    coopRun: { version: 1, runId, checkpointRevision },
  });
}

describe("co-op cloud CAS SQL on SQLite", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(saveApiSchema);
    db.prepare(
      "INSERT INTO users (id, username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(1, "SqlTest", "sqltest", "test-hash", 1);
  });

  afterEach(() => {
    db.close();
  });

  it("installs the versioned account-wide tombstone schema with the exact composite key", () => {
    const columns = db.prepare("PRAGMA table_info(coop_run_tombstones_v2)").all() as {
      name: string;
      pk: number;
    }[];
    expect(columns.map(column => [column.name, column.pk])).toEqual([
      ["user_id", 1],
      ["slot", 0],
      ["run_id", 2],
      ["checkpoint_revision", 0],
      ["digest", 0],
      ["deleted_at", 0],
    ]);
  });

  it("atomically blocks a delayed empty-slot write after the run was tombstoned", () => {
    const runId = "run-deleted-123456789";
    const data = session(runId, 0);
    const digest = "a".repeat(64);
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 2, data, 1, runId).changes)).toBe(1);

    db.exec("BEGIN IMMEDIATE");
    expect(Number(db.prepare(COOP_TOMBSTONE_INSERT_SQL).run(1, 2, runId, 0, digest, 2, data).changes)).toBe(1);
    expect(Number(db.prepare(COOP_TOMBSTONED_SESSION_DELETE_SQL).run(1, 2, data, runId, 0, digest).changes)).toBe(1);
    db.exec("COMMIT");

    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 2, data, 3, runId).changes)).toBe(0);
    expect(Number(db.prepare(COOP_EXACT_SESSION_REPLAY_SQL).run(1, 2, data, runId).changes)).toBe(0);
    expect(db.prepare("SELECT data FROM session_saves WHERE user_id = 1 AND slot = 2").get()).toBeUndefined();

    const distinctRun = "run-distinct-123456789";
    expect(
      Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 2, session(distinctRun, 0), 4, distinctRun).changes),
    ).toBe(1);
  });

  it("enforces one live slot per account/run while allowing exact same-slot replay", () => {
    const runId = "run-unique-123456789";
    const data = session(runId, 0);
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 0, data, 1, runId).changes)).toBe(1);
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 4, data, 2, runId).changes)).toBe(0);
    expect(Number(db.prepare(COOP_EXACT_SESSION_REPLAY_SQL).run(1, 0, data, runId).changes)).toBe(1);
  });

  it("keeps tombstones immutable and makes deletion conditional on the exact tombstone", () => {
    const runId = "run-immutable-123456789";
    const data = session(runId, 4);
    const digest = "b".repeat(64);
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 1, data, 1, runId).changes)).toBe(1);
    expect(Number(db.prepare(COOP_TOMBSTONE_INSERT_SQL).run(1, 1, runId, 4, digest, 2, data).changes)).toBe(1);
    expect(Number(db.prepare(COOP_TOMBSTONE_INSERT_SQL).run(1, 1, runId, 99, "c".repeat(64), 3, data).changes)).toBe(0);
    expect(
      Number(db.prepare(COOP_TOMBSTONED_SESSION_DELETE_SQL).run(1, 1, data, runId, 99, "c".repeat(64)).changes),
    ).toBe(0);
    expect(Number(db.prepare(COOP_TOMBSTONED_SESSION_DELETE_SQL).run(1, 1, data, runId, 4, digest).changes)).toBe(1);
    expect(db.prepare("SELECT slot, checkpoint_revision, digest FROM coop_run_tombstones_v2").get()).toEqual({
      slot: 1,
      checkpoint_revision: 4,
      digest,
    });
  });

  it("accepts an exact advanced-byte replay but rejects an update after tombstoning", () => {
    const runId = "run-replay-123456789";
    const oldData = session(runId, 2, 10);
    const nextData = session(runId, 3, 11);
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 3, oldData, 1, runId).changes)).toBe(1);
    expect(Number(db.prepare(COOP_EXISTING_SESSION_UPDATE_SQL).run(nextData, 2, 1, 3, oldData, runId).changes)).toBe(1);
    expect(Number(db.prepare(COOP_EXACT_SESSION_REPLAY_SQL).run(1, 3, nextData, runId).changes)).toBe(1);

    db.prepare(
      `INSERT INTO coop_run_tombstones_v2
       (user_id, slot, run_id, checkpoint_revision, digest, deleted_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(1, 3, runId, 3, "d".repeat(64), 3);
    expect(
      Number(db.prepare(COOP_EXISTING_SESSION_UPDATE_SQL).run(session(runId, 4), 4, 1, 3, nextData, runId).changes),
    ).toBe(0);
    expect(Number(db.prepare(COOP_EXACT_SESSION_REPLAY_SQL).run(1, 3, nextData, runId).changes)).toBe(0);
  });

  it("does not commit the updateAll system half when its conditional session write lost", () => {
    db.prepare("INSERT INTO system_saves (user_id, data, updated_at) VALUES (?, ?, ?)").run(1, "system-old", 1);
    db.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(
      1,
      0,
      "session-concurrent",
      1,
    );

    db.exec("BEGIN IMMEDIATE");
    expect(
      Number(
        db
          .prepare("UPDATE session_saves SET data = ? WHERE user_id = ? AND slot = ? AND data = ?")
          .run("session-intended", 1, 0, "session-observed").changes,
      ),
    ).toBe(0);
    expect(
      Number(db.prepare(UPDATE_ALL_CONDITIONAL_SYSTEM_SQL).run(1, "system-new", 2, 0, "session-intended").changes),
    ).toBe(0);
    db.exec("COMMIT");

    expect(db.prepare("SELECT data FROM system_saves WHERE user_id = 1").get()).toEqual({ data: "system-old" });
  });

  it("protects pre-T5, malformed co-op-like, and opaque rows from legacy mutation", () => {
    expect(classifySessionProtection(JSON.stringify({ gameMode: 6, coopParticipants: { players: ["A", "B"] } }))).toBe(
      "coop-invalid",
    );
    expect(classifySessionProtection(JSON.stringify({ coopRun: { runId: "short", checkpointRevision: -1 } }))).toBe(
      "coop-invalid",
    );
    expect(classifySessionProtection("{truncated")).toBe("unknown");
    expect(classifySessionProtection(JSON.stringify("not-a-session"))).toBe("unknown");
    expect(classifySessionProtection(JSON.stringify({ gameMode: 0, waveIndex: 3 }))).toBe("solo");
  });
});

describe("co-op cloud CAS HTTP contract", () => {
  const api = new PokerogueSessionSavedataApi("https://save-api.test");

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves empty non-2xx status as a typed failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(
      api.updateCoopCas(
        {
          slot: 0,
          trainerId: 1,
          secretId: 2,
          clientSessionId: "client",
          coopCasMode: "empty",
        },
        session("run-http-123456789", 0),
      ),
    ).resolves.toEqual({
      ok: false,
      status: 503,
      error: "Co-op session mutation failed with HTTP 503.",
      failureKind: "transient",
    });
  });

  it("rejects a run-status proof for a different run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          state: "tombstoned",
          runId: "run-other-123456789",
          slot: 0,
          checkpointRevision: 2,
          digest: "a".repeat(64),
        }),
      ),
    );

    await expect(
      api.getCoopRunStatus({ clientSessionId: "client", coopRunId: "run-expected-123456789", slot: 0 }),
    ).resolves.toMatchObject({ ok: false, failureKind: "invalid" });
  });

  it("preserves HTTP status when a successful status response is malformed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })));

    await expect(
      api.getCoopRunStatus({ clientSessionId: "client", coopRunId: "run-expected-123456789" }),
    ).resolves.toEqual({
      ok: false,
      status: 200,
      error: "Co-op run status response was not valid JSON.",
      failureKind: "invalid",
    });
  });
});
