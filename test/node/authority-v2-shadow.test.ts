/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane unit tests for co-op AUTHORITY V2 - the SHADOW harness (wiring lane).
//
// The harness imports NOTHING from Phaser/engine at runtime (BattleScene and
// CoopTransport are TYPE-ONLY; the shadow projector + applier never touch the
// scene), so it runs in the node-pure project in milliseconds. The properties
// pinned here are the shadow-mode contract:
//   - a tap builds the v2 entry via the matching adapter builder, commits it to
//     the shadow log, and the REPLICA side (a second harness over a simulated
//     channel) admits + applies against its shadow state + emits receipts, which
//     the authority accepts and retires (a full protocol round-trip);
//   - each tap records ONE parity check (match reflects v2 digest == legacy digest);
//   - a shadow FAULT is isolated: it logs, never throws into the tap caller, and the
//     harness keeps working;
//   - teardown leaves ZERO armed timers;
//   - the transport routing seam classifies valid / cosmetic-drop / protocol-violation.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { buildRewardInteractionEntry } from "#data/elite-redux/coop/authority-v2/adapters/interactions-reward";
import { computeTurnCommitDigest } from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import type { CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { encodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import {
  CoopAuthorityV2Shadow,
  type CoopV2ShadowIdentity,
  clearActiveCoopV2Shadow,
  clearCoopV2ShadowInbound,
  isCoopV2ShadowActive,
  registerCoopV2ShadowInbound,
  routeCoopV2InboundFrame,
  setActiveCoopV2Shadow,
  tapCoopV2ShadowInteraction,
  tapCoopV2ShadowReplacementCommit,
  tapCoopV2ShadowTurnCommit,
} from "#data/elite-redux/coop/authority-v2/shadow";
import { afterEach, describe, expect, it } from "vitest";

// --- deterministic test doubles ---------------------------------------------

/** A fully deterministic wall clock + timer queue (no real time). */
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

  get pendingCount(): number {
    return this.pending.size;
  }
}

// A BattleScene is never touched by the shadow harness (stored in the runtime context only); an empty
// stub cast to the type is the engine-free way to inject it.
const STUB_SCENE = {} as unknown as BattleScene;
// The transport is likewise stored-only (the harness sends via the injected `send` seam, not the transport).
const STUB_TRANSPORT = {} as unknown as import("#data/elite-redux/coop/coop-transport").CoopTransport;

const SESSION = {
  sessionId: "sess-shadow-1",
  runId: "run-shadow-1",
  epoch: 3,
  authoritySeatId: 0,
  membershipRevision: 1,
  seatMapId: "seatmap-shadow-1",
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
  };
}

/**
 * A synchronous in-memory channel pair between two harnesses. `host.send(frame)` delivers to the guest's
 * inbound handler and vice-versa - the real WebRTC framing round-trips through encode/decode+validate, so
 * this simulated channel exercises the SAME wire contract (a v2 frame serialized + re-validated).
 */
