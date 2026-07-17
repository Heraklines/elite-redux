/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane unit tests for co-op AUTHORITY V2 - Lane 1 (explicit runtime
// ownership): the scheduler, the runtime-context factory, and the lifecycle.
//
// These modules import NOTHING from Phaser/engine at runtime (BattleScene and
// CoopTransport are TYPE-ONLY, erased by esbuild), so the whole file runs in the
// node-pure project in milliseconds - no jsdom, no globalScene. The properties
// pinned here are the by-construction cure for the ambient-runtime bleed:
//   - a paused time class freezes its timers and resumes their REMAINING active
//     time (a suspended tab can never let a mechanical deadline fire early/late);
//   - "absolute" is the safety ceiling that ignores pause;
//   - cancel/dispose make every outstanding callback a no-op (no timer resumes
//     under a torn-down context);
//   - disposeAll leaves a zero-leak diagnostics snapshot and aborts the signal.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import type { CoopTimerOwner } from "#data/elite-redux/coop/authority-v2/contract";
import { CoopLifecycle } from "#data/elite-redux/coop/authority-v2/lifecycle";
import { createCoopRuntimeContext } from "#data/elite-redux/coop/authority-v2/runtime-context";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it, vi } from "vitest";

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

  /** Advance wall time, firing due callbacks in chronological order (re-arms welcome). */
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

/** Minimal engine-free CoopTransport (only the mandatory surface is exercised). */
class FakeTransport implements CoopTransport {
  readonly role: CoopRole = "host";
  state: CoopConnectionState = "connected";
  send(_msg: CoopMessage): void {}
  onMessage(_handler: (msg: CoopMessage) => void): () => void {
    return () => {};
  }
  onStateChange(_handler: (state: CoopConnectionState) => void): () => void {
    return () => {};
  }
  close(): void {}
}

// A BattleScene is never touched by these modules (constructor-injected + stored
// only); an empty stub cast to the type is the engine-free way to inject it.
const STUB_SCENE = {} as unknown as BattleScene;

function makeOwner(ownerId: string, address = `addr/${ownerId}`, reason = "test"): CoopTimerOwner {
  return { ownerId, address, reason };
}

function makeContext(clock: FakeClock) {
  const scheduler = createCoopScheduler(clock);
  const handle = createCoopRuntimeContext({
    runtimeId: "rt-1",
    sessionId: "sess-1",
    runId: "run-1",
    epoch: 3,
    localSeatId: 0,
    authoritySeatId: 0,
    membershipRevision: 1,
    scene: STUB_SCENE,
    transport: new FakeTransport(),
    scheduler,
  });
  return { scheduler, handle, context: handle.context };
}

// ===========================================================================
// Scheduler
// ===========================================================================

