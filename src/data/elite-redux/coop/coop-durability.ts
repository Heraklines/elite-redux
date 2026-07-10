/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op APPLICATION-LEVEL TRANSPORT DURABILITY (Wave-2b of the authoritative
// run-state migration, contract doc §4).
//
// Today the WebRTC transport `send()` DROPS a frame when the channel is not open
// (coop-webrtc-transport.ts:186-201: silent, no queue, no ACK), and the only
// durability is a set of bespoke per-surface self-healing re-request loops
// (requestRunConfig / requestRoster / requestEnemyParty / requestStateSync) plus a
// full snapshot pull on rejoin. This module is the ONE durability layer that sits
// UNDER all of them:
//
//   - `classifyCoopMessage` / `isCoopDurableMessage` / `isCoopCosmeticMessage` -
//     the AUTHORITATIVE vs COSMETIC message-class split (§4.1). Cosmetic streams
//     (battleEvent render ticks, cursor mirror, ME narration) stay fire-and-forget;
//     the authoritative backbone gets durability.
//   - `CoopOutboundQueue` (§4.3) - a BOUNDED (count + bytes) FIFO outbound queue
//     that ENQUEUES durable frames while the channel is dark and flushes them on
//     open, instead of dropping them silently. Cosmetic frames are shed first;
//     overflow COLLAPSES (drops the backlog and flags a resync) rather than growing
//     unbounded - safe because the journal is the durable record of committed ops.
//   - `CoopJournal` (§4.1) - a revision-keyed BOUNDED ring of COMMITTED authoritative
//     operations, with a cumulative-ACK high-water mark, an unacked tail (for resend,
//     §4.2), a reconnect tail (for reconnect-from-revision, §4.4), and a
//     gap-deeper-than-the-ring signal (→ full snapshot fallback).
//   - `CoopReceiveLedger` - the RECEIVER-side idempotency guard: apply each committed
//     op at most once, keyed on `(class, seq)` (invariant 5), and detect a revision
//     GAP (→ request the tail) instead of applying out of order.
//
// The journal is GENERIC - keyed on an opaque `(class, seq)` pair - so the Wave-2a
// operation envelope (coop-interaction / the envelope commit path, being built
// concurrently) plugs in later as one journaled class keyed by `revision`, WITHOUT
// this module importing the envelope type. Coordinate the key via the contract doc,
// not a shared file.
//
// Everything here is ENGINE-FREE and pure (no globalScene, no phases, no Phaser), so
// it is exhaustively unit-testable headlessly.
// =============================================================================

import { coopLog } from "#data/elite-redux/coop/coop-debug";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";

/** The wire `t` values of a co-op message (the discriminant of the CoopMessage union). */
export type CoopMessageType = CoopMessage["t"];

/**
 * The durability CLASS of a wire message.
 *  - `cosmetic`  - PRESENTATION-ONLY: a dropped/reordered/late frame only stutters an animation or a
 *    narration line; the authoritative checkpoint reconciles it. Sheddable, never journaled (§4.1).
 *    (`battleEvent`, `uiInput`, `meCursor`, `meMessage` - the exact set coop-fault-transport faults
 *    by default, and the classes the protocol comments in coop-transport.ts declare desync-safe.)
 *  - `internal`  - TRANSPORT-INTERNAL keepalive / stall beat: time-sensitive, never queued or journaled
 *    (a stale ping helps nobody). (`ping`, `pong`, `stallBeat`.)
 *  - `durable`   - the AUTHORITATIVE backbone: interaction ops, wave resolution, checkpoints/state,
 *    commands, lobby-critical handshakes. Queued (not dropped) while dark; the committed subset is
 *    journaled + ACKed + resent.
 */
export type CoopMessageClass = "cosmetic" | "internal" | "durable";

/**
 * The PRESENTATION-ONLY cue classes (§4.1) - the ones the netcode design proves can be lost / reordered /
 * delayed WITHOUT a desync. Mirrors {@linkcode COOP_DEFAULT_CUE_TYPES} in coop-fault-transport.ts (kept in
 * sync deliberately: the fault test faults exactly this set, and durability sheds exactly this set).
 */
const COOP_COSMETIC_TYPES: ReadonlySet<CoopMessageType> = new Set<CoopMessageType>([
  "battleEvent",
  "uiInput",
  "meCursor",
  "meMessage",
]);

/** Transport-internal keepalive / liveness frames - never queued (time-sensitive) and never journaled. */
const COOP_INTERNAL_TYPES: ReadonlySet<CoopMessageType> = new Set<CoopMessageType>(["ping", "pong", "stallBeat"]);

/** Classify a wire message for durability handling (§4.1). Everything not cosmetic/internal is durable. */
export function classifyCoopMessage(msg: CoopMessage): CoopMessageClass {
  if (COOP_COSMETIC_TYPES.has(msg.t)) {
    return "cosmetic";
  }
  if (COOP_INTERNAL_TYPES.has(msg.t)) {
    return "internal";
  }
  return "durable";
}

/** Whether a message is on the AUTHORITATIVE backbone (queued while dark; committed subset is journaled). */
export function isCoopDurableMessage(msg: CoopMessage): boolean {
  return classifyCoopMessage(msg) === "durable";
}

/** Whether a message is PRESENTATION-ONLY (sheddable under backpressure, never journaled). */
export function isCoopCosmeticMessage(msg: CoopMessage): boolean {
  return classifyCoopMessage(msg) === "cosmetic";
}

// -----------------------------------------------------------------------------
// Feature flag (§5 rollout): the durability layer is behind a flag. Default ON so
// loopback/tests + a paired-version live session get it; the legacy direct-send path
// remains for a version-gated fallback. Follows the coop-debug override pattern
// (URL param > localStorage > compile default) so it can be flipped on staging or in
// a test WITHOUT a rebuild, and both flag states are exercisable.
// -----------------------------------------------------------------------------

/** The compile default for the durability layer. Behind the #806 version handshake for a live ship. */
const COOP_DURABILITY_DEFAULT = true;

function readInitialDurabilityEnabled(): boolean {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    if (loc?.search) {
      const q = new URLSearchParams(loc.search).get("coopdurability");
      if (q === "1" || q === "true") {
        return true;
      }
      if (q === "0" || q === "false") {
        return false;
      }
    }
    const ls = (globalThis as { localStorage?: Storage }).localStorage?.getItem("coopDurability");
    if (ls === "1") {
      return true;
    }
    if (ls === "0") {
      return false;
    }
  } catch {
    // headless / SSR / no DOM: fall through to the compile default.
  }
  return COOP_DURABILITY_DEFAULT;
}

