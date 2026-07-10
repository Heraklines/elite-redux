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

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";
import type { CoopMessage, CoopTransport } from "#data/elite-redux/coop/coop-transport";

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
}

// -----------------------------------------------------------------------------
// CoopDurabilityManager (§4.2/§4.4): the ACK / resend / reconnect protocol engine
// -----------------------------------------------------------------------------

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
  /** Apply an in-order committed op to shared state (the receiver's ONE mutation site). */
  apply?: (entry: CoopJournalEntry) => void;
  /**
   * Serve a FULL SNAPSHOT at head for a class when a reconnect gap is deeper than the ring (§4.4). Optional;
   * when absent the manager replays whatever the ring holds (the existing per-surface snapshot heal covers
   * the deep gap in that case, so this is not required for correctness of the shallow-gap path).
   */
  sendFullSnapshot?: (cls: string, headRevision: number) => void;
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

  constructor(
    private readonly transport: CoopTransport,
    private readonly hooks: CoopDurabilityHooks = {},
    journalCapacity = 256,
  ) {
    this.journal = new CoopJournal(journalCapacity);
    this.off = transport.onMessage(msg => this.onMessage(msg));
  }

  /**
   * COMMIT a durable op (committer side): journal it (so it can be resent/replayed) then broadcast it. The
   * broadcast rides the transport's outbound queue, so a send while the channel is dark is not lost (§4.3).
   * `seq` MUST be monotonic per class (the envelope's `revision`).
   */
  commit(cls: string, seq: number, msg: CoopMessage): void {
    this.journal.commit(cls, seq, msg);
    this.transport.send(msg);
  }

  /** Handle an inbound wire message: the ACK/reconnect arms, plus (if wired) the durable op stream. */
  private onMessage(msg: CoopMessage): void {
    if (msg.t === "coopAck") {
      this.journal.ack(msg.cls, msg.seq);
      return;
    }
    if (msg.t === "coopResync") {
      this.serveResync(msg.cls, msg.from);
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
    if (this.ledger.isDuplicate(cls, seq)) {
      // Already applied (a safe resend, §4.2): re-ACK so the committer stops resending, do NOT re-apply.
      this.transport.send({ t: "coopAck", cls, seq: this.ledger.appliedThrough(cls) });
      return;
    }
    if (this.ledger.hasGap(cls, seq)) {
      // A revision was missed: do NOT apply out of order - request the tail after our last-applied (§4.4).
      coopWarn("durability", `gap cls=${cls} got=${seq} have=${this.ledger.appliedThrough(cls)} -> request tail`);
      this.transport.send({ t: "coopResync", cls, from: this.ledger.appliedThrough(cls) });
      return;
    }
    // In order: apply, advance, ACK cumulatively.
    this.hooks.apply?.({ cls, seq, msg });
    this.ledger.markApplied(cls, seq);
    this.transport.send({ t: "coopAck", cls, seq });
  }

  /** Committer: serve a peer's reconnect request - replay the journal tail after `from`, or a full snapshot. */
  private serveResync(cls: string, from: number): void {
    if (this.journal.needsFullSnapshot(cls, from)) {
      const head = this.journal.highWaterMark(cls);
      coopLog("durability", `resync cls=${cls} from=${from} DEEPER than ring -> full snapshot at head=${head}`);
      this.hooks.sendFullSnapshot?.(cls, head);
      // Still replay whatever the ring holds after the snapshot's head is caught up elsewhere; if no snapshot
      // hook is wired, the ring replay below is the best-effort heal (the per-surface snapshot covers the rest).
    }
    const tail = this.journal.tailFrom(cls, from);
    coopLog("durability", `resync cls=${cls} from=${from} -> replay ${tail.length} entries`);
    for (const e of tail) {
      this.transport.send(e.msg);
    }
  }

  /**
   * RECONNECT (§4.4), called after a #805 hot rejoin's channel swap. Symmetric + idempotent:
   *  - committer: resend the committed-but-unacked tail for every class (a message lost in the blip that
   *    was committed-but-unacked is recovered here - the piece the buffer purge dropped before W2b);
   *  - receiver: request the tail after our last-applied revision for every class we have applied, so a
   *    committed op we never saw is replayed. Both are no-ops when there is nothing owed.
   */
  reconnect(): void {
    // Committer side: proactively resend the unacked tail (the peer may have missed the last broadcasts).
    for (const cls of this.journal.classes()) {
      const tail = this.journal.resendTail(cls);
      if (tail.length > 0) {
        coopLog("durability", `reconnect resend cls=${cls} unacked=${tail.length}`);
        for (const e of tail) {
          this.transport.send(e.msg);
        }
      }
    }
    // Receiver side: request the tail after our last-applied revision for every class we track.
    for (const cls of this.ledger.serializeClasses()) {
      this.transport.send({ t: "coopResync", cls, from: this.ledger.appliedThrough(cls) });
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

  /** The receiver's per-class applied marks (for session-save persistence, §4). */
  appliedMarks(): Record<string, number> {
    return this.ledger.serialize();
  }

  /** Restore persisted high-water + applied marks on a cold resume (§4), so revisions continue monotonically. */
  restore(highWater: Record<string, number>, applied: Record<string, number>): void {
    this.journal.restoreHighWater(highWater);
    this.ledger.restore(applied);
  }

  /** Tear down the wire handler. */
  dispose(): void {
    this.off();
  }
}