describe("authority-v2 CoopScheduler", () => {
  it("fires an active-class timer after its delay", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);
    const cb = vi.fn();
    scheduler.schedule(makeOwner("o"), 100, "connected", cb);

    clock.advance(99);
    expect(cb).not.toHaveBeenCalled();
    clock.advance(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("freezes a paused class's timers and resumes their REMAINING active time", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);
    const cb = vi.fn();
    scheduler.schedule(makeOwner("o"), 100, "connected", cb);

    clock.advance(40); // 60 active ms remain
    scheduler.pauseClass("connected", "test");
    clock.advance(10_000); // frozen: no active time accrues, no fire
    expect(cb).not.toHaveBeenCalled();

    scheduler.resumeClass("connected", "test");
    clock.advance(59);
    expect(cb).not.toHaveBeenCalled();
    clock.advance(1); // exactly the 60 remaining active ms
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("treats 'absolute' as a safety ceiling that ignores pause", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);
    const absolute = vi.fn();
    const connected = vi.fn();
    scheduler.setDocumentHidden(true); // pause everything pausable
    scheduler.schedule(makeOwner("o"), 50, "absolute", absolute);
    scheduler.schedule(makeOwner("o"), 50, "connected", connected);

    clock.advance(50);
    expect(absolute).toHaveBeenCalledTimes(1); // absolute still ran
    expect(connected).not.toHaveBeenCalled(); // connected is frozen
  });

  it("advances now() with active time only while the class is unpaused", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);

    clock.advance(30);
    expect(scheduler.now("connected")).toBe(30);
    expect(scheduler.now("absolute")).toBe(30);

    scheduler.pauseClass("connected");
    clock.advance(100);
    expect(scheduler.now("connected")).toBe(30); // frozen
    expect(scheduler.now("absolute")).toBe(130); // absolute keeps ticking

    scheduler.resumeClass("connected");
    clock.advance(5);
    expect(scheduler.now("connected")).toBe(35);
    expect(scheduler.now("absolute")).toBe(135);
  });

  it("cancelOwner cancels every timer for an owner and leaves others intact", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);
    const a1 = vi.fn();
    const a2 = vi.fn();
    const b1 = vi.fn();
    scheduler.schedule(makeOwner("A"), 50, "connected", a1);
    scheduler.schedule(makeOwner("A"), 80, "recovery", a2);
    scheduler.schedule(makeOwner("B"), 50, "connected", b1);

    scheduler.cancelOwner("A");
    clock.advance(100);
    expect(a1).not.toHaveBeenCalled();
    expect(a2).not.toHaveBeenCalled();
    expect(b1).toHaveBeenCalledTimes(1);
  });

  it("makes the returned cancel handle a no-op callback", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);
    const cb = vi.fn();
    const cancel = scheduler.schedule(makeOwner("o"), 50, "renderer", cb);

    cancel();
    clock.advance(100);
    expect(cb).not.toHaveBeenCalled();
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("dispose cancels everything; every pending callback becomes a no-op", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);
    const cbs = [vi.fn(), vi.fn(), vi.fn()];
    scheduler.schedule(makeOwner("o"), 20, "connected", cbs[0]);
    scheduler.schedule(makeOwner("o"), 40, "humanInput", cbs[1]);
    scheduler.schedule(makeOwner("p"), 60, "absolute", cbs[2]);

    scheduler.dispose();
    expect(scheduler.pendingTimerCount).toBe(0);
    clock.advance(1000);
    for (const cb of cbs) {
      expect(cb).not.toHaveBeenCalled();
    }
    // scheduling after dispose is inert
    const cb = vi.fn();
    scheduler.schedule(makeOwner("o"), 10, "connected", cb);
    clock.advance(100);
    expect(cb).not.toHaveBeenCalled();
  });

  it("composes overlapping suspension sources (document-hidden AND disconnected)", () => {
    const clock = new FakeClock();
    const scheduler = createCoopScheduler(clock);

    scheduler.setConnected(false); // disconnect pauses ONLY connected
    expect(scheduler.isClassPaused("connected")).toBe(true);
    expect(scheduler.isClassPaused("recovery")).toBe(false);

    scheduler.setDocumentHidden(true); // hidden pauses all pausable
    expect(scheduler.isClassPaused("connected")).toBe(true);
    expect(scheduler.isClassPaused("recovery")).toBe(true);
    expect(scheduler.isClassPaused("renderer")).toBe(true);
    expect(scheduler.isClassPaused("humanInput")).toBe(true);
    expect(scheduler.isClassRunning("absolute")).toBe(true);

    scheduler.setDocumentHidden(false); // visible again
    expect(scheduler.isClassPaused("recovery")).toBe(false);
    // connected is STILL paused - the disconnect reason outlives document-hidden
    expect(scheduler.isClassPaused("connected")).toBe(true);

    scheduler.setConnected(true);
    expect(scheduler.isClassPaused("connected")).toBe(false);
  });
});

// ===========================================================================
// Runtime context factory
// ===========================================================================

describe("authority-v2 createCoopRuntimeContext", () => {
  it("assembles an immutable frozen context carrying the injected fields + a live signal", () => {
    const { context } = makeContext(new FakeClock());

    expect(context.runtimeId).toBe("rt-1");
    expect(context.sessionId).toBe("sess-1");
    expect(context.runId).toBe("run-1");
    expect(context.epoch).toBe(3);
    expect(context.localSeatId).toBe(0);
    expect(context.authoritySeatId).toBe(0);
    expect(context.membershipRevision).toBe(1);
    expect(Object.isFrozen(context)).toBe(true);
    expect(context.cancellation.aborted).toBe(false);
  });

  it("dispose aborts the cancellation signal exactly once, with a reason", () => {
    const { handle, context } = makeContext(new FakeClock());
    const onAbort = vi.fn();
    context.cancellation.addEventListener("abort", onAbort);

    expect(handle.disposed).toBe(false);
    handle.dispose("teardown");
    expect(handle.disposed).toBe(true);
    expect(context.cancellation.aborted).toBe(true);
    expect(context.cancellation.reason).toBe("teardown");
    expect(onAbort).toHaveBeenCalledTimes(1);

    handle.dispose("again"); // idempotent - no second abort event
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(context.cancellation.reason).toBe("teardown");
  });

  it("gives each context its OWN AbortController (no shared/global state)", () => {
    const a = makeContext(new FakeClock());
    const b = makeContext(new FakeClock());

    a.handle.dispose("only-a");
    expect(a.context.cancellation.aborted).toBe(true);
    expect(b.context.cancellation.aborted).toBe(false);
  });
});

