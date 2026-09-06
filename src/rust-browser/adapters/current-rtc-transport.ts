import { encodeCanonicalJsonV2, safeCurrentInteger } from "../contracts/browser-contracts-v2";

export interface CurrentRtcIdentityV1 {
  source_sha: string;
  content_sha256: string;
  worker_sha256: string;
  session_id: string;
  run_id: string;
  session_epoch: number;
  seat_map_id: string;
  membership_revision: number;
  authority_seat: number;
  local_seat: number;
  peer_seat: number;
  generation: 1;
}
export interface CurrentRtcTransportOptionsV1 {
  channel: RTCDataChannel;
  identity: CurrentRtcIdentityV1;
  negotiatedMaximumMessageBytes(): number | undefined;
  connected(): Promise<void>;
  receive(generation: 1, bytes: Uint8Array): Promise<void>;
  disconnected(reason: string): Promise<void>;
  deadlineMs?: number;
}
interface QueuedFrame {
  bytes: Uint8Array;
  resolve(): void;
  reject(error: Error): void;
}
const MAXIMUM_FRAME_BYTES = 1 << 20;
const MAXIMUM_QUEUED_BYTES = 2 << 20;
const MAXIMUM_QUEUED_FRAMES = 16;
const MAXIMUM_BUFFERED_BYTES = 2 << 20;
const MAXIMUM_HELLO_BYTES = 4096;

/** Fixed-generation, manually bound development RTC transport. Successful send
 * means local RTC buffering only. It never acknowledges remote kernel acceptance.
 */
export class CurrentRtcTransportV1 {
  readonly #options: CurrentRtcTransportOptionsV1;
  readonly #identity: CurrentRtcIdentityV1;
  readonly #abort = new AbortController();
  readonly #sendQueue: QueuedFrame[] = [];
  readonly #receiveQueue: Uint8Array[] = [];
  readonly #deadlineMs: number;
  readonly #ready: Promise<void>;
  #resolveReady!: () => void;
  #rejectReady!: (error: Error) => void;
  #sendBusy = false;
  #receiveBusy = false;
  #sendTask: Promise<void> = Promise.resolve();
  #receiveTask: Promise<void> = Promise.resolve();
  #sendBytes = 0;
  #receiveBytes = 0;
  #sendCount = 0;
  #receiveCount = 0;
  #helloSent = false;
  #helloReceived = false;
  #connected = false;
  #disconnectReported = false;
  #disconnect: Promise<void> = Promise.resolve();
  #closed = false;
  #reason: string | null = null;
  #maximumFrame = 0;
  #sent = 0;
  #received = 0;
  #delivered = 0;
  #maximumObservedFrame = 0;
  #handshakeTimer: number;

