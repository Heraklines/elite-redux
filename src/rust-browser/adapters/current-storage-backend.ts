// Opt-in current local saves. No V1 database migration or production route switch.
export const CURRENT_STORAGE_VALUE_BYTES = 4_194_304;
export const CURRENT_STORAGE_MAX_SLOTS = 64;
const STORE = "current-values-v1";
const STORAGE_DEADLINE_MS = 10_000;

export type CurrentStorageCode = "INVALID" | "CONFLICT" | "CORRUPT" | "UNAVAILABLE"
  | "QUOTA" | "DISPOSED" | "LIMIT" | "UNSUPPORTED" | "FENCED" | "TIMEOUT";
export type CurrentWriteOutcome = "NOT_ATTEMPTED" | "ABORTED" | "UNKNOWN" | "COMMITTED";

export class CurrentStorageError extends Error {
  constructor(readonly code: CurrentStorageCode, message: string,
    readonly writeOutcome: CurrentWriteOutcome = "NOT_ATTEMPTED") {
    super(message);
    this.name = "CurrentStorageError";
  }
}

function aborted(error: unknown, fallback: DOMException | null): CurrentStorageError {
  const source = error instanceof CurrentStorageError ? error : mapError(fallback);
  return new CurrentStorageError(source.code, source.message, "ABORTED");
}

function transactionDeadline(transaction: IDBTransaction, reject: (error: unknown) => void) {
  const state = { active: true, finish: () => { state.active = false; clearTimeout(timer); } };
  const timer = setTimeout(() => {
    state.active = false;
    try { transaction.abort(); } catch { /* Inactive may mean committed; do not infer abort. */ }
    reject(new CurrentStorageError("TIMEOUT", "IndexedDB deadline without acknowledged outcome", "UNKNOWN"));
  }, STORAGE_DEADLINE_MS);
  return state;
}

export interface CurrentStorageIdentity {
  namespace: string;
  contentIdentity: string;
}

export interface CurrentStoredValue {
  generation: number;
  operation: string;
  bytes: Uint8Array;
}

export interface CurrentWriteImage extends CurrentStoredValue {
  slot: string;
}

export interface CurrentStorageBackend {
  readonly identity: Readonly<CurrentStorageIdentity>;
  read(slot: string): Promise<CurrentStoredValue | null>;
  list(): Promise<string[]>;
  write(image: CurrentWriteImage): Promise<void>;
  reconcile(image: CurrentWriteImage): Promise<"COMMITTED" | "RETRY" | "CONFLICT">;
  close(): Promise<void>;
}

interface StoredRecord {
  key: string;
  scope: string;
  slot: string;
  generation: number;
  operation: string;
  bytes: ArrayBuffer;
}

export function checkedStorageName(value: string): string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).length > 256
    || new TextDecoder().decode(new TextEncoder().encode(value)) !== value) {
    throw new CurrentStorageError("INVALID", "storage name is empty or exceeds 256 UTF-8 bytes");
  }
  return value;
}

