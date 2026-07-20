/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - RETAINED INPUT PROPOSALS.
//
// A non-authority seat cannot append directly to the mechanical log. Its human
// choice is therefore a proposal until the authority publishes the matching
// immutable result. Reliable WebRTC delivery is insufficient across replacement
// of the underlying SCTP association: a send accepted by generation N can be
// lost before application and will not be replayed by generation N+1.
//
// This manager retains only the canonical proposal and resends it through the
// current transport seam until the exact operation appears in the ordered V2
// log. It never allocates a revision, applies material, or authorizes control.
// Connected-time retries pause while disconnected; an absolute ceiling remains
// live so a permanently uncommittable proposal fails closed instead of waiting
// forever.
//
// ENGINE-FREE: scheduler and resend/exhaustion callbacks are injected.
// =============================================================================

import type { CoopSchedulerImpl } from "#data/elite-redux/coop/authority-v2/scheduler";

const INITIAL_RETRY_MS = 250;
const MAX_RETRY_MS = 5_000;
const DEFAULT_ABSOLUTE_CEILING_MS = 1_200_000;

export interface CoopV2InteractionProposalLease {
  /** Exact operation that the authority must eventually publish. */
  readonly operationId: string;
  /** Stable canonical encoding of the complete proposal intent. */
  readonly fingerprint: string;
  /** Sends through the currently bound transport/relay generation. */
  readonly resend: () => void;
  /** Shared-terminal escalation after the non-pausable safety ceiling. */
  readonly onExhausted: (operationId: string) => void;
  /** Tests may shorten the ceiling; production defaults to twenty minutes. */
  readonly absoluteCeilingMs?: number;
}

export type CoopV2ProposalLeaseArmResult =
  | "retained"
  | "already-retained"
  | "already-committed"
  | "conflict"
  | "invalid"
  | "disposed";

interface ActiveProposalLease {
  readonly operationId: string;
  readonly fingerprint: string;
  resend: () => void;
  onExhausted: (operationId: string) => void;
  retryAttempt: number;
  cancelRetry: () => void;
  cancelCeiling: () => void;
}

function validLease(input: CoopV2InteractionProposalLease): boolean {
  return (
    typeof input.operationId === "string"
    && input.operationId.length > 0
    && typeof input.fingerprint === "string"
    && input.fingerprint.length > 0
    && typeof input.resend === "function"
    && typeof input.onExhausted === "function"
    && (input.absoluteCeilingMs === undefined
      || (Number.isSafeInteger(input.absoluteCeilingMs) && input.absoluteCeilingMs > 0))
  );
}

/**
 * One session-scoped owner for every uncommitted guest proposal.
 *
 * `committed` is intentionally retained for the lifetime of the session. It
 * closes the synchronous loopback race where the result is admitted before the
 * caller finishes arming its lease, and permanently rejects reuse of an exact
 * operation ID for a second human intent.
 */
export class CoopV2ProposalLeaseManager {
  private readonly active = new Map<string, ActiveProposalLease>();
  private readonly committed = new Set<string>();
  private disposed = false;

  constructor(private readonly scheduler: CoopSchedulerImpl) {}

  arm(input: CoopV2InteractionProposalLease): CoopV2ProposalLeaseArmResult {
    if (this.disposed) {
      return "disposed";
    }
    if (!validLease(input)) {
      return "invalid";
    }
    if (this.committed.has(input.operationId)) {
      return "already-committed";
    }
    const existing = this.active.get(input.operationId);
    if (existing != null) {
      if (existing.fingerprint !== input.fingerprint) {
        return "conflict";
      }
      // Refresh callbacks so a hot-rejoin retransmission always resolves the
      // current relay rather than a superseded channel object.
      existing.resend = input.resend;
      existing.onExhausted = input.onExhausted;
      this.tryResend(existing);
      return "already-retained";
    }

    const lease: ActiveProposalLease = {
      operationId: input.operationId,
      fingerprint: input.fingerprint,
      resend: input.resend,
      onExhausted: input.onExhausted,
      retryAttempt: 0,
      cancelRetry: () => {},
      cancelCeiling: () => {},
    };
    this.active.set(input.operationId, lease);
    lease.cancelCeiling = this.scheduler.schedule(
      {
        ownerId: this.ownerId(input.operationId),
        address: input.operationId,
        reason: "v2 proposal absolute ceiling",
      },
      input.absoluteCeilingMs ?? DEFAULT_ABSOLUTE_CEILING_MS,
      "absolute",
      () => this.exhaust(input.operationId),
    );
    this.tryResend(lease);
    this.armRetry(lease);
    return "retained";
  }

  /** Settle only from an admitted ordered result carrying this exact operation ID. */
  observeCommitted(operationId: string): boolean {
    if (this.disposed || typeof operationId !== "string" || operationId.length === 0) {
      return false;
    }
    this.committed.add(operationId);
    const lease = this.active.get(operationId);
    if (lease == null) {
      return false;
    }
    this.cancel(lease);
    return true;
  }

  /** Re-send immediately after an authenticated channel-generation rebind. */
  resendRetained(): number {
    if (this.disposed) {
      return 0;
    }
    for (const lease of this.active.values()) {
      this.tryResend(lease);
    }
    return this.active.size;
  }

  get retainedCount(): number {
    return this.active.size;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const lease of [...this.active.values()]) {
      this.cancel(lease);
    }
    this.committed.clear();
  }

  private armRetry(lease: ActiveProposalLease): void {
    if (this.disposed || !this.active.has(lease.operationId)) {
      return;
    }
    const delay = Math.min(INITIAL_RETRY_MS * 2 ** Math.min(lease.retryAttempt, 5), MAX_RETRY_MS);
    lease.cancelRetry = this.scheduler.schedule(
      {
        ownerId: this.ownerId(lease.operationId),
        address: lease.operationId,
        reason: "v2 proposal retry",
      },
      delay,
      "connected",
      () => {
        if (this.disposed || !this.active.has(lease.operationId)) {
          return;
        }
        lease.retryAttempt += 1;
        this.tryResend(lease);
        this.armRetry(lease);
      },
    );
  }

  private tryResend(lease: ActiveProposalLease): void {
    try {
      lease.resend();
    } catch {
      // A transient send failure leaves the lease retained. The connected-time
      // retry or explicit rebind wake will try the same canonical proposal.
    }
  }

  private exhaust(operationId: string): void {
    const lease = this.active.get(operationId);
    if (lease == null) {
      return;
    }
    const onExhausted = lease.onExhausted;
    this.cancel(lease);
    try {
      onExhausted(operationId);
    } catch {
      // The caller's terminal callback must not unwind a scheduler tick.
    }
  }

  private cancel(lease: ActiveProposalLease): void {
    if (!this.active.delete(lease.operationId)) {
      return;
    }
    lease.cancelRetry();
    lease.cancelCeiling();
    this.scheduler.cancelOwner(this.ownerId(lease.operationId));
  }

  private ownerId(operationId: string): string {
    return `authority-v2:proposal:${operationId}`;
  }
}
