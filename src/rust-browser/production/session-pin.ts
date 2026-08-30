import { validateBrowserGenerationIdentityV1 } from "../hot-reload/contracts";
import type { SessionRuntimePinV1 } from "./contracts";

const DATABASE = "er-m9-session-pins-v1";
const STORE = "pins";
const MAXIMUM_ACTIVE_PINS = 64;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,128}$/u;

export interface SessionRuntimePinStoreV1 {
  load(sessionId: string): Promise<SessionRuntimePinV1 | null>;
  establish(pin: SessionRuntimePinV1): Promise<void>;
  advance(sessionId: string, expectedSequence: number, nextSequence: number): Promise<SessionRuntimePinV1>;
  remove(sessionId: string): Promise<void>;
}

export class IndexedDbSessionRuntimePinStoreV1 implements SessionRuntimePinStoreV1 {
  readonly #database: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.#database = openDatabase(factory);
  }

  async load(sessionId: string): Promise<SessionRuntimePinV1 | null> {
    validateIdentifier(sessionId);
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readonly");
    const value = await request<SessionRuntimePinV1 | undefined>(transaction.objectStore(STORE).get(sessionId));
    await complete(transaction);
    return value == null ? null : validateSessionRuntimePinV1(value);
  }

  async establish(pin: SessionRuntimePinV1): Promise<void> {
    validateSessionRuntimePinV1(pin);
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const existing = await request<SessionRuntimePinV1 | undefined>(store.get(pin.session_id));
    if (existing != null && JSON.stringify(existing) !== JSON.stringify(pin)) {
      transaction.abort();
      throw new Error("session already has a different immutable runtime pin");
    }
    if (existing == null) {
      const count = await request<number>(store.count());
      if (count >= MAXIMUM_ACTIVE_PINS) {
        transaction.abort();
        throw new Error("active production session pin bound exceeded");
      }
      store.add(structuredClone(pin), pin.session_id);
    }
    await complete(transaction);
  }

  async advance(sessionId: string, expectedSequence: number, nextSequence: number): Promise<SessionRuntimePinV1> {
    validateIdentifier(sessionId);
    if (!safeInteger(expectedSequence) || !safeInteger(nextSequence) || nextSequence < expectedSequence) {
      throw new Error("session pin sequence update is invalid");
    }
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    const current = await request<SessionRuntimePinV1 | undefined>(store.get(sessionId));
    if (current == null || current.latest_sequence !== expectedSequence) {
      transaction.abort();
      throw new Error("session pin sequence compare-and-swap conflict");
    }
    const next = validateSessionRuntimePinV1({ ...current, latest_sequence: nextSequence });
    store.put(structuredClone(next), sessionId);
    await complete(transaction);
    return next;
  }

  async remove(sessionId: string): Promise<void> {
    validateIdentifier(sessionId);
    const database = await this.#database;
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(sessionId);
    await complete(transaction);
  }
}

export function validateSessionRuntimePinV1(pin: SessionRuntimePinV1): SessionRuntimePinV1 {
  validateIdentifier(pin.session_id);
  validateIdentifier(pin.release_id);
  if (pin.run_id != null) {
    validateIdentifier(pin.run_id);
  }
  validateBrowserGenerationIdentityV1(pin.kernel_generation);
  if (
    pin.schema_version !== 1
    || pin.kernel_generation.session_id !== pin.session_id
    || pin.kernel_generation.release_id !== pin.release_id
    || !safeInteger(pin.created_sequence)
    || !safeInteger(pin.latest_sequence)
    || pin.latest_sequence < pin.created_sequence
    || pin.mechanical_identity.authority_protocol !== "er-coop-47"
  ) {
    throw new Error("production session runtime pin is invalid");
  }
  return pin;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = factory.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains(STORE)) {
        opening.result.createObjectStore(STORE);
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("session pin database open failed"));
  });
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("session pin request failed"));
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("session pin transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("session pin transaction failed"));
  });
}

function validateIdentifier(value: string): void {
  if (!IDENTIFIER.test(value)) {
    throw new Error("session pin identifier is invalid");
  }
}

function safeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