  constructor(options: CurrentRtcTransportOptionsV1) {
    this.#options = { ...options, identity: { ...options.identity } };
    this.#identity = { ...options.identity };
    this.#deadlineMs = options.deadlineMs ?? 15_000;
    this.#ready = new Promise((resolve, reject) => { this.#resolveReady = resolve; this.#rejectReady = reject; });
    void this.#ready.catch(() => {});
    this.#handshakeTimer = 0;
    try {
      validateIdentity(this.#identity);
      const channel = options.channel;
      if (!Number.isSafeInteger(this.#deadlineMs) || this.#deadlineMs < 1 || this.#deadlineMs > 30_000
        || !channel.ordered || channel.maxRetransmits != null || channel.maxPacketLifeTime != null
        || channel.label !== "er-current-development-v2" || channel.protocol !== "er-current-v2") {
        throw new Error("current RTC channel or deadline does not match the fixed reliable contract");
      }
      channel.binaryType = "arraybuffer";
      channel.addEventListener("open", this.#onOpen);
      channel.addEventListener("message", this.#onMessage);
      channel.addEventListener("close", this.#onClose);
      channel.addEventListener("error", this.#onError);
      this.#handshakeTimer = Number(setTimeout(() => this.close("current RTC handshake deadline exceeded"), this.#deadlineMs));
      if (channel.readyState === "open") this.#onOpen();
      else if (channel.readyState !== "connecting") this.close("current RTC channel is already closed");
    } catch (error) {
      this.close(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  get status() {
    return { closed: this.#closed, connected: this.#connected, reason: this.#reason,
      sendPending: this.#sendCount, receivePending: this.#receiveCount,
      sendBytes: this.#sendBytes, receiveBytes: this.#receiveBytes,
      sentFrames: this.#sent, receivedFrames: this.#received, kernelDeliveredFrames: this.#delivered,
      maximumFrameBytes: this.#maximumFrame, maximumObservedFrameBytes: this.#maximumObservedFrame,
      bufferedAmount: this.#options.channel.bufferedAmount };
  }
  ready(): Promise<void> { return this.#ready; }

  send(generation: number, input: Uint8Array): Promise<void> {
    if (this.#closed || generation !== this.#identity.generation || input.byteLength === 0
      || input.byteLength > MAXIMUM_FRAME_BYTES || this.#sendCount >= MAXIMUM_QUEUED_FRAMES
      || input.byteLength > MAXIMUM_QUEUED_BYTES - this.#sendBytes) {
      return Promise.reject(new Error(`current RTC frame cannot enter bounded generation1 queue (${input.byteLength} bytes)`));
    }
    const bytes = Uint8Array.from(input);
    return new Promise((resolve, reject) => {
      this.#sendBytes += bytes.byteLength;
      this.#sendCount++;
      this.#sendQueue.push({ bytes, resolve, reject });
      if (!this.#sendBusy) this.#sendTask = this.#pumpSend();
    });
  }

  close(reason = "current RTC transport disposed"): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#reason = reason.slice(0, 512);
    clearTimeout(this.#handshakeTimer);
    this.#abort.abort();
    const channel = this.#options.channel;
    channel.removeEventListener("open", this.#onOpen);
    channel.removeEventListener("message", this.#onMessage);
    channel.removeEventListener("close", this.#onClose);
    channel.removeEventListener("error", this.#onError);
    this.#rejectReady(new Error(this.#reason));
    for (const pending of this.#sendQueue.splice(0)) {
      this.#sendBytes -= pending.bytes.byteLength;
      this.#sendCount--;
      pending.bytes.fill(0);
      pending.reject(new Error(this.#reason));
    }
    for (const bytes of this.#receiveQueue.splice(0)) {
      this.#receiveBytes -= bytes.byteLength;
      this.#receiveCount--;
      bytes.fill(0);
    }
    if (channel.readyState !== "closed") channel.close();
    this.#reportDisconnected();
  }

  async disposed(): Promise<void> {
    this.close();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([this.#sendTask, this.#receiveTask]).then(() => this.#disconnect),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("current RTC disposal drain deadline exceeded")), this.#deadlineMs); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  #reportDisconnected(): void {
    if (!this.#connected || this.#disconnectReported) return;
    this.#disconnectReported = true;
    this.#connected = false;
    this.#disconnect = Promise.resolve().then(() => this.#options.disconnected(this.#reason ?? "current RTC closed"));
    // Preserve a rejecting disposal promise for the owner; no detached rejection.
    void this.#disconnect.catch(() => {});
  }

  readonly #onOpen = (): void => {
    if (this.#closed || this.#helloSent) return;
    try {
      const maximum = this.#options.negotiatedMaximumMessageBytes();
      if (!safeCurrentInteger(maximum) || maximum < MAXIMUM_HELLO_BYTES) {
        throw new Error("current RTC negotiated SCTP message bound is unavailable or too small");
      }
      this.#maximumFrame = Math.min(maximum, MAXIMUM_FRAME_BYTES);
      const bytes = encodeCanonicalJsonV2({ kind: "CURRENT_RTC_HELLO", schema_version: 1,
        browser_worker_protocol: 2, ...this.#identity });
      if (bytes.byteLength > MAXIMUM_HELLO_BYTES) throw new Error("current RTC identity exceeds handshake bound");
      this.#options.channel.send(Uint8Array.from(bytes).buffer);
      bytes.fill(0);
      this.#helloSent = true;
    } catch (error) { this.close(error instanceof Error ? error.message : String(error)); }
  };
  readonly #onClose = (): void => { this.close("current RTC channel closed"); };
  readonly #onError = (): void => { this.close("current RTC channel failed"); };
  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    if (this.#closed) return;
    if (!this.#helloSent) this.#onOpen();
    if (this.#closed) return;
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength === 0
      || event.data.byteLength > MAXIMUM_FRAME_BYTES || this.#receiveCount >= MAXIMUM_QUEUED_FRAMES
      || event.data.byteLength > MAXIMUM_QUEUED_BYTES - this.#receiveBytes) {
      this.close("current RTC receive admission exceeds type/count/byte bounds");
      return;
    }
    this.#receiveCount++;
    this.#receiveBytes += event.data.byteLength;
    this.#receiveQueue.push(Uint8Array.from(new Uint8Array(event.data)));
    if (!this.#receiveBusy) this.#receiveTask = this.#pumpReceive();
  };

  async #pumpReceive(): Promise<void> {
    if (this.#receiveBusy || this.#closed) return;
    this.#receiveBusy = true;
    try {
      while (!this.#closed && this.#receiveQueue.length > 0) {
        const bytes = this.#receiveQueue.shift()!;
        try {
          if (!this.#helloReceived) {
            assertPeerHello(bytes, this.#identity);
            this.#helloReceived = true;
            await this.#options.connected();
            this.#connected = true;
            if (this.#closed) { this.#reportDisconnected(); return; }
            clearTimeout(this.#handshakeTimer);
            this.#resolveReady();
          } else {
            if (!this.#connected || bytes.byteLength > this.#maximumFrame) {
              throw new Error(`current RTC received unsupported single frame (${bytes.byteLength}/${this.#maximumFrame} bytes)`);
            }
            this.#received++;
            await this.#options.receive(1, bytes);
            this.#delivered++;
            this.#maximumObservedFrame = Math.max(this.#maximumObservedFrame, bytes.byteLength);
          }
        } finally {
          this.#receiveBytes -= bytes.byteLength;
          this.#receiveCount--;
          bytes.fill(0);
        }
      }
    } catch (error) { this.close(error instanceof Error ? error.message : String(error)); }
    finally { this.#receiveBusy = false; }
  }

  async #pumpSend(): Promise<void> {
    if (this.#sendBusy || this.#closed) return;
    this.#sendBusy = true;
    try {
      await this.#ready;
      while (!this.#closed && this.#sendQueue.length > 0) {
        const pending = this.#sendQueue.shift()!;
        try {
          if (pending.bytes.byteLength > this.#maximumFrame) {
            throw new Error(`current RTC single frame exceeds negotiated bound (${pending.bytes.byteLength}/${this.#maximumFrame} bytes); fragmentation unsupported`);
          }
          await this.#waitForBuffer(pending.bytes.byteLength);
          if (this.#closed || this.#options.channel.readyState !== "open") throw new Error("current RTC send owner closed");
          this.#options.channel.send(Uint8Array.from(pending.bytes).buffer);
          this.#sent++;
          this.#maximumObservedFrame = Math.max(this.#maximumObservedFrame, pending.bytes.byteLength);
          pending.resolve();
        } catch (error) {
          pending.reject(error instanceof Error ? error : new Error(String(error)));
          throw error;
        } finally {
          this.#sendBytes -= pending.bytes.byteLength;
          this.#sendCount--;
          pending.bytes.fill(0);
        }
      }
    } catch (error) { this.close(error instanceof Error ? error.message : String(error)); }
    finally { this.#sendBusy = false; }
  }

  #waitForBuffer(length: number): Promise<void> {
    const channel = this.#options.channel;
    const available = () => channel.bufferedAmount <= MAXIMUM_BUFFERED_BYTES - length;
    if (this.#closed) return Promise.reject(new Error("current RTC transport closed during send"));
    if (available()) return Promise.resolve();
    channel.bufferedAmountLowThreshold = MAXIMUM_BUFFERED_BYTES - length;
    return new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); channel.removeEventListener("bufferedamountlow", wake);
        this.#abort.signal.removeEventListener("abort", aborted); };
      const wake = () => { if (available()) { cleanup(); resolve(); } };
      const aborted = () => { cleanup(); reject(new Error("current RTC buffer wait canceled")); };
      const timer = setTimeout(() => { cleanup(); reject(new Error("current RTC buffer deadline exceeded")); }, this.#deadlineMs);
      channel.addEventListener("bufferedamountlow", wake);
      this.#abort.signal.addEventListener("abort", aborted, { once: true });
      if (this.#abort.signal.aborted) aborted(); else wake();
    });
  }
}

function validateIdentity(identity: CurrentRtcIdentityV1): void {
  if (Object.keys(identity).sort().join(",") !== "authority_seat,content_sha256,generation,local_seat,membership_revision,peer_seat,run_id,seat_map_id,session_epoch,session_id,source_sha,worker_sha256"
    || !/^[0-9a-f]{40}$/u.test(identity.source_sha) || !/^[0-9a-f]{64}$/u.test(identity.content_sha256)
    || !/^[0-9a-f]{64}$/u.test(identity.worker_sha256) || identity.generation !== 1
    || !safeCurrentInteger(identity.authority_seat) || identity.authority_seat === 0
    || !safeCurrentInteger(identity.local_seat) || identity.local_seat === 0
    || !safeCurrentInteger(identity.peer_seat) || identity.peer_seat === 0
    || identity.local_seat === identity.peer_seat
    || ![identity.local_seat, identity.peer_seat].includes(identity.authority_seat)
    || !safeCurrentInteger(identity.session_epoch) || !safeCurrentInteger(identity.membership_revision)
    || typeof identity.seat_map_id !== "string" || identity.seat_map_id.length < 1 || identity.seat_map_id.length > 128
    || typeof identity.session_id !== "string" || identity.session_id.length < 1 || identity.session_id.length > 128
    || typeof identity.run_id !== "string" || identity.run_id.length < 1 || identity.run_id.length > 128) {
    throw new Error("current RTC identity is not a bounded two-seat generation1 binding");
  }
}
function assertPeerHello(bytes: Uint8Array, identity: CurrentRtcIdentityV1): void {
  if (bytes.byteLength > MAXIMUM_HELLO_BYTES) throw new Error("current RTC peer handshake exceeds bound");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const expected = { kind: "CURRENT_RTC_HELLO", schema_version: 1, browser_worker_protocol: 2,
    ...identity, local_seat: identity.peer_seat, peer_seat: identity.local_seat };
  if (new TextDecoder().decode(encodeCanonicalJsonV2(value)) !== new TextDecoder().decode(encodeCanonicalJsonV2(expected))) {
    throw new Error("current RTC peer identity mismatch");
  }
}
