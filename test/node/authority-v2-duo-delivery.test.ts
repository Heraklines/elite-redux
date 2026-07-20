/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane unit tests for the AUTHORITY-V2 duo DELIVERY WIRE (the cutover-turn
// iter-4 fix). Two shadow harnesses stand over ONE real in-process
// `LoopbackTransport` pair with the per-instance `onV2Frame` seam AND the new
// destination-pumped v2 deferral enabled - exactly the shape the two-engine
// duo harness installs.
//
// The properties pinned here are the fix contract:
//   - DEFERRAL: with `setV2InboundDeferred(true)`, a committed entry is NOT
//     dispatched on arrival (the sender's synchronous ambient). It is HELD until
//     the destination endpoint is explicitly pumped - so a two-engine rig applies
//     material under the RECEIVING realm, never the committing one.
//   - ENCODE/DECODE TRAVERSAL: a held frame crosses as its wire STRING and is
//     decoded + boundary-validated on delivery. The replica's admitted object is
//     therefore independent of the authority's retained entry (no in-process
//     object sharing) - mutating one never rewrites the other.
//   - RECEIPTS RETURN OVER THE WIRE: the replica's receipts are themselves
//     deferred on the authority endpoint and only retire the entry once the
//     authority is pumped (same destination-context discipline, reverse
//     direction).
//   - REDELIVERY IDEMPOTENT: a scheduler-owned redelivery re-crosses the wire and
//     the replica classifies it a duplicate - never a second material apply.
//
// Engine-free: the harness never touches Phaser/globalScene, so this runs in the
// node-pure project in milliseconds.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type { CoopAuthorityEntry, CoopRuntimeContext } from "#data/elite-redux/coop/authority-v2/contract";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import {
  CoopAuthorityV2Shadow,
  type CoopV2LiveReplicaSeams,
  type CoopV2ShadowIdentity,
  clearActiveCoopV2Shadow,
  clearCoopV2ShadowInbound,
} from "#data/elite-redux/coop/authority-v2/shadow";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

// --- deterministic test doubles ---------------------------------------------

/** A fully deterministic wall clock + timer queue (no real time) - mirrors the shadow-lane FakeClock. */
class FakeClock implements CoopSchedulerClock {
  private t = 0;
  private seq = 1;
  private readonly pending = new Map<number, { fireAt: number; cb: () => void }>();

  now(): number {
    return this.t;
  }

  setTimer(cb: () => void, delayMs: number): CoopTimerHandle {
    const id = this.seq++;
    this.pending.set(id, { fireAt: this.t + Math.max(0, delayMs), cb });
    return id;
  }

  clearTimer(handle: CoopTimerHandle): void {
    this.pending.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      let nextId = -1;
      let nextAt = Number.POSITIVE_INFINITY;
      for (const [id, entry] of this.pending) {
        if (entry.fireAt <= target && entry.fireAt < nextAt) {
          nextAt = entry.fireAt;
          nextId = id;
        }
      }
      if (nextId === -1) {
        break;
      }
      const entry = this.pending.get(nextId);
      if (!entry) {
        break;
      }
      this.pending.delete(nextId);
      this.t = entry.fireAt;
      entry.cb();
    }
    this.t = target;
  }
}

const STUB_SCENE = {} as unknown as BattleScene;

const SESSION = {
  sessionId: "sess-duo-delivery",
  runId: "run-duo-delivery",
  epoch: 4,
  authoritySeatId: 0,
  membershipRevision: 1,
  seatMapId: "seatmap-duo-delivery",
};

function identity(localSeatId: number): CoopV2ShadowIdentity {
  return {
    runtimeId: `${SESSION.sessionId}:seat${localSeatId}`,
    sessionId: SESSION.sessionId,
    runId: SESSION.runId,
    epoch: SESSION.epoch,
    localSeatId,
    authoritySeatId: SESSION.authoritySeatId,
    membershipRevision: SESSION.membershipRevision,
    seatMapId: SESSION.seatMapId,
    connectionGeneration: 0,
    peerBindings: [{ seatId: localSeatId === 0 ? 1 : 0, connectionGeneration: 0 }],
  };
}

