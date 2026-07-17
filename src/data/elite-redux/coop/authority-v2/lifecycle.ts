/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 1 (explicit runtime ownership): CoopLifecycle
// (frozen contract src/data/elite-redux/coop/authority-v2/contract.ts).
//
// Every lease, waiter, and timer owner that is created UNDER a CoopRuntimeContext
// registers here, so teardown is total and provable: `disposeAll(reason)` cancels
// every tracked resource AND aborts the context's cancellation signal, and the
// diagnostics snapshot (counts + owner addresses) is what the zero-leak teardown
// assertions read. This is the by-construction cure for the ambient-runtime
// bleed: nothing outlives its context.
//
// ENGINE-FREE: contract types are TYPE-ONLY imports; the scheduler + context
// disposer are injected values, so nothing from Phaser/engine is imported at
// runtime. No module-global mutable state - all tracking is per-instance.
// =============================================================================

import type { CoopRuntimeContext, CoopTimerOwner } from "#data/elite-redux/coop/authority-v2/contract";

/** What kind of runtime-owned resource a tracked entry represents. */
export type CoopLifecycleResourceKind = "lease" | "waiter" | "timer";

/**
 * One tracked resource. `cancel(reason)` MUST be idempotent - `disposeAll` and a
 * normal release can both reach it. `ownerId`/`address` mirror a
 * {@link CoopTimerOwner} so a leak snapshot names the exact owner.
 */
export interface CoopLifecycleResource {
  readonly kind: CoopLifecycleResourceKind;
  readonly ownerId: string;
  readonly address: string;
  readonly reason: string;
  cancel(reason: string): void;
}

/** One owner entry in a diagnostics snapshot. */
export interface CoopLifecycleOwnerInfo {
  readonly kind: CoopLifecycleResourceKind;
  readonly ownerId: string;
  readonly address: string;
  readonly reason: string;
}

/** Immutable teardown-diagnostics snapshot (counts + owner addresses). */
export interface CoopLifecycleSnapshot {
  readonly runtimeId: string;
  readonly disposed: boolean;
  readonly counts: {
    readonly leases: number;
    readonly waiters: number;
    readonly timers: number;
    readonly total: number;
  };
  readonly owners: readonly CoopLifecycleOwnerInfo[];
}

/** The context disposer (the runtime-context handle's `dispose`). */
export type CoopContextDisposer = (reason?: string) => void;

let LIFECYCLE_RESOURCE_SEQ = 0;

/**
 * Tracks every lease/waiter/timer registered under one {@link CoopRuntimeContext}.
 * Construct it with the context and the context handle's disposer so
 * `disposeAll` can abort the cancellation signal after cancelling resources.
 */
export class CoopLifecycle {
  private readonly context: CoopRuntimeContext;
  private readonly disposeContext: CoopContextDisposer;
  private readonly resources = new Map<number, CoopLifecycleResource>();
  private disposed = false;

  constructor(context: CoopRuntimeContext, disposeContext: CoopContextDisposer) {
    this.context = context;
    this.disposeContext = disposeContext;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Register any resource. Returns an `unregister` that removes it WITHOUT
   * cancelling (a normal, orderly release). If the lifecycle is already disposed
   * the resource is cancelled immediately and never tracked (no post-dispose
   * leak), and a no-op unregister is returned.
   */
  register(resource: CoopLifecycleResource): () => void {
    if (this.disposed) {
      resource.cancel("registered-after-dispose");
      return () => {};
    }
    const id = ++LIFECYCLE_RESOURCE_SEQ;
    this.resources.set(id, resource);
    return () => {
      this.resources.delete(id);
    };
  }

  /**
   * Track a lease. `release(reason)` is the lease's own idempotent teardown; it
   * is called on `disposeAll`. The returned unregister is for a normal release
   * that has already run `release` itself.
   */
  registerLease(owner: CoopTimerOwner, release: (reason: string) => void): () => void {
    return this.register({
      kind: "lease",
      ownerId: owner.ownerId,
      address: owner.address,
      reason: owner.reason,
      cancel: release,
    });
  }

  /**
   * Track a waiter. `abort(reason)` aborts the waiter's own AbortSignal (contract:
   * "every wait owns an AbortSignal"); it is called on `disposeAll`.
   */
  registerWaiter(owner: CoopTimerOwner, abort: (reason: string) => void): () => void {
    return this.register({
      kind: "waiter",
      ownerId: owner.ownerId,
      address: owner.address,
      reason: owner.reason,
      cancel: abort,
    });
  }

  /**
   * Track a timer owner. On `disposeAll` the owner's timers are cancelled via the
   * context scheduler's `cancelOwner`, so a torn-down lifecycle leaves no armed
   * timer behind.
   */
  registerTimerOwner(owner: CoopTimerOwner): () => void {
    return this.register({
      kind: "timer",
      ownerId: owner.ownerId,
      address: owner.address,
      reason: owner.reason,
      cancel: () => this.context.scheduler.cancelOwner(owner.ownerId),
    });
  }

  /**
   * Cancel every tracked resource and abort the context's cancellation signal.
   * Idempotent: a second call is a no-op. Resources are cancelled first, then the
   * signal is aborted, so a wait observing the abort sees an already-clean world.
   */
  disposeAll(reason: string): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const resources = [...this.resources.values()];
    this.resources.clear();
    for (const resource of resources) {
      resource.cancel(reason);
    }
    this.disposeContext(reason);
  }

  /** Teardown-diagnostics snapshot: counts by kind + every tracked owner address. */
  snapshot(): CoopLifecycleSnapshot {
    let leases = 0;
    let waiters = 0;
    let timers = 0;
    const owners: CoopLifecycleOwnerInfo[] = [];
    for (const resource of this.resources.values()) {
      switch (resource.kind) {
        case "lease":
          leases++;
          break;
        case "waiter":
          waiters++;
          break;
        case "timer":
          timers++;
          break;
      }
      owners.push({
        kind: resource.kind,
        ownerId: resource.ownerId,
        address: resource.address,
        reason: resource.reason,
      });
    }
    return {
      runtimeId: this.context.runtimeId,
      disposed: this.disposed,
      counts: { leases, waiters, timers, total: leases + waiters + timers },
      owners,
    };
  }
}
