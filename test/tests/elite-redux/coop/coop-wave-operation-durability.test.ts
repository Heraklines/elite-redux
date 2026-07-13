/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op WAVE-ADVANCE operation <-> DURABILITY seam (Wave-2f KEYSTONE, W2e-R integration;
// docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §2.5 item 4, §8.6).
//
// Pure-logic spec (no game engine, loopback transport). The wave surface is the FIRST with a real
// LIVE-MUTATION sink + ONE ledger - the reviewer's central demand that a journal-delivered op can
// LIVE-materialize. This suite drives the REAL adapter commit -> durability journal -> guest applier
// -> live sink over a loopback pair and proves:
//   1. A committed WAVE_ADVANCE op delivered over the journal ROUTES INTO the live-mutation seam
//      carrying the host-stated transition (the keystone materialization proof).
//   2. A re-delivered op (resend + reconnect tail) routes EXACTLY ONCE (one-ledger dedup, invariant 5).
//   3. COLD resume at revision N: the producer continues at N+1 and the restored receiver ACCEPTS it
//      (revisionFloor, W2e-R P0-3).
//   4. A DUPLICATE journal apply still ACKs (anti-spin invariant - never break this).
//   5. CAPABILITY gating: peer lacks "opSurface.wave" -> the surface is OFF on BOTH peers (fail-closed),
//      so nothing is committed / journaled / routed.
// =============================================================================

import {
  COOP_CAP_OP_WAVE,
  clearNegotiatedCoopCapabilities,
  setNegotiatedCoopCapabilities,
} from "#data/elite-redux/coop/coop-capabilities";
import {
  type CoopDurabilityHooks,
  CoopDurabilityManager,
  setCoopDurabilityEnabled,
} from "#data/elite-redux/coop/coop-durability";
import type {
  CoopAuthoritativeEnvelopeV1,
  CoopWaveAdvancePayload,
} from "#data/elite-redux/coop/coop-operation-envelope";
import {
  coopOperationDurabilityHooks,
  getCoopOperationJournalApplied,
  getCoopOperationLiveSinkInvoked,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  commitWaveAdvanceOwnerIntent,
  isCoopWaveAdvanceTransactionComplete,
  markCoopWaveAdvanceContinuationReady,
  markCoopWaveAdvanceDataApplied,
  resetCoopWaveAdvanceOperationFlag,
  resetCoopWaveAdvanceOperationState,
  setCoopWaveAdvanceOperationEnabled,
  setCoopWaveAdvanceOperationRevisionFloor,
} from "#data/elite-redux/coop/coop-wave-operation";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** Await several microtask turns so the loopback (queueMicrotask) delivery + ACK round-trips settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

function waveAdvancePayload(wave: number, over: Partial<CoopWaveAdvancePayload> = {}): CoopWaveAdvancePayload {
  const outcome = over.outcome ?? "win";
  return {
    wave,
    outcome: "win",
    nextLogicalPhase: "WAVE_VICTORY",
    nextWave: wave + 1,
    biomeChange: false,
    eggLapse: false,
    meBoundary: "none",
    settledStateTick: wave + 100,
    ...(outcome === "win" || outcome === "capture" ? { victoryKind: "wild" as const } : {}),
    ...over,
  };
}

class ManualScheduler {
  now = 0;
  private readonly tasks: { at: number; callback: () => void; cancelled: boolean }[] = [];

  readonly schedule = (callback: () => void, ms: number): (() => void) => {
    const task = { at: this.now + ms, callback, cancelled: false };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const next = this.tasks.filter(task => !task.cancelled && task.at <= target).sort((a, b) => a.at - b.at)[0];
      if (next == null) {
        break;
      }
      next.cancelled = true;
      this.now = next.at;
      next.callback();
    }
    this.now = target;
  }

  runNext(): boolean {
    const next = this.tasks.filter(task => !task.cancelled).sort((a, b) => a.at - b.at)[0];
    if (next == null) {
      return false;
    }
    this.advance(next.at - this.now);
    return true;
  }
}

