/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 1 (explicit runtime ownership): the concrete
// CoopScheduler (frozen contract src/data/elite-redux/coop/authority-v2/contract.ts).
//
// This is the runtime-owned clock/timer surface. Every v2 timer goes through it
// - never a raw setTimeout - so ownership, addressing, and suspension pause are
// uniform (contract ownership rule: "every timer has an address and owner").
//
// ACTIVE-TIME CLASSES (frozen contract, CoopTimeClass):
//   - "connected" / "recovery" / "renderer" / "humanInput" are ACTIVE-time
//     classes: they consume time ONLY while their class is UNPAUSED. A document
//     hidden pauses all of them; a disconnect pauses just "connected". A paused
//     class's timers freeze - their REMAINING active time is stored and re-armed
//     on resume, never advancing while paused.
//   - "absolute" is the safety ceiling: it ALWAYS runs (never pausable), so a
//     hard deadline can never be indefinitely deferred by suspension.
//
// ENGINE-FREE: this module imports NOTHING from Phaser/engine at runtime. The
// only contract imports are type-only. The wall clock + timer primitives are
// injectable (CoopSchedulerClock) so the scheduler is unit-testable in pure Node
// with a deterministic fake clock, and default to Date.now / setTimeout.
// =============================================================================

import type { CoopScheduler, CoopTimeClass, CoopTimerOwner } from "#data/elite-redux/coop/authority-v2/contract";

/** Opaque handle returned by a {@link CoopSchedulerClock}'s timer primitive. */
export type CoopTimerHandle = unknown;

/**
 * Injectable wall clock + timer primitives. Defaults to `Date.now` and the
 * ambient `setTimeout`/`clearTimeout`; tests inject a deterministic fake so the
 * scheduler's active-time and pause/resume behaviour can be asserted without
 * real time or an engine.
 */
export interface CoopSchedulerClock {
  /** Monotonic-enough wall milliseconds (only differences are used). */
  now(): number;
  /** Arm a wall-time timer; returns a handle for {@link clearTimer}. */
  setTimer(callback: () => void, delayMs: number): CoopTimerHandle;
  /** Cancel a previously-armed wall-time timer. */
  clearTimer(handle: CoopTimerHandle): void;
}

const DEFAULT_CLOCK: CoopSchedulerClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** The four ACTIVE-time classes that consume time only while unpaused. */
const PAUSABLE_CLASSES: readonly CoopTimeClass[] = ["connected", "recovery", "renderer", "humanInput"];

function isPausableClass(timeClass: CoopTimeClass): boolean {
  return timeClass !== "absolute";
}

/**
 * A single time class's active-milliseconds accumulator. `now()` advances with
 * wall time only while the class is running; while paused it is frozen.
 */
class ActiveClock {
  private accumulated = 0;
  private runningSince: number | null;

  constructor(wallNow: number, running: boolean) {
    this.runningSince = running ? wallNow : null;
  }

  get running(): boolean {
    return this.runningSince !== null;
  }

  now(wallNow: number): number {
    return this.accumulated + (this.runningSince === null ? 0 : wallNow - this.runningSince);
  }

  pause(wallNow: number): void {
    if (this.runningSince !== null) {
      this.accumulated += wallNow - this.runningSince;
      this.runningSince = null;
    }
  }

  resume(wallNow: number): void {
    if (this.runningSince === null) {
      this.runningSince = wallNow;
    }
  }
}

/** One scheduled timer. `remainingActive` is what survives across pauses. */
interface TimerRecord {
  readonly id: number;
  readonly owner: CoopTimerOwner;
  readonly timeClass: CoopTimeClass;
  readonly callback: () => void;
  /** Active milliseconds left until fire; frozen while the class is paused. */
  remainingActive: number;
  /** Wall time the live handle was armed, or null while paused/unarmed. */
  armedAtWall: number | null;
  /** Live wall-timer handle, or null while paused/unarmed. */
  handle: CoopTimerHandle | null;
  /** Set once cancelled/disposed; the wrapped callback becomes a no-op. */
  cancelled: boolean;
}

/**
 * Concrete {@link CoopScheduler}. Beyond the contract surface it exposes
 * pause/resume of a time class (with refcounted reasons, so overlapping
 * suspension sources - document hidden AND disconnected - compose correctly)
 * and a `dispose` teardown that makes every outstanding callback a no-op.
 */
export class CoopSchedulerImpl implements CoopScheduler {
  private readonly clock: CoopSchedulerClock;
  private readonly startWall: number;
  private readonly clocks = new Map<CoopTimeClass, ActiveClock>();
  /** Active pause reasons per pausable class; a class runs iff its set is empty. */
  private readonly pauseReasons = new Map<CoopTimeClass, Set<string>>();
  private readonly timers = new Map<number, TimerRecord>();
  private nextId = 1;
  private disposed = false;

  constructor(clock: CoopSchedulerClock = DEFAULT_CLOCK) {
    this.clock = clock;
    this.startWall = clock.now();
    // "absolute" always runs; the four active classes start running (unpaused).
    this.clocks.set("absolute", new ActiveClock(this.startWall, true));
    for (const tc of PAUSABLE_CLASSES) {
      this.clocks.set(tc, new ActiveClock(this.startWall, true));
      this.pauseReasons.set(tc, new Set());
    }
  }

  // --- CoopScheduler contract -----------------------------------------------

  now(timeClass: CoopTimeClass): number {
    const clock = this.clocks.get(timeClass);
    return clock ? clock.now(this.clock.now()) : 0;
  }

