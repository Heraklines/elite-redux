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
export type CurrentStorageAcceptance = "ACCEPTED" | "REJECTED" | "UNKNOWN" | "SUPPRESSED_BY_CANCEL";
export type CurrentStoragePhase = "QUEUED" | "RUNNING" | "DURABLE" | "CALLBACK_REJECTED"
  | "ACKNOWLEDGED" | "FAILED" | "UNCERTAIN" | "FENCED" | "CANCELLING" | "CANCELLED";

/** Minted from a correlated current Worker pre/input/post snapshot rail. All
 * fields are copied and frozen by the owner; no external token is retained. */
export interface CurrentTitleCancellationEvidence {
  requestId: number;
  kind: "READ" | "LIST";
  slot: string | null;
  preSequence: number;
  cancelSequence: number;
  postSequence: number;
  waitingMenu: number;
  waitingRevision: number;
  postMenu: number;
  postRevision: number;
  nextPlatformRequestId: number;
  beforeReplay: number;
  postReplay: number;
}
export interface CurrentStorageDeliveryGuard { cancelled(): boolean; }
interface CancellationOwner {
  readonly evidence: Readonly<CurrentTitleCancellationEvidence>;
  released: boolean;
}
type ReadOnlyTerminal = "NOT_STARTED" | "PENDING" | "COMPLETED" | "ABORTED";
const retired = (entry: CurrentStorageProgress) => entry.phase === "ACKNOWLEDGED" || entry.phase === "CANCELLED";
export interface CurrentStorageProgress {
  requestId: number;
  phase: CurrentStoragePhase;
  operation: string | null;
  durable: boolean;
  writeOutcome: CurrentWriteOutcome;
  error: string | null;
  cancellation?: { cancelSequence: number; postSequence: number; terminal: ReadOnlyTerminal };
}

interface OwnedRequest extends CurrentStorageProgress {
  kind: "READ" | "WRITE" | "LIST";
  slot: string | null;
  generation: number | null;
  bytes: Uint8Array;
  result: CurrentStorageResult | null;
  retainedBytes: number;
  cancellationOwner: CancellationOwner | null;
  readOnlyTerminal: ReadOnlyTerminal;
  workSettled: boolean;
}

export interface CurrentStorageOwnerOptions {
  backend: CurrentStorageBackend;
  // Stable logical session identity, not a temporary browser instance ID.
  // Recreating from the same pending core snapshot must supply the same value.
  sessionIdentity: string;
  deliver: (requestId: number, result: CurrentStorageResult, guard: CurrentStorageDeliveryGuard) => Promise<CurrentStorageAcceptance>;
  allowTitleCancellation?: boolean;
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
    phase: "QUEUED", error: null, cancellationOwner: null, readOnlyTerminal: "NOT_STARTED", workSettled: false };
}

