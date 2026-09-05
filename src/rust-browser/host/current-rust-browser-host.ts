import {
  type BrowserRequestEnvelopeV2,
  type BrowserRequestV2,
  type BrowserResponseEnvelopeV2,
  type CurrentWorkerFailureV2,
  decodeBrowserResponseEnvelopeV2,
  encodeBrowserRequestEnvelopeV2,
  encodeCanonicalJsonV2,
  MAXIMUM_BROWSER_REQUEST_BYTES_V2,
  safeCurrentInteger,
} from "../contracts/browser-contracts-v2";
import type { CurrentWorkerAssetsV2 } from "../worker/rust-wasm-loader";

export interface CurrentRustBrowserHostOptionsV2 {
  worker: Worker;
  assets: CurrentWorkerAssetsV2;
  maximumPendingRequests?: number;
  maximumQueuedBytes?: number;
  responseTimeoutMs?: number;
}

interface PendingRequestV2 {
  payload: Uint8Array;
  byteLength: number;
  kind: BrowserRequestV2["kind"];
  resolve(value: BrowserResponseEnvelopeV2): void;
  reject(error: Error): void;
}

interface ActiveRequestV2 {
  pending: PendingRequestV2;
  requestId: number;
  sequence: number;
  timeout: number;
}

export class CurrentWorkerRequestErrorV2 extends Error {
  readonly diagnostic: CurrentWorkerFailureV2;
  constructor(diagnostic: CurrentWorkerFailureV2) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = "CurrentWorkerRequestErrorV2";
    this.diagnostic = diagnostic;
  }
}

/** Serial transport owner only. Callers own effect routing and real settlement.
 * dispatch resolves after transport admission, BEFORE any adapter callback.
 * Never await router.dispatch inside this owner's request queue: a presentation
 * adapter may await dispatch(PRESENTATION_SETTLED) without a circular wait.
 */
export class CurrentRustBrowserHostV2 {
  readonly #worker: Worker;
  readonly #queue: PendingRequestV2[] = [];
  readonly #maximumPending: number;
  readonly #maximumBytes: number;
  readonly #timeoutMs: number;
  #active: ActiveRequestV2 | null = null;
  #queuedBytes = 0;
  #nextRequestId = 1;
  #nextSequence = 0;
  #acceptedSequence: number | null = null;
  #closed = false;
  #closing = false;
  #disposal: Promise<void> | null = null;