  schedule(owner: CoopTimerOwner, delayMs: number, timeClass: CoopTimeClass, callback: () => void): () => void {
    if (this.disposed) {
      return () => {};
    }
    const record: TimerRecord = {
      id: this.nextId++,
      owner,
      timeClass,
      callback,
      remainingActive: Math.max(0, delayMs),
      armedAtWall: null,
      handle: null,
      cancelled: false,
    };
    this.timers.set(record.id, record);
    // Arm immediately only when the class is currently running; a timer
    // scheduled while its class is paused keeps its full remaining active time
    // and is armed on resume.
    if (this.isClassRunning(timeClass)) {
      this.arm(record);
    }
    return () => this.cancelTimer(record);
  }

  cancelOwner(ownerId: string): void {
    for (const record of [...this.timers.values()]) {
      if (record.owner.ownerId === ownerId) {
        this.cancelTimer(record);
      }
    }
  }

  // --- pause / resume -------------------------------------------------------

  /** Whether a class is currently consuming active time (always true for "absolute"). */
  isClassRunning(timeClass: CoopTimeClass): boolean {
    if (!isPausableClass(timeClass)) {
      return true;
    }
    const reasons = this.pauseReasons.get(timeClass);
    return !reasons || reasons.size === 0;
  }

  /** Whether a class is currently paused (never true for "absolute"). */
  isClassPaused(timeClass: CoopTimeClass): boolean {
    return isPausableClass(timeClass) && !this.isClassRunning(timeClass);
  }

  /**
   * Pause a class under `reason`. Idempotent per (class, reason). The class only
   * actually freezes when it transitions from zero to one pause reason, so
   * overlapping sources (document-hidden + disconnected) compose correctly.
   * "absolute" is never pausable and this is a no-op for it.
   */
  pauseClass(timeClass: CoopTimeClass, reason = "manual"): void {
    if (this.disposed || !isPausableClass(timeClass)) {
      return;
    }
    const reasons = this.pauseReasons.get(timeClass);
    if (!reasons) {
      return;
    }
    const wasRunning = reasons.size === 0;
    reasons.add(reason);
    if (wasRunning) {
      const wallNow = this.clock.now();
      this.clocks.get(timeClass)?.pause(wallNow);
      for (const record of this.timers.values()) {
        if (record.timeClass === timeClass) {
          this.disarm(record, wallNow);
        }
      }
    }
  }

  /**
   * Release one pause `reason` on a class. The class only resumes (and re-arms
   * its frozen timers with their stored remaining active time) when the LAST
   * reason is cleared.
   */
  resumeClass(timeClass: CoopTimeClass, reason = "manual"): void {
    if (this.disposed || !isPausableClass(timeClass)) {
      return;
    }
    const reasons = this.pauseReasons.get(timeClass);
    if (!reasons?.has(reason)) {
      return;
    }
    reasons.delete(reason);
    if (reasons.size === 0) {
      const wallNow = this.clock.now();
      this.clocks.get(timeClass)?.resume(wallNow);
      for (const record of this.timers.values()) {
        if (record.timeClass === timeClass) {
          this.arm(record);
        }
      }
    }
  }

  /**
   * Document visibility gate: hidden pauses every active class but "absolute";
   * visible releases that suspension. Uses a dedicated reason so it never
   * clears a disconnect-driven pause on "connected".
   */
  setDocumentHidden(hidden: boolean): void {
    for (const tc of PAUSABLE_CLASSES) {
      if (hidden) {
        this.pauseClass(tc, "document-hidden");
      } else {
        this.resumeClass(tc, "document-hidden");
      }
    }
  }

  /**
   * Connection gate: a disconnect pauses only the "connected" class (recovery /
   * renderer / human-input keep their own clocks); reconnect releases it.
   */
  setConnected(connected: boolean): void {
    if (connected) {
      this.resumeClass("connected", "disconnected");
    } else {
      this.pauseClass("connected", "disconnected");
    }
  }

  // --- teardown -------------------------------------------------------------

  /** Cancel every timer this scheduler owns; every pending callback becomes a no-op. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const record of this.timers.values()) {
      record.cancelled = true;
      if (record.handle !== null) {
        this.clock.clearTimer(record.handle);
        record.handle = null;
      }
    }
    this.timers.clear();
  }

  /** Number of live (uncancelled, unfired) timers - for zero-leak assertions. */
  get pendingTimerCount(): number {
    return this.timers.size;
  }

  // --- internals ------------------------------------------------------------

  private arm(record: TimerRecord): void {
    if (record.cancelled || record.handle !== null) {
      return;
    }
    record.armedAtWall = this.clock.now();
    record.handle = this.clock.setTimer(() => this.fire(record), record.remainingActive);
  }

  private disarm(record: TimerRecord, wallNow: number): void {
    if (record.handle === null) {
      return;
    }
    this.clock.clearTimer(record.handle);
    const elapsed = record.armedAtWall === null ? 0 : wallNow - record.armedAtWall;
    record.remainingActive = Math.max(0, record.remainingActive - elapsed);
    record.handle = null;
    record.armedAtWall = null;
  }

  private fire(record: TimerRecord): void {
    // Wrapped callback: a no-op after cancel/dispose (the record is gone).
    if (record.cancelled || this.disposed || !this.timers.has(record.id)) {
      return;
    }
    this.timers.delete(record.id);
    record.handle = null;
    record.armedAtWall = null;
    record.callback();
  }

  private cancelTimer(record: TimerRecord): void {
    if (record.cancelled) {
      return;
    }
    record.cancelled = true;
    if (record.handle !== null) {
      this.clock.clearTimer(record.handle);
      record.handle = null;
    }
    this.timers.delete(record.id);
  }
}

/** Build a concrete {@link CoopScheduler}. `clock` is injectable for tests. */
export function createCoopScheduler(clock: CoopSchedulerClock = DEFAULT_CLOCK): CoopSchedulerImpl {
  return new CoopSchedulerImpl(clock);
}
