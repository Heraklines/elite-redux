/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - RECOVERY TRANSACTION (Lane 4, frozen decision 5)
//
// The concrete CoopRecoveryTransaction. It runs the frozen sequence, in order,
// with the fence held for the whole of it:
//
//   acquire fence -> capture frontier -> request (AbortSignal-aware, scheduler-
//   timed on the "recovery" time class) -> validate -> apply material ->
//   adoptFrontier -> project nextControl -> ACK -> release.
//
// The fence is acquired BEFORE the request (the v1 defect was fencing AFTER the
// network result, letting local progression stale the snapshot the protocol
// then refused). While held, command admission, phase/control progression,
// retained materialization, and new authority-wait creation are all frozen, so
// the captured frontier cannot move under the in-flight snapshot.
//
// EVERY failure path terminalizes: the fence is released INTO the terminal
// freeze (a permanent freeze, never a silent park), and run() resolves
// "terminalized". Only the fully-completed happy path releases the fence open
// and resolves "recovered".
//
// Re-entry is guarded by the shared fence: a second transaction over the same
// context cannot acquire a held fence, so it is rejected without disturbing the
// live one (no module-global registry - the fence IS the guard). run() itself
// is idempotent per instance.
//
// ENGINE-FREE: only contract TYPES are imported; the log, projector, requester,
// applier, and acker are all injected. No Phaser, no globalScene.
// =============================================================================

import type {
  CoopAuthoritativeMaterial,
  CoopAuthorityLog,
  CoopControlProjector,
  CoopFrameContextV2,
  CoopRecoveryPhase,
  CoopRecoveryTransaction,
  CoopRuntimeContext,
  CoopTimerOwner,
} from "#data/elite-redux/coop/authority-v2/contract";
import type {
  CoopRecoveryAppliedProofV2,
  CoopRecoveryBundle,
  CoopRecoveryRequestV2,
} from "#data/elite-redux/coop/authority-v2/recovery-bundle";
import { validateRecoveryBundle } from "#data/elite-redux/coop/authority-v2/recovery-bundle";
import type { CoopRecoveryFence } from "#data/elite-redux/coop/authority-v2/recovery-fence";

/** Raised internally when the fence aborts an in-flight request (timeout / cancel / explicit abort). */
export class CoopRecoveryAbortError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "CoopRecoveryAbortError";
  }
}

/**
 * The injected surfaces a recovery transaction drives. Lanes 2/3 implement the
 * log + projector; the requester/applier/acker are the integration owner's
 * transport + snapshot seams. Every one is injected so this module stays
 * engine-free and unit-testable with mocks.
 */
export interface CoopRecoveryTransactionDeps {
  /** The ONE retained authoritative log (frontier capture + adopt). */
  readonly log: CoopAuthorityLog;
  /** Projects the bundle's stated nextControl into the local engine. */
  readonly projector: CoopControlProjector;
  /** The shared per-context fence (single-live-transaction guard). */
  readonly fence: CoopRecoveryFence;
  /** The current live frame context (re-read at validate time). */
  readonly frame: () => CoopFrameContextV2;
  /** Stable, caller-minted identity for this one transaction. */
  readonly requestId: string;
  /** Diagnostic trigger carried on the correlated request. */
  readonly reason: string;
  /** Request one exact recovery bundle; MUST honor the AbortSignal. */
  readonly request: (
    ctx: CoopRuntimeContext,
    request: CoopRecoveryRequestV2,
    signal: AbortSignal,
  ) => Promise<CoopRecoveryBundle>;
  /** Install the canonical material image; returns whether it applied exactly. */
  readonly applyMaterial: (ctx: CoopRuntimeContext, material: CoopAuthoritativeMaterial) => boolean | Promise<boolean>;
  /**
   * Prove this correlated bundle completed. This closes response retransmission only; AuthorityLog entries
   * remain governed by their ordinary exact-operation receipts.
   */
  readonly acknowledge: (ctx: CoopRuntimeContext, proof: CoopRecoveryAppliedProofV2) => void;
  /** Recovery request deadline in "recovery"-class ms. Default 300_000. */
  readonly requestTimeoutMs?: number;
  /** Optional phase observer (fires on every reached phase, in order). */
  readonly onPhase?: (phase: CoopRecoveryPhase) => void;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

class RecoveryTransaction implements CoopRecoveryTransaction {
  public readonly ctx: CoopRuntimeContext;
  private currentPhase: CoopRecoveryPhase = "fence-acquired";
  private frontier = -1;
  private readonly deps: CoopRecoveryTransactionDeps;
  private readonly abortController = new AbortController();
  private outcome: Promise<"recovered" | "terminalized"> | undefined;

