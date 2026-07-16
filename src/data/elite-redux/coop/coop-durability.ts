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

import { recordCoopCausalEvent } from "#data/elite-redux/coop/coop-causal-trace";
import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type {
  CoopAuthorityAckStage,
  CoopMessage,
  CoopOperationContinuationSurface,
  CoopTransport,
} from "#data/elite-redux/coop/coop-transport";

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
    // Env override FIRST (headless tests / CI: exercise both flag states without a DOM). `1`/`0`.
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.ER_COOP_DURABILITY;
    if (env === "1" || env === "true") {
      return true;
    }
    if (env === "0" || env === "false") {
      return false;
    }
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
    // The dark-channel queue is a wire-retention boundary. Own an immutable send-time snapshot so a
    // caller reusing/mutating its engine object cannot rewrite what a later `open` event transmits.
    this.frames.push({ msg: structuredClone(msg), bytes: byteSize });
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
      send(structuredClone(f.msg));
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
  commit(cls: string, seq: number, msg: CoopMessage): boolean {
    const immutableMsg = structuredClone(msg);
    const immutableCanonical = JSON.stringify(immutableMsg);
    const hw = this.highWater.get(cls) ?? 0;
    let list = this.byClass.get(cls);
    if (list == null) {
      list = [];
      this.byClass.set(cls, list);
    }
    const existing = list.find(entry => entry.seq === seq);
    if (existing != null) {
      // One revision has one immutable wire representation. A re-ACK may re-publish it, but a caller can
      // never smuggle a conflicting payload under an already-committed sequence number.
      return JSON.stringify(existing.msg) === immutableCanonical;
    }

    // A cold restore persists the high-water but intentionally not the bounded replay ring. Likewise a
    // future pruning policy may remove an ACKed entry. An exact operation re-ACK is retained only if its
    // concrete message is reinserted; the high-water alone is not durability. Keep the list ordered because
    // tail replay and deep-gap detection depend on ascending sequence numbers.
    const insertionIndex = list.findIndex(entry => entry.seq > seq);
    const entry = { cls, seq, msg: immutableMsg };
    if (insertionIndex < 0) {
      list.push(entry);
    } else {
      list.splice(insertionIndex, 0, entry);
    }
    // Evict the oldest so the ring stays bounded.
    while (list.length > this.capacity) {
      list.shift();
    }
    if (seq > hw) {
      this.highWater.set(cls, seq);
    }
    // A very old retry may be below a full ring and get evicted immediately. Report failure rather than
    // letting a gameplay permit outrun an entry that is not actually replayable.
    return list.some(retained => retained.seq === seq && JSON.stringify(retained.msg) === immutableCanonical);
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
    return list.filter(e => e.seq > ack).map(entry => structuredClone(entry));
  }

  /** Every committed entry after `from` (for reconnect-from-revision replay, §4.4), in order. */
  tailFrom(cls: string, from: number): CoopJournalEntry[] {
    const list = this.byClass.get(cls);
    if (list == null) {
      return [];
    }
    return list.filter(e => e.seq > from).map(entry => structuredClone(entry));
  }

  /** Exact retained canonical entry, including ACKed entries that still remain inside the bounded ring. */
  entry(cls: string, seq: number): CoopJournalEntry | null {
    const retained = this.byClass.get(cls)?.find(candidate => candidate.seq === seq);
    return retained == null ? null : structuredClone(retained);
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
    for (const [cls, entries] of this.byClass) {
      const ack = this.ackedThrough(cls);
      n += entries.filter(entry => entry.seq > ack).length;
    }
    return n;
  }

  /** The classes with at least one committed entry (for iterating resend/snapshot per class). */
  classes(): string[] {
    return [...this.byClass.keys()];
  }

  /**
   * The per-class high-water marks, for persistence into the session save (§1.4/§4). A COLD resume restores
   * these so the committed-op revision stream continues MONOTONICALLY across the save boundary rather than
   * resetting to 0 - which keeps ownership parity + revision ordering stable through a resume.
   */
  serializeHighWater(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [cls, seq] of this.highWater) {
      out[cls] = seq;
    }
    return out;
  }

  /** Restore per-class high-water marks (§4) from a persisted snapshot; a later commit continues past them. */
  restoreHighWater(marks: Record<string, number>): void {
    for (const cls of Object.keys(marks)) {
      const seq = marks[cls];
      if (Number.isFinite(seq) && seq > (this.highWater.get(cls) ?? 0)) {
        this.highWater.set(cls, seq);
      }
    }
  }

  /**
   * Restore per-class peer-ACK marks on a COLD resume (§4). A converged control-plane save is taken with both
   * peers at the high-water, so the peer applied (ACKed) through it: the committer's ACK view continues from
   * there. Without this, the committer's `acked` restarts at 0, so the first un-ACKed post-resume op reads as
   * a deep gap (its oldest retained is far past acked+1) and a reconnect resync SPURIOUSLY escalates to a full
   * snapshot instead of serving the single tail op. Monotonic (a lower value than already recorded is ignored).
   */
  restoreAcked(marks: Record<string, number>): void {
    for (const cls of Object.keys(marks)) {
      const seq = marks[cls];
      if (Number.isFinite(seq) && seq > (this.acked.get(cls) ?? 0)) {
        this.acked.set(cls, seq);
      }
    }
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

  /** The classes this receiver has applied at least one op for (to request a tail per class on reconnect). */
  serializeClasses(): string[] {
    return [...this.lastApplied.keys()];
  }

  /** The per-class applied marks, for persistence into the session save (§4). */
  serialize(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [cls, seq] of this.lastApplied) {
      out[cls] = seq;
    }
    return out;
  }

  /** Restore per-class applied marks (§4) from a persisted snapshot. */
  restore(marks: Record<string, number>): void {
    for (const cls of Object.keys(marks)) {
      this.markApplied(cls, marks[cls]);
    }
  }

  /** Exact receiver-ledger rollback for an atomic full-snapshot transaction. */
  restoreExactForTransaction(marks: Record<string, number>): void {
    this.lastApplied.clear();
    for (const [cls, seq] of Object.entries(marks)) {
      if (Number.isSafeInteger(seq) && seq > 0) {
        this.lastApplied.set(cls, seq);
      }
    }
  }
}

// -----------------------------------------------------------------------------
// CoopDurabilityManager (§4.2/§4.4): the ACK / resend / reconnect protocol engine
// -----------------------------------------------------------------------------

/**
 * The result of the receiver's apply hook (W2e-R P0-1). The receiver's ACK + ledger advance are GATED on
 * this so the manager can never claim an op applied when the applier did NOT consume it (the review's
 * ACK-without-mutation P0). The four cases are load-bearing:
 *  - `applied`   - the op was NEWLY consumed by the receiver (recorded in its idempotency ledger, and its
 *    live-mutation seam invoked). ACK it + advance.
 *  - `duplicate` - the op was ALREADY consumed (cross-carrier / resend re-delivery). ACK it + advance anyway
 *    (idempotent), so a re-delivered-but-already-satisfied op can never spin the resend loop forever.
 *  - `deferred`  - the op is valid and retained, but its addressed engine/UI boundary has not opened yet.
 *    Do NOT ACK, advance, or enter recovery. The exact entry is retried on a cheap timer and may be retried
 *    immediately by {@linkcode CoopDurabilityManager.retryDeferred} when the continuation surface opens;
 *    a separate generous deadline routes a missing surface to the peer-coherent terminal supervisor.
 *  - `rejected`  - the apply threw, failed validation, or hit an erroneous non-applicable state. Do NOT ACK
 *    or advance. Bounded recovery retries it and then enters the peer-coherent terminal path if it cannot
 *    heal, so corrupt/conflicting input cannot silently advance or wait forever.
 * A `void`/`undefined` return is treated as `applied` (back-compat for the pre-W2e-R generic synthetic
 * appliers that mutated unconditionally).
 */
export type CoopApplyOutcome = "applied" | "duplicate" | "deferred" | "rejected";

/** Exact live authority address supplied by the public-UI continuation chokepoint. */
export interface CoopOperationContinuationAddress {
  epoch: number;
  wave: number;
  turn: number;
}

interface CoopOperationAuthorityAddress extends CoopOperationContinuationAddress {
  cls: string;
  seq: number;
  operationId: string;
}

interface PendingOperationContinuation {
  authority: CoopOperationAuthorityAddress;
  expectedSurface: "sharedBoundary" | "terminal";
  lastAck: Extract<CoopMessage, { t: "coopAck" }> | null;
  /** A matching UI can open synchronously inside the materializer; finalize it after material ACK exists. */
  observed?: {
    surface: CoopOperationContinuationSurface;
    address: CoopOperationContinuationAddress;
  };
}

/** Host-side stage boundary: the canonical result is retained while each client opens its real next UI. */
interface PendingHostOperationContinuation {
  authority: CoopOperationAuthorityAddress;
  expectedSurface: "sharedBoundary" | "terminal";
  /** One matching authority surface may start the peer-convergence budget; duplicates can never extend it. */
  authoritySurfaceRearmed: boolean;
  /** Exact host phase barriers waiting only for the peer's ordered materialApplied proof. */
  materialWaiters: Set<(applied: boolean) => void>;
}

/** Identity is load-bearing: a cancelled first-stage callback must not exhaust a newly rearmed deadline. */
interface OperationContinuationDeadline {
  cancel: () => void;
}

/** Host delivery retry for the exact last retained operation when no later revision exists to expose a gap. */
interface PendingOperationDeliveryRetry {
  authority: CoopOperationAuthorityAddress;
  startedAt: number;
  attempts: number;
  cancel: () => void;
}

interface OperationAckEvidence {
  stage: CoopAuthorityAckStage;
  canonical: string;
  value: Extract<CoopMessage, { t: "coopAck" }>;
}

export interface CoopDurabilityRecoveryFailure {
  cls: string;
  from: number;
  blockedSeq: number;
  attempts: number;
  reason: "apply-rejected" | "gap" | "deferred-timeout" | "continuation-timeout";
}

interface PendingDurabilityRecovery extends CoopDurabilityRecoveryFailure {
  startedAt: number;
  cancel: () => void;
  authority: CoopOperationAuthorityAddress | null;
}

interface PendingDeferredApply {
  entry: CoopJournalEntry;
  startedAt: number;
  attempts: number;
  cancel: () => void;
}

const DURABILITY_RECOVERY_INITIAL_MS = 100;
const DURABILITY_RECOVERY_MAX_MS = 2_000;
const DURABILITY_RECOVERY_MAX_ATTEMPTS = 8;
const DURABILITY_RECOVERY_DEADLINE_MS = 12_000;
const DURABILITY_DEFERRED_RETRY_MS = 100;
const DURABILITY_DEFERRED_DEADLINE_MS = 60_000;
/**
 * The committer can legitimately spend most of a minute persisting the completed wave, materializing the
 * next encounter, and loading its assets before its own public continuation exists. Keep that host-side
 * construction budget separate from the tighter peer-convergence budget that begins only after the host
 * proves its continuation is executable.
 */
const OPERATION_AUTHORITY_CONTINUATION_DEADLINE_MS = 180_000;
const OPERATION_PEER_CONTINUATION_DEADLINE_MS = 60_000;