// ===========================================================================
// Lifecycle
// ===========================================================================

describe("authority-v2 CoopLifecycle", () => {
  it("tracks leases/waiters/timers and snapshots counts + owner addresses", () => {
    const { context, handle } = makeContext(new FakeClock());
    const lifecycle = new CoopLifecycle(context, handle.dispose);

    lifecycle.registerLease(makeOwner("lease-A", "field/0"), () => {});
    lifecycle.registerWaiter(makeOwner("wait-B", "turn/5"), () => {});
    lifecycle.registerTimerOwner(makeOwner("timer-C", "deadline/1"));

    const snap = lifecycle.snapshot();
    expect(snap.runtimeId).toBe("rt-1");
    expect(snap.disposed).toBe(false);
    expect(snap.counts).toEqual({ leases: 1, waiters: 1, timers: 1, total: 3 });
    const addresses = snap.owners.map(o => o.address).sort();
    expect(addresses).toEqual(["deadline/1", "field/0", "turn/5"]);
  });

  it("disposeAll cancels every resource, aborts the signal, and zero-leaks the snapshot", () => {
    const { context, handle } = makeContext(new FakeClock());
    const lifecycle = new CoopLifecycle(context, handle.dispose);
    const releaseLease = vi.fn();
    const abortWaiter = vi.fn();
    lifecycle.registerLease(makeOwner("lease-A"), releaseLease);
    lifecycle.registerWaiter(makeOwner("wait-B"), abortWaiter);

    lifecycle.disposeAll("shutdown");

    expect(releaseLease).toHaveBeenCalledWith("shutdown");
    expect(abortWaiter).toHaveBeenCalledWith("shutdown");
    expect(context.cancellation.aborted).toBe(true);
    expect(context.cancellation.reason).toBe("shutdown");
    expect(lifecycle.isDisposed).toBe(true);

    const snap = lifecycle.snapshot();
    expect(snap.disposed).toBe(true);
    expect(snap.counts.total).toBe(0);
    expect(snap.owners).toEqual([]);

    lifecycle.disposeAll("again"); // idempotent
    expect(releaseLease).toHaveBeenCalledTimes(1);
  });

  it("does not double-cancel a normally-released (unregistered) resource", () => {
    const { context, handle } = makeContext(new FakeClock());
    const lifecycle = new CoopLifecycle(context, handle.dispose);
    const release = vi.fn();
    const unregister = lifecycle.registerLease(makeOwner("lease-A"), release);

    unregister(); // orderly release already ran its own teardown
    expect(lifecycle.snapshot().counts.total).toBe(0);

    lifecycle.disposeAll("shutdown");
    expect(release).not.toHaveBeenCalled();
  });

  it("registerTimerOwner cancels the owner's scheduler timers on disposeAll", () => {
    const clock = new FakeClock();
    const { context, handle, scheduler } = makeContext(clock);
    const lifecycle = new CoopLifecycle(context, handle.dispose);
    const cb = vi.fn();
    const owner = makeOwner("timer-C");
    scheduler.schedule(owner, 50, "connected", cb);
    lifecycle.registerTimerOwner(owner);

    lifecycle.disposeAll("shutdown");
    expect(scheduler.pendingTimerCount).toBe(0);
    clock.advance(100);
    expect(cb).not.toHaveBeenCalled();
  });

  it("immediately cancels a resource registered after disposeAll (no post-dispose leak)", () => {
    const { context, handle } = makeContext(new FakeClock());
    const lifecycle = new CoopLifecycle(context, handle.dispose);
    lifecycle.disposeAll("shutdown");

    const lateRelease = vi.fn();
    const unregister = lifecycle.registerLease(makeOwner("late"), lateRelease);
    expect(lateRelease).toHaveBeenCalledWith("registered-after-dispose");
    expect(lifecycle.snapshot().counts.total).toBe(0);
    unregister(); // no-op, does not throw
  });
});
