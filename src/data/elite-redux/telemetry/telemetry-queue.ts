/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TELEMETRY QUEUE (#player-telemetry). The durability + batching engine.
//
// DURABILITY MODEL (coordinator's spec): at-least-once delivery, best-effort final beacon, guaranteed
// next-session recovery, bounded local retention.
//  - APPEND in real time to the durable {@link TelemetryStore} (the local source of truth). Appends are
//    debounced into small store writes so we don't touch IndexedDB per event.
//  - FLUSH (upload) RARELY, only at meaningful boundaries: every ~10 waves, ~15 min, a ~256KB size
//    threshold, or session end (pagehide beacon). Target <= ~4-6 requests per player-HOUR.
//  - RECOVER on boot: any events an earlier session left unflushed (crashed tab / failed beacon) are
//    uploaded as recovery batches. R2's {date}/{mode}/{sessionId}/{seq} keying tolerates late old-session
//    batches, and a monotonic `seq` keeps them from colliding.
//  - CAP local retention (~20MB) with oldest-first eviction so a player who never reconnects can't grow
//    unbounded.
//
// The queue is engine-free: the {@link TelemetryStore} and the upload function are injected, so the whole
// batching/flush/recovery policy unit-tests with an in-memory store + a fake upload (no browser, no
// network, no game).
// =============================================================================

import type {
  TelemetryBatch,
  TelemetryEvent,
  TelemetrySessionEnvelope,
} from "#data/elite-redux/telemetry/telemetry-schema";
import type { StoredRecord, TelemetryStore } from "#data/elite-redux/telemetry/telemetry-store";

/** Upload one batch. `useBeacon` = the pagehide final send. Returns whether it was accepted. */
export type TelemetryUpload = (batch: TelemetryBatch, useBeacon: boolean) => Promise<boolean>;

/** Tunable flush thresholds. Defaults target the ~4-6 requests/player-hour budget. */
export interface TelemetryQueueConfig {
  /** Debounce durable local writes so short sessions survive before an upload boundary. */
  persistDebounceMs: number;
  /** Flush after this many waves since the last flush. */
  flushWaveInterval: number;
  /** Flush after this long since the last flush (ms). */
  flushIntervalMs: number;
  /** Flush when pending bytes reach this (compressed batches are far smaller, but this bounds a batch). */
  sizeThresholdBytes: number;
  /** Evict oldest stored events beyond this local-retention cap (bytes). */
  maxLocalBytes: number;
  /** Cap the in-memory beacon tail (bytes) so the final send stays bounded. */
  maxBeaconTailBytes: number;
  /** Max events per uploaded batch. */
  batchReadLimit: number;
  /** Max approximate uncompressed event bytes per upload; one oversized event is still sent alone. */
  maxBatchBytes: number;
}

export const DEFAULT_TELEMETRY_QUEUE_CONFIG: TelemetryQueueConfig = {
  persistDebounceMs: 1000,
  flushWaveInterval: 10,
  flushIntervalMs: 15 * 60 * 1000,
  // Contract-v4 decisions are intentionally complete and substantially larger
  // than the legacy event. A 256 KiB threshold could therefore serialize and
  // gzip a batch almost every turn in triples. Match the existing bounded batch
  // ceiling so uploads stay rare without dropping or coarsening any records.
  sizeThresholdBytes: 768 * 1024,
  maxLocalBytes: 20 * 1024 * 1024,
  maxBeaconTailBytes: 2 * 1024 * 1024,
  batchReadLimit: 5000,
  maxBatchBytes: 768 * 1024,
};

function boundedBatch(records: StoredRecord[], maxBytes: number): StoredRecord[] {
  const selected: StoredRecord[] = [];
  let bytes = 0;
  for (const record of records) {
    if (selected.length > 0 && bytes + record.bytes > maxBytes) {
      break;
    }
    selected.push(record);
    bytes += record.bytes;
  }
  return selected;
}

/** Approx serialized size of an event (UTF-16 chars ~ bytes for the ascii-heavy telemetry payload). */
function approxBytes(event: TelemetryEvent): number {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 256;
  }
}

