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
import { CoopDurabilityManager, setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import type { CoopWaveAdvancePayload } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  coopOperationDurabilityHooks,
  getCoopOperationJournalApplied,
  getCoopOperationLiveSinkInvoked,
  registerCoopOperationLiveSink,
  resetCoopOperationJournalLog,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  commitWaveAdvanceOwnerIntent,
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
  return {
    wave,
    outcome: "win",
    nextLogicalPhase: "WAVE_VICTORY",
    nextWave: wave + 1,
    biomeChange: false,
    eggLapse: false,
    meBoundary: "none",
    victoryKind: "wild",
    ...over,
  };
}

/** Commit a host wave-advance through the REAL adapter (the owner/host is the sole committer of a wave-advance). */
function commitHostWave(wave: number, over: Partial<CoopWaveAdvancePayload> = {}): void {
  commitWaveAdvanceOwnerIntent({ payload: waveAdvancePayload(wave, over), localRole: "host", wave, turn: 0 });
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
      return true; // the real materializer feeds pendingWaveAdvance (coop-runtime); the mock records.
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

  it("a flee and a game-over wave-advance both journal + route with their host-stated next phase", async () => {
    const seen: CoopWaveAdvancePayload[] = [];
    registerCoopOperationLiveSink("op:wave", env => {
      seen.push(env.pendingOperation?.payload as CoopWaveAdvancePayload);
      return true;
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
    registerCoopOperationLiveSink("op:wave", () => true);
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
    registerCoopOperationLiveSink("op:wave", () => true);
    const pair = createLoopbackPair();
    const hostMgr = new CoopDurabilityManager(pair.host);
    const guestMgr = new CoopDurabilityManager(pair.guest, coopOperationDurabilityHooks());
    setCoopOperationDurability(hostMgr);

    // Simulate a cold resume at high-water N for op:wave: restore both managers' marks + floor the surface.
    hostMgr.restore({ "op:wave": N }, { "op:wave": N });
    guestMgr.restore({ "op:wave": N }, { "op:wave": N });
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
    registerCoopOperationLiveSink("op:wave", () => true);
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
    registerCoopOperationLiveSink("op:wave", () => {
      routed++;
      return true;
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
      return true;
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