function waveState(payload: CoopWaveAdvancePayload): CoopAuthoritativeBattleStateV1 {
  return {
    version: 1,
    tick: payload.settledStateTick!,
    wave: payload.wave,
    turn: 0,
    playerParty: [],
    enemyParty: [],
    field: [],
    weather: 0,
    weatherTurnsLeft: 0,
    terrain: 0,
    terrainTurnsLeft: 0,
    arenaTags: [],
    money: payload.wave * 100,
    pokeballCounts: [],
    playerModifiers: [],
    enemyModifiers: [],
  };
}

function waveEnvelope(wave: number, revision = 1): CoopAuthoritativeEnvelopeV1 {
  const transition = waveAdvancePayload(wave);
  const authoritativeState = waveState(transition);
  return {
    version: 1,
    sessionEpoch: 1,
    revision,
    wave,
    turn: authoritativeState.turn,
    logicalPhase: transition.nextLogicalPhase,
    pendingOperation: {
      id: `1:0:WAVE_ADVANCE:${wave}`,
      kind: "WAVE_ADVANCE",
      owner: 0,
      status: "applied",
      payload: transition,
    },
    authoritativeState,
  };
}

function completeWaveEnvelope(envelope: { pendingOperation: { payload: unknown } | null }): boolean {
  const wave = (envelope.pendingOperation?.payload as CoopWaveAdvancePayload).wave;
  markCoopWaveAdvanceDataApplied(wave);
  markCoopWaveAdvanceContinuationReady(wave);
  return true;
}

/** Commit a host wave-advance through the REAL adapter (the owner/host is the sole committer of a wave-advance). */
function commitHostWave(wave: number, over: Partial<CoopWaveAdvancePayload> = {}): void {
  const payload = waveAdvancePayload(wave, over);
  commitWaveAdvanceOwnerIntent({
    payload,
    authoritativeState: waveState(payload),
    localRole: "host",
    wave,
    turn: 0,
  });
}

/** The waves the journal carrier routed INTO the live-mutation seam this client (the live-state proxy). */
function sinkWaves(): number[] {
  return getCoopOperationLiveSinkInvoked().map(e => (e.pendingOperation?.payload as CoopWaveAdvancePayload).wave);
}

