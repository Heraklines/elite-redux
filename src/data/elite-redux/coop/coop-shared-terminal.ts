/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopMembershipSnapshotV2 } from "#data/elite-redux/coop/coop-membership";
import { CoopAckQuorumTracker } from "#data/elite-redux/coop/coop-membership";
import type { CoopFrameContextV1 } from "#data/elite-redux/coop/coop-session-binding";
import type {
  CoopMessage,
  CoopSharedTerminalBoundary,
  CoopSharedTerminalCommitV1,
  CoopSharedTerminalReasonCode,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";

type SharedTerminalMessage = Extract<CoopMessage, { t: "sharedTerminal" }>;
type SharedTerminalAck = Extract<CoopMessage, { t: "sharedTerminalAck" }>;

const DEFAULT_RETRY_MS = 250;
const DEFAULT_DEADLINE_MS = 3_000;
const DEFAULT_RECEIVER_GRACE_MS = 3_500;
const MAX_REASON_LENGTH = 512;
const MAX_TERMINAL_ID_LENGTH = 1_024;

export interface CoopSharedTerminalStart {
  boundary: CoopSharedTerminalBoundary;
  reasonCode: CoopSharedTerminalReasonCode;
  reason: string;
  wave: number;
  turn: number;
  /** Revision of the material/control boundary that could not continue. */
  boundaryRevision: number;
}

export type CoopSharedTerminalCompletion = "quorum" | "deadline" | "receiver-grace" | "disposed";

export interface CoopSharedTerminalResult {
  commit: CoopSharedTerminalCommitV1;
  completion: CoopSharedTerminalCompletion;
  quorumReached: boolean;
}

export type CoopSharedTerminalTraceStage =
  | "started"
  | "received"
  | "prepared"
  | "resent"
  | "ack-sent"
  | "ack-accepted"
  | "rejected"
  | "superseded"
  | "finalized";

export interface CoopSharedTerminalTraceEvent {
  stage: CoopSharedTerminalTraceStage;
  terminalId?: string | undefined;
  detail?: string | undefined;
}

export interface CoopSharedTerminalHooks {
  /** Current authenticated channel context. Membership revision is rebound to the frozen target on send. */
  localContext(): CoopFrameContextV1 | null;
  /** Current membership, including a hot-rejoined seat's latest connection generation. */
  membership(): CoopMembershipSnapshotV2;
  /**
   * Authenticate the peer frame. `targetMembershipRevision` is intentionally frozen and can be older than
   * the live membership after hot rejoin; connection generation must still be current.
   */
  validatePeerContext(context: CoopFrameContextV1, targetMembershipRevision: number): boolean;
  /** Freeze gameplay and release gameplay waits, but keep the transport alive for the terminal handshake. */
  onPrepare(commit: CoopSharedTerminalCommitV1): boolean;
  /** Perform final UI/runtime teardown. Called exactly once after quorum or a bounded deadline. */
  onFinalize(commit: CoopSharedTerminalCommitV1, completion: CoopSharedTerminalCompletion): void;
  onTrace?(event: CoopSharedTerminalTraceEvent): void;
  schedule?(callback: () => void, ms: number): () => void;
  retryMs?: number;
  deadlineMs?: number;
  receiverGraceMs?: number;
}

interface ActiveTerminal {
  commit: CoopSharedTerminalCommitV1;
  source: "local" | "remote";
  tracker: CoopAckQuorumTracker | null;
  cancelRetry: () => void;
  cancelDeadline: () => void;
}

function defaultSchedule(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms);
  return () => clearTimeout(timer);
}