let durabilityEnabled = readInitialDurabilityEnabled();

/** Whether the application-level durability layer (outbound queue + journal + ACK/resend) is active. */
export function isCoopDurabilityEnabled(): boolean {
  return durabilityEnabled;
}

/**
 * Toggle the durability layer at runtime (staging override / test both-flag-states). Persists to
 * localStorage so a staging toggle survives a reload. Tests flip it to exercise ON and OFF.
 */
export function setCoopDurabilityEnabled(on: boolean): void {
  durabilityEnabled = on;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem("coopDurability", on ? "1" : "0");
  } catch {
    // no DOM storage: in-memory toggle only.
  }
}

// -----------------------------------------------------------------------------
// Outbound queue + backpressure (§4.3)
// -----------------------------------------------------------------------------

/** Bounds for the outbound queue. Defaults are conservative (a brief channel blip, not a long outage). */
export interface CoopOutboundQueueBounds {
  /** Max durable frames held before the queue COLLAPSES to a resync (§4.3). */
  readonly maxCount: number;
  /** Max total queued bytes before the queue COLLAPSES to a resync (§4.3). */
  readonly maxBytes: number;
}

/** The default outbound-queue bounds: ~256 frames or ~1 MiB, whichever trips first. */
export const COOP_DEFAULT_QUEUE_BOUNDS: CoopOutboundQueueBounds = { maxCount: 256, maxBytes: 1 << 20 };

