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
//   - DEAD PARTNER: a partner that never arrives cannot strand the run forever - the await
//     resolves `timedOut: true` after a generous, injectable timeout, emitting a LOUD WARN
//     ("RENDEZVOUS TIMEOUT", assertable by the soak) so the leader PROCEEDS rather than hangs.
//
// Engine-FREE (transport + wire types only) so it is unit-testable headlessly over a
// LoopbackTransport, exactly like CoopInteractionRelay / CoopBattleStreamer.
// =============================================================================

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";

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
 * explicitly (block-until-arrive, timeout-WARN) still override via {@linkcode setCoopRendezvousWaitMs}.
 * Live builds never define VITEST, so production keeps the generous 60s anti-hang class.
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
  /** True when the partner NEVER arrived and the anti-hang timeout fired (the run proceeds anyway). */
  timedOut: boolean;
  /**
   * #847 CROSS-POINT RELEASE: set to the OTHER sync point `Q` the partner arrived at while we awaited
   * this point `P`. The partner having reached a DIFFERENT point that we have NOT locally reached proves
   * it diverged onto another branch and will NEVER arrive at `P` (the berry-bush deadlock: the reward
   * owner walked to the shop while the partner opened a phantom next command). Resolving is then an INFO
   * release (NOT the anti-hang WARN) - the caller proceeds exactly as on timeout and the downstream
   * catch-up machinery reconciles.
   */
  crossPoint?: string;
}

/** Options for {@linkcode CoopRendezvous} (timer injection for tests). */
export interface CoopRendezvousOptions {
  /** Default await timeout (ms). Falls back to {@linkcode getCoopRendezvousWaitMs}. */
  timeoutMs?: number;
  /** Timer injection (tests). Returns a cancel fn. Defaults to setTimeout/clearTimeout. */
  schedule?: (cb: () => void, ms: number) => () => void;
}

/**
 * Rides a {@linkcode CoopTransport} to run reciprocal two-sided rendezvous barriers. One instance
 * per client. Both clients call {@linkcode rendezvous} (or {@linkcode arrive} + {@linkcode awaitPartner})
 * for the SAME `point`; each resolves only once BOTH have arrived (or the anti-hang timeout fires).
 */
export class CoopRendezvous {
  private readonly transport: CoopTransport;
  private readonly defaultTimeoutMs: number;
  private readonly schedule: (cb: () => void, ms: number) => () => void;
  private readonly offMessage: () => void;

  /** Points THIS client has arrived at (idempotent local arrival; suppresses a duplicate send). */
  private readonly localArrived = new Set<string>();
  /** Points the PARTNER has signaled arrival at (buffered even before we await; idempotent). */
  private readonly partnerArrived = new Set<string>();
  /** point -> resolver for the in-flight {@linkcode awaitPartner} (one at a time per point). */
  private readonly pending = new Map<string, (res: CoopRendezvousResult) => void>();
  /** point -> when each parked wait began (stall-watchdog age, mirrors the relay). */
  private readonly pendingSince = new Map<string, number>();

  constructor(transport: CoopTransport, opts: CoopRendezvousOptions = {}) {
    this.transport = transport;
    this.defaultTimeoutMs = opts.timeoutMs ?? getCoopRendezvousWaitMs();
    this.schedule = opts.schedule ?? defaultSchedule;
    this.offMessage = transport.onMessage(msg => this.handle(msg));
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
    coopLog("rendezvous", `ARRIVE point=${point} (send) role=${this.transport.role}`);
    this.transport.send({ t: "rendezvous", point });
  }

