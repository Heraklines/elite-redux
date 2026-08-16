/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane unit tests for co-op AUTHORITY V2 - the SHADOW harness (wiring lane).
//
// The ordinary harness imports NOTHING from Phaser/engine at runtime (BattleScene
// and CoopTransport are TYPE-ONLY; the shadow projector + applier never touch the
// scene). One focused protocol-terminal case dynamically loads the production
// runtime composition root because only that path owns failCoopRuntimeSharedSession.
// The properties pinned here are the shadow-mode contract:
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
import { buildReplacementCommitEntry } from "#data/elite-redux/coop/authority-v2/adapters/faint-replacement";
import { decodeInteractionMaterial as learnDecodeInteractionMaterial } from "#data/elite-redux/coop/authority-v2/adapters/interactions-learn";
import { decodeInteractionMaterial as mysteryDecodeInteractionMaterial } from "#data/elite-redux/coop/authority-v2/adapters/interactions-mystery";
import {
  buildRewardInteractionEntry,
  decodeBiomeInteractionMaterial,
  decodeMarketInteractionMaterial,
  decodeRewardInteractionMaterial,
  rewardOperationId,
} from "#data/elite-redux/coop/authority-v2/adapters/interactions-reward";
import { computeTurnCommitDigest } from "#data/elite-redux/coop/authority-v2/adapters/turn-command";
import { buildWaveAdvanceEntry } from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import type {
  CoopAuthorityEntry,
  CoopFrameContextV2,
  CoopNextControl,
} from "#data/elite-redux/coop/authority-v2/contract";
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
import {
  COOP_CAP_AUTHORITY_V2_SHADOW,
  COOP_CAP_AUTHORITY_V2_TURN,
  COOP_CAP_DURABILITY_JOURNAL,
  COOP_CAP_OP_BIOME,
  COOP_CAP_OP_ME,
} from "#data/elite-redux/coop/coop-capabilities";
import { setCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import {
  type CoopAccountIdentityV1,
  createFreshCoopP33Context,
} from "#data/elite-redux/coop/coop-session-binding";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import {
  COOP_PROTOCOL_VERSION,
  type CoopMessage,
  type CoopTransport,
  createLoopbackPair,
} from "#data/elite-redux/coop/coop-transport";
import {
  type CoopWireChannel,
  WebRtcTransport,
} from "#data/elite-redux/coop/coop-webrtc-transport";
import {
  faultableTypes,
  type CoopFaultPair,
  type CoopFaultProfile,
  wrapCoopFaultPair,
} from "#test/tools/coop-fault-transport";
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

function canonicalBoundaryProofRequestId(
  senderSeatId: number,
  sequence: number,
  sessionId = SESSION.sessionId,
): string {
  return `authority-v2:${sessionId}:seat${senderSeatId}:boundary-proof:${sequence}`;
}

function awaitSuccessor(
  afterOperationId: string,
  wave: number,
  turn: number,
  allowNextWaveStart: boolean,
): Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }> {
  return {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId,
    epoch: SESSION.epoch,
    wave,
    turn,
    allowedKinds: ["CONTROL_COMMIT", "INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
    allowNextWaveStart,
    expectedOperationId: null,
  };
}

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
  const capture = { wave: 5, turn: 1, turnResolution: { events: [1, 2, 3] }, checkpoint: { hp: 100 } };
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

function orderedInteractionEntry(
  harness: CoopAuthorityV2Shadow,
  actionOrdinal: number,
): Omit<CoopAuthorityEntry, "revision"> {
  const operationId = `retained-interaction-${actionOrdinal}`;
  return {
    context: harness.authenticatedFrameContext,
    operationId,
    kind: "INTERACTION_COMMIT",
    material: {
      digest: `retained-interaction-digest-${actionOrdinal}`,
      payload: {
        envelope: {
          sessionEpoch: SESSION.epoch,
          wave: 5,
          turn: 1,
          pendingOperation: { id: operationId, kind: "REWARD" },
        },
      },
    },
    nextControl: awaitSuccessor(operationId, 5, 1, true),
    subsumes: [],
  };
}

function narrowBoundaryWait(afterOperationId: string): Extract<CoopNextControl, { kind: "AWAIT_SUCCESSOR" }> {
  return {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId,
    epoch: SESSION.epoch,
    wave: 5,
    turn: 1,
    allowedKinds: ["INTERACTION_COMMIT"],
    allowNextWaveStart: false,
    expectedOperationId: null,
  };
}

function boundaryWaveTap(operationId: string, predecessorRevision: number) {
  return {
    operationId,
    transition: {
      kind: "wave-advance" as const,
      wave: 5,
      turn: 1,
      outcome: "win" as const,
      nextWave: 6,
      biomeChange: false,
      eggLapse: false,
      meBoundary: "none" as const,
      victoryKind: "wild" as const,
    },
    destination: narrowBoundaryWait(operationId),
    legacyDigest: `legacy-${operationId}`,
    subsumes: [predecessorRevision],
  };
}

interface ManualBoundaryDuo {
  readonly clock: FakeClock;
  readonly host: CoopAuthorityV2Shadow;
  readonly guest: CoopAuthorityV2Shadow;
  readonly hostToGuest: CoopFrameV2[];
  readonly guestToHost: CoopFrameV2[];
  readonly appliedRevisions: number[];
  readonly violations: string[][];
  dispose(): void;
}

function cloneFrame(frame: CoopFrameV2): CoopFrameV2 {
  return structuredClone(frame);
}

/** Minimal injectable carrier used to exercise WebRtcTransport's real generation fence. */
class InjectableWire implements CoopWireChannel {
  readyState = "open";
  readonly sent: string[] = [];
  private messageHandler: ((data: string) => void) | null = null;
  private openHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === "closed") {
      return;
    }
    this.readyState = "closed";
    this.closeHandler?.();
  }

  onMessage(handler: (data: string) => void): void {
    this.messageHandler = handler;
  }

  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  inject(frame: CoopFrameV2): void {
    this.messageHandler?.(encodeFrameV2(frame));
  }

  open(): void {
    this.readyState = "open";
    this.openHandler?.();
  }
}

function takeFrame(
  queue: CoopFrameV2[],
  description: string,
  predicate: (frame: CoopFrameV2) => boolean,
): CoopFrameV2 {
  const index = queue.findIndex(predicate);
  if (index < 0) {
    throw new Error(`missing ${description}`);
  }
  return queue.splice(index, 1)[0];
}

function makeManualBoundaryDuo(guestTransport: CoopTransport = STUB_TRANSPORT): ManualBoundaryDuo {
  const clock = new FakeClock();
  const hostToGuest: CoopFrameV2[] = [];
  const guestToHost: CoopFrameV2[] = [];
  const appliedRevisions: number[] = [];
  const violations: string[][] = [];
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;

  host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    send: frame => hostToGuest.push(cloneFrame(frame)),
    scheduler: createCoopScheduler(clock),
  });
  guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: guestTransport,
    send: frame => guestToHost.push(cloneFrame(frame)),
    scheduler: createCoopScheduler(clock),
    onProtocolViolation: violation => violations.push([...violation.issues]),
    liveReplica: {
      ownsEntry: entry => entry.kind === "TURN_COMMIT" || entry.kind === "WAVE_ADVANCE",
      ownsControl: () => true,
      applyMaterial: (_ctx, entry) => {
        appliedRevisions.push(entry.revision);
        return true;
      },
      projectControl: (_ctx, control) => ({ kind: "installed", controlId: controlIdOf(control) }),
    },
  });

  return {
    clock,
    host,
    guest,
    hostToGuest,
    guestToHost,
    appliedRevisions,
    violations,
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

function makeSynchronousBoundaryDuo(): {
  readonly clock: FakeClock;
  readonly host: CoopAuthorityV2Shadow;
  readonly guest: CoopAuthorityV2Shadow;
  readonly appliedRevisions: number[];
  readonly violations: string[][];
  dispose(): void;
} {
  const clock = new FakeClock();
  const appliedRevisions: number[] = [];
  const violations: string[][] = [];
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;
  host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    send: frame => guest.handleInboundFrame(frame),
    scheduler: createCoopScheduler(clock),
  });
  guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: STUB_TRANSPORT,
    send: frame => {
      if (frame.t !== "authorityReceipt") {
        host.handleInboundFrame(frame);
      }
    },
    scheduler: createCoopScheduler(clock),
    onProtocolViolation: violation => violations.push([...violation.issues]),
    liveReplica: {
      ownsEntry: entry => entry.kind === "TURN_COMMIT" || entry.kind === "WAVE_ADVANCE",
      ownsControl: () => true,
      applyMaterial: (_ctx, entry) => {
        appliedRevisions.push(entry.revision);
        return true;
      },
      projectControl: (_ctx, control) => ({ kind: "installed", controlId: controlIdOf(control) }),
    },
  });
  return {
    clock,
    host,
    guest,
    appliedRevisions,
    violations,
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

function stageManualBoundaryCandidate(duo: ManualBoundaryDuo): {
  predecessorFrame: Extract<CoopFrameV2, { t: "authorityEntry" }>;
  candidateFrame: Extract<CoopFrameV2, { t: "authorityEntry" }>;
  firstRequest: Extract<CoopFrameV2, { t: "tailRequest" }>;
} {
  const predecessorOperationId = "BOUNDARY/predecessor";
  const predecessor = duo.host.tapTurnCommit({
    ...turnTap(predecessorOperationId),
    nextCommandFrontier: null,
    nextSuccessorWait: narrowBoundaryWait(predecessorOperationId),
  });
  expect(predecessor).not.toBeNull();
  if (predecessor == null) {
    throw new Error("boundary predecessor was not committed");
  }
  const predecessorFrame = takeFrame(
    duo.hostToGuest,
    "predecessor authorityEntry",
    frame => frame.t === "authorityEntry" && frame.body.revision === 1,
  ) as Extract<CoopFrameV2, { t: "authorityEntry" }>;
  duo.guest.handleInboundFrame(predecessorFrame);
  expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1 });

  const candidateOperationId = "BOUNDARY/wave";
  const candidate = duo.host.tapWaveAdvance(boundaryWaveTap(candidateOperationId, predecessor.revision));
  expect(candidate).not.toBeNull();
  if (candidate == null) {
    throw new Error("boundary candidate was not committed");
  }
  const candidateFrame = takeFrame(
    duo.hostToGuest,
    "boundary candidate authorityEntry",
    frame => frame.t === "authorityEntry" && frame.body.revision === 2,
  ) as Extract<CoopFrameV2, { t: "authorityEntry" }>;
  duo.guest.handleInboundFrame(candidateFrame);
  expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1 });

  const firstRequest = takeFrame(
    duo.guestToHost,
    "correlated tailRequest",
    frame => frame.t === "tailRequest" && frame.body.requestId != null,
  ) as Extract<CoopFrameV2, { t: "tailRequest" }>;
  return { predecessorFrame, candidateFrame, firstRequest };
}

