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
//   - AuthorityLedger: the replica-side received/material/control frontiers +
//     duplicate/gap classification + snapshot high-water adoption.
//   - BoundedRevisionWindow: a revision-ordered map with a hard capacity, so a
//     long-lived run cannot grow retention without bound. Capacity pressure
//     REFUSES the new value; it never evicts unresolved authoritative truth.
//
// It replaces the receiver-idempotency + high-water logic of the retired
// coop-durability / coop-battle-stream retention systems; it imports from
// NEITHER.
// =============================================================================

/** How an incoming revision relates to the replica's three mechanical frontiers. */
export type RevisionOrder =
  | "duplicate-complete"
  | "duplicate-pending-material"
  | "duplicate-pending-control"
  | "next"
  | "gap";

/**
 * The replica-side ordering state for the ONE global revision domain. Receipt admission, canonical material
 * application, and successor-control installation are deliberately separate facts:
 *
 * - `receivedThrough`: the entry was validated and journaled in order.
 * - `materialAppliedThrough`: its canonical material was installed and verified.
 * - `controlInstalledThrough`: its mechanical successor is installed (or the entry stated no successor).
 *
 * At most one revision may sit between these frontiers. Revision N+1 is not admissible until N reaches its
 * required mechanical terminal stage. A redelivery of N therefore reports the exact unfinished stage:
 * retry material after a failed apply, retry only control after material succeeded, or re-publish the final
 * receipt after completion. This prevents the old admission==application lie from turning an apply failure
 * into a permanently green cursor.
 *
 * Pure: it holds only the three scalar frontiers. The log calls `markReceived` at admission and advances
 * material/control only from the live replica pipeline after those operations actually succeed.
 */
export class AuthorityLedger {
  private receivedCursor: number;
  private materialCursor: number;
  private controlCursor: number;

  constructor(initialFrontier = 0) {
    const frontier = Number.isSafeInteger(initialFrontier) && initialFrontier > 0 ? initialFrontier : 0;
    this.receivedCursor = frontier;
    this.materialCursor = frontier;
    this.controlCursor = frontier;
  }

  /** The highest revision whose canonical material has actually applied in order. */
  appliedThrough(): number {
    return this.materialCursor;
  }

  /** The highest revision validated and journaled in order. */
  receivedThrough(): number {
    return this.receivedCursor;
  }

  /** The highest revision whose required mechanical successor is installed in order. */
  controlInstalledThrough(): number {
    return this.controlCursor;
  }

  /** The unfinished revision, or the next revision when every admitted entry is mechanically complete. */
  missingFrom(): number {
    return this.controlCursor + 1;
  }

  /**
   * Classify an incoming revision WITHOUT mutating. Completed duplicates must never re-apply material;
   * duplicates at an unfinished frontier name whether material or only control must be retried. A later
   * revision is a gap until the unfinished predecessor reaches its required mechanical stage.
   */
  classify(revision: number): RevisionOrder {
    if (!Number.isSafeInteger(revision) || revision <= 0 || revision <= this.controlCursor) {
      return "duplicate-complete";
    }
    if (revision === this.receivedCursor && this.receivedCursor > this.controlCursor) {
      return this.materialCursor < revision ? "duplicate-pending-material" : "duplicate-pending-control";
    }
    return revision === this.controlCursor + 1 && this.receivedCursor === this.controlCursor ? "next" : "gap";
  }

  /**
   * Record ordered journal admission. This does NOT claim that material applied.
   */
  markReceived(revision: number): boolean {
    if (revision === this.controlCursor + 1 && this.receivedCursor === this.controlCursor) {
      this.receivedCursor = revision;
      return true;
    }
    return false;
  }

  /**
   * Record a verified canonical material install. Entries with no successor mechanically complete here;
   * entries with a successor remain at `duplicate-pending-control` until that exact control is recorded.
   */
  markMaterialApplied(revision: number, requiresControl: boolean): boolean {
    if (revision !== this.receivedCursor || revision !== this.materialCursor + 1) {
      return false;
    }
    this.materialCursor = revision;
    if (!requiresControl) {
      this.controlCursor = revision;
    }
    return true;
  }

  /** Record the exact stated successor control as installed for the pending material revision. */
  markControlInstalled(revision: number): boolean {
    if (revision !== this.receivedCursor || revision !== this.materialCursor || revision !== this.controlCursor + 1) {
      return false;
    }
    this.controlCursor = revision;
    return true;
  }

  /**
   * Adopt a proven snapshot high-water (recovery): a validated recovery bundle proves receipt, material,
   * and its stated successor through `revision`. Monotonic; a stale snapshot can never rewind a frontier.
   */
  adoptFrontier(revision: number): void {
    if (Number.isSafeInteger(revision) && revision > this.controlCursor) {
      this.receivedCursor = revision;
      this.materialCursor = revision;
      this.controlCursor = revision;
    }
  }

  /**
   * Recovery-only adoption after a canonical snapshot has applied but before its reconstructed successor is
   * actionable. Receipt and material truth move to `revision`; control deliberately remains one revision
   * behind until the ordinary projector proves the exact final entry's successor. This may reopen the
   * already-complete current frontier because recovery destroys that old phase generation and must prove
   * the replacement generation, not inherit a stale control claim.
   */
  adoptRecoveryMaterialFrontier(revision: number): boolean {
    if (!Number.isSafeInteger(revision) || revision <= 0 || revision < this.controlCursor) {
      return false;
    }
    this.receivedCursor = revision;
    this.materialCursor = revision;
    this.controlCursor = revision - 1;
    return true;
  }
}

/**
 * A revision-keyed map with a hard capacity, kept in ascending revision order. The concrete log uses it for
 * the authority's retained-but-unretired frontier: retention normally drains via the retirement rule, but a
 * pathological run (a peer that never acks) must not grow memory without bound. A new value is REFUSED at
 * capacity; the oldest unresolved revision is never evicted. The authority can therefore freeze/terminal on
 * pressure without silently deleting the exact mutation a replica still needs.
 *
 * Pure: no timers, no side effects beyond the map. Ordering is maintained on insert so iteration + oldest
 * lookup are O(n)/O(1) without re-sorting.
 */
export class BoundedRevisionWindow<T> {
  /** Ascending-by-revision list of retained keys (parallel to {@linkcode byRevision}). */
  private readonly order: number[] = [];
  private readonly byRevision = new Map<number, T>();
  private readonly capacity: number;

  constructor(capacity = 512) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error(`BoundedRevisionWindow capacity must be a positive integer (got ${capacity})`);
    }
    this.capacity = capacity;
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
   * Retain a value under a revision, keeping ascending order. Returns false when a NEW revision would exceed
   * capacity and leaves every existing value untouched. Re-setting an existing revision overwrites in place.
   */
  set(revision: number, value: T): boolean {
    if (this.byRevision.has(revision)) {
      this.byRevision.set(revision, value);
      return true;
    }
    if (this.order.length >= this.capacity) {
      return false;
    }
    this.insertOrdered(revision);
    this.byRevision.set(revision, value);
    return true;
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
