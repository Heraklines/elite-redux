import type { BrowserRequestV1 } from "../contracts/browser-contracts";
import { ConnectionGenerationV1 } from "./connection-generation";
import {
  assertCompatibleRustPeer,
  type BrowserKernelCompatibilityV1,
  encodeCompatibilityHandshake,
} from "./signaling-adapter";

const MAXIMUM_DIRECT_FRAME_BYTES = 1_048_576;

export interface RustBrowserTransportOptionsV1 {
  compatibility: BrowserKernelCompatibilityV1;
  emit(request: BrowserRequestV1): void;
}

export class RustBrowserTransportAdapterV1 {
  readonly #compatibility: BrowserKernelCompatibilityV1;
  readonly #emit: (request: BrowserRequestV1) => void;
  readonly #generations = new ConnectionGenerationV1();
  #channel: RTCDataChannel | null = null;
  #handshakeAccepted = false;
  #disposed = false;

  constructor(options: RustBrowserTransportOptionsV1) {
    this.#compatibility = options.compatibility;
    this.#emit = options.emit;
  }

  attach(channel: RTCDataChannel): number {
    if (this.#disposed) {
      throw new Error("Rust browser transport is disposed");
    }
    this.#detach(true);
    const generation = this.#generations.advance();
    this.#channel = channel;
    this.#handshakeAccepted = false;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", this.#onOpen);
    channel.addEventListener("message", this.#onMessage);
    channel.addEventListener("close", this.#onClose);
    channel.addEventListener("error", this.#onError);
    if (channel.readyState === "open") {
      this.#onOpen();
    }
    return generation;
  }

  send(generation: number, bytes: Uint8Array): void {
    if (
      this.#disposed
      || !this.#generations.accepts(generation)
      || !this.#handshakeAccepted
      || this.#channel?.readyState !== "open"
      || bytes.byteLength === 0
      || bytes.byteLength > MAXIMUM_DIRECT_FRAME_BYTES
    ) {
      throw new Error("Rust browser network frame cannot be sent on this connection generation");
    }
    this.#channel.send(Uint8Array.from(bytes).buffer);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#detach(true);
    this.#generations.dispose();
  }

  readonly #onOpen = (): void => {
    const channel = this.#channel;
    if (channel == null || channel.readyState !== "open") {
      return;
    }
    channel.send(Uint8Array.from(encodeCompatibilityHandshake(this.#compatibility)).buffer);
  };

  readonly #onMessage = (event: MessageEvent<unknown>): void => {
    const generation = this.#generations.current();
    if (this.#disposed || !this.#generations.accepts(generation) || !(event.data instanceof ArrayBuffer)) {
      this.#failCurrent("nonbinary or stale WebRTC frame");
      return;
    }
    if (event.data.byteLength === 0 || event.data.byteLength > MAXIMUM_DIRECT_FRAME_BYTES) {
      this.#failCurrent("empty or oversized WebRTC frame");
      return;
    }
    const bytes = new Uint8Array(event.data);
    if (!this.#handshakeAccepted) {
      try {
        assertCompatibleRustPeer(this.#compatibility, bytes);
        this.#handshakeAccepted = true;
        this.#emit({ kind: "TRANSPORT_CHANGED", value: { generation, connected: true } });
      } catch (error) {
        this.#failCurrent(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    this.#emit({ kind: "NETWORK_FRAME", value: { generation, bytes: Array.from(bytes) } });
    bytes.fill(0);
  };

  readonly #onClose = (): void => {
    const generation = this.#generations.current();
    if (!this.#disposed && this.#generations.accepts(generation)) {
      this.#emit({ kind: "TRANSPORT_CHANGED", value: { generation, connected: false } });
    }
    this.#detach(false);
  };

  readonly #onError = (): void => this.#failCurrent("WebRTC data channel failed");

  #failCurrent(_reason: string): void {
    const generation = this.#generations.current();
    if (!this.#disposed && this.#generations.accepts(generation)) {
      this.#emit({ kind: "TRANSPORT_CHANGED", value: { generation, connected: false } });
    }
    this.#detach(true);
  }

  #detach(close: boolean): void {
    const channel = this.#channel;
    this.#channel = null;
    this.#handshakeAccepted = false;
    if (channel == null) {
      return;
    }
    channel.removeEventListener("open", this.#onOpen);
    channel.removeEventListener("message", this.#onMessage);
    channel.removeEventListener("close", this.#onClose);
    channel.removeEventListener("error", this.#onError);
    if (close && channel.readyState !== "closed") {
      channel.close();
    }
  }
}