function buildDuo(clock: FakeClock): {
  host: CoopAuthorityV2Shadow;
  guest: CoopAuthorityV2Shadow;
  dispose(): void;
} {
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;
  // A frame crossing the channel is encoded to its JSON wire string then decoded+validated (the real path)
  // before it reaches the peer's inbound handler - proving the harness's frames survive the boundary validator.
  const deliver = (target: () => CoopAuthorityV2Shadow) => (frame: CoopFrameV2) => {
    const wire = encodeFrameV2(frame);
    // Route through the boundary validator exactly as the transport does; hand the validated frame on.
    routeCoopV2InboundFrameInto(target(), wire);
  };
  host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    send: frame => deliver(() => guest)(frame),
    scheduler: createCoopScheduler(clock),
  });
  guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    send: frame => deliver(() => host)(frame),
    scheduler: createCoopScheduler(clock),
  });
  return {
    host,
    guest,
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

/** Validate a wire string via the SAME boundary the transport uses, then deliver the valid frame to a harness. */
function routeCoopV2InboundFrameInto(harness: CoopAuthorityV2Shadow, wire: string): void {
  const unregister = () => clearCoopV2ShadowInbound();
  registerCoopV2ShadowInbound(frame => harness.handleInboundFrame(frame));
  try {
    routeCoopV2InboundFrame(wire);
  } finally {
    unregister();
  }
}

// --- fixtures ---------------------------------------------------------------

function turnTap(operationId = "TURN/w5/t1", legacyDigest = "legacy-turn") {
  const capture = { turnResolution: { events: [1, 2, 3] }, checkpoint: { hp: 100 } };
  return {
    operationId,
    capture,
    nextCommand: { epoch: SESSION.epoch, wave: 5, resolvedTurn: 1, ownerSeatId: 0, pokemonId: 42 },
    legacyDigest,
  };
}

afterEach(() => {
  clearActiveCoopV2Shadow();
  clearCoopV2ShadowInbound();
});

// --- tests ------------------------------------------------------------------

describe("authority-v2 shadow harness", () => {
  it("taps commit entries, the replica admits+applies over the channel, and the authority retires them", () => {
    const clock = new FakeClock();
    const duo = buildDuo(clock);

    const entry = duo.host.tapTurnCommit(turnTap());
    expect(entry).not.toBeNull();
    expect(entry?.revision).toBe(1);

    const host = duo.host.diagnostics();
    const guest = duo.guest.diagnostics();

    // Authority committed one entry; the replica admitted + applied it against its shadow state.
    expect(host.committed).toBe(1);
    expect(guest.admitted).toBe(1);
    expect(guest.applied).toBe(1);
    expect(guest.shadowStateSize).toBe(1);
    // The replica projected the stated COMMAND control into its installed-control ledger.
    expect(guest.controlLedgerSize).toBe(1);
    // The replica signed admitted + materialApplied + controlInstalled and sent them back.
    expect(guest.receiptsSent).toBe(3);
    // The authority accepted the receipts and RETIRED the entry (nothing retained, no armed timer).
    expect(host.retained).toBe(0);
    expect(host.pendingTimers).toBe(0);

    duo.dispose();
  });

  it("records ONE parity check per tap; match reflects v2 digest == legacy digest", () => {
    const clock = new FakeClock();
    const duo = buildDuo(clock);

    // A deliberately-wrong legacy digest -> match=false.
    duo.host.tapTurnCommit(turnTap("TURN/mismatch", "definitely-not-the-v2-digest"));
    let host = duo.host.diagnostics();
    expect(host.parityChecks).toBe(1);
    expect(host.parityMatches).toBe(0);

    // The v2 digest the adapter WOULD compute -> match=true.
    const capture = { turnResolution: { events: [9] }, checkpoint: { hp: 1 } };
    const matchingDigest = computeTurnCommitDigest(capture);
    duo.host.tapTurnCommit({
      operationId: "TURN/match",
      capture,
      nextCommand: { epoch: SESSION.epoch, wave: 6, resolvedTurn: 2, ownerSeatId: 0, pokemonId: 7 },
      legacyDigest: matchingDigest,
    });
    host = duo.host.diagnostics();
    expect(host.parityChecks).toBe(2);
    expect(host.parityMatches).toBe(1);

    duo.dispose();
  });

  it("exercises every tap kind (turn / replacement / wave / terminal / interaction)", () => {
    const clock = new FakeClock();
    const duo = buildDuo(clock);

    duo.host.tapTurnCommit(turnTap("TAP/turn"));
    duo.host.tapReplacementCommit({
      proposal: {
        sourceAddress: { epoch: SESSION.epoch, wave: 5, turn: 1, occurrence: 0, fieldIndex: 0 },
        ownerSeatId: 0,
        selected: { partySlot: 2, speciesId: 25 },
      },
      resolution: "owner-pick",
      successor: { kind: "terminal" },
      legacyDigest: "legacy-replace",
    });
    duo.host.tapWaveAdvance({
      operationId: "TAP/wave",
      transition: {
        kind: "wave-advance",
        wave: 5,
        turn: 1,
        outcome: "win",
        nextWave: 6,
        biomeChange: false,
        eggLapse: true,
        meBoundary: "none",
        victoryKind: "wild",
      },
      destination: { kind: "REWARD", operationId: "TAP/wave/reward", ownerSeatId: 0 },
      legacyDigest: "legacy-wave",
    });
    duo.host.tapTerminal({
      operationId: "TAP/terminal",
      terminal: { kind: "terminal", terminalId: "term-1", reason: "game-over", wave: 6, turn: 1 },
      legacyDigest: "legacy-terminal",
    });
    const rewardEntry = buildRewardInteractionEntry({
      context: duo.host.authenticatedFrameContext,
      address: { epoch: SESSION.epoch, wave: 6, ownerSeatId: 0, actionOrdinal: 0 },
      material: { kind: "reward", wave: 6, ownerSeatId: 0, choice: { kind: "leave" }, terminal: true },
      successor: null,
    });
    duo.host.tapInteraction({ entry: rewardEntry, legacyDigest: "legacy-interaction" });

    const host = duo.host.diagnostics();
    const guest = duo.guest.diagnostics();
    expect(host.committed).toBe(5);
    expect(host.parityChecks).toBe(5);
    expect(guest.admitted).toBe(5);
    expect(guest.applied).toBe(5);
    // Everything retired end-to-end; zero leaked timers on both sides.
    expect(host.retained).toBe(0);
    expect(host.pendingTimers).toBe(0);
    expect(guest.pendingTimers).toBe(0);

    duo.dispose();
  });

  it("isolates a shadow fault: a malformed tap logs a FAULT, never throws, and the harness keeps working", () => {
    const clock = new FakeClock();
    const duo = buildDuo(clock);

    // An empty operationId is rejected by the log's commit -> the tap catches it as a FAULT (never a throw).
    expect(() => duo.host.tapTurnCommit(turnTap(""))).not.toThrow();
    let host = duo.host.diagnostics();
    expect(host.faults).toBe(1);
    expect(host.committed).toBe(0);

    // The harness still works after a fault.
    const ok = duo.host.tapTurnCommit(turnTap("TURN/after-fault"));
    expect(ok).not.toBeNull();
    host = duo.host.diagnostics();
    expect(host.committed).toBe(1);
    expect(host.faults).toBe(1);

    duo.dispose();
  });

  it("teardown leaves zero armed timers even with an un-retired entry (no replica)", () => {
    const clock = new FakeClock();
    // A host with NO peer: the delivered entry is never admitted, so its redelivery lease stays armed.
    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
    });
    host.tapTurnCommit(turnTap("TURN/orphan"));
    // The entry is retained + its redelivery timer armed (no receipt ever arrives).
    expect(host.diagnostics().retained).toBe(1);
    expect(clock.pendingCount).toBeGreaterThan(0);

    host.dispose();
    // Teardown cancels every armed timer: zero-leak.
    expect(clock.pendingCount).toBe(0);
    expect(host.diagnostics().disposed).toBe(true);
    expect(host.diagnostics().pendingTimers).toBe(0);
  });

  it("dispose is idempotent and a tap after dispose is inert", () => {
    const clock = new FakeClock();
    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
    });
    host.dispose();
    host.dispose();
    expect(host.tapTurnCommit(turnTap("TURN/after-dispose"))).toBeNull();
    expect(host.diagnostics().committed).toBe(0);
  });
});

