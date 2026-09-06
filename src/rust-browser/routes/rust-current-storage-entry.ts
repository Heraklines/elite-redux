/** Opt-in current Worker/IndexedDB composition. No production selector imports it. */
import { CurrentStorageRequestOwner, type CurrentStorageAcceptance } from "../adapters/current-storage-owner";
import { CurrentIndexedDbStorage, type CurrentStorageBackend } from "../adapters/current-storage-backend";
import { encodeCanonicalJsonV2, encodeBrowserRequestEnvelopeV2,
  type BrowserRequestV2, type BrowserResponseEnvelopeV2, type BrowserSessionInitializationV2,
  type GamePresentationEffectV2Wire } from "../contracts/browser-contracts-v2";
import { BrowserEffectRouterV2, type BrowserEffectAdaptersV2 } from "./browser-effects-v2";
import { createCurrentDevelopmentWorkerV2, CurrentWorkerRequestErrorV2 } from "./rust-current-worker-entry";
import type { CurrentWorkerAssetsV2 } from "../worker/rust-wasm-loader";

export { CurrentIndexedDbStorage } from "../adapters/current-storage-backend";
export { CurrentWorkerRequestErrorV2 } from "./rust-current-worker-entry";

const REQUEST_BYTES = 16 * 1024 * 1024;
const RESPONSE_BYTES = 32 * 1024 * 1024;
const OWNER_DEADLINE_MS = 10_000;
const MAX_PENDING = 16;
const PRESENTATION_BYTES = 2 * 1024 * 1024;
type ApplicationAdapters = Omit<BrowserEffectAdaptersV2, "handleStorageRequest" | "present" | "dispose">;
export interface CurrentStorageWorkerOptions {
  assets: CurrentWorkerAssetsV2;
  initialization: BrowserSessionInitializationV2;
  backend: CurrentStorageBackend;
  sessionIdentity: string;
  adapters: ApplicationAdapters;
  present(effect: GamePresentationEffectV2Wire, signal: AbortSignal): Promise<void>;
}

export class CurrentStorageDeliveryError extends Error {
  readonly acceptance = "ACCEPTED";
  constructor(readonly acceptedSequence: number, message: string) { super(message); }
}

/** Storage durable completion and presentation completion have independent owners.
 * A callback awaits transport acceptance only; the next wire operation waits for
 * the preceding effect batch. No adapter awaits nested effect routing.
 */
export class CurrentStorageWorker {
  readonly #client: ReturnType<typeof createCurrentDevelopmentWorkerV2>;
  readonly #storage: CurrentStorageRequestOwner;
  readonly #router: BrowserEffectRouterV2;
  readonly #abort = new AbortController();
  readonly #presentations = new Map<number, Promise<void>>();
  readonly #initialization: BrowserSessionInitializationV2;
  #wire: Promise<void> = Promise.resolve();
  #effects: Promise<void> = Promise.resolve();
  #pending = 0;
  #queuedBytes = 0;
  #responseBytes = 0;
  #presentationBytes = 0;
  #closed = false;
  #failure: Error | null = null;
  #initialized = false;
  #callbacksAccepted = 0;
  #presentationsSettled = 0;
  #disposePromise: Promise<{ acknowledged: boolean }> | null = null;

