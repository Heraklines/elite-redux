import type { SaveLeaseV1 } from "./contracts";

const DATABASE = "er-m9-save-leases-v1";
const STORE = "leases";
const CHANNEL = "er-m9-save-leases-v1";
const MAXIMUM_LEASE_MS = 30_000;

export class ProductionSaveLeaseManagerV1 {
  readonly #database: Promise<IDBDatabase>;
  readonly #channel: BroadcastChannel;

  constructor(factory: IDBFactory = indexedDB, channel = new BroadcastChannel(CHANNEL)) {
    this.#database = open(factory);
    this.#channel = channel;
  }

  async acquire(
    slot: string,
    holder: string,
    generation: number,
    now = Date.now(),
    durationMs = 10_000,
  ): Promise<SaveLeaseV1> {
    validateRequest(slot, holder, generation, now, durationMs);
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const existing = await request<SaveLeaseV1 | undefined>(store.get(slot));
    if (existing != null && existing.expires_at > now && existing.holder !== holder) {
      transaction.abort();
      throw new Error("production save lease is held by another browser instance");
    }
    const lease: SaveLeaseV1 = {
      schema_version: 1,
      slot,
      holder,
      generation,
      expires_at: now + durationMs,
    };
    store.put(lease, slot);
    await complete(transaction);
    this.#channel.postMessage({ kind: "LEASE_ACQUIRED", slot, holder, generation, expires_at: lease.expires_at });
    return lease;
  }

  async renew(lease: SaveLeaseV1, now = Date.now(), durationMs = 10_000): Promise<SaveLeaseV1> {
    validateRequest(lease.slot, lease.holder, lease.generation, now, durationMs);
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const current = await request<SaveLeaseV1 | undefined>(store.get(lease.slot));
    if (
      current == null
      || current.holder !== lease.holder
      || current.generation !== lease.generation
      || current.expires_at !== lease.expires_at
      || current.expires_at <= now
    ) {
      transaction.abort();
      throw new Error("production save lease renewal lost compare-and-swap");
    }
    const renewed = { ...current, expires_at: now + durationMs };
    store.put(renewed, lease.slot);
    await complete(transaction);
    this.#channel.postMessage({ kind: "LEASE_RENEWED", ...renewed });
    return renewed;
  }

  async release(lease: SaveLeaseV1): Promise<void> {
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const current = await request<SaveLeaseV1 | undefined>(store.get(lease.slot));
    if (
      current == null
      || current.holder !== lease.holder
      || current.generation !== lease.generation
      || current.expires_at !== lease.expires_at
    ) {
      transaction.abort();
      throw new Error("production save lease release lost compare-and-swap");
    }
    store.delete(lease.slot);
    await complete(transaction);
    this.#channel.postMessage({ kind: "LEASE_RELEASED", slot: lease.slot, holder: lease.holder });
  }

  dispose(): void {
    this.#channel.close();
  }
}

function validateRequest(slot: string, holder: string, generation: number, now: number, durationMs: number): void {
  if (
    !/^[a-zA-Z0-9._:-]{1,128}$/u.test(slot)
    || !/^[a-zA-Z0-9._:-]{1,128}$/u.test(holder)
    || !Number.isSafeInteger(generation)
    || generation < 0
    || !Number.isSafeInteger(now)
    || now < 0
    || !Number.isSafeInteger(durationMs)
    || durationMs < 1
    || durationMs > MAXIMUM_LEASE_MS
  ) {
    throw new Error("production save lease request is invalid");
  }
}

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE)) {
        opening.result.createObjectStore(STORE);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("save lease database failed"));
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("save lease request failed"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("save lease transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("save lease transaction failed"));
  });
}