function ownCancellation(source: CurrentTitleCancellationEvidence): Readonly<CurrentTitleCancellationEvidence> {
  if (source == null || (source.kind !== "READ" && source.kind !== "LIST")) {
    throw new CurrentStorageError("INVALID", "invalid Title cancellation evidence");
  }
  const evidence = { requestId: source.requestId, kind: source.kind, slot: source.slot,
    preSequence: source.preSequence, cancelSequence: source.cancelSequence, postSequence: source.postSequence,
    waitingMenu: source.waitingMenu, waitingRevision: source.waitingRevision,
    postMenu: source.postMenu, postRevision: source.postRevision,
    nextPlatformRequestId: source.nextPlatformRequestId, beforeReplay: source.beforeReplay, postReplay: source.postReplay };
  const integers = [evidence.requestId, evidence.preSequence, evidence.cancelSequence, evidence.postSequence,
    evidence.waitingMenu, evidence.waitingRevision, evidence.postMenu, evidence.postRevision,
    evidence.nextPlatformRequestId, evidence.beforeReplay, evidence.postReplay];
  if (integers.some(value => !Number.isSafeInteger(value) || value < 0) || evidence.requestId < 1
    || evidence.waitingMenu < 1 || evidence.waitingRevision < 1
    || evidence.cancelSequence !== evidence.preSequence + 1 || evidence.postSequence !== evidence.cancelSequence + 1
    || evidence.postMenu !== evidence.waitingMenu + 1 || evidence.postRevision !== evidence.waitingRevision + 1
    || evidence.nextPlatformRequestId !== evidence.requestId + 1 || evidence.postReplay !== evidence.beforeReplay + 1
    || (evidence.kind === "LIST" ? evidence.slot !== null : typeof evidence.slot !== "string")) {
    throw new CurrentStorageError("INVALID", "uncorrelated Title cancellation evidence");
  }
  if (evidence.kind === "READ") checkedStorageName(evidence.slot!);
  return Object.freeze(evidence);
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
  readonly #allowTitleCancellation: boolean;
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
    this.#allowTitleCancellation = options.allowTitleCancellation === true;
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
    const pending = [...this.#entries.values()].filter(entry => !retired(entry)).length;
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
    return [...this.#entries.values()].map(entry => ({ requestId: entry.requestId, phase: entry.phase,
      operation: entry.operation, durable: entry.durable, writeOutcome: entry.writeOutcome, error: entry.error,
      ...(entry.cancellationOwner == null ? {} : { cancellation: {
        cancelSequence: entry.cancellationOwner.evidence.cancelSequence,
        postSequence: entry.cancellationOwner.evidence.postSequence, terminal: entry.readOnlyTerminal } }) }));
  }

  get hasReadOnlyWork() { return [...this.#entries.values()].some(entry => entry.kind !== "WRITE" && !retired(entry)); }
  get retirementStatus() {
    const entries = [...this.#entries.values()];
    return { highestId: this.#highestId, pending: entries.filter(entry => !retired(entry)).length,
      retained: entries.length, retainedBytes: this.#retainedBytes,
      cancelling: entries.filter(entry => entry.phase === "CANCELLING").length,
      cancelled: entries.filter(entry => entry.phase === "CANCELLED").length, fenced: this.#fenced };
  }

  beginTitleReadOnlyRetirement(source: CurrentTitleCancellationEvidence): void {
    this.#assertUsable();
    if (!this.#allowTitleCancellation) throw new CurrentStorageError("UNSUPPORTED", "Title cancellation was not enabled");
    const evidence = ownCancellation(source);
    const entry = this.#entries.get(evidence.requestId);
    if (entry == null || entry.kind === "WRITE" || entry.kind !== evidence.kind || entry.slot !== evidence.slot
      || entry.durable || entry.writeOutcome !== "NOT_ATTEMPTED") {
      throw new CurrentStorageError("INVALID", "cancellation does not own this read-only request");
    }
    if (entry.cancellationOwner != null) {
      if (JSON.stringify(entry.cancellationOwner.evidence) !== JSON.stringify(evidence)) {
        throw new CurrentStorageError("CONFLICT", "cancellation evidence changed");
      }
      return;
    }
    if (!["QUEUED", "RUNNING", "FAILED", "CALLBACK_REJECTED"].includes(entry.phase)) {
      throw new CurrentStorageError("INVALID", "storage phase cannot become cancelled");
    }
    entry.cancellationOwner = { evidence, released: false };
    entry.phase = "CANCELLING"; // Suppress callbacks synchronously, retain all admission until drain.
    this.#finishCancellation(entry);
  }

  #finishCancellation(entry: OwnedRequest): void {
    const cancellation = entry.cancellationOwner;
    if (cancellation == null || cancellation.released || !entry.workSettled) return;
    if (this.#closed || this.#fenced || entry.phase === "FENCED" || entry.phase === "UNCERTAIN"
      || entry.readOnlyTerminal === "PENDING") {
      this.#fenced = true;
      entry.phase = "FENCED";
      entry.error ??= "read-only cancellation has no confirmed backend/work drain";
      return;
    }
    this.#retainedBytes -= entry.retainedBytes;
    entry.retainedBytes = 0;
    entry.bytes = new Uint8Array();
    entry.result = null;
    cancellation.released = true;
    entry.phase = "CANCELLED";
  }

  async #readOnly<T>(entry: OwnedRequest, start: () => Promise<T>): Promise<T> {
    // Keep the raw operation observed after a deadline wins. Only the frozen
    // backend's real complete/abort events qualify; a timeout never does.
    entry.readOnlyTerminal = "PENDING";
    const operation = start().then(value => {
      entry.readOnlyTerminal = "COMPLETED";
      return value;
    }, error => {
      if (error instanceof CurrentStorageError && error.code !== "TIMEOUT" && error.writeOutcome === "ABORTED") {
        entry.readOnlyTerminal = "ABORTED";
      }
      throw error;
    });
    return this.#bounded(operation);
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
      if (retired(entry)) {
        this.#entries.delete(id);
        this.#retainedBytes -= entry.retainedBytes;
      }
    }
    if (this.#entries.size >= MAX_RETAINED || this.#retainedBytes + additional > MAX_RETAINED_BYTES) {
      throw new CurrentStorageError("LIMIT", "retained storage images exceed bound");
    }
  }

  #schedule(entry: OwnedRequest): void {
    entry.workSettled = false;
    this.#work = this.#work.then(async () => {
      try { await this.#run(entry); }
      finally { entry.workSettled = true; this.#finishCancellation(entry); }
    });
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
      if (entry.cancellationOwner != null) return;
      entry.phase = "RUNNING";
      entry.operation ??= await this.#bounded(this.#fingerprint(entry));
      this.#assertUsable();
      if (entry.cancellationOwner != null) return;
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
          const stored = await this.#readOnly(entry, () => this.#backend.read(entry.slot!));
          if (entry.cancellationOwner != null) return;
          result = { kind: "READ", bytes: stored == null ? null : Array.from(stored.bytes) };
        } else {
          result = { kind: "SLOTS", slots: await this.#readOnly(entry, () => this.#backend.list()) };
        }
        if (entry.cancellationOwner != null) return;
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
      if (entry.cancellationOwner != null) return;
      let acceptance: CurrentStorageAcceptance;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        // The callback receives a separate image; it cannot corrupt retained retry data.
        const result = structuredClone(entry.result);
        acceptance = await Promise.race([this.#deliver(entry.requestId, result, Object.freeze({ cancelled: () =>
          !this.#closed && !this.#fenced && entry.cancellationOwner != null })),
          new Promise<CurrentStorageAcceptance>(resolve => { timeout = setTimeout(() => resolve("UNKNOWN"), CALLBACK_TIMEOUT_MS); })]);
      } catch { acceptance = "UNKNOWN"; }
      finally { if (timeout !== undefined) clearTimeout(timeout); }
      this.#assertUsable(); // A late delivery cannot acknowledge after close/fence.
      if (acceptance === "SUPPRESSED_BY_CANCEL" && entry.cancellationOwner != null) return;
      if (entry.cancellationOwner != null && acceptance === "ACCEPTED") {
        this.#fenced = true;
        throw new CurrentStorageError("FENCED", "cancelled callback was unexpectedly accepted", "UNKNOWN");
      }
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
