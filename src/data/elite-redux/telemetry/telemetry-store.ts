/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TELEMETRY DURABLE STORE (#player-telemetry). The LOCAL SOURCE OF TRUTH for captured events.
//
// The coordinator's durability model: events append to a durable local queue in REAL TIME, uploads are
// RARE (session end / every ~10 waves / ~15 min / a size threshold), and any events left unflushed by a
// crashed tab or a failed final beacon are RECOVERED + uploaded on the next visit. Delivery is therefore
// AT-LEAST-ONCE with guaranteed next-session recovery and bounded local retention (oldest-first eviction).
//
// This module is the storage seam only: a small {@link TelemetryStore} interface with two impls -
//  - {@link IdbTelemetryStore}: IndexedDB (the production durable store; survives tab close / crash).
//    IndexedDB is chosen over localStorage on purpose: the save system already strains localStorage, and
//    telemetry must not compete with save data for that quota.
//  - {@link MemoryTelemetryStore}: an in-memory impl for unit tests AND a graceful fallback when IndexedDB
//    is unavailable (private-mode / blocked). The fallback loses cross-session durability but keeps the
//    live session working - telemetry degrades, gameplay never does.
//
// The interface is intentionally engine-free + Promise-based so the queue logic unit-tests against the
// memory impl with no browser APIs.
// =============================================================================

import type {
  TelemetryEvent,
  TelemetryMode,
  TelemetrySessionEnvelope,
} from "#data/elite-redux/telemetry/telemetry-schema";

/** One durably-stored event, tagged for batching + eviction. `key` is assigned by the store. */
export interface StoredRecord {
  /** Autoincrement key (assigned on write; present on reads). */
  key?: number;
  sessionId: string;
  mode: TelemetryMode;
  wave: number;
  /** Epoch ms at capture. */
  t: number;
  /** Approx serialized size (bytes) for the eviction/size-threshold accounting. */
  bytes: number;
  event: TelemetryEvent;
}

/** The durable-queue storage contract (both impls satisfy it). */
export interface TelemetryStore {
  /** Append records (a debounced batch of freshly-captured events). */
  append(records: StoredRecord[]): Promise<void>;
  /** Distinct session ids with pending records (for next-session recovery). */
  listSessions(): Promise<string[]>;
  /** Oldest-first pending records for a session, up to `limit`. */
  readSession(sessionId: string, limit: number): Promise<StoredRecord[]>;
  /** Delete records by key (after a successful upload). */
  remove(keys: number[]): Promise<void>;
  /** Total pending bytes (for the size-threshold flush + the eviction cap). */
  totalBytes(): Promise<number>;
  /** Evict oldest records until total bytes <= `targetBytes` (the ~20MB local-retention cap). */
  evictOldestBytes(targetBytes: number): Promise<void>;
  /** Next monotonic batch sequence (persistent, so recovery batches never collide with a new session's). */
  nextSeq(): Promise<number>;
  /** Persist a session's envelope so a later recovery pass ships the ORIGINAL run context (seed/difficulty). */
  saveEnvelope(envelope: TelemetrySessionEnvelope): Promise<void>;
  /** Read a stored session envelope (for recovery), or null if absent. */
  getEnvelope(sessionId: string): Promise<TelemetrySessionEnvelope | null>;
}

// ---------------------------------------------------------------------------
// In-memory impl (tests + fallback).
// ---------------------------------------------------------------------------

export class MemoryTelemetryStore implements TelemetryStore {
  private records: StoredRecord[] = [];
  private envelopes = new Map<string, TelemetrySessionEnvelope>();
  private nextKey = 1;
  private seq = 0;

  append(records: StoredRecord[]): Promise<void> {
    for (const r of records) {
      this.records.push({ ...r, key: this.nextKey++ });
    }
    return Promise.resolve();
  }

  listSessions(): Promise<string[]> {
    return Promise.resolve([...new Set(this.records.map(r => r.sessionId))]);
  }

  readSession(sessionId: string, limit: number): Promise<StoredRecord[]> {
    return Promise.resolve(this.records.filter(r => r.sessionId === sessionId).slice(0, limit));
  }

  remove(keys: number[]): Promise<void> {
    const drop = new Set(keys);
    this.records = this.records.filter(r => r.key == null || !drop.has(r.key));
    return Promise.resolve();
  }

  totalBytes(): Promise<number> {
    return Promise.resolve(this.records.reduce((sum, r) => sum + r.bytes, 0));
  }

  evictOldestBytes(targetBytes: number): Promise<void> {
    let total = this.records.reduce((sum, r) => sum + r.bytes, 0);
    while (total > targetBytes && this.records.length > 0) {
      const dropped = this.records.shift();
      total -= dropped?.bytes ?? 0;
    }
    return Promise.resolve();
  }

  nextSeq(): Promise<number> {
    return Promise.resolve(this.seq++);
  }

  saveEnvelope(envelope: TelemetrySessionEnvelope): Promise<void> {
    this.envelopes.set(envelope.sessionId, envelope);
    return Promise.resolve();
  }

  getEnvelope(sessionId: string): Promise<TelemetrySessionEnvelope | null> {
    return Promise.resolve(this.envelopes.get(sessionId) ?? null);
  }
}

// ---------------------------------------------------------------------------
// IndexedDB impl (production durable store).
// ---------------------------------------------------------------------------

const IDB_NAME = "er-telemetry";
const IDB_VERSION = 1;
const STORE_EVENTS = "events";
const STORE_META = "meta";
const STORE_ENVELOPES = "envelopes";
const META_SEQ_KEY = "nextSeq";

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * The production IndexedDB-backed store. Constructed via {@link openIdbTelemetryStore}, which returns null
 * when IndexedDB is unavailable so the caller can fall back to {@link MemoryTelemetryStore}.
 */
export class IdbTelemetryStore implements TelemetryStore {
  constructor(private readonly db: IDBDatabase) {}

  private tx(mode: IDBTransactionMode, stores: string[]): IDBTransaction {
    return this.db.transaction(stores, mode);
  }

  async append(records: StoredRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const tx = this.tx("readwrite", [STORE_EVENTS]);
    const store = tx.objectStore(STORE_EVENTS);
    for (const r of records) {
      // Strip any pre-set key so autoIncrement assigns a fresh monotonic one.
      const { key: _key, ...rest } = r;
      store.add(rest);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async listSessions(): Promise<string[]> {
    const store = this.tx("readonly", [STORE_EVENTS]).objectStore(STORE_EVENTS);
    const all = await promisify(store.getAll());
    return [...new Set((all as StoredRecord[]).map(r => r.sessionId))];
  }

  async readSession(sessionId: string, limit: number): Promise<StoredRecord[]> {
    const store = this.tx("readonly", [STORE_EVENTS]).objectStore(STORE_EVENTS);
    const out: StoredRecord[] = [];
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || out.length >= limit) {
          resolve();
          return;
        }
        const rec = cursor.value as StoredRecord;
        if (rec.sessionId === sessionId) {
          out.push({ ...rec, key: cursor.primaryKey as number });
        }
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
    return out;
  }

  async remove(keys: number[]): Promise<void> {
    if (keys.length === 0) {
      return;
    }
    const tx = this.tx("readwrite", [STORE_EVENTS]);
    const store = tx.objectStore(STORE_EVENTS);
    for (const k of keys) {
      store.delete(k);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async totalBytes(): Promise<number> {
    const store = this.tx("readonly", [STORE_EVENTS]).objectStore(STORE_EVENTS);
    const all = (await promisify(store.getAll())) as StoredRecord[];
    return all.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
  }

  async evictOldestBytes(targetBytes: number): Promise<void> {
    const store = this.tx("readonly", [STORE_EVENTS]).objectStore(STORE_EVENTS);
    const all = (await promisify(store.getAll())) as StoredRecord[];
    const keysReq = this.tx("readonly", [STORE_EVENTS]).objectStore(STORE_EVENTS).getAllKeys();
    const keys = (await promisify(keysReq)) as number[];
    let total = all.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
    const toDrop: number[] = [];
    for (let i = 0; i < all.length && total > targetBytes; i++) {
      total -= all[i].bytes ?? 0;
      toDrop.push(keys[i]);
    }
    await this.remove(toDrop);
  }

  async nextSeq(): Promise<number> {
    const tx = this.tx("readwrite", [STORE_META]);
    const store = tx.objectStore(STORE_META);
    const current = ((await promisify(store.get(META_SEQ_KEY))) as number | undefined) ?? 0;
    store.put(current + 1, META_SEQ_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return current;
  }

  async saveEnvelope(envelope: TelemetrySessionEnvelope): Promise<void> {
    const tx = this.tx("readwrite", [STORE_ENVELOPES]);
    tx.objectStore(STORE_ENVELOPES).put(envelope, envelope.sessionId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getEnvelope(sessionId: string): Promise<TelemetrySessionEnvelope | null> {
    const store = this.tx("readonly", [STORE_ENVELOPES]).objectStore(STORE_ENVELOPES);
    return ((await promisify(store.get(sessionId))) as TelemetrySessionEnvelope | undefined) ?? null;
  }
}

/**
 * Open the IndexedDB telemetry store, or resolve null when IndexedDB is unavailable / blocked (so the
 * caller falls back to {@link MemoryTelemetryStore}). Never throws.
 */
export function openIdbTelemetryStore(): Promise<TelemetryStore | null> {
  return new Promise<TelemetryStore | null>(resolve => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_EVENTS)) {
          db.createObjectStore(STORE_EVENTS, { keyPath: "key", autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }
        if (!db.objectStoreNames.contains(STORE_ENVELOPES)) {
          db.createObjectStore(STORE_ENVELOPES);
        }
      };
      req.onsuccess = () => resolve(new IdbTelemetryStore(req.result));
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
