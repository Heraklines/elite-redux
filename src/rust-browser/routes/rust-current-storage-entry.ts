/** Opt-in current Worker/IndexedDB composition. No production selector imports it. */
import { CurrentStorageRequestOwner, type CurrentStorageAcceptance,
  type CurrentStorageDeliveryGuard, type CurrentTitleCancellationEvidence } from "../adapters/current-storage-owner";
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

export interface CurrentTitlePendingIdentity {
  requestId: number;
  kind: "READ" | "LIST";
  slot: string | null;
  waitingMenu: number;
  waitingRevision: number;
}
class SuppressedTitleCallback extends Error {}
export class CurrentTitleInputStaleError extends Error {
  readonly acceptance = "NOT_SENT";
}
interface TitleView {
  sequence: number;
  stage: string;
  owner: number;
  replay: number;
  menu: number;
  revision: number;
  controlKind: string;
  nextPlatform: number;
  platformCount: number;
  emptyInventory: boolean;
  missingClear: boolean;
  pending: CurrentTitlePendingIdentity | null;
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
  readonly #titleEnabled: boolean;
  readonly #localSeat: number | null;
  #heldResponseBytes = 0;
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
    this.#titleEnabled = this.#initialization.kind === "NATURAL_START" && this.#initialization.existing_saves === true
      || this.#initialization.kind === "SNAPSHOT" && titleFromSnapshot(this.#initialization.snapshot, 0) != null;
    this.#localSeat = "context" in this.#initialization ? this.#initialization.context.local_seat : null;
    const assets = own(options.assets);
    const present = options.present;
    const application = { ...options.adapters };
    this.#storage = new CurrentStorageRequestOwner({ backend: options.backend,
      sessionIdentity: options.sessionIdentity, allowTitleCancellation: this.#titleEnabled,
      deliver: async (requestId, result, guard): Promise<CurrentStorageAcceptance> => {
        try {
          const response = await this.#sendStorageResult({ kind: "STORAGE_RESULT", request_id: requestId, result }, guard);
          if (response == null) return "SUPPRESSED_BY_CANCEL";
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
      queuedBytes: this.#queuedBytes, responseBytes: this.#responseBytes + this.#heldResponseBytes,
      presentationBytes: this.#presentationBytes,
      pendingPresentations: this.#presentations.size, callbacksAccepted: this.#callbacksAccepted,
      presentationsSettled: this.#presentationsSettled, transport: this.#client.status };
  }

  storageProgress() { return this.#storage.progress(); }
  storageRetirementStatus() { return this.#storage.retirementStatus; }

  async initialize(): Promise<void> {
    if (this.#initialized) throw new Error("current storage Worker was already initialized");
    this.#initialized = true;
    await this.dispatch({ kind: "INITIALIZE", initialization: this.#initialization });
  }

  async dispatch(request: BrowserRequestV2): Promise<BrowserResponseEnvelopeV2> {
    const response = request.kind === "RAW_INPUT" && this.#titleEnabled
      ? await this.#titleInput(request) : await this.#send(request);
    try { await this.#effects; this.#usable(); }
    catch (error) { throw new CurrentStorageDeliveryError(response.accepted_sequence, String(error)); }
    return response;
  }

  async drainStorage() {
    let previous: Promise<void>;
    do {
      previous = this.#effects;
      await previous;
      const progress = await this.#storage.drain();
      if (progress.some(entry => entry.cancellation != null && entry.phase === "FENCED")) {
        this.#fence(new Error("Title cancellation backend/work drain is unconfirmed"));
      }
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
    const quiescent = this.#pending === 0 && this.#responseBytes === 0 && this.#heldResponseBytes === 0
      && this.#presentations.size === 0 && this.#failure == null
      && this.#storage.progress().every(entry => entry.phase === "ACKNOWLEDGED" || entry.phase === "CANCELLED");
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

  async dispatchTitleInput(request: Extract<BrowserRequestV2, { kind: "RAW_INPUT" }>,
    expectedPending: CurrentTitlePendingIdentity): Promise<BrowserResponseEnvelopeV2> {
    if (!this.#titleEnabled) throw new CurrentTitleInputStaleError("Title storage is not enabled");
    const response = await this.#titleInput(request, own(expectedPending));
    try { await this.#effects; this.#usable(); }
    catch (error) { throw new CurrentStorageDeliveryError(response.accepted_sequence, String(error)); }
    return response;
  }

  #titleInput(request: Extract<BrowserRequestV2, { kind: "RAW_INPUT" }>, expected?: CurrentTitlePendingIdentity) {
    return this.#queue([{ kind: "SNAPSHOT" }, request, { kind: "SNAPSHOT" }], async images => {
      // Decide only after previous effects have enqueued their storage owner.
      if (expected == null && !this.#storage.hasReadOnlyWork) return this.#exchange(images[1]);
      const before = titleResponse(await this.#exchange(images[0]));
      if (expected != null && (before?.pending == null || !sameTitlePending(before.pending, expected))) {
        throw new CurrentTitleInputStaleError("the rendered Title request no longer owns this input");
      }
      const response = await this.#exchange(images[1]);
      if (before?.pending == null) return response;
      let held = 0;
      try {
        await this.#effects;
        this.#usable();
        // Retain only the caller's actual response; pre/post snapshots are
        // projected to bounded primitive ownership facts and then released.
        const bytes = encodeCanonicalJsonV2(response);
        held = bytes.length;
        bytes.fill(0);
        if (held >= RESPONSE_BYTES) throw new Error("Title response leaves no correlated snapshot budget");
        this.#heldResponseBytes = held;
        const after = titleResponse(await this.#exchange(images[2]));
        await this.#effects;
        this.#usable();
        if (after == null || response.accepted_sequence !== before.sequence + 1 || after.sequence !== response.accepted_sequence + 1) {
          throw new Error("Title input observation lost its lifecycle or wire correlation");
        }
        if (after?.stage === "TITLE" && after.pending == null && after.platformCount === 0) {
          const proof = titleCancellation(before, response.accepted_sequence, after, this.#localSeat);
          this.#storage.beginTitleReadOnlyRetirement(proof);
          if (this.#storage.retirementStatus.fenced) throw new Error("Title cancellation backend drain is unconfirmed");
        } else if (after.pending == null || !sameTitlePending(before.pending, after.pending)
          || after.nextPlatform !== before.nextPlatform || after.owner !== before.owner) {
          throw new Error("Title raw input changed pending ownership without exact cancellation evidence");
        }
        return response;
      } catch (error) {
        this.#fence(error);
        throw new CurrentStorageDeliveryError(response.accepted_sequence, `Title input accepted; retirement unconfirmed: ${String(error)}`);
      } finally {
        if (held > 0) this.#heldResponseBytes = 0;
      }
    });
  }

  #send(request: BrowserRequestV2): Promise<BrowserResponseEnvelopeV2> {
    return this.#queue([request], images => this.#exchange(images[0]));
  }

  #sendStorageResult(request: Extract<BrowserRequestV2, { kind: "STORAGE_RESULT" }>, guard: CurrentStorageDeliveryGuard) {
    return this.#queue([request], async images => {
      try { return await this.#exchange(images[0], () => guard.cancelled()); }
      catch (error) { if (error instanceof SuppressedTitleCallback) return null; throw error; }
    });
  }

  #queue<T>(requests: BrowserRequestV2[], task: (images: BrowserRequestV2[]) => Promise<T>): Promise<T> {
    this.#usable();
    if (requests.length < 1 || requests.length > 3) throw new Error("current storage wire task exceeds its bound");
    let size = 0;
    const images = requests.map(request => {
      const bytes = encodeBrowserRequestEnvelopeV2({ version: 2, request_id: Number.MAX_SAFE_INTEGER,
        sequence: Number.MAX_SAFE_INTEGER, request });
      size += bytes.length;
      try { return JSON.parse(new TextDecoder().decode(bytes)).request as BrowserRequestV2; }
      finally { bytes.fill(0); }
    });
    if (this.#pending >= MAX_PENDING || size > REQUEST_BYTES - this.#queuedBytes) {
      throw new Error("current storage wire admission exceeds its bound");
    }
    this.#pending++;
    this.#queuedBytes += size;
    const result = this.#wire.then(async () => {
      await this.#effects;
      this.#usable();
      return task(images);
    });
    this.#wire = result.then(() => {}, () => {}).finally(() => {
      this.#pending--;
      this.#queuedBytes -= size;
    });
    return result;
  }

  async #exchange(image: BrowserRequestV2, suppress?: () => boolean): Promise<BrowserResponseEnvelopeV2> {
    await this.#effects;
    this.#usable();
    if (suppress?.()) throw new SuppressedTitleCallback(); // Final guard, after awaits and before posting.
    if (this.#responseBytes !== 0) throw new Error("current storage response reservation is occupied");
    this.#responseBytes = RESPONSE_BYTES - this.#heldResponseBytes;
    let response: BrowserResponseEnvelopeV2;
    // Preserve the established 120-second Worker transport deadline.
    try { response = await this.#untilAbort(this.#client.dispatch(image)); }
    catch (error) {
      this.#responseBytes = 0;
      if (!(error instanceof CurrentWorkerRequestErrorV2)) this.#fence(error);
      throw error;
    }
    try {
      this.#usable();
      if (this.#heldResponseBytes > 0) {
        const bytes = encodeCanonicalJsonV2(response);
        const fits = bytes.length <= this.#responseBytes;
        bytes.fill(0);
        if (!fits) throw new Error("correlated Title responses exceed the existing aggregate response bound");
      }
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

function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) throw new Error("Title ownership record is invalid");
  return value as Record<string, unknown>;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("Title ownership integer is invalid");
  return value;
}
function titleResponse(response: BrowserResponseEnvelopeV2): TitleView | null {
  if (response.response.kind !== "SNAPSHOT") throw new Error("Title observation is not a correlated snapshot");
  return titleFromSnapshot(response.response.snapshot, response.accepted_sequence);
}
function titleFromSnapshot(value: unknown, sequence: number): TitleView | null {
  const snapshot = record(value);
  const lifecycle = record(snapshot.lifecycle);
  if (lifecycle.kind !== "BOOTSTRAP") return null;
  const bootstrap = record(lifecycle.value);
  if (bootstrap.current_storage == null) return null;
  const storage = record(bootstrap.current_storage);
  const control = record(bootstrap.control);
  if (snapshot.schema_version !== 7 || snapshot.protocol != null || snapshot.private_battle_control != null
    || !Array.isArray(snapshot.pending_platform) || !Array.isArray(storage.slots)
    || typeof bootstrap.stage !== "string" || typeof control.kind !== "string") {
    throw new Error("Title snapshot ownership shape is invalid");
  }
  const owner = integer(storage.owner_seat);
  const menu = integer(bootstrap.menu_instance_high_water);
  const revision = integer(control.revision);
  if (owner < 1 || menu < 1 || revision < 1 || control.owner_seat !== owner
    || record(control.menu).instance_id !== menu || record(control.menu).owner_seat !== owner) {
    throw new Error("Title control ownership differs");
  }
  const nextPlatform = integer(storage.next_platform_request_id);
  let pending: CurrentTitlePendingIdentity | null = null;
  if (storage.pending != null) {
    const owned = record(storage.pending);
    const kind = record(owned.kind);
    if (kind.kind !== "LIST" && kind.kind !== "READ") throw new Error("Title request is not read-only");
    const slot = kind.kind === "LIST" ? null : record(kind.value).slot;
    if (slot !== null && typeof slot !== "string") throw new Error("Title READ slot is invalid");
    pending = { requestId: integer(owned.request_id), kind: kind.kind, slot,
      waitingMenu: integer(owned.waiting_menu), waitingRevision: integer(owned.waiting_revision) };
    if (snapshot.pending_platform.length !== 1) throw new Error("Title pending platform is not singular");
    const platform = record(snapshot.pending_platform[0]);
    const effect = record(platform.effect);
    if (pending.requestId < 1 || nextPlatform !== pending.requestId + 1
      || pending.waitingMenu !== menu || pending.waitingRevision !== revision
      || integer(owned.source_menu) + 1 !== menu || integer(owned.source_revision) + 1 !== revision
      || platform.request_id !== pending.requestId || effect.request !== pending.requestId
      || effect.kind !== (pending.kind === "LIST" ? "STORAGE_LIST" : "STORAGE_READ")
      || (pending.kind === "READ" && effect.slot !== pending.slot)
      || bootstrap.stage !== (pending.kind === "LIST" ? "EXISTING_SAVE_LISTING" : "EXISTING_SAVE_LOADING")
      || control.kind !== "SAVE") throw new Error("Title pending intent/platform correspondence differs");
  }
  return { sequence, stage: bootstrap.stage, owner, replay: integer(snapshot.replay_sequence), menu, revision,
    controlKind: control.kind, nextPlatform, platformCount: snapshot.pending_platform.length,
    emptyInventory: storage.slots.length === 0, missingClear: storage.missing_slot === null, pending };
}
function sameTitlePending(left: CurrentTitlePendingIdentity, right: CurrentTitlePendingIdentity): boolean {
  return left.requestId === right.requestId && left.kind === right.kind && left.slot === right.slot
    && left.waitingMenu === right.waitingMenu && left.waitingRevision === right.waitingRevision;
}
function titleCancellation(before: TitleView, cancelSequence: number, after: TitleView,
  localSeat: number | null): CurrentTitleCancellationEvidence {
  const pending = before.pending;
  if (pending == null || before.owner !== localSeat || after.owner !== before.owner
    || after.stage !== "TITLE" || after.controlKind !== "TITLE" || after.pending != null
    || after.platformCount !== 0 || !after.emptyInventory || !after.missingClear
    || after.nextPlatform !== before.nextPlatform || after.menu !== before.menu + 1
    || after.revision !== before.revision + 1 || after.replay !== before.replay + 1
    || cancelSequence !== before.sequence + 1 || after.sequence !== cancelSequence + 1) {
    throw new Error("accepted input lacks exact correlated Title cancellation evidence");
  }
  return Object.freeze({ ...pending, preSequence: before.sequence, cancelSequence, postSequence: after.sequence,
    postMenu: after.menu, postRevision: after.revision, nextPlatformRequestId: after.nextPlatform,
    beforeReplay: before.replay, postReplay: after.replay });
}
