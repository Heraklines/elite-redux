/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op WebRTC transport (#633, P6). The real-peer implementation of
// {@linkcode CoopTransport}, carrying every gameplay {@linkcode CoopMessage} over
// an RTCDataChannel between the two paired clients. Drops in behind the SAME
// interface as the LoopbackTransport, so the CoopSessionController and all of co-op
// is unchanged - only the transport swaps.
//
// The channel is abstracted as a small {@linkcode CoopWireChannel} (send + close +
// three event registrations) so:
//   - a real RTCDataChannel is adapted with `webRtcTransportFromChannel`, and
//   - the FRAMING (JSON encode/decode, connection-state mapping, malformed-message
//     rejection) is unit-testable headlessly against a mock channel - no live ICE.
//
// Establishing the channel (offer/answer/ICE via the er-coop-api signaling worker,
// plus a TURN server for symmetric NATs) is deploy infrastructure and lives
// outside this module; once the channel is open, this is all the game needs.
// =============================================================================

import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import type { CoopConnectionState, CoopMessage, CoopRole, CoopTransport } from "#data/elite-redux/coop/coop-transport";

/**
 * The minimal data-channel surface the transport needs - satisfied by a real
 * RTCDataChannel (via {@linkcode webRtcTransportFromChannel}) and by a test mock.
 * Uses explicit `on*` registration methods (not DOM `on*` props) so the mock is
 * trivial and no DOM-type bridging cast is required.
 */
export interface CoopWireChannel {
  /** Mirrors RTCDataChannel.readyState ("connecting" | "open" | "closing" | "closed"). */
  readonly readyState: string;
  /** Send a UTF-8 string frame to the peer. */
  send(data: string): void;
  /** Close the channel. */
  close(): void;
  /** Register the inbound-frame handler (raw string payload). */
  onMessage(handler: (data: string) => void): void;
  /** Register the channel-open handler. */
  onOpen(handler: () => void): void;
  /** Register the channel-close handler. */
  onClose(handler: () => void): void;
}

/**
 * {@linkcode CoopTransport} over a {@linkcode CoopWireChannel}. Serializes each
 * outbound message as JSON and parses inbound frames back into messages, dropping
 * anything malformed (a peer can never crash us with a bad frame).
 */
export class WebRtcTransport implements CoopTransport {
  readonly role: CoopRole;
  private _state: CoopConnectionState;
  private readonly wire: CoopWireChannel;
  private readonly msgHandlers = new Set<(msg: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();

  constructor(role: CoopRole, wire: CoopWireChannel) {
    this.role = role;
    this.wire = wire;
    this._state = wire.readyState === "open" ? "connected" : "connecting";
    coopLog("webrtc", `ctor role=${role} readyState=${wire.readyState} state=${this._state}`);
    wire.onOpen(() => {
      coopLog("webrtc", `channel OPEN role=${this.role}`);
      this.setState("connected");
    });
    wire.onClose(() => {
      coopLog("webrtc", `channel CLOSE role=${this.role} state=${this._state}`);
      this.setState("disconnected");
    });
    wire.onMessage(data => this.receive(data));
  }

  get state(): CoopConnectionState {
    return this._state;
  }

  send(msg: CoopMessage): void {
    if (this._state !== "connected" || this.wire.readyState !== "open") {
      if (isCoopDebug()) {
        coopWarn(
          "webrtc",
          `raw send DROP (not open) role=${this.role} t=${msg.t} state=${this._state} readyState=${this.wire.readyState}`,
        );
      }
      return;
    }
    const frame = JSON.stringify(msg);
    if (isCoopDebug()) {
      coopLog("webrtc", `raw tx role=${this.role} t=${msg.t} bytes=${frame.length}`);
    }
    this.wire.send(frame);
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    this.msgHandlers.add(handler);
    return () => {
      this.msgHandlers.delete(handler);
    };
  }

  onStateChange(handler: (state: CoopConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    coopLog("webrtc", `close() role=${this.role} state=${this._state}`);
    this.setState("closed");
    this.wire.close();
    this.msgHandlers.clear();
    this.stateHandlers.clear();
  }

  private setState(state: CoopConnectionState): void {
    // "closed" is terminal: an explicit close() must win over the channel's own
    // close event (which would otherwise downgrade us to "disconnected").
    if (this._state === state || this._state === "closed") {
      return;
    }
    coopLog("webrtc", `state role=${this.role} ${this._state} -> ${state}`);
    this._state = state;
    for (const h of [...this.stateHandlers]) {
      h(state);
    }
  }

  private receive(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // malformed JSON - ignore (a bad frame can't take us down) - but surface it: a desync
      // born from dropped/truncated frames is otherwise invisible.
      coopWarn("webrtc", `raw rx DECODE FAIL role=${this.role} bytes=${data.length} (malformed JSON, dropped)`);
      return;
    }
    if (parsed != null && typeof parsed === "object" && typeof (parsed as { t?: unknown }).t === "string") {
      const msg = parsed as CoopMessage;
      if (isCoopDebug()) {
        coopLog("webrtc", `raw rx role=${this.role} t=${msg.t} bytes=${data.length} handlers=${this.msgHandlers.size}`);
      }
      for (const h of [...this.msgHandlers]) {
        h(msg);
      }
    } else {
      coopWarn(
        "webrtc",
        `raw rx UNKNOWN frame role=${this.role} bytes=${data.length} (no string .t discriminant, dropped)`,
      );
    }
  }
}

/**
 * Adapt a real {@linkcode RTCDataChannel} into a {@linkcode WebRtcTransport}. Call
 * this once the signaling handshake has produced an open (or opening) data channel.
 */
export function webRtcTransportFromChannel(role: CoopRole, channel: RTCDataChannel): WebRtcTransport {
  // Log-only: surface the raw channel error event (NOT wired into message flow / state), so a live
  // DataChannel error is visible in the captured log instead of being silently swallowed.
  channel.addEventListener("error", ev => {
    const errLike = (ev as { error?: { message?: string } }).error;
    coopWarn("webrtc", `channel ERROR role=${role} readyState=${channel.readyState} err=${errLike?.message ?? "?"}`);
  });
  const wire: CoopWireChannel = {
    get readyState() {
      return channel.readyState;
    },
    send: data => channel.send(data),
    close: () => channel.close(),
    onMessage: handler => {
      channel.addEventListener("message", ev => handler(String(ev.data)));
    },
    onOpen: handler => {
      channel.addEventListener("open", () => handler());
    },
    onClose: handler => {
      channel.addEventListener("close", () => handler());
    },
  };
  return new WebRtcTransport(role, wire);
}