function answerManualBoundaryRequest(
  duo: ManualBoundaryDuo,
  request: Extract<CoopFrameV2, { t: "tailRequest" }>,
): {
  manifest: Extract<CoopFrameV2, { t: "tailProof" }>;
  source: Extract<CoopFrameV2, { t: "authorityEntry" }>;
  complete: Extract<CoopFrameV2, { t: "tailProof" }>;
} {
  duo.host.handleInboundFrame(request);
  const manifest = takeFrame(
    duo.hostToGuest,
    "tail-proof manifest",
    frame => frame.t === "tailProof" && frame.body.phase === "manifest",
  ) as Extract<CoopFrameV2, { t: "tailProof" }>;
  const source = takeFrame(
    duo.hostToGuest,
    "manifest-listed source authorityEntry",
    frame => frame.t === "authorityEntry" && frame.body.revision === 1,
  ) as Extract<CoopFrameV2, { t: "authorityEntry" }>;
  const complete = takeFrame(
    duo.hostToGuest,
    "tail-proof complete",
    frame => frame.t === "tailProof" && frame.body.phase === "complete",
  ) as Extract<CoopFrameV2, { t: "tailProof" }>;
  return { manifest, source, complete };
}

function deliverManualReceipts(
  duo: ManualBoundaryDuo,
  predicate: (frame: Extract<CoopFrameV2, { t: "authorityReceipt" }>) => boolean = () => true,
): number {
  const receipts = duo.guestToHost.filter(
    (frame): frame is Extract<CoopFrameV2, { t: "authorityReceipt" }> =>
      frame.t === "authorityReceipt" && predicate(frame),
  );
  for (const receipt of receipts) {
    const index = duo.guestToHost.indexOf(receipt);
    if (index >= 0) {
      duo.guestToHost.splice(index, 1);
    }
    duo.host.handleInboundFrame(receipt);
  }
  return receipts.length;
}

async function flushLoopbackMicrotasks(rounds = 12): Promise<void> {
  for (let index = 0; index < rounds; index++) {
    await Promise.resolve();
  }
}

interface FaultBoundaryDuo {
  readonly clock: FakeClock;
  readonly host: CoopAuthorityV2Shadow;
  readonly guest: CoopAuthorityV2Shadow;
  readonly pair: CoopFaultPair;
  readonly appliedRevisions: number[];
  readonly violations: string[][];
  dispose(): void;
}

function makeFaultBoundaryDuo(profile: CoopFaultProfile): FaultBoundaryDuo {
  const rawPair = createLoopbackPair();
  const pair = wrapCoopFaultPair(rawPair, profile, { seed: 0x4d335441 });
  // The production legacy subscriber is what drains the loopback early-rx buffer. The shadow itself uses the
  // separate per-instance v2 receiver and must not borrow a module-global handler.
  pair.host.onMessage(() => {});
  pair.guest.onMessage(() => {});
  const clock = new FakeClock();
  const appliedRevisions: number[] = [];
  const violations: string[][] = [];
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;
  host = new CoopAuthorityV2Shadow({
    identity: identity(0),
    scene: STUB_SCENE,
    transport: pair.host,
    send: frame => pair.host.send(frame),
    scheduler: createCoopScheduler(clock),
  });
  guest = new CoopAuthorityV2Shadow({
    identity: identity(1),
    scene: STUB_SCENE,
    transport: pair.guest,
    send: frame => {
      // Hold the authority lease open for the proof fixture. Tail requests still use the real faulting
      // transport; only replica receipts are withheld until a test explicitly wants lease retirement.
      if (frame.t !== "authorityReceipt") {
        pair.guest.send(frame);
      }
    },
    scheduler: createCoopScheduler(clock),
    onProtocolViolation: violation => violations.push([...violation.issues]),
    liveReplica: {
      ownsEntry: entry => entry.kind === "TURN_COMMIT" || entry.kind === "WAVE_ADVANCE",
      ownsControl: () => true,
      applyMaterial: (_ctx, entry) => {
        appliedRevisions.push(entry.revision);
        return true;
      },
      projectControl: (_ctx, control) => ({ kind: "installed", controlId: controlIdOf(control) }),
    },
  });
  return {
    clock,
    host,
    guest,
    pair,
    appliedRevisions,
    violations,
    dispose: () => {
      host.dispose();
      guest.dispose();
      pair.host.close();
      pair.guest.close();
    },
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
    const capture = { wave: 5, turn: 2, turnResolution: { events: [9] }, checkpoint: { hp: 1 } };
    const matchingDigest = computeTurnCommitDigest(capture);
    duo.host.tapTurnCommit({
      operationId: "TURN/match",
      capture,
      nextCommandFrontier: {
        epoch: SESSION.epoch,
        wave: 5,
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
    const duos = Array.from({ length: 5 }, () => buildDuo(clock));

    duos[0].host.tapTurnCommit(turnTap("TAP/turn"));
    duos[1].host.tapReplacementCommit({
      proposal: {
        sourceAddress: { epoch: SESSION.epoch, wave: 5, turn: 1, occurrence: 0, fieldIndex: 0 },
        ownerSeatId: 0,
        selected: { partySlot: 2, speciesId: 25 },
      },
      resolution: "owner-pick",
      successor: { kind: "terminal" },
      legacyDigest: "legacy-replace",
    });
    const waveOperationId = "TAP/wave";
    duos[2].host.tapWaveAdvance({
      operationId: waveOperationId,
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
      destination: awaitSuccessor(waveOperationId, 5, 1, true),
      legacyDigest: "legacy-wave",
    });
    duos[3].host.tapTerminal({
      operationId: "TAP/terminal",
      terminal: { kind: "terminal", terminalId: "term-1", reason: "game-over", wave: 6, turn: 1 },
      legacyDigest: "legacy-terminal",
    });
    const rewardAddress = { epoch: SESSION.epoch, wave: 6, ownerSeatId: 0, actionOrdinal: 0 } as const;
    const rewardEntry = buildRewardInteractionEntry({
      context: duos[4].host.authenticatedFrameContext,
      address: rewardAddress,
      material: { kind: "reward", wave: 6, ownerSeatId: 0, choice: { kind: "leave" }, terminal: true },
      successor: awaitSuccessor(rewardOperationId(rewardAddress), 6, 1, true),
    });
    duos[4].host.tapInteraction({ entry: rewardEntry, legacyDigest: "legacy-interaction" });

    const hosts = duos.map(duo => duo.host.diagnostics());
    const guests = duos.map(duo => duo.guest.diagnostics());
    expect(hosts.reduce((sum, host) => sum + host.committed, 0)).toBe(5);
    expect(hosts.reduce((sum, host) => sum + host.parityChecks, 0)).toBe(5);
    expect(guests.reduce((sum, guest) => sum + guest.admitted, 0)).toBe(5);
    expect(guests.reduce((sum, guest) => sum + guest.applied, 0)).toBe(5);
    // Everything retired end-to-end; zero leaked timers on both sides.
    expect(hosts.every(host => host.retained === 0 && host.pendingTimers === 0)).toBe(true);
    expect(guests.every(guest => guest.pendingTimers === 0)).toBe(true);

    for (const duo of duos) {
      duo.dispose();
    }
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

  it("does not re-apply live material when its own synchronous receipt path redelivers the same revision", () => {
    const clock = new FakeClock();
    const violations: string[] = [];
    let host!: CoopAuthorityV2Shadow;
    let guest!: CoopAuthorityV2Shadow;
    let deliveredEntry: CoopFrameV2 | null = null;
    let materialApplications = 0;
    const liveReplica: CoopV2LiveReplicaSeams = {
      ownsEntry: () => true,
      ownsControl: () => true,
      admitEntry: () => true,
      applyMaterial: () => {
        materialApplications += 1;
        if (materialApplications === 1 && deliveredEntry != null) {
          guest.handleInboundFrame(deliveredEntry);
        }
        return true;
      },
      projectControl: (_ctx, control) => ({ kind: "installed", controlId: controlIdOf(control) }),
    };
    host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        if (frame.t === "authorityEntry") {
          deliveredEntry = frame;
        }
        guest.handleInboundFrame(frame);
      },
      scheduler: createCoopScheduler(clock),
    });
    guest = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => host.handleInboundFrame(frame),
      scheduler: createCoopScheduler(clock),
      liveReplica,
      onProtocolViolation: violation => violations.push(violation.issues.join(",")),
    });

    expect(host.tapTurnCommit(turnTap("TURN/reentrant-redelivery"))).not.toBeNull();
    expect(materialApplications).toBe(1);
    expect(violations).toEqual([]);
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1 });
    expect(host.diagnostics().retained).toBe(0);

    host.dispose();
    guest.dispose();
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

