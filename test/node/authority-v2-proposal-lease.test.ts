/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopV2ProposalLeaseManager } from "#data/elite-redux/coop/authority-v2/proposal-lease";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import { describe, expect, it, vi } from "vitest";

class FakeClock implements CoopSchedulerClock {
  private time = 0;
  private sequence = 1;
  private readonly pending = new Map<number, { readonly at: number; readonly callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimer(callback: () => void, delayMs: number): CoopTimerHandle {
    const id = this.sequence++;
    this.pending.set(id, { at: this.time + Math.max(0, delayMs), callback });
    return id;
  }

  clearTimer(handle: CoopTimerHandle): void {
    this.pending.delete(handle as number);
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.pending.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (next == null) {
        break;
      }
      this.pending.delete(next[0]);
      this.time = next[1].at;
      next[1].callback();
    }
    this.time = target;
  }
}

function setup() {
  const clock = new FakeClock();
  const scheduler = createCoopScheduler(clock);
  const manager = new CoopV2ProposalLeaseManager(scheduler);
  return { clock, scheduler, manager };
}

describe("Authority V2 retained proposal lease", () => {
  it("sends immediately, retries on connected time, and settles only the exact committed operation", () => {
    const { clock, scheduler, manager } = setup();
    const resend = vi.fn();
    const exhausted = vi.fn();

    expect(
      manager.arm({
        operationId: "OP/1/1/1/REWARD",
        fingerprint: "intent-a",
        resend,
        onExhausted: exhausted,
        absoluteCeilingMs: 10_000,
      }),
    ).toBe("retained");
    expect(resend).toHaveBeenCalledTimes(1);
    expect(scheduler.pendingTimerCount).toBe(2);

    clock.advance(250);
    expect(resend).toHaveBeenCalledTimes(2);
    expect(manager.observeCommitted("OP/1/1/2/REWARD")).toBe(false);
    expect(manager.retainedCount).toBe(1);

    expect(manager.observeCommitted("OP/1/1/1/REWARD")).toBe(true);
    expect(manager.retainedCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
    clock.advance(20_000);
    expect(resend).toHaveBeenCalledTimes(2);
    expect(exhausted).not.toHaveBeenCalled();
  });

  it("closes a synchronous result-before-arm race and rejects conflicting operation reuse", () => {
    const { manager } = setup();
    expect(manager.observeCommitted("OP/1/1/3/REWARD")).toBe(false);
    expect(
      manager.arm({
        operationId: "OP/1/1/3/REWARD",
        fingerprint: "intent-a",
        resend: vi.fn(),
        onExhausted: vi.fn(),
      }),
    ).toBe("already-committed");

    expect(
      manager.arm({
        operationId: "OP/1/1/4/REWARD",
        fingerprint: "intent-a",
        resend: vi.fn(),
        onExhausted: vi.fn(),
      }),
    ).toBe("retained");
    expect(
      manager.arm({
        operationId: "OP/1/1/4/REWARD",
        fingerprint: "intent-b",
        resend: vi.fn(),
        onExhausted: vi.fn(),
      }),
    ).toBe("conflict");
  });

  it("pauses retries while disconnected but keeps the absolute fail-closed ceiling live", () => {
    const { clock, scheduler, manager } = setup();
    const resend = vi.fn();
    const exhausted = vi.fn();
    manager.arm({
      operationId: "OP/1/1/5/REWARD",
      fingerprint: "intent-a",
      resend,
      onExhausted: exhausted,
      absoluteCeilingMs: 1_000,
    });

    scheduler.setConnected(false);
    clock.advance(999);
    expect(resend).toHaveBeenCalledTimes(1);
    expect(exhausted).not.toHaveBeenCalled();
    clock.advance(1);
    expect(exhausted).toHaveBeenCalledOnce();
    expect(manager.retainedCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });

  it("rebind-wakes retained proposals and dispose cancels every owned timer", () => {
    const { scheduler, manager } = setup();
    const resend = vi.fn();
    manager.arm({
      operationId: "OP/1/1/6/REWARD",
      fingerprint: "intent-a",
      resend,
      onExhausted: vi.fn(),
    });
    expect(manager.resendRetained()).toBe(1);
    expect(resend).toHaveBeenCalledTimes(2);
    manager.dispose();
    expect(manager.retainedCount).toBe(0);
    expect(scheduler.pendingTimerCount).toBe(0);
  });
});
