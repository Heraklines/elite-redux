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
import { decodeInteractionMaterial as learnDecodeInteractionMaterial } from "#data/elite-redux/coop/authority-v2/adapters/interactions-learn";
import { decodeInteractionMaterial as mysteryDecodeInteractionMaterial } from "#data/elite-redux/coop/authority-v2/adapters/interactions-mystery";
import {
  buildRewardInteractionEntry,
  decodeBiomeInteractionMaterial,
  decodeMarketInteractionMaterial,
  decodeRewardInteractionMaterial,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-reward";
import { computeTurnCommitDigest } from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import type { CoopFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
import { encodeFrameV2 } from "#data/elite-redux/coop/authority-v2/frame-codec";
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
  isCoopV2ShadowActive,
  registerCoopV2ShadowInbound,
  routeCoopV2InboundFrame,
  setActiveCoopV2Shadow,
  tapCoopV2ShadowInteraction,
  tapCoopV2ShadowReplacementCommit,
  tapCoopV2ShadowTurnCommit,
} from "#data/elite-redux/coop/authority-v2/shadow";
import { setCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    peerBindings: [{ seatId: localSeatId === 0 ? 1 : 0, connectionGeneration: 0 }],
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
    nextCommandFrontier: {
      epoch: SESSION.epoch,
      wave: 5,
      resolvedTurn: 1,
      commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
    },
    legacyDigest,
  };
}

afterEach(() => {
  clearActiveCoopV2Shadow();
  clearCoopV2ShadowInbound();
});

// --- tests ------------------------------------------------------------------