function isSafeNonNegative(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSafePositive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isBoundedText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return (
    typeof value === "string"
    && (allowEmpty || value.length > 0)
    && value.length <= maxLength
    && ![...value].some(character => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

function validSortedSeats(seats: readonly number[]): boolean {
  return (
    seats.length >= 2
    && seats.every((seatId, index) => isSafeNonNegative(seatId) && (index === 0 || seatId > seats[index - 1]))
  );
}

function validFrameShape(context: CoopFrameContextV1): boolean {
  return (
    isBoundedText(context.sessionId, 256)
    && isSafeNonNegative(context.sessionEpoch)
    && isBoundedText(context.seatMapId, 256)
    && isSafePositive(context.membershipRevision)
    && isSafeNonNegative(context.fromSeatId)
    && isSafeNonNegative(context.connectionGeneration)
  );
}

function terminalIdFor(sessionId: string, commit: Omit<CoopSharedTerminalCommitV1, "terminalId">): string {
  return (
    `terminal:v1:${encodeURIComponent(sessionId)}`
    + `:e${commit.epoch}:m${commit.quorum.membershipRevision}`
    + `:w${commit.wave}:t${commit.turn}:b${commit.boundaryRevision}`
    + `:s${commit.originSeatId}:r${commit.terminalRevision}`
  );
}

function compareTerminalPriority(left: CoopSharedTerminalCommitV1, right: CoopSharedTerminalCommitV1): number {
  if (left.originSeatId !== right.originSeatId) {
    return left.originSeatId - right.originSeatId;
  }
  if (left.terminalRevision !== right.terminalRevision) {
    return left.terminalRevision - right.terminalRevision;
  }
  return left.terminalId.localeCompare(right.terminalId);
}

function validCommitShape(commit: CoopSharedTerminalCommitV1, context: CoopFrameContextV1): boolean {
  if (
    commit.version !== 1
    || !isBoundedText(commit.terminalId, MAX_TERMINAL_ID_LENGTH)
    || !isSafePositive(commit.terminalRevision)
    || !isSafeNonNegative(commit.originSeatId)
    || !isSafeNonNegative(commit.epoch)
    || !isSafeNonNegative(commit.wave)
    || !isSafeNonNegative(commit.turn)
    || !isSafeNonNegative(commit.boundaryRevision)
    || !(<readonly CoopSharedTerminalBoundary[]>[
      "authority",
      "recovery",
      "protocol",
      "persistence",
      "surface",
      "disconnect",
    ]).includes(commit.boundary)
    || !(<readonly CoopSharedTerminalReasonCode[]>[
      "capture-failed",
      "apply-failed",
      "recovery-exhausted",
      "peer-lost",
      "binding-mismatch",
      "persistence-failed",
      "continuation-failed",
      "invalid-authority",
    ]).includes(commit.reasonCode)
    || !isBoundedText(commit.reason, MAX_REASON_LENGTH)
    || commit.quorum?.version !== 1
    || !isSafePositive(commit.quorum.membershipRevision)
    || commit.quorum.membershipRevision !== context.membershipRevision
    || !validSortedSeats(commit.quorum.requiredAckSeats)
    || commit.epoch !== context.sessionEpoch
    || commit.originSeatId !== context.fromSeatId
    || !commit.quorum.requiredAckSeats.includes(commit.originSeatId)
  ) {
    return false;
  }
  const { terminalId: _terminalId, ...withoutId } = commit;
  return commit.terminalId === terminalIdFor(context.sessionId, withoutId);
}

/**
 * Runtime-scoped P33 terminal supervisor. It is deliberately engine-free: callers freeze gameplay in
 * `onPrepare`, while this class owns addressing, retention, exact ACK validation, simultaneous-failure
 * arbitration, bounded retry, and exactly-once finalization.
 */
export class CoopSharedTerminalSupervisor {
  private readonly transport: CoopTransport;
  private readonly hooks: CoopSharedTerminalHooks;
  private readonly schedule: (callback: () => void, ms: number) => () => void;
  private readonly retryMs: number;
  private readonly deadlineMs: number;
  private readonly receiverGraceMs: number;
  private readonly offMessage: () => void;
  private readonly offState: () => void;
  private active: ActiveTerminal | null = null;
  private terminalRevision = 0;
  private prepared = false;
  private prepareSucceeded = false;
  private finalized = false;
  private disposed = false;
  private resultPromise: Promise<CoopSharedTerminalResult> | null = null;
  private resolveResult: ((result: CoopSharedTerminalResult) => void) | null = null;

  constructor(transport: CoopTransport, hooks: CoopSharedTerminalHooks) {
    this.transport = transport;
    this.hooks = hooks;
    this.schedule = hooks.schedule ?? defaultSchedule;
    this.retryMs = hooks.retryMs ?? DEFAULT_RETRY_MS;
    this.deadlineMs = hooks.deadlineMs ?? DEFAULT_DEADLINE_MS;
    this.receiverGraceMs = hooks.receiverGraceMs ?? DEFAULT_RECEIVER_GRACE_MS;
    if (
      !isSafePositive(this.retryMs)
      || !isSafePositive(this.deadlineMs)
      || !isSafePositive(this.receiverGraceMs)
      || this.retryMs >= this.deadlineMs
      || this.receiverGraceMs < this.deadlineMs
    ) {
      throw new Error("invalid shared-terminal timing configuration");
    }
    this.offMessage = transport.onMessage(message => this.onMessage(message));
    this.offState = transport.onStateChange(state => {
      if (state !== "connected" || this.active == null || this.finalized) {
        return;
      }
      this.reassertActive(this.active);
    });
  }

  begin(start: CoopSharedTerminalStart): Promise<CoopSharedTerminalResult> {
    if (this.disposed) {
      return Promise.reject(new Error("shared-terminal supervisor is disposed"));
    }
    if (this.resultPromise != null) {
      return this.resultPromise;
    }
    const context = this.hooks.localContext();
    const membership = this.hooks.membership();
    if (context == null || !validFrameShape(context) || !this.validLocalContext(context, membership)) {
      return Promise.reject(new Error("cannot address shared terminal without a valid bound local seat"));
    }
    if (
      !(<readonly CoopSharedTerminalBoundary[]>[
        "authority",
        "recovery",
        "protocol",
        "persistence",
        "surface",
        "disconnect",
      ]).includes(start.boundary)
      || !(<readonly CoopSharedTerminalReasonCode[]>[
        "capture-failed",
        "apply-failed",
        "recovery-exhausted",
        "peer-lost",
        "binding-mismatch",
        "persistence-failed",
        "continuation-failed",
        "invalid-authority",
      ]).includes(start.reasonCode)
      || !isBoundedText(start.reason, MAX_REASON_LENGTH)
      || !isSafeNonNegative(start.wave)
      || !isSafeNonNegative(start.turn)
      || !isSafeNonNegative(start.boundaryRevision)
      || !validSortedSeats(membership.requiredAckSeats)
    ) {
      return Promise.reject(new Error("invalid shared-terminal start"));
    }
    const terminalRevision = ++this.terminalRevision;
    const withoutId: Omit<CoopSharedTerminalCommitV1, "terminalId"> = {
      version: 1,
      terminalRevision,
      originSeatId: context.fromSeatId,
      epoch: context.sessionEpoch,
      wave: start.wave,
      turn: start.turn,
      boundaryRevision: start.boundaryRevision,
      boundary: start.boundary,
      reasonCode: start.reasonCode,
      reason: start.reason,
      quorum: {
        version: 1,
        membershipRevision: membership.revision,
        requiredAckSeats: [...membership.requiredAckSeats],
      },
    };
    const commit: CoopSharedTerminalCommitV1 = {
      ...withoutId,
      terminalId: terminalIdFor(context.sessionId, withoutId),
    };
    this.ensureResultPromise();
    this.trace({ stage: "started", terminalId: commit.terminalId });
    this.activateLocal(commit, membership);
    return this.resultPromise!;
  }

  current(): CoopSharedTerminalCommitV1 | null {
    return this.active?.commit ?? null;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.offMessage();
    this.offState();
    const commit = this.active?.commit;
    this.cancelActive();
    if (!this.finalized && commit != null) {
      this.finalized = true;
      this.trace({ stage: "finalized", terminalId: commit.terminalId, detail: "disposed" });
      this.resolveResult?.({ commit, completion: "disposed", quorumReached: false });
      this.resolveResult = null;
    }
  }

  private ensureResultPromise(): void {
    if (this.resultPromise != null) {
      return;
    }
    this.resultPromise = new Promise(resolve => {
      this.resolveResult = resolve;
    });
  }

  private validLocalContext(context: CoopFrameContextV1, membership: CoopMembershipSnapshotV2): boolean {
    const localMember = membership.members.find(member => member.seatId === context.fromSeatId);
    return (
      membership.version === 2
      && membership.revision === context.membershipRevision
      && membership.requiredAckSeats.includes(context.fromSeatId)
      && localMember != null
      && localMember.state !== "removed"
      && localMember.connectionGeneration === context.connectionGeneration
    );
  }

  private validRemoteMessage(message: SharedTerminalMessage): boolean {
    const { commit, ctx } = message;
    if (
      !validFrameShape(ctx)
      || !validCommitShape(commit, ctx)
      || !this.safeValidatePeerContext(ctx, commit.quorum.membershipRevision)
    ) {
      return false;
    }
    const membership = this.hooks.membership();
    if (commit.quorum.membershipRevision > membership.revision) {
      return false;
    }
    const localContext = this.hooks.localContext();
    if (
      localContext == null
      || localContext.sessionId !== ctx.sessionId
      || localContext.sessionEpoch !== ctx.sessionEpoch
      || localContext.seatMapId !== ctx.seatMapId
      || !commit.quorum.requiredAckSeats.includes(localContext.fromSeatId)
    ) {
      return false;
    }
    return commit.quorum.requiredAckSeats.every(seatId => {
      const member = membership.members.find(candidate => candidate.seatId === seatId);
      return member != null && member.state !== "removed";
    });
  }

  private safeValidatePeerContext(context: CoopFrameContextV1, targetMembershipRevision: number): boolean {
    try {
      return this.hooks.validatePeerContext(context, targetMembershipRevision);
    } catch {
      return false;
    }
  }

  private activateLocal(commit: CoopSharedTerminalCommitV1, membership: CoopMembershipSnapshotV2): void {
    this.cancelActive();
    const tracker = new CoopAckQuorumTracker(commit.quorum);
    const local = membership.members.find(member => member.seatId === commit.originSeatId);
    if (local == null) {
      throw new Error("shared-terminal origin seat disappeared");
    }
    const active: ActiveTerminal = {
      commit,
      source: "local",
      tracker,
      cancelRetry: () => {},
      cancelDeadline: () => {},
    };
    this.active = active;
    if (this.prepareOnce(commit)) {
      tracker.accept(
        {
          membershipRevision: commit.quorum.membershipRevision,
          seatId: local.seatId,
          connectionGeneration: local.connectionGeneration,
        },
        membership,
      );
    }
    this.sendCommit(active, false);
    this.scheduleLocalRetry(active);
    active.cancelDeadline = this.schedule(() => {
      if (this.active === active && !this.finalized) {
        this.complete(active.commit, "deadline", false);
      }
    }, this.deadlineMs);
  }

  private activateRemote(commit: CoopSharedTerminalCommitV1): void {
    this.cancelActive();
    this.ensureResultPromise();
    const active: ActiveTerminal = {
      commit,
      source: "remote",
      tracker: null,
      cancelRetry: () => {},
      cancelDeadline: () => {},
    };
    this.active = active;
    if (this.prepareOnce(commit)) {
      this.sendAck(active, false);
      this.scheduleRemoteAck(active);
    }
    active.cancelDeadline = this.schedule(() => {
      if (this.active === active && !this.finalized) {
        this.complete(active.commit, "receiver-grace", false);
      }
    }, this.receiverGraceMs);
  }

  private prepareOnce(commit: CoopSharedTerminalCommitV1): boolean {
    if (this.prepared) {
      return this.prepareSucceeded;
    }
    this.prepared = true;
    try {
      this.prepareSucceeded = this.hooks.onPrepare(commit);
    } catch (error) {
      coopWarn("runtime", `shared terminal prepare partially failed id=${commit.terminalId}`, error);
    }
    this.trace({
      stage: "prepared",
      terminalId: commit.terminalId,
      detail: this.prepareSucceeded ? "entered" : "failed",
    });
    return this.prepareSucceeded;
  }

  private onMessage(message: CoopMessage): void {
    if (this.disposed || (message.t !== "sharedTerminal" && message.t !== "sharedTerminalAck")) {
      return;
    }
    if (message.t === "sharedTerminal") {
      this.onTerminalMessage(message);
      return;
    }
    this.onTerminalAck(message);
  }

  private onTerminalMessage(message: SharedTerminalMessage): void {
    if (!this.validRemoteMessage(message)) {
      this.trace({ stage: "rejected", terminalId: message.commit?.terminalId, detail: "terminal-frame" });
      return;
    }
    const candidate = message.commit;
    this.trace({ stage: "received", terminalId: candidate.terminalId });
    if (this.finalized) {
      if (this.active?.commit.terminalId === candidate.terminalId && this.active.source === "remote") {
        this.sendAck(this.active, true);
      }
      return;
    }
    const current = this.active;
    if (current == null) {
      this.activateRemote(candidate);
      return;
    }
    if (current.commit.terminalId === candidate.terminalId) {
      if (current.source === "remote") {
        this.sendAck(current, true);
      }
      return;
    }
    if (compareTerminalPriority(candidate, current.commit) < 0) {
      this.trace({
        stage: "superseded",
        terminalId: current.commit.terminalId,
        detail: `winner=${candidate.terminalId}`,
      });
      this.activateRemote(candidate);
      return;
    }
    // Our lower-priority tuple wins. Reassert it so a peer that started simultaneously adopts the same
    // transaction rather than both peers waiting for ACKs to different terminal IDs.
    this.reassertActive(current);
  }

  private onTerminalAck(message: SharedTerminalAck): void {
    const active = this.active;
    if (
      this.finalized
      || active == null
      || active.source !== "local"
      || active.tracker == null
      || !validFrameShape(message.ctx)
      || message.stage !== "terminalEntered"
      || message.terminalId !== active.commit.terminalId
      || message.terminalRevision !== active.commit.terminalRevision
      || message.targetMembershipRevision !== active.commit.quorum.membershipRevision
      || !this.safeValidatePeerContext(message.ctx, message.targetMembershipRevision)
    ) {
      this.trace({ stage: "rejected", terminalId: message.terminalId, detail: "terminal-ack" });
      return;
    }
    const result = active.tracker.accept(
      {
        membershipRevision: message.targetMembershipRevision,
        seatId: message.ctx.fromSeatId,
        connectionGeneration: message.ctx.connectionGeneration,
      },
      this.hooks.membership(),
    );
    if (result === "accepted" || result === "complete" || result === "duplicate") {
      this.trace({ stage: "ack-accepted", terminalId: message.terminalId, detail: result });
    } else {
      this.trace({ stage: "rejected", terminalId: message.terminalId, detail: result });
      return;
    }
    if (active.tracker.complete()) {
      this.complete(active.commit, "quorum", true);
    }
  }

  private scheduleLocalRetry(active: ActiveTerminal): void {
    active.cancelRetry = this.schedule(() => {
      if (this.active !== active || this.finalized || this.disposed) {
        return;
      }
      this.sendCommit(active, true);
      this.scheduleLocalRetry(active);
    }, this.retryMs);
  }

  private scheduleRemoteAck(active: ActiveTerminal): void {
    active.cancelRetry = this.schedule(() => {
      if (this.active !== active || this.finalized || this.disposed) {
        return;
      }
      this.sendAck(active, true);
      this.scheduleRemoteAck(active);
    }, this.retryMs);
  }

  private wireContext(commit: CoopSharedTerminalCommitV1): CoopFrameContextV1 | null {
    const current = this.hooks.localContext();
    if (
      current == null
      || !validFrameShape(current)
      || current.sessionEpoch !== commit.epoch
      || current.fromSeatId !== commit.originSeatId
    ) {
      return null;
    }
    return { ...current, membershipRevision: commit.quorum.membershipRevision };
  }

  private sendCommit(active: ActiveTerminal, retry: boolean): void {
    const ctx = this.wireContext(active.commit);
    if (ctx == null) {
      return;
    }
    this.transport.send({ t: "sharedTerminal", ctx, commit: active.commit });
    if (retry) {
      this.trace({ stage: "resent", terminalId: active.commit.terminalId, detail: "commit" });
    }
  }

  private sendAck(active: ActiveTerminal, retry: boolean): void {
    const current = this.hooks.localContext();
    if (
      !this.prepareSucceeded
      || current == null
      || !validFrameShape(current)
      || !active.commit.quorum.requiredAckSeats.includes(current.fromSeatId)
    ) {
      return;
    }
    const ctx = { ...current, membershipRevision: active.commit.quorum.membershipRevision };
    this.transport.send({
      t: "sharedTerminalAck",
      ctx,
      terminalId: active.commit.terminalId,
      terminalRevision: active.commit.terminalRevision,
      targetMembershipRevision: active.commit.quorum.membershipRevision,
      stage: "terminalEntered",
    });
    this.trace({
      stage: retry ? "resent" : "ack-sent",
      terminalId: active.commit.terminalId,
      detail: retry ? "ack" : undefined,
    });
  }

  private reassertActive(active: ActiveTerminal): void {
    if (active.source === "local") {
      this.sendCommit(active, true);
    } else {
      this.sendAck(active, true);
    }
  }

  private cancelActive(): void {
    const active = this.active;
    if (active == null) {
      return;
    }
    active.cancelRetry();
    active.cancelDeadline();
    this.active = null;
  }

  private complete(
    commit: CoopSharedTerminalCommitV1,
    completion: CoopSharedTerminalCompletion,
    quorumReached: boolean,
  ): void {
    if (this.finalized) {
      return;
    }
    this.finalized = true;
    const retained = this.active;
    retained?.cancelRetry();
    retained?.cancelDeadline();
    // Keep the winning commit readable during finalization and duplicate protection.
    if (retained == null || retained.commit.terminalId !== commit.terminalId) {
      this.active = {
        commit,
        source: "remote",
        tracker: null,
        cancelRetry: () => {},
        cancelDeadline: () => {},
      };
    }
    this.trace({ stage: "finalized", terminalId: commit.terminalId, detail: completion });
    try {
      this.hooks.onFinalize(commit, completion);
    } catch (error) {
      coopWarn("runtime", `shared terminal finalize partially failed id=${commit.terminalId}`, error);
    }
    this.resolveResult?.({ commit, completion, quorumReached });
    this.resolveResult = null;
  }

  private trace(event: CoopSharedTerminalTraceEvent): void {
    try {
      this.hooks.onTrace?.(event);
    } catch {
      /* tracing cannot affect terminal convergence */
    }
  }
}
