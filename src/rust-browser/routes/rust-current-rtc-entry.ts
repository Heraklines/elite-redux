import {
  type BrowserRequestV2, type BrowserResponseEnvelopeV2, type BrowserSessionContextV2, type BrowserSessionInitializationV2,
  type CurrentJsonObject, type GamePresentationEffectV2Wire, encodeCanonicalJsonV2,
} from "../contracts/browser-contracts-v2";
import { CurrentRtcTransportV1, type CurrentRtcIdentityV1 } from "../adapters/current-rtc-transport";
import { createCurrentDevelopmentWorkerV2, BrowserEffectRouterV2, CurrentWorkerRequestErrorV2, type CurrentRustBrowserHostV2 } from "./rust-current-worker-entry";
import type { CurrentWorkerAssetsV2 } from "../worker/rust-wasm-loader";

interface CurrentRtcPeerCommonOptionsV1 {
  assets: CurrentWorkerAssetsV2;
  identity: CurrentRtcIdentityV1;
  context: BrowserSessionContextV2;
  present(effect: GamePresentationEffectV2Wire, signal: AbortSignal): void | Promise<void>;
  frame?(direction: "sent" | "received", generation: number, bytes: Uint8Array): void;
}
export type CurrentRtcPeerOptionsV1 = CurrentRtcPeerCommonOptionsV1 & (
  | { checkpoint: CurrentJsonObject; natural_start?: never }
  | { checkpoint?: never; natural_start: { profile: CurrentJsonObject; seed: string;
      save_slots: string[]; local_is_host: boolean } }
);
interface PendingOperation {
  bytes: Uint8Array;
  timer: number;
  resolve(response: BrowserResponseEnvelopeV2): void;
  reject(error: Error): void;
}
/** This error means the kernel response already committed but effect delivery
 * failed. It must never cause automatic replay of the original input.
 */
export class CurrentRtcCommittedDeliveryError extends Error {
  readonly acceptance = "ACCEPTED";
  constructor(readonly accepted_sequence: number, reason: string) { super(reason); }
}

/** Additive development owner for an explicitly paired fixed-generation session.
 * Supports checkpoint restore and independent Title setup; no lobby discovery,
 * reconnect manager or production selector.
 */
export class CurrentDevelopmentRtcPeerV1 {
  readonly #options: CurrentRtcPeerOptionsV1;
  readonly #client: CurrentRustBrowserHostV2;
  readonly #router: BrowserEffectRouterV2;
  readonly #pc: RTCPeerConnection;
  readonly #abort = new AbortController();
  readonly #operations: PendingOperation[] = [];
  readonly #settlements: BrowserResponseEnvelopeV2[] = [];
  #transport: CurrentRtcTransportV1 | null = null;
  #operationCount = 0;
  #operationBytes = 0;
  #operationBusy = false;
  #operationTask: Promise<void> = Promise.resolve();
  #activeOperation: PendingOperation | null = null;
  #activeAcceptedSequence: number | null = null;
  #closed = false;
  #initialized = false;
  #initializing = false;
  #signalingStarted = false;
  #disposal: Promise<void> | null = null;
  #disposing = false;
  #disposeAcknowledged = false;
  #connectedEvents = 0;
  #disconnectedEvents = 0;
  #presentations = 0;
  #lastNetworkEffects: number | null = null;
  #reason: string | null = null;
  #deliveryFailure: { acceptance: "ACCEPTED"; accepted_sequence: number; message: string } | null = null;