  constructor(ctx: CoopRuntimeContext, deps: CoopRecoveryTransactionDeps) {
    if (deps.requestId.length === 0 || deps.reason.length === 0) {
      throw new Error("CoopRecoveryTransaction requires a non-empty request identity and reason");
    }
    this.ctx = ctx;
    this.deps = deps;
  }

  public get phase(): CoopRecoveryPhase {
    return this.currentPhase;
  }

  public get capturedFrontier(): number {
    return this.frontier;
  }

  public run(): Promise<"recovered" | "terminalized"> {
    // Idempotent per instance: a second run() returns the same in-flight result.
    if (this.outcome !== undefined) {
      return this.outcome;
    }
    this.outcome = this.execute();
    return this.outcome;
  }

  public abort(reason: string): void {
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(new CoopRecoveryAbortError(reason));
    }
  }

  private enter(phase: CoopRecoveryPhase): void {
    this.currentPhase = phase;
    try {
      this.deps.onPhase?.(phase);
    } catch {
      // The phase observer is advisory; never let it break the transaction.
    }
  }

  /** Terminalize: release the fence INTO the terminal freeze, never a silent park. */
  private terminalize(reason: string): "terminalized" {
    this.deps.fence.terminalize(reason);
    this.enter("terminalized");
    return "terminalized";
  }

  private timerOwner(): CoopTimerOwner {
    return {
      ownerId: `recovery:${this.ctx.runtimeId}:${this.ctx.epoch}`,
      address: `recovery/${this.ctx.sessionId}/${this.ctx.runId}/${this.deps.requestId}`,
      reason: "authority-v2 recovery request deadline",
    };
  }

  /** Race the request against fence/scheduler/context aborts, all on "recovery" time. */
  private async requestBundle(): Promise<CoopRecoveryBundle> {
    const signal = this.abortController.signal;

    // Fold the runtime's own cancellation into ours.
    if (this.ctx.cancellation.aborted) {
      this.abort("runtime cancellation already aborted");
    } else {
      this.ctx.cancellation.addEventListener("abort", () => this.abort("runtime cancellation aborted"), { once: true });
    }

    // Scheduler-timed deadline on the "recovery" time class (never raw setTimeout).
    const timeoutMs = this.deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const cancelTimer = this.ctx.scheduler.schedule(this.timerOwner(), timeoutMs, "recovery", () =>
      this.abort(`recovery request exceeded ${timeoutMs}ms`),
    );

    const abortPromise = new Promise<never>((_resolve, reject) => {
      if (signal.aborted) {
        reject(this.abortReason());
        return;
      }
      signal.addEventListener("abort", () => reject(this.abortReason()), { once: true });
    });

    try {
      return await Promise.race([
        this.deps.request(
          this.ctx,
          {
            requestId: this.deps.requestId,
            capturedFrontier: this.frontier,
            reason: this.deps.reason,
          },
          signal,
        ),
        abortPromise,
      ]);
    } finally {
      cancelTimer();
    }
  }

  private abortReason(): CoopRecoveryAbortError {
    const reason = this.abortController.signal.reason;
    if (reason instanceof CoopRecoveryAbortError) {
      return reason;
    }
    return new CoopRecoveryAbortError(typeof reason === "string" ? reason : "recovery aborted");
  }

  private async execute(): Promise<"recovered" | "terminalized"> {
    // --- guard: one live transaction per context (the fence IS the registry) ---
    if (!this.deps.fence.acquire()) {
      // A held fence means another live transaction owns this context, so this
      // duplicate is REJECTED without terminalizing (killing the live one's
      // fence would defeat the recovery in progress); a terminal fence means the
      // session already died. Either way this attempt reports "terminalized"
      // without touching the shared fence.
      this.enter("terminalized");
      return "terminalized";
    }
    this.enter("fence-acquired");

    // --- capture frontier under the fence, BEFORE any request goes out ---
    this.frontier = this.deps.log.appliedThrough();
    this.enter("frontier-captured");

    // --- request the exact bundle (fenced, abortable, scheduler-timed) ---
    const requested = await this.performRequest();
    if (!requested.ok) {
      return this.terminalize(requested.reason);
    }
    this.enter("requested");

    return this.finalize(requested.bundle);
  }

  /** Await the fenced request; classify an abort/failure without applying anything. */
  private async performRequest(): Promise<{ ok: true; bundle: CoopRecoveryBundle } | { ok: false; reason: string }> {
    let bundle: CoopRecoveryBundle;
    try {
      bundle = await this.requestBundle();
    } catch (error) {
      const reason =
        error instanceof CoopRecoveryAbortError
          ? `recovery request aborted: ${error.message}`
          : `recovery request failed: ${describeError(error)}`;
      return { ok: false, reason };
    }
    if (this.abortController.signal.aborted) {
      return { ok: false, reason: `recovery aborted after request: ${this.abortReason().message}` };
    }
    return { ok: true, bundle };
  }