export class TelemetryQueue {
  /** Captured but not yet appended to the store (debounced write buffer). */
  private pending: StoredRecord[] = [];
  /** In-memory tail of events not yet successfully normal-flushed - the synchronous pagehide beacon source. */
  private beaconTail: StoredRecord[] = [];
  private beaconTailBytes = 0;
  /** Bytes captured since the last successful flush (drives the size trigger without touching the store). */
  private pendingBytes = 0;
  private lastFlushAt: number;
  private lastFlushWave = 0;
  private flushPromise: Promise<void> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes IndexedDB appends so overlapping debounce/flush calls cannot race the pending buffer. */
  private persistChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly store: TelemetryStore,
    private readonly envelope: TelemetrySessionEnvelope,
    private readonly upload: TelemetryUpload,
    private readonly config: TelemetryQueueConfig = DEFAULT_TELEMETRY_QUEUE_CONFIG,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.lastFlushAt = now();
  }

  /** Append one event to the durable queue (real-time). Cheap: builds a record + buffers it. */
  enqueue(event: TelemetryEvent): void {
    const bytes = approxBytes(event);
    const record: StoredRecord = {
      sessionId: this.envelope.sessionId,
      mode: this.envelope.mode,
      wave: event.wave,
      t: event.t,
      bytes,
      event,
    };
    this.pending.push(record);
    this.pendingBytes += bytes;
    this.beaconTail.push(record);
    this.beaconTailBytes += bytes;
    // Bound the in-memory beacon tail (the events remain durably in the store for recovery).
    while (this.beaconTailBytes > this.config.maxBeaconTailBytes && this.beaconTail.length > 0) {
      const dropped = this.beaconTail.shift();
      this.beaconTailBytes -= dropped?.bytes ?? 0;
    }
    this.schedulePersist();
  }

  /** Persist the debounce buffer to the durable store + enforce the local-retention cap. */
  persist(): Promise<void> {
    if (this.persistTimer != null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    const persistPending = async () => {
      if (this.pending.length === 0) {
        return;
      }
      const batch = this.pending;
      this.pending = [];
      try {
        await this.store.append(batch);
        await this.store.evictOldestBytes(this.config.maxLocalBytes);
      } catch {
        // Store write failed (blocked IDB / quota). Re-buffer so nothing is lost mid-session.
        this.pending.unshift(...batch);
      }
    };

    const result = this.persistChain.then(persistPending, persistPending);
    this.persistChain = result.catch(() => {});
    return result;
  }

  /** Whether any flush trigger is met for `currentWave`. */
  shouldFlush(currentWave: number): boolean {
    return (
      currentWave - this.lastFlushWave >= this.config.flushWaveInterval
      || this.now() - this.lastFlushAt >= this.config.flushIntervalMs
      || this.pendingBytes >= this.config.sizeThresholdBytes
    );
  }

  /** Flush if any boundary trigger is met (call cheaply, e.g. once per wave / turn). */
  async maybeFlush(currentWave: number): Promise<void> {
    if (this.shouldFlush(currentWave)) {
      await this.flush(currentWave);
    }
  }

  /**
   * Normal flush: persist pending, upload one oldest batch of THIS session via `fetch`, and remove it from
   * the store + the beacon tail on success. Reentrancy-guarded. Never throws.
   */
  flush(currentWave: number = this.lastFlushWave): Promise<void> {
    if (this.flushPromise != null) {
      return this.flushPromise;
    }

    const active = this.flushInternal(currentWave);
    this.flushPromise = active;
    return active.finally(() => {
      if (this.flushPromise === active) {
        this.flushPromise = null;
      }
    });
  }

  /** Terminal drain: upload bounded chunks until empty, stopping immediately if an upload makes no progress. */
  async finalize(): Promise<void> {
    await this.persist();
    for (let chunk = 0; chunk < 64; chunk++) {
      const before = (await this.store.readSession(this.envelope.sessionId, 1))[0]?.key;
      if (before == null) {
        return;
      }
      await this.flush();
      const after = (await this.store.readSession(this.envelope.sessionId, 1))[0]?.key;
      if (after === before) {
        return;
      }
    }
  }

  private async flushInternal(currentWave: number): Promise<void> {
    try {
      await this.persist();
      const records = boundedBatch(
        await this.store.readSession(this.envelope.sessionId, this.config.batchReadLimit),
        this.config.maxBatchBytes,
      );
      if (records.length === 0) {
        this.lastFlushAt = this.now();
        this.lastFlushWave = currentWave;
        this.pendingBytes = 0;
        return;
      }
      const seq = await this.store.nextSeq();
      const batch: TelemetryBatch = { envelope: this.envelope, seq, events: records.map(r => r.event) };
      const ok = await this.upload(batch, false);
      if (ok) {
        const keys = records.map(r => r.key).filter((k): k is number => k != null);
        await this.store.remove(keys);
        this.dropFromBeaconTail(records);
        this.pendingBytes = 0;
      }
      this.lastFlushAt = this.now();
      this.lastFlushWave = currentWave;
    } catch {
      // swallow - a failed flush keeps events durable for the next attempt / next-session recovery
    }
  }

  /**
   * Session-end BEACON: synchronously build a batch from the in-memory beacon tail and fire it via the
   * injected upload (which uses `navigator.sendBeacon`). Best-effort - anything not delivered is recovered
   * next session from the durable store. Also fire-and-forget persists the debounce buffer.
   */
  flushBeacon(): void {
    void this.persist();
    if (this.beaconTail.length === 0) {
      return;
    }
    // A distinct seq (timestamp-based) so a beacon batch never collides with a recovery batch's key.
    const batch: TelemetryBatch = {
      envelope: this.envelope,
      seq: this.now(),
      events: this.beaconTail.map(r => r.event),
    };
    void this.upload(batch, true);
  }

  /**
   * Boot RECOVERY: upload every OTHER session's leftover events (a crashed tab / failed final beacon).
   * Uploaded via `fetch` in oldest-first batches and removed on success. Never throws.
   */
  async recover(): Promise<void> {
    try {
      const sessions = (await this.store.listSessions()).filter(s => s !== this.envelope.sessionId);
      for (const sessionId of sessions) {
        // Loop this session's records in batches until drained (or a batch fails).
        for (;;) {
          const records = boundedBatch(
            await this.store.readSession(sessionId, this.config.batchReadLimit),
            this.config.maxBatchBytes,
          );
          if (records.length === 0) {
            break;
          }
          const seq = await this.store.nextSeq();
          // Prefer the ORIGINAL session's persisted envelope (correct seed/difficulty/mode); fall back to
          // this build's envelope with the stored sessionId/mode when it was lost (older store).
          const stored = await this.store.getEnvelope(sessionId);
          const recoveryEnvelope: TelemetrySessionEnvelope = stored ?? {
            ...this.envelope,
            sessionId,
            mode: records[0].mode,
          };
          const batch: TelemetryBatch = { envelope: recoveryEnvelope, seq, events: records.map(r => r.event) };
          const ok = await this.upload(batch, false);
          if (!ok) {
            break; // leave for the next attempt
          }
          await this.store.remove(records.map(r => r.key).filter((k): k is number => k != null));
        }
      }
    } catch {
      // swallow - recovery is best-effort
    }
  }

  private dropFromBeaconTail(uploaded: readonly StoredRecord[]): void {
    const counts = new Map<string, number>();
    for (const record of uploaded) {
      const identity = JSON.stringify(record.event);
      counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
    this.beaconTail = this.beaconTail.filter(record => {
      const identity = JSON.stringify(record.event);
      const remaining = counts.get(identity) ?? 0;
      if (remaining === 0) {
        return true;
      }
      counts.set(identity, remaining - 1);
      this.beaconTailBytes -= record.bytes;
      return false;
    });
    if (this.beaconTailBytes < 0) {
      this.beaconTailBytes = 0;
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer != null) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.persist();
    }, this.config.persistDebounceMs);
  }
}
