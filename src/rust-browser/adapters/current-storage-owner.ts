import type { BrowserStorageRequestV2Wire } from "../contracts/browser-contracts-v2";
import { checkedStorageName, CURRENT_STORAGE_VALUE_BYTES, CurrentStorageError,
  type CurrentStorageBackend, type CurrentWriteImage, type CurrentWriteOutcome } from "./current-storage-backend";

const MAX_PENDING = 16;
const MAX_RETAINED = 32;
const MAX_RETAINED_BYTES = 8_388_608;
const MAX_CALLBACK_RESULT_BYTES = 8_388_608;
const WRITE_RESULT_RESERVE = 32;
const CALLBACK_TIMEOUT_MS = 10_000;

export type CurrentStorageResult = { kind: "WRITTEN" } | { kind: "READ"; bytes: number[] | null }
  | { kind: "SLOTS"; slots: string[] };
export type CurrentStorageAcceptance = "ACCEPTED" | "REJECTED" | "UNKNOWN";
export type CurrentStoragePhase = "QUEUED" | "RUNNING" | "DURABLE" | "CALLBACK_REJECTED"
  | "ACKNOWLEDGED" | "FAILED" | "UNCERTAIN" | "FENCED";

export interface CurrentStorageProgress {
  requestId: number;
  phase: CurrentStoragePhase;
  operation: string | null;
  durable: boolean;
  writeOutcome: CurrentWriteOutcome;
  error: string | null;
}

interface OwnedRequest extends CurrentStorageProgress {
  kind: "READ" | "WRITE" | "LIST";
  slot: string | null;
  generation: number | null;
  bytes: Uint8Array;
  result: CurrentStorageResult | null;
  retainedBytes: number;
}

export interface CurrentStorageOwnerOptions {
  backend: CurrentStorageBackend;
  // Stable logical session identity, not a temporary browser instance ID.
  // Recreating from the same pending core snapshot must supply the same value.
  sessionIdentity: string;
  deliver: (requestId: number, result: CurrentStorageResult) => Promise<CurrentStorageAcceptance>;
}

function ownRequest(request: BrowserStorageRequestV2Wire): OwnedRequest {
  if (!Number.isSafeInteger(request.request_id) || request.request_id < 1
    || !Array.isArray(request.bytes)) throw new CurrentStorageError("INVALID", "invalid storage request ID or bytes");
  if (request.kind === "DELETE") {
    throw new CurrentStorageError("UNSUPPORTED", "current DELETE requires an expected-frontier contract");
  }
  if (request.kind !== "READ" && request.kind !== "WRITE" && request.kind !== "LIST") {
    throw new CurrentStorageError("INVALID", "unknown current storage operation");
  }
  if (request.kind === "LIST") {
    if (request.slot !== null) throw new CurrentStorageError("INVALID", "LIST must not name a slot");
  } else { checkedStorageName(request.slot as string); }
  if (request.kind === "WRITE") {
    if (!Number.isSafeInteger(request.generation) || Number(request.generation) < 1
      || request.bytes.length === 0 || request.bytes.length > CURRENT_STORAGE_VALUE_BYTES) {
      throw new CurrentStorageError("INVALID", "invalid bounded WRITE image");
    }
    for (const byte of request.bytes) {
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
        throw new CurrentStorageError("INVALID", "WRITE payload must contain only byte integers");
      }
    }
  } else if (request.generation !== null || request.bytes.length !== 0) {
    throw new CurrentStorageError("INVALID", "READ/LIST must not carry generation or payload");
  }
  return { requestId: request.request_id, kind: request.kind, slot: request.slot,
    generation: request.generation, bytes: Uint8Array.from(request.bytes), result: null,
    retainedBytes: request.bytes.length + (request.kind === "WRITE" ? WRITE_RESULT_RESERVE : 0), operation: null, durable: false,
    writeOutcome: "NOT_ATTEMPTED",
    phase: "QUEUED", error: null };
}

function sameRequest(left: OwnedRequest, right: OwnedRequest): boolean {
  return left.kind === right.kind && left.slot === right.slot && left.generation === right.generation
    && left.bytes.length === right.bytes.length && left.bytes.every((byte, index) => byte === right.bytes[index]);
}