function turnTap(operationId = "TURN/w5/t1", legacyDigest = "legacy-turn") {
  const capture = { turnResolution: { events: [1, 2, 3] }, checkpoint: { hp: 100 } };
  return {
    operationId,
    capture,
    nextCommandFrontier: {
      epoch: SESSION.epoch,
      wave: 5,
      resolvedTurn: 1,
      commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
    },
    legacyDigest,
  };
}

/** Flush the real loopback microtask + macrotask queue so a `send` reaches the peer's dispatchInbound. */
async function flushLoopback(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}

/**
 * A live-replica seam that records the ENTRY OBJECT the replica was handed on material apply. It lets a test
 * prove the delivered object is a decoded copy (never the authority's retained instance) by mutating it and
 * checking the authority side is untouched.
 */
function recordingLiveReplica(sink: { last: CoopAuthorityEntry | null; applies: number }): CoopV2LiveReplicaSeams {
  return {
    ownsEntry: entry => entry.kind === "TURN_COMMIT",
    ownsControl: () => false,
    applyMaterial: (_ctx: CoopRuntimeContext, entry: CoopAuthorityEntry): boolean => {
      sink.applies += 1;
      sink.last = entry;
      return true;
    },
    // The turn surface installs its COMMAND successor through the guest's ordinary presentation flow; this
    // seam has no phase manager here, so fall through to the shadow projector (null) - material apply is the
    // property under test.
    projectControl: () => null,
  };
}

/**
 * Two shadow harnesses over ONE real loopback pair with the per-instance onV2Frame seam AND destination-pump
 * deferral enabled - the exact shape the duo test harness installs. `flush(role)` drains that endpoint's held
 * v2 frames (the "pump under the destination context" step).
 */
function buildDeferredDuo(
  clock: FakeClock,
  guestLive?: CoopV2LiveReplicaSeams,
  onGuestProtocolViolation?: (violation: { readonly issues: readonly string[] }) => void,
): {
  host: CoopAuthorityV2Shadow;
  guest: CoopAuthorityV2Shadow;
  pair: ReturnType<typeof createLoopbackPair>;
  flush(role: "host" | "guest"): number;
  dispose(): void;
} {
  const pair = createLoopbackPair();
  // Production always has a legacy onMessage subscriber (the session controller); register a no-op one on
  // every endpoint so the loopback's early-rx buffer drains and v2 frames dispatch into the deferral queue.
  pair.host.onMessage(() => {});
  pair.guest.onMessage(() => {});
  // HOLD inbound v2 frames until the destination endpoint is explicitly pumped (the fix under test).
  pair.host.setV2InboundDeferred?.(true);
  pair.guest.setV2InboundDeferred?.(true);

  const host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: pair.host,
    send: frame => pair.host.send(frame),
    scheduler: createCoopScheduler(clock),
  });
  const guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: pair.guest,
    send: frame => pair.guest.send(frame),
    scheduler: createCoopScheduler(clock),
    ...(guestLive == null ? {} : { liveReplica: guestLive }),
    ...(onGuestProtocolViolation == null ? {} : { onProtocolViolation: onGuestProtocolViolation }),
  });

  return {
    host,
    guest,
    pair,
    flush: role => pair[role].pumpV2Inbound?.() ?? 0,
    dispose: () => {
      host.dispose();
      guest.dispose();
      pair.host.close();
    },
  };
}

afterEach(() => {
  clearActiveCoopV2Shadow();
  clearCoopV2ShadowInbound();
});

