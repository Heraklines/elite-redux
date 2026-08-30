import type { BrowserRequestV1 } from "../contracts/browser-contracts";
import {
  frameKindForParticipantV1,
  participantBindingV1,
  signCoopFrameV1,
  type VerifiedCoopFrameBindingV1,
  verifyCoopFrameV1,
} from "../production/coop-frame";
import { ConnectionGenerationV1 } from "./connection-generation";
import {
  assertCompatibleRustPeer,
  type BrowserKernelCompatibilityV1,
  encodeCompatibilityHandshake,
} from "./signaling-adapter";

const MAXIMUM_AUTHENTICATED_FRAME_ENVELOPE_BYTES = 1_500_000;

export interface RustBrowserTransportOptionsV1 {
  compatibility: BrowserKernelCompatibilityV1;
  emit(request: BrowserRequestV1): void;
}

export interface VerifiedCoopTransportContextV1 {
  binding: VerifiedCoopFrameBindingV1;
  local_participant_id: string;
  peer_participant_id: string;
  local_private_key: CryptoKey;
}

interface ChannelListenersV1 {
  open(): void;
  message(event: MessageEvent<unknown>): void;
  close(): void;
  error(): void;
}

export class RustBrowserTransportAdapterV1 {
  readonly #compatibility: BrowserKernelCompatibilityV1;
  readonly #emit: (request: BrowserRequestV1) => void;
  readonly #generations = new ConnectionGenerationV1();
  #channel: RTCDataChannel | null = null;
  #context: VerifiedCoopTransportContextV1 | null = null;
  #listeners: ChannelListenersV1 | null = null;
  #handshakeAccepted = false;
  #handshakeSent = false;
  #sendSequence = 0;
  #receiveSequence = 0;
  #sendQueue = Promise.resolve();
  #receiveQueue = Promise.resolve();
  #disposed = false;

  constructor(options: RustBrowserTransportOptionsV1) {
    this.#compatibility = options.compatibility;
    this.#emit = options.emit;
  }

  attach(channel: RTCDataChannel, context: VerifiedCoopTransportContextV1): number {
    if (this.#disposed) {
      throw new Error("Rust browser transport is disposed");
    }
    this.#detach(true);
    const generation = this.#generations.advance();
    const local = participantBindingV1(context.binding, context.local_participant_id);
    const peer = participantBindingV1(context.binding, context.peer_participant_id);
    if (
      context.binding.release_id !== this.#compatibility.release_id
      || context.binding.authority_protocol !== this.#compatibility.authority_protocol
      || local.connection_generation !== generation
      || peer.connection_generation !== generation
      || channel.ordered !== true
    ) {
      throw new Error("verified co-op frame binding does not match this ordered connection generation");
    }
    this.#channel = channel;
    this.#context = context;
    this.#handshakeAccepted = false;
    this.#handshakeSent = false;
    this.#sendSequence = 0;
    this.#receiveSequence = 0;
    this.#sendQueue = Promise.resolve();
    this.#receiveQueue = Promise.resolve();
    const listeners: ChannelListenersV1 = {
      open: () => this.#open(channel, generation),
      message: event => this.#message(channel, generation, event),
      close: () => this.#closed(channel, generation),
      error: () => this.#failCurrent(channel, generation),
    };
    this.#listeners = listeners;
    channel.binaryType = "arraybuffer";
    channel.addEventListener("open", listeners.open);
    channel.addEventListener("message", listeners.message);
    channel.addEventListener("close", listeners.close);
    channel.addEventListener("error", listeners.error);
    if (channel.readyState === "open") {
      listeners.open();
    }
    return generation;
  }