/** enqueue() owns the image synchronously and never awaits a nested effect router.
 * drain() is a separate observer for the outer integration boundary. deliver() must
 * await only host acceptance, enqueue any response effects, and return; it must not
 * await this owner's drain(). No uncertain client acceptance is retried implicitly.
 */
export class CurrentStorageRequestOwner {
  readonly #backend: CurrentStorageBackend;
  readonly #session: string;
  readonly #scope: readonly [string, string];
  readonly #deliver: CurrentStorageOwnerOptions["deliver"];
  readonly #entries = new Map<number, OwnedRequest>();
  #work: Promise<void> = Promise.resolve();
  #highestId = 0;
  #retainedBytes = 0;
  #closed = false;
  #fenced = false;

  constructor(options: CurrentStorageOwnerOptions) {
    this.#backend = options.backend;
    this.#session = checkedStorageName(options.sessionIdentity);
    this.#scope = [checkedStorageName(options.backend.identity.namespace),
      checkedStorageName(options.backend.identity.contentIdentity)];
    this.#deliver = options.deliver;
  }

  enqueue(request: BrowserStorageRequestV2Wire): void {
    this.#assertUsable();
    const owned = ownRequest(request);
    const previous = this.#entries.get(owned.requestId);
    if (previous != null) {
      if (!sameRequest(previous, owned)) throw new CurrentStorageError("CONFLICT", "request ID reused with a different image");
      return; // Explicit retry() owns retries; a router replay never starts I/O.
    }
    if (owned.requestId <= this.#highestId) throw new CurrentStorageError("CONFLICT", "request ID is older than retained ownership");
    const pending = [...this.#entries.values()].filter(entry => entry.phase !== "ACKNOWLEDGED").length;
    if (pending >= MAX_PENDING) throw new CurrentStorageError("LIMIT", "pending storage ownership is full");
    this.#makeRoom(owned.retainedBytes);
    this.#entries.set(owned.requestId, owned);
    this.#highestId = owned.requestId;
    this.#retainedBytes += owned.retainedBytes;
    this.#schedule(owned);
  }

  retry(requestId: number): void {
    this.#assertUsable();
    const entry = this.#entries.get(requestId);
    if (entry == null || !["FAILED", "UNCERTAIN", "CALLBACK_REJECTED"].includes(entry.phase)) {
      throw new CurrentStorageError("INVALID", "request is not retryable");
    }
    entry.phase = "QUEUED";
    entry.error = null;
    this.#schedule(entry);
  }

  progress(): CurrentStorageProgress[] {
    return [...this.#entries.values()].map(({ requestId, phase, operation, durable, writeOutcome, error }) =>
      ({ requestId, phase, operation, durable, writeOutcome, error }));
  }

  async drain(): Promise<CurrentStorageProgress[]> {
    // Delivery may enqueue another effect. Observe the tail until it stops moving.
    let observed: Promise<void>;
    do { observed = this.#work; await observed; } while (observed !== this.#work);
    return this.progress();
  }

  async close(): Promise<void> {
    this.#closed = true; // Fence callbacks before awaiting database completion.
    await this.#bounded(this.#backend.close());
  }

  async #bounded<T>(operation: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new CurrentStorageError("TIMEOUT", "storage boundary deadline", "UNKNOWN")), CALLBACK_TIMEOUT_MS);
      })]);
    } finally { if (timeout !== undefined) clearTimeout(timeout); }
  }

  #assertUsable(): void {
    if (this.#closed) throw new CurrentStorageError("DISPOSED", "storage owner is closed");
    if (this.#fenced) throw new CurrentStorageError("FENCED", "unknown client acceptance requires external session reconciliation");
  }

  #makeRoom(additional: number): void {
    for (const [id, entry] of this.#entries) {
      if (this.#entries.size < MAX_RETAINED && this.#retainedBytes + additional <= MAX_RETAINED_BYTES) break;
      if (entry.phase === "ACKNOWLEDGED") {
        this.#entries.delete(id);
        this.#retainedBytes -= entry.retainedBytes;
      }
    }
    if (this.#entries.size >= MAX_RETAINED || this.#retainedBytes + additional > MAX_RETAINED_BYTES) {
      throw new CurrentStorageError("LIMIT", "retained storage images exceed bound");
    }
  }

  #schedule(entry: OwnedRequest): void {
    this.#work = this.#work.then(() => this.#run(entry));
  }

  async #fingerprint(entry: OwnedRequest): Promise<string> {
    const header = new TextEncoder().encode(JSON.stringify([1, ...this.#scope, this.#session,
      entry.requestId, entry.kind, entry.slot, entry.generation]));
    const image = new Uint8Array(header.length + 1 + entry.bytes.length);
    image.set(header);
    image.set(entry.bytes, header.length + 1); // NUL separator; JSON strings escape NUL.
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", image)),
      byte => byte.toString(16).padStart(2, "0")).join("");
  }

  async #run(entry: OwnedRequest): Promise<void> {
    let attemptedWrite = false;
    let writeReturned = false;
    try {
      this.#assertUsable();
      entry.phase = "RUNNING";
      entry.operation ??= await this.#bounded(this.#fingerprint(entry));
      this.#assertUsable();
      if (entry.result == null) {
        let result: CurrentStorageResult;
        if (entry.kind === "WRITE") {
          const image: CurrentWriteImage = { slot: entry.slot!, generation: entry.generation!,
            operation: entry.operation, bytes: entry.bytes };
          const state = await this.#bounded(this.#backend.reconcile(image));
          if (state === "CONFLICT") throw new CurrentStorageError("CONFLICT", "immutable write cannot reconcile with durable record");
          if (state === "RETRY") {
            this.#assertUsable();
            attemptedWrite = true;
            entry.writeOutcome = "UNKNOWN";
            await this.#bounded(this.#backend.write(image));
            writeReturned = true;
            if (await this.#bounded(this.#backend.reconcile(image)) !== "COMMITTED") {
              throw new CurrentStorageError("CONFLICT", "write readback differs from immutable image");
            }
          }
          entry.durable = true;
          entry.writeOutcome = "COMMITTED";
          entry.phase = "DURABLE";
          result = { kind: "WRITTEN" };
        } else if (entry.kind === "READ") {
          const stored = await this.#bounded(this.#backend.read(entry.slot!));
          result = { kind: "READ", bytes: stored == null ? null : Array.from(stored.bytes) };
        } else {
          result = { kind: "SLOTS", slots: await this.#bounded(this.#backend.list()) };
        }
        const encodedBytes = new TextEncoder().encode(JSON.stringify(result)).length;
        if (encodedBytes > MAX_CALLBACK_RESULT_BYTES) throw new CurrentStorageError("LIMIT", "callback result exceeds bound");
        // WRITE acknowledgement storage was reserved before any transaction.
        const additional = encodedBytes - (entry.kind === "WRITE" ? WRITE_RESULT_RESERVE : 0);
        this.#makeRoom(additional);
        entry.result = result;
        entry.retainedBytes += additional;
        this.#retainedBytes += additional;
      }
      this.#assertUsable();
      let acceptance: CurrentStorageAcceptance;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        // The callback receives a separate image; it cannot corrupt retained retry data.
        const result = structuredClone(entry.result);
        acceptance = await Promise.race([this.#deliver(entry.requestId, result),
          new Promise<CurrentStorageAcceptance>(resolve => { timeout = setTimeout(() => resolve("UNKNOWN"), CALLBACK_TIMEOUT_MS); })]);
      } catch { acceptance = "UNKNOWN"; }
      finally { if (timeout !== undefined) clearTimeout(timeout); }
      this.#assertUsable(); // A late delivery cannot acknowledge after close/fence.
      if (acceptance !== "ACCEPTED" && acceptance !== "REJECTED") {
        this.#fenced = true;
        entry.phase = "FENCED";
        entry.error = "unknown callback acceptance; no automatic retry";
      } else {
        entry.phase = acceptance === "ACCEPTED" ? "ACKNOWLEDGED" : "CALLBACK_REJECTED";
      }
    } catch (error) {
      if (error instanceof CurrentStorageError && error.code === "TIMEOUT") this.#fenced = true;
      const definite = !writeReturned && error instanceof CurrentStorageError
        && (error.writeOutcome === "ABORTED" || error.writeOutcome === "NOT_ATTEMPTED");
      if (attemptedWrite && definite && !entry.durable) entry.writeOutcome = error.writeOutcome;
      entry.error = (error instanceof CurrentStorageError ? `${error.code}: ${error.message}` : String(error)).slice(0, 512);
      entry.phase = this.#closed || this.#fenced ? "FENCED" : attemptedWrite && !definite ? "UNCERTAIN" : "FAILED";
    }
  }
}