  /** The atomic apply half of the sequence; every failure returns "terminalized". */
  private async finalize(bundle: CoopRecoveryBundle): Promise<"recovered" | "terminalized"> {
    const validateReason = this.validateFenced(bundle);
    if (validateReason !== undefined) {
      return this.terminalize(validateReason);
    }
    this.enter("validated");

    const applyReason = await this.installMaterial(bundle);
    if (applyReason !== undefined) {
      return this.terminalize(applyReason);
    }
    this.enter("material-applied");

    try {
      this.deps.log.adoptFrontier(bundle.frontier);
    } catch (error) {
      return this.terminalize(`adoptFrontier threw: ${describeError(error)}`);
    }
    this.enter("frontier-installed");

    const control = this.installControl(bundle);
    if (!control.ok) {
      return this.terminalize(control.reason);
    }
    if (bundle.nextControl != null) {
      this.enter("control-installed");
    }

    const ackReason = this.sendAck(bundle, control.controlId);
    if (ackReason !== undefined) {
      return this.terminalize(ackReason);
    }
    this.enter("acked");

    // --- release the fence OPEN: progression resumes, recovery complete ---
    this.deps.fence.release();
    this.enter("released");
    return "recovered";
  }

  /**
   * Prove the fence held (the frontier did not move under the in-flight snapshot -
   * the exact v1 defect) and classify the bundle against the live frame + captured
   * frontier. Returns a terminalize reason, or undefined when valid.
   */
  private validateFenced(bundle: CoopRecoveryBundle): string | undefined {
    const liveFrontier = this.deps.log.appliedThrough();
    if (liveFrontier !== this.frontier) {
      return `frontier advanced under the fence (${this.frontier} -> ${liveFrontier}); snapshot is stale`;
    }
    const verdict = validateRecoveryBundle(bundle, this.deps.frame(), this.frontier, this.deps.requestId);
    if (verdict.kind !== "valid") {
      return `recovery bundle ${verdict.kind}: ${verdict.reason}`;
    }
    return;
  }

  /** Apply the material image; returns a terminalize reason, or undefined on success. */
  private async installMaterial(bundle: CoopRecoveryBundle): Promise<string | undefined> {
    let applied: boolean;
    try {
      applied = await this.deps.applyMaterial(this.ctx, bundle.material);
    } catch (error) {
      return `material apply threw: ${describeError(error)}`;
    }
    return applied ? undefined : "material could not be applied exactly";
  }

  /**
   * Project the stated nextControl (only when non-null). A recovery MUST land its
   * control mechanically, so a deferred/rejected projection is a hard stop here,
   * not engine pacing.
   */
  private installControl(bundle: CoopRecoveryBundle): { ok: true; controlId?: string } | { ok: false; reason: string } {
    if (bundle.nextControl == null) {
      return { ok: true };
    }
    let result: ReturnType<CoopControlProjector["project"]>;
    try {
      result = this.deps.projector.project(this.ctx, bundle.nextControl);
    } catch (error) {
      return { ok: false, reason: `control projection threw: ${describeError(error)}` };
    }
    if (result.kind === "installed" || result.kind === "already-installed") {
      return { ok: true, controlId: result.controlId };
    }
    return { ok: false, reason: `control projection ${result.kind}: ${result.reason}` };
  }

  /**
   * Emit a correlated recovery-completion proof. This is deliberately not an AuthorityReceipt: a snapshot
   * has no synthetic log operation and therefore cannot forge an operationId or retire another peer's lease.
   */
  private sendAck(bundle: CoopRecoveryBundle, controlId: string | undefined): string | undefined {
    const proof: CoopRecoveryAppliedProofV2 = {
      requestId: bundle.requestId,
      frontier: bundle.frontier,
      materialDigest: bundle.material.digest,
      ...(controlId === undefined ? {} : { controlId }),
    };
    try {
      this.deps.acknowledge(this.ctx, proof);
    } catch (error) {
      return `ack threw: ${describeError(error)}`;
    }
    return;
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : String(error);
}

/**
 * Build a recovery transaction for a context. The fence is injected (shared per
 * context) so a second transaction over the same context is rejected by the
 * single-live-transaction guard.
 */
export function createRecoveryTransaction(
  ctx: CoopRuntimeContext,
  deps: CoopRecoveryTransactionDeps,
): CoopRecoveryTransaction {
  return new RecoveryTransaction(ctx, deps);
}