/** What the queue did with an offered frame. */
export type CoopQueueOutcome =
  | "queued" // a durable frame was enqueued (channel dark)
  | "shed" // a cosmetic/internal frame was dropped (fire-and-forget, §4.1)
  | "collapsed"; // enqueuing would exceed the bounds: the backlog was dropped + a resync is flagged (§4.3)

interface QueuedFrame {
  readonly msg: CoopMessage;
  readonly bytes: number;
}

/**
 * A BOUNDED outbound queue (§4.3). Consulted by the transport when the channel is NOT open: instead of
 * dropping a durable frame silently (today's hazard, coop-webrtc-transport.ts:186-201), it enqueues the
 * frame and the transport flushes FIFO on the channel's `open` event.
 *
 * Cosmetic/internal frames are SHED (dropped) rather than queued - they are desync-safe (§4.1) and
 * time-sensitive, so holding them helps nobody and would crowd out authoritative frames. On overflow
 * (count OR bytes) the queue COLLAPSES: it drops the backlog and raises {@linkcode needsResync}, because
 * the journal is the durable record of committed ops - a reconnect-from-revision (§4.4) replays them, so a
 * bounded-memory collapse is always safe (never silent authoritative loss).
 */
export class CoopOutboundQueue {
  private readonly frames: QueuedFrame[] = [];
  private bytes = 0;
  private collapsed = false;

  constructor(private readonly bounds: CoopOutboundQueueBounds = COOP_DEFAULT_QUEUE_BOUNDS) {}

  /**
   * Offer a frame to the queue while the channel is dark. Returns what happened. `byteSize` is the frame's
   * serialized size (the caller already has the JSON, so it passes the length rather than re-stringifying).
   */
  offer(msg: CoopMessage, byteSize: number): CoopQueueOutcome {
    if (classifyCoopMessage(msg) !== "durable") {
      return "shed";
    }
    if (this.frames.length + 1 > this.bounds.maxCount || this.bytes + byteSize > this.bounds.maxBytes) {
      // Collapse: drop the backlog, remember that a resync is owed. The journal (not this queue) is the
      // durable record, so the dropped frames are recoverable via reconnect-from-revision (§4.4).
      this.frames.length = 0;
      this.bytes = 0;
      this.collapsed = true;
      coopLog(
        "durability",
        `outbound queue COLLAPSED (bounds count=${this.bounds.maxCount} bytes=${this.bounds.maxBytes}) -> resync owed`,
      );
      return "collapsed";
    }
    this.frames.push({ msg, bytes: byteSize });
    this.bytes += byteSize;
    return "queued";
  }

  /**
   * Flush the queued frames FIFO through `send` (called on the channel `open` event). If the queue had
   * COLLAPSED, nothing is replayed (the backlog is gone) - {@linkcode needsResync} stays raised so the
   * caller triggers a reconnect-from-revision instead.
   */
  drain(send: (msg: CoopMessage) => void): void {
    const pending = this.frames.splice(0, this.frames.length);
    this.bytes = 0;
    for (const f of pending) {
      send(f.msg);
    }
  }

  /** Number of frames currently queued (backpressure depth, surfaced in the health line). */
  size(): number {
    return this.frames.length;
  }

  /** Total queued bytes. */
  byteSize(): number {
    return this.bytes;
  }

  /** Whether the queue overflowed and dropped its backlog (a reconnect-from-revision resync is owed). */
  needsResync(): boolean {
    return this.collapsed;
  }

  /** Clear the resync-owed flag once the caller has issued the reconnect-from-revision request. */
  clearResync(): void {
    this.collapsed = false;
  }
}

