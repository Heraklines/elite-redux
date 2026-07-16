/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op RECIPROCAL RENDEZVOUS barrier (#839). A two-sided ready handshake at a named
// SYNC POINT: each client sends "I reached point P", and neither client is allowed to
// CROSS P (commit the next state-advancing action) until it has ALSO seen the partner's
// arrival for the SAME P. This is the missing RECIPROCAL guard for the co-op pacing class:
// today the barriers are one-directional (a slow watcher waits for the owner), but the
// FASTER player - including the interaction OWNER - can race arbitrarily ahead into a
// position the two clients can't reconcile (the reward-shop pick before the partner has
// finished the previous fight; the next battle command before the partner's faint
// replacement is on the field). The rendezvous makes BOTH players wait at the barrier.
//
// This is DELIBERATELY SEPARATE from the interaction ALTERNATION counter
// (coop-session-controller.ts owner=even/guest=odd): the counter says WHO picks; the
// rendezvous says WHEN both may proceed. They must not be conflated.
//
// ROBUSTNESS (the three failure modes the co-op wire class demands):
//   - EARLY ARRIVAL (#812 class): a partner's arrival that lands BEFORE this client
//     installs its waiter is BUFFERED (remembered in a Set) and consumed on the next await.
//   - DUPLICATE ARRIVAL: arrivals are set-membership, so a re-sent / re-delivered arrival
//     for a point already seen is a harmless no-op (idempotent on both ends).
//   - LOST ARRIVAL / DEAD PARTNER: the timeout retransmits the local arrival a bounded number of
//     times and keeps the boundary CLOSED. A live lost frame heals on retransmit; exhaustion asks
//     the owning runtime to enter its deterministic shared safe terminal. It never authorizes
//     unilateral continuation.
//
// Engine-FREE (transport + wire types only) so it is unit-testable headlessly over a
// LoopbackTransport, exactly like CoopInteractionRelay / CoopBattleStreamer.
// =============================================================================

import { recordCoopCausalEvent } from "#data/elite-redux/coop/coop-causal-trace";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { beginCoopMachineWait } from "#data/elite-redux/coop/coop-stall-probe";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";

const RENDEZVOUS_CAUSAL_POINT_LIMIT = 192;
const DEFAULT_RENDEZVOUS_RECOVERY_MAX_ATTEMPTS = 3;

/** Stable, bounded token for a point that may originate in a future UI surface. */
function boundedRendezvousPoint(point: string): string {
  if (point.length <= RENDEZVOUS_CAUSAL_POINT_LIMIT && /^[a-z][a-z0-9-]*(?::\d+){0,2}$/.test(point)) {
    return point;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < point.length; index++) {
    hash ^= point.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `point#${(hash >>> 0).toString(16).padStart(8, "0")}:len=${point.length}`;
}

function rendezvousPointAddress(point: string): { wave?: number; turn?: number } {
  const [surface, waveValue, turnValue] = point.split(":", 3);
  const wave = Number(waveValue);
  const turn = Number(turnValue);
  return {
    ...(Number.isSafeInteger(wave) && wave >= 0 ? { wave } : {}),
    ...(surface === "cmd" && Number.isSafeInteger(turn) && turn >= 0 ? { turn } : {}),
  };
}

/**
 * How long a rendezvous await blocks for the partner's arrival before giving up. The two live
 * barriers (shop-pick-commit / next-command-open) wait for the partner to finish the PREVIOUS
 * fight's animations / summon a faint replacement - a PACING wait bounded by battle presentation,
 * NOT human deliberation - so this is the SHORT-but-generous class (matches `coopWaveBarrierMs` /
 * `coopFaintSwitchWaitMs` at 60s), not the 20-min human-deliberation class the reward-choice relay
 * uses. Injectable so tests never sit through the live-generous default.
 */
let coopRendezvousWaitMs = 60_000;

/**
 * Under vitest the harness pumps the two engines COOPERATIVELY (one client's phases drain while the
 * other is parked), so a genuine cross-client rendezvous can never resolve mid-pump - a test that
 * reaches a barrier would sit through the full live-generous timeout PER COMMAND POINT (the 11-file
 * suite red of 2026-07-06). Default the wait to a tiny value in the test env so every existing and
 * future test gets it WITHOUT per-file injection; tests that exercise the barrier semantics
 * explicitly (block-until-arrive, recovery-retry WARN) still override via {@linkcode setCoopRendezvousWaitMs}.
 * Live builds never define VITEST, so production keeps the generous 60s recovery interval.
 */
const VITEST_DEFAULT_WAIT_MS = 50;
let waitMsExplicitlySet = false;

export function getCoopRendezvousWaitMs(): number {
  if (!waitMsExplicitlySet && typeof process !== "undefined" && process.env?.VITEST) {
    return VITEST_DEFAULT_WAIT_MS;
  }
  return coopRendezvousWaitMs;
}

export function setCoopRendezvousWaitMs(ms: number): void {
  waitMsExplicitlySet = true;
  coopRendezvousWaitMs = ms;
}

/**
 * Restore the DEFAULT wait semantics (live 60s / vitest 50ms). Tests that override via
 * {@linkcode setCoopRendezvousWaitMs} MUST restore with THIS in afterEach - restoring by setting
 * 60_000 explicitly LATCHES the explicit flag and disables the vitest default for every LATER file
 * in the shared-module suite run (the 2-file red of 2026-07-06).
 */
export function resetCoopRendezvousWaitMs(): void {
  waitMsExplicitlySet = false;
  coopRendezvousWaitMs = 60_000;
}

function defaultSchedule(cb: () => void, ms: number): () => void {
  const id = setTimeout(cb, ms);
  return () => clearTimeout(id);
}

/** The outcome of a rendezvous await. */
export interface CoopRendezvousResult {
  /** The sync point this result is for. */
  point: string;
  /** True when torn down/superseded or bounded live recovery exhausts; callers must remain closed. */
  timedOut: boolean;
  /**
   * Set to the OTHER sync point `Q` when the partner is already on a different branch. This remains a
   * separate classified catch-up result; timeout/loss recovery never produces it.
   */
  crossPoint?: string;
  /** Host-stated point that wins a cross-branch mismatch. Absent for an exact rendezvous. */
  authoritativePoint?: string;
}

/** Options for {@linkcode CoopRendezvous} (timer injection for tests). */
export interface CoopRendezvousOptions {
  /** Default await timeout (ms). Falls back to {@linkcode getCoopRendezvousWaitMs}. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
  /** Negotiated session epoch; route/ACK frames from another epoch are rejected. */
  getEpoch?: () => number;
  /** Retransmissions allowed before the owning runtime must enter its shared safe terminal. */
  maxRecoveryAttempts?: number;
  /** Runtime-owned fail-closed terminal hook; the engine-free rendezvous never imports runtime state. */
  onRecoveryExhausted?: (failure: CoopRendezvousRecoveryFailure) => void;
}

export interface CoopRendezvousRecoveryFailure {
  point: string;
  attempts: number;
  kind: "arrival" | "route-ack";
  displacedPoint?: string;
}

export interface CoopRendezvousControlSnapshot {
  localArrived: string[];
  partnerArrived: string[];
  awaiting: string[];
}

function validControlPoints(points: unknown): points is string[] {
  return (
    Array.isArray(points)
    && points.every(point => typeof point === "string" && point.length > 0 && point.length <= 512)
    && new Set(points).size === points.length
  );
}

/**
 * Rides a {@linkcode CoopTransport} to run reciprocal two-sided rendezvous barriers. One instance
 * per client. Both clients call {@linkcode rendezvous} (or {@linkcode arrive} + {@linkcode awaitPartner})
 * for the SAME `point`; each resolves only once BOTH have arrived (or the waiter is explicitly torn down).
 */
export class CoopRendezvous {
  private readonly transport: CoopTransport;
  private readonly defaultTimeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly offMessage: () => void;
  private readonly offStateChange: () => void;
  private readonly getEpoch: () => number;
  private readonly maxRecoveryAttempts: number;
  private readonly onRecoveryExhausted: ((failure: CoopRendezvousRecoveryFailure) => void) | undefined;

  /** Points THIS client has arrived at (idempotent local arrival; suppresses a duplicate send). */
  private readonly localArrived = new Set<string>();
  /** Points the PARTNER has signaled arrival at (buffered even before we await; idempotent). */
  private readonly partnerArrived = new Set<string>();
  /** point -> resolver for the in-flight {@linkcode awaitPartner} (one at a time per point). */
  private readonly pending = new Map<string, (res: CoopRendezvousResult) => void>();
  /** point -> when each parked wait began (stall-watchdog age, mirrors the relay). */
  private readonly pendingSince = new Map<string, number>();
  private routeRevision = 0;
  private latestGuestRoute: {
    revision: number;
    point: string;
    displacedPoint: string;
  } | null = null;
  private readonly pendingRouteAcks = new Map<
    number,
    {
      finish: () => void;
      abort: () => void;
      cancel: () => void;
      point: string;
      displacedPoint: string;
      since: number;
    }
  >();

  constructor(transport: CoopTransport, opts: CoopRendezvousOptions = {}) {
    this.transport = transport;
    this.defaultTimeoutMs = opts.timeoutMs ?? getCoopRendezvousWaitMs();
    this.schedule = opts.schedule ?? defaultSchedule;
    this.getEpoch = opts.getEpoch ?? (() => 0);
    this.maxRecoveryAttempts = opts.maxRecoveryAttempts ?? DEFAULT_RENDEZVOUS_RECOVERY_MAX_ATTEMPTS;
    if (!Number.isSafeInteger(this.maxRecoveryAttempts) || this.maxRecoveryAttempts <= 0) {
      throw new Error("invalid rendezvous recovery attempt bound");
    }
    this.onRecoveryExhausted = opts.onRecoveryExhausted;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
    this.offStateChange = transport.onStateChange(state => {
      if (state === "connected") {
        this.resendControlState();
      }
    });
  }

  private recordCausalStage(stage: string, point: string, detail?: string): void {
    const epoch = this.getEpoch();
    recordCoopCausalEvent({
      domain: "recovery",
      stage,
      causalId: `rendezvous:e${epoch}:${boundedRendezvousPoint(point)}`,
      role: this.transport.role,
      epoch,
      ...rendezvousPointAddress(point),
      ...(detail == null ? {} : { detail }),
    });
  }

  private recordWaitOutcome(point: string, result: CoopRendezvousResult): CoopRendezvousResult {
    this.recordCausalStage(
      result.timedOut ? "abort" : "release",
      point,
      result.timedOut ? undefined : `outcome=${result.crossPoint == null ? "exact" : "cross-point"}`,
    );
    return result;
  }

  private recoveryExhausted(failure: CoopRendezvousRecoveryFailure): void {
    this.recordCausalStage(
      "exhausted",
      failure.point,
      `kind=${failure.kind} attempts=${failure.attempts}`
        + (failure.displacedPoint == null ? "" : ` displaced=${failure.displacedPoint}`),
    );
    coopWarn(
      "rendezvous",
      `RENDEZVOUS RECOVERY EXHAUSTED point=${failure.point} kind=${failure.kind} `
        + `attempts=${failure.attempts}${failure.displacedPoint == null ? "" : ` displaced=${failure.displacedPoint}`} `
        + `- boundary remains closed; entering shared safe terminal role=${this.transport.role}`,
    );
    try {
      this.onRecoveryExhausted?.(failure);
    } catch (error) {
      coopWarn("rendezvous", `recovery terminal hook threw point=${failure.point} (boundary remains closed)`, error);
    }
  }

  /**
   * True when the PARTNER's arrival for `point` has already been received (buffered or live). Lets a
   * caller take a SYNCHRONOUS fast-path (arrive + proceed immediately, no promise) when there is
   * nothing to wait for - deferring behind a `.then` when the partner is already here would reorder
   * UI opens for no reason (the 2026-07-06 command-menu async regression).
   */
  hasPartnerArrived(point: string): boolean {
    return this.partnerArrived.has(point);
  }

  /**
   * #diagnostics: a compact, read-only snapshot of the rendezvous barrier state (which sync points
   * THIS client has arrived at, which the PARTNER has, and which are currently being awaited). For a
   * bug report's control-plane block: a point in `awaiting` that the partner has NOT arrived at is a
   * one-sided barrier the run is parked on. Pure read; never mutates barrier state.
   */
  describeArrivals(): {
    localArrived: string[];
    partnerArrived: string[];
    awaiting: string[];
  } {
    return {
      localArrived: [...this.localArrived],
      partnerArrived: [...this.partnerArrived],
      awaiting: [...this.pending.keys()],
    };
  }

  /**
   * Restore the complementary view of an authoritative peer snapshot. A peer's local arrival is our
   * partner arrival; a peer-observed partner arrival proves our local frame reached it. Local arrivals that
   * the snapshot did not yet observe are preserved only when this client is already parked there or the
   * peer is explicitly awaiting that point, then retransmitted. No arrival is invented from `awaiting`.
   */
  restorePeerControlSnapshot(snapshot: CoopRendezvousControlSnapshot): boolean {
    if (
      !validControlPoints(snapshot?.localArrived)
      || !validControlPoints(snapshot?.partnerArrived)
      || !validControlPoints(snapshot?.awaiting)
    ) {
      coopWarn("rendezvous", "refused malformed peer control snapshot");
      return false;
    }

    const previousLocal = new Set(this.localArrived);
    const previousPartner = new Set(this.partnerArrived);
    const locallyAwaited = new Set(this.pending.keys());
    const peerAwaiting = new Set(snapshot.awaiting);
    const nextLocal = new Set(snapshot.partnerArrived);
    for (const point of this.localArrived) {
      if (locallyAwaited.has(point) || peerAwaiting.has(point)) {
        nextLocal.add(point);
      }
    }
    const nextPartner = new Set(snapshot.localArrived);

    this.localArrived.clear();
    this.partnerArrived.clear();
    for (const point of nextLocal) {
      this.localArrived.add(point);
    }
    for (const point of nextPartner) {
      this.partnerArrived.add(point);
    }
    for (const point of nextLocal) {
      if (!previousLocal.has(point)) {
        this.recordCausalStage("local-arrival", point, "source=control-restore");
      }
    }
    for (const point of nextPartner) {
      if (!previousPartner.has(point)) {
        this.recordCausalStage("peer-arrival", point, "source=control-restore");
      }
    }

    // Reassert every proven local arrival before releasing any waiter. If its earlier carrier was the lost
    // frame, the authoritative peer can now cross the same barrier rather than remaining parked alone.
    for (const point of nextLocal) {
      this.transport.send({ t: "rendezvous", point });
    }
    for (const [point, finish] of [...this.pending]) {
      if (!nextPartner.has(point)) {
        continue;
      }
      this.transport.send({ t: "rendezvous", point });
      finish({ point, timedOut: false });
    }
    coopLog(
      "rendezvous",
      `restored peer control local=${nextLocal.size} partner=${nextPartner.size} awaiting=${this.pending.size}`,
    );
    return true;
  }

  /**
   * Signal (idempotently) that THIS client has reached sync `point`. A duplicate arrival for a point
   * already sent is a no-op on the wire (the send is suppressed). Does NOT block - a client that only
   * needs to LET the partner proceed (without waiting itself) calls this; the FASTER player calls
   * {@linkcode rendezvous} to both arrive AND block.
   */
  arrive(point: string): void {
    if (this.localArrived.has(point)) {
      return;
    }
    this.localArrived.add(point);
    this.recordCausalStage("local-arrival", point);
    coopLog("rendezvous", `ARRIVE point=${point} (send) role=${this.transport.role}`);
    this.transport.send({ t: "rendezvous", point });
  }

  /**
   * Re-announce one specific local arrival, bypassing {@linkcode arrive}'s duplicate suppression.
   * Used when a cooperative scheduler knows the peer may not have observed the original frame; unlike
   * {@linkcode resendArrivals}, this cannot replay unrelated historical barrier points.
   */
  reannounce(point: string): void {
    if (!this.localArrived.has(point)) {
      this.arrive(point);
      return;
    }
    coopLog("rendezvous", `REANNOUNCE point=${point} role=${this.transport.role}`);
    this.transport.send({ t: "rendezvous", point });
  }

  /**
   * Block until the PARTNER has arrived at `point`. Resolves immediately if the partner's arrival was
   * already buffered. On timeout, re-send our arrival up to the configured recovery bound. Exhaustion
   * invokes the runtime terminal hook and returns a closed `timedOut` result; neither outcome grants
   * permission to cross a shared boundary independently.
   */
  awaitPartner(point: string, timeoutMs = this.defaultTimeoutMs): Promise<CoopRendezvousResult> {
    this.recordCausalStage("wait-open", point);
    if (this.partnerArrived.has(point)) {
      if (isCoopDebug()) {
        coopLog(
          "rendezvous",
          `AWAIT point=${point} -> partner already arrived (buffer-hit) role=${this.transport.role}`,
        );
      }
      return Promise.resolve(this.recordWaitOutcome(point, { point, timedOut: false }));
    }
    // A buffered FOREIGN arrival is a classified branch mismatch, not packet loss. Preserve the existing
    // catch-up release until the authoritative phase-route operation replaces it.
    const buffered = this.foreignArrival(point);
    if (buffered !== undefined) {
      if (this.transport.role === "host") {
        return this.publishAuthoritativeRoute(point, buffered, timeoutMs).then(result =>
          this.recordWaitOutcome(point, result),
        );
      }
      const route = this.latestGuestRoute;
      if (route != null && route.displacedPoint === point && route.point === buffered) {
        return Promise.resolve(
          this.recordWaitOutcome(point, {
            point,
            timedOut: false,
            crossPoint: route.point,
            authoritativePoint: route.point,
          }),
        );
      }
      coopLog("rendezvous", `AWAIT point=${point} sees partner at ${buffered}; guest WAITING for host phaseRoute`);
    }
    coopLog("rendezvous", `AWAIT point=${point} timeoutMs=${timeoutMs} -> network-wait role=${this.transport.role}`);
    // Supersede any stale waiter parked on this point (only one await per point at a time).
    const stale = this.pending.get(point);
    if (stale !== undefined) {
      coopWarn(
        "rendezvous",
        `AWAIT point=${point} SUPERSEDE stale waiter -> resolved timedOut role=${this.transport.role}`,
      );
      stale({ point, timedOut: true });
    }
    this.pendingSince.set(point, Date.now());
    // A parked reciprocal barrier is useful MUTUAL-stall evidence, but is not ASYMMETRIC-deadlock proof.
    // One browser can reach cmd/shop while its healthy peer is still rendering narration/animation or
    // reading the local path to the same point. Treating that ordinary lead as asymmetric terminated live
    // wave-1 sessions on slower clients. Disconnect supervision + retransmission still bound a dead peer.
    const endMachineWait = beginCoopMachineWait(`coop-rendezvous:${point}`, {
      asymmetricEligible: false,
    });
    return new Promise<CoopRendezvousResult>(resolve => {
      let settled = false;
      let recoveryAttempts = 0;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopRendezvousResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        endMachineWait();
        if (this.pending.get(point) === finish) {
          this.pending.delete(point);
          this.pendingSince.delete(point);
        }
        if (res.timedOut) {
          coopWarn(
            "rendezvous",
            `RENDEZVOUS ABORT point=${point} - waiter torn down without partner arrival role=${this.transport.role}`,
          );
        } else if (res.crossPoint === undefined) {
          coopLog("rendezvous", `AWAIT point=${point} RESOLVE both-arrived role=${this.transport.role}`);
        } else {
          // #847 CROSS-POINT: the partner is at ANOTHER sync point and will never reach P. INFO, not WARN -
          // this is a healthy divergence release (no hang), distinct from the dead-partner timeout above.
          coopLog(
            "rendezvous",
            `AWAIT point=${point} CROSS-POINT release (partner at ${res.crossPoint}) role=${this.transport.role}`,
          );
        }
        this.recordWaitOutcome(point, res);
        resolve(res);
      };
      const armRecoveryTimer = (): (() => void) =>
        this.schedule(() => {
          // #899: under the cooperative two-engine harness the partner's real loopback arrival may already
          // be queued for delivery when the tiny vitest wall timer fires. Give transport microtasks one
          // event-driven turn before retransmitting.
          queueMicrotask(() => {
            if (settled) {
              return;
            }
            if (this.partnerArrived.has(point)) {
              finish({ point, timedOut: false });
              return;
            }
            if (recoveryAttempts >= this.maxRecoveryAttempts) {
              this.recoveryExhausted({ point, attempts: recoveryAttempts, kind: "arrival" });
              finish({ point, timedOut: true });
              return;
            }
            recoveryAttempts++;
            coopWarn(
              "rendezvous",
              `RENDEZVOUS RECOVERY RETRY point=${point} attempt=${recoveryAttempts}/${this.maxRecoveryAttempts} `
                + `after ${timeoutMs}ms - partner never arrived; `
                + `RETRANSMITTING and KEEPING BOUNDARY CLOSED role=${this.transport.role}`,
            );
            // `arrive()` suppresses duplicates by design; recovery intentionally bypasses that suppression.
            try {
              this.transport.send({ t: "rendezvous", point });
            } catch (error) {
              coopWarn("rendezvous", `arrival retransmit threw point=${point} (retry remains bounded)`, error);
            }
            cancelTimer = armRecoveryTimer();
          });
        }, timeoutMs);
      this.pending.set(point, finish);
      cancelTimer = armRecoveryTimer();
    });
  }

  /**
   * The full reciprocal barrier: ARRIVE at `point`, then block until the partner has also arrived.
   * Recovery timeouts retransmit without resolving. Both clients call this for the same point; the client that reached
   * the barrier FIRST blocks until the other arrives, the client that reached it SECOND resolves at
   * once (the first's arrival is already buffered). Neither crosses `point` until both have arrived.
   */
  rendezvous(point: string, timeoutMs = this.defaultTimeoutMs): Promise<CoopRendezvousResult> {
    this.arrive(point);
    return this.awaitPartner(point, timeoutMs);
  }

  /** Whether the partner has already arrived at `point` (a race check without parking a waiter). */
  partnerHasArrived(point: string): boolean {
    return this.partnerArrived.has(point);
  }

  /**
   * B7 item 14b (rejoin): RE-SEND every local arrival on the wire. {@linkcode arrive} suppresses a
   * duplicate send once a point is in {@linkcode localArrived}, so after a WebRTC rejoin the partner
   * that missed our original arrival in the dark window would never get it. This bypasses the
   * suppression to replay them; the partner's {@linkcode handle} is idempotent (a point already seen
   * is a harmless no-op), so replaying is always safe.
   */
  resendArrivals(): void {
    for (const point of this.localArrived) {
      coopLog("rendezvous", `RESEND arrival point=${point} (rejoin) role=${this.transport.role}`);
      this.transport.send({ t: "rendezvous", point });
    }
  }

  /** Rehydrate every live barrier/route after a connection-generation change. */
  resendControlState(): void {
    this.resendArrivals();
    const epoch = this.getEpoch();
    for (const [revision, route] of this.pendingRouteAcks) {
      coopLog(
        "rendezvous",
        `RESEND phaseRoute rev=${revision} authoritative=${route.point} displaced=${route.displacedPoint} (rejoin)`,
      );
      this.transport.send({
        t: "phaseRoute",
        epoch,
        revision,
        point: route.point,
        displacedPoint: route.displacedPoint,
      });
    }
  }

  /**
   * Age (ms) of the OLDEST parked rendezvous wait, or -1 when none. Mirrors the interaction relay's
   * watchdog probe: a positive value means this client is BLOCKED at a barrier waiting for the partner.
   */
  oldestNetworkWaitMs(): number {
    let oldest = -1;
    const now = Date.now();
    for (const since of this.pendingSince.values()) {
      const age = now - since;
      if (age > oldest) {
        oldest = age;
      }
    }
    for (const route of this.pendingRouteAcks.values()) {
      const age = now - route.since;
      if (age > oldest) {
        oldest = age;
      }
    }
    return oldest;
  }

  /** Stop listening and abort any in-flight waits; callers must remain closed on this result. */
  dispose(): void {
    this.offMessage();
    this.offStateChange();
    for (const finish of [...this.pending.values()]) {
      finish({ point: "(disposed)", timedOut: true });
    }
    this.pending.clear();
    this.pendingSince.clear();
    this.localArrived.clear();
    this.partnerArrived.clear();
    for (const route of this.pendingRouteAcks.values()) {
      route.cancel();
      route.abort();
    }
    this.pendingRouteAcks.clear();
    this.latestGuestRoute = null;
  }

  /**
   * #861 SESSION-BOUNDARY PURGE: drop the buffered arrival state (this client's own arrivals + the
   * PARTNER's buffered arrivals) WITHOUT tearing down the listener or failing a LIVE waiter. Called at the
   * same session/epoch boundaries as {@linkcode CoopInteractionRelay.purgeBufferedArrivals}: a prior epoch's
   * buffered partner-arrival for a point the NEW epoch reuses (points are wave-scoped, and a resume/rejoin
   * lands on the same wave) could CROSS-POINT-release a fresh await with a stale arrival. Purging guarantees
   * only this epoch's genuine arrivals resolve a barrier. The session continues after the boundary.
   */
  purgeBufferedArrivals(reason: string): void {
    const buffered = this.localArrived.size + this.partnerArrived.size;
    if (buffered > 0) {
      coopWarn(
        "rendezvous",
        `purgeBufferedArrivals(${reason}) dropping localArrived=${this.localArrived.size} `
          + `partnerArrived=${this.partnerArrived.size} (#861 stale-session isolation)`,
      );
    }
    this.localArrived.clear();
    this.partnerArrived.clear();
    this.latestGuestRoute = null;
    for (const route of this.pendingRouteAcks.values()) {
      route.cancel();
      route.abort();
    }
    this.pendingRouteAcks.clear();
  }

  private handle(msg: CoopMessage): void {
    if (msg.t === "phaseRoute") {
      if (this.transport.role !== "guest") {
        return;
      }
      if (msg.epoch !== this.getEpoch()) {
        coopWarn("rendezvous", `guest DROP phaseRoute stale epoch=${msg.epoch} current=${this.getEpoch()}`);
        return;
      }
      if (this.latestGuestRoute == null || msg.revision >= this.latestGuestRoute.revision) {
        this.latestGuestRoute = msg;
      }
      this.transport.send({
        t: "phaseRouteAck",
        epoch: msg.epoch,
        revision: msg.revision,
      });
      for (const [waitPoint, finish] of [...this.pending.entries()]) {
        if (waitPoint === msg.displacedPoint && waitPoint !== msg.point) {
          coopWarn(
            "rendezvous",
            `guest ROUTED AWAY ${waitPoint} -> host-authoritative ${msg.point} rev=${msg.revision}`,
          );
          finish({
            point: waitPoint,
            timedOut: false,
            crossPoint: msg.point,
            authoritativePoint: msg.point,
          });
        }
      }
      return;
    }
    if (msg.t === "phaseRouteAck") {
      if (this.transport.role !== "host") {
        return;
      }
      if (msg.epoch !== this.getEpoch()) {
        coopWarn("rendezvous", `host DROP phaseRouteAck stale epoch=${msg.epoch} current=${this.getEpoch()}`);
        return;
      }
      this.pendingRouteAcks.get(msg.revision)?.finish();
      return;
    }
    if (msg.t !== "rendezvous") {
      return;
    }
    const { point } = msg;
    if (this.partnerArrived.has(point)) {
      // A duplicate is normally a harmless no-op. There is one important exception: a client can
      // re-enter an OLD CommandPhase after both peers already crossed a newer host point (the retained
      // wave-12 CommandPhase that reappeared after guest-owned ME finalization). Its restored rendezvous
      // state no longer remembers the host's old arrival, so it retransmits the old point and parks. The
      // host DOES remember that partner arrival and used to drop the retransmit here, leaving the guest
      // sealed forever. If the host has a causally-later local point, explicitly route the regressed peer
      // to that point. A duplicate of the newest/current point still remains a no-op.
      if (this.transport.role === "host") {
        const authoritativePoint = this.latestAuthoritativeLocalPoint(point);
        if (authoritativePoint !== undefined) {
          const routeAlreadyPending = [...this.pendingRouteAcks.values()].some(
            route => route.point === authoritativePoint && route.displacedPoint === point,
          );
          if (!routeAlreadyPending) {
            coopWarn("rendezvous", `host ROUTE regressed duplicate=${point} -> authoritative=${authoritativePoint}`);
            void this.publishAuthoritativeRoute(authoritativePoint, point, this.defaultTimeoutMs);
          }
          return;
        }
      }
      // Idempotent: a duplicate / re-delivered arrival for the current point is a harmless no-op.
      if (isCoopDebug()) {
        coopLog("rendezvous", `RECV arrival point=${point} -> DUPLICATE (already seen) role=${this.transport.role}`);
      }
      return;
    }
    this.partnerArrived.add(point);
    this.recordCausalStage("peer-arrival", point);
    const waiter = this.pending.get(point);
    if (waiter) {
      if (isCoopDebug()) {
        coopLog("rendezvous", `RECV arrival point=${point} -> deliver-to-waiter role=${this.transport.role}`);
      }
      // Reciprocal ACK: our original arrival may have been the frame that was lost. Echo it once before
      // releasing locally, so the peer that retransmitted cannot remain parked forever after we cross.
      // The receiver de-duplicates `partnerArrived`, so this cannot form an ACK loop.
      this.transport.send({ t: "rendezvous", point });
      waiter({ point, timedOut: false });
      return;
    }
    // A live foreign arrival is a branch mismatch. The host states the winning logical route and waits for
    // its ACK; the guest remains parked until that route arrives. Neither side infers permission locally.
    if (this.pending.size > 0 && !this.localArrived.has(point)) {
      let released = false;
      for (const [waitPoint, finish] of [...this.pending.entries()]) {
        if (waitPoint !== point) {
          if (this.transport.role === "host") {
            void this.publishAuthoritativeRoute(waitPoint, point, this.defaultTimeoutMs).then(finish);
          } else {
            coopLog(
              "rendezvous",
              `RECV foreign arrival=${point} while awaiting=${waitPoint}; guest WAITING for host phaseRoute`,
            );
          }
          released = true;
        }
      }
      if (released) {
        return;
      }
    }
    // Host WATCHER branches (notably an odd-counter reward shop) announce their point but do not await it.
    // If the guest instead reaches a foreign point on the SAME wave, there is therefore no pending host
    // waiter to trigger the route above. The host's most-recent unmatched local arrival is still the
    // authoritative logical phase: publish it proactively and require the guest ACK before that wrong branch
    // can close. This is the live cmd:6:2 vs shop:6:5 softlock shape.
    if (this.transport.role === "host" && !this.localArrived.has(point)) {
      const localPoint = this.latestAuthoritativeLocalPoint(point);
      if (localPoint !== undefined) {
        coopWarn(
          "rendezvous",
          `host PROACTIVE phaseRoute authoritative=${localPoint} displaced=${point} (host branch has no waiter)`,
        );
        void this.publishAuthoritativeRoute(localPoint, point, this.defaultTimeoutMs);
        return;
      }
    }
    // No waiter yet - buffer for the next awaitPartner(point) (the #812 early-arrival class).
    if (isCoopDebug()) {
      coopLog("rendezvous", `RECV arrival point=${point} -> BUFFER (no waiter yet) role=${this.transport.role}`);
    }
  }

  /**
   * #847 CROSS-POINT RELEASE helper: the first buffered PARTNER arrival for a point OTHER than
   * `exceptPoint` that we have NOT locally reached, or undefined when none. A partner arrival at a point
   * we have ALSO locally arrived at is NOT foreign - it is a shared sync point behind/at us (e.g. the
   * previous turn's command barrier the caller's synchronous fast-path passed without consuming), so
   * excluding it prevents a stale past-point from spuriously cross-releasing the NEXT barrier. Only a
   * point the partner reached that we never will (a divergent branch: `shop:` while we await `cmd:`) is
   * a genuine cross-point release.
   */
  private foreignArrival(exceptPoint: string): string | undefined {
    for (const q of this.partnerArrived) {
      if (q !== exceptPoint && !this.localArrived.has(q)) {
        return q;
      }
    }
    return;
  }

  /**
   * Host-local point that proves `foreignPoint` is no longer the authoritative branch. Set insertion order
   * is the local causal order: {@linkcode arrive} inserts exactly once and reannounce never moves an entry.
   * When the host also reached `foreignPoint`, only a later insertion can win. When it never reached that
   * divergent point, a higher wave is intrinsically newer; on the same wave retain the existing watcher rule
   * and require a local point the partner has not reached. These guards prevent a normal duplicate of the
   * newest point, or a stale shared past point, from inventing forward progress.
   */
  private latestAuthoritativeLocalPoint(foreignPoint: string): string | undefined {
    const foreignWave = this.pointWave(foreignPoint);
    if (foreignWave === undefined) {
      return;
    }
    const local = [...this.localArrived];
    const foreignIndex = local.indexOf(foreignPoint);
    const minimumIndex = foreignIndex < 0 ? 0 : foreignIndex + 1;
    for (let i = local.length - 1; i >= minimumIndex; i--) {
      const candidate = local[i];
      const candidateWave = this.pointWave(candidate);
      if (
        candidate !== foreignPoint
        && candidateWave !== undefined
        && candidateWave >= foreignWave
        && (foreignIndex >= 0 || candidateWave > foreignWave || !this.partnerArrived.has(candidate))
      ) {
        return candidate;
      }
    }
    return;
  }

  private pointWave(point: string): number | undefined {
    const value = Number(point.split(":")[1]);
    return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  }

  /** Host publishes the winning branch and retransmits it until the guest ACKs the revision. */
  private publishAuthoritativeRoute(
    point: string,
    displacedPoint: string,
    retryMs: number,
  ): Promise<CoopRendezvousResult> {
    const revision = ++this.routeRevision;
    const epoch = this.getEpoch();
    return new Promise(resolve => {
      let settled = false;
      let recoveryAttempts = 0;
      let cancel = () => {};
      const endMachineWait = beginCoopMachineWait(`coop-rendezvous-route:${point}<-${displacedPoint}`);
      const settle = (timedOut: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        cancel();
        endMachineWait();
        this.pendingRouteAcks.delete(revision);
        if (!timedOut) {
          coopLog(
            "rendezvous",
            `host phaseRoute ACKED rev=${revision} authoritative=${point} displaced=${displacedPoint}`,
          );
        }
        resolve(
          timedOut
            ? { point, timedOut: true }
            : {
                point,
                timedOut: false,
                crossPoint: displacedPoint,
                authoritativePoint: point,
              },
        );
      };
      const finish = () => settle(false);
      const abort = () => settle(true);
      const sendAndArm = () => {
        if (settled) {
          return;
        }
        try {
          this.transport.send({
            t: "phaseRoute",
            epoch,
            revision,
            point,
            displacedPoint,
          });
        } catch (error) {
          coopWarn("rendezvous", `host phaseRoute send threw rev=${revision} (retry remains bounded)`, error);
        }
        cancel = this.schedule(() => {
          if (recoveryAttempts >= this.maxRecoveryAttempts) {
            this.recoveryExhausted({
              point,
              displacedPoint,
              attempts: recoveryAttempts,
              kind: "route-ack",
            });
            settle(true);
            return;
          }
          recoveryAttempts++;
          coopWarn(
            "rendezvous",
            `host phaseRoute RETRY rev=${revision} attempt=${recoveryAttempts}/${this.maxRecoveryAttempts} `
              + `authoritative=${point} displaced=${displacedPoint}`,
          );
          sendAndArm();
        }, retryMs);
      };
      this.pendingRouteAcks.set(revision, {
        finish,
        abort,
        cancel: () => cancel(),
        point,
        displacedPoint,
        since: Date.now(),
      });
      sendAndArm();
    });
  }
}