function defaultDurabilitySchedule(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms);
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  return () => clearTimeout(timer);
}

const OPERATION_ACK_STAGE_ORDER: Readonly<Record<CoopAuthorityAckStage, number>> = {
  materialApplied: 0,
  presentationReady: 1,
  continuationReady: 2,
};

function isOperationAckStage(value: unknown): value is CoopAuthorityAckStage {
  return value === "materialApplied" || value === "presentationReady" || value === "continuationReady";
}

function isSafeOperationAddressPart(value: unknown, allowZero = true): value is number {
  return Number.isSafeInteger(value) && (allowZero ? (value as number) >= 0 : (value as number) > 0);
}

function retainedOperationAuthorityFor(
  cls: string,
  seq: number,
  msg: CoopMessage,
): { authority: CoopOperationAuthorityAddress; expectedSurface: "sharedBoundary" | "terminal" } | null {
  if (msg.t !== "envelope") {
    return null;
  }
  const envelope = msg.envelope;
  if (
    !isSafeOperationAddressPart(envelope.sessionEpoch, false)
    || !isSafeOperationAddressPart(envelope.wave)
    || !isSafeOperationAddressPart(envelope.turn)
    || !isSafeOperationAddressPart(seq, false)
    || envelope.revision !== seq
  ) {
    return null;
  }
  const operationId = envelope.pendingOperation?.id ?? `${envelope.sessionEpoch}:revision:${envelope.revision}`;
  if (typeof operationId !== "string" || operationId.length === 0) {
    return null;
  }
  return {
    authority: {
      cls,
      seq,
      operationId,
      epoch: envelope.sessionEpoch,
      wave: envelope.wave,
      turn: envelope.turn,
    },
    expectedSurface: envelope.logicalPhase === "GAME_OVER" ? "terminal" : "sharedBoundary",
  };
}

interface PendingRetainedWaveAck {
  authority: CoopOperationAuthorityAddress;
  canonicalEnvelope: string;
  completed: boolean;
  ackChain:
    | readonly [
        Extract<CoopMessage, { t: "coopAck" }>,
        Extract<CoopMessage, { t: "coopAck" }>,
        Extract<CoopMessage, { t: "coopAck" }>,
      ]
    | null;
}

/** Generic operations publish material evidence at apply, then UI stages. WAVE_ADVANCE is completed only
 * by its dedicated DATA + destination adapter, so receiver-side generic staging must not claim it applied. */
function operationAuthorityFor(
  cls: string,
  seq: number,
  msg: CoopMessage,
): { authority: CoopOperationAuthorityAddress; expectedSurface: "sharedBoundary" | "terminal" } | null {
  if (msg.t === "envelope" && msg.envelope.pendingOperation?.kind === "WAVE_ADVANCE") {
    return null;
  }
  return retainedOperationAuthorityFor(cls, seq, msg);
}

function operationAuthorityKey(authority: CoopOperationAuthorityAddress): string {
  return `${authority.cls}:${authority.seq}:${authority.epoch}:${authority.wave}:${authority.turn}:${authority.operationId}`;
}

const OPERATION_CAUSAL_ID_LIMIT = 192;
const TRACED_OPERATION_STAGE_LIMIT = 2_048;