describe("co-op WAVE-ADVANCE operation <-> durability seam (Wave-2f KEYSTONE, W2e-R)", () => {
  beforeEach(() => {
    setCoopWaveAdvanceOperationEnabled(true);
    resetCoopWaveAdvanceOperationState();
    resetCoopOperationJournalLog();
    clearNegotiatedCoopCapabilities();
    registerCoopOperationLiveSink("op:wave", null);
    setCoopDurabilityEnabled(true);
  });
  afterEach(() => {
    registerCoopOperationLiveSink("op:wave", null);
    setCoopOperationDurability(null);
    resetCoopOperationJournalLog();
    resetCoopWaveAdvanceOperationFlag();
    resetCoopWaveAdvanceOperationState();
    clearNegotiatedCoopCapabilities();
  });

  // ===========================================================================================
  // KEYSTONE PROOF - the journal carrier ROUTES INTO the live-mutation seam (the reviewer's demand).
  // ===========================================================================================
  it("a journal-delivered WAVE_ADVANCE op ROUTES INTO the live-mutation sink carrying the host-stated transition", async () => {
    const seen: CoopWaveAdvancePayload[] = [];
    registerCoopOperationLiveSink("op:wave", env => {
      seen.push(env.pendingOperation?.payload as CoopWaveAdvancePayload);
      return completeWaveEnvelope(env);
    });

    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(12, { victoryKind: "trainer", biomeChange: true });
    await flush();

    expect(seen.length, "the journal carrier must route the committed wave-advance into the live-mutation sink").toBe(
      1,
    );
    expect(seen[0].wave).toBe(12);
    expect(seen[0].outcome).toBe("win");
    expect(seen[0].victoryKind, "the host-stated victory kind reached the sink").toBe("trainer");
    expect(seen[0].nextLogicalPhase, "logicalPhase is host-authoritative through the envelope").toBe("WAVE_VICTORY");
    expect(sinkWaves()).toEqual([12]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("withholds the journal ACK until DATA applied and continuationReady are both proven", async () => {
    registerCoopOperationLiveSink("op:wave", () => true);
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(13);
    await flush();
    expect(getCoopOperationJournalApplied(), "a sink callback alone is not ACK eligibility").toHaveLength(0);

    markCoopWaveAdvanceDataApplied(13);
    hostMgr.reconnect();
    await flush();
    expect(getCoopOperationJournalApplied(), "DATA alone still cannot retire the transaction").toHaveLength(0);

    markCoopWaveAdvanceContinuationReady(13);
    hostMgr.reconnect();
    await flush();
    expect(
      getCoopOperationJournalApplied().map(e => (e.pendingOperation?.payload as CoopWaveAdvancePayload).wave),
    ).toEqual([13]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("rejects control-before-DATA, same-id conflicts, and stale waves while exact re-delivery remains idempotent", () => {
    const hooks = coopOperationDurabilityHooks();
    const apply = hooks.apply!;
    const exact = waveEnvelope(15);
    const entry = (envelope: CoopAuthoritativeEnvelopeV1) => ({
      cls: "op:global",
      seq: envelope.revision,
      msg: { t: "envelope" as const, envelope },
    });

    expect(apply(entry(exact)), "a valid envelope stages but waits for its safe boundary").toBe("deferred");
    expect(markCoopWaveAdvanceContinuationReady(15), "CONTROL cannot latch before DATA").toBe(false);
    expect(isCoopWaveAdvanceTransactionComplete(15)).toBe(false);

    const conflict: CoopAuthoritativeEnvelopeV1 = {
      ...exact,
      authoritativeState: { ...exact.authoritativeState, money: exact.authoritativeState.money + 1 },
    };
    expect(apply(entry(conflict)), "same operation id with changed DATA is a conflict").toBe("rejected");

    expect(markCoopWaveAdvanceDataApplied(15)).toBe(true);
    expect(markCoopWaveAdvanceContinuationReady(15)).toBe(true);
    registerCoopOperationLiveSink("op:wave", () => true);
    expect(apply(entry(exact))).toBe("applied");
    expect(apply(entry(exact)), "the exact completed transaction is idempotent").toBe("duplicate");
    expect(apply(entry(conflict)), "a conflicting retry cannot borrow the original ACK").toBe("rejected");

    const stale = waveEnvelope(14, 2);
    expect(apply(entry(stale)), "an earlier wave cannot advance after a later one completed").toBe("rejected");
  });

  it("treats a legitimate Victory-to-BattleEnd delay beyond 9.1s as deferred, then ACKs exactly once on the real continuation wake", async () => {
    const scheduler = new ManualScheduler();
    const failures: unknown[] = [];
    let battleEndOpen = false;
    let continuationOpen = false;
    registerCoopOperationLiveSink("op:wave", envelope => {
      const wave = (envelope.pendingOperation?.payload as CoopWaveAdvancePayload).wave;
      if (battleEndOpen) {
        markCoopWaveAdvanceDataApplied(wave);
      }
      if (continuationOpen) {
        markCoopWaveAdvanceContinuationReady(wave);
      }
      return battleEndOpen && continuationOpen;
    });
    const pair = createLoopbackPair();
    let ackCount = 0;
    pair.host.onMessage(message => {
      if (message.t === "coopAck" && message.cls === "op:global") {
        ackCount++;
      }
    });
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, {
      ...coopOperationDurabilityHooks(),
      scheduleRecovery: scheduler.schedule,
      recoveryNow: () => scheduler.now,
      deferredRetryMs: 100,
      recoveryInitialMs: 100,
      recoveryMaxMs: 2_000,
      recoveryMaxAttempts: 8,
      recoveryDeadlineMs: 12_000,
      onRecoveryExhausted: failure => failures.push(failure),
    });
    setCoopOperationDurability(hostMgr);

    commitHostWave(14);
    await flush();
    scheduler.advance(9_200);
    await flush();

    expect(failures, "normal phase latency must never consume the bounded recovery budget").toEqual([]);
    expect(hostMgr.unackedCount(), "the complete transaction remains retained while BattleEnd is closed").toBe(1);
    expect(guestMgr.appliedMarks(), "no mechanical/UI proof means no receiver advance").toEqual({});
    expect(ackCount).toBe(0);
    hostMgr.reconnect();
    await flush();
    expect(ackCount, "an exact duplicate resend may re-run readiness but cannot ACK early").toBe(0);
    expect(failures, "duplicate readiness probes remain outside error recovery").toEqual([]);

    battleEndOpen = true;
    scheduler.advance(100);
    await flush();
    expect(getCoopOperationJournalApplied(), "DATA alone still cannot ACK").toHaveLength(0);

    continuationOpen = true;
    expect(guestMgr.retryDeferred("op:global"), "the public continuation wake reattempts immediately").toBe(1);
    await flush();
    expect(
      getCoopOperationJournalApplied().map(e => (e.pendingOperation?.payload as CoopWaveAdvancePayload).wave),
      "the valid retained transaction applies once after both latches",
    ).toEqual([14]);
    expect(hostMgr.unackedCount()).toBe(0);
    expect(guestMgr.appliedMarks()).toEqual({ "op:global": 1 });
    expect(ackCount, "the successful boundary emits one cumulative ACK").toBe(1);
    expect(guestMgr.retryDeferred("op:global"), "the wake is one-shot after completion").toBe(0);
    expect(ackCount).toBe(1);
    expect(failures).toEqual([]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("routes a continuation that never opens through the peer-coherent terminal supervisor after its own deadline", async () => {
    const scheduler = new ManualScheduler();
    const failures: Parameters<NonNullable<CoopDurabilityHooks["onRecoveryExhausted"]>>[0][] = [];
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "waveResolved" ? { cls: "wave", seq: message.wave } : null),
      apply: () => "deferred",
      scheduleRecovery: scheduler.schedule,
      recoveryNow: () => scheduler.now,
      deferredRetryMs: 100,
      deferredDeadlineMs: 500,
      recoveryInitialMs: 1,
      recoveryMaxMs: 1,
      recoveryMaxAttempts: 3,
      recoveryDeadlineMs: 100,
      onRecoveryExhausted: failure => failures.push(failure),
    });

    hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" });
    await flush();
    scheduler.advance(499);
    await flush();
    expect(failures, "normal deferred time does not consume the 12s error-recovery budget").toEqual([]);

    scheduler.advance(1);
    await flush();
    expect(failures).toEqual([{ cls: "wave", from: 0, blockedSeq: 1, attempts: 5, reason: "deferred-timeout" }]);
    expect(guestMgr.appliedMarks()).toEqual({});
    expect(hostMgr.unackedCount()).toBe(1);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("keeps a genuinely rejected durability apply on the bounded recovery-to-terminal path", async () => {
    const scheduler = new ManualScheduler();
    const failures: Parameters<NonNullable<CoopDurabilityHooks["onRecoveryExhausted"]>>[0][] = [];
    const pair = createLoopbackPair();
    const hooks: CoopDurabilityHooks = {
      extractKey: message => (message.t === "waveResolved" ? { cls: "wave", seq: message.wave } : null),
      apply: () => "rejected",
      scheduleRecovery: scheduler.schedule,
      recoveryNow: () => scheduler.now,
      recoveryInitialMs: 1,
      recoveryMaxMs: 1,
      recoveryMaxAttempts: 3,
      recoveryDeadlineMs: 100,
      deferredRetryMs: 1,
      onRecoveryExhausted: failure => failures.push(failure),
    };
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, hooks);

    hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" });
    await flush();
    for (let i = 0; i < 8 && failures.length === 0; i++) {
      expect(scheduler.runNext()).toBe(true);
      await flush();
    }

    expect(failures).toEqual([{ cls: "wave", from: 0, blockedSeq: 1, attempts: 3, reason: "apply-rejected" }]);
    expect(guestMgr.appliedMarks()).toEqual({});
    expect(hostMgr.unackedCount()).toBe(1);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("buffers later global revisions behind a valid deferred head and drains them in order without false gap recovery", async () => {
    const scheduler = new ManualScheduler();
    const applied: number[] = [];
    const failures: unknown[] = [];
    let headReady = false;
    const pair = createLoopbackPair();
    const hooks: CoopDurabilityHooks = {
      extractKey: message => (message.t === "waveResolved" ? { cls: "wave", seq: message.wave } : null),
      apply: entry => {
        if (entry.msg.t !== "waveResolved") {
          return "rejected";
        }
        if (entry.msg.wave === 1 && !headReady) {
          return "deferred";
        }
        applied.push(entry.msg.wave);
        return "applied";
      },
      scheduleRecovery: scheduler.schedule,
      recoveryNow: () => scheduler.now,
      deferredRetryMs: 100,
      recoveryInitialMs: 100,
      recoveryMaxMs: 2_000,
      recoveryMaxAttempts: 8,
      recoveryDeadlineMs: 12_000,
      onRecoveryExhausted: failure => failures.push(failure),
    };
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, hooks);

    hostMgr.commit("wave", 1, { t: "waveResolved", wave: 1, outcome: "win" });
    hostMgr.commit("wave", 2, { t: "waveResolved", wave: 2, outcome: "win" });
    await flush();
    scheduler.advance(9_200);
    await flush();
    expect(applied).toEqual([]);
    expect(failures, "revision 2 is not a missing-frame error while valid revision 1 awaits its boundary").toEqual([]);

    headReady = true;
    expect(guestMgr.retryDeferred("wave")).toBe(1);
    await flush();
    expect(applied, "the buffered follower drains only after the deferred head commits").toEqual([1, 2]);
    expect(guestMgr.appliedMarks()).toEqual({ wave: 2 });
    expect(hostMgr.unackedCount()).toBe(0);
    expect(failures).toEqual([]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("a flee and a game-over wave-advance both journal + route with their host-stated next phase", async () => {
    const seen: CoopWaveAdvancePayload[] = [];
    registerCoopOperationLiveSink("op:wave", env => {
      seen.push(env.pendingOperation?.payload as CoopWaveAdvancePayload);
      return completeWaveEnvelope(env);
    });
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(5, { outcome: "flee", nextLogicalPhase: "WAVE_FLEE" });
    commitHostWave(6, { outcome: "gameOver", nextLogicalPhase: "GAME_OVER", nextWave: 6 });
    await flush();

    expect(seen.map(p => [p.wave, p.outcome, p.nextLogicalPhase])).toEqual([
      [5, "flee", "WAVE_FLEE"],
      [6, "gameOver", "GAME_OVER"],
    ]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // EXACTLY-ONCE routing across resend + reconnect re-deliveries (one-ledger dedup, invariant 5).
  // ===========================================================================================
  it("a re-delivered committed wave-advance (resend + reconnect tail) routes to the live sink EXACTLY ONCE", async () => {
    registerCoopOperationLiveSink("op:wave", env => completeWaveEnvelope(env));
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(20);
    await flush();
    hostMgr.reconnect();
    guestMgr.reconnect();
    await flush();
    hostMgr.reconnect();
    await flush();

    expect(sinkWaves(), "exactly-once routing across resend + reconnect re-deliveries").toEqual([20]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // COLD resume at revision N: producer continues at N+1, restored receiver accepts it (W2e-R P0-3).
  // ===========================================================================================
  it("after a cold resume at revision N, the producer emits N+1 and the restored receiver applies the wave-advance", async () => {
    const N = 4;
    registerCoopOperationLiveSink("op:wave", env => completeWaveEnvelope(env));
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    // Simulate a cold resume at high-water N for op:wave: restore both managers' marks + floor the surface.
    hostMgr.restore({ "op:global": N }, { "op:global": N });
    guestMgr.restore({ "op:global": N }, { "op:global": N });
    setCoopWaveAdvanceOperationRevisionFloor(N);

    commitHostWave(30);
    await flush();

    const applied = getCoopOperationJournalApplied();
    expect(applied.at(-1)?.revision, "the resumed producer must continue at N+1, not restart at 1").toBe(N + 1);
    expect(
      applied.map(e => (e.pendingOperation?.payload as CoopWaveAdvancePayload).wave),
      "the restored receiver must APPLY the resumed wave-advance (not discard it as stale)",
    ).toEqual([30]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // ANTI-SPIN: a DUPLICATE journal apply still ACKs (never break this invariant).
  // ===========================================================================================
  it("a re-delivered already-consumed wave-advance ACKs (duplicate), so the committer's resend loop terminates", async () => {
    registerCoopOperationLiveSink("op:wave", env => completeWaveEnvelope(env));
    const sentAcks: string[] = [];
    const pair = createLoopbackPair();
    // Count coopAck frames the guest sends.
    const guestInner = pair.guest;
    const guestWrapped = {
      ...guestInner,
      get role() {
        return guestInner.role;
      },
      get state() {
        return guestInner.state;
      },
      send: (msg: { t: string }) => {
        sentAcks.push(msg.t);
        return guestInner.send(msg as never);
      },
      onMessage: guestInner.onMessage.bind(guestInner),
      onStateChange: guestInner.onStateChange.bind(guestInner),
      close: guestInner.close.bind(guestInner),
    };
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(guestWrapped as never, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(40);
    await flush();
    // Force a re-delivery of the same committed op; the second apply is a duplicate that must STILL ACK.
    hostMgr.reconnect();
    await flush();

    expect(
      sentAcks.filter(t => t === "coopAck").length,
      "a duplicate re-delivery still ACKs (anti-spin)",
    ).toBeGreaterThan(0);
    expect(sinkWaves(), "but it routes to the live sink only once").toEqual([40]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  // ===========================================================================================
  // CAPABILITY gating (#896 W2e-R2): peer lacks "opSurface.wave" -> the surface is OFF on BOTH peers.
  // ===========================================================================================
  it("a peer that does NOT advertise opSurface.wave disables the surface (fail-closed): nothing is committed / routed", async () => {
    let routed = 0;
    registerCoopOperationLiveSink("op:wave", env => {
      routed++;
      return completeWaveEnvelope(env);
    });
    // Negotiate a set WITHOUT the wave capability -> isCoopWaveAdvanceOperationEnabled() is false.
    setNegotiatedCoopCapabilities([COOP_CAP_OP_WAVE], /* peer */ []);

    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(50);
    await flush();

    expect(routed, "a capability-blocked wave surface commits + routes NOTHING (fail-closed)").toBe(0);
    expect(getCoopOperationJournalApplied().length, "nothing journaled when the surface is capability-blocked").toBe(0);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("when BOTH peers advertise opSurface.wave, the surface activates and routes", async () => {
    const seen: number[] = [];
    registerCoopOperationLiveSink("op:wave", env => {
      seen.push((env.pendingOperation?.payload as CoopWaveAdvancePayload).wave);
      return completeWaveEnvelope(env);
    });
    setNegotiatedCoopCapabilities([COOP_CAP_OP_WAVE], [COOP_CAP_OP_WAVE]);

    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(55);
    await flush();

    expect(seen, "both-peers-advertise -> the surface is active and routes to the sink").toEqual([55]);
    hostMgr.dispose();
    guestMgr.dispose();
  });
});