// -----------------------------------------------------------------------------
// Journal (§4.1) + cumulative ACK/resend (§4.2)
// -----------------------------------------------------------------------------

/** One journaled committed operation, keyed by an opaque `(cls, seq)` pair (§4.1). */
export interface CoopJournalEntry {
  /** The operation CLASS (e.g. "envelope" once Wave-2a plugs in; generic today). */
  readonly cls: string;
  /** The monotonic sequence WITHIN the class (the envelope's `revision`; dense, gap-detectable, §1.5). */
  readonly seq: number;
  /** The wire message to (re)broadcast for this committed op. */
  readonly msg: CoopMessage;
}

/**
 * A BOUNDED, revision-keyed ring of COMMITTED authoritative operations (§4.1) with a cumulative-ACK
 * high-water mark (§4.2). Per class:
 *  - `commit(cls, seq, msg)` appends the committed op (the moment the host applies + increments the seq).
 *  - `ack(cls, upto)` records the peer applied through `upto` (cumulative; the peer acks its last-applied).
 *  - `unacked(cls)` / `resendTail(cls)` returns the committed-but-unacked tail (for a resend, §4.2).
 *  - `tailFrom(cls, from)` returns everything after `from` (for reconnect-from-revision, §4.4).
 *  - `needsFullSnapshot(cls, from)` is true when the requested gap is DEEPER than the ring (→ the heavy
 *    full-snapshot fallback, §4.4) - the ring can only replay the last `capacity` revisions.
 *
 * The ring is bounded so a long-lived run cannot grow the journal without limit; the full-snapshot path
 * (the existing tested `stateSync`) covers any gap the ring cannot.
 */
export class CoopJournal {
  /** Per-class ordered entry list (bounded to `capacity`; oldest evicted first). */
  private readonly byClass = new Map<string, CoopJournalEntry[]>();
  /** Per-class highest committed seq (monotonic; the high-water mark persisted for cold-resume). */
  private readonly highWater = new Map<string, number>();
  /** Per-class highest peer-acked seq (cumulative). */
  private readonly acked = new Map<string, number>();

  constructor(private readonly capacity = 256) {}

  /** Record a committed operation (host side, at commit→applied, §1.3). Seq MUST be monotonic per class. */
  commit(cls: string, seq: number, msg: CoopMessage): void {
    let list = this.byClass.get(cls);
    if (list == null) {
      list = [];
      this.byClass.set(cls, list);
    }
    list.push({ cls, seq, msg });
    // Evict the oldest so the ring stays bounded.
    while (list.length > this.capacity) {
      list.shift();
    }
    const hw = this.highWater.get(cls) ?? 0;
    if (seq > hw) {
      this.highWater.set(cls, seq);
    }
  }

  /** Record the peer's cumulative ACK: it has applied class `cls` through revision `upto` (§4.2). */
  ack(cls: string, upto: number): void {
    const prev = this.acked.get(cls) ?? 0;
    if (upto > prev) {
      this.acked.set(cls, upto);
    }
  }

  /** The highest committed seq for a class (its high-water mark), or 0 if none. */
  highWaterMark(cls: string): number {
    return this.highWater.get(cls) ?? 0;
  }

  /** The highest peer-acked seq for a class, or 0 if none. */
  ackedThrough(cls: string): number {
    return this.acked.get(cls) ?? 0;
  }

  /** The committed-but-unacked tail for a class (seq > ackedThrough), in order - the resend set (§4.2). */
  resendTail(cls: string): CoopJournalEntry[] {
    const list = this.byClass.get(cls);
    if (list == null) {
      return [];
    }
    const ack = this.ackedThrough(cls);
    return list.filter(e => e.seq > ack);
  }

