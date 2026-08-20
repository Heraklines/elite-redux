/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 2 node-pure tests (authority-v2-log).
//
// The authority log's import graph is engine/DOM-free (TYPE-only contract
// import), so it runs in the node-pure project in milliseconds. These pin the
// contract's load-bearing invariants:
//   - commit -> deliver -> apply -> retire happy path (retirement rule).
//   - admission never claims material application; failed material and deferred
//     control are retried at their exact unfinished stage.
//   - a mechanically-complete duplicate never re-applies (no double-mutate).
//   - a gap requests the tail (no local retry loop).
//   - a stale epoch is rejected (staleEpoch), membership/session mismatch too.
//   - supersession retires subsumed entries AND cancels their timers.
//   - presentationSettled is NEVER required for retirement.
//   - dispose leaves ZERO timers/leases (no orphans).
// =============================================================================

import {
  buildTerminalCommitEntry,
  buildWaveAdvanceEntry,
  type CoopWaveTransitionMaterialV2,
} from "#data/elite-redux/coop/authority-v2/adapters/wave-terminal";
import {
  type AuthorityDeliveryExhaustion,
  AuthorityLog,
  type AuthorityLogOptions,
  AuthorityRetentionOverflowError,
  authorityEntryProofScopeOf,
  type CoopAuthorityWire,
} from "#data/elite-redux/coop/authority-v2/authority-log";
import type {
  CoopAuthorityEntry,
  CoopAuthorityReceipt,
  CoopFrameContextV2,
  CoopNextControl,
  CoopScheduler,
  CoopTimeClass,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import {
  COOP_FRAME_PROTOCOL_VERSION,
  type CoopFrameV2,
  type CoopTailProofBodyV2,
  type CoopTailRequestBodyV2,
} from "#data/elite-redux/coop/authority-v2/frame-codec";
import { CoopV2InteractionControlLedger } from "#data/elite-redux/coop/authority-v2/interaction-control-ledger";
import { controlIdOf } from "#data/elite-redux/coop/authority-v2/next-control";
import { validateInboundFrame } from "#data/elite-redux/coop/authority-v2/protocol-validator";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import {
  CoopAuthorityV2Shadow,
  type CoopV2LiveReplicaSeams,
  type CoopV2ShadowIdentity,
} from "#data/elite-redux/coop/authority-v2/shadow";
import { beforeEach, describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Test doubles (engine-free)
// ---------------------------------------------------------------------------

interface FakeTimer {
  readonly id: number;
  readonly ownerId: string;
  readonly delayMs: number;
  readonly timeClass: CoopTimeClass;
  readonly callback: () => void;
}

/** A deterministic CoopScheduler: timers are inspectable + fireable; cancellation is exact. */
class FakeScheduler implements CoopScheduler {
  private seq = 0;
  private readonly clock = 0;
  readonly timers = new Map<number, FakeTimer>();

  now(_timeClass: CoopTimeClass): number {
    return this.clock;
  }

  schedule(owner: CoopTimerOwner, delayMs: number, timeClass: CoopTimeClass, callback: () => void): () => void {
    const id = ++this.seq;
    this.timers.set(id, { id, ownerId: owner.ownerId, delayMs, timeClass, callback });
    return () => {
      this.timers.delete(id);
    };
  }

  cancelOwner(ownerId: string): void {
    for (const [id, timer] of this.timers) {
      if (timer.ownerId === ownerId) {
        this.timers.delete(id);
      }
    }
  }

  // --- test helpers ---

  liveCount(): number {
    return this.timers.size;
  }

  ownerCount(ownerId: string): number {
    return [...this.timers.values()].filter(t => t.ownerId === ownerId).length;
  }

  /** Fire every currently-scheduled timer once (a snapshot, so re-arm rescheduling does not loop forever). */
  fireAll(): void {
    for (const timer of [...this.timers.values()]) {
      if (this.timers.delete(timer.id)) {
        timer.callback();
      }
    }
  }
}

function frameContext(overrides: Partial<CoopFrameContextV2> = {}): CoopFrameContextV2 {
  return {
    sessionId: "session-A",
    runId: "run-A",
    sessionEpoch: 1,
    seatMapId: "seatmap-A",
    membershipRevision: 1,
    senderSeatId: 0,
    authoritySeatId: 0,
    connectionGeneration: 1,
    ...overrides,
  };
}

function commandControl(
  overrides: Partial<Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>> = {},
): Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }> {
  return {
    kind: "COMMAND_FRONTIER",
    epoch: 1,
    wave: 1,
    turn: 1,
    commands: [{ ownerSeatId: 0, pokemonId: 42, fieldIndex: 0 }],
    ...overrides,
  };
}

function successorWait(
  afterOperationId: string,
  allowedKinds: readonly CoopAuthorityEntry["kind"][],
  allowNextWaveStart = false,
): CoopNextControl {
  return {
    kind: "AWAIT_SUCCESSOR",
    afterOperationId,
    epoch: 1,
    wave: 1,
    turn: 1,
    allowedKinds,
    allowNextWaveStart,
    expectedOperationId: null,
  };
}

function entryInput(
  operationId: string,
  opts: {
    kind?: CoopAuthorityEntry["kind"];
    nextControl?: CoopNextControl;
    subsumes?: number[];
    context?: CoopFrameContextV2;
  } = {},
): Omit<CoopAuthorityEntry, "revision"> {
  const kind = opts.kind ?? "TURN_COMMIT";
  const payload = (() => {
    switch (kind) {
      case "TURN_COMMIT":
        return { epoch: 1, wave: 1, turn: 1 };
      case "REPLACEMENT_COMMIT":
        return { sourceAddress: { epoch: 1, wave: 1, turn: 1 } };
      case "INTERACTION_COMMIT":
        return {
          envelope: {
            sessionEpoch: 1,
            wave: 1,
            turn: 1,
            pendingOperation: { kind: "REWARD" },
          },
        };
      case "CONTROL_COMMIT":
      case "WAVE_ADVANCE":
      case "TERMINAL_COMMIT":
        return { wave: 1, turn: 1 };
    }
  })();
  return {
    context: opts.context ?? frameContext(),
    operationId,
    kind,
    material: { digest: `digest-${operationId}`, payload },
    nextControl: opts.nextControl ?? commandControl(),
    subsumes: opts.subsumes ?? [],
  };
}

const TEST_WAVE_TRANSITION: CoopWaveTransitionMaterialV2 = {
  kind: "wave-advance",
  wave: 1,
  turn: 1,
  outcome: "win",
  nextWave: 2,
  biomeChange: false,
  eggLapse: false,
  meBoundary: "none",
  victoryKind: "wild",
};

function waveBoundaryEntry(
  operationId: string,
  context: CoopFrameContextV2 = frameContext(),
  subsumes: readonly number[] = [],
): Omit<CoopAuthorityEntry, "revision"> {
  return buildWaveAdvanceEntry({
    context,
    operationId,
    transition: TEST_WAVE_TRANSITION,
    destination: commandControl({ epoch: context.sessionEpoch, wave: 2, turn: 1 }),
    subsumes,
  });
}

function terminalBoundaryEntry(
  operationId: string,
  context: CoopFrameContextV2 = frameContext(),
  subsumes: readonly number[] = [],
): Omit<CoopAuthorityEntry, "revision"> {
  return buildTerminalCommitEntry({
    context,
    operationId,
    terminal: {
      kind: "terminal",
      terminalId: operationId,
      reason: "game-over",
      wave: TEST_WAVE_TRANSITION.wave,
      turn: TEST_WAVE_TRANSITION.turn,
    },
    subsumes,
  });
}

function fullEntry(
  revision: number,
  operationId: string,
  opts: {
    kind?: CoopAuthorityEntry["kind"];
    context?: CoopFrameContextV2;
    nextControl?: CoopNextControl;
  } = {},
): CoopAuthorityEntry {
  return { ...entryInput(operationId, opts), revision };
}

function receipt(
  entry: CoopAuthorityEntry,
  stage: CoopAuthorityReceipt["stage"],
  overrides: Partial<CoopAuthorityReceipt> = {},
): CoopAuthorityReceipt {
  return {
    context: { ...entry.context, senderSeatId: 1 },
    revision: entry.revision,
    operationId: entry.operationId,
    stage,
    ...(stage === "controlInstalled" && entry.nextControl != null ? { controlId: controlIdOf(entry.nextControl) } : {}),
    ...overrides,
  };
}

function makeLog(scheduler: FakeScheduler, sent: CoopAuthorityWire[], over: Partial<AuthorityLogOptions> = {}) {
  return new AuthorityLog({
    localContext: frameContext(),
    scheduler,
    send: wire => sent.push(wire),
    peerBindings: [{ seatId: 1, connectionGeneration: frameContext().connectionGeneration }],
    ...over,
  });
}

function makeReplicaLog(scheduler: FakeScheduler, sent: CoopAuthorityWire[], over: Partial<AuthorityLogOptions> = {}) {
  return makeLog(scheduler, sent, {
    localContext: frameContext({ senderSeatId: 1 }),
    peerBindings: [{ seatId: 0, connectionGeneration: frameContext().connectionGeneration }],
    ...over,
  });
}

function reserveAndInstallMechanicalControl(ledger: CoopV2InteractionControlLedger) {
  return (entry: CoopAuthorityEntry): (() => void) | null => {
    const rollback = ledger.prepareAuthorityEntry(entry);
    if (rollback == null) {
      return null;
    }
    if (entry.nextControl.kind !== "COMMAND_FRONTIER" && entry.nextControl.kind !== "TERMINAL") {
      rollback();
      return null;
    }
    const result = ledger.projectMechanical(entry.nextControl, () => ({
      kind: "installed",
      controlId: controlIdOf(entry.nextControl),
    }));
    if (result.kind !== "installed" && result.kind !== "already-installed") {
      rollback();
      return null;
    }
    return rollback;
  };
}

function delivered(sent: CoopAuthorityWire[]): CoopAuthorityEntry[] {
  return sent
    .filter((w): w is Extract<CoopAuthorityWire, { kind: "deliver" }> => w.kind === "deliver")
    .map(w => w.entry);
}

function boundaryProofDiagnostics(log: AuthorityLog): {
  readonly retiredBoundarySources: number;
  readonly tailProofResponses: number;
} {
  return log.diagnostics() as ReturnType<AuthorityLog["diagnostics"]> & {
    readonly retiredBoundarySources: number;
    readonly tailProofResponses: number;
  };
}

type CorrelatedTailRequest = Extract<CoopAuthorityWire, { kind: "requestTail" }> & {
  readonly requestId: string;
  readonly candidateRevision: number;
  readonly candidateOperationId: string;
};

interface CorrelatedBoundaryHarness {
  readonly authority: AuthorityLog;
  readonly replica: AuthorityLog;
  readonly authoritySent: CoopAuthorityWire[];
  readonly replicaSent: CoopAuthorityWire[];
  readonly sources: readonly CoopAuthorityEntry[];
  readonly boundary: CoopAuthorityEntry;
}

function completeReplicaEntry(log: AuthorityLog, entry: CoopAuthorityEntry): void {
  if (
    log.admit(entry).kind !== "admitted"
    || !log.recordReplicaStage(entry, "materialApplied")
    || !log.recordReplicaStage(entry, "controlInstalled")
  ) {
    throw new Error(`could not mechanically complete replica revision ${entry.revision}`);
  }
}

function makeCorrelatedBoundaryHarness(
  subsumes: readonly number[] = [1, 2, 3],
  authorityOptions: Partial<AuthorityLogOptions> = {},
): CorrelatedBoundaryHarness {
  const authoritySent: CoopAuthorityWire[] = [];
  const replicaSent: CoopAuthorityWire[] = [];
  const authority = makeLog(new FakeScheduler(), authoritySent, authorityOptions);
  const replica = makeReplicaLog(new FakeScheduler(), replicaSent);
  const sources = [1, 2, 3].map(revision =>
    authority.commit(
      entryInput(`correlated-source-${revision}`, {
        kind: "TURN_COMMIT",
        nextControl: commandControl(),
      }),
    ),
  );
  for (const source of sources) {
    completeReplicaEntry(replica, source);
  }
  const boundary = authority.commit(waveBoundaryEntry("correlated-boundary", frameContext(), subsumes));
  authoritySent.length = 0;
  replicaSent.length = 0;
  return { authority, replica, authoritySent, replicaSent, sources, boundary };
}

function beginCorrelatedBoundaryProof(harness: CorrelatedBoundaryHarness): CorrelatedTailRequest {
  const disposition = harness.replica.admit(harness.boundary);
  if (disposition.kind !== "gap") {
    throw new Error(`correlated boundary expected a gap, received ${disposition.kind}`);
  }
  const request = harness.replicaSent.at(-1);
  if (
    request?.kind !== "requestTail"
    || request.requestId == null
    || request.candidateRevision == null
    || request.candidateOperationId == null
  ) {
    throw new Error("replica did not emit a correlated boundary-tail request");
  }
  return request as CorrelatedTailRequest;
}

function tailRequestBody(request: CorrelatedTailRequest): CoopTailRequestBodyV2 {
  return {
    fromRevision: request.missingFrom,
    requestId: request.requestId,
    candidateRevision: request.candidateRevision,
    candidateOperationId: request.candidateOperationId,
  };
}

function canonicalBoundaryProofRequestId(context: CoopFrameContextV2, sequence: number): string {
  return `authority-v2:${context.sessionId}:seat${context.senderSeatId}:boundary-proof:${sequence}`;
}

interface ExactTailResponse {
  readonly manifest: Extract<CoopAuthorityWire, { kind: "tailProof" }>;
  readonly sources: readonly Extract<CoopAuthorityWire, { kind: "deliver" }>[];
  readonly complete: Extract<CoopAuthorityWire, { kind: "tailProof" }>;
}

function authorityTailResponse(
  harness: Pick<CorrelatedBoundaryHarness, "authority" | "authoritySent">,
  request: CorrelatedTailRequest,
): ExactTailResponse {
  harness.authoritySent.length = 0;
  harness.authority.handleTailRequest(request.context, tailRequestBody(request));
  const [manifest, ...rest] = harness.authoritySent;
  const complete = rest.at(-1);
  const sources = rest.slice(0, -1);
  if (
    manifest?.kind !== "tailProof"
    || manifest.body.phase !== "manifest"
    || complete?.kind !== "tailProof"
    || complete.body.phase !== "complete"
    || sources.some(wire => wire.kind !== "deliver")
  ) {
    throw new Error("authority did not emit manifest -> exact sources -> complete");
  }
  return {
    manifest,
    sources: sources as Extract<CoopAuthorityWire, { kind: "deliver" }>[],
    complete,
  };
}

function proofBody(
  request: CorrelatedTailRequest,
  phase: CoopTailProofBodyV2["phase"],
  overrides: Partial<CoopTailProofBodyV2> = {},
): CoopTailProofBodyV2 {
  return {
    phase,
    requestId: request.requestId,
    fromRevision: request.missingFrom,
    candidateRevision: request.candidateRevision,
    candidateOperationId: request.candidateOperationId,
    headRevision: request.candidateRevision,
    sourceRevisions: [1, 2, 3],
    ...overrides,
  };
}

function tailProofValidation(body: CoopTailProofBodyV2, context = frameContext()) {
  return validateInboundFrame({
    v: COOP_FRAME_PROTOCOL_VERSION,
    t: "tailProof",
    ctx: context,
    body,
  });
}

function admitAndRegisterAtomically(ledger: CoopV2InteractionControlLedger, entry: CoopAuthorityEntry): boolean {
  const atomicLedger = ledger as CoopV2InteractionControlLedger & {
    admitAndRegisterEntry?: (candidate: CoopAuthorityEntry) => boolean;
  };
  const admit = atomicLedger.admitAndRegisterEntry;
  if (admit == null) {
    throw new Error("control ledger does not expose atomic replica admission");
  }
  return admit.call(ledger, entry);
}

class InertShadowClock implements CoopSchedulerClock {
  private nextHandle = 0;
  private readonly callbacks = new Map<number, () => void>();

  now(): number {
    return 0;
  }

  setTimer(callback: () => void, _delayMs: number): CoopTimerHandle {
    const handle = ++this.nextHandle;
    this.callbacks.set(handle, callback);
    return handle;
  }

  clearTimer(handle: CoopTimerHandle): void {
    this.callbacks.delete(handle as number);
  }
}

function shadowIdentity(localSeatId: number): CoopV2ShadowIdentity {
  const context = frameContext();
  return {
    runtimeId: `${context.sessionId}:boundary-proof:seat${localSeatId}`,
    sessionId: context.sessionId,
    runId: context.runId,
    epoch: context.sessionEpoch,
    localSeatId,
    authoritySeatId: context.authoritySeatId,
    membershipRevision: context.membershipRevision,
    seatMapId: context.seatMapId,
    connectionGeneration: context.connectionGeneration,
    peerBindings: [{ seatId: localSeatId === 0 ? 1 : 0, connectionGeneration: context.connectionGeneration }],
  };
}

interface ShadowBoundaryDuo {
  readonly host: CoopAuthorityV2Shadow;
  readonly guest: CoopAuthorityV2Shadow;
  readonly boundary: CoopAuthorityEntry;
  readonly boundaryFrame: Extract<CoopFrameV2, { t: "authorityEntry" }>;
  readonly requestId: string;
  dispose(): void;
}

function makeShadowBoundaryDuo(options: {
  readonly liveReplica: CoopV2LiveReplicaSeams;
  readonly onProtocolViolation: (issues: readonly string[]) => void;
  readonly alterProofSource?: (
    frame: Extract<CoopFrameV2, { t: "authorityEntry" }>,
  ) => Extract<CoopFrameV2, { t: "authorityEntry" }>;
}): ShadowBoundaryDuo {
  let host!: CoopAuthorityV2Shadow;
  let guest!: CoopAuthorityV2Shadow;
  let boundaryFrame: Extract<CoopFrameV2, { t: "authorityEntry" }> | null = null;
  let requestId: string | null = null;
  let proofSourcesActive = false;
  let alteredProofSource = false;

  host = new CoopAuthorityV2Shadow({
    identity: shadowIdentity(0),
    scene: {} as never,
    transport: {} as never,
    scheduler: createCoopScheduler(new InertShadowClock()),
    send: frame => {
      if (frame.t === "tailProof") {
        proofSourcesActive = frame.body.phase === "manifest";
        guest.handleInboundFrame(frame);
        if (frame.body.phase === "complete") {
          proofSourcesActive = false;
        }
        return;
      }
      if (frame.t === "authorityEntry") {
        if (frame.body.kind === "WAVE_ADVANCE") {
          boundaryFrame = frame;
        }
        if (
          proofSourcesActive
          && !alteredProofSource
          && options.alterProofSource != null
          && frame.body.revision === 3
        ) {
          // Corrupt only the final predecessor source so the manifest and earlier sources remain exact.
          alteredProofSource = true;
          guest.handleInboundFrame(options.alterProofSource(frame));
          return;
        }
      }
      guest.handleInboundFrame(frame);
    },
  });
  guest = new CoopAuthorityV2Shadow({
    identity: shadowIdentity(1),
    scene: {} as never,
    transport: {} as never,
    scheduler: createCoopScheduler(new InertShadowClock()),
    liveReplica: options.liveReplica,
    onProtocolViolation: violation => options.onProtocolViolation(violation.issues),
    send: frame => {
      if (frame.t !== "tailRequest") {
        // Keep every source retained on the authority. Only proof requests cross this deterministic seam.
        return;
      }
      requestId = frame.body.requestId ?? null;
      host.handleInboundFrame(frame);
    },
  });

  for (const revision of [1, 2, 3]) {
    const disposition = host.commitAuthorityEntryDetailed(
      entryInput(`shadow-proof-source-${revision}`, {
        context: host.authenticatedFrameContext,
        kind: "TURN_COMMIT",
        nextControl: commandControl(),
      }),
    );
    if (disposition.kind !== "committed") {
      throw new Error(`shadow boundary source ${revision} did not commit`);
    }
  }
  const boundaryDisposition = host.commitAuthorityEntryDetailed(
    waveBoundaryEntry("shadow-correlated-boundary", host.authenticatedFrameContext, [1, 2, 3]),
  );
  if (boundaryDisposition.kind !== "committed" || boundaryFrame == null || requestId == null) {
    throw new Error("shadow boundary fixture did not complete its correlated wire setup");
  }
  return {
    host,
    guest,
    boundary: boundaryDisposition.entry,
    boundaryFrame,
    requestId,
    dispose: () => {
      host.dispose();
      guest.dispose();
    },
  };
}

// ---------------------------------------------------------------------------

describe("authority-v2 log", () => {
  let scheduler: FakeScheduler;
  let sent: CoopAuthorityWire[];

  beforeEach(() => {
    scheduler = new FakeScheduler();
    sent = [];
  });

  it("commit -> deliver -> apply -> retire happy path", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-1", { nextControl: commandControl() }));

    // Committed under the next global revision, delivered once, retained, one redelivery timer armed.
    expect(committed.revision).toBe(1);
    expect(delivered(sent)).toHaveLength(1);
    expect(delivered(sent)[0].revision).toBe(1);
    expect(log.retained().map(e => e.revision)).toEqual([1]);
    let diag = log.diagnostics();
    expect(diag.retainedEntries).toBe(1);
    expect(diag.activeDeliveryTimers).toBe(1);

    // Redelivery re-sends while unadmitted.
    scheduler.fireAll();
    expect(delivered(sent).length).toBeGreaterThan(1);

    // admitted does NOT stop delivery: a later material/control receipt may be lost, and redelivery is the
    // replica's retry trigger. The entry remains retained with one owned timer.
    expect(log.acceptReceipt(receipt(committed, "admitted"))).toBe(false);
    diag = log.diagnostics();
    expect(diag.activeDeliveryTimers).toBe(1);
    expect(scheduler.ownerCount("authority-v2:session-A:seat0:deliver:1")).toBe(1);
    expect(log.retained().map(e => e.revision)).toEqual([1]);

    // materialApplied alone does not retire an entry that states a nextControl.
    expect(log.acceptReceipt(receipt(committed, "materialApplied"))).toBe(false);
    expect(log.peerStageQuorum(committed.operationId, "materialApplied")).toBe(true);
    expect(log.peerStageQuorum(committed.operationId, "controlInstalled")).toBe(false);
    expect(log.retained()).toHaveLength(1);

    // controlInstalled reaches the required stage -> NEWLY retired.
    expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
    // A continuation registered after synchronous loopback retirement still sees the authenticated quorum.
    expect(log.peerStageQuorum(committed.operationId, "materialApplied")).toBe(true);
    expect(log.peerStageQuorum(committed.operationId, "controlInstalled")).toBe(true);
    expect(log.retained()).toHaveLength(0);
    expect(log.diagnostics().retainedEntries).toBe(0);
    expect(scheduler.liveCount()).toBe(0);
  });

  it("rejects every non-JSON-stable mechanical image before consuming a revision", () => {
    const authority = makeLog(scheduler, sent);
    const invalidPayloads: unknown[] = [
      { droppedByJson: undefined },
      { rewrittenByJson: Number.NaN },
      { rewrittenByJson: Number.POSITIVE_INFINITY },
      Object.assign(["dense"], { droppedByJson: true }),
      new Array(1),
      new Map([["not", "json"]]),
      {
        get invokedOnlyBySerialization() {
          return "unstable";
        },
      },
    ];
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    invalidPayloads.push(cyclic);

    for (const [index, payload] of invalidPayloads.entries()) {
      expect(
        () =>
          authority.commit({
            ...entryInput(`wire-invalid-${index}`),
            material: { digest: `wire-invalid-${index}`, payload },
          }),
        `payload ${index} must fail before reservation`,
      ).toThrow("malformed mechanical entry");
      expect(authority.diagnostics().headRevision).toBe(0);
      expect(authority.retained()).toHaveLength(0);
      expect(delivered(sent)).toHaveLength(0);
    }

    const replica = makeReplicaLog(scheduler, sent);
    expect(
      replica.admit({
        ...fullEntry(1, "wire-invalid-inbound"),
        material: { digest: "wire-invalid-inbound", payload: { droppedByJson: undefined } },
      }),
    ).toEqual({ kind: "rejected", reason: "malformed-entry" });
    expect(replica.diagnostics().receivedThrough).toBe(0);
  });

  it("immediately republishes only N+1 when predecessor quorum unblocks an ordered gap", () => {
    const log = makeLog(scheduler, sent);
    const first = log.commit(
      entryInput("op-1", {
        nextControl: successorWait("op-1", ["INTERACTION_COMMIT"]),
      }),
    );
    const second = log.commit(entryInput("op-2", { kind: "INTERACTION_COMMIT" }));
    expect(delivered(sent).map(entry => entry.revision)).toEqual([1, 2]);

    sent.length = 0;
    expect(log.acceptReceipt(receipt(first, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "controlInstalled"))).toBe(true);

    expect(delivered(sent).map(entry => entry.revision)).toEqual([second.revision]);
    expect(log.retained().map(entry => entry.revision)).toEqual([second.revision]);
    expect(scheduler.ownerCount(`authority-v2:session-A:seat0:deliver:${second.revision}`)).toBe(1);
  });

  it("rejects self-signed and address-mismatched control receipts", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-auth", { nextControl: commandControl() }));

    expect(
      log.acceptReceipt(
        receipt(committed, "admitted", {
          context: committed.context,
        }),
      ),
    ).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "controlInstalled", { controlId: "wrong-control" }))).toBe(false);
    expect(log.retained()).toHaveLength(1);
    expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
  });

  it("classifies receipt progress and every authentication failure without changing boolean retirement", () => {
    const log = makeLog(scheduler, sent, {
      peerBindings: [{ seatId: 1, connectionGeneration: 5 }],
    });
    const committed = log.commit(entryInput("op-verdict", { nextControl: commandControl() }));

    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 4 },
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "connection-generation-mismatch" });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: false, waitingForSeatIds: [1] });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "duplicate", highestStage: 0 });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "controlInstalled", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
          controlId: "wrong-control",
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "control-id-mismatch" });
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "controlInstalled", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: true, waitingForSeatIds: [] });
  });

  it("never lets presentation proof replace missing mechanical proof", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-presentation", { nextControl: commandControl() }));

    expect(log.acceptReceipt(receipt(committed, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "presentationSettled"))).toBe(false);
    expect(log.retained()).toHaveLength(1);
    expect(log.acceptReceipt(receipt(committed, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(committed, "presentationSettled"))).toBe(false);
    expect(log.retained()).toHaveLength(1);
    expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
  });

  it("retires only after every frozen peer seat proves the exact connection generation", () => {
    const log = makeLog(scheduler, sent, {
      peerBindings: [
        { seatId: 1, connectionGeneration: 4 },
        { seatId: 2, connectionGeneration: 9 },
      ],
    });
    const committed = log.commit(entryInput("op-quorum"));

    for (const stage of ["admitted", "materialApplied", "controlInstalled"] as const) {
      expect(
        log.acceptReceipt(
          receipt(committed, stage, {
            context: { ...committed.context, senderSeatId: 1, connectionGeneration: 4 },
          }),
        ),
      ).toBe(false);
    }
    expect(log.retained()).toHaveLength(1);

    // Right seat, stale generation: cannot satisfy the frozen quorum.
    expect(
      log.acceptReceipt(
        receipt(committed, "materialApplied", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 8 },
        }),
      ),
    ).toBe(false);
    expect(log.retained()).toHaveLength(1);

    expect(
      log.acceptReceipt(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 9 },
        }),
      ),
    ).toBe(false);
    expect(
      log.acceptReceipt(
        receipt(committed, "materialApplied", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 9 },
        }),
      ),
    ).toBe(false);
    expect(
      log.acceptReceipt(
        receipt(committed, "controlInstalled", {
          context: { ...committed.context, senderSeatId: 2, connectionGeneration: 9 },
        }),
      ),
    ).toBe(true);
    expect(log.retained()).toHaveLength(0);
  });

  it("rebinds a retained authority lease across hot rejoin without resetting revision or receipt progress", () => {
    const initialContext = frameContext({ membershipRevision: 7, connectionGeneration: 3 });
    const log = makeLog(scheduler, sent, {
      localContext: initialContext,
      peerBindings: [{ seatId: 1, connectionGeneration: 5 }],
    });
    const committed = log.commit(
      entryInput("op-rejoin", {
        context: initialContext,
        nextControl: commandControl(),
      }),
    );
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "admitted", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: false, waitingForSeatIds: [1] });
    const deliveriesBeforeRebind = delivered(sent).length;

    expect(
      log.rebindConnection(frameContext({ membershipRevision: 8, connectionGeneration: 4 }), [
        { seatId: 1, connectionGeneration: 6 },
      ]),
    ).toBe(1);
    const rebound = log.retained()[0];
    expect(rebound).toMatchObject({
      revision: 1,
      operationId: "op-rejoin",
      context: {
        membershipRevision: 8,
        connectionGeneration: 4,
      },
    });
    expect(delivered(sent)).toHaveLength(deliveriesBeforeRebind + 1);
    expect(delivered(sent).at(-1)).toEqual(rebound);

    // A delayed receipt flushed from the replaced channel cannot advance the rebound lease.
    expect(
      log.acceptReceiptDetailed(
        receipt(committed, "materialApplied", {
          context: { ...committed.context, senderSeatId: 1, connectionGeneration: 5 },
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "membership-mismatch" });

    // The admitted stage survived the channel replacement; the new generation resumes at material/control.
    expect(
      log.acceptReceiptDetailed(
        receipt(rebound, "materialApplied", {
          context: { ...rebound.context, senderSeatId: 1, connectionGeneration: 6 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: false, waitingForSeatIds: [1] });
    expect(
      log.acceptReceiptDetailed(
        receipt(rebound, "controlInstalled", {
          context: { ...rebound.context, senderSeatId: 1, connectionGeneration: 6 },
        }),
      ),
    ).toEqual({ kind: "advanced", retired: true, waitingForSeatIds: [] });
    expect(log.diagnostics()).toMatchObject({ headRevision: 1, retainedEntries: 0 });
  });

  it("rebinds an unfinished replica entry to the new authority generation without re-applying old frames", () => {
    const initialLocal = frameContext({ senderSeatId: 1, membershipRevision: 7, connectionGeneration: 5 });
    const log = makeReplicaLog(scheduler, sent, {
      localContext: initialLocal,
      peerBindings: [{ seatId: 0, connectionGeneration: 3 }],
    });
    const oldEntry = fullEntry(1, "op-rejoin-replica", {
      context: frameContext({ membershipRevision: 7, connectionGeneration: 3 }),
      nextControl: commandControl(),
    });
    expect(log.admit(oldEntry)).toEqual({ kind: "admitted" });

    expect(
      log.rebindConnection(frameContext({ senderSeatId: 1, membershipRevision: 8, connectionGeneration: 6 }), [
        { seatId: 0, connectionGeneration: 4 },
      ]),
    ).toBe(0);
    expect(log.admit(oldEntry)).toEqual({ kind: "rejected", reason: "membership-mismatch" });

    const reboundEntry: CoopAuthorityEntry = {
      ...oldEntry,
      context: { ...oldEntry.context, membershipRevision: 8, connectionGeneration: 4 },
    };
    expect(log.admit(reboundEntry)).toEqual({ kind: "duplicate-pending-material" });
    expect(log.recordReplicaStage(reboundEntry, "materialApplied")).toBe(true);
    expect(log.recordReplicaStage(reboundEntry, "controlInstalled")).toBe(true);
    expect(log.controlInstalledThrough()).toBe(1);
  });

  it("requires manifest -> exact sources -> complete and parks candidate duplicates on one request ID", () => {
    const harness = makeCorrelatedBoundaryHarness();
    const request = beginCorrelatedBoundaryProof(harness);
    const firstRequestBytes = JSON.stringify(harness.replicaSent.at(-1));

    expect(authorityEntryProofScopeOf(harness.boundary)).toBeNull();
    expect(harness.replica.receivedThrough()).toBe(3);
    expect(harness.replica.appliedThrough()).toBe(3);
    expect(harness.replica.controlInstalledThrough()).toBe(3);

    // The candidate is explicitly not a delimiter. Before the manifest arrives, an exact duplicate can
    // only wake the same correlated request and cannot advance any mechanical frontier.
    expect(harness.replica.admit(harness.boundary)).toEqual({ kind: "gap", missingFrom: request.missingFrom });
    expect(JSON.stringify(harness.replicaSent.at(-1))).toBe(firstRequestBytes);
    expect(authorityEntryProofScopeOf(harness.boundary)).toBeNull();
    expect(harness.replica.receivedThrough()).toBe(3);

    const response = authorityTailResponse(harness, request);
    expect(response.manifest.body).toMatchObject({
      phase: "manifest",
      requestId: request.requestId,
      sourceRevisions: [1, 2, 3],
    });
    expect(response.sources.map(wire => wire.entry.revision)).toEqual([1, 2, 3]);
    expect(response.sources.at(-1)?.entry).toEqual(harness.sources.at(-1));
    expect(response.sources.some(wire => wire.entry.revision === harness.boundary.revision)).toBe(false);

    expect(harness.replica.acceptBoundaryProofFrame(response.manifest.context, response.manifest.body)).toEqual({
      kind: "pending",
    });
    for (const source of response.sources) {
      expect(harness.replica.admit(source.entry)).toEqual({ kind: "gap", missingFrom: request.missingFrom });
    }
    expect(authorityEntryProofScopeOf(harness.boundary)).toBeNull();
    expect(harness.replica.receivedThrough()).toBe(3);
    expect(harness.replica.acceptBoundaryProofFrame(response.complete.context, response.complete.body)).toMatchObject({
      kind: "completed",
      candidate: harness.boundary,
    });
    expect(harness.replica.receivedThrough()).toBe(3);

    expect(harness.replica.admit(harness.boundary)).toEqual({ kind: "admitted" });
    const scope = authorityEntryProofScopeOf(harness.boundary);
    expect(scope).toMatchObject({ kind: "replica-dense-frontier", authenticatedThrough: 3 });
    if (scope?.kind !== "replica-dense-frontier") {
      throw new Error("completed correlated proof did not mint an exact replica scope");
    }
    expect(scope.trustedSources.map(source => source.revision)).toEqual([1, 2, 3]);
    expect(scope.authenticatedSources.map(source => source.revision)).toEqual([4]);
    expect(harness.replica.receivedThrough()).toBe(4);
    expect(harness.replica.appliedThrough()).toBe(3);
  });

  it("replays each (seat, requestId) proof byte-identically after a newer request and source retirement", () => {
    const harness = makeCorrelatedBoundaryHarness([1, 2, 3], {
      peerBindings: [
        { seatId: 1, connectionGeneration: frameContext().connectionGeneration },
        { seatId: 2, connectionGeneration: frameContext().connectionGeneration },
      ],
    });
    const firstRequest = beginCorrelatedBoundaryProof(harness);
    const firstResponse = authorityTailResponse(harness, firstRequest);
    const firstBytes = JSON.stringify(harness.authoritySent);
    expect(firstRequest.requestId).toBe(canonicalBoundaryProofRequestId(firstRequest.context, 1));
    expect(firstResponse.sources.map(wire => wire.entry.revision)).toEqual([1, 2, 3]);
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(1);

    const seat2Context = { ...firstRequest.context, senderSeatId: 2 };
    const seat2Request: CorrelatedTailRequest = {
      ...firstRequest,
      context: seat2Context,
      requestId: canonicalBoundaryProofRequestId(seat2Context, 1),
    };
    expect(seat2Request.requestId).toBe(`authority-v2:${seat2Context.sessionId}:seat2:boundary-proof:1`);
    const seat2Response = authorityTailResponse(harness, seat2Request);
    expect(seat2Response.manifest.body.requestId).toBe(seat2Request.requestId);
    expect(seat2Response.sources.map(wire => wire.entry.revision)).toEqual([1, 2, 3]);
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(2);

    // Candidate admission retires every exact source lease while the candidate itself remains retained.
    expect(harness.authority.acceptReceipt(receipt(harness.boundary, "admitted"))).toBe(false);
    expect(
      harness.authority.acceptReceipt(
        receipt(harness.boundary, "admitted", {
          context: { ...harness.boundary.context, senderSeatId: 2 },
        }),
      ),
    ).toBe(false);
    expect(harness.authority.retained().map(entry => entry.revision)).toEqual([harness.boundary.revision]);
    expect(boundaryProofDiagnostics(harness.authority)).toMatchObject({
      retiredBoundarySources: 3,
      tailProofResponses: 2,
    });

    const newerRequest: CorrelatedTailRequest = {
      ...firstRequest,
      requestId: canonicalBoundaryProofRequestId(firstRequest.context, 2),
    };
    expect(newerRequest.requestId).toBe(`authority-v2:${firstRequest.context.sessionId}:seat1:boundary-proof:2`);
    const newerResponse = authorityTailResponse(harness, newerRequest);
    expect(newerResponse.manifest.body.sourceRevisions).toEqual([1, 2, 3]);
    expect(newerResponse.sources.map(wire => wire.entry.revision)).toEqual([1, 2, 3]);
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(3);

    // Conflicting reuse of a successful live-candidate key is inert and cannot poison its frozen response.
    harness.authoritySent.length = 0;
    harness.authority.handleTailRequest(firstRequest.context, {
      ...tailRequestBody(firstRequest),
      candidateOperationId: "conflicting-live-candidate",
    });
    expect(harness.authoritySent).toEqual([]);
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(3);

    harness.authoritySent.length = 0;
    harness.authority.handleTailRequest(firstRequest.context, tailRequestBody(firstRequest));
    expect(JSON.stringify(harness.authoritySent)).toBe(firstBytes);
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(3);
  });

  it("does not spend correlated cache capacity on invalid or nonexistent candidates", () => {
    const harness = makeCorrelatedBoundaryHarness([1, 2, 3], { retainCapacity: 4 });
    const request = beginCorrelatedBoundaryProof(harness);
    const canonicalRequestId = canonicalBoundaryProofRequestId(request.context, 1);
    expect(request.requestId).toBe(canonicalRequestId);

    for (let attempt = 0; attempt < 4; attempt++) {
      harness.authoritySent.length = 0;
      harness.authority.handleTailRequest(request.context, {
        ...tailRequestBody(request),
        requestId: canonicalRequestId,
        candidateRevision: attempt % 2 === 0 ? request.candidateRevision : request.candidateRevision + attempt + 1,
        candidateOperationId: `nonexistent-operation-${attempt}`,
      });
      expect(harness.authoritySent, `nonexistent candidate ${attempt}`).toEqual([]);
    }
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(0);

    const response = authorityTailResponse(harness, request);
    expect(response.manifest.body.requestId).toBe(request.requestId);
    expect(response.sources.map(wire => wire.entry.revision)).toEqual([1, 2, 3]);
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(1);
  });

  it("rejects noncanonical proof ranges without consuming seq1 or poisoning its exact retry", () => {
    const harness = makeCorrelatedBoundaryHarness();
    const request = beginCorrelatedBoundaryProof(harness);
    expect(request.missingFrom).toBe(1);
    expect(request.requestId).toBe(canonicalBoundaryProofRequestId(request.context, 1));
    const retainedBefore = harness.authority.retained();
    const diagnosticsBefore = harness.authority.diagnostics();

    for (const [label, fromRevision] of [
      ["lower", request.missingFrom - 1],
      ["higher", request.missingFrom + 1],
    ] as const) {
      harness.authoritySent.length = 0;
      harness.authority.handleTailRequest(request.context, {
        ...tailRequestBody(request),
        fromRevision,
      });
      expect(harness.authoritySent, `${label} noncanonical range`).toEqual([]);
      expect(harness.authority.retained(), `${label} noncanonical range`).toEqual(retainedBefore);
      expect(harness.authority.diagnostics(), `${label} noncanonical range`).toMatchObject({
        headRevision: diagnosticsBefore.headRevision,
        retainedEntries: diagnosticsBefore.retainedEntries,
      });
      expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(0);
    }

    const response = authorityTailResponse(harness, request);
    expect(response.manifest.body).toMatchObject({
      requestId: request.requestId,
      fromRevision: request.missingFrom,
      sourceRevisions: [1, 2, 3],
    });
    expect(response.sources.map(wire => wire.entry.revision)).toEqual([1, 2, 3]);
    expect(boundaryProofDiagnostics(harness.authority).tailProofResponses).toBe(1);
  });

  it("reclaims retired-candidate IDs while fencing old sequences from newer candidates", () => {
    const localSent: CoopAuthorityWire[] = [];
    const log = makeLog(new FakeScheduler(), localSent, { retainCapacity: 2 });
    const peerContext = frameContext({ senderSeatId: 1 });

    for (let wave = 1; wave <= 3; wave++) {
      const sourceOperationId = `cache-source-wave-${wave}`;
      const source = log.commit({
        ...entryInput(sourceOperationId, {
          kind: "TURN_COMMIT",
          nextControl: commandControl({ wave, turn: 1 }),
        }),
        material: {
          digest: `digest-${sourceOperationId}`,
          payload: { epoch: frameContext().sessionEpoch, wave, turn: 1 },
        },
      });
      const candidate = log.commit(
        buildWaveAdvanceEntry({
          context: frameContext(),
          operationId: `cache-candidate-wave-${wave}`,
          transition: { ...TEST_WAVE_TRANSITION, wave, nextWave: wave + 1 },
          destination: commandControl({ wave: wave + 1, turn: 1 }),
          subsumes: [source.revision],
        }),
      );

      if (wave > 1) {
        const retiredCandidateRequestId = canonicalBoundaryProofRequestId(peerContext, wave - 1);
        localSent.length = 0;
        log.handleTailRequest(peerContext, {
          fromRevision: source.revision,
          requestId: retiredCandidateRequestId,
          candidateRevision: candidate.revision,
          candidateOperationId: candidate.operationId,
        });
        expect(localSent, `retired sequence ${wave - 1} targeting candidate ${candidate.revision}`).toEqual([]);
        expect(boundaryProofDiagnostics(log).tailProofResponses).toBe(0);
      }

      const requestId = canonicalBoundaryProofRequestId(peerContext, wave);
      localSent.length = 0;
      log.handleTailRequest(peerContext, {
        fromRevision: source.revision,
        requestId,
        candidateRevision: candidate.revision,
        candidateOperationId: candidate.operationId,
      });
      expect(
        localSent.map(wire => wire.kind),
        requestId,
      ).toEqual(["tailProof", "deliver", "tailProof"]);
      expect(localSent[0], requestId).toMatchObject({ kind: "tailProof", body: { requestId } });
      expect(boundaryProofDiagnostics(log).tailProofResponses).toBe(1);

      expect(log.acceptReceipt(receipt(candidate, "admitted"))).toBe(false);
      expect(log.acceptReceipt(receipt(candidate, "materialApplied"))).toBe(false);
      expect(log.acceptReceipt(receipt(candidate, "controlInstalled"))).toBe(true);
      expect(log.retained()).toEqual([]);
      expect(boundaryProofDiagnostics(log)).toMatchObject({
        retiredBoundarySources: 2,
        tailProofResponses: 0,
      });
    }

    expect(log.diagnostics()).toMatchObject({ headRevision: 6, retainedEntries: 0, activeDeliveryTimers: 0 });
  });

  it("fails closed for incomplete, omitted, altered, unlisted, and mismatched correlated source proofs", () => {
    const assertAfter = (
      label: string,
      arrange: (
        harness: CorrelatedBoundaryHarness,
        request: CorrelatedTailRequest,
      ) => { readonly disposition: { readonly kind: string }; readonly boundary: CoopAuthorityEntry },
      expectedKind: "rejected" | "gap" = "rejected",
    ): void => {
      const harness = makeCorrelatedBoundaryHarness();
      const request = beginCorrelatedBoundaryProof(harness);
      const { disposition, boundary } = arrange(harness, request);
      expect(disposition.kind, label).toBe(expectedKind);
      expect(authorityEntryProofScopeOf(boundary), label).toBeNull();
      expect(harness.replica.receivedThrough(), label).toBe(3);
      expect(harness.replica.appliedThrough(), label).toBe(3);
      expect(harness.replica.controlInstalledThrough(), label).toBe(3);
    };

    assertAfter("missing delivered source", (harness, request) => {
      const manifest = proofBody(request, "manifest");
      expect(harness.replica.acceptBoundaryProofFrame(frameContext(), manifest)).toEqual({ kind: "pending" });
      for (const source of harness.sources.slice(0, 2)) {
        expect(harness.replica.admit(source).kind).toBe("gap");
      }
      return {
        disposition: harness.replica.acceptBoundaryProofFrame(frameContext(), proofBody(request, "complete")),
        boundary: harness.boundary,
      };
    });

    assertAfter("manifest omitted mandatory predecessor", (harness, request) => {
      const sourceRevisions = [1, 2];
      expect(
        harness.replica.acceptBoundaryProofFrame(frameContext(), proofBody(request, "manifest", { sourceRevisions })),
      ).toEqual({ kind: "pending" });
      for (const source of harness.sources.slice(0, 2)) {
        expect(harness.replica.admit(source).kind).toBe("gap");
      }
      return {
        disposition: harness.replica.acceptBoundaryProofFrame(
          frameContext(),
          proofBody(request, "complete", { sourceRevisions }),
        ),
        boundary: harness.boundary,
      };
    });

    assertAfter("manifest omitted claimed source", (harness, request) => {
      const sourceRevisions = [1, 3];
      expect(
        harness.replica.acceptBoundaryProofFrame(frameContext(), proofBody(request, "manifest", { sourceRevisions })),
      ).toEqual({ kind: "pending" });
      for (const source of [harness.sources[0], harness.sources[2]]) {
        if (source == null) {
          throw new Error("omitted-source fixture lost a retained source");
        }
        expect(harness.replica.admit(source).kind).toBe("gap");
      }
      return {
        disposition: harness.replica.acceptBoundaryProofFrame(
          frameContext(),
          proofBody(request, "complete", { sourceRevisions }),
        ),
        boundary: harness.boundary,
      };
    });

    assertAfter("altered duplicate source", (harness, request) => {
      expect(harness.replica.acceptBoundaryProofFrame(frameContext(), proofBody(request, "manifest"))).toEqual({
        kind: "pending",
      });
      const source = harness.sources[0];
      if (source == null) {
        throw new Error("altered-source fixture lost its first source");
      }
      expect(harness.replica.admit(source).kind).toBe("gap");
      const altered: CoopAuthorityEntry = {
        ...source,
        material: { ...source.material, digest: `${source.material.digest}-altered` },
      };
      return { disposition: harness.replica.admit(altered), boundary: harness.boundary };
    });

    assertAfter(
      "exact duplicate source",
      (harness, request) => {
        expect(harness.replica.acceptBoundaryProofFrame(frameContext(), proofBody(request, "manifest"))).toEqual({
          kind: "pending",
        });
        const source = harness.sources[0];
        if (source == null) {
          throw new Error("duplicate-source fixture lost its first source");
        }
        expect(harness.replica.admit(source).kind).toBe("gap");
        const duplicate = harness.replica.admit(structuredClone(source));
        expect(duplicate).toEqual({ kind: "gap", missingFrom: request.missingFrom });
        expect(harness.replica.hasBoundaryProofCapture()).toBe(true);
        return { disposition: duplicate, boundary: harness.boundary };
      },
      "gap",
    );

    assertAfter("unlisted source", (harness, request) => {
      expect(
        harness.replica.acceptBoundaryProofFrame(
          frameContext(),
          proofBody(request, "manifest", { sourceRevisions: [1, 3] }),
        ),
      ).toEqual({ kind: "pending" });
      const unlisted = harness.sources[1];
      if (unlisted == null) {
        throw new Error("unlisted-source fixture lost revision 2");
      }
      return { disposition: harness.replica.admit(unlisted), boundary: harness.boundary };
    });

    for (const [label, context, body] of [
      ["wrong request", frameContext(), { requestId: "other-boundary-proof" }],
      ["wrong context", frameContext({ membershipRevision: 2 }), {}],
      ["wrong candidate head/range", frameContext(), { fromRevision: 2 }],
    ] as const) {
      assertAfter(label, (harness, request) => ({
        disposition: harness.replica.acceptBoundaryProofFrame(context, proofBody(request, "manifest", body)),
        boundary: harness.boundary,
      }));
    }

    assertAfter("wrong completion head", (harness, request) => {
      expect(harness.replica.acceptBoundaryProofFrame(frameContext(), proofBody(request, "manifest"))).toEqual({
        kind: "pending",
      });
      for (const source of harness.sources) {
        expect(harness.replica.admit(source).kind).toBe("gap");
      }
      return {
        disposition: harness.replica.acceptBoundaryProofFrame(
          frameContext(),
          proofBody(request, "complete", { headRevision: request.candidateRevision + 1 }),
        ),
        boundary: harness.boundary,
      };
    });
  });

  it("rejects reordered, duplicate, and out-of-range proof manifests at the public frame boundary", () => {
    const harness = makeCorrelatedBoundaryHarness();
    const request = beginCorrelatedBoundaryProof(harness);
    for (const [label, sourceRevisions] of [
      ["reordered", [2, 1, 3]],
      ["duplicate", [1, 2, 2, 3]],
      ["below range", [0, 1, 2, 3]],
      ["candidate in range", [1, 2, 3, 4]],
    ] as const) {
      const verdict = tailProofValidation(proofBody(request, "manifest", { sourceRevisions }));
      expect(verdict.kind, label).toBe("protocol-violation");
      expect(authorityEntryProofScopeOf(harness.boundary), label).toBeNull();
      expect(harness.replica.receivedThrough(), label).toBe(3);
    }
  });

  it("refreshes an exact archived predecessor after 520 ordinary commits without a candidate delimiter", () => {
    const authorityScheduler = new FakeScheduler();
    const replicaScheduler = new FakeScheduler();
    const authoritySent: CoopAuthorityWire[] = [];
    const replicaSent: CoopAuthorityWire[] = [];
    const authority = makeLog(authorityScheduler, authoritySent);
    const replica = makeReplicaLog(replicaScheduler, replicaSent);
    let predecessor: CoopAuthorityEntry | null = null;

    for (let revision = 1; revision <= 520; revision++) {
      const source = authority.commit(
        entryInput(`archived-source-${revision}`, { kind: "TURN_COMMIT", nextControl: commandControl() }),
      );
      completeReplicaEntry(replica, source);
      predecessor = source;
      if (revision < 520) {
        expect(authority.acceptReceipt(receipt(source, "admitted"))).toBe(false);
        expect(authority.acceptReceipt(receipt(source, "materialApplied"))).toBe(false);
        expect(authority.acceptReceipt(receipt(source, "controlInstalled"))).toBe(true);
      }
    }
    if (predecessor == null) {
      throw new Error("retention-cliff fixture has no predecessor");
    }
    const boundary = authority.commit(waveBoundaryEntry("post-520-boundary", frameContext(), [predecessor.revision]));
    expect(authority.acceptReceipt(receipt(boundary, "admitted"))).toBe(false);
    expect(authority.retained().map(entry => entry.revision)).toEqual([boundary.revision]);

    authoritySent.length = 0;
    replicaSent.length = 0;
    const firstAdmission = replica.admit(boundary);
    expect(firstAdmission.kind).toBe("gap");
    const request = replicaSent.at(-1);
    if (
      request?.kind !== "requestTail"
      || request.requestId == null
      || request.candidateRevision == null
      || request.candidateOperationId == null
    ) {
      throw new Error("post-520 boundary did not request an exact archived proof");
    }
    const correlated = request as CorrelatedTailRequest;
    expect(correlated.missingFrom).toBe(predecessor.revision);
    const response = authorityTailResponse({ authority, authoritySent }, correlated);
    expect(response.manifest.body.sourceRevisions).toEqual([predecessor.revision]);
    expect(response.sources.map(wire => wire.entry.revision)).toEqual([predecessor.revision]);
    expect(response.sources.some(wire => wire.entry.revision === boundary.revision)).toBe(false);
    expect(boundaryProofDiagnostics(authority)).toMatchObject({
      retiredBoundarySources: 512,
      tailProofResponses: 1,
    });

    expect(replica.acceptBoundaryProofFrame(response.manifest.context, response.manifest.body)).toEqual({
      kind: "pending",
    });
    const proofSource = response.sources[0];
    if (proofSource == null) {
      throw new Error("post-520 proof omitted its archived predecessor");
    }
    expect(replica.admit(proofSource.entry)).toEqual({ kind: "gap", missingFrom: correlated.missingFrom });
    expect(replica.acceptBoundaryProofFrame(response.complete.context, response.complete.body)).toMatchObject({
      kind: "completed",
      candidate: boundary,
    });
    expect(replica.admit(boundary)).toEqual({ kind: "admitted" });
    const scope = authorityEntryProofScopeOf(boundary);
    expect(scope).toMatchObject({ kind: "replica-dense-frontier", authenticatedThrough: 520 });
    if (scope?.kind !== "replica-dense-frontier") {
      throw new Error("post-520 boundary did not receive its exact proof scope");
    }
    expect(scope.trustedSources.map(source => source.revision)).toEqual([520]);
    expect(scope.authenticatedSources.map(source => source.revision)).toEqual([521]);
    expect(authorityScheduler.liveCount()).toBe(1);
    expect(replicaScheduler.liveCount()).toBe(0);
  });

  it("keeps the first live-ledger refusal silent, terminals the second, and makes later duplicates inert", () => {
    const violations: string[][] = [];
    const callbackEntries: CoopAuthorityEntry[] = [];
    const proofWasLive: boolean[] = [];
    let boundaryMaterialApplications = 0;
    const duo = makeShadowBoundaryDuo({
      onProtocolViolation: issues => violations.push([...issues]),
      liveReplica: {
        ownsEntry: entry => entry.kind === "WAVE_ADVANCE",
        ownsControl: () => false,
        admitEntry: (_ctx, entry) => {
          if (entry.kind !== "WAVE_ADVANCE") {
            return true;
          }
          callbackEntries.push(entry);
          const scope = authorityEntryProofScopeOf(entry);
          proofWasLive.push(scope?.kind === "replica-dense-frontier" && scope.isActive());
          return false;
        },
        applyMaterial: (_ctx, entry) => {
          if (entry.kind !== "WAVE_ADVANCE") {
            return null;
          }
          boundaryMaterialApplications += 1;
          return true;
        },
        projectControl: () => null,
      },
    });

    expect(callbackEntries).toHaveLength(1);
    expect(proofWasLive).toEqual([true]);
    expect(violations).toEqual([]);
    expect(boundaryMaterialApplications).toBe(0);
    expect(authorityEntryProofScopeOf(callbackEntries[0] as CoopAuthorityEntry)).toBeNull();
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 3, applied: 3, shadowStateSize: 3 });

    duo.guest.handleInboundFrame(duo.boundaryFrame);
    expect(callbackEntries).toHaveLength(2);
    expect(proofWasLive).toEqual([true, true]);
    expect(violations).toHaveLength(1);
    expect(boundaryMaterialApplications).toBe(0);
    expect(authorityEntryProofScopeOf(callbackEntries[1] as CoopAuthorityEntry)).toBeNull();

    for (let duplicate = 0; duplicate < 3; duplicate++) {
      duo.guest.handleInboundFrame(duo.boundaryFrame);
    }
    expect(callbackEntries).toHaveLength(2);
    expect(violations).toHaveLength(1);
    expect(boundaryMaterialApplications).toBe(0);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 3, applied: 3, shadowStateSize: 3 });
    duo.dispose();
  });

  it("turns admission callback throws before or after partial mutation into one fenced terminal", () => {
    for (const throwPoint of ["before", "after-admit"] as const) {
      const violations: string[][] = [];
      const liveLedger = new CoopV2InteractionControlLedger();
      const callbackEntries: CoopAuthorityEntry[] = [];
      let boundaryMaterialApplications = 0;
      let postRegisterFaults = 0;
      if (throwPoint === "after-admit") {
        const register = liveLedger.registerEntry.bind(liveLedger);
        liveLedger.registerEntry = entry => {
          const registered = register(entry);
          if (registered && entry.kind === "WAVE_ADVANCE") {
            postRegisterFaults += 1;
            throw new Error("synthetic post-register callback fault");
          }
          return registered;
        };
      }
      const duo = makeShadowBoundaryDuo({
        onProtocolViolation: issues => violations.push([...issues]),
        liveReplica: {
          ownsEntry: entry => entry.kind === "WAVE_ADVANCE",
          ownsControl: () => false,
          admitEntry: (_ctx, entry) => {
            if (entry.kind !== "WAVE_ADVANCE") {
              if (
                !liveLedger.admitSuccessor(entry)
                || !liveLedger.registerEntry(entry)
                || !liveLedger.markMaterialApplied(entry)
              ) {
                throw new Error(`could not seed live source ${entry.revision}`);
              }
              const projected = liveLedger.projectMechanical(entry.nextControl, () => ({
                kind: "installed",
                controlId: controlIdOf(entry.nextControl),
              }));
              if (projected.kind !== "installed" && projected.kind !== "already-installed") {
                throw new Error(`could not install live source ${entry.revision}`);
              }
              return true;
            }
            callbackEntries.push(entry);
            if (throwPoint === "after-admit") {
              return admitAndRegisterAtomically(liveLedger, entry);
            }
            throw new Error(`boundary callback threw ${throwPoint}`);
          },
          applyMaterial: (_ctx, entry) => {
            if (entry.kind !== "WAVE_ADVANCE") {
              return null;
            }
            boundaryMaterialApplications += 1;
            return true;
          },
          projectControl: () => null,
        },
      });

      expect(callbackEntries, throwPoint).toHaveLength(1);
      const attempted = callbackEntries[0];
      if (attempted == null) {
        throw new Error(`callback throw fixture ${throwPoint} did not retain its exact entry`);
      }
      expect(violations, throwPoint).toHaveLength(1);
      expect(boundaryMaterialApplications, throwPoint).toBe(0);
      expect(authorityEntryProofScopeOf(attempted), throwPoint).toBeNull();
      expect(postRegisterFaults, throwPoint).toBe(throwPoint === "after-admit" ? 1 : 0);

      // Atomic admission restores the predecessor before the shared terminal callback returns. No stale
      // exact object or clone can recover the consumed/revoked proof afterward.
      expect(liveLedger.activeControl, throwPoint).toEqual(commandControl());
      expect(liveLedger.latestControl, throwPoint).toEqual(commandControl());
      expect(liveLedger.authenticatedSourceCount, throwPoint).toBe(3);
      expect(liveLedger.sourceEntryOf(commandControl()), throwPoint).toMatchObject({
        revision: 3,
        operationId: "shadow-proof-source-3",
      });
      expect(liveLedger.admitSuccessor(attempted), throwPoint).toBe(false);
      expect(liveLedger.admitSuccessor(structuredClone(attempted)), throwPoint).toBe(false);

      duo.guest.handleInboundFrame(duo.boundaryFrame);
      duo.guest.handleInboundFrame(duo.boundaryFrame);
      expect(callbackEntries, throwPoint).toHaveLength(1);
      expect(violations, throwPoint).toHaveLength(1);
      expect(boundaryMaterialApplications, throwPoint).toBe(0);
      expect(duo.guest.diagnostics(), throwPoint).toMatchObject({ admitted: 3, applied: 3, shadowStateSize: 3 });
      duo.dispose();
    }
  });

  it("reports one unconditional shared terminal keyed to the request when an exact proof source is altered", () => {
    const violations: string[][] = [];
    let boundaryAdmissionCalls = 0;
    let boundaryMaterialApplications = 0;
    const duo = makeShadowBoundaryDuo({
      onProtocolViolation: issues => violations.push([...issues]),
      alterProofSource: frame => ({
        ...frame,
        body: {
          ...frame.body,
          material: {
            ...frame.body.material,
            digest: `${frame.body.material.digest}-altered-proof-source`,
          },
        },
      }),
      liveReplica: {
        // Proof sources are deliberately unowned: source rejection must still reach the shared terminal.
        ownsEntry: entry => entry.kind === "WAVE_ADVANCE",
        ownsControl: () => false,
        admitEntry: (_ctx, entry) => {
          if (entry.kind === "WAVE_ADVANCE") {
            boundaryAdmissionCalls += 1;
          }
          return true;
        },
        applyMaterial: (_ctx, entry) => {
          if (entry.kind !== "WAVE_ADVANCE") {
            return null;
          }
          boundaryMaterialApplications += 1;
          return true;
        },
        projectControl: () => null,
      },
    });

    expect(violations).toHaveLength(1);
    expect(violations[0]?.join(" ")).toContain("boundary-proof predecessor absent or identity-conflicting");
    expect(boundaryAdmissionCalls).toBe(0);
    expect(boundaryMaterialApplications).toBe(0);
    expect(duo.guest.diagnostics()).toMatchObject({ admitted: 3, applied: 3, shadowStateSize: 3 });

    duo.dispose();
  });

  it("readdresses a deferred boundary after its predecessor retires without recapturing or allocating a revision", () => {
    let prepareCalls = 0;
    const log = makeLog(scheduler, sent);
    const predecessor = log.commit(
      entryInput("boundary-predecessor", {
        kind: "TURN_COMMIT",
        nextControl: commandControl(),
      }),
    );
    const deferredDisposition = log.commitDetailed(
      waveBoundaryEntry("deferred-boundary", frameContext(), [predecessor.revision]),
      () => {
        prepareCalls += 1;
        return prepareCalls === 1 ? null : () => {};
      },
    );
    expect(deferredDisposition.kind).toBe("deferred");
    if (deferredDisposition.kind !== "deferred") {
      return;
    }
    const deferred = deferredDisposition.entry;
    expect(deferred).toMatchObject({ revision: 2, operationId: "deferred-boundary", kind: "WAVE_ADVANCE" });
    expect(log.retained().map(entry => entry.revision)).toEqual([predecessor.revision]);

    // The older retained lease can complete independently while the exact boundary remains deferred.
    expect(log.acceptReceipt(receipt(predecessor, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(predecessor, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(predecessor, "controlInstalled"))).toBe(true);
    expect(log.retained()).toHaveLength(0);

    const retry = log.retryDeferredCommit(deferred.operationId);
    expect(retry.kind).toBe("committed");
    if (retry.kind !== "committed") {
      return;
    }
    expect(retry.entry).toEqual(deferred);
    expect(retry.entry.revision).toBe(deferred.revision);
    expect(retry.entry.material).toEqual(deferred.material);
    expect(prepareCalls).toBe(2);
    expect(delivered(sent).filter(entry => entry.operationId === deferred.operationId)).toHaveLength(1);
    expect(log.diagnostics()).toMatchObject({ headRevision: deferred.revision, retainedEntries: 1 });
  });

  it("retries the exact approved boundary after an unrelated lease retires and rejects changed deferred bodies", () => {
    let prepareCalls = 0;
    const log = makeLog(scheduler, sent);
    const unrelated = log.commit(
      entryInput("unrelated-retained-turn", {
        kind: "TURN_COMMIT",
        nextControl: commandControl(),
      }),
    );
    const predecessor = log.commit(
      entryInput("boundary-predecessor-2", {
        kind: "TURN_COMMIT",
        nextControl: commandControl(),
      }),
    );
    const boundaryInput = waveBoundaryEntry("deferred-boundary-2", frameContext(), [1, 2]);
    const deferredDisposition = log.commitDetailed(boundaryInput, entry => {
      prepareCalls += 1;
      expect(entry.revision).toBe(3);
      return prepareCalls === 1 ? null : () => {};
    });
    expect(deferredDisposition.kind).toBe("deferred");
    if (deferredDisposition.kind !== "deferred") {
      return;
    }
    const deferred = deferredDisposition.entry;
    expect(log.retained().map(entry => entry.revision)).toEqual([unrelated.revision, predecessor.revision]);

    // Only the unrelated older lease retires. The stale predecessor that made the boundary approval valid
    // remains live, while the exact captured source list still includes the retired revision 1.
    expect(log.acceptReceipt(receipt(unrelated, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(unrelated, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(unrelated, "controlInstalled"))).toBe(true);
    expect(log.retained().map(entry => entry.revision)).toEqual([predecessor.revision]);

    expect(() => log.commit({ ...boundaryInput, operationId: "changed-deferred-boundary" })).toThrow(
      /deferred successor is already awaiting predecessor control/u,
    );
    // Omitting the originally approved predecessor/source revision is also a changed deferred body.
    expect(() => log.commit(waveBoundaryEntry(deferred.operationId, frameContext(), [predecessor.revision]))).toThrow(
      /deferred successor is already awaiting predecessor control/u,
    );
    expect(log.retryDeferredCommit("wrong-deferred-operation")).toEqual({
      kind: "failed",
      reason: "AuthorityLog deferred operation mismatch: expected wrong-deferred-operation",
    });

    const retry = log.retryDeferredCommit(deferred.operationId);
    expect(retry.kind).toBe("committed");
    if (retry.kind !== "committed") {
      return;
    }
    expect(retry.entry).toEqual(deferred);
    expect(retry.entry).toMatchObject({
      revision: deferred.revision,
      operationId: deferred.operationId,
      material: deferred.material,
    });
    expect(prepareCalls).toBe(2);
    expect(delivered(sent).filter(entry => entry.operationId === deferred.operationId)).toEqual([deferred]);
  });

  it("rejects partial, ineligible, unknown, duplicate, out-of-range, and omitted-predecessor authority subsumes", () => {
    const cases: readonly [string, readonly number[]][] = [
      ["partial", [3]],
      ["ineligible", [1, 2, 3]],
      ["unknown", [1, 3, 99]],
      ["duplicate", [1, 3, 3]],
      ["out-of-range", [0, 1, 3]],
      ["omitted-predecessor", [1]],
    ];
    for (const [label, subsumes] of cases) {
      const localScheduler = new FakeScheduler();
      const localSent: CoopAuthorityWire[] = [];
      const log = makeLog(localScheduler, localSent);
      log.commit(
        entryInput("eligible-source-1", {
          kind: "TURN_COMMIT",
          nextControl: successorWait("eligible-source-1", ["INTERACTION_COMMIT"]),
        }),
      );
      log.commit(
        entryInput("ineligible-source-2", {
          kind: "INTERACTION_COMMIT",
          nextControl: successorWait("ineligible-source-2", ["TURN_COMMIT"]),
        }),
      );
      log.commit(
        entryInput("eligible-source-3", {
          kind: "TURN_COMMIT",
          nextControl: commandControl(),
        }),
      );

      const candidate = { ...waveBoundaryEntry(`invalid-authority-${label}`, frameContext(), [1, 3]), subsumes };
      expect(() => log.commit(candidate), label).toThrow();
      expect(log.diagnostics()).toMatchObject({ headRevision: 3, retainedEntries: 3 });
    }
  });

  it("refuses a hot-rejoin rebind that changes a stable session axis or rolls a generation back", () => {
    const log = makeLog(scheduler, sent, {
      localContext: frameContext({ membershipRevision: 7, connectionGeneration: 3 }),
      peerBindings: [{ seatId: 1, connectionGeneration: 5 }],
    });
    expect(() =>
      log.rebindConnection(frameContext({ runId: "other-run", membershipRevision: 8, connectionGeneration: 4 }), [
        { seatId: 1, connectionGeneration: 6 },
      ]),
    ).toThrow(/stable authenticated axis/u);
    expect(() =>
      log.rebindConnection(frameContext({ membershipRevision: 8, connectionGeneration: 2 }), [
        { seatId: 1, connectionGeneration: 6 },
      ]),
    ).toThrow(/stable authenticated axis/u);
    expect(() =>
      log.rebindConnection(frameContext({ membershipRevision: 8, connectionGeneration: 4 }), [
        { seatId: 1, connectionGeneration: 4 },
      ]),
    ).toThrow(/peer seat or rolled back/u);
  });

  it("hot-rejoin readdresses the exact deferred boundary while preserving its operation, revision, and material", () => {
    let prepareCalls = 0;
    const initialContext = frameContext({ membershipRevision: 7, connectionGeneration: 3 });
    const log = makeLog(scheduler, sent, {
      localContext: initialContext,
      peerBindings: [{ seatId: 1, connectionGeneration: 5 }],
    });
    const deferredDisposition = log.commitDetailed(
      waveBoundaryEntry("deferred-rejoin-boundary", initialContext),
      () => {
        prepareCalls += 1;
        return prepareCalls === 1 ? null : () => {};
      },
    );
    expect(deferredDisposition.kind).toBe("deferred");
    if (deferredDisposition.kind !== "deferred") {
      return;
    }
    const deferred = deferredDisposition.entry;

    expect(
      log.rebindConnection(frameContext({ membershipRevision: 8, connectionGeneration: 4 }), [
        { seatId: 1, connectionGeneration: 6 },
      ]),
    ).toBe(0);
    expect(log.retained()).toHaveLength(0);

    const retry = log.retryDeferredCommit(deferred.operationId);
    expect(retry.kind).toBe("committed");
    if (retry.kind !== "committed") {
      return;
    }
    expect(retry.entry).toMatchObject({
      kind: "WAVE_ADVANCE",
      operationId: deferred.operationId,
      revision: deferred.revision,
      context: {
        membershipRevision: 8,
        connectionGeneration: 4,
      },
    });
    expect(retry.entry.material).toEqual(deferred.material);
    expect(retry.entry.nextControl).toEqual(deferred.nextControl);
    expect(prepareCalls).toBe(2);
    expect(delivered(sent)).toEqual([retry.entry]);
  });

  it("keeps receipt, material, and control truth separate and retries only the unfinished stage", () => {
    const log = makeReplicaLog(scheduler, sent);
    const entry = fullEntry(1, "op-1", { nextControl: commandControl() });

    expect(log.admit(entry)).toEqual({ kind: "admitted" });
    expect(log.receivedThrough()).toBe(1);
    expect(log.appliedThrough()).toBe(0);
    expect(log.controlInstalledThrough()).toBe(0);

    // A failed material apply leaves the entry retryable instead of turning admission into a false green.
    expect(log.admit(entry)).toEqual({ kind: "duplicate-pending-material" });
    expect(log.appliedThrough()).toBe(0);
    expect(log.recordReplicaStage(entry, "materialApplied")).toBe(true);
    expect(log.appliedThrough()).toBe(1);
    expect(log.controlInstalledThrough()).toBe(0);

    // Material is not re-applied while only control remains unfinished.
    expect(log.admit(entry)).toEqual({ kind: "duplicate-pending-control" });
    expect(log.recordReplicaStage(entry, "controlInstalled")).toBe(true);
    expect(log.controlInstalledThrough()).toBe(1);

    // Once mechanically complete, redelivery only republishes proof.
    expect(log.admit(entry)).toEqual({ kind: "duplicate-complete" });
    expect(log.recordReplicaStage(entry, "materialApplied")).toBe(false);
  });

  it("a gap requests the tail via send (no local retry loop)", () => {
    const log = makeReplicaLog(scheduler, sent);
    const result = log.admit(fullEntry(3, "op-3"));

    expect(result).toEqual({ kind: "gap", missingFrom: 1 });
    const tails = sent.filter(w => w.kind === "requestTail");
    expect(tails).toHaveLength(1);
    expect(tails[0]).toMatchObject({ kind: "requestTail", missingFrom: 1 });
    // The replica arms NO timer of its own - the authority's redelivery is the only retry.
    expect(scheduler.liveCount()).toBe(0);
    expect(log.appliedThrough()).toBe(0);
  });

  it("admits an explicit CONTROL_COMMIT only from its ordered wait and closes on the stated command", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("interaction-result", {
        kind: "INTERACTION_COMMIT",
        nextControl: successorWait("interaction-result", ["CONTROL_COMMIT"]),
      }),
    );

    const opened = log.commit(
      entryInput("command-open", {
        kind: "CONTROL_COMMIT",
        nextControl: commandControl(),
      }),
    );
    expect(opened).toMatchObject({
      revision: 2,
      kind: "CONTROL_COMMIT",
      nextControl: { kind: "COMMAND_FRONTIER" },
    });

    expect(() =>
      log.commit(
        entryInput("unrelated-interaction", {
          kind: "INTERACTION_COMMIT",
          nextControl: successorWait("unrelated-interaction", ["CONTROL_COMMIT"]),
        }),
      ),
    ).toThrow(/not authorized by predecessor control/u);
  });

  it("rejects CONTROL_COMMIT when the predecessor wait did not explicitly permit it", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("interaction-result", {
        kind: "INTERACTION_COMMIT",
        nextControl: successorWait("interaction-result", ["WAVE_ADVANCE"]),
      }),
    );
    expect(() =>
      log.commit(
        entryInput("command-open", {
          kind: "CONTROL_COMMIT",
          nextControl: commandControl(),
        }),
      ),
    ).toThrow(/not authorized by predecessor control/u);
  });

  it("coalesces repeated later revisions into one tail request until the missing frontier completes", () => {
    const log = makeReplicaLog(scheduler, sent);

    // A full authority tail may replay several later retained entries while revision 1 is still missing.
    // Every one classifies as the same gap, but exactly one tail request may leave the replica.
    expect(log.admit(fullEntry(3, "op-3"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(log.admit(fullEntry(4, "op-4"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(log.admit(fullEntry(3, "op-3"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(sent.filter(wire => wire.kind === "requestTail")).toHaveLength(1);

    // Merely admitting the predecessor does not re-arm the request: a later entry is still a gap until the
    // predecessor's real material/control terminal stage completes.
    const first = fullEntry(1, "op-1");
    expect(log.admit(first)).toEqual({ kind: "admitted" });
    expect(log.admit(fullEntry(2, "op-2"))).toEqual({ kind: "gap", missingFrom: 1 });
    expect(sent.filter(wire => wire.kind === "requestTail")).toHaveLength(1);
    expect(log.recordReplicaStage(first, "materialApplied")).toBe(true);

    // A committed entry always has an explicit successor, so its frontier completes only after the exact
    // control-install proof. A new, genuinely different gap can then request from revision 2 once.
    expect(log.recordReplicaStage(first, "controlInstalled")).toBe(true);
    expect(log.admit(fullEntry(3, "op-3"))).toEqual({ kind: "gap", missingFrom: 2 });
    expect(log.admit(fullEntry(4, "op-4"))).toEqual({ kind: "gap", missingFrom: 2 });
    expect(
      sent
        .filter(wire => wire.kind === "requestTail")
        .map(wire => (wire.kind === "requestTail" ? wire.missingFrom : 0)),
    ).toEqual([1, 2]);
  });

  it("a stale epoch is rejected as staleEpoch; membership/session mismatch reject", () => {
    const log = new AuthorityLog({
      localContext: frameContext({ sessionEpoch: 2, membershipRevision: 5, senderSeatId: 1 }),
      scheduler,
      send: wire => sent.push(wire),
      peerBindings: [{ seatId: 0, connectionGeneration: frameContext().connectionGeneration }],
    });

    // Same session identity, older epoch generation -> staleEpoch (never rejected/duplicate).
    expect(
      log.admit(fullEntry(1, "op-1", { context: frameContext({ sessionEpoch: 1, membershipRevision: 5 }) })),
    ).toEqual({ kind: "staleEpoch" });

    // Right epoch, wrong membership generation -> rejected.
    expect(
      log.admit(fullEntry(1, "op-1", { context: frameContext({ sessionEpoch: 2, membershipRevision: 4 }) })).kind,
    ).toBe("rejected");

    // Different seat map (session identity) -> rejected, not staleEpoch.
    expect(
      log.admit(
        fullEntry(1, "op-1", { context: frameContext({ sessionEpoch: 2, membershipRevision: 5, seatMapId: "other" }) }),
      ).kind,
    ).toBe("rejected");

    // Right authority seat, stale authenticated channel generation -> rejected.
    expect(
      log.admit(
        fullEntry(1, "op-1", {
          context: frameContext({ sessionEpoch: 2, membershipRevision: 5, connectionGeneration: 0 }),
        }),
      ),
    ).toEqual({ kind: "rejected", reason: "authority-sender-mismatch" });

    // Nothing was applied through any rejection/stale path.
    expect(log.appliedThrough()).toBe(0);
  });

  it("supersession retires subsumed entries and cancels their timers", () => {
    const log = makeLog(scheduler, sent);
    const a = log.commit(entryInput("op-1")); // revision 1, no nextControl
    const b = log.commit(entryInput("op-2", { subsumes: [1] })); // revision 2 subsumes 1
    expect(a.revision).toBe(1);
    expect(b.revision).toBe(2);
    expect(log.retained().map(e => e.revision)).toEqual([1, 2]);
    expect(scheduler.ownerCount("authority-v2:session-A:seat0:deliver:1")).toBe(1);

    // b admitted -> supersession retires revision 1 (subsumed) and cancels its lease timers.
    log.acceptReceipt(receipt(b, "admitted"));
    expect(log.retained().map(e => e.revision)).toEqual([2]);
    expect(scheduler.ownerCount("authority-v2:session-A:seat0:deliver:1")).toBe(0);
    // b itself is only admitted (required = materialApplied since no nextControl), so its retry remains live.
    expect(log.diagnostics().activeDeliveryTimers).toBe(1);
  });

  it("rejects every successor after a terminal frontier", () => {
    const log = makeLog(scheduler, sent);
    const terminal = log.commit(
      entryInput("terminal-frontier", {
        kind: "TERMINAL_COMMIT",
        nextControl: { kind: "TERMINAL", terminalId: "terminal-frontier" },
      }),
    );

    expect(() => log.commit(entryInput("after-terminal"))).toThrow(/terminal frontier is final/u);
    expect(log.diagnostics()).toMatchObject({ headRevision: terminal.revision, retainedEntries: 1 });
    expect(log.retained().map(entry => entry.operationId)).toEqual([terminal.operationId]);
  });

  it("presentationSettled is NEVER required for retirement", () => {
    // Entry WITH a nextControl: required stage is controlInstalled - retire there, no presentationSettled.
    const withControl = makeLog(scheduler, sent);
    const a = withControl.commit(entryInput("op-1", { nextControl: commandControl() }));
    withControl.acceptReceipt(receipt(a, "admitted"));
    withControl.acceptReceipt(receipt(a, "materialApplied"));
    expect(withControl.acceptReceipt(receipt(a, "controlInstalled"))).toBe(true);
    expect(withControl.retained()).toHaveLength(0);

    // An explicit ordered wait is also a real installed control, but presentation proof is still irrelevant.
    const withOrderedWait = makeLog(scheduler, []);
    const b = withOrderedWait.commit(
      entryInput("op-2", { nextControl: successorWait("op-2", ["INTERACTION_COMMIT"]) }),
    );
    withOrderedWait.acceptReceipt(receipt(b, "admitted"));
    expect(withOrderedWait.acceptReceipt(receipt(b, "materialApplied"))).toBe(false);
    expect(withOrderedWait.acceptReceipt(receipt(b, "controlInstalled"))).toBe(true);
    expect(withOrderedWait.retained()).toHaveLength(0);
  });

  it("builds a contiguous recovery slice and retains the last stated control after retirement", () => {
    const log = makeLog(scheduler, sent);
    const first = log.commit(entryInput("op-recovery-1"));
    const second = log.commit(entryInput("op-recovery-2", { nextControl: commandControl() }));

    expect(log.recoverySlice(0)).toEqual({
      frontier: 2,
      frontierOperationId: "op-recovery-2",
      nextControl: commandControl(),
      requiredTail: [first, second],
    });
    expect(log.recoverySlice(1)).toEqual({
      frontier: 2,
      frontierOperationId: "op-recovery-2",
      nextControl: commandControl(),
      requiredTail: [second],
    });

    expect(log.acceptReceipt(receipt(first, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "controlInstalled"))).toBe(true);
    expect(log.acceptReceipt(receipt(second, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(second, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(second, "controlInstalled"))).toBe(true);
    expect(log.retained()).toHaveLength(0);
    expect(log.recoverySlice(2)).toEqual({
      frontier: 2,
      frontierOperationId: "op-recovery-2",
      nextControl: commandControl(),
      requiredTail: [second],
    });
  });

  it("allows only the immediate entry kind named by an authority successor wait", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("op-wait", {
        nextControl: successorWait("op-wait", ["INTERACTION_COMMIT"]),
      }),
    );

    expect(() => log.commit(entryInput("op-wrong", { kind: "WAVE_ADVANCE" }))).toThrow(
      /not authorized by predecessor control/,
    );
    const successor = log.commit(entryInput("op-right", { kind: "INTERACTION_COMMIT" }));
    expect(successor.revision).toBe(2);
  });

  it("closes the command -> TURN_RESOLVE prompt -> decision -> turn authority graph", () => {
    const promptOperationId = "turn-resolve-learn-prompt";
    const decisionOperationId = "turn-resolve-learn-decision";
    const interactionEntry = (
      operationId: string,
      payload: Readonly<Record<string, unknown>>,
      nextControl: CoopNextControl,
    ) => ({
      ...entryInput(operationId, { kind: "INTERACTION_COMMIT", nextControl }),
      material: {
        digest: `digest-${operationId}`,
        payload: {
          kind: "OPERATION_ENVELOPE_V1",
          surfaceClass: "op:learnMove",
          envelope: {
            sessionEpoch: 1,
            wave: 1,
            turn: 1,
            logicalPhase: "TURN_RESOLVE",
            pendingOperation: {
              id: operationId,
              kind: "LEARN_MOVE_BATCH",
              owner: 1,
              status: "applied",
              payload,
            },
          },
        },
      },
    });

    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("command-open-before-learn", {
        kind: "CONTROL_COMMIT",
        nextControl: commandControl(),
      }),
    );
    const prompt = log.commit(
      interactionEntry(
        promptOperationId,
        { type: "prompt" },
        {
          kind: "SHARED_INTERACTION",
          surfaceClass: "op:learnMove",
          operationId: promptOperationId,
          ownerSeatId: 1,
          epoch: 1,
          wave: 1,
          turn: 1,
          operationKind: "LEARN_MOVE_BATCH",
          successor: {
            operationKinds: ["LEARN_MOVE_BATCH"],
            operationIds: [decisionOperationId],
          },
        },
      ),
    );
    expect(prompt.revision).toBe(2);

    const decision = log.commit(
      interactionEntry(
        decisionOperationId,
        { type: "decision" },
        {
          kind: "AWAIT_SUCCESSOR",
          afterOperationId: decisionOperationId,
          epoch: 1,
          wave: 1,
          turn: 1,
          allowedKinds: ["TURN_COMMIT", "INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
          allowNextWaveStart: false,
          expectedOperationId: null,
        },
      ),
    );
    expect(decision.revision).toBe(3);
    expect(log.commit(entryInput("settled-turn-after-learn")).revision).toBe(4);
  });

  it("lets a settled TURN_RESOLVE decision reopen command control at the same turn only", () => {
    const commandOpen = (turn: number) => ({
      ...entryInput(`command-open-turn-${turn}`, {
        kind: "CONTROL_COMMIT" as const,
        nextControl: commandControl({ turn }),
      }),
      material: {
        digest: `command-open-turn-${turn}`,
        payload: {
          kind: "command-open",
          wave: 1,
          turn,
        },
      },
    });
    const decisionWait = (operationId: string) => ({
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: operationId,
      epoch: 1,
      wave: 1,
      turn: 1,
      allowedKinds: ["TURN_COMMIT", "INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"] as const,
      allowNextWaveStart: false,
      expectedOperationId: null,
    });

    const sameTurn = makeLog(scheduler, []);
    sameTurn.commit(
      entryInput("learn-decision-same-turn", {
        kind: "INTERACTION_COMMIT",
        nextControl: decisionWait("learn-decision-same-turn"),
      }),
    );
    expect(sameTurn.commit(commandOpen(1)).revision).toBe(2);

    const wrongTurn = makeLog(scheduler, []);
    wrongTurn.commit(
      entryInput("learn-decision-wrong-turn", {
        kind: "INTERACTION_COMMIT",
        nextControl: decisionWait("learn-decision-wrong-turn"),
      }),
    );
    expect(() => wrongTurn.commit(commandOpen(2))).toThrow(/not authorized by predecessor control/u);

    const ordinaryInteraction = makeLog(scheduler, []);
    ordinaryInteraction.commit(
      entryInput("ordinary-interaction", {
        kind: "INTERACTION_COMMIT",
        nextControl: successorWait("ordinary-interaction", [
          "INTERACTION_COMMIT",
          "CONTROL_COMMIT",
          "WAVE_ADVANCE",
          "TERMINAL_COMMIT",
        ]),
      }),
    );
    expect(() => ordinaryInteraction.commit(commandOpen(1))).toThrow(/not authorized by predecessor control/u);
    expect(ordinaryInteraction.commit(commandOpen(2)).revision).toBe(2);
  });

  it("does not let arbitrary interaction material interrupt command control", () => {
    const interactionAfterCommand = (
      operationId: string,
      logicalPhase: string,
      operationKind: string,
      payloadType: string,
      envelopeOperationId = operationId,
    ) => ({
      ...entryInput(operationId, { kind: "INTERACTION_COMMIT" }),
      material: {
        digest: `digest-${operationId}`,
        payload: {
          kind: "OPERATION_ENVELOPE_V1",
          surfaceClass: "op:learnMove",
          envelope: {
            sessionEpoch: 1,
            wave: 1,
            turn: 1,
            logicalPhase,
            pendingOperation: {
              id: envelopeOperationId,
              kind: operationKind,
              owner: 1,
              status: "applied",
              payload: { type: payloadType },
            },
          },
        },
      },
    });
    const rejected = [
      interactionAfterCommand("decision", "TURN_RESOLVE", "LEARN_MOVE", "decision"),
      interactionAfterCommand("normal-interaction", "INTERACTION", "LEARN_MOVE", "prompt"),
      interactionAfterCommand("reward-prompt", "TURN_RESOLVE", "REWARD", "prompt"),
      interactionAfterCommand("id-mismatch", "TURN_RESOLVE", "REVIVAL", "prompt", "different-id"),
    ];

    for (const entry of rejected) {
      const log = makeLog(scheduler, []);
      log.commit(
        entryInput(`command-before-${entry.operationId}`, {
          kind: "CONTROL_COMMIT",
          nextControl: commandControl(),
        }),
      );
      expect(() => log.commit(entry)).toThrow(/not authorized by predecessor control/);
    }
  });

  it("rejects a right-kind successor carrying the wrong live wave/turn coordinate", () => {
    const log = makeLog(scheduler, sent);
    log.commit(
      entryInput("op-coordinate-wait", {
        nextControl: successorWait("op-coordinate-wait", ["INTERACTION_COMMIT"]),
      }),
    );
    const wrongCoordinate = {
      ...entryInput("1:0:REWARD:1", { kind: "INTERACTION_COMMIT" }),
      material: {
        digest: "coordinate-digest",
        payload: {
          envelope: {
            sessionEpoch: 1,
            wave: 2,
            turn: 1,
          },
        },
      },
    };
    expect(() => log.commit(wrongCoordinate)).toThrow(/not authorized by predecessor control/);
  });

  it("admits an executable shared interaction result only at its exact operation and coordinate", () => {
    const operationId = "1:1:CROSSROADS_PICK:9600005";
    const control: Extract<CoopNextControl, { kind: "SHARED_INTERACTION" }> = {
      kind: "SHARED_INTERACTION",
      surfaceClass: "op:biome",
      operationId,
      ownerSeatId: 1,
      epoch: 1,
      wave: 5,
      turn: 2,
      operationKind: "CROSSROADS_PICK",
      successor: {
        operationKinds: ["CROSSROADS_PICK"],
        operationIds: [operationId],
      },
    };
    const open = {
      ...entryInput(`V2/CONTROL/INTERACTION/${operationId}`, {
        kind: "CONTROL_COMMIT",
        nextControl: control,
      }),
      material: {
        digest: "crossroads-open",
        payload: { wave: 5, turn: 2 },
      },
    };
    const result = (resultOperationId: string, turn: number) => ({
      ...entryInput(resultOperationId, {
        kind: "INTERACTION_COMMIT",
        nextControl: {
          kind: "AWAIT_SUCCESSOR" as const,
          afterOperationId: resultOperationId,
          epoch: 1,
          wave: 5,
          turn: 2,
          allowedKinds: ["CONTROL_COMMIT" as const],
          allowNextWaveStart: true,
          expectedOperationId: null,
        },
      }),
      material: {
        digest: `crossroads-result-${resultOperationId}-${turn}`,
        payload: {
          envelope: {
            sessionEpoch: 1,
            wave: 5,
            turn,
            pendingOperation: {
              id: resultOperationId,
              kind: "CROSSROADS_PICK",
            },
          },
        },
      },
    });

    const exact = makeLog(scheduler, sent);
    expect(exact.commit(open).revision).toBe(1);
    expect(exact.commit(result(operationId, 2)).revision).toBe(2);

    const wrongTurn = makeLog(scheduler, []);
    wrongTurn.commit(open);
    expect(() => wrongTurn.commit(result(operationId, 0))).toThrow(/not authorized by predecessor control/);

    const wrongOperation = makeLog(scheduler, []);
    wrongOperation.commit(open);
    expect(() => wrongOperation.commit(result(`${operationId}:stale`, 2))).toThrow(
      /not authorized by predecessor control/,
    );
  });

  it("admits exactly wave N+1 turn 1 only when the predecessor explicitly authorizes that crossing", () => {
    const nextWaveCommand = {
      ...entryInput("wave-2-command", { kind: "CONTROL_COMMIT" }),
      material: { digest: "wave-2-command", payload: { wave: 2, turn: 1 } },
    };

    const closed = makeLog(scheduler, []);
    closed.commit(
      entryInput("reward-result-closed", {
        nextControl: successorWait("reward-result-closed", ["CONTROL_COMMIT"]),
      }),
    );
    expect(() => closed.commit(nextWaveCommand)).toThrow(/not authorized by predecessor control/);

    const open = makeLog(scheduler, []);
    open.commit(
      entryInput("reward-result-open", {
        nextControl: successorWait("reward-result-open", ["CONTROL_COMMIT"], true),
      }),
    );
    expect(open.commit(nextWaveCommand).revision).toBe(2);

    const tooFar = makeLog(scheduler, []);
    tooFar.commit(
      entryInput("reward-result-too-far", {
        nextControl: successorWait("reward-result-too-far", ["CONTROL_COMMIT"], true),
      }),
    );
    expect(() =>
      tooFar.commit({
        ...nextWaveCommand,
        operationId: "wave-2-command-turn-2",
        material: { digest: "wave-2-command-turn-2", payload: { wave: 2, turn: 2 } },
      }),
    ).toThrow(/not authorized by predecessor control/);
  });

  it("admits only an explicitly authorized next-wave pre-turn interaction at turn 0", () => {
    const nextWaveMysteryPresentation = {
      ...entryInput("wave-2-mystery-present", { kind: "INTERACTION_COMMIT" }),
      material: {
        digest: "wave-2-mystery-present",
        payload: {
          envelope: {
            sessionEpoch: 1,
            wave: 2,
            turn: 0,
            pendingOperation: { kind: "ME_PRESENT" },
          },
        },
      },
    };

    const closed = makeLog(scheduler, []);
    closed.commit(
      entryInput("reward-result-closed-to-mystery", {
        nextControl: successorWait("reward-result-closed-to-mystery", [
          "INTERACTION_COMMIT",
          "CONTROL_COMMIT",
          "WAVE_ADVANCE",
          "TERMINAL_COMMIT",
        ]),
      }),
    );
    expect(() => closed.commit(nextWaveMysteryPresentation)).toThrow(/not authorized by predecessor control/);

    const open = makeLog(scheduler, []);
    open.commit(
      entryInput("reward-result-open-to-mystery", {
        nextControl: successorWait(
          "reward-result-open-to-mystery",
          ["INTERACTION_COMMIT", "CONTROL_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"],
          true,
        ),
      }),
    );
    expect(open.commit(nextWaveMysteryPresentation).revision).toBe(2);

    const wrongPreTurnInteraction = makeLog(scheduler, []);
    wrongPreTurnInteraction.commit(
      entryInput("reward-result-before-invalid-reward", {
        nextControl: successorWait("reward-result-before-invalid-reward", ["INTERACTION_COMMIT"], true),
      }),
    );
    expect(() =>
      wrongPreTurnInteraction.commit({
        ...nextWaveMysteryPresentation,
        operationId: "wave-2-reward-turn-0",
        material: {
          digest: "wave-2-reward-turn-0",
          payload: {
            envelope: {
              sessionEpoch: 1,
              wave: 2,
              turn: 0,
              pendingOperation: { kind: "REWARD_PRESENT" },
            },
          },
        },
      }),
    ).toThrow(/not authorized by predecessor control/);

    const commandAtTurnZero = makeLog(scheduler, []);
    commandAtTurnZero.commit(
      entryInput("reward-result-before-invalid-command", {
        nextControl: successorWait("reward-result-before-invalid-command", ["CONTROL_COMMIT"], true),
      }),
    );
    expect(() =>
      commandAtTurnZero.commit({
        ...entryInput("wave-2-command-turn-0", { kind: "CONTROL_COMMIT" }),
        material: { digest: "wave-2-command-turn-0", payload: { wave: 2, turn: 0 } },
      }),
    ).toThrow(/not authorized by predecessor control/);
  });

  it("admits only the bounded settlement-turn advance from an exact turn-boundary wait", () => {
    const turnBoundaryKinds = [
      "CONTROL_COMMIT",
      "REPLACEMENT_COMMIT",
      "INTERACTION_COMMIT",
      "WAVE_ADVANCE",
      "TERMINAL_COMMIT",
    ] as const;
    const settlementEntry = (operationId: string, kind: "WAVE_ADVANCE" | "TERMINAL_COMMIT", turn: number) => ({
      ...entryInput(operationId, {
        kind,
        nextControl:
          kind === "TERMINAL_COMMIT"
            ? { kind: "TERMINAL" as const, terminalId: operationId }
            : successorWait(operationId, ["CONTROL_COMMIT"]),
      }),
      material: {
        digest: `digest-${operationId}`,
        payload: { wave: 1, turn },
      },
    });

    for (const kind of ["WAVE_ADVANCE", "TERMINAL_COMMIT"] as const) {
      const log = makeLog(scheduler, []);
      log.commit(
        entryInput(`turn-before-${kind}`, {
          nextControl: successorWait(`turn-before-${kind}`, turnBoundaryKinds),
        }),
      );
      expect(log.commit(settlementEntry(`settled-${kind}`, kind, 2)).revision).toBe(2);
    }

    const driftLog = makeLog(scheduler, []);
    driftLog.commit(
      entryInput("turn-before-drift", {
        nextControl: successorWait("turn-before-drift", turnBoundaryKinds),
      }),
    );
    expect(() => driftLog.commit(settlementEntry("settled-too-late", "WAVE_ADVANCE", 3))).toThrow(
      /not authorized by predecessor control/,
    );

    const narrowLog = makeLog(scheduler, []);
    narrowLog.commit(
      entryInput("interaction-before-wave", {
        nextControl: successorWait("interaction-before-wave", ["WAVE_ADVANCE"]),
      }),
    );
    expect(() => narrowLog.commit(settlementEntry("narrow-next-turn", "WAVE_ADVANCE", 2))).toThrow(
      /not authorized by predecessor control/,
    );
    expect(narrowLog.commit(settlementEntry("narrow-same-turn", "WAVE_ADVANCE", 1)).revision).toBe(2);
  });

  it("admits the deferred automatic-victory advance from a replacement terminal successor wait", () => {
    // A guest faint-replacement whose wave is WON the SAME turn defers its WAVE_ADVANCE to the settlement
    // turn N+1 (browser journey 29846903494: "automatic victory settlement deferred sourceTurn=1
    // settlementTurn=2"). The replacement terminal wait grants this one documented WAVE_ADVANCE edge at
    // turn N or N+1; unrelated successor kinds and arbitrary N+2 drift remain fail-closed.
    const terminalReplacementKinds = ["INTERACTION_COMMIT", "WAVE_ADVANCE", "TERMINAL_COMMIT"] as const;
    const settlement = (operationId: string, turn: number) => ({
      ...entryInput(operationId, {
        kind: "WAVE_ADVANCE" as const,
        nextControl: successorWait(operationId, ["CONTROL_COMMIT"]),
      }),
      material: { digest: `digest-${operationId}`, payload: { wave: 1, turn } },
    });

    const log = makeLog(scheduler, []);
    log.commit(
      entryInput("replacement-terminal", {
        kind: "REPLACEMENT_COMMIT",
        nextControl: successorWait("replacement-terminal", terminalReplacementKinds),
      }),
    );
    expect(
      log.commit(settlement("deferred-victory", 2)).revision,
      "the deferred settlement-turn victory is authorized by the replacement terminal boundary",
    ).toBe(2);

    // A DRIFTED advance (turn N+2) still fails closed.
    const driftLog = makeLog(scheduler, []);
    driftLog.commit(
      entryInput("replacement-terminal-drift", {
        kind: "REPLACEMENT_COMMIT",
        nextControl: successorWait("replacement-terminal-drift", terminalReplacementKinds),
      }),
    );
    expect(() => driftLog.commit(settlement("drift-too-late", 3))).toThrow(/not authorized by predecessor control/u);
  });

  it("keeps a replica successor wait until an exact allowed next revision is admitted", () => {
    const log = makeReplicaLog(scheduler, sent);
    const predecessor = fullEntry(1, "op-wait", {
      nextControl: successorWait("op-wait", ["INTERACTION_COMMIT"]),
    });
    expect(log.admit(predecessor)).toEqual({ kind: "admitted" });
    expect(log.recordReplicaStage(predecessor, "materialApplied")).toBe(true);
    expect(log.recordReplicaStage(predecessor, "controlInstalled")).toBe(true);

    expect(log.admit(fullEntry(2, "op-wrong", { kind: "WAVE_ADVANCE" }))).toEqual({
      kind: "rejected",
      reason: "predecessor-control-mismatch",
    });
    expect(log.receivedThrough()).toBe(1);
    expect(log.admit(fullEntry(2, "op-right", { kind: "INTERACTION_COMMIT" }))).toEqual({ kind: "admitted" });
  });

  it("reconstructs an exact successor wait from an empty-tail recovery frontier", () => {
    const log = makeReplicaLog(scheduler, sent);
    log.adoptFrontier(7, {
      operationId: "op-frontier",
      nextControl: successorWait("op-frontier", ["WAVE_ADVANCE"]),
    });

    expect(log.admit(fullEntry(8, "op-wrong", { kind: "TURN_COMMIT" }))).toEqual({
      kind: "rejected",
      reason: "predecessor-control-mismatch",
    });
    expect(log.admit(fullEntry(8, "op-wave", { kind: "WAVE_ADVANCE" }))).toEqual({ kind: "admitted" });
  });

  it("keeps a recovered frontier control-pending until the exact ordinary stage proof", () => {
    const log = makeReplicaLog(scheduler, sent);
    const recovered = fullEntry(7, "op-recovered", {
      nextControl: successorWait("op-recovered", ["WAVE_ADVANCE"]),
    });

    // Even an equal frontier must reopen control: recovery destroyed the old phase generation.
    log.adoptFrontier(7, { operationId: recovered.operationId, nextControl: recovered.nextControl });
    expect(log.stageRecoveredFrontier(recovered)).toBe(true);
    expect(log.receivedThrough()).toBe(7);
    expect(log.appliedThrough()).toBe(7);
    expect(log.controlInstalledThrough()).toBe(6);
    expect(log.admit(fullEntry(8, "op-too-early", { kind: "WAVE_ADVANCE" }))).toEqual({
      kind: "gap",
      missingFrom: 7,
    });

    expect(log.recordReplicaStage(recovered, "controlInstalled")).toBe(true);
    expect(log.controlInstalledThrough()).toBe(7);
    expect(log.admit(fullEntry(8, "op-wave", { kind: "WAVE_ADVANCE" }))).toEqual({ kind: "admitted" });
  });

  it("refuses a recovery slice with an impossible hole or a frontier ahead of authority", () => {
    const log = makeLog(scheduler, sent);
    const first = log.commit(entryInput("op-recovery-hole-1"));
    log.commit(entryInput("op-recovery-hole-2"));
    expect(log.acceptReceipt(receipt(first, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "controlInstalled"))).toBe(true);

    // A real replica that still reported frontier 0 could not have retired revision 1. Refuse the
    // contradictory request rather than returning revision 2 as if it were a complete tail.
    expect(log.recoverySlice(0)).toBeNull();
    expect(log.recoverySlice(3)).toBeNull();
    expect(log.recoverySlice(-1)).toBeNull();
  });

  it("dispose leaves zero timers and zero leases", () => {
    const log = makeLog(scheduler, sent);
    log.commit(entryInput("op-1", { nextControl: commandControl() }));
    log.commit(entryInput("op-2", { nextControl: commandControl() }));
    log.commit(entryInput("op-3"));
    expect(log.diagnostics().retainedEntries).toBe(3);
    expect(scheduler.liveCount()).toBe(3);

    log.dispose("teardown");
    const diag = log.diagnostics();
    expect(diag.retainedEntries).toBe(0);
    expect(diag.deliveryLeases).toBe(0);
    expect(diag.activeDeliveryTimers).toBe(0);
    expect(diag.disposed).toBe(true);
    expect(scheduler.liveCount()).toBe(0);
  });

  it("refuses capacity overflow without evicting truth or burning a revision", () => {
    const log = makeLog(scheduler, sent, { retainCapacity: 2 });
    const first = log.commit(entryInput("op-1"));
    const second = log.commit(entryInput("op-2"));

    expect(() => log.commit(entryInput("op-refused"))).toThrow(AuthorityRetentionOverflowError);
    expect(log.retained().map(entry => entry.revision)).toEqual([1, 2]);
    expect(log.diagnostics()).toMatchObject({
      headRevision: 2,
      retainedEntries: 2,
      retentionCapacity: 2,
      retentionRefusals: 1,
    });
    expect(scheduler.liveCount()).toBe(2);

    // Once exact proof retires the oldest truth, the next real commit receives revision 3. The refused
    // attempt never existed and therefore cannot create a gap at the replica.
    expect(log.acceptReceipt(receipt(first, "admitted"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "materialApplied"))).toBe(false);
    expect(log.acceptReceipt(receipt(first, "controlInstalled"))).toBe(true);
    const third = log.commit(entryInput("op-3"));
    expect(third.revision).toBe(3);
    expect(log.retained().map(entry => entry.revision)).toEqual([second.revision, third.revision]);
  });

  it("refuses a boundary whose live retained proof exceeds the ledger bound without evicting sources", () => {
    const controlLedger = new CoopV2InteractionControlLedger(2);
    const log = makeLog(scheduler, sent, { retainCapacity: 4 });
    const sources = [1, 2, 3].map(revision =>
      log.commit(entryInput(`live-proof-${revision}`, { kind: "TURN_COMMIT", nextControl: commandControl() })),
    );
    const predecessor = sources.at(-1);
    if (predecessor == null) {
      throw new Error("bounded live-proof fixture has no predecessor");
    }
    expect(
      controlLedger.adoptRecoveryControl(
        predecessor.revision,
        predecessor.operationId,
        predecessor.nextControl,
        predecessor,
      ),
    ).toBe(true);
    expect(
      controlLedger.projectMechanical(predecessor.nextControl, () => ({
        kind: "installed",
        controlId: controlIdOf(predecessor.nextControl),
      })),
    ).toMatchObject({ kind: "installed" });
    const activeBeforeRefusal = controlLedger.activeControl;

    const refused = log.commitDetailed(
      waveBoundaryEntry("live-proof-overflow-boundary", frameContext(), [1, 2, 3]),
      entry => controlLedger.prepareAuthorityEntry(entry),
    );
    expect(refused).toMatchObject({ kind: "deferred", reason: "predecessor-control-not-installed" });
    expect(log.retained().map(entry => entry.revision)).toEqual([1, 2, 3]);
    expect(log.diagnostics()).toMatchObject({ headRevision: 3, retainedEntries: 3 });
    expect(controlLedger.authenticatedSourceCount).toBe(1);
    expect(controlLedger.activeControl).toEqual(activeBeforeRefusal);
    expect(controlLedger.sourceEntryOf(predecessor.nextControl)).toMatchObject({
      revision: predecessor.revision,
      operationId: predecessor.operationId,
    });
    expect(delivered(sent).map(entry => entry.operationId)).toEqual(["live-proof-1", "live-proof-2", "live-proof-3"]);
  });

  it("prunes exact subsumed source proof while retaining the new wave or terminal boundary source", () => {
    for (const boundaryKind of ["wave", "terminal"] as const) {
      const localScheduler = new FakeScheduler();
      const localSent: CoopAuthorityWire[] = [];
      const controlLedger = new CoopV2InteractionControlLedger();
      const log = makeLog(localScheduler, localSent);
      const prepare = reserveAndInstallMechanicalControl(controlLedger);
      for (const revision of [1, 2, 3]) {
        log.commit(
          entryInput(`source-${boundaryKind}-${revision}`, {
            kind: "TURN_COMMIT",
            nextControl: commandControl(),
          }),
          prepare,
        );
      }

      const boundaryInput =
        boundaryKind === "wave"
          ? waveBoundaryEntry("source-pruned-wave", frameContext(), [1, 2, 3])
          : terminalBoundaryEntry("source-pruned-terminal", frameContext(), [1, 2, 3]);
      const boundary = log.commit(boundaryInput, prepare);

      expect(controlLedger.authenticatedSourceCount).toBe(1);
      expect(controlLedger.sourceEntryOf(commandControl())).toBeNull();
      expect(controlLedger.sourceEntryOf(boundary.nextControl)).toMatchObject({
        revision: boundary.revision,
        operationId: boundary.operationId,
      });
      expect(log.retained().map(entry => entry.revision)).toEqual([1, 2, 3, 4]);
    }
  });

  it("reconciles the authority source archive to current retention across more than 512 retired commits", () => {
    const controlLedger = new CoopV2InteractionControlLedger();
    const log = makeLog(scheduler, sent);
    const prepare = reserveAndInstallMechanicalControl(controlLedger);

    for (let revision = 1; revision <= 520; revision++) {
      const committed = log.commit(
        entryInput(`ordinary-retired-${revision}`, {
          kind: "TURN_COMMIT",
          nextControl: commandControl(),
        }),
        prepare,
      );
      expect(log.acceptReceipt(receipt(committed, "admitted"))).toBe(false);
      expect(log.acceptReceipt(receipt(committed, "materialApplied"))).toBe(false);
      expect(log.acceptReceipt(receipt(committed, "controlInstalled"))).toBe(true);
    }

    expect(log.diagnostics()).toMatchObject({
      headRevision: 520,
      retainedEntries: 0,
      activeDeliveryTimers: 0,
    });
    expect(controlLedger.authenticatedSourceCount).toBe(1);
    expect(scheduler.liveCount()).toBe(0);
  });

  it("defers a refused authority-local reservation without burning a revision or publishing", () => {
    const log = makeLog(scheduler, sent);
    const prepared: number[] = [];
    let reservationReady = false;
    const reserve = (entry: CoopAuthorityEntry): (() => void) | null => {
      prepared.push(entry.revision);
      return reservationReady ? () => {} : null;
    };

    const deferred = log.commitDetailed(entryInput("op-refused-local"), reserve);
    expect(deferred).toMatchObject({
      kind: "deferred",
      reason: "predecessor-control-not-installed",
    });
    if (deferred.kind !== "deferred") {
      return;
    }
    expect(deferred.entry.revision).toBe(1);
    expect(prepared).toEqual([1]);
    expect(delivered(sent)).toEqual([]);
    expect(log.retained()).toEqual([]);
    expect(log.diagnostics()).toMatchObject({
      headRevision: 0,
      retainedEntries: 0,
      activeDeliveryTimers: 0,
    });

    reservationReady = true;
    const committed = log.retryDeferredCommit(deferred.entry.operationId);
    expect(committed.kind).toBe("committed");
    if (committed.kind !== "committed") {
      return;
    }
    expect(committed.entry.revision).toBe(1);
    expect(prepared).toEqual([1, 1]);
    expect(delivered(sent).map(entry => entry.operationId)).toEqual(["op-refused-local"]);
  });

  it("keeps a committed entry retryable when the carrier throws synchronously", () => {
    let attempts = 0;
    const log = makeLog(scheduler, [], {
      send: () => {
        attempts += 1;
        throw new Error("carrier unavailable");
      },
    });

    const committed = log.commit(entryInput("op-send-fault"));
    expect(committed.revision).toBe(1);
    expect(attempts).toBe(1);
    expect(log.retained()).toHaveLength(1);
    expect(log.diagnostics()).toMatchObject({ activeDeliveryTimers: 1, wireSendFailures: 1 });

    scheduler.fireAll();
    expect(attempts).toBeGreaterThan(1);
    expect(log.retained()).toHaveLength(1);
    expect(log.diagnostics().activeDeliveryTimers).toBe(1);
  });

  it("emits one delivery-exhaustion disposition while retaining an inert entry without an orphan timer", () => {
    const exhausted: AuthorityDeliveryExhaustion[] = [];
    const log = makeLog(scheduler, sent, {
      maxDeliveryAttempts: 2,
      onDeliveryExhausted: disposition => exhausted.push(disposition),
    });
    const committed = log.commit(entryInput("op-exhausted"));

    scheduler.fireAll();
    scheduler.fireAll();
    expect(exhausted).toHaveLength(1);
    expect(exhausted[0]).toMatchObject({
      kind: "delivery-exhausted",
      reason: "max-delivery-attempts",
      revision: committed.revision,
      operationId: committed.operationId,
      attempts: 2,
      maxAttempts: 2,
      entry: committed,
    });
    expect(log.retained()).toEqual([committed]);
    expect(log.diagnostics()).toMatchObject({
      retainedEntries: 1,
      deliveryLeases: 1,
      activeDeliveryTimers: 0,
      deliveryExhaustions: 1,
      exhaustedRevisions: [committed.revision],
    });
    expect(scheduler.liveCount()).toBe(0);

    scheduler.fireAll();
    expect(exhausted).toHaveLength(1);
    expect(delivered(sent)).toHaveLength(3);
  });

  it("retention immutability: mutating the committed return cannot rewrite the delivered/retained entry", () => {
    const log = makeLog(scheduler, sent);
    const committed = log.commit(entryInput("op-1"));
    // The committed entry is frozen; a mutation attempt is a no-op (silent in sloppy mode, throws in strict).
    expect(Object.isFrozen(committed)).toBe(true);
    expect(() => {
      (committed as { operationId: string }).operationId = "tampered";
    }).toThrow();
    expect(log.retained()[0].operationId).toBe("op-1");
    expect(delivered(sent)[0].operationId).toBe("op-1");
  });

  it("retention immutability: nested successor addresses never alias or freeze caller-owned input", () => {
    const log = makeLog(scheduler, sent);
    const address = { materialKind: "command-open" as const, wave: 1, turn: 1, operationId: null };
    const allowedControlAddresses = [address];
    const nextControl: CoopNextControl = {
      kind: "AWAIT_SUCCESSOR",
      afterOperationId: "op-nested-control",
      epoch: 1,
      wave: 1,
      turn: 1,
      allowedKinds: ["CONTROL_COMMIT"],
      allowNextWaveStart: false,
      expectedOperationId: null,
      allowedControlAddresses,
    };

    log.commit(entryInput("op-nested-control", { nextControl }));

    expect(Object.isFrozen(allowedControlAddresses)).toBe(false);
    expect(Object.isFrozen(address)).toBe(false);
    address.turn = 2;
    const retainedControl = log.retained()[0].nextControl;
    expect(retainedControl?.kind).toBe("AWAIT_SUCCESSOR");
    if (retainedControl?.kind === "AWAIT_SUCCESSOR") {
      expect(retainedControl.allowedControlAddresses?.[0]?.turn).toBe(1);
    }
  });
});
