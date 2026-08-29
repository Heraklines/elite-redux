import {
  type BrowserRequestEnvelopeV1,
  type BrowserRequestV1,
  type BrowserResponseEnvelopeV1,
  MAXIMUM_BROWSER_EFFECT_BYTES_V1,
  MAXIMUM_BROWSER_PENDING_REQUESTS_V1,
} from "../contracts/browser-contracts";
import { BrowserMessageSequencerV1, encodeCanonicalBrowserBatch } from "../host/message-sequencer";
import type { BrowserKernelGenerationIdentityV1, BrowserKernelGenerationV1 } from "./contracts";

interface PendingGenerationBatchV1 {
  requests: BrowserRequestEnvelopeV1[];
  resolve(value: BrowserResponseEnvelopeV1[]): void;
  reject(reason: Error): void;
  timeout: number;
}

export interface GenerationWorkerHostOptionsV1 {
  identity: BrowserKernelGenerationIdentityV1;
  workerUrl: URL;
  initialize: BrowserRequestV1 & { kind: "INITIALIZE" };
  maximumPendingRequests?: number;
  responseTimeoutMs?: number;
  workerFactory?: (url: URL) => Worker;
  channelFactory?: () => MessageChannel;
}

export class GenerationWorkerHostV1 implements BrowserKernelGenerationV1 {
  readonly identity: BrowserKernelGenerationIdentityV1;
  readonly #worker: Worker;
  readonly #port: MessagePort;
  readonly #sequencer = new BrowserMessageSequencerV1();
  readonly #pending: PendingGenerationBatchV1[] = [];
  readonly #maximumPending: number;
  readonly #responseTimeoutMs: number;
  #disposed = false;

  private constructor(options: GenerationWorkerHostOptionsV1) {
    this.identity = options.identity;
    this.#maximumPending = Math.min(
      MAXIMUM_BROWSER_PENDING_REQUESTS_V1,
      Math.max(1, options.maximumPendingRequests ?? 64),
    );
    this.#responseTimeoutMs = Math.max(1_000, options.responseTimeoutMs ?? 30_000);
    this.#worker = (
      options.workerFactory
      ?? (url => new Worker(url, { type: "module", name: `er-kernel-${this.identity.generation}` }))
    )(options.workerUrl);
    const channel = (options.channelFactory ?? (() => new MessageChannel()))();
    this.#port = channel.port1;
    this.#port.addEventListener("message", this.#onMessage);
    this.#port.addEventListener("messageerror", this.#onMessageError);
    this.#worker.addEventListener("error", this.#onWorkerError);
    this.#port.start();
    this.#worker.postMessage({ kind: "ATTACH_PORT_V1", generation: this.identity.generation, port: channel.port2 }, [
      channel.port2,
    ]);
  }

  static async create(options: GenerationWorkerHostOptionsV1): Promise<GenerationWorkerHostV1> {
    const host = new GenerationWorkerHostV1(options);
    try {
      const [response] = await host.dispatch(options.initialize);
      if (response?.response.kind !== "READY") {
        throw new Error(`candidate Worker did not become ready: ${response?.response.kind ?? "missing"}`);
      }
      return host;
    } catch (error) {
      await host.dispose().catch(() => undefined);
      throw error;
    }
  }

  dispatch(request: BrowserRequestV1): Promise<BrowserResponseEnvelopeV1[]> {
    if (this.#disposed) {
      return Promise.reject(new Error("generation Worker is disposed"));
    }
    const pendingCount = this.#pending.reduce((count, batch) => count + batch.requests.length, 0);
    if (pendingCount >= this.#maximumPending) {
      return Promise.reject(new Error("generation Worker backpressure limit exceeded"));
    }
    const requests = this.#sequencer.reserve([request]);
    const bytes = encodeCanonicalBrowserBatch(requests);
    return new Promise((resolve, reject) => {
      const timeout = Number(
        globalThis.setTimeout(() => {
          const index = this.#pending.findIndex(batch => batch.requests === requests);
          if (index >= 0) {
            this.#pending.splice(index, 1);
          }
          reject(new Error("generation Worker response timed out"));
          this.#fail(new Error("generation Worker timed out"));
        }, this.#responseTimeoutMs),
      );
      this.#pending.push({ requests, resolve, reject, timeout });
      try {
        this.#port.postMessage(bytes.buffer, [bytes.buffer]);
      } catch (error) {
        this.#pending.pop();
        globalThis.clearTimeout(timeout);
        this.#sequencer.rollback(requests);
        reject(error);
      }
    });
  }

  async snapshot(): Promise<Uint8Array> {
    const [response] = await this.dispatch({ kind: "SNAPSHOT" });
    if (response?.response.kind !== "SNAPSHOT") {
      throw new Error("generation Worker snapshot failed");
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
      this.#port.removeEventListener("message", this.#onMessage);
      this.#port.removeEventListener("messageerror", this.#onMessageError);
      this.#worker.removeEventListener("error", this.#onWorkerError);
      this.#port.close();
      this.#worker.terminate();
      this.#rejectPending(new Error("generation Worker disposed"));
    }
  }

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    if (this.#disposed) {
      return;
    }
    const pending = this.#pending.shift();
    if (pending == null) {
      this.#fail(new Error("generation Worker emitted an unsolicited response"));
      return;
    }
    globalThis.clearTimeout(pending.timeout);
    try {
      if (
        !isArrayBufferV1(event.data)
        || event.data.byteLength === 0
        || event.data.byteLength > MAXIMUM_BROWSER_EFFECT_BYTES_V1
      ) {
        throw new Error("generation Worker returned invalid bytes");
      }
      const responses = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(event.data),
      ) as BrowserResponseEnvelopeV1[];
      this.#sequencer.accept(pending.requests, responses);
      pending.resolve(responses);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      pending.reject(failure);
      this.#fail(failure);
    }
  };

  readonly #onWorkerError = (event: ErrorEvent): void =>
    this.#fail(new Error(event.message || "generation Worker crashed"));
  readonly #onMessageError = (): void => this.#fail(new Error("generation Worker response could not be decoded"));

  #fail(error: Error): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#sequencer.dispose();
    this.#port.close();
    this.#worker.terminate();
    this.#rejectPending(error);
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.splice(0)) {
      globalThis.clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }
}

function isArrayBufferV1(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer || Object.prototype.toString.call(value) === "[object ArrayBuffer]";
}