describe("authority-v2 shadow harness", () => {
  it("rotates the authenticated frame axes in place after hot rejoin", () => {
    const clock = new FakeClock();
    const harness = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
    });
    const rebound: CoopV2ShadowIdentity = {
      ...identity(0),
      membershipRevision: 2,
      connectionGeneration: 1,
      peerBindings: [{ seatId: 1, connectionGeneration: 1 }],
    };

    expect(harness.rebindIdentity(rebound)).toBe(0);
    expect(harness.authenticatedFrameContext).toMatchObject({
      sessionId: SESSION.sessionId,
      runId: SESSION.runId,
      sessionEpoch: SESSION.epoch,
      membershipRevision: 2,
      senderSeatId: 0,
      authoritySeatId: 0,
      connectionGeneration: 1,
    });
    expect(harness.rebindIdentity(rebound)).toBe(0);
    expect(() => harness.rebindIdentity({ ...rebound, runId: "other-run" })).toThrow(/stable authenticated axis/u);
    harness.dispose();
  });

  it("retires a dark-channel lease when hot-rejoin redelivery and its receipt re-enter synchronously", () => {
    const clock = new FakeClock();
    let host!: CoopAuthorityV2Shadow;
    let guest!: CoopAuthorityV2Shadow;
    let receiptsReachHost = false;
    const cross = (target: () => CoopAuthorityV2Shadow, frame: CoopFrameV2): void => {
      routeCoopV2InboundFrameInto(target(), encodeFrameV2(frame));
    };
    host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => cross(() => guest, frame),
      scheduler: createCoopScheduler(clock),
    });
    guest = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        if (receiptsReachHost) {
          cross(() => host, frame);
        }
      },
      scheduler: createCoopScheduler(clock),
    });

    host.tapTurnCommit(turnTap("TURN/hot-rejoin-dark-channel"));
    expect(guest.diagnostics()).toMatchObject({ applied: 1, retained: 0 });
    expect(host.diagnostics().retained).toBe(1);

    const guestRebound: CoopV2ShadowIdentity = {
      ...identity(1),
      membershipRevision: 2,
      connectionGeneration: 1,
      peerBindings: [{ seatId: 0, connectionGeneration: 1 }],
    };
    const hostRebound: CoopV2ShadowIdentity = {
      ...identity(0),
      membershipRevision: 2,
      connectionGeneration: 1,
      peerBindings: [{ seatId: 1, connectionGeneration: 1 }],
    };
    expect(guest.rebindIdentity(guestRebound)).toBe(0);
    receiptsReachHost = true;
    expect(host.rebindIdentity(hostRebound)).toBe(1);
    expect(host.diagnostics().retained).toBe(0);
    expect(host.authenticatedFrameContext).toMatchObject({
      membershipRevision: 2,
      connectionGeneration: 1,
    });

    host.dispose();
    guest.dispose();
  });

  it("routes correlated recovery through live-only snapshot and control seams", async () => {
    const clock = new FakeClock();
    const applyMaterial = vi.fn(async () => true);
    const projectControl = vi.fn((_ctx, control) => ({
      kind: "installed" as const,
      controlId: controlIdOf(control),
    }));
    const terminal = vi.fn();
    const recovered = vi.fn();
    let host!: CoopAuthorityV2Shadow;
    let guest!: CoopAuthorityV2Shadow;
    const deliver = (target: () => CoopAuthorityV2Shadow) => (frame: CoopFrameV2) =>
      routeCoopV2InboundFrameInto(target(), encodeFrameV2(frame));
    host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => deliver(() => guest)(frame),
      scheduler: createCoopScheduler(clock),
      liveRecovery: {
        captureMaterial: () => ({ digest: "full-snapshot", payload: { wave: 5, hp: [100, 100] } }),
        applyMaterial,
        prepareControl: () => true,
        projectControl,
        onTerminal: terminal,
        onRecovered: recovered,
      },
    });
    guest = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => deliver(() => host)(frame),
      scheduler: createCoopScheduler(clock),
      liveRecovery: {
        captureMaterial: () => null,
        applyMaterial,
        prepareControl: () => true,
        projectControl,
        onTerminal: terminal,
        onRecovered: recovered,
      },
    });
    host.tapTurnCommit(turnTap("TURN/recovery-live-seam"));

    const recovery = guest.recover("checksum-mismatch");
    expect(recovery).not.toBeNull();
    await expect(recovery).resolves.toBe("recovered");
    expect(applyMaterial).toHaveBeenCalledTimes(1);
    expect(recovered).toHaveBeenCalledTimes(1);
    expect(projectControl).toHaveBeenCalledTimes(1);
    expect(terminal).not.toHaveBeenCalled();
    expect(guest.recoveryFencePredicates()?.isProgressionFrozen()).toBe(false);
    expect(host.diagnostics().recovery?.activeAuthorityResponses).toBe(0);

    host.dispose();
    guest.dispose();
  });

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
      nextCommandFrontier: {
        epoch: SESSION.epoch,
        wave: 6,
        resolvedTurn: 2,
        commands: [{ ownerSeatId: 0, pokemonId: 7, fieldIndex: 0 }],
      },
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
      successor: { kind: "REWARD", operationId: "TAP/reward/successor", ownerSeatId: 0 },
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

  it("never reports a valid mechanical frame as routed when no replica receiver is installed", () => {
    clearCoopV2ShadowInbound();
    expect(
      routeCoopV2InboundFrame({
        v: 2,
        t: "tailRequest",
        ctx: {
          sessionId: SESSION.sessionId,
          runId: SESSION.runId,
          sessionEpoch: SESSION.epoch,
          seatMapId: SESSION.seatMapId,
          membershipRevision: SESSION.membershipRevision,
          senderSeatId: 0,
          authoritySeatId: SESSION.authoritySeatId,
          connectionGeneration: 0,
        },
        body: { fromRevision: 0 },
      }),
    ).toBe("protocol-violation");
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
        successor: { kind: "REWARD", operationId: "THIN/reward/successor", ownerSeatId: 0 },
      }),
      legacyDigest: "legacy",
    });
    expect(host.diagnostics().committed).toBe(3);

    clearActiveCoopV2Shadow(host);
    host.dispose();
  });

  it("routes v2 frames PER TRANSPORT INSTANCE via onV2Frame - two harnesses in one process (duo)", async () => {
    // The duo-harness blocker (contract change request 2): the OLD single module-level inbound handler
    // could not disambiguate two harnesses in one process (the last registration won, so one harness got
    // NOTHING). Here each harness registers on its OWN transport endpoint's onV2Frame seam, so a frame
    // delivered on one loopback pair reaches ONLY that pair's harness - never the other pair's.
    const clock = new FakeClock();
    // Two INDEPENDENT loopback pairs => two independent sessions in ONE process.
    const pairA = createLoopbackPair();
    const pairB = createLoopbackPair();
    // Production always has a legacy `onMessage` subscriber (the session controller); register a no-op one on
    // every endpoint so the loopback's early-rx buffer drains and v2 frames dispatch (the harness itself only
    // subscribes the v2 seam).
    for (const t of [pairA.host, pairA.guest, pairB.host, pairB.guest]) {
      t.onMessage(() => {});
    }

    // The harness auto-registers its inbound handler on its injected transport's onV2Frame seam (constructor),
    // so NO module-level registerCoopV2ShadowInbound is used here - the whole point of the per-instance seam.
    const makeHarness = (localSeatId: number, endpoint: (typeof pairA)["host"]) =>
      new CoopAuthorityV2Shadow({
        identity: identity(localSeatId),
        scene: STUB_SCENE,
        transport: endpoint,
        // A v2 frame is now an additive arm of the CoopMessage union, so it crosses transport.send type-exact.
        send: frame => endpoint.send(frame),
        scheduler: createCoopScheduler(clock),
      });
    const hostA = makeHarness(0, pairA.host);
    const guestA = makeHarness(1, pairA.guest);
    const hostB = makeHarness(0, pairB.host);
    const guestB = makeHarness(1, pairB.guest);

    // Loopback delivery is asynchronous (queueMicrotask); flush both microtasks and one macrotask round.
    const flush = async () => {
      for (let i = 0; i < 8; i++) {
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    };

    // hostA taps a turn -> the entry crosses pairA ONLY.
    hostA.tapTurnCommit(turnTap("DUO/A/turn"));
    await flush();
    // The frame reached pairA's guest and NO OTHER harness (per-instance routing, not the global handler).
    expect(guestA.diagnostics().admitted).toBe(1);
    expect(guestB.diagnostics().admitted).toBe(0);
    expect(hostB.diagnostics().admitted).toBe(0);
    // The receipts round-tripped back over pairA and retired the entry on hostA.
    expect(hostA.diagnostics().retained).toBe(0);

    // hostB taps a turn -> the entry crosses pairB ONLY (guestA still untouched).
    hostB.tapTurnCommit(turnTap("DUO/B/turn"));
    await flush();
    expect(guestB.diagnostics().admitted).toBe(1);
    expect(guestA.diagnostics().admitted).toBe(1);
    expect(hostB.diagnostics().retained).toBe(0);

    hostA.dispose();
    guestA.dispose();
    hostB.dispose();
    guestB.dispose();
    pairA.host.close();
    pairB.host.close();
  });

  it("never routes an unowned concrete endpoint through another endpoint's global handler", async () => {
    const clock = new FakeClock();
    const pair = createLoopbackPair();
    pair.host.onMessage(() => {});
    pair.guest.onMessage(() => {});

    const crossedEndpoint = vi.fn();
    registerCoopV2ShadowInbound(crossedEndpoint);
    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: pair.host,
      send: frame => pair.host.send(frame),
      scheduler: createCoopScheduler(clock),
    });

    host.tapTurnCommit(turnTap("NO-RECEIVER/turn"));
    for (let i = 0; i < 8; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    expect(crossedEndpoint, "the guest endpoint cannot borrow another endpoint's receiver").not.toHaveBeenCalled();
    expect(host.diagnostics().retained, "no receiver means no forged receipt retires the entry").toBe(1);

    host.dispose();
    pair.host.close();
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

// =============================================================================
// PARITY FIDELITY (authority-v2 shadow parity-fidelity phase). The properties:
//   - deliverable 1: a tap fingerprints the LEGACY image through the SAME adapter
//     digest as the v2 entry, so parity match=true is ACHIEVABLE (identical states)
//     and a match=false names the divergent field (differing states, not encodings);
//   - deliverable 2: the turn tap records whether the next-command successor seat is
//     the REAL field-seat owner or a best-effort fallback (never a silent degrade);
//   - deliverable 3: the relay-primitive interaction tap routes each pick to its
//     MATCHING adapter builder by kind (reward/market/biome, mystery, learn), and an
//     unknown kind keeps the generic reward path with the kind recorded - fault-free.
// =============================================================================

describe("authority-v2 shadow PARITY FIDELITY", () => {
  const captured: string[] = [];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captured.length = 0;
    setCoopDebug(true);
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      captured.push(args.map(a => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    setCoopDebug(false);
    clearActiveCoopV2Shadow();
    clearCoopV2ShadowInbound();
  });

  /** The most recent PARITY log line for a tap kind. */
  const parityLine = (kind: string): string =>
    captured.filter(line => line.includes("PARITY") && line.includes(`kind=${kind}`)).at(-1) ?? "";

  const waveTransition = (nextWave: number) =>
    ({
      kind: "wave-advance",
      wave: 5,
      turn: 1,
      outcome: "win",
      nextWave,
      biomeChange: false,
      eggLapse: true,
      meBoundary: "none",
      victoryKind: "wild",
    }) as const;

  const terminalMaterial = (reason: "game-over" | "final-flee") =>
    ({ kind: "terminal", terminalId: "term-parity", reason, wave: 6, turn: 1 }) as const;

  const replacementProposal = (speciesId: number) => ({
    sourceAddress: { epoch: SESSION.epoch, wave: 5, turn: 1, occurrence: 0, fieldIndex: 0 },
    ownerSeatId: 0,
    selected: { partySlot: 2, speciesId },
  });

  // ------------------------------------------------------------------------
  // Deliverable 1 - match=true per tap kind when the legacy image equals the v2 state.
  // ------------------------------------------------------------------------

  it("TURN parity match=true when the legacy image equals the v2 capture (like-for-like)", () => {
    const duo = buildDuo(new FakeClock());
    const capture = { turnResolution: { events: [7, 8] }, checkpoint: { hp: 42 } };
    duo.host.tapTurnCommit({
      operationId: "TURN/parity-true",
      capture,
      nextCommandFrontier: {
        epoch: SESSION.epoch,
        wave: 5,
        resolvedTurn: 1,
        commands: [{ ownerSeatId: 0, pokemonId: 9, fieldIndex: 0 }],
      },
      legacyImage: capture,
      legacyDigest: "raw-full-state-checksum",
      successorSeatSource: "owner-field",
    });
    const diag = duo.host.diagnostics();
    expect(diag.parityChecks).toBe(1);
    expect(diag.parityMatches).toBe(1);
    expect(diag.faults).toBe(0);
    const line = parityLine("TURN_COMMIT");
    expect(line).toContain("match=true");
    expect(line).toContain("field=-");
    expect(line).toContain("successor=owner-field");
    duo.dispose();
  });

  it("TURN parity match=false with the divergent field named when the states differ", () => {
    const duo = buildDuo(new FakeClock());
    duo.host.tapTurnCommit({
      operationId: "TURN/parity-false",
      capture: { turnResolution: { events: [7, 8] }, checkpoint: { hp: 42 } },
      nextCommandFrontier: {
        epoch: SESSION.epoch,
        wave: 5,
        resolvedTurn: 1,
        commands: [{ ownerSeatId: 0, pokemonId: 9, fieldIndex: 0 }],
      },
      // A legacy image whose checkpoint DIVERGES from the v2 capture -> the two states differ.
      legacyImage: { turnResolution: { events: [7, 8] }, checkpoint: { hp: 999 } },
      legacyDigest: "raw-full-state-checksum",
      successorSeatSource: "local-role-fallback",
    });
    const diag = duo.host.diagnostics();
    expect(diag.parityChecks).toBe(1);
    expect(diag.parityMatches).toBe(0);
    const line = parityLine("TURN_COMMIT");
    expect(line).toContain("match=false");
    expect(line).toContain("field=materialDigest");
    // Deliverable 2: a best-effort successor seat is NAMED, never silently degraded.
    expect(line).toContain("successor=local-role-fallback");
    duo.dispose();
  });

  it("REPLACEMENT parity match=true/false by fingerprinting the legacy image through the faint adapter", () => {
    const duo = buildDuo(new FakeClock());
    // Identical legacy image -> match=true.
    duo.host.tapReplacementCommit({
      proposal: replacementProposal(25),
      resolution: "owner-pick",
      successor: { kind: "terminal" },
      legacyDigest: "op-id",
      legacyImage: { proposal: replacementProposal(25), resolution: "owner-pick" },
    });
    // A legacy image resolving a DIFFERENT species -> the resolved states differ -> match=false.
    duo.host.tapReplacementCommit({
      proposal: replacementProposal(25),
      resolution: "owner-pick",
      successor: { kind: "terminal" },
      operationId: "RC/divergent",
      legacyDigest: "op-id",
      legacyImage: { proposal: replacementProposal(999), resolution: "owner-pick" },
    });
    const diag = duo.host.diagnostics();
    expect(diag.parityChecks).toBe(2);
    expect(diag.parityMatches).toBe(1);
    expect(diag.faults).toBe(0);
    expect(parityLine("REPLACEMENT_COMMIT")).toContain("match=false");
    expect(parityLine("REPLACEMENT_COMMIT")).toContain("field=digest");
    duo.dispose();
  });

  it("WAVE parity match=true/false by fingerprinting the legacy transition image", () => {
    const duo = buildDuo(new FakeClock());
    const destination = { kind: "REWARD", operationId: "W/reward", ownerSeatId: 0 } as const;
    duo.host.tapWaveAdvance({
      operationId: "WAVE/true",
      transition: waveTransition(6),
      destination,
      legacyDigest: "legacy-wave-token",
      legacyImage: waveTransition(6),
    });
    duo.host.tapWaveAdvance({
      operationId: "WAVE/false",
      transition: waveTransition(6),
      destination,
      legacyDigest: "legacy-wave-token",
      legacyImage: waveTransition(7), // a divergent nextWave -> states differ
    });
    const diag = duo.host.diagnostics();
    expect(diag.parityMatches).toBe(1);
    expect(diag.faults).toBe(0);
    expect(parityLine("WAVE_ADVANCE")).toContain("match=false");
    expect(parityLine("WAVE_ADVANCE")).toContain("field=materialDigest");
    duo.dispose();
  });

  it("TERMINAL parity match=true/false by fingerprinting the legacy terminal image", () => {
    const duo = buildDuo(new FakeClock());
    duo.host.tapTerminal({
      operationId: "TERM/true",
      terminal: terminalMaterial("game-over"),
      legacyDigest: "legacy-term-token",
      legacyImage: terminalMaterial("game-over"),
    });
    duo.host.tapTerminal({
      operationId: "TERM/false",
      terminal: terminalMaterial("game-over"),
      legacyDigest: "legacy-term-token",
      legacyImage: terminalMaterial("final-flee"), // a divergent reason -> states differ
    });
    const diag = duo.host.diagnostics();
    expect(diag.parityMatches).toBe(1);
    expect(diag.faults).toBe(0);
    expect(parityLine("TERMINAL_COMMIT")).toContain("match=false");
    duo.dispose();
  });

  it("INTERACTION (pre-built) parity match=true/false by fingerprinting the legacy interaction image", () => {
    const duo = buildDuo(new FakeClock());
    const reward = (choice: { kind: "leave" } | { kind: "skip" }) =>
      buildRewardInteractionEntry({
        context: duo.host.authenticatedFrameContext,
        address: { epoch: SESSION.epoch, wave: 6, ownerSeatId: 0, actionOrdinal: 0 },
        material: { kind: "reward", wave: 6, ownerSeatId: 0, choice, terminal: true },
        successor: { kind: "REWARD", operationId: "PARITY/reward/successor", ownerSeatId: 0 },
      });
    // Identical legacy image -> match=true.
    duo.host.tapInteraction({
      entry: reward({ kind: "leave" }),
      legacyDigest: "tok",
      legacyImage: reward({ kind: "leave" }),
    });
    // A legacy image with a DIFFERENT choice -> states differ -> match=false.
    duo.host.tapInteraction({
      entry: reward({ kind: "leave" }),
      legacyDigest: "tok",
      legacyImage: reward({ kind: "skip" }),
    });
    const diag = duo.host.diagnostics();
    expect(diag.parityChecks).toBe(2);
    expect(diag.parityMatches).toBe(1);
    expect(diag.faults).toBe(0);
    expect(parityLine("INTERACTION_COMMIT")).toContain("match=false");
    duo.dispose();
  });

  // ------------------------------------------------------------------------
  // Deliverable 3 - per-surface interaction routing (relay-primitive tap).
  // ------------------------------------------------------------------------

  it("routes each relay interaction kind to its MATCHING adapter builder (fault-free)", () => {
    const duo = buildDuo(new FakeClock());
    const host = duo.host;
    const tap = (kind: string, choice: number, data?: number[]) =>
      host.tapInteractionChoice({ seq: 1, kind, choice, ownerSeatId: 0, wave: 5, ...(data == null ? {} : { data }) });

    // interactions-reward: BIOME pick + crossroads.
    const biomePick = tap("biomePick", 0, [3]);
    expect(decodeBiomeInteractionMaterial(biomePick!)?.selection.kind).toBe("biome-pick");
    const crossroads = tap("crossroads", 1);
    expect(decodeBiomeInteractionMaterial(crossroads!)?.selection.kind).toBe("crossroads-pick");

    // interactions-reward: MARKET (the biome shop).
    const market = tap("biomeShop", 0, [1, 200]);
    expect(decodeMarketInteractionMaterial(market!)?.kind).toBe("market");

    // interactions-learn: ability / colosseum / stormglass / learn-move.
    expect(learnDecodeInteractionMaterial(tap("abilityPicker", -3, [1, 2, 3])!)?.surface).toBe("ability-pick");
    expect(learnDecodeInteractionMaterial(tap("coloPick", 0, [4])!)?.surface).toBe("colosseum/decision");
    expect(learnDecodeInteractionMaterial(tap("stormglass", 2)!)?.surface).toBe("stormglass");
    expect(learnDecodeInteractionMaterial(tap("learnMove", 1)!)?.surface).toBe("learn-move/decision");

    // interactions-mystery: ME option-pick, ME terminal (a LEAVE sentinel), catch-full.
    expect(mysteryDecodeInteractionMaterial(tap("me", 0, [0])!)?.kind).toBe("me-option-pick");
    expect(mysteryDecodeInteractionMaterial(tap("meBtn", -1)!)?.kind).toBe("me-terminal");
    expect(mysteryDecodeInteractionMaterial(tap("catchFull", 2)!)?.kind).toBe("catch-full");

    // an UNKNOWN kind keeps the generic reward path with the kind recorded in the parity line.
    const unknown = tap("quizAns", 0);
    expect(decodeRewardInteractionMaterial(unknown!)?.kind).toBe("reward");
    expect(parityLine("INTERACTION_COMMIT")).toContain("surface=reward/generic(quizAns)");

    // Every routed pick committed WITHOUT a single shadow fault.
    expect(host.diagnostics().faults).toBe(0);
    duo.dispose();
  });

  it("records the routed surface + relay kind in the interaction parity line (judgeable routing)", () => {
    const duo = buildDuo(new FakeClock());
    duo.host.tapInteractionChoice({ seq: 2, kind: "biomeShop", choice: 0, data: [0, 50], ownerSeatId: 0, wave: 8 });
    const line = parityLine("INTERACTION_COMMIT");
    expect(line).toContain("surface=market");
    expect(line).toContain("kind=biomeShop");
    duo.dispose();
  });

  it("keeps lossy relay-choice shadow telemetry out of a live mechanical V2 log", () => {
    const clock = new FakeClock();
    const liveReplica: CoopV2LiveReplicaSeams = {
      ownsEntry: () => false,
      ownsControl: () => false,
      admitEntry: () => true,
      applyMaterial: () => null,
      projectControl: () => null,
    };
    const harness = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
      liveReplica,
    });

    expect(
      harness.tapInteractionChoice({
        seq: 4,
        kind: "biomeShop",
        choice: 0,
        data: [0, 50],
        ownerSeatId: 0,
        wave: 8,
      }),
    ).toBeNull();
    expect(harness.diagnostics()).toMatchObject({ committed: 0, retained: 0, parityChecks: 0 });
    harness.dispose();
  });
});
