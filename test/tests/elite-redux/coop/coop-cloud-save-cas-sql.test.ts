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
  COOP_DUPLICATE_DELETE_REPLAY_SQL,
  COOP_DUPLICATE_EXACT_DELETE_SQL,
  COOP_EMPTY_SESSION_INSERT_SQL,
  COOP_EXACT_SESSION_REPLAY_SQL,
  COOP_EXISTING_SESSION_UPDATE_SQL,
  COOP_FENCE_ONLY_CHECKPOINT_REVISION,
  COOP_TOMBSTONE_INSERT_SQL,
  COOP_TOMBSTONED_SESSION_DELETE_SQL,
  classifySessionProtection,
  parseValidResumableCoopSession,
  UPDATE_ALL_CONDITIONAL_SYSTEM_SQL,
} from "../../../../workers/er-save-api/src/index";

const saveApiSchema = readFileSync(resolve(process.cwd(), "workers/er-save-api/schema.sql"), "utf8");

/**
 * This minimal serialized fixture was traced field-by-field from `GameData.getSessionSaveData()`
 * and the `PokemonData`, `ArenaData`, `TrainerData`, `ChallengeData`, and
 * `MysteryEncounterSaveData` constructors it invokes. It deliberately includes every property
 * this Worker validates or the current load path immediately dereferences. It is not described as
 * a runtime capture because constructing the real Phaser scene is prohibited locally by AGENTS.md.
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

function session(
  runId: string,
  checkpointRevision: number,
  wave = 1,
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
    waveIndex: wave,
    battleType: 0,
    trainer: null,
    gameVersion: "1.11.19",
    timestamp: 1,
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

  it("fences a regex-valid lineage whose source revision is unusable", () => {
    const runId = "run-malformed-revision-123456789";
    const malformed = JSON.stringify({
      gameMode: 6,
      coopRun: { version: 1, runId, checkpointRevision: "not-a-revision" },
    });
    const delayed = session(runId, 0);
    const digest = "f".repeat(64);
    expect(classifySessionProtection(malformed)).toBe("coop-invalid");
    db.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(
      1,
      2,
      malformed,
      1,
    );

    db.exec("BEGIN IMMEDIATE");
    expect(
      Number(
        db
          .prepare(COOP_TOMBSTONE_INSERT_SQL)
          .run(1, 2, runId, COOP_FENCE_ONLY_CHECKPOINT_REVISION, digest, 2, malformed).changes,
      ),
    ).toBe(1);
    expect(
      Number(
        db
          .prepare(COOP_TOMBSTONED_SESSION_DELETE_SQL)
          .run(1, 2, malformed, runId, COOP_FENCE_ONLY_CHECKPOINT_REVISION, digest).changes,
      ),
    ).toBe(1);
    db.exec("COMMIT");

    expect(db.prepare("SELECT checkpoint_revision, digest FROM coop_run_tombstones_v2").get()).toEqual({
      checkpoint_revision: COOP_FENCE_ONLY_CHECKPOINT_REVISION,
      digest,
    });
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 2, delayed, 3, runId).changes)).toBe(0);
  });

  it("enforces one live slot per account/run while allowing exact same-slot replay", () => {
    const runId = "run-unique-123456789";
    const data = session(runId, 0);
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 0, data, 1, runId).changes)).toBe(1);
    expect(Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 4, data, 2, runId).changes)).toBe(0);
    expect(Number(db.prepare(COOP_EXACT_SESSION_REPLAY_SQL).run(1, 0, data, runId).changes)).toBe(1);
  });

  it("atomically removes one exact duplicate only while its exact survivor remains", () => {
    const runId = "run-duplicate-123456789";
    const duplicate = session(runId, 2, 10);
    const survivor = session(runId, 3, 11);
    db.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(
      1,
      0,
      duplicate,
      1,
    );
    db.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(
      1,
      4,
      survivor,
      1,
    );

    expect(Number(db.prepare(COOP_DUPLICATE_EXACT_DELETE_SQL).run(1, 0, duplicate, runId, 4, survivor).changes)).toBe(
      1,
    );
    expect(Number(db.prepare(COOP_DUPLICATE_DELETE_REPLAY_SQL).run(1, 0, "", runId, 4, survivor).changes)).toBe(1);
    expect(
      Number(db.prepare(COOP_EMPTY_SESSION_INSERT_SQL).run(1, 0, duplicate, 2, runId).changes),
      "the surviving run identity fences delayed recreation of the removed duplicate",
    ).toBe(0);
    expect(db.prepare("SELECT data FROM session_saves WHERE user_id = 1 AND slot = 4").get()).toEqual({
      data: survivor,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM coop_run_tombstones_v2").get()).toEqual({ count: 0 });
  });

  it("does not remove a duplicate after the exact survivor changed", () => {
    const runId = "run-duplicate-race-123456789";
    const duplicate = session(runId, 2, 10);
    const observedSurvivor = session(runId, 3, 11);
    const advancedSurvivor = session(runId, 4, 12);
    db.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(
      1,
      0,
      duplicate,
      1,
    );
    db.prepare("INSERT INTO session_saves (user_id, slot, data, updated_at) VALUES (?, ?, ?, ?)").run(
      1,
      4,
      advancedSurvivor,
      2,
    );
    expect(
      Number(db.prepare(COOP_DUPLICATE_EXACT_DELETE_SQL).run(1, 0, duplicate, runId, 4, observedSurvivor).changes),
    ).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM session_saves WHERE user_id = 1").get()).toEqual({ count: 2 });
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
    expect(
      classifySessionProtection(
        JSON.stringify({ coopRun: { version: 1, runId: "run-incomplete-123456789", checkpointRevision: 0 } }),
      ),
      "a valid-looking run id without the complete resume surface remains recoverable as legacy co-op",
    ).toBe("coop-invalid");
  });

  it("accepts only the complete canonical resume commitment for the authenticated participant", () => {
    const valid = session("run-structural-123456789", 0);
    expect(parseValidResumableCoopSession(valid, "alice")).toMatchObject({
      runId: "run-structural-123456789",
      checkpointRevision: 0,
      players: ["Alice", "Bob"],
    });
    const invalidMaterializationCases: [string, (value: Record<string, any>) => void][] = [
      ["empty player party", value => (value.party = [])],
      ["object-shaped player placeholder", value => (value.party = [{}])],
      ["empty enemy party outside a non-battle Mystery Event", value => (value.enemyParty = [])],
      [
        "Mystery Event without its executable event type",
        value => {
          value.battleType = 3;
          value.mysteryEncounterType = -1;
          value.enemyParty = [];
        },
      ],
      ["object-shaped enemy placeholder", value => (value.enemyParty = [{}])],
      [
        "party entry on the wrong side",
        value => {
          value.party[0].player = false;
        },
      ],
      [
        "missing Pokemon species",
        value => {
          delete value.party[0].species;
        },
      ],
      [
        "unknown Pokemon species id",
        value => {
          value.party[0].species = 999_999;
        },
      ],
      [
        "short Pokemon stat vector",
        value => {
          value.party[0].stats = [1, 2, 3];
        },
      ],
      [
        "malformed move",
        value => {
          value.party[0].moveset = [{}];
        },
      ],
      [
        "trainer battle without trainer materialization data",
        value => {
          value.battleType = 1;
          value.trainer = null;
        },
      ],
      [
        "trainer battle with an unknown trainer type",
        value => {
          value.battleType = 1;
          value.trainer = { trainerType: 299, variant: 0 };
        },
      ],
      ["game version that makes compare-versions throw", value => (value.gameVersion = "not-a-version")],
      ["unknown biome that Arena cannot construct", value => (value.arena.biome = 999)],
      ["unknown challenge that copyChallenge cannot construct", value => (value.challenges = [{}])],
      ["unknown positional tag constructor", value => (value.arena.positionalTags = [{}])],
    ];
    for (const [label, mutate] of invalidMaterializationCases) {
      const candidate = JSON.parse(valid) as Record<string, any>;
      mutate(candidate);
      expect(parseValidResumableCoopSession(JSON.stringify(candidate), "Alice"), label).toBeNull();
      expect(classifySessionProtection(JSON.stringify(candidate)), `${label} remains exactly recoverable`).toBe(
        "coop-invalid",
      );
    }
    const nonBattleMysteryCheckpoint = JSON.parse(valid);
    nonBattleMysteryCheckpoint.battleType = 3;
    nonBattleMysteryCheckpoint.mysteryEncounterType = 0;
    nonBattleMysteryCheckpoint.enemyParty = [];
    expect(
      parseValidResumableCoopSession(JSON.stringify(nonBattleMysteryCheckpoint), "Alice"),
      "a non-battle Mystery Event is the only legitimate empty-enemy materialization boundary",
    ).toMatchObject({ runId: "run-structural-123456789" });
    expect(parseValidResumableCoopSession(valid, "Mallory"), "the account must own one participant seat").toBeNull();
    expect(
      parseValidResumableCoopSession(
        JSON.stringify({
          ...JSON.parse(valid),
          coopParticipants: {
            version: 1,
            players: ["Bob", "Alice"],
            seats: { host: "Alice", guest: "Bob" },
          },
        }),
        "Alice",
      ),
      "participants must use the deterministic canonical order",
    ).toBeNull();
    expect(
      parseValidResumableCoopSession(
        JSON.stringify({
          ...JSON.parse(valid),
          coopParticipants: {
            version: 1,
            players: ["Alice", "Bob"],
            seats: { host: "Alice", guest: "Mallory" },
          },
        }),
        "Alice",
      ),
      "both stable seats must map exactly onto the participant pair",
    ).toBeNull();
    expect(
      parseValidResumableCoopSession(JSON.stringify({ ...JSON.parse(valid), timestamp: undefined }), "Alice"),
    ).toBeNull();
    expect(
      parseValidResumableCoopSession(
        JSON.stringify({
          gameMode: 6,
          waveIndex: 1,
          timestamp: 1,
          coopRun: { version: 1, runId: "run-truncated-123456789", checkpointRevision: 0 },
          coopParticipants: {
            version: 1,
            players: ["Alice", "Bob"],
            seats: { host: "Alice", guest: "Bob" },
          },
        }),
        "Alice",
      ),
      "metadata without the mandatory browser materialization surface is not resumable",
    ).toBeNull();
    expect(
      classifySessionProtection(
        JSON.stringify({
          gameMode: 6,
          waveIndex: 1,
          timestamp: 1,
          coopRun: { version: 1, runId: "run-truncated-123456789", checkpointRevision: 0 },
          coopParticipants: {
            version: 1,
            players: ["Alice", "Bob"],
            seats: { host: "Alice", guest: "Bob" },
          },
        }),
      ),
      "a truncated checkpoint remains eligible for exact legacy recovery",
    ).toBe("coop-invalid");
    expect(
      parseValidResumableCoopSession(
        session("run-empty-identity-123456789", 0, 1, ["", "Alice"], { host: "", guest: "Alice" }),
        "Alice",
      ),
    ).toBeNull();
    expect(
      parseValidResumableCoopSession(
        session("run-nfkc-collision-123456789", 0, 1, ["Alice", "Ａlice"], { host: "Alice", guest: "Ａlice" }),
        "Alice",
      ),
      "two distinct account keys may not collapse onto one co-op wire identity",
    ).toBeNull();
    expect(
      parseValidResumableCoopSession(
        session("run-seat-alias-123456789", 0, 1, ["Alice", "Bob"], { host: "Ａlice", guest: "Bob" }),
        "Alice",
      ),
      "seat identities must use the same account keys as the participant pair",
    ).toBeNull();
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

  it("keeps a missing CAS read distinct from savedata and preserves its HTTP status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Session not found.", { status: 404 })));
    await expect(api.getCoopCas({ clientSessionId: "client", slot: 0 })).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Session not found.",
      failureKind: "missing",
    });
  });

  it("sends exact duplicate and survivor commitments only to the recovery endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      api.deleteCoopDuplicateExact({
        clientSessionId: "client",
        slot: 0,
        coopCasRunId: "run-duplicate-http-123456789",
        coopCasCheckpointRevision: 2,
        coopCasDigest: "a".repeat(64),
        survivorSlot: 4,
        survivorCheckpointRevision: 3,
        survivorDigest: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ ok: true, status: 200 });
    const requested = String(fetchMock.mock.calls[0][0]);
    expect(requested).toContain("/savedata/session/coop-duplicate-exact-delete?");
    expect(requested).toContain("slot=0");
    expect(requested).toContain("survivorSlot=4");
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