describe("authority-v2 duo delivery wire (cutover-turn iter-4)", () => {
  it("HOLDS a committed entry off the replica until the destination endpoint is pumped", async () => {
    const clock = new FakeClock();
    const duo = buildDeferredDuo(clock);

    duo.host.tapTurnCommit(turnTap());
    // Let the loopback microtask deliver the frame to the guest endpoint's dispatchInbound.
    await flushLoopback();

    // Deferral: the frame reached the guest endpoint but was HELD (not routed to the replica). A synchronous
    // in-process delivery would already show admitted=1 here - the exact cross-realm strand the fix removes.
    expect(duo.guest.diagnostics().admitted).toBe(0);

    // Pump the guest endpoint (the "under the destination context" step): now the replica admits + applies.
    const delivered = duo.flush("guest");
    expect(delivered).toBe(1);
    expect(duo.guest.diagnostics().admitted).toBe(1);
    expect(duo.guest.diagnostics().applied).toBe(1);

    duo.dispose();
  });

  it("traverses encode+decode - the replica's applied entry is INDEPENDENT of the authority's retained one", async () => {
    const clock = new FakeClock();
    const sink = { last: null as CoopAuthorityEntry | null, applies: 0 };
    const duo = buildDeferredDuo(clock, recordingLiveReplica(sink));

    const committed = duo.host.tapTurnCommit(turnTap("TURN/w5/t7"));
    expect(committed).not.toBeNull();
    await flushLoopback();
    duo.flush("guest");

    expect(sink.applies).toBe(1);
    expect(sink.last).not.toBeNull();
    // Same value crossed the wire...
    expect(sink.last?.operationId).toBe("TURN/w5/t7");
    expect(sink.last?.revision).toBe(committed?.revision);
    // ...but it is a DECODED copy, not the authority's retained instance (no in-process object sharing): the
    // wire string round-trip (encode -> decode) severs identity. Mutating the delivered copy cannot rewrite
    // the authority's frozen retained entry.
    expect(sink.last).not.toBe(committed);
    expect(Object.isFrozen(committed)).toBe(true);

    duo.dispose();
  });

  it("returns receipts OVER THE WIRE - the entry retires only once the authority endpoint is pumped", async () => {
    const clock = new FakeClock();
    const duo = buildDeferredDuo(clock);

    duo.host.tapTurnCommit(turnTap());
    await flushLoopback();

    // Deliver the entry to the replica; it admits + applies + emits receipts back onto the wire.
    duo.flush("guest");
    expect(duo.guest.diagnostics().receiptsSent).toBeGreaterThan(0);
    await flushLoopback();

    // The receipts are themselves HELD on the authority endpoint (same destination discipline). Until the
    // authority is pumped, the entry is still retained (its redelivery lease armed).
    expect(duo.host.diagnostics().retained).toBe(1);

    // Pump the authority endpoint: it accepts the receipts and RETIRES the entry (no retained, no armed timer).
    const delivered = duo.flush("host");
    expect(delivered).toBeGreaterThan(0);
    expect(duo.host.diagnostics().retained).toBe(0);

    duo.dispose();
  });

  it("is REDELIVERY-IDEMPOTENT - a scheduler-owned redelivery re-crosses the wire but never re-applies", async () => {
    const clock = new FakeClock();
    const sink = { last: null as CoopAuthorityEntry | null, applies: 0 };
    const duo = buildDeferredDuo(clock, recordingLiveReplica(sink));

    duo.host.tapTurnCommit(turnTap());
    await flushLoopback();
    // First delivery: admitted + applied ONCE.
    duo.flush("guest");
    expect(duo.guest.diagnostics().admitted).toBe(1);
    expect(sink.applies).toBe(1);

    // Drop the replica's receipts on the floor (do NOT pump the host), so the authority's redelivery lease
    // keeps firing. Advance past the initial backoff to force a scheduler-owned redelivery tick.
    clock.advance(1_000);
    await flushLoopback();

    // The redelivered entry re-crossed the wire and is HELD on the guest endpoint again; pump it.
    const redelivered = duo.flush("guest");
    expect(redelivered).toBeGreaterThan(0);
    // Idempotent: the replica classifies the redelivery a DUPLICATE - admitted stays 1, material applied ONCE.
    expect(duo.guest.diagnostics().admitted).toBe(1);
    expect(sink.applies).toBe(1);

    duo.dispose();
  });

  it("retries material after admission when the first live apply is deferred", async () => {
    const clock = new FakeClock();
    let applies = 0;
    const guestLive: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: () => false,
      applyMaterial: () => {
        applies += 1;
        return applies > 1 ? true : "deferred";
      },
      projectControl: () => null,
    };
    const duo = buildDeferredDuo(clock, guestLive);

    duo.host.tapTurnCommit(turnTap("TURN/retry-material"));
    await flushLoopback();
    duo.flush("guest");
    expect(applies).toBe(1);
    expect(duo.guest.diagnostics().admitted).toBe(1);
    expect(duo.guest.diagnostics().applied).toBe(0);

    // Admission is not application: the authority keeps delivering until the required stage, and the
    // duplicate-pending-material path retries the exact live apply.
    clock.advance(1_000);
    await flushLoopback();
    duo.flush("guest");
    expect(applies).toBe(2);
    expect(duo.guest.diagnostics().admitted).toBe(1);
    expect(duo.guest.diagnostics().applied).toBe(1);

    await flushLoopback();
    duo.flush("host");
    expect(duo.host.diagnostics().retained).toBe(0);
    duo.dispose();
  });

  it("routes an owned structural material rejection to the shared protocol terminal", async () => {
    const clock = new FakeClock();
    const violations: string[][] = [];
    const guestLive: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: () => false,
      applyMaterial: () => false,
      projectControl: () => null,
    };
    const duo = buildDeferredDuo(clock, guestLive, violation => violations.push([...violation.issues]));

    duo.host.tapTurnCommit(turnTap("TURN/structural-rejection"));
    await flushLoopback();
    duo.flush("guest");

    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 0 });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.join(".")).toContain("materialRejected");

    duo.dispose();
  });

  it("does not terminalize healthy owned material deferral", async () => {
    const clock = new FakeClock();
    const violations: string[][] = [];
    const guestLive: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: () => false,
      applyMaterial: () => "deferred",
      projectControl: () => null,
    };
    const duo = buildDeferredDuo(clock, guestLive, violation => violations.push([...violation.issues]));

    duo.host.tapTurnCommit(turnTap("TURN/healthy-deferral"));
    await flushLoopback();
    duo.flush("guest");

    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 0 });
    expect(violations).toEqual([]);

    duo.dispose();
  });

  it("lets an authenticated replacement gap release its predecessor picker without applying out of order", async () => {
    const clock = new FakeClock();
    let predecessorReleased = false;
    let releases = 0;
    const appliedRevisions: number[] = [];
    const guestLive: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT" || entry.kind === "REPLACEMENT_COMMIT",
      ownsControl: () => false,
      releaseBlockedPredecessor: (_ctx, entry) => {
        if (entry.kind !== "REPLACEMENT_COMMIT") {
          return null;
        }
        releases += 1;
        predecessorReleased = true;
        return true;
      },
      applyMaterial: (_ctx, entry) => {
        if (entry.revision === 1 && !predecessorReleased) {
          return "deferred";
        }
        appliedRevisions.push(entry.revision);
        return true;
      },
      projectControl: () => null,
    };
    const duo = buildDeferredDuo(clock, guestLive);

    // Revision 1 is admitted but its real turn material cannot settle while the faint picker is open.
    const blockedTurn = turnTap("TURN/blocked-by-picker");
    duo.host.tapTurnCommit({
      ...blockedTurn,
      capture: {
        ...blockedTurn.capture,
        epoch: SESSION.epoch,
        wave: 5,
        turn: 1,
        revision: 1,
      },
      nextCommandFrontier: null,
    });
    await flushLoopback();
    duo.flush("guest");
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 0 });
    expect(appliedRevisions).toEqual([]);

    // Revision 2 is the committed picker answer. It is still a ledger GAP, so it must not be admitted,
    // applied, or receipted; only the address-exact predecessor-release seam may observe it.
    duo.host.tapReplacementCommit({
      proposal: {
        sourceAddress: { epoch: SESSION.epoch, wave: 5, turn: 1, occurrence: 4, fieldIndex: 0 },
        ownerSeatId: 1,
        selected: { partySlot: 1, speciesId: 131 },
      },
      resolution: "fallback-auto",
      successor: { kind: "terminal" },
      legacyDigest: "legacy-replacement",
    });
    await flushLoopback();
    duo.flush("guest");
    expect(releases).toBe(1);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 0 });
    expect(appliedRevisions).toEqual([]);

    // Authority-owned redelivery now retries revision 1, which can finish; the retained revision 2 then
    // crosses the ordinary ordered admission/apply path. Canonical material order remains exactly [1, 2].
    clock.advance(1_000);
    await flushLoopback();
    duo.flush("guest");
    expect(appliedRevisions).toEqual([1, 2]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 2, applied: 2 });

    duo.dispose();
  });

  it("retries a deferred control without applying canonical material twice", async () => {
    const clock = new FakeClock();
    let applies = 0;
    let projections = 0;
    const guestLive: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial: () => {
        applies += 1;
        return true;
      },
      projectControl: (_ctx, control) => {
        projections += 1;
        return projections === 1
          ? { kind: "deferred", reason: "phase manager pacing" }
          : { kind: "installed", controlId: controlIdOf(control) };
      },
    };
    const duo = buildDeferredDuo(clock, guestLive);

    duo.host.tapTurnCommit(turnTap("TURN/retry-control"));
    await flushLoopback();
    duo.flush("guest");
    expect(applies).toBe(1);
    expect(projections).toBe(1);
    expect(duo.guest.diagnostics().applied).toBe(0);

    clock.advance(1_000);
    await flushLoopback();
    duo.flush("guest");
    expect(applies).toBe(1);
    expect(projections).toBe(2);
    expect(duo.guest.diagnostics().applied).toBe(1);

    duo.dispose();
  });

  it("retries a deferred control immediately when its real surface opens", async () => {
    const clock = new FakeClock();
    let applies = 0;
    let projections = 0;
    let surfaceReady = false;
    const guestLive: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "TURN_COMMIT",
      ownsControl: control => control.kind === "COMMAND_FRONTIER",
      applyMaterial: () => {
        applies += 1;
        return true;
      },
      projectControl: (_ctx, control) => {
        projections += 1;
        return surfaceReady
          ? { kind: "installed", controlId: controlIdOf(control) }
          : { kind: "deferred", reason: "real public surface has not opened" };
      },
    };
    const duo = buildDeferredDuo(clock, guestLive);

    duo.host.tapTurnCommit(turnTap("TURN/real-surface-wake"));
    await flushLoopback();
    duo.flush("guest");
    expect(applies).toBe(1);
    expect(projections).toBe(1);
    expect(duo.guest.diagnostics().applied).toBe(0);

    // A public UI can open and accept input before the authority's 250ms redelivery lease. The real engine
    // hook retries the admitted entry synchronously, resumes at materialApplied, and signs controlInstalled
    // without applying canonical material twice or advancing fake time.
    surfaceReady = true;
    expect(duo.guest.retryPendingReplicaEntries()).toBe(1);
    expect(applies).toBe(1);
    expect(projections).toBe(2);
    expect(duo.guest.diagnostics().applied).toBe(1);

    await flushLoopback();
    duo.flush("host");
    expect(duo.host.diagnostics().retained).toBe(0);
    duo.dispose();
  });
});