function compareUtf8(left: string, right: string): number {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function copyImage(image: CurrentWriteImage): CurrentWriteImage {
  checkedStorageName(image.slot);
  if (!Number.isSafeInteger(image.generation) || image.generation < 1
    || typeof image.operation !== "string" || !/^[a-f0-9]{64}$/u.test(image.operation) || !(image.bytes instanceof Uint8Array)
    || image.bytes.length === 0 || image.bytes.length > CURRENT_STORAGE_VALUE_BYTES) {
    throw new CurrentStorageError("INVALID", "invalid bounded immutable write image");
  }
  return { ...image, bytes: image.bytes.slice() };
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function mapError(error: DOMException | null): CurrentStorageError {
  return new CurrentStorageError(error?.name === "QuotaExceededError" ? "QUOTA" : "UNAVAILABLE",
    error?.message ?? "IndexedDB transaction aborted");
}

export class CurrentIndexedDbStorage implements CurrentStorageBackend {
  readonly identity: Readonly<CurrentStorageIdentity>;
  readonly #factory: IDBFactory;
  readonly #databaseName: string;
  readonly #scope: string;
  #database: Promise<IDBDatabase> | null = null;
  #closed = false;

  constructor(options: CurrentStorageIdentity & { databaseName: string; indexedDB?: IDBFactory }) {
    this.identity = Object.freeze({ namespace: checkedStorageName(options.namespace),
      contentIdentity: checkedStorageName(options.contentIdentity) });
    this.#databaseName = checkedStorageName(options.databaseName);
    this.#scope = JSON.stringify([this.identity.namespace, this.identity.contentIdentity]);
    this.#factory = options.indexedDB ?? indexedDB;
  }

  async read(slot: string): Promise<CurrentStoredValue | null> {
    const key = this.#key(checkedStorageName(slot));
    const database = await this.#open();
    this.#assertOpen();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const deadline = transactionDeadline(transaction, reject);
      let result: CurrentStoredValue | null = null;
      let failure: unknown;
      const request = transaction.objectStore(STORE).get(key);
      request.onsuccess = () => {
        if (!deadline.active) return;
        try { result = request.result == null ? null : this.#decode(request.result, slot); }
        catch (error) { failure = error; transaction.abort(); }
      };
      transaction.onabort = () => { deadline.finish(); reject(aborted(failure, transaction.error)); };
      transaction.onerror = () => { failure ??= mapError(transaction.error); };
      transaction.oncomplete = () => {
        if (!deadline.active) return;
        deadline.finish();
        try { this.#assertOpen(); resolve(result); } catch (error) { reject(error); }
      };
    });
  }

  async list(): Promise<string[]> {
    const database = await this.#open();
    this.#assertOpen();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readonly");
      const deadline = transactionDeadline(transaction, reject);
      const names: string[] = [];
      let failure: unknown;
      // Cursor one record at a time; never load every save payload with getAll().
      const request = transaction.objectStore(STORE).index("scope").openCursor(this.#scope);
      request.onsuccess = () => {
        if (!deadline.active) return;
        try {
          const cursor = request.result;
          if (cursor == null) return;
          if (names.length === CURRENT_STORAGE_MAX_SLOTS) {
            throw new CurrentStorageError("LIMIT", "current save slot inventory exceeds bound");
          }
          const record = cursor.value as StoredRecord;
          this.#decode(record, checkedStorageName(record.slot));
          names.push(record.slot);
          cursor.continue();
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.onabort = () => { deadline.finish(); reject(aborted(failure, transaction.error)); };
      transaction.onerror = () => { failure ??= mapError(transaction.error); };
      transaction.oncomplete = () => {
        if (!deadline.active) return;
        deadline.finish();
        try { this.#assertOpen(); resolve(names.sort(compareUtf8)); } catch (error) { reject(error); }
      };
    });
  }

  async write(source: CurrentWriteImage): Promise<void> {
    const image = copyImage(source); // Before first await; callers cannot change the committed image.
    const database = await this.#open();
    this.#assertOpen();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const deadline = transactionDeadline(transaction, reject);
      const store = transaction.objectStore(STORE);
      let failure: unknown;
      const rejectTransaction = (error: unknown): void => { failure = error; transaction.abort(); };
      const put = (): void => {
        if (!deadline.active) return;
        try {
          this.#assertOpen();
          store.put({ key: this.#key(image.slot), scope: this.#scope, slot: image.slot,
            generation: image.generation, operation: image.operation,
            bytes: image.bytes.slice().buffer } satisfies StoredRecord);
        } catch (error) { rejectTransaction(error); }
      };
      const request = store.get(this.#key(image.slot));
      request.onsuccess = () => {
        if (!deadline.active) return;
        try {
          const current = request.result == null ? null : this.#decode(request.result, image.slot);
          if ((current?.generation ?? 0) !== image.generation - 1) {
            throw new CurrentStorageError("CONFLICT", "save CAS frontier differs");
          }
          if (current != null) { put(); return; }
          const count = store.index("scope").count(this.#scope);
          count.onsuccess = () => {
            if (!deadline.active) return;
            if (count.result >= CURRENT_STORAGE_MAX_SLOTS) {
              rejectTransaction(new CurrentStorageError("LIMIT", "current save slot inventory is full"));
            } else { put(); }
          };
        } catch (error) { rejectTransaction(error); }
      };
      transaction.onabort = () => { deadline.finish(); reject(aborted(failure, transaction.error)); };
      transaction.onerror = () => { failure ??= mapError(transaction.error); };
      transaction.oncomplete = () => {
        if (!deadline.active) return;
        deadline.finish();
        // Disposal after commit is deliberately an uncertain caller outcome.
        try { this.#assertOpen(); resolve(); }
        catch { reject(new CurrentStorageError("DISPOSED", "storage closed after transaction committed", "UNKNOWN")); }
      };
    });
  }

  async reconcile(source: CurrentWriteImage): Promise<"COMMITTED" | "RETRY" | "CONFLICT"> {
    const image = copyImage(source);
    const current = await this.read(image.slot);
    if (current?.generation === image.generation && current.operation === image.operation
      && sameBytes(current.bytes, image.bytes)) return "COMMITTED";
    if ((current?.generation ?? 0) === image.generation - 1) return "RETRY";
    return "CONFLICT";
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#database != null) (await this.#database).close();
  }

  #assertOpen(): void {
    if (this.#closed) throw new CurrentStorageError("DISPOSED", "current storage is closed");
  }

  #key(slot: string): string { return JSON.stringify([this.#scope, slot]); }

  #decode(value: unknown, slot: string): CurrentStoredValue {
    const record = value as StoredRecord | null;
    if (record == null || record.scope !== this.#scope || record.slot !== slot
      || record.key !== this.#key(slot) || !(record.bytes instanceof ArrayBuffer)) {
      throw new CurrentStorageError("CORRUPT", "save record identity or bytes are invalid");
    }
    try {
      return copyImage({ slot, generation: record.generation, operation: record.operation,
        bytes: new Uint8Array(record.bytes) });
    } catch { throw new CurrentStorageError("CORRUPT", "save record generation, receipt or payload is invalid"); }
  }

  async #open(): Promise<IDBDatabase> {
    this.#assertOpen();
    this.#database ??= new Promise((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, 1);
      let abandoned = false;
      const timer = setTimeout(() => {
        abandoned = true;
        reject(new CurrentStorageError("TIMEOUT", "IndexedDB open deadline", "NOT_ATTEMPTED"));
      }, STORAGE_DEADLINE_MS);
      request.onupgradeneeded = () => {
        if (abandoned || this.#closed) { request.transaction?.abort(); return; }
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
      };
      request.onerror = () => { clearTimeout(timer); reject(mapError(request.error)); };
      request.onblocked = () => {
        abandoned = true;
        clearTimeout(timer);
        reject(new CurrentStorageError("UNAVAILABLE", "current database open is blocked"));
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (this.#closed || abandoned) { request.result.close(); reject(new CurrentStorageError("DISPOSED", "current storage is closed")); }
        else { resolve(request.result); }
      };
    });
    return this.#database;
  }
}
