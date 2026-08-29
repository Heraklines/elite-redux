import {
  type BrowserRequestEnvelopeV1,
  type BrowserRequestV1,
  type BrowserResponseEnvelopeV1,
  MAXIMUM_BROWSER_EFFECT_BYTES_V1,
  MAXIMUM_BROWSER_PENDING_REQUESTS_V1,
} from "../contracts/browser-contracts";
import { BrowserMessageSequencerV1, encodeCanonicalBrowserBatch } from "./message-sequencer";

export interface RustBrowserHostOptionsV1 {
  workerUrl: URL;
  initialize: BrowserRequestV1 & { kind: "INITIALIZE" };
  maximumPendingRequests?: number;
  responseTimeoutMs?: number;
  workerFactory?: (url: URL) => Worker;
}

interface PendingBatch {
  requests: BrowserRequestEnvelopeV1[];
  resolve(value: BrowserResponseEnvelopeV1[]): void;
  reject(reason: Error): void;
  timeout: number;
}

function zeroizeRequests(requests: readonly BrowserRequestEnvelopeV1[]): void {
  for (const envelope of requests) {
    const request = envelope.request;
    if (request.kind === "INITIALIZE") {
      request.value.execution_identity_bytes.fill(0);
      request.value.session_start_bytes.fill(0);
    } else if (request.kind === "NETWORK_FRAME" || request.kind === "STORAGE_RESULT") {
      request.value.bytes.fill(0);
    }
  }
}

export class RustBrowserHost {
  readonly #worker: Worker;
  readonly #sequencer = new BrowserMessageSequencerV1();
  readonly #pending: PendingBatch[] = [];
  readonly #maximumPending: number;
  readonly #responseTimeoutMs: number;
  #disposed = false;

  private constructor(options: RustBrowserHostOptionsV1) {
    this.#worker = (options.workerFactory ?? (url => new Worker(url, { type: "module", name: "er-rust-kernel" })))(
      options.workerUrl,
    );
    this.#maximumPending = Math.min(
      MAXIMUM_BROWSER_PENDING_REQUESTS_V1,
      Math.max(1, options.maximumPendingRequests ?? 64),
    );
    this.#responseTimeoutMs = Math.max(1_000, options.responseTimeoutMs ?? 30_000);
    this.#worker.addEventListener("message", this.#onMessage);
    this.#worker.addEventListener("error", this.#onWorkerError);
    this.#worker.addEventListener("messageerror", this.#onMessageError);
  }

  static async create(options: RustBrowserHostOptionsV1): Promise<RustBrowserHost> {
    const host = new RustBrowserHost(options);
    const [response] = await host.dispatch(options.initialize);
    if (response.response.kind !== "READY") {
      await host.dispose();
      throw new Error(`Rust worker did not become ready: ${response.response.kind}`);
    }
    return host;
  }

  dispatch(request: BrowserRequestV1): Promise<BrowserResponseEnvelopeV1[]> {
    return this.dispatchBatch([request]);
  }

  dispatchBatch(requests: readonly BrowserRequestV1[]): Promise<BrowserResponseEnvelopeV1[]> {
    if (this.#disposed) {
      return Promise.reject(new Error("Rust browser host is disposed"));
    }
    const pendingCount = this.#pending.reduce((count, batch) => count + batch.requests.length, 0);
    if (pendingCount + requests.length > this.#maximumPending) {
      return Promise.reject(new Error("Rust browser host backpressure limit exceeded"));
    }
    const envelopes = this.#sequencer.reserve(requests);
    let bytes: Uint8Array;
    try {
      bytes = encodeCanonicalBrowserBatch(envelopes);
    } catch (error) {
      this.#sequencer.rollback(envelopes);
      return Promise.reject(error);
    }
    return new Promise<BrowserResponseEnvelopeV1[]>((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        const index = this.#pending.findIndex(batch => batch.requests === envelopes);
        if (index >= 0) {
          this.#pending.splice(index, 1);
        }
        reject(new Error("Rust worker response timed out"));
        this.#fail(new Error("Rust worker response timeout terminated the session"));
      }, this.#responseTimeoutMs);
      this.#pending.push({ requests: envelopes, resolve, reject, timeout });
      try {
        this.#worker.postMessage(bytes.buffer, [bytes.buffer]);
      } catch (error) {
        this.#pending.pop();
        globalThis.clearTimeout(timeout);
        this.#sequencer.rollback(envelopes);
        reject(error);
      }
    });
  }

  async snapshot(): Promise<Uint8Array> {
    const [response] = await this.dispatch({ kind: "SNAPSHOT" });
    if (response.response.kind !== "SNAPSHOT") {
      throw new Error(`Rust worker snapshot failed: ${response.response.kind}`);
    }
    return Uint8Array.from(response.response.value);
  }

  async exportRepro(): Promise<Uint8Array> {
    const [response] = await this.dispatch({ kind: "EXPORT_REPRO" });
    if (response.response.kind !== "REPRO") {
      throw new Error(`Rust worker repro export failed: ${response.response.kind}`);
    }
    return Uint8Array.from(response.response.value);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    try {
      await this.dispatch({ kind: "DISPOSE" });
    } finally {
      this.#disposed = true;
      this.#sequencer.dispose();
      this.#worker.removeEventListener("message", this.#onMessage);
      this.#worker.removeEventListener("error", this.#onWorkerError);
      this.#worker.removeEventListener("messageerror", this.#onMessageError);
      this.#worker.terminate();
      this.#rejectPending(new Error("Rust browser host disposed"));
    }
  }

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    if (this.#disposed) {
      return;
    }
    if (this.#pending.length === 0) {
      this.#fail(new Error("Rust worker emitted an unsolicited or stale response"));
      return;
    }
    const pending = this.#pending.shift();
    if (pending == null) {
      return;
    }
    globalThis.clearTimeout(pending.timeout);
    try {
      if (
        !(event.data instanceof ArrayBuffer)
        || event.data.byteLength === 0
        || event.data.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
      ) {
        throw new Error("Rust worker returned invalid or oversized bytes");
      }
      const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(event.data));
      if (!Array.isArray(parsed)) {
        throw new Error("Rust worker response is not a batch");
      }
      const responses = parsed as BrowserResponseEnvelopeV1[];
      this.#sequencer.accept(pending.requests, responses);
      zeroizeRequests(pending.requests);
      pending.resolve(responses);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      zeroizeRequests(pending.requests);
      pending.reject(failure);
      this.#fail(failure);
    }
  };

  readonly #onWorkerError = (event: ErrorEvent): void => this.#fail(new Error(event.message || "Rust worker crashed"));
  readonly #onMessageError = (): void => this.#fail(new Error("Rust worker response could not be deserialized"));

  #fail(error: Error): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#sequencer.dispose();
    this.#worker.terminate();
    this.#rejectPending(error);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.splice(0)) {
      globalThis.clearTimeout(pending.timeout);
      zeroizeRequests(pending.requests);
      pending.reject(error);
    }
  }
}