describe("authority-v2 retained gaps and hot-rejoin invariants", () => {
  it("retains an authenticated successor gap and redrives it inline after predecessor control installs", () => {
    const clock = new FakeClock();
    const authorityDeliveries: number[] = [];
    const appliedRevisions: number[] = [];
    let controlReady = false;
    let guest!: CoopAuthorityV2Shadow;

    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        if (frame.t === "authorityEntry") {
          authorityDeliveries.push(frame.body.revision);
        }
        guest.handleInboundFrame(frame);
      },
      scheduler: createCoopScheduler(clock),
    });
    guest = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      // Keep receipts off the authority wire so the successor can only be completed by the replica's inline
      // retained-entry redrive, never by an authority redelivery or a timer tick.
      send: () => {},
      scheduler: createCoopScheduler(clock),
      liveReplica: {
        ownsEntry: entry => entry.kind === "TURN_COMMIT" || entry.kind === "INTERACTION_COMMIT",
        ownsControl: control => control.kind === "AWAIT_SUCCESSOR",
        applyMaterial: (_ctx, entry) => {
          appliedRevisions.push(entry.revision);
          return true;
        },
        projectControl: (_ctx, control) =>
          controlReady
            ? { kind: "installed", controlId: controlIdOf(control) }
            : { kind: "deferred", reason: "successor surface is still parked" },
      },
    });

    expect(
      host.tapTurnCommit({ ...turnTap("TURN/retained-gap-predecessor"), nextCommandFrontier: null }),
    ).not.toBeNull();
    expect(
      host.tapInteraction({ entry: orderedInteractionEntry(host, 0), legacyDigest: "legacy-retained-gap-successor" }),
    ).not.toBeNull();
    expect(authorityDeliveries).toEqual([1, 2]);
    expect(appliedRevisions).toEqual([1]);
    expect(guest.diagnostics()).toMatchObject({
      admitted: 1,
      applied: 1,
      controlLedgerSize: 0,
      shadowStateSize: 1,
    });

    controlReady = true;
    // Revision 1 completes first; its exact retained revision-2 gap is then consumed in the same call stack.
    expect(guest.retryPendingReplicaEntries()).toBe(1);
    expect(authorityDeliveries).toEqual([1, 2]);
    expect(appliedRevisions).toEqual([1, 2]);
    expect(guest.diagnostics()).toMatchObject({
      admitted: 2,
      applied: 2,
      controlLedgerSize: 2,
      shadowStateSize: 2,
    });

    host.dispose();
    guest.dispose();
  });

  it("keeps exact retained duplicates idempotent and rejects conflicting same-revision bodies", () => {
    const clock = new FakeClock();
    const violations: string[][] = [];
    let materialMutations = 0;
    let controlAttempts = 0;
    let deliveredEntry: Extract<CoopFrameV2, { t: "authorityEntry" }> | null = null;
    let guest!: CoopAuthorityV2Shadow;

    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        if (frame.t === "authorityEntry") {
          deliveredEntry = frame;
        }
        guest.handleInboundFrame(frame);
      },
      scheduler: createCoopScheduler(clock),
    });
    guest = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
      onProtocolViolation: violation => violations.push([...violation.issues]),
      liveReplica: {
        ownsEntry: entry => entry.kind === "TURN_COMMIT",
        ownsControl: control => control.kind === "AWAIT_SUCCESSOR",
        applyMaterial: () => {
          materialMutations += 1;
          return true;
        },
        projectControl: () => {
          controlAttempts += 1;
          return { kind: "deferred", reason: "retain this revision for duplicate checks" };
        },
      },
    });

    expect(host.tapTurnCommit({ ...turnTap("TURN/retained-duplicate"), nextCommandFrontier: null })).not.toBeNull();
    if (deliveredEntry == null) {
      throw new Error("the retained duplicate fixture did not receive its authority entry");
    }
    expect(materialMutations).toBe(1);
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, controlLedgerSize: 0, shadowStateSize: 1 });

    // The exact same retained body resumes only the unfinished control stage.
    guest.handleInboundFrame(deliveredEntry);
    expect(materialMutations).toBe(1);
    expect(controlAttempts).toBe(2);
    expect(violations).toEqual([]);
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, controlLedgerSize: 0, shadowStateSize: 1 });

    const conflictingEntry: Extract<CoopFrameV2, { t: "authorityEntry" }> = {
      ...deliveredEntry,
      body: {
        ...deliveredEntry.body,
        material: {
          ...deliveredEntry.body.material,
          digest: `${deliveredEntry.body.material.digest}-conflict`,
        },
      },
    };
    guest.handleInboundFrame(conflictingEntry);
    expect(materialMutations).toBe(1);
    expect(controlAttempts).toBe(2);
    expect(violations).toContainEqual(["entry.conflicting-pending-revision-1"]);
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, controlLedgerSize: 0, shadowStateSize: 1 });

    host.dispose();
    guest.dispose();
  });

  it("re-addresses retained admitted and gap entries across hot rebind and rejects the old generation", () => {
    const clock = new FakeClock();
    const violations: string[][] = [];
    const hostDeliveries: Extract<CoopFrameV2, { t: "authorityEntry" }>[] = [];
    const appliedRevisions: number[] = [];
    const installedControls: string[] = [];
    let controlReady = false;
    let receiptsReachHost = false;
    let host!: CoopAuthorityV2Shadow;
    let guest!: CoopAuthorityV2Shadow;

    host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        if (frame.t === "authorityEntry") {
          hostDeliveries.push(frame);
        }
        guest.handleInboundFrame(frame);
      },
      scheduler: createCoopScheduler(clock),
    });
    guest = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        if (receiptsReachHost) {
          host.handleInboundFrame(frame);
        }
      },
      scheduler: createCoopScheduler(clock),
      onProtocolViolation: violation => violations.push([...violation.issues]),
      liveReplica: {
        ownsEntry: entry => entry.kind === "TURN_COMMIT" || entry.kind === "INTERACTION_COMMIT",
        ownsControl: control => control.kind === "AWAIT_SUCCESSOR",
        applyMaterial: (_ctx, entry) => {
          appliedRevisions.push(entry.revision);
          return true;
        },
        projectControl: (_ctx, control) => {
          if (!controlReady) {
            return { kind: "deferred", reason: "hot-rejoin fixture keeps control pending" };
          }
          const controlId = controlIdOf(control);
          installedControls.push(controlId);
          return { kind: "installed", controlId };
        },
      },
    });

    expect(host.tapTurnCommit({ ...turnTap("TURN/hot-rejoin-retained"), nextCommandFrontier: null })).not.toBeNull();
    expect(
      host.tapInteraction({ entry: orderedInteractionEntry(host, 1), legacyDigest: "legacy-hot-rejoin-gap" }),
    ).not.toBeNull();
    expect(hostDeliveries.map(frame => frame.body.revision)).toEqual([1, 2]);
    expect(host.diagnostics().retained).toBe(2);
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, controlLedgerSize: 0 });

    controlReady = true;
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
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, controlLedgerSize: 0 });

    const originalEntry = hostDeliveries.find(frame => frame.body.revision === 1);
    if (originalEntry == null) {
      throw new Error("the hot-rejoin fixture did not retain the predecessor frame");
    }
    const oldGenerationEntry: Extract<CoopFrameV2, { t: "authorityEntry" }> = {
      ...originalEntry,
      ctx: { ...originalEntry.ctx, membershipRevision: 2, connectionGeneration: 0 },
    };
    guest.handleInboundFrame(oldGenerationEntry);
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, controlLedgerSize: 0 });
    expect(violations).toContainEqual(["entry.authority-sender-mismatch"]);

    receiptsReachHost = true;
    expect(host.rebindIdentity(hostRebound)).toBe(2);
    expect(hostDeliveries.slice(2).length).toBeGreaterThanOrEqual(2);
    expect(
      hostDeliveries
        .slice(2)
        .every(frame => frame.ctx.membershipRevision === 2 && frame.ctx.connectionGeneration === 1),
    ).toBe(true);
    expect(appliedRevisions).toEqual([1, 2]);
    expect(installedControls).toHaveLength(2);
    expect(host.diagnostics()).toMatchObject({ retained: 0, pendingTimers: 0 });
    expect(guest.diagnostics()).toMatchObject({
      admitted: 2,
      applied: 2,
      controlLedgerSize: 2,
      shadowStateSize: 2,
    });

    host.dispose();
    guest.dispose();
  });

  it("fails closed at retention capacity without evicting the unresolved frontier", () => {
    const clock = new FakeClock();
    const deliveredRevisions: number[] = [];
    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => {
        if (frame.t === "authorityEntry") {
          deliveredRevisions.push(frame.body.revision);
        }
      },
      scheduler: createCoopScheduler(clock),
    });

    for (let actionOrdinal = 0; actionOrdinal < 512; actionOrdinal++) {
      expect(
        host.tapInteraction({
          entry: orderedInteractionEntry(host, actionOrdinal),
          legacyDigest: `legacy-capacity-${actionOrdinal}`,
        }),
      ).toMatchObject({ revision: actionOrdinal + 1 });
    }
    expect(deliveredRevisions).toEqual(Array.from({ length: 512 }, (_value, index) => index + 1));
    expect(host.diagnostics()).toMatchObject({ committed: 512, retained: 512, pendingTimers: 512 });

    expect(
      host.tapInteraction({ entry: orderedInteractionEntry(host, 512), legacyDigest: "legacy-capacity-overflow" }),
    ).toBeNull();
    expect(deliveredRevisions).toEqual(Array.from({ length: 512 }, (_value, index) => index + 1));
    expect(host.authorityFrontier()?.revision).toBe(512);
    expect(host.diagnostics()).toMatchObject({ committed: 512, retained: 512, pendingTimers: 512, faults: 1 });

    host.dispose();
    expect(clock.pendingCount).toBe(0);
  });

  it("disposes retained replica entries and authority leases without pending timers", () => {
    const clock = new FakeClock();
    let guest!: CoopAuthorityV2Shadow;

    const host = new CoopAuthorityV2Shadow({
      identity: identity(0),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: frame => guest.handleInboundFrame(frame),
      scheduler: createCoopScheduler(clock),
    });
    guest = new CoopAuthorityV2Shadow({
      identity: identity(1),
      scene: STUB_SCENE,
      transport: STUB_TRANSPORT,
      send: () => {},
      scheduler: createCoopScheduler(clock),
      liveReplica: {
        ownsEntry: entry => entry.kind === "TURN_COMMIT" || entry.kind === "INTERACTION_COMMIT",
        ownsControl: control => control.kind === "AWAIT_SUCCESSOR",
        applyMaterial: () => true,
        projectControl: () => ({ kind: "deferred", reason: "leave both revisions pending for disposal" }),
      },
    });

    expect(host.tapTurnCommit({ ...turnTap("TURN/dispose-pending"), nextCommandFrontier: null })).not.toBeNull();
    expect(
      host.tapInteraction({ entry: orderedInteractionEntry(host, 3), legacyDigest: "legacy-dispose-gap" }),
    ).not.toBeNull();
    expect(guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, shadowStateSize: 1, controlLedgerSize: 0 });

    guest.dispose();
    expect(guest.retryPendingReplicaEntries()).toBe(0);
    expect(guest.diagnostics()).toMatchObject({
      disposed: true,
      retained: 0,
      pendingTimers: 0,
      shadowStateSize: 0,
      controlLedgerSize: 0,
    });

    host.dispose();
    expect(host.diagnostics()).toMatchObject({ disposed: true, retained: 0, pendingTimers: 0 });
    expect(clock.pendingCount).toBe(0);
  });
});