  constructor(options: CurrentRtcPeerOptionsV1) {
    if (options.natural_start != null && options.checkpoint != null) throw new Error("current RTC binding does not match one initialization owner");
    const owned = encodeCanonicalJsonV2({ assets: options.assets, identity: options.identity,
      ...(options.natural_start == null ? { checkpoint: options.checkpoint } : { natural_start: options.natural_start }),
      context: options.context });
    try {
      if (owned.byteLength > 16 << 20) throw new Error("current RTC initial owner data exceeds16MiB");
      options = { ...JSON.parse(new TextDecoder().decode(owned)), present: options.present, frame: options.frame };
    } finally { owned.fill(0); }
    assertCheckpointBinding(options);
    this.#options = options;
    this.#pc = new RTCPeerConnection({ iceServers: [] });
    try { this.#client = createCurrentDevelopmentWorkerV2({ assets: options.assets }); }
    catch (error) { this.#pc.close(); throw error; }
    const unsupported = () => { throw new Error("external platform capability is outside current RTC checkpoint scope"); };
    this.#router = new BrowserEffectRouterV2({
      renderUi: () => {}, changePresentationScene: () => {}, requestAsset: () => {}, playAudioCue: () => {},
      recordTelemetry: () => {}, showTerminal: () => {}, handleStorageRequest: unsupported,
      publishRepro: unsupported, publishCurrentRepro: () => {}, dispose: () => {},
      present: async effect => {
        if (this.#settlements.length >= 16) throw new Error("current RTC deferred settlement count exceeds bound");
        const eventId = effect.event_id;
        const presented = structuredClone(effect);
        await boundedOperation(Promise.resolve().then(() => options.present(presented, this.#abort.signal)), this.#abort.signal);
        if (this.#closed) throw new Error("current RTC owner closed during presentation");
        // Deliberately bypass the outer effect-drain queue for transport only.
        // Route this response after that outer batch; never recursively await it.
        const settled = await this.#client.dispatch({ kind: "PRESENTATION_SETTLED", event_id: eventId,
          outcome: { kind: "SETTLED" } });
        if (settled.response.kind !== "EFFECTS" || settled.response.batch.effects.length !== 0) {
          throw new Error("current RTC settlement requires the current empty-effects completion contract");
        }
        this.#settlements.push(settled);
        this.#presentations++;
      },
      sendNetworkFrame: async (generation, bytes) => {
        const transport = this.#transport;
        if (transport == null) throw new Error("current RTC effect has no connected transport owner");
        await transport.send(generation, bytes);
        this.#observeFrame("sent", generation, bytes);
      },
    });
    this.#pc.addEventListener("datachannel", this.#onDataChannel);
  }

  get status() {
    return { closed: this.#closed, reason: this.#reason, initialized: this.#initialized,
      deliveryFailure: this.#deliveryFailure == null ? null : { ...this.#deliveryFailure },
      pending: this.#operationCount, queuedBytes: this.#operationBytes, disposeAcknowledged: this.#disposeAcknowledged,
      connectedEvents: this.#connectedEvents, disconnectedEvents: this.#disconnectedEvents,
      settledPresentations: this.#presentations, lastNetworkEffects: this.#lastNetworkEffects, worker: this.#client.status,
      rtc: this.#transport?.status ?? null, peerConnectionState: this.#pc.connectionState };
  }

  async initialize(): Promise<BrowserResponseEnvelopeV2> {
    if (this.#initialized || this.#initializing || this.#closed) throw new Error("current RTC checkpoint is already owned or closed");
    this.#initializing = true;
    try {
      const initialization: BrowserSessionInitializationV2 = this.#options.natural_start == null
        ? { kind: "SNAPSHOT", context: this.#options.context, snapshot: this.#options.checkpoint }
        : { kind: "NATURAL_COOP", context: this.#options.context, ...this.#options.natural_start };
      const response = await this.#enqueue({ kind: "INITIALIZE", initialization });
      this.#initialized = true;
      return response;
    } finally { this.#initializing = false; }
  }

  dispatch(request: BrowserRequestV2): Promise<BrowserResponseEnvelopeV2> {
    if (this.#disposing || !this.#initialized || !["SNAPSHOT", "EXPORT_REPRO", "RAW_INPUT", "ADVANCE_TIME", "RETRY_COOP_SETUP"].includes(request.kind)) {
      return Promise.reject(new Error("current RTC external request is outside its initialized raw/time/setup-retry/snapshot/export scope"));
    }
    if (!["SNAPSHOT", "EXPORT_REPRO"].includes(request.kind) && !this.#transport?.status.connected) {
      return Promise.reject(new Error("current RTC gameplay requires its admitted peer connection"));
    }
    return this.#enqueue(request);
  }

  /** Return this Worker's complete current capture to the caller. Export is
   * read-only and remains available after transport closure. No upload occurs.
   */
  async exportRepro(): Promise<Uint8Array> {
    const response = await this.dispatch({ kind: "EXPORT_REPRO" });
    if (response.response.kind !== "EFFECTS" || response.response.batch.effects.length !== 1
      || response.response.batch.effects[0].kind !== "CURRENT_REPRO_READY") {
      throw new Error("current RTC export did not return its sole current capsule");
    }
    return Uint8Array.from(response.response.batch.effects[0].capsule_bytes);
  }

  #enqueue(request: BrowserRequestV2): Promise<BrowserResponseEnvelopeV2> {
    if (this.#closed || this.#operationCount >= 16) return Promise.reject(new Error("current RTC operation owner is closed or full"));
    let bytes: Uint8Array;
    try {
      bytes = encodeCanonicalJsonV2(request);
      if (bytes.byteLength > (16 << 20) - this.#operationBytes) {
        bytes.fill(0);
        throw new Error("current RTC operation aggregate exceeds16MiB");
      }
    } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      this.#operationCount++;
      this.#operationBytes += bytes.byteLength;
      const timer = Number(setTimeout(() => this.#fail(new Error("current RTC operation deadline exceeded; acceptance may be unknown")), 120_000));
      this.#operations.push({ bytes, timer, resolve, reject });
      if (!this.#operationBusy) this.#operationTask = this.#pumpOperations();
    });
  }

  async offer(): Promise<string> {
    this.#startSignaling();
    const channel = this.#pc.createDataChannel("er-current-development-v2", { ordered: true, protocol: "er-current-v2" });
    try {
      await boundedOperation(this.#pc.setLocalDescription(await boundedOperation(this.#pc.createOffer(), this.#abort.signal)), this.#abort.signal);
      await this.#waitIce();
      // Local offer preparation has its own bounded signaling operations. No
      // peer can open this channel before the returned SDP is answered. Attach
      // now so its unchanged handshake deadline covers the peer exchange.
      this.#attach(channel);
      return boundedSdp(this.#pc.localDescription?.sdp);
    } catch (error) { this.#fail(error); throw error; }
  }
  async answer(sdp: string): Promise<string> {
    this.#startSignaling();
    try {
      await boundedOperation(this.#pc.setRemoteDescription({ type: "offer", sdp: boundedSdp(sdp) }), this.#abort.signal);
      await boundedOperation(this.#pc.setLocalDescription(await boundedOperation(this.#pc.createAnswer(), this.#abort.signal)), this.#abort.signal);
      await this.#waitIce();
      return boundedSdp(this.#pc.localDescription?.sdp);
    } catch (error) { this.#fail(error); throw error; }
  }
  async accept(sdp: string): Promise<void> {
    if (!this.#signalingStarted || this.#closed || this.#transport == null) throw new Error("current RTC offer is not owned");
    try { await boundedOperation(this.#pc.setRemoteDescription({ type: "answer", sdp: boundedSdp(sdp) }), this.#abort.signal); }
    catch (error) { this.#fail(error); throw error; }
  }
  async ready(): Promise<void> {
    if (this.#transport == null) {
      await boundedCondition(() => this.#transport != null, this.#pc, "datachannel", this.#abort.signal);
    }
    if (this.#transport == null) throw new Error("current RTC channel was not attached");
    await this.#transport.ready();
  }

  /** Explicit byte retransmission on this fixed transport, not input reexecution
   * or an assertion that any peer applied the payload. Useful for duplicate proof.
   */
  sendFrame(generation: number, bytes: Uint8Array): Promise<void> {
    if (this.#closed || this.#disposing || this.#transport == null) return Promise.reject(new Error("current RTC transport is unavailable"));
    const admission = this.#transport.status;
    if (admission.closed || generation !== 1 || bytes.byteLength === 0 || bytes.byteLength > 1 << 20
      || admission.sendPending >= 16 || bytes.byteLength > (2 << 20) - admission.sendBytes) {
      return Promise.reject(new Error("current RTC frame cannot enter bounded generation1 queue"));
    }
    const owned = Uint8Array.from(bytes);
    return this.#transport.send(generation, owned)
      .then(() => { this.#observeFrame("sent", generation, owned); })
      .finally(() => { owned.fill(0); });
  }

  async closeTransport(): Promise<void> {
    this.#transport?.close("current RTC channel closed by owner");
    this.#pc.close();
    await this.#transport?.disposed();
  }

  dispose(): Promise<void> {
    if (this.#disposal != null) return this.#disposal;
    this.#disposal = this.#dispose();
    return this.#disposal;
  }
  async #dispose(): Promise<void> {
    this.#disposing = true;
    if (this.#activeOperation != null) this.#fail(new Error("current RTC disposed with an active operation; completion is not confirmed"));
    this.#pc.removeEventListener("datachannel", this.#onDataChannel);
    let issue: unknown;
    try { await boundedOperation(this.closeTransport()); } catch (error) { issue = error; }
    this.#closed = true;
    this.#abort.abort();
    this.#rejectQueued("current RTC peer disposed");
    try {
      if (this.#client.status.closed) throw new Error("current RTC Worker was fenced before logical Dispose acknowledgement");
      await boundedOperation(this.#client.dispose());
      this.#disposeAcknowledged = true;
    } catch (error) { issue ??= error; }
    finally {
      this.#client.terminate();
      this.#settlements.splice(0);
      this.#pc.close();
      try { await boundedOperation(this.#operationTask); } catch (error) { issue ??= error; }
      await this.#router.dispose();
    }
    if (issue != null) throw issue;
  }

  #startSignaling(): void {
    if (!this.#initialized || this.#signalingStarted || this.#closed) throw new Error("current RTC signaling requires one initialized checkpoint");
    this.#signalingStarted = true;
  }
  readonly #onDataChannel = (event: RTCDataChannelEvent): void => {
    try { this.#attach(event.channel); }
    catch (error) { event.channel.close(); this.#fail(error); }
  };
  #attach(channel: RTCDataChannel): void {
    if (this.#transport != null || this.#closed) { channel.close(); throw new Error("current RTC pair already owns its single channel"); }
    this.#transport = new CurrentRtcTransportV1({ channel, identity: this.#options.identity,
      negotiatedMaximumMessageBytes: () => this.#pc.sctp?.maxMessageSize,
      connected: async () => { await this.#enqueue({ kind: "TRANSPORT_CHANGED", generation: 1, connected: true }); this.#connectedEvents++; },
      receive: async (generation, bytes) => {
        this.#observeFrame("received", generation, bytes);
        const response = await this.#enqueue({ kind: "NETWORK_FRAME", generation, bytes: Array.from(bytes) });
        if (response.response.kind !== "EFFECTS") throw new Error("current RTC network response is not an effect batch");
        this.#lastNetworkEffects = response.response.batch.effects.length;
      },
      disconnected: async () => {
        if (this.#closed) throw new Error("current RTC disconnected event could not reach its closed Worker owner");
        await this.#enqueue({ kind: "TRANSPORT_CHANGED", generation: 1, connected: false });
        this.#disconnectedEvents++;
      },
    });
  }

  async #pumpOperations(): Promise<void> {
    if (this.#operationBusy || this.#closed) return;
    this.#operationBusy = true;
    try {
      while (!this.#closed && this.#operations.length > 0) {
        const pending = this.#operations.shift()!;
        this.#activeOperation = pending;
        let accepted: number | null = null;
        try {
          const request = JSON.parse(new TextDecoder().decode(pending.bytes)) as BrowserRequestV2;
          const response = await this.#client.dispatch(request);
          accepted = response.accepted_sequence;
          this.#activeAcceptedSequence = accepted;
          if (response.response.kind === "EFFECTS") await boundedOperation(this.#router.dispatch(response.response.batch), this.#abort.signal);
          while (this.#settlements.length > 0) {
            const settlement = this.#settlements.shift()!;
            if (settlement.response.kind !== "EFFECTS") throw new Error("current RTC deferred settlement shape changed");
            await boundedOperation(this.#router.dispatch(settlement.response.batch), this.#abort.signal);
          }
          if (this.#closed) throw new Error("current RTC owner fenced before operation publication");
          pending.resolve(response);
        } catch (error) {
          const failure = accepted == null ? error : new CurrentRtcCommittedDeliveryError(accepted,
            `current RTC effect delivery failed after kernel acceptance: ${error instanceof Error ? error.message : String(error)}`);
          pending.reject(failure instanceof Error ? failure : new Error(String(failure)));
          if (accepted != null || !(error instanceof CurrentWorkerRequestErrorV2)) this.#fail(error);
        } finally {
          clearTimeout(pending.timer);
          this.#activeOperation = null;
          this.#activeAcceptedSequence = null;
          this.#operationCount--;
          this.#operationBytes -= pending.bytes.byteLength;
          pending.bytes.fill(0);
        }
      }
    } finally { this.#operationBusy = false; }
  }
  #observeFrame(direction: "sent" | "received", generation: number, bytes: Uint8Array): void {
    if (this.#options.frame == null) return;
    const copy = Uint8Array.from(bytes);
    try { this.#options.frame(direction, generation, copy); } finally { copy.fill(0); }
  }
  #rejectQueued(reason: string): void {
    for (const pending of this.#operations.splice(0)) {
      clearTimeout(pending.timer);
      this.#operationCount--;
      this.#operationBytes -= pending.bytes.byteLength;
      pending.bytes.fill(0);
      pending.reject(new Error(reason));
    }
  }
  #fail(error: unknown): void {
    if (this.#closed) return;
    this.#reason = (error instanceof Error ? error.message : String(error)).slice(0, 512);
    if (this.#activeAcceptedSequence != null) this.#deliveryFailure = {
      acceptance: "ACCEPTED", accepted_sequence: this.#activeAcceptedSequence, message: this.#reason,
    };
    this.#closed = true;
    this.#abort.abort();
    this.#transport?.close(this.#reason);
    this.#pc.close();
    this.#client.terminate("current RTC route fenced; pending kernel acceptance may be unknown");
    this.#activeOperation?.reject(this.#activeAcceptedSequence == null ? new Error(this.#reason)
      : new CurrentRtcCommittedDeliveryError(this.#activeAcceptedSequence, this.#reason));
    this.#rejectQueued(this.#reason);
    void this.#router.dispose().catch(() => {});
  }
  #waitIce(): Promise<void> {
    return boundedCondition(() => this.#pc.iceGatheringState === "complete", this.#pc,
      "icegatheringstatechange", this.#abort.signal);
  }
}

function assertCheckpointBinding(options: CurrentRtcPeerOptionsV1): void {
  const natural = options.natural_start != null;
  const protocol = (natural ? options.context.protocol : options.checkpoint?.protocol) as CurrentJsonObject | null;
  const frame = (protocol?.frame_context as CurrentJsonObject | undefined)?.context as CurrentJsonObject | undefined;
  const connections = protocol?.connections;
  const rebinds = protocol?.staged_rebinds;
  const peer = Array.isArray(connections) ? connections[0] as CurrentJsonObject : null;
  if ((!natural && options.checkpoint?.schema_version !== 7)
    || (natural && (options.checkpoint != null || options.natural_start?.local_is_host !== (options.context.role === "AUTHORITY")))
    || options.context.local_seat !== options.identity.local_seat
    || options.assets.content_sha256 !== options.identity.content_sha256 || options.identity.generation !== 1
    || options.context.role !== protocol?.role || frame?.sessionId !== options.identity.session_id
    || frame?.runId !== options.identity.run_id || frame?.authoritySeatId !== options.identity.authority_seat
    || frame?.sessionEpoch !== options.identity.session_epoch || frame?.seatMapId !== options.identity.seat_map_id
    || frame?.membershipRevision !== options.identity.membership_revision
    || frame?.senderSeatId !== options.identity.local_seat || frame?.connectionGeneration !== 1
    || !Array.isArray(connections) || connections.length !== 1
    || !Array.isArray(rebinds) || rebinds.length !== 0
    || protocol?.authority_rebind_pending !== false
    || peer?.peer_seat !== options.identity.peer_seat || peer?.generation !== 1
    || options.context.role !== (options.identity.local_seat === options.identity.authority_seat ? "AUTHORITY" : "REPLICA")) {
    throw new Error("current RTC binding does not match the declared current checkpoint context");
  }
}
function boundedSdp(value: string | undefined): string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).byteLength > 128 << 10) {
    throw new Error("current RTC SDP is absent or oversized");
  }
  return value;
}
function boundedCondition(ready: () => boolean, target: EventTarget, event: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new Error("current RTC signaling canceled"));
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); target.removeEventListener(event, check); signal.removeEventListener("abort", abort); };
    const check = () => { if (ready()) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(new Error("current RTC signaling canceled")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("current RTC signaling deadline exceeded")); }, 15_000);
    target.addEventListener(event, check); signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort(); else check();
  });
}

function boundedOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new Error("current RTC operation canceled")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("current RTC bounded operation deadline exceeded")); }, 15_000);
    signal?.addEventListener("abort", abort, { once: true });
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) abort();
  });
}