  constructor(options: CurrentRustBrowserHostOptionsV2) {
    this.#worker = options.worker;
    try {
      this.#maximumPending = boundedLimit(options.maximumPendingRequests ?? 16, 32, "pending requests");
      this.#maximumBytes = boundedLimit(options.maximumQueuedBytes ?? MAXIMUM_BROWSER_REQUEST_BYTES_V2,
        MAXIMUM_BROWSER_REQUEST_BYTES_V2, "queued bytes");
      this.#timeoutMs = boundedLimit(options.responseTimeoutMs ?? 120_000, 240_000, "response timeout");
      this.#worker.addEventListener("message", this.#onMessage);
      this.#worker.addEventListener("error", this.#onError);
      this.#worker.addEventListener("messageerror", this.#onMessageError);
      this.#worker.postMessage({ kind: "CONFIGURE_CURRENT_WORKER_V2", assets: options.assets });
    } catch (error) {
      this.terminate("current Worker construction failed");
      throw error;
    }
  }

  get status(): { closed: boolean; pending: number; queuedBytes: number; acceptedSequence: number | null } {
    return { closed: this.#closed, pending: this.#queue.length + (this.#active == null ? 0 : 1),
      queuedBytes: this.#queuedBytes, acceptedSequence: this.#acceptedSequence };
  }

  dispatch(request: BrowserRequestV2): Promise<BrowserResponseEnvelopeV2> {
    if (this.#closed || this.#closing) return Promise.reject(new Error("current Worker owner is closed or disposing"));
    if (this.status.pending >= this.#maximumPending) return Promise.reject(new Error("current Worker pending limit exceeded"));
    let payload: Uint8Array;
    try {
      payload = encodeCanonicalJsonV2(request);
      if (payload.byteLength === 0 || payload.byteLength > this.#maximumBytes - this.#queuedBytes) {
        payload.fill(0);
        throw new Error("current Worker queued request bytes exceed their bound");
      }
    } catch (error) { return Promise.reject(error); }
    if (request.kind === "DISPOSE") this.#closing = true;
    return new Promise((resolve, reject) => {
      this.#queuedBytes += payload.byteLength;
      this.#queue.push({ payload, byteLength: payload.byteLength, kind: request.kind, resolve, reject });
      this.#pump();
    });
  }

  dispose(): Promise<void> {
    if (this.#disposal != null) return this.#disposal;
    if (this.#closed) return Promise.resolve();
    this.#disposal = this.dispatch({ kind: "DISPOSE" }).then(response => {
      if (response.response.kind !== "DISPOSED") throw new Error("current Worker did not acknowledge Dispose");
    }).finally(() => { this.terminate("current Worker disposed"); });
    return this.#disposal;
  }

  /** Explicit hard shutdown: pending acceptance is unknown, never retried. */
  terminate(reason = "current Worker owner terminated"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#closing = true;
    this.#worker.removeEventListener("message", this.#onMessage);
    this.#worker.removeEventListener("error", this.#onError);
    this.#worker.removeEventListener("messageerror", this.#onMessageError);
    this.#worker.terminate();
    const error = new Error(reason);
    if (this.#active != null) {
      globalThis.clearTimeout(this.#active.timeout);
      this.#active.pending.payload.fill(0);
      this.#active.pending.reject(error);
      this.#active = null;
    }
    for (const pending of this.#queue.splice(0)) {
      pending.payload.fill(0);
      pending.reject(error);
    }
    this.#queuedBytes = 0;
  }

  #pump(): void {
    if (this.#active != null || this.#closed) return;
    const pending = this.#queue.shift();
    if (pending == null) return;
    if (!safeCurrentInteger(this.#nextRequestId) || !safeCurrentInteger(this.#nextSequence + 1)) {
      this.#queue.unshift(pending);
      this.terminate("current Worker request frontier exhausted");
      return;
    }
    const requestId = this.#nextRequestId++;
    const sequence = this.#nextSequence;
    const timeout = Number(globalThis.setTimeout(() => {
      this.terminate("current Worker response deadline exceeded; acceptance is unknown");
    }, this.#timeoutMs));
    this.#active = { pending, requestId, sequence, timeout };
    try {
      const request = JSON.parse(new TextDecoder().decode(pending.payload)) as BrowserRequestV2;
      pending.payload.fill(0);
      pending.payload = new Uint8Array();
      const envelope: BrowserRequestEnvelopeV2 = { version: 2, request_id: requestId, sequence, request };
      const bytes = encodeBrowserRequestEnvelopeV2(envelope);
      if (bytes.byteLength > MAXIMUM_BROWSER_REQUEST_BYTES_V2) {
        bytes.fill(0);
        this.#rejectKnown(new Error("current Worker complete request envelope exceeds its bound"));
        return;
      }
      const transferable = Uint8Array.from(bytes);
      bytes.fill(0);
      this.#worker.postMessage(transferable.buffer, [transferable.buffer]);
    } catch (error) {
      // A postMessage failure is not a promise of non-delivery.
      this.terminate(error instanceof Error ? error.message : String(error));
    }
  }

  #takeActive(): ActiveRequestV2 {
    const active = this.#active;
    if (active == null) throw new Error("current Worker returned an unsolicited response");
    globalThis.clearTimeout(active.timeout);
    this.#active = null;
    this.#queuedBytes -= active.pending.byteLength;
    return active;
  }

  #rejectKnown(error: Error): void {
    const active = this.#takeActive();
    if (active.pending.kind === "DISPOSE") this.#closing = false;
    active.pending.reject(error);
    this.#pump();
  }

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    if (this.#closed) return;
    try {
      const active = this.#active;
      if (active == null) throw new Error("current Worker returned an unsolicited response");
      if (!(event.data instanceof ArrayBuffer)) {
        const diagnostic = event.data as CurrentWorkerFailureV2 | null;
        if (diagnostic?.kind !== "CURRENT_WORKER_FAILURE_V2" || diagnostic.version !== 2
          || typeof diagnostic.code !== "string" || diagnostic.code.length > 128
          || typeof diagnostic.message !== "string" || diagnostic.message.length > 512) {
          throw new Error("current Worker returned an invalid transport diagnostic");
        }
        if (diagnostic.acceptance !== "REJECTED" || diagnostic.request_id !== active.requestId
          || diagnostic.sequence !== active.sequence || diagnostic.accepted_sequence !== this.#acceptedSequence) {
          throw new Error("current Worker acceptance/correlation is unknown; owner fenced");
        }
        this.#rejectKnown(new CurrentWorkerRequestErrorV2(diagnostic));
        return;
      }
      const response = decodeBrowserResponseEnvelopeV2(event.data);
      if (response.request_id !== active.requestId || response.accepted_sequence !== active.sequence) {
        throw new Error("current Worker response does not match the serial frontier");
      }
      const kind = response.response.kind;
      const requested = active.pending.kind;
      if (kind === "FAULT" || (requested === "INITIALIZE" ? kind !== "READY"
        : requested === "SNAPSHOT" ? kind !== "SNAPSHOT"
        : requested === "DISPOSE" ? kind !== "DISPOSED" : kind !== "EFFECTS")) {
        throw new Error("current host response kind does not satisfy the pending request");
      }
      this.#acceptedSequence = response.accepted_sequence;
      this.#nextSequence = response.accepted_sequence + 1;
      const completed = this.#takeActive();
      completed.pending.resolve(response);
      if (kind === "DISPOSED") this.terminate("current Worker disposed");
      else this.#pump();
    } catch (error) {
      this.terminate(error instanceof Error ? error.message : String(error));
    }
  };

  readonly #onError = (event: ErrorEvent): void => {
    event.preventDefault();
    this.terminate("current Worker crashed; acceptance is unknown");
  };
  readonly #onMessageError = (): void => { this.terminate("current Worker response could not be decoded"); };
}

function boundedLimit(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`current Worker ${name} limit is invalid`);
  }
  return value;
}
