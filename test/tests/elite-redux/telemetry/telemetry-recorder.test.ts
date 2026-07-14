/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Engine-free unit tests for the client telemetry recorder/queue/state (#player-telemetry). These import
// ONLY the pure telemetry modules (no GameManager, no globalScene, no co-op engine) - they exercise the
// (state, action) snapshot shape, event capture, the durable-queue batching + flush triggers, ring/size
// eviction, and next-session recovery, all against an in-memory store + a fake upload.

import {
  DEFAULT_TELEMETRY_QUEUE_CONFIG,
  TelemetryQueue,
  type TelemetryUpload,
} from "#data/elite-redux/telemetry/telemetry-queue";
import type {
  TelemetryBatch,
  TelemetryEvent,
  TelemetrySessionEnvelope,
} from "#data/elite-redux/telemetry/telemetry-schema";
import { TELEMETRY_SCHEMA_VERSION } from "#data/elite-redux/telemetry/telemetry-schema";
import { snapshotBattleState, snapshotMon, type TelemetryMonSource } from "#data/elite-redux/telemetry/telemetry-state";
import { MemoryTelemetryStore } from "#data/elite-redux/telemetry/telemetry-store";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Fakes.
// ---------------------------------------------------------------------------

function fakeMon(overrides: Partial<Record<string, unknown>> = {}): TelemetryMonSource {
  const base = {
    species: { speciesId: 25 },
    formIndex: 0,
    level: 50,
    hp: 100,
    getMaxHp: () => 120,
    status: { effect: 3 },
    getStatStages: () => [1, 0, -1, 0, 2, 0, 0],
    getAbility: () => ({ id: 9 }),
    getPassiveAbilities: () => [{ id: 11 }, null, { id: 12 }],
    getHeldItems: () => [{ type: { id: "LEFTOVERS" } }],
    getMoveset: () => [{ moveId: 85, ppUsed: 2, getMove: () => ({ type: 13, power: 90 }), getMovePp: () => 15 }, null],
    isActive: () => true,
  };
  return { ...base, ...overrides } as unknown as TelemetryMonSource;
}

function envelope(sessionId = "sess-1", mode: "solo" | "coop" | "showdown" = "solo"): TelemetrySessionEnvelope {
  return {
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    sessionId,
    playerIdHash: "abcd1234",
    build: "0.0.5.6",
    erVersion: "0.0.5.6",
    mode,
    gameModeId: 0,
    seed: "SEED123",
    difficulty: "elite",
    startedAt: 1000,
  };
}

function decisionEvent(wave: number): TelemetryEvent {
  return {
    kind: "battle_decision",
    t: 1,
    wave,
    actor: "self",
    slotFieldIndex: 0,
    state: {
      wave,
      biome: 1,
      turn: 0,
      weather: null,
      terrain: null,
      player: [],
      enemy: [],
    },
    action: { kind: "move", moveIndex: 0, moveId: 85, target: 2 },
  };
}

// ---------------------------------------------------------------------------
// State snapshot (ML (state, action) shape).
// ---------------------------------------------------------------------------

describe("telemetry state snapshot", () => {
  it("captures the full ML mon state incl. ER innates, held items and featurized moves", () => {
    const mon = snapshotMon(fakeMon(), "self");
    expect(mon).toMatchObject({
      species: 25,
      form: 0,
      level: 50,
      hp: 100,
      maxHp: 120,
      status: 3,
      statStages: [1, 0, -1, 0, 2, 0, 0],
      ability: 9,
      innates: [11, null, 12],
      heldItems: ["LEFTOVERS"],
      active: true,
      fainted: false,
      actor: "self",
    });
    expect(mon.moves).toEqual([{ move: 85, type: 13, power: 90, ppUsed: 2, maxPp: 15 }]);
  });

  it("marks a 0-hp mon fainted and never throws on a partially-initialized mon", () => {
    const broken = {
      species: { speciesId: 1 },
      formIndex: 0,
      level: 5,
      hp: 0,
      getMaxHp: () => {
        throw new Error("boom");
      },
      status: null,
      getStatStages: () => [0, 0, 0, 0, 0, 0, 0],
      getAbility: () => ({ id: 1 }),
      getHeldItems: () => [],
      getMoveset: () => [],
      isActive: () => false,
    } as unknown as TelemetryMonSource;
    const mon = snapshotMon(broken);
    expect(mon.fainted).toBe(true);
    expect(mon.maxHp).toBe(0); // getMaxHp threw -> safe default, no throw
    expect(mon.actor).toBeUndefined();
  });

  it("builds a both-sides battle state with a co-op owner resolver", () => {
    const state = snapshotBattleState(
      [fakeMon(), fakeMon()],
      [fakeMon()],
      { wave: 7, biome: 3, turn: 2, weather: 1, terrain: null },
      m => (m === undefined ? undefined : "partner"),
    );
    expect(state.wave).toBe(7);
    expect(state.player).toHaveLength(2);
    expect(state.enemy).toHaveLength(1);
    expect(state.player[0].actor).toBe("partner");
    expect(state.enemy[0].actor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Queue: capture, batching, flush triggers, eviction, recovery.
// ---------------------------------------------------------------------------

describe("telemetry queue", () => {
  let store: MemoryTelemetryStore;
  let uploads: TelemetryBatch[];
  let upload: TelemetryUpload;
  let uploadOk: boolean;

  beforeEach(() => {
    store = new MemoryTelemetryStore();
    uploads = [];
    uploadOk = true;
    upload = vi.fn((batch: TelemetryBatch) => {
      uploads.push(batch);
      return Promise.resolve(uploadOk);
    });
  });

  it("does NOT flush before any trigger is met, but persists events durably", async () => {
    const q = new TelemetryQueue(store, envelope(), upload, DEFAULT_TELEMETRY_QUEUE_CONFIG, () => 5000);
    for (let w = 1; w <= 3; w++) {
      q.enqueue(decisionEvent(w));
    }
    await q.maybeFlush(3); // wave delta 3 < 10, time 0, size tiny -> no flush
    expect(uploads).toHaveLength(0);
    await q.persist();
    expect(await store.totalBytes()).toBeGreaterThan(0);
  });

  it("flushes at the wave-interval boundary and removes uploaded events from the store", async () => {
    const q = new TelemetryQueue(store, envelope(), upload, DEFAULT_TELEMETRY_QUEUE_CONFIG, () => 5000);
    for (let w = 1; w <= 11; w++) {
      q.enqueue(decisionEvent(w));
    }
    await q.maybeFlush(11); // 11 - 0 >= 10 -> flush
    expect(uploads).toHaveLength(1);
    expect(uploads[0].events).toHaveLength(11);
    expect(uploads[0].envelope.sessionId).toBe("sess-1");
    expect(await store.totalBytes()).toBe(0); // removed on success
  });

  it("flushes on the time boundary", async () => {
    let now = 0;
    const q = new TelemetryQueue(store, envelope(), upload, DEFAULT_TELEMETRY_QUEUE_CONFIG, () => now);
    q.enqueue(decisionEvent(1));
    now = DEFAULT_TELEMETRY_QUEUE_CONFIG.flushIntervalMs + 1;
    await q.maybeFlush(1);
    expect(uploads).toHaveLength(1);
  });

  it("flushes on the size threshold", async () => {
    const cfg = { ...DEFAULT_TELEMETRY_QUEUE_CONFIG, sizeThresholdBytes: 500 };
    const q = new TelemetryQueue(store, envelope(), upload, cfg, () => 5000);
    for (let i = 0; i < 50; i++) {
      q.enqueue(decisionEvent(1));
    }
    await q.maybeFlush(1); // pendingBytes now well over 500
    expect(uploads).toHaveLength(1);
  });

  it("keeps events durable when upload fails (at-least-once) and retries later", async () => {
    const q = new TelemetryQueue(store, envelope(), upload, DEFAULT_TELEMETRY_QUEUE_CONFIG, () => 5000);
    uploadOk = false;
    for (let w = 1; w <= 11; w++) {
      q.enqueue(decisionEvent(w));
    }
    await q.flush(11);
    expect(uploads).toHaveLength(1);
    expect(await store.totalBytes()).toBeGreaterThan(0); // NOT removed - upload failed
    uploadOk = true;
    await q.flush(11);
    expect(await store.totalBytes()).toBe(0); // retried + removed
  });

  it("caps local retention with oldest-first eviction", async () => {
    const cfg = { ...DEFAULT_TELEMETRY_QUEUE_CONFIG, maxLocalBytes: 2000 };
    const q = new TelemetryQueue(store, envelope(), upload, cfg, () => 5000);
    for (let i = 0; i < 200; i++) {
      q.enqueue(decisionEvent(i));
    }
    await q.persist();
    expect(await store.totalBytes()).toBeLessThanOrEqual(2000);
  });

  it("bounds the in-memory beacon tail and fires a beacon batch on session end", async () => {
    const cfg = { ...DEFAULT_TELEMETRY_QUEUE_CONFIG, maxBeaconTailBytes: 1500 };
    const q = new TelemetryQueue(store, envelope(), upload, cfg, () => 5000);
    for (let i = 0; i < 100; i++) {
      q.enqueue(decisionEvent(i));
    }
    q.flushBeacon();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].events.length).toBeGreaterThan(0);
    // The beacon batch was bounded (tail eviction kept it small).
    const beaconBytes = JSON.stringify(uploads[0].events).length;
    expect(beaconBytes).toBeLessThanOrEqual(2500);
  });

  it("recovers a PREVIOUS session's unflushed events on the next session (boot recovery)", async () => {
    // Simulate a prior crashed session that persisted events but never flushed.
    const prior = envelope("sess-OLD", "coop");
    await store.saveEnvelope(prior);
    await store.append([
      { sessionId: "sess-OLD", mode: "coop", wave: 4, t: 1, bytes: 50, event: decisionEvent(4) },
      { sessionId: "sess-OLD", mode: "coop", wave: 5, t: 2, bytes: 50, event: decisionEvent(5) },
    ]);
    // A NEW session boots and runs recovery.
    const q = new TelemetryQueue(
      store,
      envelope("sess-NEW", "solo"),
      upload,
      DEFAULT_TELEMETRY_QUEUE_CONFIG,
      () => 9000,
    );
    await q.recover();
    expect(uploads).toHaveLength(1);
    expect(uploads[0].envelope.sessionId).toBe("sess-OLD"); // recovered under the ORIGINAL session id
    expect(uploads[0].envelope.mode).toBe("coop"); // and original mode -> correct R2 key partition
    expect(await store.readSession("sess-OLD", 100)).toHaveLength(0); // drained after successful upload
  });

  it("keeps recovery events durable when the recovery upload fails", async () => {
    await store.append([{ sessionId: "sess-OLD", mode: "solo", wave: 1, t: 1, bytes: 50, event: decisionEvent(1) }]);
    uploadOk = false;
    const q = new TelemetryQueue(store, envelope("sess-NEW"), upload, DEFAULT_TELEMETRY_QUEUE_CONFIG, () => 9000);
    await q.recover();
    expect(await store.readSession("sess-OLD", 100)).toHaveLength(1); // untouched, retried next boot
  });
});
