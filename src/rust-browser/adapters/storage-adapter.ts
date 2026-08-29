const STORE = "opaque-kernel-values";
const DATABASE_VERSION = 1;
const MAXIMUM_VALUE_BYTES = 4_194_304;

interface StoredOpaqueValueV1 {
  key: string;
  executionIdentity: string;
  contentIdentity: string;
  revision: number;
  bytes: ArrayBuffer;
}

export type BrowserStorageErrorCodeV1 =
  | "DISPOSED"
  | "STALE_GENERATION"
  | "IDENTITY_MISMATCH"
  | "CONFLICT"
  | "QUOTA"
  | "CORRUPT"
  | "UNAVAILABLE"
  | "OVERSIZED";

export class BrowserStorageErrorV1 extends Error {
  constructor(
    readonly code: BrowserStorageErrorCodeV1,
    message: string,
  ) {
    super(message);
    this.name = "BrowserStorageErrorV1";
  }
}

export interface OpaqueStorageValueV1 {
  revision: number;
  bytes: Uint8Array;
}

export interface BrowserStorageAdapterOptions {
  databaseName: string;
  executionIdentity: string;
  contentIdentity: string;
  indexedDB?: IDBFactory;
}

export class BrowserStorageAdapter {
  readonly #factory: IDBFactory;
  readonly #databaseName: string;
  readonly #executionIdentity: string;
  readonly #contentIdentity: string;
  #database: Promise<IDBDatabase> | null = null;
  #generation = 1;
  #disposed = false;

  constructor(options: BrowserStorageAdapterOptions) {
    this.#factory = options.indexedDB ?? indexedDB;
    this.#databaseName = options.databaseName;
    this.#executionIdentity = options.executionIdentity;
    this.#contentIdentity = options.contentIdentity;
  }

  async read(key: string): Promise<OpaqueStorageValueV1 | null> {
    const generation = this.#captureGeneration();
    const record = await this.#request<StoredOpaqueValueV1 | undefined>("readonly", store => store.get(key));
    this.#assertGeneration(generation);
    if (record == null) {
      return null;
    }
    this.#validateRecord(record, key);
    return { revision: record.revision, bytes: new Uint8Array(record.bytes.slice(0)) };
  }

  async compareAndSwap(key: string, expectedRevision: number | null, bytes: Uint8Array): Promise<number> {
    this.#validateBytes(bytes);
    const generation = this.#captureGeneration();
    const database = await this.#open();
    this.#assertGeneration(generation);
    return new Promise<number>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      let nextRevision: number | null = null;
      const read = store.get(key);
      read.onerror = () => reject(this.#mapError(read.error));
      read.onsuccess = () => {
        try {
          const current = read.result as StoredOpaqueValueV1 | undefined;
          if (current != null) {
            this.#validateRecord(current, key);
          }
          const actualRevision = current?.revision ?? null;
          if (actualRevision !== expectedRevision) {
            transaction.abort();
            reject(new BrowserStorageErrorV1("CONFLICT", "opaque storage revision conflict"));
            return;
          }
          nextRevision = (actualRevision ?? 0) + 1;
          if (!Number.isSafeInteger(nextRevision)) {
            throw new BrowserStorageErrorV1("CORRUPT", "opaque storage revision overflow");
          }
          store.put({
            key,
            executionIdentity: this.#executionIdentity,
            contentIdentity: this.#contentIdentity,
            revision: nextRevision,
            bytes: bytes.slice().buffer,
          } satisfies StoredOpaqueValueV1);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.onerror = () => reject(this.#mapError(transaction.error));
      transaction.onabort = () => {
        if (transaction.error != null) {
          reject(this.#mapError(transaction.error));
        }
      };
      transaction.oncomplete = () => {
        try {
          this.#assertGeneration(generation);
          if (nextRevision == null) {
            throw new BrowserStorageErrorV1("CORRUPT", "opaque storage transaction completed without a revision");
          }
          resolve(nextRevision);
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  async delete(key: string, expectedRevision: number): Promise<void> {
    const generation = this.#captureGeneration();
    const database = await this.#open();
    this.#assertGeneration(generation);
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const read = store.get(key);
      read.onerror = () => reject(this.#mapError(read.error));
      read.onsuccess = () => {
        try {
          const current = read.result as StoredOpaqueValueV1 | undefined;
          if (current == null || current.revision !== expectedRevision) {
            transaction.abort();
            reject(new BrowserStorageErrorV1("CONFLICT", "opaque storage delete revision conflict"));
            return;
          }
          this.#validateRecord(current, key);
          store.delete(key);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
      transaction.onerror = () => reject(this.#mapError(transaction.error));
      transaction.oncomplete = () => {
        try {
          this.#assertGeneration(generation);
          resolve();
        } catch (error) {
          reject(error);
        }
      };
    });
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#generation += 1;
    const database = this.#database;
    this.#database = null;
    if (database != null) {
      (await database).close();
    }
  }

  #captureGeneration(): number {
    if (this.#disposed) {
      throw new BrowserStorageErrorV1("DISPOSED", "opaque storage adapter is disposed");
    }
    return this.#generation;
  }

  #assertGeneration(generation: number): void {
    if (this.#disposed) {
      throw new BrowserStorageErrorV1("DISPOSED", "opaque storage adapter is disposed");
    }
    if (generation !== this.#generation) {
      throw new BrowserStorageErrorV1("STALE_GENERATION", "opaque storage operation belongs to a stale generation");
    }
  }

  async #open(): Promise<IDBDatabase> {
    this.#captureGeneration();
    if (this.#database != null) {
      return this.#database;
    }
    this.#database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onerror = () => reject(this.#mapError(request.error));
      request.onblocked = () => reject(new BrowserStorageErrorV1("UNAVAILABLE", "IndexedDB upgrade is blocked"));
      request.onsuccess = () => resolve(request.result);
    });
    return this.#database;
  }

  async #request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const generation = this.#captureGeneration();
    const database = await this.#open();
    this.#assertGeneration(generation);
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      request.onerror = () => reject(this.#mapError(request.error));
      request.onsuccess = () => {
        try {
          this.#assertGeneration(generation);
          resolve(request.result);
        } catch (error) {
          reject(error);
        }
      };
      transaction.onerror = () => reject(this.#mapError(transaction.error));
    });
  }

  #validateBytes(bytes: Uint8Array): void {
    if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_VALUE_BYTES) {
      throw new BrowserStorageErrorV1("OVERSIZED", "opaque storage value is empty or oversized");
    }
  }

  #validateRecord(record: StoredOpaqueValueV1, key: string): void {
    if (
      record.key !== key
      || record.executionIdentity !== this.#executionIdentity
      || record.contentIdentity !== this.#contentIdentity
    ) {
      throw new BrowserStorageErrorV1("IDENTITY_MISMATCH", "opaque storage identity does not match this execution");
    }
    if (!Number.isSafeInteger(record.revision) || record.revision <= 0 || !(record.bytes instanceof ArrayBuffer)) {
      throw new BrowserStorageErrorV1("CORRUPT", "opaque storage record is malformed");
    }
    this.#validateBytes(new Uint8Array(record.bytes));
  }

  #mapError(error: DOMException | null): BrowserStorageErrorV1 {
    if (error?.name === "QuotaExceededError") {
      return new BrowserStorageErrorV1("QUOTA", error.message);
    }
    return new BrowserStorageErrorV1("UNAVAILABLE", error?.message ?? "IndexedDB request failed");
  }
}