describe("authority-v2 shadow transport routing seam", () => {
  it("routes a valid v2 frame to the registered inbound handler", () => {
    const clock = new FakeClock();
    const harness = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
    });
    registerCoopV2ShadowInbound(frame => harness.handleInboundFrame(frame));
    // A well-formed authorityEntry frame from the authority seat.
    const authority = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        expect(routeCoopV2InboundFrame(encodeFrameV2(frame))).toBe("routed");
      },
      scheduler: createCoopScheduler(clock),
    });
    authority.tapTurnCommit(turnTap("ROUTE/turn"));
    expect(harness.diagnostics().admitted).toBe(1);

    clearCoopV2ShadowInbound();
    authority.dispose();
    harness.dispose();
  });

  it("classifies a non-v2 / unknown frame as cosmetic-drop and a malformed v2 frame as protocol-violation", () => {
    // A v2 envelope with an unknown (cosmetic) frame type.
    expect(routeCoopV2InboundFrame({ v: 2, t: "someCosmeticThing" })).toBe("cosmetic-drop");
    // A v2 envelope of a KNOWN mechanical type but a malformed body/context -> loud violation.
    expect(routeCoopV2InboundFrame({ v: 2, t: "authorityEntry", ctx: {}, body: {} })).toBe("protocol-violation");
    // A not-a-frame (missing version) is a violation, never a throw.
    expect(routeCoopV2InboundFrame({ hello: "world" })).toBe("protocol-violation");
  });

  it("the thin cycle-free tap free functions route to the active harness (emit-seam entry points)", () => {
    const clock = new FakeClock();
    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
    });
    // No active harness -> the thin taps are pure no-ops (never throw).
    expect(() => tapCoopV2ShadowTurnCommit(turnTap("THIN/no-active"))).not.toThrow();
    expect(host.diagnostics().committed).toBe(0);

    setActiveCoopV2Shadow(host);
    tapCoopV2ShadowTurnCommit(turnTap("THIN/turn"));
    tapCoopV2ShadowReplacementCommit({
      proposal: {
        sourceAddress: { epoch: SESSION.epoch, wave: 5, turn: 1, occurrence: 0, fieldIndex: 1 },
        ownerSeatId: 0,
        selected: null,
      },
      resolution: "fallback-auto",
      successor: { kind: "terminal" },
      legacyDigest: "legacy",
    });
    tapCoopV2ShadowInteraction({
      entry: buildRewardInteractionEntry({
        context: host.authenticatedFrameContext,
        address: { epoch: SESSION.epoch, wave: 5, ownerSeatId: 0, actionOrdinal: 1 },
        material: { kind: "reward", wave: 5, ownerSeatId: 0, choice: { kind: "skip" }, terminal: true },
        successor: null,
      }),
      legacyDigest: "legacy",
    });
    expect(host.diagnostics().committed).toBe(3);

    clearActiveCoopV2Shadow(host);
    host.dispose();
  });

  it("isCoopV2ShadowActive reflects the active-harness registration", () => {
    const clock = new FakeClock();
    const harness = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
    });
    expect(isCoopV2ShadowActive()).toBe(false);
    setActiveCoopV2Shadow(harness);
    expect(isCoopV2ShadowActive()).toBe(true);
    clearActiveCoopV2Shadow(harness);
    expect(isCoopV2ShadowActive()).toBe(false);
    harness.dispose();
  });
});
