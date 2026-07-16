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
import { createCoopRuntimeOpState, setActiveCoopRuntimeOpState } from "#data/elite-redux/coop/coop-operation-runtime";
import type { CoopAuthoritativeBattleStateV1, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  applyCoopWaveAdvanceEnvelopeForBinding,
  captureCoopWaveAdvanceOperationBinding,
  commitWaveAdvanceOwnerIntent,
  getCoopStagedWaveAdvanceTransaction,
  isCoopWaveAdvanceTransactionComplete,
  markCoopWaveAdvanceContinuationReady,
  markCoopWaveAdvanceDataApplied,
  registerCoopWaveAdvanceBoundaryDataApplier,
  resetCoopWaveAdvanceOperationFlag,
  resetCoopWaveAdvanceOperationState,
  setCoopWaveAdvanceOperationEnabled,
  setCoopWaveAdvanceOperationRevisionFloor,
  tryApplyCoopWaveAdvanceDataAtBoundary,
} from "#data/elite-redux/coop/coop-wave-operation";
import { classifyRetainedWaveStateAdmission } from "#phases/battle-end-phase";
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
  let restoreBoundaryApplier: (() => void) | null;

  beforeEach(() => {
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
    restoreBoundaryApplier = null;
    setCoopWaveAdvanceOperationEnabled(true);
    resetCoopWaveAdvanceOperationState();
    resetCoopOperationJournalLog();
    clearNegotiatedCoopCapabilities();
    registerCoopOperationLiveSink("op:wave", null);
    setCoopDurabilityEnabled(true);
  });

  it("releases an older retained DATA obligation after a newer recovery image without authorizing rollback", () => {
    expect(classifyRetainedWaveStateAdmission(false, 40, 38)).toBe("superseded");
    expect(classifyRetainedWaveStateAdmission(false, 38, 38)).toBe("reapply");
    expect(classifyRetainedWaveStateAdmission(false, 37, 38)).toBe("rejected");
  });
  afterEach(() => {
    restoreBoundaryApplier?.();
    registerCoopOperationLiveSink("op:wave", null);
    setCoopOperationDurability(null);
    resetCoopOperationJournalLog();
    resetCoopWaveAdvanceOperationFlag();
    resetCoopWaveAdvanceOperationState();
    setActiveCoopRuntimeOpState(null);
    clearNegotiatedCoopCapabilities();
  });

  // ===========================================================================================
  // KEYSTONE PROOF - the journal carrier ROUTES INTO the live-mutation seam (the reviewer's demand).
  // ===========================================================================================
  it("keeps captured authority durability and receiver receipts isolated across two runtimes", () => {
    // Role-neutral engine-test records deliberately bypass the temporary legacy global-clock bridge. The
    // binding's explicit role fences are covered in coop-wave-operation.test.ts; this proof targets the
    // stronger property that the wave surface, its retained durability and its receipts do not consult the
    // ambient runtime.
    const hostState = createCoopRuntimeOpState();
    const ambientState = createCoopRuntimeOpState();
    const hostPair = createLoopbackPair();
    const ambientPair = createLoopbackPair();
    const hostManager = new CoopDurabilityManager(hostPair.host);
    const ambientManager = new CoopDurabilityManager(ambientPair.host);

    setActiveCoopRuntimeOpState(hostState);
    setCoopOperationDurability(hostManager);
    const hostBinding = captureCoopWaveAdvanceOperationBinding("host");
    setActiveCoopRuntimeOpState(ambientState);
    setCoopOperationDurability(ambientManager);
    const transition = waveAdvancePayload(9);

    expect(
      commitWaveAdvanceOwnerIntent(
        {
          payload: transition,
          authoritativeState: waveState(transition),
          localRole: "host",
          wave: 9,
          turn: 0,
        },
        hostBinding,
      ),
      "a delayed host callback still commits through its captured runtime",
    ).not.toBeNull();
    expect(hostState.hostClock?.revision).toBe(1);
    expect(ambientState.hostClock, "the ambient peer's authority cursor remains untouched").toBeNull();
    expect(hostManager.unackedCount(), "the retained result belongs to the captured durability manager").toBe(1);
    expect(ambientManager.unackedCount(), "the ambient manager cannot borrow that result").toBe(0);

    hostManager.dispose();
    ambientManager.dispose();
    setCoopOperationDurability(null);

    const guestAState = createCoopRuntimeOpState();
    const guestBState = createCoopRuntimeOpState();
    setActiveCoopRuntimeOpState(guestAState);
    const guestA = captureCoopWaveAdvanceOperationBinding("guest");
    setActiveCoopRuntimeOpState(guestBState);
    const guestB = captureCoopWaveAdvanceOperationBinding("guest");
    const appliedBy: string[] = [];
    const boundaryReady = new Set<string>();
    registerCoopWaveAdvanceBoundaryDataApplier(() => {
      if (!boundaryReady.has("A")) {
        return "deferred";
      }
      appliedBy.push("A");
      return "applied";
    }, guestA);
    registerCoopWaveAdvanceBoundaryDataApplier(() => {
      if (!boundaryReady.has("B")) {
        return "deferred";
      }
      appliedBy.push("B");
      return "applied";
    }, guestB);
    const envelope = waveEnvelope(15);

    expect(
      applyCoopWaveAdvanceEnvelopeForBinding(envelope, guestA),
      "runtime A admits its own retained receipt while runtime B is ambient",
    ).toBe("applied");
    expect(getCoopStagedWaveAdvanceTransaction(15, guestA)?.dataApplied).toBe(false);
    expect(getCoopStagedWaveAdvanceTransaction(15, guestB), "runtime B cannot see A's retained receipt").toBeNull();
    expect(guestAState.guestClock?.revision).toBe(1);
    expect(guestBState.guestClock).toBeNull();
    expect(tryApplyCoopWaveAdvanceDataAtBoundary(15, guestB), "B cannot apply a transaction it never received").toBe(
      "deferred",
    );
    boundaryReady.add("A");
    expect(tryApplyCoopWaveAdvanceDataAtBoundary(15, guestA)).toBe("applied");
    expect(appliedBy).toEqual(["A"]);

    expect(
      applyCoopWaveAdvanceEnvelopeForBinding(envelope, guestB),
      "the same addressed result remains new to the independent receiver",
    ).toBe("applied");
    boundaryReady.add("B");
    expect(tryApplyCoopWaveAdvanceDataAtBoundary(15, guestB)).toBe("applied");
    expect(appliedBy).toEqual(["A", "B"]);
  });

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

  it("advances the shared cursor once the op is STAGED - DATA + continuation are tracked separately and never gate the cursor (invariant a: the reward-behind-wave-advance deadlock fix)", async () => {
    // The sink never signals ready here (a pre-BattleEnd guest: the boundary DATA cannot apply yet). Under the
    // OLD double-gate this returned "deferred" until DATA+continuationReady, holding the shared receive cursor
    // at this wave-advance and DEADLOCKING a same-boundary reward RESULT (op:global seq+1) that has to apply at
    // the pre-BattleEnd shop. The staged transaction ALREADY owns DATA (applied at the real BattleEnd) + the
    // continuation latch, so the journal cursor must advance at staging while host retention remains separate.
    registerCoopOperationLiveSink("op:wave", () => false);
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    commitHostWave(13);
    await flush();
    // The cursor advances at staging - so a LATER same-boundary op is not blocked behind this wave-advance...
    expect(
      getCoopOperationJournalApplied().map(e => (e.pendingOperation?.payload as CoopWaveAdvancePayload).wave),
      "the cursor advances at staging (no longer double-gated on DATA/continuation)",
    ).toEqual([13]);
    // ...WITHOUT the wave DATA having applied and WITHOUT the transaction being complete (invariant a).
    expect(
      getCoopStagedWaveAdvanceTransaction(13)?.dataApplied,
      "wave DATA has NOT applied at the cursor advance",
    ).toBe(false);
    expect(isCoopWaveAdvanceTransactionComplete(13), "the transaction is NOT complete - DATA is still pending").toBe(
      false,
    );

    // DATA applies + continuation latches SEPARATELY (invariant b), in the enforced order.
    expect(markCoopWaveAdvanceContinuationReady(13), "CONTROL cannot latch before DATA").toBe(false);
    expect(markCoopWaveAdvanceDataApplied(13)).toBe(true);
    expect(markCoopWaveAdvanceContinuationReady(13)).toBe(true);
    expect(isCoopWaveAdvanceTransactionComplete(13)).toBe(true);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("advances the cursor at staging, keeps DATA pending, id-dedupes exact + forged re-delivery, and rejects a stale wave", () => {
    // Pin the pre-BattleEnd state: the boundary adapter never admits DATA here, so dataApplied stays false
    // until this test explicitly marks it (isolates the assertion from Lane A's shared-module boundary applier).
    restoreBoundaryApplier = registerCoopWaveAdvanceBoundaryDataApplier(() => "deferred");
    registerCoopOperationLiveSink("op:wave", () => false); // pre-boundary: no immediate completion
    const hooks = coopOperationDurabilityHooks();
    const apply = hooks.apply!;
    const exact = waveEnvelope(15);
    const entry = (envelope: CoopAuthoritativeEnvelopeV1) => ({
      cls: "op:global",
      seq: envelope.revision,
      msg: { t: "envelope" as const, envelope },
    });

    // A valid envelope ADVANCES the shared cursor at staging (its DATA still applies later at BattleEnd)...
    expect(apply(entry(exact)), "a valid envelope advances the cursor at staging").toBe("applied");
    // ...but the transaction is NOT complete and its DATA has NOT applied (invariant a).
    expect(isCoopWaveAdvanceTransactionComplete(15)).toBe(false);
    expect(getCoopStagedWaveAdvanceTransaction(15)?.dataApplied).toBe(false);
    expect(markCoopWaveAdvanceContinuationReady(15), "CONTROL cannot latch before DATA").toBe(false);

    // Exact re-delivery is idempotent (id-dedupe) - never re-stages, never re-applies (invariant e).
    expect(apply(entry(exact)), "the exact op is idempotent after its cursor advance").toBe("duplicate");

    // A forged same-id envelope carrying DIFFERENT DATA can NEVER be APPLIED (it is id-deduped before staging),
    // so the retained DATA is intact - a forged retry cannot borrow the cursor advance to overwrite the state.
    const conflict: CoopAuthoritativeEnvelopeV1 = {
      ...exact,
      authoritativeState: { ...exact.authoritativeState, money: exact.authoritativeState.money + 1 },
    };
    expect(apply(entry(conflict)), "a forged same-id retry is never applied").not.toBe("applied");
    expect(
      getCoopStagedWaveAdvanceTransaction(15)?.envelope.authoritativeState.money,
      "the forgery did not overwrite the retained authoritative DATA",
    ).toBe(exact.authoritativeState.money);

    // DATA applies at the boundary, continuation latches (invariant b) - order still enforced.
    expect(markCoopWaveAdvanceDataApplied(15)).toBe(true);
    expect(markCoopWaveAdvanceContinuationReady(15)).toBe(true);
    expect(isCoopWaveAdvanceTransactionComplete(15)).toBe(true);

    // A stale earlier wave (wave < lastApplied) is refused - never a false advance of a completed later wave.
    const stale = waveEnvelope(14, 2);
    expect(apply(entry(stale)), "an earlier wave cannot advance after a later one").not.toBe("applied");
  });

  it("REFUSES a genuinely missing revision (a gap) - the cursor advance is conditional on the op being RECEIVED, never mere absence (invariant c)", () => {
    registerCoopOperationLiveSink("op:wave", () => false);
    const hooks = coopOperationDurabilityHooks();
    const apply = hooks.apply!;
    const entry = (envelope: CoopAuthoritativeEnvelopeV1) => ({
      cls: "op:global",
      seq: envelope.revision,
      msg: { t: "envelope" as const, envelope },
    });

    // revision 3 with NO revision 1/2 delivered first: the global guest cursor reports a GAP (rev > clock+1),
    // so the applier REFUSES it - the cursor is never advanced merely because the missing revs are absent; the
    // durability manager's gap path resyncs the hole. Fixing the deadlock did NOT weaken gap detection.
    const gapped = waveEnvelope(3, 3);
    expect(apply(entry(gapped)), "a revision hole is refused - advance requires RECEIVED, not absence").toBe(
      "rejected",
    );
    expect(getCoopOperationJournalApplied(), "nothing advances the cursor through a gap").toHaveLength(0);
    expect(getCoopStagedWaveAdvanceTransaction(3), "a gapped op is never staged").toBeNull();
  });

  it("a staged wave-advance that cannot reach its boundary still lets a LATER op advance the cursor, then applies its own DATA at the real boundary (invariants a + b end-to-end)", () => {
    const boundaryReadyWaves = new Set<number>();
    const admitted: number[] = [];
    restoreBoundaryApplier = registerCoopWaveAdvanceBoundaryDataApplier(envelope => {
      const wave = (envelope.pendingOperation?.payload as CoopWaveAdvancePayload).wave;
      if (!boundaryReadyWaves.has(wave)) {
        return "deferred"; // pre-BattleEnd: the scene is not at this wave's boundary yet
      }
      admitted.push(wave);
      return "applied";
    });
    // The sink completes only once its wave's DATA has been admitted at the boundary (mirrors production).
    registerCoopOperationLiveSink(
      "op:wave",
      env =>
        getCoopStagedWaveAdvanceTransaction((env.pendingOperation?.payload as CoopWaveAdvancePayload).wave)?.dataApplied
        === true,
    );
    const hooks = coopOperationDurabilityHooks();
    const apply = hooks.apply!;
    const entry = (envelope: CoopAuthoritativeEnvelopeV1) => ({
      cls: "op:global",
      seq: envelope.revision,
      msg: { t: "envelope" as const, envelope },
    });

    // wave 1 (rev 1) cannot reach its boundary yet -> it STILL advances the cursor (no deadlock)...
    expect(apply(entry(waveEnvelope(1, 1))), "wave 1 advances the cursor pre-boundary").toBe("applied");
    expect(getCoopStagedWaveAdvanceTransaction(1)?.dataApplied, "wave 1 DATA has NOT applied yet").toBe(false);
    // ...so the LATER op (rev 2) is NOT blocked behind it - it applies immediately (the deadlock is gone).
    expect(apply(entry(waveEnvelope(2, 2))), "the later op is not blocked behind the pre-boundary wave 1").toBe(
      "applied",
    );
    expect(admitted, "no wave DATA applied before its boundary").toEqual([]);

    // Reaching wave 1's real boundary admits its DATA exactly once (invariant b: at BattleEnd, never dropped).
    boundaryReadyWaves.add(1);
    expect(tryApplyCoopWaveAdvanceDataAtBoundary(1)).toBe("applied");
    expect(admitted, "wave 1 DATA applies exactly at its boundary").toEqual([1]);
    expect(getCoopStagedWaveAdvanceTransaction(1)?.dataApplied).toBe(true);
  });

  it("advances the cursor at staging but retains authority until BattleEnd DATA and destination readiness", async () => {
    const scheduler = new ManualScheduler();
    const failures: unknown[] = [];
    let battleEndOpen = false;
    const appliedStateTicks: number[] = [];
    restoreBoundaryApplier = registerCoopWaveAdvanceBoundaryDataApplier(envelope => {
      if (!battleEndOpen) {
        return "deferred"; // pre-BattleEnd: the scene is not at this wave's boundary yet
      }
      appliedStateTicks.push(envelope.authoritativeState.tick);
      return "applied";
    });
    registerCoopOperationLiveSink(
      "op:wave",
      envelope =>
        getCoopStagedWaveAdvanceTransaction((envelope.pendingOperation?.payload as CoopWaveAdvancePayload).wave)
          ?.dataApplied === true,
    );
    const pair = createLoopbackPair();
    let ackCount = 0;
    pair.host.onMessage(message => {
      if (message.t === "coopAck" && message.cls === "op:global") {
        ackCount++;
      }
    });
    const recoveryTiming = {
      scheduleRecovery: scheduler.schedule,
      recoveryNow: () => scheduler.now,
      recoveryInitialMs: 100,
      recoveryMaxMs: 2_000,
      recoveryMaxAttempts: 8,
      recoveryDeadlineMs: 12_000,
    };
    const hostMgr = new CoopDurabilityManager(pair.host, recoveryTiming);
    const guestMgr = new CoopDurabilityManager(pair.guest, {
      ...coopOperationDurabilityHooks(),
      ...recoveryTiming,
      deferredRetryMs: 100,
      onRecoveryExhausted: failure => failures.push(failure),
    });
    setCoopOperationDurability(hostMgr);

    commitHostWave(14);
    await flush();
    // The wave-advance is not receive-deferred: it advances the shared cursor, so a legitimate
    // Victory->BattleEnd delay consumes ZERO recovery budget and cannot block a same-boundary reward RESULT
    // (seq+1). Host retention is independent and remains until DATA + destination readiness are proven.
    expect(failures, "a non-deferred op consumes no recovery budget").toEqual([]);
    expect(guestMgr.appliedMarks(), "the shared cursor advanced at staging").toEqual({ "op:global": 1 });
    expect(hostMgr.unackedCount(), "cursor admission cannot retire the retained wave transaction").toBe(1);
    expect(ackCount, "staging emits exactly one delivery-only journal admission proof").toBe(1);
    let materialSettled = false;
    const materialApplied = hostMgr.waitForOperationMaterialApplied("1:0:WAVE_ADVANCE:14").then(applied => {
      materialSettled = true;
      return applied;
    });
    await flush();
    expect(materialSettled, "journal admission is not material application").toBe(false);
    // ...but the wave DATA has NOT applied yet (invariant b: only at the real boundary).
    expect(appliedStateTicks, "DATA did not apply before BattleEnd").toEqual([]);
    expect(getCoopStagedWaveAdvanceTransaction(14)?.dataApplied, "wave DATA still pending pre-boundary").toBe(false);

    // Advance BOTH peers' deterministic recovery clock past the old 9.1s window. Exact admission must
    // have cancelled host delivery retries without claiming material or continuation readiness.
    scheduler.advance(9_200);
    await flush();
    expect(ackCount, "admission prevents a spurious host retry/exhaustion cycle").toBe(1);
    expect(materialSettled, "the delivery-only ACK cannot settle a material barrier").toBe(false);
    expect(hostMgr.unackedCount(), "the host still retains the canonical operation").toBe(1);
    expect(failures).toEqual([]);
    hostMgr.reconnect();
    await flush();
    expect(ackCount, "an incomplete duplicate republishes only exact admission").toBe(2);
    expect(materialSettled).toBe(false);

    // Reaching the real BattleEnd boundary applies the immutable DATA image exactly once; then continuation latches.
    battleEndOpen = true;
    expect(tryApplyCoopWaveAdvanceDataAtBoundary(14)).toBe("applied");
    expect(appliedStateTicks, "the immutable state image entered exactly once at the BattleEnd wake").toEqual([114]);
    expect(getCoopStagedWaveAdvanceTransaction(14)?.dataApplied).toBe(true);
    expect(markCoopWaveAdvanceContinuationReady(14), "continuation latches after DATA").toBe(true);
    expect(isCoopWaveAdvanceTransactionComplete(14)).toBe(true);
    const completed = getCoopStagedWaveAdvanceTransaction(14)!;
    expect(
      guestMgr.completeRetainedWaveAdvance(completed.envelope, "sharedInput", {
        epoch: completed.envelope.sessionEpoch,
        wave: 14,
        turn: completed.envelope.turn,
      }),
    ).toBe(true);
    await flush();
    expect(hostMgr.unackedCount(), "exact retained-wave continuation proof releases the host journal").toBe(0);
    expect(await materialApplied, "material resolves only when the DATA-bound chain is published").toBe(true);
    expect(ackCount, "completion publishes material, presentation, and continuation after admission").toBe(5);
    expect(
      guestMgr.completeRetainedWaveAdvance(completed.envelope, "sharedInput", {
        epoch: completed.envelope.sessionEpoch,
        wave: 14,
        turn: completed.envelope.turn,
      }),
      "a repeated adapter wake idempotently republishes the exact final proof",
    ).toBe(true);
    await flush();
    expect(ackCount, "the completed duplicate republishes only continuationReady").toBe(6);
    expect(
      tryApplyCoopWaveAdvanceDataAtBoundary(14),
      "an already-admitted DATA image is idempotent and cannot call the engine applier twice",
    ).toBe("applied");
    expect(appliedStateTicks, "the engine applier is never called twice").toEqual([114]);
    expect(failures).toEqual([]);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("retransmits once when journal admission is lost, then stops before material completion", async () => {
    const scheduler = new ManualScheduler();
    restoreBoundaryApplier = registerCoopWaveAdvanceBoundaryDataApplier(() => "applied");
    registerCoopOperationLiveSink("op:wave", () => false);
    const pair = createLoopbackPair();
    let envelopeSends = 0;
    let admissionSends = 0;
    let dropFirstAdmission = true;
    const hostInner = pair.host;
    const hostWrapped = {
      ...hostInner,
      get role() {
        return hostInner.role;
      },
      get state() {
        return hostInner.state;
      },
      send: (msg: CoopMessage) => {
        if (msg.t === "envelope" && msg.envelope.pendingOperation?.kind === "WAVE_ADVANCE") {
          envelopeSends++;
        }
        return hostInner.send(msg);
      },
      onMessage: hostInner.onMessage.bind(hostInner),
      onStateChange: hostInner.onStateChange.bind(hostInner),
      close: hostInner.close.bind(hostInner),
    };
    const guestInner = pair.guest;
    const guestWrapped = {
      ...guestInner,
      get role() {
        return guestInner.role;
      },
      get state() {
        return guestInner.state;
      },
      send: (msg: CoopMessage) => {
        if (msg.t === "coopAck" && msg.stage === "journalAdmitted") {
          admissionSends++;
          if (dropFirstAdmission) {
            dropFirstAdmission = false;
            return;
          }
        }
        return guestInner.send(msg);
      },
      onMessage: guestInner.onMessage.bind(guestInner),
      onStateChange: guestInner.onStateChange.bind(guestInner),
      close: guestInner.close.bind(guestInner),
    };
    const recoveryTiming = {
      scheduleRecovery: scheduler.schedule,
      recoveryNow: () => scheduler.now,
      recoveryInitialMs: 100,
      recoveryMaxMs: 200,
      recoveryMaxAttempts: 3,
      recoveryDeadlineMs: 1_000,
    };
    const hostMgr = new CoopDurabilityManager(hostWrapped as never, recoveryTiming);
    const guestMgr = new CoopDurabilityManager(guestWrapped as never, {
      ...coopOperationDurabilityHooks(),
      ...recoveryTiming,
    });
    setCoopOperationDurability(hostMgr);

    commitHostWave(15);
    await flush();
    expect(envelopeSends, "the canonical operation was sent once initially").toBe(1);
    expect(admissionSends, "the first exact admission proof was lost").toBe(1);
    expect(hostMgr.unackedCount()).toBe(1);

    scheduler.advance(100);
    await flush();
    expect(envelopeSends, "the host retransmits the exact retained operation once").toBe(2);
    expect(admissionSends, "the incomplete duplicate republishes exact admission").toBe(2);
    expect(hostMgr.unackedCount(), "admission still cannot release authority").toBe(1);

    scheduler.advance(5_000);
    await flush();
    expect(envelopeSends, "accepted admission cancels every later delivery retry").toBe(2);
    expect(admissionSends).toBe(2);

    const completed = getCoopStagedWaveAdvanceTransaction(15)!;
    expect(tryApplyCoopWaveAdvanceDataAtBoundary(15)).toBe("applied");
    expect(markCoopWaveAdvanceContinuationReady(15)).toBe(true);
    expect(
      guestMgr.completeRetainedWaveAdvance(completed.envelope, "sharedInput", {
        epoch: completed.envelope.sessionEpoch,
        wave: 15,
        turn: completed.envelope.turn,
      }),
    ).toBe(true);
    await flush();
    expect(hostMgr.unackedCount(), "the later DATA-bound continuation chain releases normally").toBe(0);
    hostMgr.dispose();
    guestMgr.dispose();
  });

  it("accepts journal admission only at the exact retained operation address and without continuation fields", async () => {
    const scheduler = new ManualScheduler();
    const pair = createLoopbackPair();
    let envelopeSends = 0;
    const hostInner = pair.host;
    const hostWrapped = {
      ...hostInner,
      get role() {
        return hostInner.role;
      },
      get state() {
        return hostInner.state;
      },
      send: (msg: CoopMessage) => {
        if (msg.t === "envelope") {
          envelopeSends++;
        }
        return hostInner.send(msg);
      },
      onMessage: hostInner.onMessage.bind(hostInner),
      onStateChange: hostInner.onStateChange.bind(hostInner),
      close: hostInner.close.bind(hostInner),
    };
    const hostMgr = new CoopDurabilityManager(hostWrapped as never, {
      scheduleRecovery: scheduler.schedule,
      recoveryNow: () => scheduler.now,
      recoveryInitialMs: 100,
      recoveryMaxMs: 100,
      recoveryMaxAttempts: 5,
      recoveryDeadlineMs: 2_000,
    });
    const retained = waveEnvelope(16);
    expect(hostMgr.commit("op:global", retained.revision, { t: "envelope", envelope: retained })).toBe(true);
    await flush();

    pair.guest.send({
      t: "coopAck",
      cls: "op:global",
      seq: retained.revision,
      stage: "journalAdmitted",
      operationId: "wrong-operation",
      epoch: retained.sessionEpoch,
      wave: retained.wave,
      turn: retained.turn,
    });
    await flush();
    scheduler.advance(100);
    await flush();
    expect(envelopeSends, "a wrong-address ACK cannot cancel delivery retry").toBe(2);

    pair.guest.send({
      t: "coopAck",
      cls: "op:global",
      seq: retained.revision,
      stage: "journalAdmitted",
      operationId: retained.pendingOperation!.id,
      epoch: retained.sessionEpoch,
      wave: retained.wave,
      turn: retained.turn,
      surface: "sharedInput",
      continuationEpoch: retained.sessionEpoch,
      continuationWave: retained.wave,
      continuationTurn: retained.turn,
    });
    await flush();
    scheduler.advance(100);
    await flush();
    expect(envelopeSends, "admission carrying premature continuation evidence is rejected").toBe(3);

    pair.guest.send({
      t: "coopAck",
      cls: "op:global",
      seq: retained.revision,
      stage: "journalAdmitted",
      operationId: retained.pendingOperation!.id,
      epoch: retained.sessionEpoch,
      wave: retained.wave,
      turn: retained.turn,
    });
    await flush();
    scheduler.advance(5_000);
    await flush();
    expect(envelopeSends, "the exact field-free admission cancels later delivery retries").toBe(3);
    expect(hostMgr.unackedCount(), "admission cannot release the retained transaction").toBe(1);
    hostMgr.dispose();
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
  it("re-ACKs the exact final proof when its first continuationReady frame is lost", async () => {
    registerCoopOperationLiveSink("op:wave", env => completeWaveEnvelope(env));
    const sentAcks: Extract<CoopMessage, { t: "coopAck" }>[] = [];
    let dropFirstFinalAck = true;
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
      send: (msg: CoopMessage) => {
        if (msg.t === "coopAck") {
          sentAcks.push(msg);
          if (msg.stage === "continuationReady" && dropFirstFinalAck) {
            dropFirstFinalAck = false;
            return;
          }
        }
        return guestInner.send(msg);
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
    const completed = getCoopStagedWaveAdvanceTransaction(40)!;
    expect(
      guestMgr.completeRetainedWaveAdvance(completed.envelope, "sharedInput", {
        epoch: completed.envelope.sessionEpoch,
        wave: 40,
        turn: completed.envelope.turn,
      }),
    ).toBe(true);
    await flush();
    expect(hostMgr.unackedCount(), "a lost final proof keeps the canonical host transaction retained").toBe(1);

    // Force a re-delivery of the same committed op. The guest must not reapply it, but must republish the
    // canonical continuationReady evidence so the host's resend loop can terminate.
    hostMgr.reconnect();
    await flush();

    expect(sentAcks.map(ack => ack.stage)).toEqual([
      "journalAdmitted",
      "materialApplied",
      "presentationReady",
      "continuationReady",
      "materialApplied",
      "presentationReady",
      "continuationReady",
    ]);
    expect(hostMgr.unackedCount(), "the duplicate final proof releases the retained host transaction").toBe(0);
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