describe("authority-v2 correlated boundary-tail proof", () => {
  it("completes the exact candidate on a synchronous loopback without reentrant premature release", () => {
    const duo = makeSynchronousBoundaryDuo();
    const predecessor = duo.host.tapTurnCommit({
      ...turnTap("SYNC/predecessor"),
      nextCommandFrontier: null,
      nextSuccessorWait: narrowBoundaryWait("SYNC/predecessor"),
    });
    expect(predecessor).not.toBeNull();
    const candidate = duo.host.tapWaveAdvance(boundaryWaveTap("SYNC/candidate", 1));
    expect(candidate).not.toBeNull();

    expect(duo.appliedRevisions).toEqual([1, 2]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 2, applied: 2, shadowStateSize: 2 });
    expect(duo.violations).toEqual([]);
    expect(duo.host.diagnostics()).toMatchObject({ retained: 2 });
    duo.dispose();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("orchestrates manifest -> listed source -> matching complete and redrives only the exact candidate", () => {
    const duo = makeManualBoundaryDuo();
    const { candidateFrame, firstRequest } = stageManualBoundaryCandidate(duo);

    // The candidate can arrive again while the observational proof is parked. It remains inert, and the
    // only retry is the same correlated request rather than an ordinary unbounded tail loop.
    duo.guest.handleInboundFrame(candidateFrame);
    const proofRequests = duo.guestToHost.filter(
      (frame): frame is Extract<CoopFrameV2, { t: "tailRequest" }> => frame.t === "tailRequest" && frame.body.requestId != null,
    );
    expect(proofRequests).toHaveLength(2);
    expect(proofRequests[0]?.body).toEqual(firstRequest.body);
    expect(proofRequests[1]?.body).toEqual(firstRequest.body);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, shadowStateSize: 1 });
    expect(duo.appliedRevisions).toEqual([1]);

    const proof = answerManualBoundaryRequest(duo, firstRequest);
    expect(proof.manifest.body.sourceRevisions).toEqual([1]);
    expect(proof.complete.body).toEqual({ ...proof.manifest.body, phase: "complete" });

    duo.guest.handleInboundFrame(proof.manifest);
    expect(duo.appliedRevisions).toEqual([1]);
    duo.guest.handleInboundFrame(proof.source);
    expect(duo.appliedRevisions).toEqual([1]);
    duo.guest.handleInboundFrame(proof.complete);

    // The listed predecessor is evidence only: it never enters the mechanical pipeline a second time. The
    // complete frame is the sole release point for the parked candidate.
    expect(duo.appliedRevisions).toEqual([1, 2]);
    expect(duo.guest.diagnostics()).toMatchObject({
      admitted: 2,
      applied: 2,
      shadowStateSize: 2,
      controlLedgerSize: 2,
    });
    expect(duo.violations).toEqual([]);

    // Let the real receipt path retire both retained leases. Supersession may cause one ordinary candidate
    // redelivery, but it remains a duplicate-complete and cannot re-apply the candidate.
    for (const receipt of duo.guestToHost.filter(frame => frame.t === "authorityReceipt")) {
      duo.host.handleInboundFrame(receipt);
    }
    expect(duo.host.diagnostics()).toMatchObject({ retained: 0, pendingTimers: 0 });
    expect(duo.guest.diagnostics()).toMatchObject({ pendingTimers: 0 });
    expect(duo.clock.pendingCount).toBe(0);
    duo.dispose();
  });

  it("replays the original request byte-exact after a different request and retained-source retirement", () => {
    const duo = makeManualBoundaryDuo();
    const { firstRequest } = stageManualBoundaryCandidate(duo);
    expect(firstRequest.body.requestId).toBe(canonicalBoundaryProofRequestId(1, 1));

    // Deliver, dequeue, and retain the first complete response image.
    const first = answerManualBoundaryRequest(duo, firstRequest);
    const firstBytes = [first.manifest, first.source, first.complete].map(frame => encodeFrameV2(frame));

    // The per-peer sequence is contiguous. An unseen jump and a conflicting reuse of sequence 1 are both
    // inert and cannot overwrite the response retained for the authenticated first request.
    const jumpRequest: Extract<CoopFrameV2, { t: "tailRequest" }> = {
      ...firstRequest,
      body: { ...firstRequest.body, requestId: canonicalBoundaryProofRequestId(1, 3) },
    };
    duo.host.handleInboundFrame(jumpRequest);
    const conflictingReuse: Extract<CoopFrameV2, { t: "tailRequest" }> = {
      ...firstRequest,
      body: {
        ...firstRequest.body,
        candidateOperationId: `${firstRequest.body.candidateOperationId}:conflict`,
      },
    };
    duo.host.handleInboundFrame(conflictingReuse);
    expect(duo.hostToGuest).toEqual([]);

    // A different correlated request is a real authority delivery, not a local cache mutation shortcut.
    const alternateRequest: Extract<CoopFrameV2, { t: "tailRequest" }> = {
      ...firstRequest,
      body: {
        ...firstRequest.body,
        requestId: canonicalBoundaryProofRequestId(1, 2),
      },
    };
    const alternate = answerManualBoundaryRequest(duo, alternateRequest);
    expect(alternate.manifest.body.requestId).toBe(alternateRequest.body.requestId);
    expect(alternate.complete.body.requestId).toBe(alternateRequest.body.requestId);

    // Retire the listed predecessor through production receipts. The original request must still replay
    // its immutable captured source rather than rebuilding from the now-shorter retained frontier.
    expect(deliverManualReceipts(duo, receipt => receipt.body.revision === 1)).toBeGreaterThan(0);
    expect(duo.host.diagnostics()).toMatchObject({ retained: 1 });

    const replay = answerManualBoundaryRequest(duo, firstRequest);
    expect([replay.manifest, replay.source, replay.complete].map(frame => encodeFrameV2(frame))).toEqual(firstBytes);

    // Drain the replay through the real receiver. Leaving these three frames queued would only prove that
    // the sender reconstructed bytes, not that the replay remains a usable correlated proof.
    duo.guest.handleInboundFrame(replay.manifest);
    duo.guest.handleInboundFrame(replay.source);
    duo.guest.handleInboundFrame(replay.complete);
    expect(duo.appliedRevisions).toEqual([1, 2]);
    expect(duo.violations).toEqual([]);
    expect(duo.hostToGuest, "the byte-exact replay was dequeued and fully processed").toEqual([]);

    deliverManualReceipts(duo);
    expect(duo.host.diagnostics()).toMatchObject({ retained: 0, pendingTimers: 0 });
    duo.dispose();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("does not complete the parked candidate after manifest or listed source alone", () => {
    const duo = makeManualBoundaryDuo();
    const { firstRequest } = stageManualBoundaryCandidate(duo);
    const proof = answerManualBoundaryRequest(duo, firstRequest);

    duo.guest.handleInboundFrame(proof.manifest);
    duo.guest.handleInboundFrame(proof.source);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, shadowStateSize: 1 });
    expect(duo.violations).toEqual([]);

    duo.guest.handleInboundFrame(proof.complete);
    expect(duo.appliedRevisions).toEqual([1, 2]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 2, applied: 2 });
    duo.dispose();
  });

  it("rejects a complete frame before its manifest and leaves the candidate parked", () => {
    const duo = makeManualBoundaryDuo();
    const { firstRequest } = stageManualBoundaryCandidate(duo);
    const proof = answerManualBoundaryRequest(duo, firstRequest);

    duo.guest.handleInboundFrame(proof.complete);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1, shadowStateSize: 1 });
    expect(duo.violations).toHaveLength(1);

    // Once the semantic rejection is terminal, the late manifest cannot reopen the old capture.
    duo.guest.handleInboundFrame(proof.manifest);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.violations).toHaveLength(1);
    duo.dispose();
  });

  it("rejects mismatched proof metadata once and ignores the now-stale completion", () => {
    const cases = [
      {
        label: "request",
        mutateManifest: (manifest: Extract<CoopFrameV2, { t: "tailProof" }>) => ({
          ...manifest,
          body: { ...manifest.body, requestId: "wrong-request" },
        }),
      },
      {
        label: "context",
        mutateManifest: (manifest: Extract<CoopFrameV2, { t: "tailProof" }>) => ({
          ...manifest,
          ctx: { ...manifest.ctx, connectionGeneration: manifest.ctx.connectionGeneration + 1 },
        }),
      },
      {
        label: "candidate",
        mutateManifest: (manifest: Extract<CoopFrameV2, { t: "tailProof" }>) => ({
          ...manifest,
          body: { ...manifest.body, candidateOperationId: "wrong-candidate" },
        }),
      },
    ] as const;

    for (const testCase of cases) {
      const duo = makeManualBoundaryDuo();
      const { firstRequest } = stageManualBoundaryCandidate(duo);
      const proof = answerManualBoundaryRequest(duo, firstRequest);
      duo.guest.handleInboundFrame(testCase.mutateManifest(proof.manifest));
      duo.guest.handleInboundFrame(proof.complete);
      expect(duo.appliedRevisions, testCase.label).toEqual([1]);
      expect(duo.violations, testCase.label).toHaveLength(1);

      // The failed request is terminalized once; replaying an old completion after the capture is gone is inert.
      duo.guest.handleInboundFrame(proof.complete);
      expect(duo.violations, testCase.label).toHaveLength(1);
      duo.dispose();
    }
  });

  it("rejects head and manifest-source mismatches as one semantic proof terminal", () => {
    for (const mismatch of ["head", "manifest-sources"] as const) {
      const duo = makeManualBoundaryDuo();
      const { firstRequest } = stageManualBoundaryCandidate(duo);
      const proof = answerManualBoundaryRequest(duo, firstRequest);
      duo.guest.handleInboundFrame(proof.manifest);
      duo.guest.handleInboundFrame(proof.source);
      const complete =
        mismatch === "head"
          ? {
              ...proof.complete,
              body: { ...proof.complete.body, headRevision: proof.complete.body.headRevision + 1 },
            }
          : {
              ...proof.complete,
              body: { ...proof.complete.body, sourceRevisions: [] },
            };
      duo.guest.handleInboundFrame(complete);
      expect(duo.appliedRevisions, mismatch).toEqual([1]);
      expect(duo.violations, mismatch).toHaveLength(1);
      duo.guest.handleInboundFrame(proof.complete);
      expect(duo.violations, mismatch).toHaveLength(1);
      duo.dispose();
    }
  });

  it("does not augment an omitted predecessor/subsumes source from local state", () => {
    const duo = makeManualBoundaryDuo();
    const { firstRequest } = stageManualBoundaryCandidate(duo);
    const proof = answerManualBoundaryRequest(duo, firstRequest);
    const omittedManifest = {
      ...proof.manifest,
      body: { ...proof.manifest.body, sourceRevisions: [] },
    };
    const omittedComplete = {
      ...proof.complete,
      body: { ...proof.complete.body, sourceRevisions: [] },
    };

    duo.guest.handleInboundFrame(omittedManifest);
    duo.guest.handleInboundFrame(omittedComplete);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1 });
    expect(duo.violations).toHaveLength(1);
    duo.dispose();
  });

  it("rejects a complete proof whose listed authorityEntry source was dropped", async () => {
    const duo = makeFaultBoundaryDuo({ drop: 0, reorder: 0, delay: 0 });
    const predecessor = duo.host.tapTurnCommit({
      ...turnTap("SOURCE-DROP/predecessor"),
      nextCommandFrontier: null,
      nextSuccessorWait: narrowBoundaryWait("SOURCE-DROP/predecessor"),
    });
    expect(predecessor).not.toBeNull();
    await flushLoopbackMicrotasks();
    const candidate = duo.host.tapWaveAdvance(boundaryWaveTap("SOURCE-DROP/candidate", 1));
    expect(candidate).not.toBeNull();
    // Candidate delivery queues its tail request one microtask later. Arm after the candidate crossed the
    // wire so the one-shot targets the manifest-listed source authorityEntry, not the candidate itself.
    await Promise.resolve();
    duo.pair.armNextDrop("authorityEntry", "host");
    await flushLoopbackMicrotasks(24);

    expect(duo.pair.counters.host.oneShotDropped).toBe(1);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 1, applied: 1 });
    expect(duo.violations).toHaveLength(1);
    expect(duo.violations[0]?.join(" ")).toContain("source snapshot incomplete");
    duo.dispose();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("accepts an identical duplicate of a manifest-listed authorityEntry source", async () => {
    const duo = makeFaultBoundaryDuo({ drop: 0, reorder: 0, delay: 0 });
    const predecessor = duo.host.tapTurnCommit({
      ...turnTap("SOURCE-DUP/predecessor"),
      nextCommandFrontier: null,
      nextSuccessorWait: narrowBoundaryWait("SOURCE-DUP/predecessor"),
    });
    expect(predecessor).not.toBeNull();
    await flushLoopbackMicrotasks();
    const candidate = duo.host.tapWaveAdvance(boundaryWaveTap("SOURCE-DUP/candidate", 1));
    expect(candidate).not.toBeNull();
    await Promise.resolve();
    duo.pair.armNextDuplicate("authorityEntry", "host");
    await flushLoopbackMicrotasks(24);

    expect(duo.pair.counters.host.oneShotDuplicated).toBe(1);
    expect(duo.appliedRevisions).toEqual([1, 2]);
    expect(duo.violations).toEqual([]);
    duo.dispose();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("rejects an altered duplicate of a manifest-listed authorityEntry source", () => {
    const duo = makeManualBoundaryDuo();
    const { firstRequest } = stageManualBoundaryCandidate(duo);
    const proof = answerManualBoundaryRequest(duo, firstRequest);
    const conflictingSource: Extract<CoopFrameV2, { t: "authorityEntry" }> = {
      ...proof.source,
      body: {
        ...proof.source.body,
        material: {
          ...proof.source.body.material,
          digest: `${proof.source.body.material.digest}:conflict`,
        },
      },
    };
    duo.guest.handleInboundFrame(proof.manifest);
    duo.guest.handleInboundFrame(proof.source);
    duo.guest.handleInboundFrame(conflictingSource);
    duo.guest.handleInboundFrame(proof.complete);

    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.violations).toHaveLength(1);
    expect(duo.violations[0]?.join(" ")).toContain(String(firstRequest.body.requestId));
    duo.dispose();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("rejects an unlisted authorityEntry source even when its kind is not locally owned", () => {
    const duo = makeManualBoundaryDuo();
    const { firstRequest } = stageManualBoundaryCandidate(duo);
    const proof = answerManualBoundaryRequest(duo, firstRequest);
    duo.guest.handleInboundFrame(proof.manifest);
    const unownedSource: Extract<CoopFrameV2, { t: "authorityEntry" }> = {
      ...proof.source,
      body: {
        ...proof.source.body,
        revision: 3,
        operationId: "BOUNDARY/unowned-source",
        kind: "CONTROL_COMMIT",
        material: { digest: "unowned-source-digest", payload: { wave: 5, turn: 1, source: "not-listed" } },
        nextControl: narrowBoundaryWait("BOUNDARY/unowned-source"),
        subsumes: [],
      },
    };

    duo.guest.handleInboundFrame(unownedSource);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.violations).toHaveLength(1);
    expect(JSON.stringify(duo.violations[0])).toContain(String(firstRequest.body.requestId));
    duo.dispose();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("rejects a manifest-listed authorityEntry source reordered behind completion", async () => {
    const duo = makeFaultBoundaryDuo({ drop: 0, reorder: 0, delay: 0 });
    const predecessor = duo.host.tapTurnCommit({
      ...turnTap("SOURCE-REORDER/predecessor"),
      nextCommandFrontier: null,
      nextSuccessorWait: narrowBoundaryWait("SOURCE-REORDER/predecessor"),
    });
    expect(predecessor).not.toBeNull();
    await flushLoopbackMicrotasks();
    const candidate = duo.host.tapWaveAdvance(boundaryWaveTap("SOURCE-REORDER/candidate", 1));
    expect(candidate).not.toBeNull();
    await Promise.resolve();
    duo.pair.setProfile({
      drop: 0,
      reorder: 1,
      delay: 0,
      faultable: faultableTypes(["authorityEntry"]),
    });
    await flushLoopbackMicrotasks(24);

    expect(duo.pair.counters.host.reordered).toBe(1);
    expect(duo.pair.counters.host.released).toBe(1);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.violations).toHaveLength(1);
    expect(duo.violations[0]?.join(" ")).toContain("source snapshot incomplete");
    duo.dispose();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("publishes one real shared terminal for duplicated unowned proof-source rejection", async () => {
    const priorTurnFlag = process.env.COOP_AUTHORITY_V2_TURN;
    const replacementOperationId = "BOUNDARY/runtime-predecessor";
    let runtimeApi: typeof import("#data/elite-redux/coop/coop-runtime") | null = null;
    let runtime: CoopRuntime | null = null;
    let authorityController: CoopSessionController | null = null;
    let runtimeCleared = false;

    const authorityAccount: CoopAccountIdentityV1 = {
      version: 1,
      accountId: "er-account:10",
      displayName: "Authority",
      canonicalUsername: "authority",
    };
    const replicaAccount: CoopAccountIdentityV1 = {
      version: 1,
      accountId: "er-account:20",
      displayName: "Replica",
      canonicalUsername: "replica",
    };
    const authorityP33 = createFreshCoopP33Context({
      pairingId: "M3TAILPROOFTERM",
      pairingBearer: "A".repeat(43),
      transportRole: "answerer",
      account: authorityAccount,
      peerAccount: replicaAccount,
      connectionGeneration: 4,
      peerConnectionGeneration: 7,
    });
    const replicaP33 = createFreshCoopP33Context({
      pairingId: "M3TAILPROOFTERM",
      pairingBearer: "B".repeat(43),
      transportRole: "offerer",
      account: replicaAccount,
      peerAccount: authorityAccount,
      connectionGeneration: 7,
      peerConnectionGeneration: 4,
    });
    expect(authorityP33).not.toBeNull();
    expect(replicaP33).not.toBeNull();
    if (authorityP33 == null || replicaP33 == null) {
      throw new Error("P33 proof-terminal fixture was rejected");
    }

    const pair = createLoopbackPair();
    const authorityMessages: CoopMessage[] = [];
    const authorityFrames: CoopFrameV2[] = [];
    const offMessages = pair.host.onMessage(message => authorityMessages.push(message));
    const offFrames = pair.host.onV2Frame?.(frame => {
      if (frame != null && typeof frame === "object" && (frame as { v?: unknown }).v === 2) {
        authorityFrames.push(structuredClone(frame) as CoopFrameV2);
      }
    }) ?? (() => {});

    try {
      process.env.COOP_AUTHORITY_V2_TURN = "on";
      // Dynamic import is intentional: the cutover build flag is sampled at module initialization. The
      // negotiated peer advertises only shadow+turn, so REPLACEMENT/WAVE/CONTROL remain unowned while the
      // production runtime still installs its live protocol-violation -> shared-terminal callback.
      runtimeApi = await import("#data/elite-redux/coop/coop-runtime");
      runtime = runtimeApi.assembleCoopRuntime(pair.guest, {
        username: "Replica",
        netcodeMode: "authoritative",
        p33: replicaP33,
      });
      runtimeApi.setCoopRuntime(runtime);
      authorityController = new CoopSessionController(pair.host, {
        version: COOP_PROTOCOL_VERSION,
        p33: authorityP33,
        localCapabilities: [
          COOP_CAP_OP_BIOME,
          COOP_CAP_OP_ME,
          COOP_CAP_DURABILITY_JOURNAL,
          COOP_CAP_AUTHORITY_V2_SHADOW,
          COOP_CAP_AUTHORITY_V2_TURN,
        ],
      });
      runtime.controller.armResumeStartNewHandler(() => {});
      authorityController.connect();
      runtime.controller.connect();
      await expect(authorityController.sendResumeStartNew(2_000)).resolves.toBe(true);

      let runtimeShadow: CoopAuthorityV2Shadow | null = null;
      for (let attempt = 0; attempt < 50; attempt++) {
        runtimeShadow = runtimeApi.getCoopV2Shadow(runtime);
        if (runtime.controller.authenticatedBinding != null && runtimeShadow != null) {
          break;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      const binding = runtime.controller.authenticatedBinding;
      expect(binding).not.toBeNull();
      expect(runtimeShadow).not.toBeNull();
      if (binding == null || runtimeShadow == null || binding.runId == null) {
        throw new Error("bound replica runtime did not install its Authority V2 shadow");
      }
      const membership = runtime.controller.p33MembershipSnapshot();
      const authorityMember = membership?.members.find(member => member.seatId === binding.authoritySeatId);
      expect(authorityMember).toBeDefined();
      if (authorityMember == null) {
        throw new Error("bound replica runtime omitted the authority member");
      }
      const authorityContext: CoopFrameContextV2 = {
        sessionId: binding.sessionId,
        runId: binding.runId,
        sessionEpoch: binding.sessionEpoch,
        seatMapId: binding.seatMap.seatMapId,
        membershipRevision: binding.membershipRevision,
        senderSeatId: binding.authoritySeatId,
        authoritySeatId: binding.authoritySeatId,
        connectionGeneration: authorityMember.connectionGeneration,
      };
      const replacementDraft = buildReplacementCommitEntry({
        context: authorityContext,
        proposal: {
          sourceAddress: {
            epoch: binding.sessionEpoch,
            wave: 5,
            turn: 1,
            occurrence: 0,
            fieldIndex: 0,
          },
          ownerSeatId: binding.authoritySeatId,
          selected: { partySlot: 2, speciesId: 25 },
        },
        resolution: "owner-pick",
        successor: {
          kind: "next-replacement",
          control: {
            kind: "REPLACEMENT",
            operationId: "BOUNDARY/runtime-next-replacement",
            ownerSeatId: replicaP33.localSeatId,
            epoch: binding.sessionEpoch,
            wave: 5,
            turn: 1,
            occurrence: 1,
            fieldIndex: 0,
            remaining: [],
          },
        },
        operationId: replacementOperationId,
      });
      const predecessor: Extract<CoopFrameV2, { t: "authorityEntry" }> = {
        v: 2,
        t: "authorityEntry",
        ctx: authorityContext,
        body: {
          revision: 1,
          operationId: replacementDraft.operationId,
          kind: replacementDraft.kind,
          material: replacementDraft.material,
          nextControl: replacementDraft.nextControl,
          subsumes: [...replacementDraft.subsumes],
        },
      };
      const candidateOperationId = "BOUNDARY/runtime-candidate";
      const candidateDraft = buildWaveAdvanceEntry({
        context: authorityContext,
        operationId: candidateOperationId,
        transition: {
          kind: "wave-advance",
          wave: 5,
          turn: 1,
          outcome: "win",
          nextWave: 6,
          biomeChange: false,
          eggLapse: false,
          meBoundary: "none",
          victoryKind: "wild",
        },
        destination: {
          ...narrowBoundaryWait(candidateOperationId),
          epoch: binding.sessionEpoch,
        },
        subsumes: [predecessor.body.revision],
      });
      const candidate: Extract<CoopFrameV2, { t: "authorityEntry" }> = {
        v: 2,
        t: "authorityEntry",
        ctx: authorityContext,
        body: {
          revision: 2,
          operationId: candidateDraft.operationId,
          kind: candidateDraft.kind,
          material: candidateDraft.material,
          nextControl: candidateDraft.nextControl,
          subsumes: [...candidateDraft.subsumes],
        },
      };

      pair.host.send(predecessor);
      pair.host.send(candidate);
      await flushLoopbackMicrotasks(24);
      const request = authorityFrames.find(
        (frame): frame is Extract<CoopFrameV2, { t: "tailRequest" }> => frame.t === "tailRequest",
      );
      expect(request).toBeDefined();
      if (request == null || request.body.requestId == null) {
        throw new Error("bound replica did not emit a correlated tail request");
      }
      expect(request.body.requestId).toBe(
        canonicalBoundaryProofRequestId(replicaP33.localSeatId, 1, binding.sessionId),
      );

      const manifest: Extract<CoopFrameV2, { t: "tailProof" }> = {
        v: 2,
        t: "tailProof",
        ctx: authorityContext,
        body: {
          phase: "manifest",
          requestId: request.body.requestId,
          fromRevision: request.body.fromRevision,
          candidateRevision: request.body.candidateRevision,
          candidateOperationId: request.body.candidateOperationId,
          headRevision: candidate.body.revision,
          sourceRevisions: [predecessor.body.revision],
        },
      };
      const unlistedSource: Extract<CoopFrameV2, { t: "authorityEntry" }> = {
        ...predecessor,
        body: {
          ...predecessor.body,
          revision: candidate.body.revision + 1,
          operationId: "BOUNDARY/runtime-unowned-source",
          kind: "CONTROL_COMMIT",
          material: { digest: "runtime-unowned-source", payload: { wave: 5, turn: 1, source: "unlisted" } },
          nextControl: {
            ...narrowBoundaryWait("BOUNDARY/runtime-unowned-source"),
            epoch: binding.sessionEpoch,
          },
          subsumes: [],
        },
      };
      const supervisor = runtimeApi.getCoopSharedTerminalSupervisor(runtime);
      expect(supervisor).not.toBeNull();
      if (supervisor == null) {
        throw new Error("bound runtime omitted its shared-terminal supervisor");
      }
      const beginSpy = vi.spyOn(supervisor, "begin");

      pair.host.send(manifest);
      pair.host.send(unlistedSource);
      pair.host.send(cloneFrame(unlistedSource));
      await flushLoopbackMicrotasks(24);

      expect(beginSpy).toHaveBeenCalledTimes(1);
      expect(runtimeApi.isCoopSharedTerminalFrozen(runtime)).toBe(true);
      expect(runtimeShadow.diagnostics()).toMatchObject({ admitted: 1, applied: 1 });
      const published = supervisor.current();
      expect(published).toMatchObject({
        terminalRevision: 1,
        originSeatId: replicaP33.localSeatId,
        boundary: "protocol",
        reasonCode: "invalid-authority",
      });
      expect(published?.reason).toContain(request.body.requestId);
      const terminalWire = authorityMessages.filter(
        (message): message is Extract<CoopMessage, { t: "sharedTerminal" }> => message.t === "sharedTerminal",
      );
      expect(terminalWire).toHaveLength(1);
      expect(terminalWire[0]).toMatchObject({
        ctx: { fromSeatId: replicaP33.localSeatId },
        commit: published,
      });

      runtimeApi.clearCoopRuntime();
      runtimeCleared = true;
      expect(runtimeApi.getCoopSharedTerminalSupervisor(runtime)).toBeNull();
    } finally {
      offFrames();
      offMessages();
      authorityController?.dispose();
      if (!runtimeCleared) {
        runtimeApi?.clearCoopRuntime();
      }
      pair.host.close();
      pair.guest.close();
      if (priorTurnFlag == null) {
        delete process.env.COOP_AUTHORITY_V2_TURN;
      } else {
        process.env.COOP_AUTHORITY_V2_TURN = priorTurnFlag;
      }
    }
  });

  it("ignores old proof frames after an authenticated rebind while a fresh request/context releases the candidate", () => {
    const oldWire = new InjectableWire();
    const replacementWire = new InjectableWire();
    const guestTransport = new WebRtcTransport("guest", oldWire, 0);
    const duo = makeManualBoundaryDuo(guestTransport);
    const { firstRequest } = stageManualBoundaryCandidate(duo);
    expect(firstRequest.body.requestId).toBe(canonicalBoundaryProofRequestId(1, 1));
    const oldProof = answerManualBoundaryRequest(duo, firstRequest);

    // Replace the authenticated receive carrier first. The old wire deliberately retains its callback so
    // late network delivery exercises WebRtcTransport's production generation fence, not a detached fake.
    guestTransport.replaceChannel(replacementWire);
    expect(oldWire.readyState).toBe("closed");
    const hostRebound: CoopV2ShadowIdentity = {
      ...identity(0),
      membershipRevision: 2,
      connectionGeneration: 1,
      peerBindings: [{ seatId: 1, connectionGeneration: 1 }],
    };
    const guestRebound: CoopV2ShadowIdentity = {
      ...identity(1),
      membershipRevision: 2,
      connectionGeneration: 1,
      peerBindings: [{ seatId: 0, connectionGeneration: 1 }],
    };
    expect(duo.host.rebindIdentity(hostRebound)).toBe(2);
    const reboundEntries = duo.hostToGuest.splice(0);
    expect(reboundEntries.map(frame => (frame.t === "authorityEntry" ? frame.body.revision : -1))).toEqual([1, 2]);
    expect(
      reboundEntries.every(frame => frame.t === "authorityEntry" && frame.ctx.connectionGeneration === 1),
    ).toBe(true);
    expect(duo.guest.rebindIdentity(guestRebound)).toBe(0);

    const freshRequest = takeFrame(
      duo.guestToHost,
      "fresh rebound tailRequest",
      frame =>
        frame.t === "tailRequest"
        && frame.body.requestId != null
        && frame.ctx.membershipRevision === 2
        && frame.ctx.connectionGeneration === 1,
    ) as Extract<CoopFrameV2, { t: "tailRequest" }>;
    expect(freshRequest.ctx).toMatchObject({ membershipRevision: 2, connectionGeneration: 1 });
    expect(freshRequest.body.candidateRevision).toBe(firstRequest.body.candidateRevision);
    // Rebind resets both request generator and responder high-water to sequence 1. Identity is disambiguated
    // by the authenticated membership/generation axes, never by leaking a custom AuthorityLog ownerId.
    expect(freshRequest.body.requestId).toBe(canonicalBoundaryProofRequestId(1, 1));
    expect(freshRequest.body.requestId).toBe(firstRequest.body.requestId);
    const freshProof = answerManualBoundaryRequest(duo, freshRequest);
    expect(freshProof.manifest.ctx).toMatchObject({ membershipRevision: 2, connectionGeneration: 1 });
    expect(freshProof.complete.body).toEqual({ ...freshProof.manifest.body, phase: "complete" });

    // A fresh capture is active now. Inject every old-context proof frame through the superseded receive
    // endpoint before completion; none may abort, complete, advance, or consume that fresh capture.
    const beforeOldDelivery = duo.guest.diagnostics();
    oldWire.inject(oldProof.manifest);
    oldWire.inject(oldProof.source);
    oldWire.inject(oldProof.complete);
    expect(duo.guest.diagnostics()).toEqual(beforeOldDelivery);
    expect(duo.appliedRevisions).toEqual([1]);
    expect(duo.violations).toEqual([]);

    // Only replacement-endpoint frames under the rebound context can release the exact parked candidate.
    replacementWire.inject(freshProof.manifest);
    replacementWire.inject(freshProof.source);
    replacementWire.inject(freshProof.complete);
    expect(duo.appliedRevisions).toEqual([1, 2]);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 2, applied: 2 });

    // The host's rebind replay is fresh channel evidence, not a second proof source. Delivering those exact
    // authority images settles their receipts without re-applying either revision.
    for (const reboundEntry of reboundEntries) {
      replacementWire.inject(reboundEntry);
    }
    deliverManualReceipts(duo, receipt => receipt.ctx.connectionGeneration === 1);
    expect(duo.host.diagnostics()).toMatchObject({ retained: 0, pendingTimers: 0 });
    duo.dispose();
    guestTransport.close();
    expect(duo.clock.pendingCount).toBe(0);
  });

  it("keeps dropped/reordered proof frames fail-closed and accepts an exact duplicated manifest", async () => {
    const cases = [
      {
        label: "dropped",
        profile: { drop: 0, reorder: 0, delay: 0, faultable: faultableTypes(["tailProof"]) },
        arm: (pair: CoopFaultPair) => pair.armNextDrop("tailProof", "host"),
        expectApplied: [1],
      },
      {
        label: "reordered",
        profile: { drop: 0, reorder: 1, delay: 0, faultable: faultableTypes(["tailProof"]) },
        arm: (_pair: CoopFaultPair) => {},
        expectApplied: [1],
      },
      {
        label: "duplicated",
        profile: { drop: 0, reorder: 0, delay: 0, faultable: faultableTypes(["tailProof"]) },
        arm: (pair: CoopFaultPair) => pair.armNextDuplicate("tailProof", "host"),
        expectApplied: [1, 2],
      },
    ] as const;

    for (const testCase of cases) {
      const duo = makeFaultBoundaryDuo(testCase.profile);
      testCase.arm(duo.pair);
      const predecessor = duo.host.tapTurnCommit({
        ...turnTap(`FAULT/${testCase.label}/predecessor`),
        nextCommandFrontier: null,
        nextSuccessorWait: narrowBoundaryWait(`FAULT/${testCase.label}/predecessor`),
      });
      expect(predecessor, testCase.label).not.toBeNull();
      await flushLoopbackMicrotasks();
      const candidate = duo.host.tapWaveAdvance(boundaryWaveTap(`FAULT/${testCase.label}/candidate`, 1));
      expect(candidate, testCase.label).not.toBeNull();
      await flushLoopbackMicrotasks(24);

      expect(duo.appliedRevisions, testCase.label).toEqual(testCase.expectApplied);
      expect(duo.pair.faultsInjected(), testCase.label).toBeGreaterThan(0);
      if (testCase.label === "duplicated") {
        expect(duo.pair.counters.host.oneShotDuplicated).toBe(1);
        expect(duo.violations).toEqual([]);
      } else {
        expect(duo.violations, testCase.label).toHaveLength(1);
        expect(duo.guest.diagnostics(), testCase.label).toMatchObject({ applied: 1 });
      }

      duo.dispose();
      expect(duo.clock.pendingCount, testCase.label).toBe(0);
      expect(duo.host.diagnostics(), testCase.label).toMatchObject({ retained: 0, pendingTimers: 0 });
    }
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
    const hosts = Array.from(
      { length: 3 },
      () =>
        new CoopAuthorityV2Shadow({
          identity: identity(0),
          scene: STUB_SCENE,
          transport: STUB_TRANSPORT,
          send: () => {},
          scheduler: createCoopScheduler(clock),
        }),
    );
    // No active harness -> the thin taps are pure no-ops (never throw).
    expect(() => tapCoopV2ShadowTurnCommit(turnTap("THIN/no-active"))).not.toThrow();
    expect(hosts.every(host => host.diagnostics().committed === 0)).toBe(true);

    setActiveCoopV2Shadow(hosts[0]);
    tapCoopV2ShadowTurnCommit(turnTap("THIN/turn"));
    clearActiveCoopV2Shadow(hosts[0]);
    setActiveCoopV2Shadow(hosts[1]);
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
    clearActiveCoopV2Shadow(hosts[1]);
    setActiveCoopV2Shadow(hosts[2]);
    const rewardAddress = { epoch: SESSION.epoch, wave: 5, ownerSeatId: 0, actionOrdinal: 1 } as const;
    tapCoopV2ShadowInteraction({
      entry: buildRewardInteractionEntry({
        context: hosts[2].authenticatedFrameContext,
        address: rewardAddress,
        material: { kind: "reward", wave: 5, ownerSeatId: 0, choice: { kind: "skip" }, terminal: true },
        successor: awaitSuccessor(rewardOperationId(rewardAddress), 5, 1, true),
      }),
      legacyDigest: "legacy",
    });
    expect(hosts.every(host => host.diagnostics().committed === 1)).toBe(true);

    clearActiveCoopV2Shadow(hosts[2]);
    for (const host of hosts) {
      host.dispose();
    }
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
    const matchingDuo = buildDuo(new FakeClock());
    // Identical legacy image -> match=true.
    matchingDuo.host.tapReplacementCommit({
      proposal: replacementProposal(25),
      resolution: "owner-pick",
      successor: { kind: "terminal" },
      legacyDigest: "op-id",
      legacyImage: { proposal: replacementProposal(25), resolution: "owner-pick" },
    });
    const divergentDuo = buildDuo(new FakeClock());
    // A legacy image resolving a DIFFERENT species -> the resolved states differ -> match=false.
    divergentDuo.host.tapReplacementCommit({
      proposal: replacementProposal(25),
      resolution: "owner-pick",
      successor: { kind: "terminal" },
      operationId: "RC/divergent",
      legacyDigest: "op-id",
      legacyImage: { proposal: replacementProposal(999), resolution: "owner-pick" },
    });
    const diagnostics = [matchingDuo.host.diagnostics(), divergentDuo.host.diagnostics()];
    expect(diagnostics.reduce((sum, diag) => sum + diag.parityChecks, 0)).toBe(2);
    expect(diagnostics.reduce((sum, diag) => sum + diag.parityMatches, 0)).toBe(1);
    expect(diagnostics.every(diag => diag.faults === 0)).toBe(true);
    expect(parityLine("REPLACEMENT_COMMIT")).toContain("match=false");
    expect(parityLine("REPLACEMENT_COMMIT")).toContain("field=digest");
    matchingDuo.dispose();
    divergentDuo.dispose();
  });

  it("WAVE parity match=true/false by fingerprinting the legacy transition image", () => {
    const matchingDuo = buildDuo(new FakeClock());
    matchingDuo.host.tapWaveAdvance({
      operationId: "WAVE/true",
      transition: waveTransition(6),
      destination: awaitSuccessor("WAVE/true", 5, 1, true),
      legacyDigest: "legacy-wave-token",
      legacyImage: waveTransition(6),
    });
    const divergentDuo = buildDuo(new FakeClock());
    divergentDuo.host.tapWaveAdvance({
      operationId: "WAVE/false",
      transition: waveTransition(6),
      destination: awaitSuccessor("WAVE/false", 5, 1, true),
      legacyDigest: "legacy-wave-token",
      legacyImage: waveTransition(7), // a divergent nextWave -> states differ
    });
    const diagnostics = [matchingDuo.host.diagnostics(), divergentDuo.host.diagnostics()];
    expect(diagnostics.reduce((sum, diag) => sum + diag.parityMatches, 0)).toBe(1);
    expect(diagnostics.every(diag => diag.faults === 0)).toBe(true);
    expect(parityLine("WAVE_ADVANCE")).toContain("match=false");
    expect(parityLine("WAVE_ADVANCE")).toContain("field=materialDigest");
    matchingDuo.dispose();
    divergentDuo.dispose();
  });

  it("TERMINAL parity match=true/false by fingerprinting the legacy terminal image", () => {
    const matchingDuo = buildDuo(new FakeClock());
    matchingDuo.host.tapTerminal({
      operationId: "TERM/true",
      terminal: terminalMaterial("game-over"),
      legacyDigest: "legacy-term-token",
      legacyImage: terminalMaterial("game-over"),
    });
    const divergentDuo = buildDuo(new FakeClock());
    divergentDuo.host.tapTerminal({
      operationId: "TERM/false",
      terminal: terminalMaterial("game-over"),
      legacyDigest: "legacy-term-token",
      legacyImage: terminalMaterial("final-flee"), // a divergent reason -> states differ
    });
    const diagnostics = [matchingDuo.host.diagnostics(), divergentDuo.host.diagnostics()];
    expect(diagnostics.reduce((sum, diag) => sum + diag.parityMatches, 0)).toBe(1);
    expect(diagnostics.every(diag => diag.faults === 0)).toBe(true);
    expect(parityLine("TERMINAL_COMMIT")).toContain("match=false");
    matchingDuo.dispose();
    divergentDuo.dispose();
  });

  it("INTERACTION (pre-built) parity match=true/false by fingerprinting the legacy interaction image", () => {
    const matchingDuo = buildDuo(new FakeClock());
    const divergentDuo = buildDuo(new FakeClock());
    const reward = (duo: ReturnType<typeof buildDuo>, choice: { kind: "leave" } | { kind: "skip" }) => {
      const actionOrdinal = 0;
      const rewardAddress = { epoch: SESSION.epoch, wave: 6, ownerSeatId: 0, actionOrdinal } as const;
      return buildRewardInteractionEntry({
        context: duo.host.authenticatedFrameContext,
        address: rewardAddress,
        material: { kind: "reward", wave: 6, ownerSeatId: 0, choice, terminal: true },
        successor: awaitSuccessor(rewardOperationId(rewardAddress), 6, 1, true),
      });
    };
    // Identical legacy image -> match=true.
    matchingDuo.host.tapInteraction({
      entry: reward(matchingDuo, { kind: "leave" }),
      legacyDigest: "tok",
      legacyImage: reward(matchingDuo, { kind: "leave" }),
    });
    // A separate mechanical log with a DIFFERENT legacy choice -> states differ -> match=false.
    divergentDuo.host.tapInteraction({
      entry: reward(divergentDuo, { kind: "leave" }),
      legacyDigest: "tok",
      legacyImage: reward(divergentDuo, { kind: "skip" }),
    });
    const diagnostics = [matchingDuo.host.diagnostics(), divergentDuo.host.diagnostics()];
    expect(diagnostics.reduce((sum, diag) => sum + diag.parityChecks, 0)).toBe(2);
    expect(diagnostics.reduce((sum, diag) => sum + diag.parityMatches, 0)).toBe(1);
    expect(diagnostics.every(diag => diag.faults === 0)).toBe(true);
    expect(parityLine("INTERACTION_COMMIT")).toContain("match=false");
    matchingDuo.dispose();
    divergentDuo.dispose();
  });

  // ------------------------------------------------------------------------
  // Deliverable 3 - per-surface interaction routing (relay-primitive tap).
  // ------------------------------------------------------------------------

  it("routes each relay interaction kind to its MATCHING adapter builder (fault-free)", () => {
    const check = (
      kind: string,
      choice: number,
      data: number[] | undefined,
      inspect: (entry: CoopAuthorityEntry) => void,
    ): void => {
      const duo = buildDuo(new FakeClock());
      const entry = duo.host.tapInteractionChoice({
        seq: 1,
        kind,
        choice,
        ownerSeatId: 0,
        wave: 5,
        ...(data == null ? {} : { data }),
      });
      expect(entry, `${kind} produced one independently valid shadow entry`).not.toBeNull();
      if (entry != null) {
        inspect(entry);
      }
      expect(duo.host.diagnostics().faults).toBe(0);
      duo.dispose();
    };

    // interactions-reward: BIOME pick + crossroads.
    check("biomePick", 0, [3], entry =>
      expect(decodeBiomeInteractionMaterial(entry)?.selection.kind).toBe("biome-pick"),
    );
    check("crossroads", 1, undefined, entry =>
      expect(decodeBiomeInteractionMaterial(entry)?.selection.kind).toBe("crossroads-pick"),
    );

    // interactions-reward: MARKET (the biome shop).
    check("biomeShop", 0, [1, 200], entry => expect(decodeMarketInteractionMaterial(entry)?.kind).toBe("market"));

    // interactions-learn: ability / colosseum / stormglass / learn-move.
    check("abilityPicker", -3, [1, 2, 3], entry =>
      expect(learnDecodeInteractionMaterial(entry)?.surface).toBe("ability-pick"),
    );
    check("coloPick", 0, [4], entry =>
      expect(learnDecodeInteractionMaterial(entry)?.surface).toBe("colosseum/decision"),
    );
    check("stormglass", 2, undefined, entry =>
      expect(learnDecodeInteractionMaterial(entry)?.surface).toBe("stormglass"),
    );
    check("learnMove", 1, undefined, entry =>
      expect(learnDecodeInteractionMaterial(entry)?.surface).toBe("learn-move/decision"),
    );

    // interactions-mystery: ME option-pick, ME terminal (a LEAVE sentinel), catch-full.
    check("me", 0, [0], entry => expect(mysteryDecodeInteractionMaterial(entry)?.kind).toBe("me-option-pick"));
    check("meBtn", -1, undefined, entry => expect(mysteryDecodeInteractionMaterial(entry)?.kind).toBe("me-terminal"));
    check("catchFull", 2, undefined, entry => expect(mysteryDecodeInteractionMaterial(entry)?.kind).toBe("catch-full"));

    // an UNKNOWN kind keeps the generic reward path with the kind recorded in the parity line.
    check("quizAns", 0, undefined, entry => {
      expect(decodeRewardInteractionMaterial(entry)?.kind).toBe("reward");
      expect(parityLine("INTERACTION_COMMIT")).toContain("surface=reward/generic(quizAns)");
    });
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

  it("keeps mechanically unowned kinds in shadow without refusing an authority-local reservation", () => {
    const clock = new FakeClock();
    const liveReplica: CoopV2LiveReplicaSeams = {
      ownsEntry: entry => entry.kind === "INTERACTION_COMMIT",
      ownsControl: control => control.kind === "SHARED_INTERACTION",
      prepareAuthorityEntry: () => null,
      authorityEntryCommitted: () => {
        throw new Error("an unowned entry must not enter the live authority projector");
      },
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

    expect(harness.tapTurnCommit(turnTap("TURN/unowned-live-kind"))?.kind).toBe("TURN_COMMIT");
    expect(harness.diagnostics()).toMatchObject({ committed: 1, retained: 1, faults: 0 });
    harness.dispose();
  });
});