/** Preserve ordinary operation ids exactly; reduce an anomalous oversized id to a stable bounded address. */
function operationCausalId(authority: CoopOperationAuthorityAddress): string {
  if (
    authority.operationId.length <= OPERATION_CAUSAL_ID_LIMIT
    && /^(?:\d+:\d+:[A-Z][A-Z0-9_]*:\d+|\d+:revision:\d+)$/.test(authority.operationId)
  ) {
    return authority.operationId;
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < authority.operationId.length; index++) {
    hash ^= authority.operationId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (
    `operation:e${authority.epoch}:r${authority.seq}:id#${(hash >>> 0).toString(16).padStart(8, "0")}`
    + `:len=${authority.operationId.length}`
  );
}

function operationAckCanonical(msg: Extract<CoopMessage, { t: "coopAck" }>): string {
  return JSON.stringify(msg);
}

const SNAPSHOT_FRONTIER_RETENTION = 8;

interface RetainedSnapshotFrontier {
  marks: Record<string, number>;
  canonical: string;
}

/** Strict, stable wire image for an exact snapshot frontier. */
function normalizeSnapshotMarks(marks: unknown): Record<string, number> | null {
  if (marks == null || typeof marks !== "object" || Array.isArray(marks)) {
    return null;
  }
  const normalized: Record<string, number> = {};
  for (const cls of Object.keys(marks as Record<string, unknown>).sort()) {
    const seq = (marks as Record<string, unknown>)[cls];
    if (cls.length === 0 || cls.length > 256 || !Number.isSafeInteger(seq) || (seq as number) < 0) {
      return null;
    }
    normalized[cls] = seq as number;
  }
  return normalized;
}

function snapshotMarksCanonical(marks: Record<string, number>): string {
  return JSON.stringify(marks);
}

function operationAckMatchesAuthority(
  msg: Extract<CoopMessage, { t: "coopAck" }>,
  authority: CoopOperationAuthorityAddress,
): boolean {
  return (
    msg.cls === authority.cls
    && msg.seq === authority.seq
    && msg.operationId === authority.operationId
    && msg.epoch === authority.epoch
    && msg.wave === authority.wave
    && msg.turn === authority.turn
  );
}

function operationContinuationMatches(
  expectedSurface: PendingOperationContinuation["expectedSurface"],
  authority: CoopOperationAuthorityAddress,
  surface: CoopOperationContinuationSurface,
  current: CoopOperationContinuationAddress,
): boolean {
  if (current.epoch !== authority.epoch) {
    return false;
  }
  if (expectedSurface === "terminal") {
    return surface === "terminal" && current.wave === authority.wave && current.turn >= authority.turn;
  }
  if (surface !== "command" && surface !== "sharedInput") {
    return false;
  }
  return current.wave === authority.wave
    ? current.turn >= authority.turn
    : current.wave === authority.wave + 1 && current.turn === 1;
}

/**
 * How the manager identifies + applies an inbound COMMITTED operation. Kept GENERIC (a `(class, seq)`
 * extractor + an apply callback) so the Wave-2a operation envelope plugs in as one class keyed by
 * `revision` WITHOUT this module importing the envelope type. When `extractKey` is absent the manager only
 * runs the ACK/reconnect protocol (a passive scaffold - no inbound op is ever applied), which is exactly
 * the production state UNTIL Wave-2a commits its first op.
 */
export interface CoopDurabilityHooks {
  /**
   * Extract the `(class, seq)` key of an inbound message that IS a committed durable op, or null if the
   * message is not a durable op (the manager ignores it). Wave-2a returns `{cls:"envelope", seq:revision}`.
   */
  extractKey?: (msg: CoopMessage) => { cls: string; seq: number } | null;
  /**
   * Apply an in-order committed op to shared state (the receiver's ONE mutation site). Returns a
   * {@linkcode CoopApplyOutcome} that GATES the ACK + ledger advance (W2e-R P0-1): only an `applied` or
   * `duplicate` result ACKs; `deferred` retains the exact entry without entering error recovery; a
   * `rejected` result (or a thrown apply) leaves the op retriable through bounded recovery. A `void` return
   * is treated as `applied` (back-compat).
   */
  apply?: (entry: CoopJournalEntry) => CoopApplyOutcome | void;
  /**
   * Serve a FULL SNAPSHOT at head for a class when a reconnect gap is deeper than the ring (§4.4). Optional;
   * when absent the manager replays whatever the ring holds (the existing per-surface snapshot heal covers
   * the deep gap in that case, so this is not required for correctness of the shallow-gap path).
   */
  sendFullSnapshot?: (cls: string, headRevision: number, controlHighWater: Record<string, number>) => void;
  /** Timer/clock seams keep bounded retry deterministic without allowing a synchronous replay recursion. */
  scheduleRecovery?: (callback: () => void, ms: number) => () => void;
  recoveryNow?: () => number;
  recoveryInitialMs?: number;
  recoveryMaxMs?: number;
  recoveryMaxAttempts?: number;
  recoveryDeadlineMs?: number;
  /** Low-cost valid-boundary polling, separate from bounded error recovery. */
  deferredRetryMs?: number;
  /** Maximum valid-boundary wait before the same peer-coherent terminal supervisor is invoked. */
  deferredDeadlineMs?: number;
  /** Peer-convergence deadline after the host exposes its correctly addressed public continuation. */
  operationContinuationDeadlineMs?: number;
  /** Initial deadline for the host to construct its own correctly addressed public continuation. */
  operationAuthorityContinuationDeadlineMs?: number;
  /** Dedicated timer seam for deterministic continuation-retention tests. */
  scheduleOperationContinuationDeadline?: (callback: () => void, ms: number) => () => void;
  /** Runtime bridge into the peer-coherent terminal supervisor after one class exhausts its retry budget. */
  onRecoveryExhausted?: (failure: CoopDurabilityRecoveryFailure) => void;
}

/**
 * The application-level durability engine (§4.2/§4.4). ONE per live session; both clients hold one. It:
 *  - (committer) `commit(cls, seq, msg)` journals a committed op and broadcasts it; `reconnect()` resends
 *    the committed-but-unacked tail (or replies to a peer's `coopResync` with the tail / a full snapshot);
 *  - (receiver) applies an inbound durable op idempotently by `(class, seq)` (§1.6), ACKs cumulatively, and
 *    on a revision GAP or a hot rejoin requests the tail via `coopResync`.
 *
 * Engine-free: it touches only the injected {@linkcode CoopTransport} + the journal/ledger. It installs ONE
 * `onMessage` handler for the `coopAck` / `coopResync` arms and (when `extractKey` is provided) the durable
 * op stream. Idempotent + safe to leave inert (no `extractKey`) as a scaffold.
 */
export class CoopDurabilityManager {
  private readonly journal: CoopJournal;
  private readonly ledger = new CoopReceiveLedger();
  private readonly off: () => void;
  private readonly pendingRecovery = new Map<string, PendingDurabilityRecovery>();
  private readonly exhaustedRecovery = new Map<string, number>();
  private readonly pendingDeferred = new Map<string, PendingDeferredApply>();
  /** Later global revisions that arrived while the exact next revision was validly deferred. */
  private readonly deferredFollowers = new Map<string, Map<number, CoopMessage>>();
  private readonly scheduleRecovery: (callback: () => void, ms: number) => () => void;
  private readonly recoveryNow: () => number;
  private readonly recoveryInitialMs: number;
  private readonly recoveryMaxMs: number;
  private readonly recoveryMaxAttempts: number;
  private readonly recoveryDeadlineMs: number;
  private readonly deferredRetryMs: number;
  private readonly deferredDeadlineMs: number;
  private readonly deferredFollowerLimit: number;
  /** Guest: materially applied operations still waiting for a real public continuation surface. */
  private readonly pendingOperationContinuations = new Map<string, PendingOperationContinuation>();
  /** Guest: latest canonical stage, retained so duplicate envelopes re-ACK without reapplying. */
  private readonly guestOperationAckEvidence = new Map<string, OperationAckEvidence>();
  /** Guest: staged WAVE_ADVANCE entries whose receive cursor advanced but whose DATA/control proof is due. */
  private readonly pendingRetainedWaveAcks = new Map<string, PendingRetainedWaveAck>();
  /** Host: latest accepted exact stage; material/presentation evidence never releases the journal. */
  private readonly hostOperationAckEvidence = new Map<string, OperationAckEvidence>();
  /** Host: later plain cumulative ACKs parked behind an earlier operation that still lacks UI readiness. */
  private readonly pendingCumulativeAcks = new Map<string, number>();
  /** Host: retained operations whose authority/peer continuation stages are still converging. */
  private readonly pendingHostOperationContinuations = new Map<string, PendingHostOperationContinuation>();
  /** Host: exact checksum-bound frontiers emitted in the most recent full snapshots. */
  private readonly retainedSnapshotFrontiers = new Map<string, RetainedSnapshotFrontier>();
  /** Guest: committed snapshot proofs retained across a channel replacement (bounded, idempotent). */
  private readonly committedSnapshotAcks = new Map<string, Extract<CoopMessage, { t: "coopSnapshotAck" }>>();
  private readonly operationContinuationTimers = new Map<string, OperationContinuationDeadline>();
  /** A final lost operation has no follower that can make the receiver request its missing revision. */
  private readonly operationDeliveryRetries = new Map<string, PendingOperationDeliveryRetry>();
  /** One-shot lifecycle edges already emitted by this manager; fixed-cap and reset with the session lifecycle. */
  private readonly tracedOperationStages = new Set<string>();
  private readonly exhaustedOperationContinuations = new Set<string>();
  private readonly scheduleOperationContinuationDeadline: (callback: () => void, ms: number) => () => void;
  private readonly operationAuthorityContinuationDeadlineMs: number;
  private readonly operationPeerContinuationDeadlineMs: number;
  private disposed = false;

  constructor(
    private readonly transport: CoopTransport,
    private readonly hooks: CoopDurabilityHooks = {},
    journalCapacity = 256,
  ) {
    this.journal = new CoopJournal(journalCapacity);
    this.scheduleRecovery = hooks.scheduleRecovery ?? defaultDurabilitySchedule;
    this.recoveryNow = hooks.recoveryNow ?? Date.now;
    this.recoveryInitialMs = hooks.recoveryInitialMs ?? DURABILITY_RECOVERY_INITIAL_MS;
    this.recoveryMaxMs = hooks.recoveryMaxMs ?? DURABILITY_RECOVERY_MAX_MS;
    this.recoveryMaxAttempts = hooks.recoveryMaxAttempts ?? DURABILITY_RECOVERY_MAX_ATTEMPTS;
    this.recoveryDeadlineMs = hooks.recoveryDeadlineMs ?? DURABILITY_RECOVERY_DEADLINE_MS;
    this.deferredRetryMs = hooks.deferredRetryMs ?? DURABILITY_DEFERRED_RETRY_MS;
    this.deferredDeadlineMs = hooks.deferredDeadlineMs ?? DURABILITY_DEFERRED_DEADLINE_MS;
    this.deferredFollowerLimit = journalCapacity;
    this.scheduleOperationContinuationDeadline =
      hooks.scheduleOperationContinuationDeadline ?? defaultDurabilitySchedule;
    this.operationPeerContinuationDeadlineMs =
      hooks.operationContinuationDeadlineMs ?? OPERATION_PEER_CONTINUATION_DEADLINE_MS;
    // Keep the old single-hook test seam backwards compatible: a caller that supplies only the peer value
    // still gets one deterministic budget for both stages. Production, which supplies neither, gets the
    // deliberately wider authority-construction window.
    this.operationAuthorityContinuationDeadlineMs =
      hooks.operationAuthorityContinuationDeadlineMs
      ?? hooks.operationContinuationDeadlineMs
      ?? OPERATION_AUTHORITY_CONTINUATION_DEADLINE_MS;
    if (
      !Number.isSafeInteger(this.recoveryInitialMs)
      || this.recoveryInitialMs <= 0
      || !Number.isSafeInteger(this.recoveryMaxMs)
      || this.recoveryMaxMs < this.recoveryInitialMs
      || !Number.isSafeInteger(this.recoveryMaxAttempts)
      || this.recoveryMaxAttempts <= 0
      || !Number.isSafeInteger(this.recoveryDeadlineMs)
      || this.recoveryDeadlineMs < this.recoveryInitialMs
      || !Number.isSafeInteger(this.deferredRetryMs)
      || this.deferredRetryMs <= 0
      || !Number.isSafeInteger(this.deferredDeadlineMs)
      || this.deferredDeadlineMs < this.deferredRetryMs
      || !Number.isSafeInteger(this.deferredFollowerLimit)
      || this.deferredFollowerLimit <= 0
      || !Number.isSafeInteger(this.operationAuthorityContinuationDeadlineMs)
      || this.operationAuthorityContinuationDeadlineMs <= 0
      || !Number.isSafeInteger(this.operationPeerContinuationDeadlineMs)
      || this.operationPeerContinuationDeadlineMs <= 0
    ) {
      throw new Error("invalid durability recovery timing configuration");
    }
    this.off = transport.onMessage(msg => this.onMessage(msg));
  }

  private recordOperationCausalStage(authority: CoopOperationAuthorityAddress, stage: string, detail?: string): void {
    const stageKey = `${operationAuthorityKey(authority)}:${this.transport.role}:${stage}:${detail ?? ""}`;
    if (this.tracedOperationStages.has(stageKey)) {
      return;
    }
    this.tracedOperationStages.add(stageKey);
    while (this.tracedOperationStages.size > TRACED_OPERATION_STAGE_LIMIT) {
      const oldest = this.tracedOperationStages.values().next().value as string | undefined;
      if (oldest == null) {
        break;
      }
      this.tracedOperationStages.delete(oldest);
    }
    recordCoopCausalEvent({
      domain: "operation",
      stage,
      causalId: operationCausalId(authority),
      role: this.transport.role,
      epoch: authority.epoch,
      revision: authority.seq,
      wave: authority.wave,
      turn: authority.turn,
      ...(detail == null ? {} : { detail }),
    });
  }

  /**
   * COMMIT a durable op (committer side): journal it (so it can be resent/replayed) then broadcast it. The
   * broadcast rides the transport's outbound queue, so a send while the channel is dark is not lost (§4.3).
   * `seq` MUST be monotonic per class (the envelope's `revision`).
   */
  commit(cls: string, seq: number, msg: CoopMessage): boolean {
    // Journal BEFORE the send, so a send that THROWS (a DEAD channel at send time - a real WebRTC
    // InvalidStateError, not merely a dark/queued channel) leaves the op journaled + retriable: the unacked
    // tail retains it and a reconnect resends it. Catch the throw so it never breaks the committer (the
    // op is not dropped - it stays in the journal for the reconnect tail / coopResyncAll to recover).
    try {
      if (!this.journal.commit(cls, seq, msg)) {
        return false;
      }
    } catch (e) {
      coopWarn("durability", `commit journal retention THREW cls=${cls} seq=${seq}`, e);
      return false;
    }
    const operation = retainedOperationAuthorityFor(cls, seq, msg);
    if (operation != null) {
      this.recordOperationCausalStage(operation.authority, "retained");
    }
    if (operation != null && seq > this.journal.ackedThrough(cls)) {
      const key = operationAuthorityKey(operation.authority);
      if (!this.pendingHostOperationContinuations.has(key)) {
        this.pendingHostOperationContinuations.set(key, {
          ...operation,
          authoritySurfaceRearmed: false,
          materialWaiters: new Set(),
        });
      }
      this.armOperationContinuationDeadline(operation.authority, "authority-surface");
      this.armOperationDeliveryRetry(operation.authority);
    }
    try {
      this.transport.send(msg);
    } catch (e) {
      coopWarn("durability", `commit send THREW cls=${cls} seq=${seq} (op stays journaled + retriable)`, e);
    }
    return true;
  }

  /**
   * Host phase barrier for one exact retained operation. This proves only that the peer installed the
   * canonical material state; it deliberately does NOT release the journal. The retained entry survives
   * until the later, independently addressed `continuationReady` proof opens the peer's real public UI.
   */
  waitForOperationMaterialApplied(operationId: string): Promise<boolean> {
    if (
      this.disposed
      || this.transport.role !== "host"
      || typeof operationId !== "string"
      || operationId.length === 0
    ) {
      return Promise.resolve(false);
    }
    const matches = [...this.pendingHostOperationContinuations.entries()].filter(
      ([, candidate]) => candidate.authority.operationId === operationId,
    );
    if (matches.length !== 1) {
      return Promise.resolve(false);
    }
    const [key, pending] = matches[0];
    const evidence = this.hostOperationAckEvidence.get(key);
    if (evidence != null && OPERATION_ACK_STAGE_ORDER[evidence.stage] >= OPERATION_ACK_STAGE_ORDER.materialApplied) {
      return Promise.resolve(true);
    }
    if (
      this.exhaustedOperationContinuations.has(key)
      || this.journal.ackedThrough(pending.authority.cls) >= pending.authority.seq
    ) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>(resolve => pending.materialWaiters.add(resolve));
  }

  /** Handle an inbound wire message: the ACK/reconnect arms, plus (if wired) the durable op stream. */
  private onMessage(msg: CoopMessage): void {
    if (msg.t === "coopSnapshotAck") {
      this.acceptSnapshotAck(msg);
      return;
    }
    if (msg.t === "coopAck") {
      const retained = this.journal.entry(msg.cls, msg.seq);
      const retainedOperation =
        retained == null ? null : retainedOperationAuthorityFor(retained.cls, retained.seq, retained.msg);
      if (retainedOperation != null || msg.stage != null || msg.operationId != null) {
        // Operation envelopes use exact ordered evidence. A legacy/material-only cumulative ACK can never
        // discard the canonical result before the receiver proves its real continuation surface opened.
        this.acceptOperationAck(msg, retained);
        return;
      }
      this.acceptCumulativeAck(msg.cls, msg.seq);
      return;
    }
    if (msg.t === "coopResync") {
      this.serveResync(msg.cls, msg.from);
      return;
    }
    if (msg.t === "coopResyncAll") {
      // #898: the peer reconnected and asked us (the committer) to proactively replay our full
      // committed-but-unacked tail. This is the ONLY path that recovers the FIRST op of a fresh class -
      // the receiver could not name it in a per-class `coopResync` because it is not in its ledger.
      this.resendUnackedTail("coopResyncAll");
      return;
    }
    const key = this.hooks.extractKey?.(msg) ?? null;
    if (key == null) {
      return; // not a durable op (or no receiver wired) - ignore
    }
    this.receiveOp(key.cls, key.seq, msg);
  }

  /** Receiver: apply an inbound committed op idempotently by `(cls, seq)` (§1.6), then ACK / request tail. */
  private receiveOp(cls: string, seq: number, msg: CoopMessage): void {
    const operation = operationAuthorityFor(cls, seq, msg);
    const retainedOperation = retainedOperationAuthorityFor(cls, seq, msg);
    const retainedWaveAuthority =
      operation == null
      && retainedOperation != null
      && msg.t === "envelope"
      && msg.envelope.pendingOperation?.kind === "WAVE_ADVANCE"
        ? retainedOperation
        : null;
    if (this.ledger.isDuplicate(cls, seq)) {
      this.clearDeferred(cls);
      this.clearRecoveryAfterProgress(cls);
      // Already applied (a safe resend, §4.2): re-ACK so the committer stops resending, do NOT re-apply.
      if (retainedWaveAuthority != null) {
        const key = operationAuthorityKey(retainedWaveAuthority.authority);
        const pending = this.pendingRetainedWaveAcks.get(key);
        if (pending?.completed === true && pending.ackChain != null) {
          for (const ack of pending.ackChain) {
            try {
              this.transport.send(ack);
            } catch (error) {
              coopWarn("durability", `retained WAVE_ADVANCE ACK-chain resend deferred key=${key}`, error);
            }
          }
        }
      } else if (operation == null) {
        this.transport.send({ t: "coopAck", cls, seq: this.ledger.appliedThrough(cls) });
      } else {
        this.reackDuplicateOperation(operation.authority);
      }
      this.drainDeferredFollowers(cls);
      return;
    }
    if (this.ledger.hasGap(cls, seq)) {
      const deferred = this.pendingDeferred.get(cls);
      if (deferred != null && seq > deferred.entry.seq) {
        const followers = this.deferredFollowers.get(cls) ?? new Map<number, CoopMessage>();
        if (followers.size >= this.deferredFollowerLimit && !followers.has(seq)) {
          coopWarn(
            "durability",
            `deferred follower overflow cls=${cls} waiting=${deferred.entry.seq} got=${seq} `
              + `limit=${this.deferredFollowerLimit} -> bounded recovery`,
          );
          this.requestBoundedRecovery(cls, seq, "gap", operation?.authority);
          return;
        }
        followers.set(seq, msg);
        this.deferredFollowers.set(cls, followers);
        coopLog("durability", `buffer after deferred cls=${cls} waiting=${deferred.entry.seq} got=${seq}`);
        return;
      }
      // A revision was missed: do NOT apply out of order - request the tail after our last-applied (§4.4).
      coopWarn("durability", `gap cls=${cls} got=${seq} have=${this.ledger.appliedThrough(cls)} -> request tail`);
      this.requestBoundedRecovery(cls, seq, "gap", operation?.authority);
      return;
    }
    const operationKey = operation == null ? null : operationAuthorityKey(operation.authority);
    if (operation != null && operationKey != null && !this.pendingOperationContinuations.has(operationKey)) {
      this.pendingOperationContinuations.set(operationKey, {
        authority: operation.authority,
        expectedSurface: operation.expectedSurface,
        lastAck: null,
      });
    }
    // In order: apply, then GATE the ACK + ledger advance on the apply OUTCOME (W2e-R P0-1). Before, a void
    // apply was ALWAYS followed by markApplied + coopAck, so a receiver could claim an op applied while its
    // applier did NOTHING (a rejected apply, or a thrown one - which previously escaped uncaught). Now:
    //  - `applied`/`duplicate` (or a legacy `void` return) -> ACK + advance (a duplicate ACKs too, so a
    //    cross-carrier / resend re-delivery of an already-consumed op can never spin the committer forever);
    //  - `rejected` (or a thrown apply) -> do NOT ACK, do NOT advance: the op stays retriable (a later
    //    resend / reconnect tail re-delivers it), which is the honest close of the ACK-without-mutation P0.
    const outcome = this.safeApply({ cls, seq, msg });
    if (outcome === "deferred") {
      this.deferApply({ cls, seq, msg });
      return;
    }
    this.clearDeferred(cls);
    if (outcome === "rejected") {
      if (operation != null && operationKey != null) {
        this.pendingOperationContinuations.delete(operationKey);
        this.recordOperationCausalStage(operation.authority, "material-rejected");
      }
      coopWarn("durability", `apply REJECTED cls=${cls} seq=${seq} -> no ack (retriable)`);
      this.requestBoundedRecovery(cls, seq, "apply-rejected", operation?.authority);
      return;
    }
    this.ledger.markApplied(cls, seq);
    this.clearRecoveryAfterProgress(cls);
    if (retainedWaveAuthority != null) {
      const key = operationAuthorityKey(retainedWaveAuthority.authority);
      const canonicalEnvelope = JSON.stringify(msg);
      const prior = this.pendingRetainedWaveAcks.get(key);
      if (prior != null && prior.canonicalEnvelope !== canonicalEnvelope) {
        coopWarn("durability", `retained WAVE_ADVANCE canonical conflict key=${key} -> no ACK`);
        this.requestBoundedRecovery(cls, seq, "apply-rejected", retainedWaveAuthority.authority);
        return;
      }
      this.pendingRetainedWaveAcks.set(key, {
        authority: retainedWaveAuthority.authority,
        canonicalEnvelope,
        completed: false,
        ackChain: null,
      });
      this.pruneCompletedRetainedWaveAcks();
      // Ordering is applied, so later same-boundary operations may drain. Authority stays silent until the
      // wave adapter proves the exact embedded DATA and its destination continuation.
      this.drainDeferredFollowers(cls);
      return;
    }
    if (operation == null) {
      this.transport.send({ t: "coopAck", cls, seq });
      this.drainDeferredFollowers(cls);
      return;
    }
    // Receiver ordering advances now so deferred followers can apply, but material evidence cannot retire
    // the host journal. The real public surface publishes presentationReady then continuationReady below.
    const material = this.sendOperationAck(operation.authority, "materialApplied");
    if (material == null) {
      if (operationKey != null) {
        this.pendingOperationContinuations.delete(operationKey);
      }
      this.recordOperationCausalStage(operation.authority, "material-rejected", "reason=ack-refused");
      this.requestBoundedRecovery(cls, seq, "apply-rejected", operation.authority);
      return;
    }
    const pending = this.pendingOperationContinuations.get(operationAuthorityKey(operation.authority));
    if (pending != null) {
      pending.lastAck = material;
      if (pending.observed != null) {
        this.notifyOperationContinuationSurface(pending.observed.surface, pending.observed.address);
      }
    }
    this.drainDeferredFollowers(cls);
  }

  /**
   * Retry one or all valid-but-not-ready entries immediately. Public so a concrete UI/phase wake can avoid
   * waiting for the polling interval. Returns the number of exact entries reattempted.
   */
  retryDeferred(cls?: string): number {
    if (this.disposed) {
      return 0;
    }
    const targets = cls == null ? [...this.pendingDeferred.keys()] : this.pendingDeferred.has(cls) ? [cls] : [];
    let retried = 0;
    for (const target of targets) {
      const pending = this.pendingDeferred.get(target);
      if (pending == null) {
        continue;
      }
      pending.cancel();
      pending.cancel = () => {};
      retried++;
      this.receiveOp(pending.entry.cls, pending.entry.seq, pending.entry.msg);
    }
    return retried;
  }

  /**
   * Complete one exact staged WAVE_ADVANCE after its adapter proves immutable DATA application and a real
   * destination continuation. Receive ordering already advanced at staging; these exact stages affect only
   * host retention, so later same-boundary operations never deadlock behind the wave transaction.
   */
  completeRetainedWaveAdvance(
    envelope: Extract<CoopMessage, { t: "envelope" }>["envelope"],
    surface: CoopOperationContinuationSurface,
    current: CoopOperationContinuationAddress,
  ): boolean {
    if (this.disposed || envelope.pendingOperation?.kind !== "WAVE_ADVANCE") {
      return false;
    }
    const msg: Extract<CoopMessage, { t: "envelope" }> = { t: "envelope", envelope };
    const extracted = this.hooks.extractKey?.(msg) ?? null;
    if (extracted == null) {
      return false;
    }
    const retained = retainedOperationAuthorityFor(extracted.cls, extracted.seq, msg);
    if (
      retained == null
      || !operationContinuationMatches(retained.expectedSurface, retained.authority, surface, current)
    ) {
      return false;
    }
    const key = operationAuthorityKey(retained.authority);
    const pending = this.pendingRetainedWaveAcks.get(key);
    if (
      pending == null
      || pending.canonicalEnvelope !== JSON.stringify(msg)
      || this.ledger.appliedThrough(extracted.cls) < extracted.seq
    ) {
      return false;
    }
    if (pending.completed) {
      const evidence = this.guestOperationAckEvidence.get(key);
      if (evidence?.stage === "continuationReady") {
        this.transport.send(evidence.value);
        return true;
      }
      return false;
    }
    const material = this.sendOperationAck(retained.authority, "materialApplied");
    if (material == null) {
      return false;
    }
    const presentation = this.sendOperationAck(retained.authority, "presentationReady", surface, current);
    if (presentation == null) {
      return false;
    }
    const continuation = this.sendOperationAck(retained.authority, "continuationReady", surface, current);
    if (continuation == null) {
      return false;
    }
    pending.ackChain = [material, presentation, continuation];
    pending.completed = true;
    this.pruneCompletedRetainedWaveAcks();
    return true;
  }

  /**
   * A completed wave proof must survive long enough to answer a lost-final-ACK replay, but it must not grow
   * for the lifetime of a long run. Keep at most one journal window of completed evidence; an incomplete
   * entry is never evicted because that would strand its host-side canonical transaction.
   */
  private pruneCompletedRetainedWaveAcks(): void {
    while (this.pendingRetainedWaveAcks.size > this.deferredFollowerLimit) {
      const oldestCompleted = [...this.pendingRetainedWaveAcks].find(([, pending]) => pending.completed);
      if (oldestCompleted == null) {
        return;
      }
      const [key] = oldestCompleted;
      this.pendingRetainedWaveAcks.delete(key);
      this.guestOperationAckEvidence.delete(key);
    }
  }

  private clearRetainedWaveAcks(): void {
    for (const key of this.pendingRetainedWaveAcks.keys()) {
      this.guestOperationAckEvidence.delete(key);
    }
    this.pendingRetainedWaveAcks.clear();
  }

  private discardRetainedWaveAcksThrough(marks: Record<string, number>): void {
    for (const [key, pending] of this.pendingRetainedWaveAcks) {
      if ((marks[pending.authority.cls] ?? 0) < pending.authority.seq) {
        continue;
      }
      this.pendingRetainedWaveAcks.delete(key);
      this.guestOperationAckEvidence.delete(key);
    }
  }

  private deferApply(entry: CoopJournalEntry): void {
    if (this.disposed) {
      return;
    }
    // A now-valid entry supersedes any earlier apply-rejected recovery at the same receive cursor. Its
    // remaining wait is normal engine latency, not a reason to exhaust into a shared terminal.
    const recovery = this.pendingRecovery.get(entry.cls);
    recovery?.cancel();
    this.pendingRecovery.delete(entry.cls);
    this.exhaustedRecovery.delete(entry.cls);
    const current = this.pendingDeferred.get(entry.cls);
    if (current?.entry.seq === entry.seq) {
      current.entry = entry;
      current.attempts++;
      this.scheduleDeferredRetry(current);
      return;
    }
    current?.cancel();
    const pending: PendingDeferredApply = {
      entry,
      startedAt: this.recoveryNow(),
      attempts: 1,
      cancel: () => {},
    };
    this.pendingDeferred.set(entry.cls, pending);
    this.scheduleDeferredRetry(pending);
    const operation = operationAuthorityFor(entry.cls, entry.seq, entry.msg);
    if (operation != null) {
      this.recordOperationCausalStage(operation.authority, "material-deferred");
    }
    coopLog("durability", `apply DEFERRED cls=${entry.cls} seq=${entry.seq} -> no ack (boundary pending)`);
  }

  private scheduleDeferredRetry(pending: PendingDeferredApply): void {
    pending.cancel();
    const elapsed = this.recoveryNow() - pending.startedAt;
    if (elapsed >= this.deferredDeadlineMs) {
      this.exhaustDeferred(pending);
      return;
    }
    const delay = Math.min(this.deferredRetryMs, this.deferredDeadlineMs - elapsed);
    pending.cancel = this.scheduleRecovery(() => {
      if (this.pendingDeferred.get(pending.entry.cls) !== pending) {
        return;
      }
      if (this.recoveryNow() - pending.startedAt >= this.deferredDeadlineMs) {
        this.exhaustDeferred(pending);
        return;
      }
      this.receiveOp(pending.entry.cls, pending.entry.seq, pending.entry.msg);
    }, delay);
  }

  private exhaustDeferred(pending: PendingDeferredApply): void {
    if (this.pendingDeferred.get(pending.entry.cls) !== pending) {
      return;
    }
    pending.cancel();
    this.pendingDeferred.delete(pending.entry.cls);
    this.deferredFollowers.delete(pending.entry.cls);
    const failure: CoopDurabilityRecoveryFailure = {
      cls: pending.entry.cls,
      from: this.ledger.appliedThrough(pending.entry.cls),
      blockedSeq: pending.entry.seq,
      attempts: pending.attempts,
      reason: "deferred-timeout",
    };
    coopWarn(
      "durability",
      `deferred continuation EXHAUSTED cls=${failure.cls} from=${failure.from} blocked=${failure.blockedSeq} `
        + `attempts=${failure.attempts} deadlineMs=${this.deferredDeadlineMs}`,
    );
    const operation = operationAuthorityFor(pending.entry.cls, pending.entry.seq, pending.entry.msg);
    if (operation != null) {
      this.recordOperationCausalStage(operation.authority, "terminal", "reason=deferred-timeout");
    }
    try {
      this.hooks.onRecoveryExhausted?.(failure);
    } catch (error) {
      coopWarn("durability", `deferred terminal hook threw cls=${failure.cls} (isolated)`, error);
    }
  }

  private clearDeferred(cls: string): void {
    const pending = this.pendingDeferred.get(cls);
    pending?.cancel();
    this.pendingDeferred.delete(cls);
  }

  private drainDeferredFollowers(cls: string): void {
    const followers = this.deferredFollowers.get(cls);
    if (followers == null) {
      return;
    }
    for (const seq of [...followers.keys()]) {
      if (seq <= this.ledger.appliedThrough(cls)) {
        followers.delete(seq);
      }
    }
    const nextSeq = this.ledger.appliedThrough(cls) + 1;
    const next = followers.get(nextSeq);
    if (next != null) {
      followers.delete(nextSeq);
      if (followers.size === 0) {
        this.deferredFollowers.delete(cls);
      }
      this.receiveOp(cls, nextSeq, next);
      return;
    }
    if (followers.size === 0) {
      this.deferredFollowers.delete(cls);
      return;
    }
    // The deferred head completed but a later buffered revision proves an intermediate frame is missing.
    // Only now is this a genuine gap; enter the existing bounded resync path from the advanced cursor.
    const blockedSeq = Math.min(...followers.keys());
    const blockedMessage = followers.get(blockedSeq);
    const operation = blockedMessage == null ? null : operationAuthorityFor(cls, blockedSeq, blockedMessage);
    this.requestBoundedRecovery(cls, blockedSeq, "gap", operation?.authority);
  }

  private sendOperationAck(
    authority: CoopOperationAuthorityAddress,
    stage: CoopAuthorityAckStage,
    surface?: CoopOperationContinuationSurface,
    continuation?: CoopOperationContinuationAddress,
  ): Extract<CoopMessage, { t: "coopAck" }> | null {
    const key = operationAuthorityKey(authority);
    const prior = this.guestOperationAckEvidence.get(key);
    if (prior == null ? stage !== "materialApplied" : false) {
      return null;
    }
    if (prior != null) {
      if (prior.stage === stage) {
        try {
          this.transport.send(prior.value);
        } catch (error) {
          coopWarn("durability", `operation ACK resend deferred key=${key} stage=${stage}`, error);
        }
        return prior.value;
      }
      if (OPERATION_ACK_STAGE_ORDER[stage] !== OPERATION_ACK_STAGE_ORDER[prior.stage] + 1) {
        return null;
      }
    }
    if (
      stage === "materialApplied" ? surface != null || continuation != null : surface == null || continuation == null
    ) {
      return null;
    }
    if (
      continuation != null
      && (!isSafeOperationAddressPart(continuation.epoch, false)
        || !isSafeOperationAddressPart(continuation.wave)
        || !isSafeOperationAddressPart(continuation.turn))
    ) {
      return null;
    }
    if (
      stage === "continuationReady"
      && prior != null
      && (prior.value.surface !== surface
        || prior.value.continuationEpoch !== continuation?.epoch
        || prior.value.continuationWave !== continuation?.wave
        || prior.value.continuationTurn !== continuation?.turn)
    ) {
      return null;
    }
    const ack: Extract<CoopMessage, { t: "coopAck" }> = {
      t: "coopAck",
      cls: authority.cls,
      seq: authority.seq,
      stage,
      operationId: authority.operationId,
      epoch: authority.epoch,
      wave: authority.wave,
      turn: authority.turn,
      ...(surface == null || continuation == null
        ? {}
        : {
            surface,
            continuationEpoch: continuation.epoch,
            continuationWave: continuation.wave,
            continuationTurn: continuation.turn,
          }),
    };
    const evidence = { stage, canonical: operationAckCanonical(ack), value: ack };
    this.guestOperationAckEvidence.set(key, evidence);
    const pending = this.pendingOperationContinuations.get(key);
    if (pending != null) {
      pending.lastAck = ack;
    }
    try {
      this.transport.send(ack);
    } catch (error) {
      // Evidence remains canonical locally. A retained-envelope replay/reconnect re-sends this exact stage.
      coopWarn("durability", `operation ACK send deferred key=${key} stage=${stage}`, error);
    }
    this.recordOperationCausalStage(
      authority,
      stage === "materialApplied"
        ? "material-applied"
        : stage === "presentationReady"
          ? "presentation-ready"
          : "continuation-ready",
      surface == null || continuation == null
        ? "proof=published"
        : `proof=published surface=${surface} at=${continuation.epoch}/${continuation.wave}/${continuation.turn}`,
    );
    return ack;
  }

  private reackDuplicateOperation(authority: CoopOperationAuthorityAddress): void {
    const key = operationAuthorityKey(authority);
    const evidence = this.guestOperationAckEvidence.get(key);
    if (evidence == null) {
      this.sendOperationAck(authority, "materialApplied");
      return;
    }
    try {
      this.transport.send(evidence.value);
    } catch (error) {
      coopWarn("durability", `duplicate operation re-ACK deferred key=${key} stage=${evidence.stage}`, error);
    }
  }

  /**
   * Guest public-UI readiness chokepoint. One matching observation advances both remaining ordered stages;
   * a stale address or unrelated surface emits nothing and therefore cannot release host retention.
   */
  notifyOperationContinuationSurface(
    surface: CoopOperationContinuationSurface,
    current: CoopOperationContinuationAddress,
  ): number {
    if (
      this.disposed
      || !isSafeOperationAddressPart(current.epoch, false)
      || !isSafeOperationAddressPart(current.wave)
      || !isSafeOperationAddressPart(current.turn)
    ) {
      return 0;
    }
    let released = 0;
    const pending = [...this.pendingOperationContinuations.values()].sort(
      (left, right) => left.authority.seq - right.authority.seq,
    );
    for (const operation of pending) {
      if (!operationContinuationMatches(operation.expectedSurface, operation.authority, surface, current)) {
        continue;
      }
      if (operation.lastAck == null) {
        operation.observed = { surface, address: { ...current } };
        continue;
      }
      if (this.sendOperationAck(operation.authority, "presentationReady", surface, current) == null) {
        continue;
      }
      if (this.sendOperationAck(operation.authority, "continuationReady", surface, current) == null) {
        continue;
      }
      this.pendingOperationContinuations.delete(operationAuthorityKey(operation.authority));
      released++;
    }
    return released;
  }

  /**
   * Host public-UI readiness chokepoint. The initial fixed budget still bounds the host reaching its own
   * executable continuation. Its first correctly addressed surface then starts one fresh fixed peer budget.
   * No relay ACK/input can call this method, and duplicate surface observations can never extend the window.
   */
  notifyOperationAuthorityContinuationSurface(
    surface: CoopOperationContinuationSurface,
    current: CoopOperationContinuationAddress,
  ): number {
    if (
      this.disposed
      || this.transport.role !== "host"
      || !isSafeOperationAddressPart(current.epoch, false)
      || !isSafeOperationAddressPart(current.wave)
      || !isSafeOperationAddressPart(current.turn)
    ) {
      return 0;
    }
    let rearmed = 0;
    const pending = [...this.pendingHostOperationContinuations.values()].sort(
      (left, right) => left.authority.seq - right.authority.seq,
    );
    for (const operation of pending) {
      if (
        operation.authoritySurfaceRearmed
        || !operationContinuationMatches(operation.expectedSurface, operation.authority, surface, current)
      ) {
        continue;
      }
      const key = operationAuthorityKey(operation.authority);
      const deadline = this.operationContinuationTimers.get(key);
      if (
        deadline == null
        || this.exhaustedOperationContinuations.has(key)
        || this.journal.ackedThrough(operation.authority.cls) >= operation.authority.seq
        || this.hostOperationAckEvidence.get(key)?.stage === "continuationReady"
      ) {
        continue;
      }
      operation.authoritySurfaceRearmed = true;
      deadline.cancel();
      this.operationContinuationTimers.delete(key);
      this.armOperationContinuationDeadline(operation.authority, "peer-convergence");
      coopLog(
        "durability",
        `host operation continuation window REARM key=${key} surface=${surface} at=${current.epoch}/${current.wave}/${current.turn}`,
      );
      rearmed++;
    }
    return rearmed;
  }

  private acceptOperationAck(msg: Extract<CoopMessage, { t: "coopAck" }>, retained: CoopJournalEntry | null): void {
    const admitted = retained == null ? null : retainedOperationAuthorityFor(retained.cls, retained.seq, retained.msg);
    if (admitted == null) {
      if (
        isOperationAckStage(msg.stage)
        && typeof msg.operationId === "string"
        && isSafeOperationAddressPart(msg.epoch, false)
        && isSafeOperationAddressPart(msg.wave)
        && isSafeOperationAddressPart(msg.turn)
      ) {
        const key = operationAuthorityKey({
          cls: msg.cls,
          seq: msg.seq,
          operationId: msg.operationId,
          epoch: msg.epoch,
          wave: msg.wave,
          turn: msg.turn,
        });
        const prior = this.hostOperationAckEvidence.get(key);
        if (prior?.stage === "continuationReady" && prior.canonical === operationAckCanonical(msg)) {
          return;
        }
      }
      coopWarn("durability", `DROP operation ACK without exact retained authority cls=${msg.cls} seq=${msg.seq}`);
      return;
    }
    const { authority, expectedSurface } = admitted;
    const key = operationAuthorityKey(authority);
    if (!isOperationAckStage(msg.stage) || !operationAckMatchesAuthority(msg, authority)) {
      coopWarn("durability", `DROP malformed/wrong-address operation ACK key=${key}`);
      return;
    }
    if (msg.stage === "materialApplied") {
      if (
        msg.surface != null
        || msg.continuationEpoch != null
        || msg.continuationWave != null
        || msg.continuationTurn != null
      ) {
        coopWarn("durability", `DROP material operation ACK carrying premature continuation key=${key}`);
        return;
      }
    } else {
      const continuation = {
        epoch: msg.continuationEpoch,
        wave: msg.continuationWave,
        turn: msg.continuationTurn,
      };
      if (
        (msg.surface !== "command" && msg.surface !== "sharedInput" && msg.surface !== "terminal")
        || !isSafeOperationAddressPart(continuation.epoch, false)
        || !isSafeOperationAddressPart(continuation.wave)
        || !isSafeOperationAddressPart(continuation.turn)
        || !operationContinuationMatches(
          expectedSurface,
          authority,
          msg.surface,
          continuation as CoopOperationContinuationAddress,
        )
      ) {
        coopWarn("durability", `DROP wrong-surface/continuation-address operation ACK key=${key}`);
        return;
      }
    }
    const canonical = operationAckCanonical(msg);
    const prior = this.hostOperationAckEvidence.get(key);
    if (prior == null ? msg.stage !== "materialApplied" : false) {
      coopWarn("durability", `DROP operation ACK that skipped material stage key=${key} stage=${msg.stage}`);
      return;
    }
    if (prior != null) {
      if (prior.stage === msg.stage) {
        if (prior.canonical !== canonical) {
          coopWarn("durability", `DROP conflicting duplicate operation ACK key=${key} stage=${msg.stage}`);
        }
        return;
      }
      if (OPERATION_ACK_STAGE_ORDER[msg.stage] !== OPERATION_ACK_STAGE_ORDER[prior.stage] + 1) {
        coopWarn("durability", `DROP skipped/regressed operation ACK key=${key} stage=${msg.stage}`);
        return;
      }
      if (
        msg.stage === "continuationReady"
        && (prior.value.surface !== msg.surface
          || prior.value.continuationEpoch !== msg.continuationEpoch
          || prior.value.continuationWave !== msg.continuationWave
          || prior.value.continuationTurn !== msg.continuationTurn)
      ) {
        coopWarn("durability", `DROP operation continuation whose presentation address changed key=${key}`);
        return;
      }
    }
    this.hostOperationAckEvidence.set(key, { stage: msg.stage, canonical, value: msg });
    this.recordOperationCausalStage(
      authority,
      msg.stage === "materialApplied"
        ? "material-applied"
        : msg.stage === "presentationReady"
          ? "presentation-ready"
          : "continuation-ready",
      msg.surface == null
        ? "proof=received"
        : `proof=received surface=${msg.surface} at=${msg.continuationEpoch}/${msg.continuationWave}/${msg.continuationTurn}`,
    );
    if (msg.stage === "materialApplied" || msg.stage === "continuationReady") {
      this.cancelOperationDeliveryRetry(key);
      this.settleOperationMaterialWaiters(key, true);
    }
    if (msg.stage !== "continuationReady") {
      return;
    }
    this.releaseAcknowledgedPrefix(authority.cls);
  }

  /**
   * Record a normal cumulative ACK without allowing it to jump an earlier retained operation. The shared
   * `op:global` stream intentionally mixes retained UI operations with ordinary cumulative entries. A later
   * plain ACK proves only those ordinary entries; it cannot prove an earlier reward/shop/event surface opened.
   */
  private acceptCumulativeAck(cls: string, seq: number): void {
    const highWater = this.journal.highWaterMark(cls);
    if (!Number.isSafeInteger(seq) || seq <= 0 || seq > highWater) {
      coopWarn("durability", `DROP cumulative ACK outside committed range cls=${cls} seq=${seq} high=${highWater}`);
      return;
    }
    const prior = this.pendingCumulativeAcks.get(cls) ?? this.journal.ackedThrough(cls);
    if (seq > prior) {
      this.pendingCumulativeAcks.set(cls, seq);
    }
    this.releaseAcknowledgedPrefix(cls);
  }

  /** Release only the contiguous prefix for which every entry has its own required proof. */
  private releaseAcknowledgedPrefix(cls: string): void {
    const prior = this.journal.ackedThrough(cls);
    const cumulativeThrough = this.pendingCumulativeAcks.get(cls) ?? prior;
    let through = prior;
    for (const entry of this.journal.tailFrom(cls, prior)) {
      if (entry.seq !== through + 1) {
        coopWarn("durability", `retain ACK at journal gap cls=${cls} expected=${through + 1} got=${entry.seq}`);
        break;
      }
      const admitted = retainedOperationAuthorityFor(entry.cls, entry.seq, entry.msg);
      if (admitted != null) {
        const key = operationAuthorityKey(admitted.authority);
        if (this.hostOperationAckEvidence.get(key)?.stage !== "continuationReady") {
          break;
        }
        this.operationContinuationTimers.get(key)?.cancel();
        this.operationContinuationTimers.delete(key);
        this.cancelOperationDeliveryRetry(key);
        this.settleOperationMaterialWaiters(key, true);
        this.pendingHostOperationContinuations.delete(key);
        this.recordOperationCausalStage(admitted.authority, "released", "proof=continuation-ready");
      } else if (entry.seq > cumulativeThrough) {
        break;
      }
      through = entry.seq;
    }
    if (through > prior) {
      this.journal.ack(cls, through);
      coopLog("durability", `host RELEASE contiguous acknowledged authority cls=${cls} seq=${through}`);
    }
    if (cumulativeThrough <= through) {
      this.pendingCumulativeAcks.delete(cls);
    }
  }

  /**
   * Register one immutable snapshot frontier before its carrier is sent. A later snapshot ACK has authority
   * only when both the digest and the complete canonical mark set match this bounded host-side record.
   */
  retainSnapshotFrontier(controlDigest: string, marks: Record<string, number>): boolean {
    const normalized = normalizeSnapshotMarks(marks);
    if (
      typeof controlDigest !== "string"
      || controlDigest.length === 0
      || controlDigest.length > 256
      || normalized == null
    ) {
      coopWarn("durability", "refused invalid snapshot frontier registration");
      return false;
    }
    const canonical = snapshotMarksCanonical(normalized);
    const prior = this.retainedSnapshotFrontiers.get(controlDigest);
    if (prior != null) {
      if (prior.canonical !== canonical) {
        coopWarn("durability", `refused conflicting snapshot frontier control=${controlDigest}`);
        return false;
      }
      return true;
    }
    this.retainedSnapshotFrontiers.set(controlDigest, { marks: normalized, canonical });
    while (this.retainedSnapshotFrontiers.size > SNAPSHOT_FRONTIER_RETENTION) {
      const oldest = this.retainedSnapshotFrontiers.keys().next().value as string | undefined;
      if (oldest == null) {
        break;
      }
      this.retainedSnapshotFrontiers.delete(oldest);
    }
    return true;
  }

  /** Accept only an exact proof for a snapshot this manager actually retained before sending. */
  private acceptSnapshotAck(msg: Extract<CoopMessage, { t: "coopSnapshotAck" }>): void {
    const normalized = normalizeSnapshotMarks(msg.marks);
    const retained = this.retainedSnapshotFrontiers.get(msg.controlDigest);
    if (normalized == null || retained == null || snapshotMarksCanonical(normalized) !== retained.canonical) {
      coopWarn("durability", `DROP unknown or altered snapshot ACK control=${msg.controlDigest}`);
      return;
    }
    for (const [cls, snapshotSeq] of Object.entries(retained.marks)) {
      const committedSeq = Math.min(snapshotSeq, this.journal.highWaterMark(cls));
      if (committedSeq <= this.journal.ackedThrough(cls)) {
        continue;
      }
      this.cancelOperationContinuationThrough(cls, committedSeq);
      this.journal.ack(cls, committedSeq);
      const cumulative = this.pendingCumulativeAcks.get(cls);
      if (cumulative != null && cumulative <= committedSeq) {
        this.pendingCumulativeAcks.delete(cls);
      }
      coopLog(
        "durability",
        `host RELEASE checksum-bound snapshot authority cls=${cls} seq=${committedSeq} control=${msg.controlDigest}`,
      );
    }
  }

  /** Cancel retained continuation deadlines even when their concrete journal entry was ring-evicted. */
  private cancelOperationContinuationThrough(cls: string, through: number): void {
    const prefix = `${cls}:`;
    for (const [key, deadline] of [...this.operationContinuationTimers]) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const remainder = key.slice(prefix.length);
      const separator = remainder.indexOf(":");
      const seq = Number(separator < 0 ? remainder : remainder.slice(0, separator));
      if (Number.isSafeInteger(seq) && seq <= through) {
        const pending = this.pendingHostOperationContinuations.get(key);
        const evidence = this.hostOperationAckEvidence.get(key);
        this.settleOperationMaterialWaiters(
          key,
          evidence != null && OPERATION_ACK_STAGE_ORDER[evidence.stage] >= OPERATION_ACK_STAGE_ORDER.materialApplied,
        );
        deadline.cancel();
        this.operationContinuationTimers.delete(key);
        this.cancelOperationDeliveryRetry(key);
        this.pendingHostOperationContinuations.delete(key);
        if (pending != null) {
          this.recordOperationCausalStage(pending.authority, "released", "proof=snapshot");
        }
      }
    }
  }

  private armOperationContinuationDeadline(
    authority: CoopOperationAuthorityAddress,
    stage: "authority-surface" | "peer-convergence",
  ): void {
    const key = operationAuthorityKey(authority);
    if (this.operationContinuationTimers.has(key) || this.exhaustedOperationContinuations.has(key)) {
      return;
    }
    const deadline: OperationContinuationDeadline = { cancel: () => {} };
    const deadlineMs =
      stage === "authority-surface"
        ? this.operationAuthorityContinuationDeadlineMs
        : this.operationPeerContinuationDeadlineMs;
    deadline.cancel = this.scheduleOperationContinuationDeadline(() => {
      // A host-surface rearm replaces the first-stage deadline. A stale callback that was already queued
      // before cancellation has no authority to delete/exhaust the replacement stage.
      if (this.operationContinuationTimers.get(key) !== deadline) {
        return;
      }
      this.operationContinuationTimers.delete(key);
      if (
        this.disposed
        || this.journal.ackedThrough(authority.cls) >= authority.seq
        || this.hostOperationAckEvidence.get(key)?.stage === "continuationReady"
      ) {
        return;
      }
      this.exhaustedOperationContinuations.add(key);
      this.cancelOperationDeliveryRetry(key);
      this.settleOperationMaterialWaiters(key, false);
      this.pendingHostOperationContinuations.delete(key);
      this.recordOperationCausalStage(authority, "terminal", "reason=continuation-timeout");
      coopWarn("durability", `operation continuation EXHAUSTED key=${key}`);
      try {
        this.hooks.onRecoveryExhausted?.({
          cls: authority.cls,
          from: this.journal.ackedThrough(authority.cls),
          blockedSeq: authority.seq,
          attempts: 0,
          reason: "continuation-timeout",
        });
      } catch (error) {
        coopWarn("durability", `operation continuation terminal hook threw key=${key}`, error);
      }
    }, deadlineMs);
    this.operationContinuationTimers.set(key, deadline);
    this.recordOperationCausalStage(authority, "continuation-deadline", `stage=${stage} budgetMs=${deadlineMs}`);
  }

  /**
   * Retransmit an operation until the peer proves material receipt. Gap recovery cannot recover the final
   * lost revision in a class because the receiver has no later follower from which to infer that gap.
   * Continuation retention remains independent: material receipt stops delivery retries, while the exact
   * presentation/continuation ACK is still required to release the journal.
   */
  private armOperationDeliveryRetry(authority: CoopOperationAuthorityAddress): void {
    const key = operationAuthorityKey(authority);
    if (this.operationDeliveryRetries.has(key) || this.exhaustedOperationContinuations.has(key)) {
      return;
    }
    const pending: PendingOperationDeliveryRetry = {
      authority,
      startedAt: this.recoveryNow(),
      attempts: 0,
      cancel: () => {},
    };
    pending.cancel = this.scheduleRecovery(() => this.sendOperationDeliveryRetry(pending), this.recoveryInitialMs);
    this.operationDeliveryRetries.set(key, pending);
  }

  private sendOperationDeliveryRetry(pending: PendingOperationDeliveryRetry): void {
    const { authority } = pending;
    const key = operationAuthorityKey(authority);
    if (this.operationDeliveryRetries.get(key) !== pending) {
      return;
    }
    const evidence = this.hostOperationAckEvidence.get(key);
    if (
      this.disposed
      || this.journal.ackedThrough(authority.cls) >= authority.seq
      || (evidence != null && OPERATION_ACK_STAGE_ORDER[evidence.stage] >= OPERATION_ACK_STAGE_ORDER.materialApplied)
    ) {
      this.cancelOperationDeliveryRetry(key);
      return;
    }
    const elapsed = this.recoveryNow() - pending.startedAt;
    if (pending.attempts >= this.recoveryMaxAttempts || elapsed >= this.recoveryDeadlineMs) {
      this.cancelOperationDeliveryRetry(key);
      this.recordOperationCausalStage(authority, "retry-exhausted", `attempts=${pending.attempts}`);
      coopWarn(
        "durability",
        `operation delivery retries exhausted key=${key} attempts=${pending.attempts}; continuation deadline remains armed`,
      );
      return;
    }
    const retained = this.journal.entry(authority.cls, authority.seq);
    if (retained == null) {
      this.cancelOperationDeliveryRetry(key);
      return;
    }
    pending.attempts++;
    this.recordOperationCausalStage(authority, "delivery-retry", `attempt=${pending.attempts}`);
    coopLog(
      "durability",
      `operation delivery RETRY key=${key} attempt=${pending.attempts}/${this.recoveryMaxAttempts}`,
    );
    try {
      this.transport.send(retained.msg);
    } catch (error) {
      coopWarn("durability", `operation delivery retry send deferred key=${key}`, error);
    }
    if (this.operationDeliveryRetries.get(key) !== pending) {
      return;
    }
    const delay = Math.min(this.recoveryInitialMs * 2 ** (pending.attempts - 1), this.recoveryMaxMs);
    pending.cancel = this.scheduleRecovery(() => this.sendOperationDeliveryRetry(pending), delay);
  }

  private cancelOperationDeliveryRetry(key: string): void {
    const pending = this.operationDeliveryRetries.get(key);
    if (pending == null) {
      return;
    }
    pending.cancel();
    this.operationDeliveryRetries.delete(key);
  }

  /** Resolve and forget every exact phase waiter once; promise continuations run outside this wire stack. */
  private settleOperationMaterialWaiters(key: string, applied: boolean): void {
    const pending = this.pendingHostOperationContinuations.get(key);
    if (pending == null || pending.materialWaiters.size === 0) {
      return;
    }
    const waiters = [...pending.materialWaiters];
    pending.materialWaiters.clear();
    for (const resolve of waiters) {
      resolve(applied);
    }
  }

  /** Engine-free diagnostics used by staging traces and exact lifecycle tests. */
  operationContinuationDiagnostics(): { pending: number; guestStages: number; hostStages: number } {
    return {
      pending: this.pendingOperationContinuations.size,
      guestStages: this.guestOperationAckEvidence.size,
      hostStages: this.hostOperationAckEvidence.size,
    };
  }

  /**
   * Coalesce one missing/rejected class into a single retry schedule. Setting the state before sending is
   * load-bearing: loopback and some test transports deliver synchronously, so a replayed N+1 gap can re-enter
   * this method before the original `coopResync` send returns.
   */
  private requestBoundedRecovery(
    cls: string,
    blockedSeq: number,
    reason: CoopDurabilityRecoveryFailure["reason"],
    authority: CoopOperationAuthorityAddress | null = null,
  ): void {
    if (this.disposed) {
      return;
    }
    const from = this.ledger.appliedThrough(cls);
    if (this.exhaustedRecovery.get(cls) === from) {
      return;
    }
    const current = this.pendingRecovery.get(cls);
    if (current?.from === from) {
      current.blockedSeq = Math.max(current.blockedSeq, blockedSeq);
      if (authority != null && (current.authority == null || reason === "apply-rejected")) {
        current.authority = authority;
      }
      if (reason === "apply-rejected") {
        current.reason = reason;
      }
      return;
    }
    current?.cancel();
    const pending: PendingDurabilityRecovery = {
      cls,
      from,
      blockedSeq,
      attempts: 0,
      reason,
      startedAt: this.recoveryNow(),
      cancel: () => {},
      authority,
    };
    this.pendingRecovery.set(cls, pending);
    this.sendRecoveryAttempt(pending);
  }

  private sendRecoveryAttempt(pending: PendingDurabilityRecovery): void {
    if (this.disposed || this.pendingRecovery.get(pending.cls) !== pending) {
      return;
    }
    if (this.ledger.appliedThrough(pending.cls) > pending.from) {
      this.clearRecoveryAfterProgress(pending.cls);
      return;
    }
    const elapsed = this.recoveryNow() - pending.startedAt;
    if (pending.attempts >= this.recoveryMaxAttempts || elapsed >= this.recoveryDeadlineMs) {
      this.exhaustRecovery(pending);
      return;
    }
    pending.attempts++;
    if (pending.authority != null) {
      this.recordOperationCausalStage(
        pending.authority,
        "recovery-retry",
        `attempt=${pending.attempts} reason=${pending.reason}`,
      );
    }
    coopWarn(
      "durability",
      `recover cls=${pending.cls} from=${pending.from} blocked=${pending.blockedSeq} `
        + `attempt=${pending.attempts}/${this.recoveryMaxAttempts} reason=${pending.reason}`,
    );
    try {
      this.transport.send({ t: "coopResync", cls: pending.cls, from: pending.from });
    } catch (error) {
      coopWarn("durability", `recovery request send deferred cls=${pending.cls} from=${pending.from}`, error);
    }
    // A synchronous transport can deliver the requested tail before send() returns. If that replay made
    // progress, clearRecoveryAfterProgress already retired this object; never leave a stray retry timer.
    if (this.pendingRecovery.get(pending.cls) !== pending || this.ledger.appliedThrough(pending.cls) > pending.from) {
      return;
    }
    const delay = Math.min(this.recoveryInitialMs * 2 ** (pending.attempts - 1), this.recoveryMaxMs);
    pending.cancel = this.scheduleRecovery(() => this.sendRecoveryAttempt(pending), delay);
  }

  private clearRecoveryAfterProgress(cls: string): void {
    const applied = this.ledger.appliedThrough(cls);
    const pending = this.pendingRecovery.get(cls);
    if (pending != null && applied > pending.from) {
      pending.cancel();
      this.pendingRecovery.delete(cls);
    }
    const exhaustedFrom = this.exhaustedRecovery.get(cls);
    if (exhaustedFrom != null && applied > exhaustedFrom) {
      this.exhaustedRecovery.delete(cls);
    }
  }

  private exhaustRecovery(pending: PendingDurabilityRecovery): void {
    if (this.pendingRecovery.get(pending.cls) !== pending) {
      return;
    }
    pending.cancel();
    this.pendingRecovery.delete(pending.cls);
    this.exhaustedRecovery.set(pending.cls, pending.from);
    const failure: CoopDurabilityRecoveryFailure = {
      cls: pending.cls,
      from: pending.from,
      blockedSeq: pending.blockedSeq,
      attempts: pending.attempts,
      reason: pending.reason,
    };
    coopWarn(
      "durability",
      `recovery EXHAUSTED cls=${failure.cls} from=${failure.from} blocked=${failure.blockedSeq} `
        + `attempts=${failure.attempts} reason=${failure.reason}`,
    );
    if (pending.authority != null) {
      this.recordOperationCausalStage(pending.authority, "terminal", `reason=${pending.reason}`);
    }
    try {
      this.hooks.onRecoveryExhausted?.(failure);
    } catch (error) {
      coopWarn("durability", `recovery terminal hook threw cls=${failure.cls} (isolated)`, error);
    }
  }

  /** Run the apply hook, mapping a `void` return to `applied` (back-compat) and a THROW to `rejected` (retriable). */
  private safeApply(entry: CoopJournalEntry): CoopApplyOutcome {
    if (this.hooks.apply == null) {
      return "applied"; // no receiver wired: the manager's own ledger advance is the only bookkeeping.
    }
    try {
      return this.hooks.apply(entry) ?? "applied";
    } catch (e) {
      coopWarn("durability", `apply THREW cls=${entry.cls} seq=${entry.seq} (handled - retriable)`, e);
      return "rejected";
    }
  }

  /** Committer: serve a peer's reconnect request - replay the journal tail after `from`, or a full snapshot. */
  private serveResync(cls: string, from: number): void {
    if (this.journal.needsFullSnapshot(cls, from)) {
      // The gap is DEEPER than the ring can serve (§4.4): the retained tail after `from` starts past the
      // first revision the peer still needs, so replaying it would only land as a gap on the receiver.
      // Escalate to a full-state resync and do NOT send the unusable partial tail (the receiver adopts the
      // snapshot at head, fast-forwards its ledger, and needs nothing more; the DATA-plane stateSync is the
      // fallback when no snapshot hook is wired).
      const head = this.journal.highWaterMark(cls);
      coopLog("durability", `resync cls=${cls} from=${from} DEEPER than ring -> full snapshot at head=${head}`);
      this.hooks.sendFullSnapshot?.(cls, head, this.controlPlaneHighWater());
      return;
    }
    const tail = this.journal.tailFrom(cls, from);
    coopLog("durability", `resync cls=${cls} from=${from} -> replay ${tail.length} entries`);
    for (const e of tail) {
      const operation = retainedOperationAuthorityFor(e.cls, e.seq, e.msg);
      if (operation != null) {
        this.recordOperationCausalStage(operation.authority, "delivery-retry", "reason=tail-request");
      }
      this.transport.send(e.msg);
    }
  }

  /**
   * RECONNECT (§4.4), called after a #805 hot rejoin's channel swap. Symmetric + idempotent:
   *  - committer: resend the committed-but-unacked tail for every class (a message lost in the blip that
   *    was committed-but-unacked is recovered here - the piece the buffer purge dropped before W2b);
   *  - receiver: request the tail after our last-applied revision for every class we have applied, so a
   *    committed op we never saw is replayed, AND broadcast a class-agnostic `coopResyncAll` so the
   *    COMMITTER proactively replays its full unacked tail - the only path that recovers the FIRST op of
   *    a fresh class (#898: production reconnects ONLY the guest, and a never-seen class is not in the
   *    guest's ledger so it can never be named in a per-class `coopResync`; the host's unacked tail
   *    retains that op regardless). Both are no-ops when there is nothing owed.
   */
  reconnect(): void {
    // Committer side: proactively resend the unacked tail (the peer may have missed the last broadcasts).
    this.resendUnackedTail("reconnect");
    // A snapshot proof is itself retained application state. Re-publish it after channel replacement so a
    // lost ACK cannot leave the committer resending operations already subsumed by the exact snapshot.
    for (const ack of this.committedSnapshotAcks.values()) {
      this.transport.send(ack);
    }
    // Receiver side: request the tail after our last-applied revision for every class we track...
    for (const cls of this.ledger.serializeClasses()) {
      this.transport.send({ t: "coopResync", cls, from: this.ledger.appliedThrough(cls) });
    }
    // ...and a class-agnostic request so the committer replays classes we have NEVER seen (#898).
    this.transport.send({ t: "coopResyncAll" });
  }

  /**
   * Fast-forward the RECEIVER ledger to a full snapshot's head revision for a class (§4.4). The rejoin
   * full-snapshot pull adopts the host's authoritative state INCLUDING the effects of every committed op
   * through `headRevision` (a DATA-plane fact the durability receiver ledger does not otherwise learn).
   * Without this, a subsequent journal tail replay of those already-subsumed ops would DOUBLE-APPLY them
   * (re-running the applier for state the snapshot already materialized), and the guest's next reconnect
   * would spuriously `coopResync` from a stale low mark - re-requesting ops the snapshot subsumed. This
   * marks the class applied through `headRevision` and ACKs it (so the committer's resend tail shrinks to
   * nothing). Idempotent + monotonic: a lower `headRevision` than already applied is ignored.
   */
  adoptSnapshot(cls: string, headRevision: number): void {
    this.clearDeferred(cls);
    this.deferredFollowers.delete(cls);
    this.ledger.adoptSnapshot(cls, headRevision);
    this.clearRecoveryAfterProgress(cls);
    this.transport.send({ t: "coopAck", cls, seq: this.ledger.appliedThrough(cls) });
  }

  /**
   * Committer: resend the committed-but-unacked tail for EVERY class (§4.2/§4.4). Idempotent (receiver
   * dedupes). OVERFLOW ESCALATION (§4.3/§4.4): if the bounded ring has EVICTED the ops the receiver is
   * missing (its acked position is deeper than the ring can serve), the retained tail is UNUSABLE (it would
   * land as a gap on the receiver), so escalate to a full-state resync instead of resending it - the exact
   * "peer gone long enough that unacked ops are evicted" case.
   */
  private resendUnackedTail(reason: string): void {
    for (const cls of this.journal.classes()) {
      const acked = this.journal.ackedThrough(cls);
      if (this.journal.needsFullSnapshot(cls, acked)) {
        const head = this.journal.highWaterMark(cls);
        coopWarn(
          "durability",
          `${reason} cls=${cls} OVERFLOW: ring evicted ops the peer needs (acked=${acked} deeper than ring) -> full snapshot at head=${head}`,
        );
        this.hooks.sendFullSnapshot?.(cls, head, this.controlPlaneHighWater());
        continue; // the retained tail is unusable (a gap at the evicted ops); the snapshot heals it
      }
      const tail = this.journal.resendTail(cls);
      if (tail.length > 0) {
        coopLog("durability", `${reason} resend cls=${cls} unacked=${tail.length}`);
        for (const e of tail) {
          const operation = retainedOperationAuthorityFor(e.cls, e.seq, e.msg);
          if (operation != null) {
            this.recordOperationCausalStage(operation.authority, "delivery-retry", `reason=${reason}`);
          }
          this.transport.send(e.msg);
        }
      }
    }
  }

  /** Journal depth (retained committed entries) - surfaced in the health line + control-plane block. */
  journalDepth(): number {
    return this.journal.depth();
  }

  /** Committed-but-unacked count - surfaced in the health line + control-plane block. */
  unackedCount(): number {
    return this.journal.unackedCount();
  }

  /** The committer's per-class high-water marks (for session-save persistence, §4). */
  highWaterMarks(): Record<string, number> {
    return this.journal.serializeHighWater();
  }

  /**
   * The per-class control-plane high-water for the SESSION-SAVE DIGEST (§4.6): the max of the COMMITTER's
   * journal high-water AND the RECEIVER's applied-through marks. A live session has exactly one committer
   * (the host) and one receiver (the guest) per class, so the committer holds the value in its journal while
   * the receiver holds the SAME converged value in its ledger. Taking the union makes both peers serialize
   * the IDENTICAL value once caught up - the parity the saveDataDigest requires (a plain `highWaterMarks()`
   * is populated only on the committer, so the digest would diverge the moment the host commits its first op).
   */
  controlPlaneHighWater(): Record<string, number> {
    const out: Record<string, number> = { ...this.journal.serializeHighWater() };
    for (const [cls, seq] of Object.entries(this.ledger.serialize())) {
      if (!(cls in out) || seq > out[cls]) {
        out[cls] = seq;
      }
    }
    return out;
  }

  /** The receiver's per-class applied marks (for session-save persistence, §4). */
  appliedMarks(): Record<string, number> {
    return this.ledger.serialize();
  }

  /** Exact local rollback; intentionally emits no ACK for an uncommitted snapshot. */
  restoreAppliedMarksForTransaction(marks: Record<string, number>): void {
    this.ledger.restoreExactForTransaction(marks);
  }

  /** Stage snapshot high-water locally without emitting an ACK until the whole control transaction commits. */
  adoptSnapshotMarksForTransaction(marks: Record<string, number>): void {
    for (const [cls, revision] of Object.entries(marks)) {
      if (Number.isSafeInteger(revision) && revision > 0) {
        this.ledger.adoptSnapshot(cls, revision);
      }
    }
  }

  /** Publish one exact bound proof only after DATA+CONTROL+executable-surface commit. */
  ackSnapshotMarksAfterTransaction(marks: Record<string, number>, controlDigest: string): boolean {
    const normalized = normalizeSnapshotMarks(marks);
    if (
      typeof controlDigest !== "string"
      || controlDigest.length === 0
      || controlDigest.length > 256
      || normalized == null
    ) {
      coopWarn("durability", "refused invalid post-transaction snapshot ACK");
      return false;
    }
    for (const [cls, revision] of Object.entries(normalized)) {
      if (revision > 0) {
        this.clearRecoveryAfterProgress(cls);
      }
    }
    const ack = { t: "coopSnapshotAck", controlDigest, marks: normalized } as const;
    const prior = this.committedSnapshotAcks.get(controlDigest);
    if (prior != null && snapshotMarksCanonical(prior.marks) !== snapshotMarksCanonical(normalized)) {
      coopWarn("durability", `refused conflicting local snapshot ACK control=${controlDigest}`);
      return false;
    }
    this.committedSnapshotAcks.set(controlDigest, ack);
    // The committed snapshot proof now owns recovery through these exact frontiers. Retaining an older
    // incomplete WAVE receipt would leak memory and could answer a stale replay after the snapshot superseded it.
    this.discardRetainedWaveAcksThrough(normalized);
    while (this.committedSnapshotAcks.size > SNAPSHOT_FRONTIER_RETENTION) {
      const oldest = this.committedSnapshotAcks.keys().next().value as string | undefined;
      if (oldest == null) {
        break;
      }
      this.committedSnapshotAcks.delete(oldest);
    }
    try {
      this.transport.send(ack);
    } catch (error) {
      // The committed proof remains in `committedSnapshotAcks`; reconnect republishes it verbatim.
      coopWarn("durability", `snapshot ACK retained for reconnect control=${controlDigest}`, error);
    }
    return true;
  }

  /** Restore persisted high-water + applied marks on a cold resume (§4), so revisions continue monotonically. */
  restore(highWater: Record<string, number>, applied: Record<string, number>): void {
    for (const pending of this.pendingDeferred.values()) {
      pending.cancel();
    }
    this.pendingDeferred.clear();
    this.deferredFollowers.clear();
    for (const pending of this.operationDeliveryRetries.values()) {
      pending.cancel();
    }
    this.operationDeliveryRetries.clear();
    this.pendingCumulativeAcks.clear();
    this.clearRetainedWaveAcks();
    this.retainedSnapshotFrontiers.clear();
    this.committedSnapshotAcks.clear();
    this.tracedOperationStages.clear();
    this.journal.restoreHighWater(highWater);
    // Restore the committer's peer-ACK view too: a converged save has the peer applied through the high-water,
    // so without this the committer's acked=0 makes a post-resume reconnect resync spuriously escalate to a
    // full snapshot (the deep-gap check reads the first un-ACKed op's revision as far past acked+1).
    this.journal.restoreAcked(highWater);
    this.ledger.restore(applied);
  }

  /** Tear down the wire handler. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const pending of this.pendingRecovery.values()) {
      pending.cancel();
    }
    this.pendingRecovery.clear();
    for (const pending of this.pendingDeferred.values()) {
      pending.cancel();
    }
    this.pendingDeferred.clear();
    this.deferredFollowers.clear();
    for (const deadline of this.operationContinuationTimers.values()) {
      deadline.cancel();
    }
    this.operationContinuationTimers.clear();
    for (const pending of this.operationDeliveryRetries.values()) {
      pending.cancel();
    }
    this.operationDeliveryRetries.clear();
    this.pendingOperationContinuations.clear();
    this.clearRetainedWaveAcks();
    for (const [key] of this.pendingHostOperationContinuations) {
      this.settleOperationMaterialWaiters(key, false);
    }
    this.pendingHostOperationContinuations.clear();
    this.pendingCumulativeAcks.clear();
    this.retainedSnapshotFrontiers.clear();
    this.committedSnapshotAcks.clear();
    this.tracedOperationStages.clear();
    this.off();
  }
}