  send(generation: number, bytes: Uint8Array): Promise<void> {
    const payload = Uint8Array.from(bytes);
    const operation = this.#sendQueue.then(async () => {
      const channel = this.#channel;
      const context = this.#context;
      if (
        this.#disposed
        || !this.#generations.accepts(generation)
        || !this.#handshakeAccepted
        || channel?.readyState !== "open"
        || context == null
        || payload.byteLength === 0
        || payload.byteLength > 1_048_576
      ) {
        throw new Error("Rust browser network frame cannot be sent on this connection generation");
      }
      const local = participantBindingV1(context.binding, context.local_participant_id);
      const sequence = this.#sendSequence + 1;
      const envelope = await signCoopFrameV1({
        binding: context.binding,
        participant: local,
        sequence,
        kind: frameKindForParticipantV1(context.binding, local),
        payload,
        privateKey: context.local_private_key,
      });
      try {
        if (
          channel !== this.#channel
          || context !== this.#context
          || !this.#generations.accepts(generation)
          || channel.readyState !== "open"
        ) {
          throw new Error("Rust browser network frame became stale before authenticated send");
        }
        this.#sendSequence = sequence;
        channel.send(Uint8Array.from(envelope).buffer);
      } finally {
        envelope.fill(0);
      }
    });
    this.#sendQueue = operation.catch(() => undefined);
    return operation
      .catch(error => {
        this.#failCurrent(this.#channel, generation);
        throw error;
      })
      .finally(() => payload.fill(0));
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#detach(true);
    this.#generations.dispose();
  }

  #open(channel: RTCDataChannel, generation: number): void {
    if (
      channel !== this.#channel
      || !this.#generations.accepts(generation)
      || channel.readyState !== "open"
      || this.#handshakeSent
    ) {
      return;
    }
    this.#handshakeSent = true;
    channel.send(Uint8Array.from(encodeCompatibilityHandshake(this.#compatibility)).buffer);
  }

  #message(channel: RTCDataChannel, generation: number, event: MessageEvent<unknown>): void {
    if (
      this.#disposed
      || channel !== this.#channel
      || !this.#generations.accepts(generation)
      || !(event.data instanceof ArrayBuffer)
    ) {
      this.#failCurrent(channel, generation);
      return;
    }
    if (event.data.byteLength === 0 || event.data.byteLength > MAXIMUM_AUTHENTICATED_FRAME_ENVELOPE_BYTES) {
      this.#failCurrent(channel, generation);
      return;
    }
    const bytes = new Uint8Array(event.data.slice(0));
    if (!this.#handshakeAccepted) {
      try {
        assertCompatibleRustPeer(this.#compatibility, bytes);
        this.#handshakeAccepted = true;
        this.#emit({ kind: "TRANSPORT_CHANGED", value: { generation, connected: true } });
      } catch {
        this.#failCurrent(channel, generation);
      } finally {
        bytes.fill(0);
      }
      return;
    }
    this.#receiveQueue = this.#receiveQueue
      .then(() => this.#receiveAuthenticated(channel, generation, bytes))
      .catch(() => this.#failCurrent(channel, generation))
      .finally(() => bytes.fill(0));
  }

  async #receiveAuthenticated(channel: RTCDataChannel, generation: number, envelope: Uint8Array): Promise<void> {
    const context = this.#context;
    if (channel !== this.#channel || context == null || !this.#generations.accepts(generation)) {
      throw new Error("authenticated co-op frame arrived on a stale channel");
    }
    const peer = participantBindingV1(context.binding, context.peer_participant_id);
    const expectedSequence = this.#receiveSequence + 1;
    const payload = await verifyCoopFrameV1({
      bytes: envelope,
      binding: context.binding,
      participant: peer,
      expectedSequence,
      expectedKind: frameKindForParticipantV1(context.binding, peer),
    });
    try {
      if (channel !== this.#channel || context !== this.#context || !this.#generations.accepts(generation)) {
        throw new Error("authenticated co-op frame became stale before Rust delivery");
      }
      this.#receiveSequence = expectedSequence;
      this.#emit({
        kind: "NETWORK_FRAME",
        value: { generation: peer.connection_generation, bytes: Array.from(payload) },
      });
    } finally {
      payload.fill(0);
    }
  }

  #closed(channel: RTCDataChannel, generation: number): void {
    if (!this.#disposed && channel === this.#channel && this.#generations.accepts(generation)) {
      this.#emit({ kind: "TRANSPORT_CHANGED", value: { generation, connected: false } });
    }
    this.#detach(false);
  }

  #failCurrent(channel: RTCDataChannel | null, generation: number): void {
    if (!this.#disposed && channel != null && channel === this.#channel && this.#generations.accepts(generation)) {
      this.#emit({ kind: "TRANSPORT_CHANGED", value: { generation, connected: false } });
    }
    if (channel === this.#channel) {
      this.#detach(true);
    }
  }

  #detach(close: boolean): void {
    const channel = this.#channel;
    const listeners = this.#listeners;
    this.#channel = null;
    this.#context = null;
    this.#listeners = null;
    this.#handshakeAccepted = false;
    this.#handshakeSent = false;
    this.#sendSequence = 0;
    this.#receiveSequence = 0;
    if (channel == null || listeners == null) {
      return;
    }
    channel.removeEventListener("open", listeners.open);
    channel.removeEventListener("message", listeners.message);
    channel.removeEventListener("close", listeners.close);
    channel.removeEventListener("error", listeners.error);
    if (close && channel.readyState !== "closed") {
      channel.close();
    }
  }
}