  constructor(options: CurrentStorageWorkerOptions) {
    // Own these before constructing the Worker or starting asynchronous work.
    this.#initialization = own(options.initialization);
    const assets = own(options.assets);
    const present = options.present;
    const application = { ...options.adapters };
    this.#storage = new CurrentStorageRequestOwner({ backend: options.backend,
      sessionIdentity: options.sessionIdentity, deliver: async (requestId, result): Promise<CurrentStorageAcceptance> => {
        try {
          await this.#send({ kind: "STORAGE_RESULT", request_id: requestId, result });
          this.#callbacksAccepted++;
          return "ACCEPTED";
        } catch (error) {
          if (error instanceof CurrentWorkerRequestErrorV2) return "REJECTED";
          if (error instanceof CurrentStorageDeliveryError) {
            this.#callbacksAccepted++;
            return "ACCEPTED"; // Known committed callback, failed local effect delivery.
          }
          this.#fence(error);
          return "UNKNOWN";
        }
      } });
    this.#router = new BrowserEffectRouterV2({
      renderUi: control => { this.#usable(); return application.renderUi(control); },
      changePresentationScene: semantic => { this.#usable(); return application.changePresentationScene(semantic); },
      sendNetworkFrame: (generation, bytes) => { this.#usable(); return application.sendNetworkFrame(generation, bytes); },
      requestAsset: asset => { this.#usable(); return application.requestAsset(asset); },
      playAudioCue: cue => { this.#usable(); return application.playAudioCue(cue); },
      showTerminal: terminal => { this.#usable(); return application.showTerminal(terminal); },
      recordTelemetry: event => { this.#usable(); return application.recordTelemetry(event); },
      publishRepro: (snapshot, inputs) => { this.#usable(); return application.publishRepro(snapshot, inputs); },
      publishCurrentRepro: bytes => { this.#usable(); return application.publishCurrentRepro(bytes); },
      handleStorageRequest: request => { this.#usable(); this.#storage.enqueue(request); },
      present: effect => {
        this.#usable();
        if (this.#presentations.size >= MAX_PENDING || this.#presentations.has(effect.event_id)) {
          throw new Error("current storage presentation ownership is full or duplicated");
        }
        const id = effect.event_id;
        const encoded = encodeCanonicalJsonV2(effect);
        if (encoded.length > PRESENTATION_BYTES - this.#presentationBytes) {
          throw new Error("current storage presentation bytes exceed their bound");
        }
        const size = encoded.length;
        const detached = JSON.parse(new TextDecoder().decode(encoded)) as GamePresentationEffectV2Wire;
        encoded.fill(0);
        this.#presentationBytes += size;
        const task = this.#bounded(Promise.resolve().then(() => {
          this.#usable();
          return present(detached, this.#abort.signal);
        }))
          .then(async () => {
            this.#usable();
            await this.#send({ kind: "PRESENTATION_SETTLED", event_id: id, outcome: { kind: "SETTLED" } });
            this.#presentationsSettled++;
          }).catch(error => { this.#fence(error); }).finally(() => {
            this.#presentations.delete(id);
            this.#presentationBytes -= size;
          });
        this.#presentations.set(id, task);
      },
      dispose: async () => {},
    });
    this.#client = createCurrentDevelopmentWorkerV2({ assets });
  }

  get status() {
    return { closed: this.#closed, fenced: this.#failure != null, pending: this.#pending,
      queuedBytes: this.#queuedBytes, responseBytes: this.#responseBytes,
      presentationBytes: this.#presentationBytes,
      pendingPresentations: this.#presentations.size, callbacksAccepted: this.#callbacksAccepted,
      presentationsSettled: this.#presentationsSettled, transport: this.#client.status };
  }

  storageProgress() { return this.#storage.progress(); }

  async initialize(): Promise<void> {
    if (this.#initialized) throw new Error("current storage Worker was already initialized");
    this.#initialized = true;
    await this.dispatch({ kind: "INITIALIZE", initialization: this.#initialization });
  }

  async dispatch(request: BrowserRequestV2): Promise<BrowserResponseEnvelopeV2> {
    const response = await this.#send(request);
    try { await this.#effects; this.#usable(); }
    catch (error) { throw new CurrentStorageDeliveryError(response.accepted_sequence, String(error)); }
    return response;
  }

  async drainStorage() {
    let previous: Promise<void>;
    do {
      previous = this.#effects;
      await previous;
      await this.#storage.drain();
      await this.#effects;
      this.#usable();
    } while (previous !== this.#effects);
    return this.#storage.progress();
  }

  async retryStorage(requestId: number) {
    this.#usable();
    this.#storage.retry(requestId);
    return this.drainStorage();
  }

  async drainPresentations(): Promise<void> {
    while (this.#presentations.size > 0) await Promise.all(this.#presentations.values());
    await this.#effects;
    this.#usable();
  }

  dispose(): Promise<{ acknowledged: boolean }> {
    if (this.#disposePromise != null) return this.#disposePromise;
    this.#closed = true;
    this.#abort.abort();
    // A live request/presentation cannot be claimed gracefully completed.
    const quiescent = this.#pending === 0 && this.#responseBytes === 0
      && this.#presentations.size === 0 && this.#failure == null
      && this.#storage.progress().every(entry => entry.phase === "ACKNOWLEDGED");
    this.#disposePromise = (async () => {
      let acknowledged = false;
      try {
        if (quiescent) {
          await deadline(this.#client.dispose());
          acknowledged = true;
        }
      } catch { /* Unconfirmed disposal remains unconfirmed. */ }
      finally {
        this.#client.terminate("current storage owner disposed");
        await Promise.allSettled([deadline(this.#storage.close()), deadline(this.#router.dispose())]);
        await Promise.allSettled([this.#wire, this.#effects, deadline(this.#storage.drain()), ...this.#presentations.values()]);
      }
      return { acknowledged };
    })();
    return this.#disposePromise;
  }

  #send(request: BrowserRequestV2): Promise<BrowserResponseEnvelopeV2> {
    this.#usable();
    const bytes = encodeBrowserRequestEnvelopeV2({ version: 2, request_id: Number.MAX_SAFE_INTEGER,
      sequence: Number.MAX_SAFE_INTEGER, request });
    if (this.#pending >= MAX_PENDING || bytes.length > REQUEST_BYTES - this.#queuedBytes) {
      throw new Error("current storage wire admission exceeds its bound");
    }
    const image = JSON.parse(new TextDecoder().decode(bytes)).request as BrowserRequestV2;
    const size = bytes.length;
    bytes.fill(0);
    this.#pending++;
    this.#queuedBytes += size;
    const result = this.#wire.then(async () => {
      await this.#effects;
      this.#usable();
      // Only one live response reservation exists. No callback can overtake a
      // prior effect batch; adapters only enqueue owned work and return.
      if (this.#responseBytes !== 0) throw new Error("current storage response reservation is occupied");
      this.#responseBytes = RESPONSE_BYTES;
      let response: BrowserResponseEnvelopeV2;
      // The Worker retains its established 120-second transport deadline.
      // Ten-second deadlines apply to external adapters, not Wasm initialization.
      try { response = await this.#untilAbort(this.#client.dispatch(image)); }
      catch (error) {
        this.#responseBytes = 0;
        if (!(error instanceof CurrentWorkerRequestErrorV2)) this.#fence(error);
        throw error;
      }
      try {
        this.#usable();
        // The response is now known ACCEPTED. A local publication failure can
        // never turn it into a retryable rejection or lose its reserved bytes.
        this.#effects = Promise.resolve().then(async () => {
          this.#usable();
          if (response.response.kind === "EFFECTS") await this.#bounded(this.#router.dispatch(response.response.batch));
        }).catch(error => { this.#fence(error); throw error; }).finally(() => { this.#responseBytes = 0; });
        void this.#effects.catch(() => {});
        return response;
      } catch (error) {
        this.#responseBytes = 0;
        this.#fence(error);
        throw new CurrentStorageDeliveryError(response.accepted_sequence, String(error));
      }
    });
    this.#wire = result.then(() => {}, () => {}).finally(() => {
      this.#pending--;
      this.#queuedBytes -= size;
    });
    return result;
  }

  #usable(): void {
    if (this.#closed || this.#failure != null) throw this.#failure ?? new Error("current storage owner is disposed");
  }

  #fence(error: unknown): void {
    this.#failure ??= error instanceof Error ? error : new Error(String(error));
    this.#abort.abort();
    this.#client.terminate("current storage acceptance or effect delivery is unconfirmed");
  }

  async #bounded<T>(promise: Promise<T>): Promise<T> {
    return deadline(this.#untilAbort(promise));
  }

  async #untilAbort<T>(promise: Promise<T>): Promise<T> {
    if (this.#abort.signal.aborted) {
      // An adapter may synchronously dispose during the invocation that created
      // this promise. Observe its eventual rejection even though ownership ended.
      void promise.catch(() => {});
      throw new Error("current storage owner aborted");
    }
    let rejectAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(new Error("current storage owner aborted"));
      this.#abort.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    try { return await Promise.race([promise, aborted]); }
    finally { this.#abort.signal.removeEventListener("abort", rejectAbort); }
  }
}

function own<T>(value: T): T {
  const bytes = encodeCanonicalJsonV2(value);
  if (bytes.length > REQUEST_BYTES) throw new Error("current storage configuration exceeds its bound");
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("current storage owner deadline exceeded")), OWNER_DEADLINE_MS);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
