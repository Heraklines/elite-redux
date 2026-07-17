/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - Lane 2, pure ordering state (authority-ledger).
//
// The ordering brain of the log, with NO timers, NO transport, NO engine - just
// arithmetic over the ONE global revision domain (frozen decision 1). Split out
// so the concrete CoopAuthorityLog composes it and the properties below are
// unit-provable in isolation:
//   - AuthorityLedger: the replica-side applied-through cursor + duplicate/gap
//     classification + snapshot high-water adoption.
//   - BoundedRevisionWindow: a revision-ordered map with a hard capacity, so a
//     long-lived run cannot grow retention without bound (the safety valve the
//     prior dual-ledger design lacked - it grew until it raced itself).
//
// It replaces the receiver-idempotency + high-water logic of the retired
// coop-durability / coop-battle-stream retention systems; it imports from
// NEITHER.
// =============================================================================

/** How an incoming revision relates to the applied-through cursor. */
export type RevisionOrder = "duplicate" | "next" | "gap";

/**
 * The replica-side ordering cursor for the ONE global revision domain. A revision is applied EXACTLY once,
 * strictly in order: the next admissible revision is always `appliedThrough + 1`. Anything at/below the
 * cursor is a duplicate (a safe redelivery - never re-applied); anything above `cursor + 1` is a gap (the
 * replica must request the missing tail rather than apply out of order).
 *
 * Pure: it holds a single integer. The log wraps mutation (`markApplied`) around the real material apply,
 * and wraps classification (`classify`) around the admit decision.
 */
export class AuthorityLedger {
  private cursor: number;

  constructor(initialFrontier = 0) {
    this.cursor = Number.isSafeInteger(initialFrontier) && initialFrontier > 0 ? initialFrontier : 0;
  }

  /** The highest revision applied in order (0 before anything has been applied). */
  appliedThrough(): number {
    return this.cursor;
  }

  /** The first revision the replica still needs - the revision that fills a gap / the next admissible one. */
  missingFrom(): number {
    return this.cursor + 1;
  }

  /**
   * Classify an incoming revision against the cursor WITHOUT mutating: `duplicate` (revision <= cursor -
   * already applied), `next` (revision === cursor + 1 - admit + apply), or `gap` (revision > cursor + 1 -
   * request the tail). A non-positive / non-integer revision is treated as a duplicate (never admissible).
   */
  classify(revision: number): RevisionOrder {
    if (!Number.isSafeInteger(revision) || revision <= this.cursor) {
      return "duplicate";
    }
    return revision === this.cursor + 1 ? "next" : "gap";
  }

  /**
   * Advance the cursor for a revision that was applied in order. Returns true iff it advanced (the revision
   * was exactly `cursor + 1`); an out-of-order or duplicate revision leaves the cursor untouched and returns
   * false, so a caller can never silently skip a revision.
   */
  markApplied(revision: number): boolean {
    if (revision === this.cursor + 1) {
      this.cursor = revision;
      return true;
    }
    return false;
  }

  /**
   * Adopt a proven snapshot high-water (recovery): fast-forward the cursor to `revision` if it is ahead.
   * Unlike {@linkcode markApplied} this deliberately jumps a gap the snapshot has already filled. Monotonic -
   * a value at/below the cursor is ignored (a stale snapshot can never rewind the applied frontier).
   */
  adoptFrontier(revision: number): void {
    if (Number.isSafeInteger(revision) && revision > this.cursor) {
      this.cursor = revision;
    }
  }
}

/**
 * A revision-keyed map with a hard capacity, kept in ascending revision order. The concrete log uses it for
 * the authority's retained-but-unretired frontier: retention normally drains via the retirement rule, but a
 * pathological run (a peer that never acks) must not grow memory without bound - so the OLDEST retained
 * revision is evicted when the window overflows. Eviction is surfaced (returned from {@linkcode set}) so the
 * log can cancel the evicted entry's delivery lease and never leak a timer.
 *
 * Pure: no timers, no side effects beyond the map. Ordering is maintained on insert so iteration + oldest
 * lookup are O(n)/O(1) without re-sorting.
 */
export class BoundedRevisionWindow<T> {
  /** Ascending-by-revision list of retained keys (parallel to {@linkcode byRevision}). */
  private readonly order: number[] = [];
  private readonly byRevision = new Map<number, T>();

  constructor(private readonly capacity = 512) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error(`BoundedRevisionWindow capacity must be a positive integer (got ${capacity})`);
    }
  }

  /** Whether a revision is currently retained. */
  has(revision: number): boolean {
    return this.byRevision.has(revision);
  }

  /** The retained value for a revision, or undefined. */
  get(revision: number): T | undefined {
    return this.byRevision.get(revision);
  }

  /**
   * Retain a value under a revision, keeping ascending order. If the window is at capacity and this is a NEW
   * revision, the oldest retained revision is evicted and returned (its key + value) so the caller can
   * cancel its lease; otherwise null. Re-setting an existing revision overwrites in place (no eviction).
   */
  set(revision: number, value: T): { readonly revision: number; readonly value: T } | null {
    if (this.byRevision.has(revision)) {
      this.byRevision.set(revision, value);
      return null;
    }
    let evicted: { revision: number; value: T } | null = null;
    if (this.order.length >= this.capacity) {
      const oldest = this.order[0];
      const oldestValue = this.byRevision.get(oldest);
      this.order.shift();
      this.byRevision.delete(oldest);
      if (oldestValue !== undefined) {
        evicted = { revision: oldest, value: oldestValue };
      }
    }
    this.insertOrdered(revision);
    this.byRevision.set(revision, value);
    return evicted;
  }

  /** Remove a retained revision (retirement / subsumption). Returns true iff it was present. */
  delete(revision: number): boolean {
    if (!this.byRevision.delete(revision)) {
      return false;
    }
    const idx = this.order.indexOf(revision);
    if (idx >= 0) {
      this.order.splice(idx, 1);
    }
    return true;
  }

  /** Retained values in ascending revision order. */
  values(): T[] {
    return this.order.map(rev => this.byRevision.get(rev) as T);
  }

  /** Retained revisions in ascending order (a defensive copy). */
  revisions(): number[] {
    return [...this.order];
  }

  /** Number of retained revisions. */
  size(): number {
    return this.order.length;
  }

  /** Drop everything (teardown). */
  clear(): void {
    this.order.length = 0;
    this.byRevision.clear();
  }

  /** Insert a revision into {@linkcode order}, preserving ascending order. */
  private insertOrdered(revision: number): void {
    let lo = 0;
    let hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.order[mid] < revision) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.order.splice(lo, 0, revision);
  }
}
