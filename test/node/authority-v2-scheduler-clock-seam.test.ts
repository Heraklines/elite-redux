/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Node-lane unit test for the TEST-ONLY scheduler clock override
// (setCoopSchedulerClockForTesting). This is the production seam the two-engine
// duo harness uses to drive the authority-log's ACTIVE-time redelivery backoff:
// the shadow builds its scheduler via `createCoopScheduler()` with NO argument
// (the production path), and that path adopts an installed override clock when one
// is present. The properties pinned here are the contract the harness relies on:
//   - with an override installed, `createCoopScheduler()` (no arg) uses it, so a
//     deterministic advance fires the scheduled timer (never real time);
//   - an EXPLICIT clock argument (the node unit tests) always wins over the
//     override - so this seam never perturbs the existing node tier;
//   - clearing the override (null) restores the real DEFAULT_CLOCK path, and a
//     scheduler built after the clear does NOT see the (disposed) fake clock.
//
// Engine-free: scheduler.ts imports nothing from Phaser/engine, so this runs in
// the node-pure project in milliseconds.
// =============================================================================

import type { CoopTimerOwner } from "#data/elite-redux/coop/authority-v2/contract";
import {
  type CoopSchedulerClock,
  type CoopTimerHandle,
  createCoopScheduler,
  setCoopSchedulerClockForTesting,
} from "#data/elite-redux/coop/authority-v2/scheduler";
import { afterEach, describe, expect, it } from "vitest";

/** A fully deterministic wall clock + timer queue (no real time) - the harness's clock, mirrored here. */
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

  get armedCount(): number {
    return this.pending.size;
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
}

const OWNER: CoopTimerOwner = { ownerId: "seam-test", address: "seam/test", reason: "clock seam" };

afterEach(() => {
  // Never let the override bleed across files (isolate: true here, but be explicit).
  setCoopSchedulerClockForTesting(null);
});

describe("authority-v2 scheduler test clock override (duo-harness redelivery seam)", () => {
  it("the production createCoopScheduler() path (no arg) adopts an installed override clock", () => {
    const clock = new FakeClock();
    setCoopSchedulerClockForTesting(clock);

    // The production shadow builds its scheduler exactly this way - no explicit clock.
    const scheduler = createCoopScheduler();
    let fired = 0;
    scheduler.schedule(OWNER, 250, "connected", () => {
      fired += 1;
    });

    // A real-time wait would not fire it deterministically; an explicit advance does.
    expect(fired).toBe(0);
    clock.advance(249);
    expect(fired).toBe(0);
    clock.advance(1);
    expect(fired).toBe(1);
    scheduler.dispose();
  });

  it("one installed clock is shared by every scheduler built while it is set (host + guest lockstep)", () => {
    const clock = new FakeClock();
    setCoopSchedulerClockForTesting(clock);

    const host = createCoopScheduler();
    const guest = createCoopScheduler();
    let hostFired = 0;
    let guestFired = 0;
    host.schedule(OWNER, 250, "connected", () => {
      hostFired += 1;
    });
    guest.schedule(OWNER, 250, "connected", () => {
      guestFired += 1;
    });

    // One advance drives BOTH schedulers - the "advance the duo harness active time" property.
    clock.advance(300);
    expect(hostFired).toBe(1);
    expect(guestFired).toBe(1);
    host.dispose();
    guest.dispose();
  });

  it("an EXPLICIT clock argument wins over the override (the node unit tier is never perturbed)", () => {
    const override = new FakeClock();
    const explicit = new FakeClock();
    setCoopSchedulerClockForTesting(override);

    const scheduler = createCoopScheduler(explicit);
    let fired = 0;
    scheduler.schedule(OWNER, 100, "connected", () => {
      fired += 1;
    });

    // The timer is armed on the EXPLICIT clock, not the override.
    expect(explicit.armedCount).toBe(1);
    expect(override.armedCount).toBe(0);
    override.advance(1_000);
    expect(fired).toBe(0);
    explicit.advance(100);
    expect(fired).toBe(1);
    scheduler.dispose();
  });

  it("clearing the override restores the real clock path for schedulers built afterwards", () => {
    const clock = new FakeClock();
    setCoopSchedulerClockForTesting(clock);
    createCoopScheduler(); // adopts the fake clock
    setCoopSchedulerClockForTesting(null);

    // A scheduler built AFTER the clear does not touch the fake clock at all.
    const real = createCoopScheduler();
    real.schedule(OWNER, 10_000, "connected", () => {});
    expect(clock.armedCount).toBe(0);
    real.dispose();
  });
});