  /**
   * Block until the PARTNER has arrived at `point` (or the anti-hang timeout fires). Resolves
   * immediately if the partner's arrival was already buffered. On timeout resolves `timedOut: true`
   * after emitting a LOUD WARN - the caller then PROCEEDS rather than stranding the run.
   */
  awaitPartner(point: string, timeoutMs = this.defaultTimeoutMs): Promise<CoopRendezvousResult> {
    if (this.partnerArrived.has(point)) {
      if (isCoopDebug()) {
        coopLog(
          "rendezvous",
          `AWAIT point=${point} -> partner already arrived (buffer-hit) role=${this.transport.role}`,
        );
      }
      return Promise.resolve({ point, timedOut: false });
    }
    // #847 CROSS-POINT RELEASE (buffered): the partner's arrival for a DIFFERENT sync point may already be
    // buffered BEFORE this await installs (the berry-bush trace: the guest had the host's `shop:3:2` arrival
    // buffered before it opened its `cmd:3:2` await). Check the buffer for a FOREIGN arrival at await-START,
    // not just on live receipt - a partner parked at Q proves it will never reach P. Resolve INFO (not WARN).
    const buffered = this.foreignArrival(point);
    if (buffered !== undefined) {
      coopLog(
        "rendezvous",
        `AWAIT point=${point} -> CROSS-POINT release (partner already at ${buffered}, buffered) role=${this.transport.role}`,
      );
      return Promise.resolve({ point, timedOut: false, crossPoint: buffered });
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
    return new Promise<CoopRendezvousResult>(resolve => {
      let settled = false;
      let cancelTimer: () => void = () => {};
      const finish = (res: CoopRendezvousResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer();
        if (this.pending.get(point) === finish) {
          this.pending.delete(point);
          this.pendingSince.delete(point);
        }
        if (res.timedOut) {
          // The soak asserts on this exact substring. LOUD on purpose: a fired timeout means a
          // partner that never reached the barrier, so proceeding is the anti-hang backstop.
          coopWarn(
            "rendezvous",
            `RENDEZVOUS TIMEOUT point=${point} after ${timeoutMs}ms - partner never arrived; `
              + `PROCEEDING (anti-hang backstop) role=${this.transport.role}`,
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
        resolve(res);
      };
      this.pending.set(point, finish);
      cancelTimer = this.schedule(() => finish({ point, timedOut: true }), timeoutMs);
    });
  }

  /**
   * The full reciprocal barrier: ARRIVE at `point`, then block until the partner has also arrived (or
   * the anti-hang timeout fires). Both clients call this for the same point; the client that reached
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
    return oldest;
  }

  /** Stop listening and fail any in-flight waits (as timed out, so callers proceed). */
  dispose(): void {
    this.offMessage();
    for (const finish of [...this.pending.values()]) {
      finish({ point: "(disposed)", timedOut: true });
    }
    this.pending.clear();
    this.pendingSince.clear();
    this.localArrived.clear();
    this.partnerArrived.clear();
  }

  private handle(msg: CoopMessage): void {
    if (msg.t !== "rendezvous") {
      return;
    }
    const { point } = msg;
    if (this.partnerArrived.has(point)) {
      // Idempotent: a duplicate / re-delivered arrival for a point already seen is a harmless no-op.
      if (isCoopDebug()) {
        coopLog("rendezvous", `RECV arrival point=${point} -> DUPLICATE (already seen) role=${this.transport.role}`);
      }
      return;
    }
    this.partnerArrived.add(point);
    const waiter = this.pending.get(point);
    if (waiter) {
      if (isCoopDebug()) {
        coopLog("rendezvous", `RECV arrival point=${point} -> deliver-to-waiter role=${this.transport.role}`);
      }
      waiter({ point, timedOut: false });
      return;
    }
    // #847 CROSS-POINT RELEASE (live): no waiter for THIS point, but we may be parked awaiting a DIFFERENT
    // point. If this arrival is for a point we have NOT locally reached (excluding it never satisfies our
    // OWN progression), the partner has diverged onto another branch and will never reach the point(s) we
    // await - release each such parked waiter INFO (crossPoint), NOT the dead-partner WARN. The arrival
    // itself stays BUFFERED (partnerArrived) so its own eventual await still buffer-hits both-arrived.
    if (this.pending.size > 0 && !this.localArrived.has(point)) {
      let released = false;
      for (const [waitPoint, finish] of [...this.pending.entries()]) {
        if (waitPoint !== point) {
          coopLog(
            "rendezvous",
            `RECV arrival point=${point} -> CROSS-POINT release of AWAIT ${waitPoint} role=${this.transport.role}`,
          );
          finish({ point: waitPoint, timedOut: false, crossPoint: point });
          released = true;
        }
      }
      if (released) {
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
}