  /** Every committed entry after `from` (for reconnect-from-revision replay, §4.4), in order. */
  tailFrom(cls: string, from: number): CoopJournalEntry[] {
    const list = this.byClass.get(cls);
    if (list == null) {
      return [];
    }
    return list.filter(e => e.seq > from);
  }

  /**
   * Whether a reconnect asking for the tail after `from` is DEEPER than the ring can serve (§4.4) - i.e.
   * the oldest retained revision is already past `from + 1`, so a gap remains after replaying the ring.
   * The caller then falls back to the heavy full-snapshot path. `from >= highWater` is never a deep gap
   * (the peer is already at/ahead of head).
   */
  needsFullSnapshot(cls: string, from: number): boolean {
    const list = this.byClass.get(cls);
    if (list == null || list.length === 0) {
      // Nothing journaled: only "deep" if the peer is genuinely behind a head we can't reconstruct.
      return from < this.highWaterMark(cls);
    }
    if (from >= this.highWaterMark(cls)) {
      return false;
    }
    const oldest = list[0].seq;
    // A gap remains iff the ring's oldest is beyond the first revision the peer still needs (`from + 1`).
    return oldest > from + 1;
  }

  /** Total retained entries across all classes (journal depth, surfaced in the health line). */
  depth(): number {
    let n = 0;
    for (const list of this.byClass.values()) {
      n += list.length;
    }
    return n;
  }

  /** Total committed-but-unacked entries across all classes (surfaced in the health line). */
  unackedCount(): number {
    let n = 0;
    for (const cls of this.byClass.keys()) {
      n += this.resendTail(cls).length;
    }
    return n;
  }

  /** The classes with at least one committed entry (for iterating resend/snapshot per class). */
  classes(): string[] {
    return [...this.byClass.keys()];
  }
}

// -----------------------------------------------------------------------------
// Receiver-side idempotency ledger (invariant 5, §1.6)
// -----------------------------------------------------------------------------

/**
 * The RECEIVER-side idempotency guard (§1.6). Guest application of a committed op is a pure function of
 * `(class, seq)`: apply each seq at most once, in order. `shouldApply` returns false for a duplicate/late
 * re-delivery (safe to resend, §4.2); `hasGap` is true when the incoming seq skips ahead (→ request the
 * tail, §4.4) instead of applying out of order.
 */
export class CoopReceiveLedger {
  private readonly lastApplied = new Map<string, number>();

  /** The highest seq applied for a class (0 if none). */
  appliedThrough(cls: string): number {
    return this.lastApplied.get(cls) ?? 0;
  }

  /**
   * Whether an incoming committed op should be applied now: true iff it is exactly the NEXT revision
   * (seq === appliedThrough + 1). A duplicate/late (seq <= appliedThrough) is a no-op; a future seq is a
   * gap ({@linkcode hasGap}) and must NOT be applied out of order.
   */
  shouldApply(cls: string, seq: number): boolean {
    return seq === this.appliedThrough(cls) + 1;
  }

  /** Whether an incoming seq is a duplicate/late re-delivery (already applied) - a safe no-op. */
  isDuplicate(cls: string, seq: number): boolean {
    return seq <= this.appliedThrough(cls);
  }

  /** Whether an incoming seq skips ahead of the next expected revision (a gap → request the tail). */
  hasGap(cls: string, seq: number): boolean {
    return seq > this.appliedThrough(cls) + 1;
  }

  /** Mark a class applied through `seq` (monotonic; a lower value is ignored). Call after a real apply. */
  markApplied(cls: string, seq: number): void {
    const prev = this.appliedThrough(cls);
    if (seq > prev) {
      this.lastApplied.set(cls, seq);
    }
  }

  /**
   * Fast-forward the applied mark to `seq` (used after adopting a full snapshot at a head revision, §4.4).
   * Unlike {@linkcode markApplied} this is explicit about jumping past a gap the snapshot filled.
   */
  adoptSnapshot(cls: string, seq: number): void {
    this.markApplied(cls, seq);
  }
}
