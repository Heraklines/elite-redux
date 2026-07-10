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
 * #857 KEEPALIVE interval. An idle co-op data channel that carries no frames for ~30s loses ICE
 * consent freshness (RFC 7675) / its NAT (or TURN) binding, and Chrome unilaterally tears the
 * channel down. That fires the #805 hot rejoin, whose freshly-dialed channel then idles out again -
 * a permanent disconnect/reconnect FLAP from starter-select onward, because two humans parked at the
 * pre-battle / resume barrier send NO game traffic for minutes (the live regression: the recent long
 * pre-battle waits made the idle window routinely exceed the 30s consent timeout). A tiny periodic
 * ping keeps the path warm so a long idle wait survives. Both endpoints ping independently (no reply
 * needed), and ping/pong frames are TRANSPORT-INTERNAL - they never surface to the session layer.
 */
export const COOP_KEEPALIVE_MS = 5_000;

/** Default keepalive scheduler (real timer); injectable so unit tests drive ticks deterministically. */
function defaultKeepaliveSchedule(cb: () => void, ms: number): () => void {
  const id = setInterval(cb, ms);
  return () => clearInterval(id);
}

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
  /**
   * #857: the most recent RAW channel error message (e.g. the SCTP abort reason
   * "User-Initiated Abort, reason=Close called"), captured so the reconnect banner can carry
   * the reason the channel died. Optional (absent on a mock / when no error has fired).
   */
  readonly lastError?: string | undefined;
}

/**
 * {@linkcode CoopTransport} over a {@linkcode CoopWireChannel}. Serializes each
 * outbound message as JSON and parses inbound frames back into messages, dropping
 * anything malformed (a peer can never crash us with a bad frame).
 */
export class WebRtcTransport implements CoopTransport {
  readonly role: CoopRole;
  private _state: CoopConnectionState;
  private wire: CoopWireChannel;
  /** #805 hot rejoin: increments per {@linkcode replaceChannel}; stale channel events are ignored. */
  private wireGeneration = 0;
  private readonly msgHandlers = new Set<(msg: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();
  /** #857 keepalive: cancel handle for the running ping timer (null until {@linkcode startKeepalive}). */
  private keepaliveCancel: (() => void) | null = null;
  /** #diagnostics: epoch-ms the last inbound frame arrived (0 = none yet). Includes keepalive ping/pong. */
  private lastRxAt = 0;

  constructor(role: CoopRole, wire: CoopWireChannel) {
    this.role = role;
    this.wire = wire;
    this._state = wire.readyState === "open" ? "connected" : "connecting";
    coopLog("webrtc", `ctor role=${role} readyState=${wire.readyState} state=${this._state}`);
    this.attach(wire);
  }

  /** Bind channel events for the CURRENT generation; a replaced channel's events are inert. */
  private attach(wire: CoopWireChannel): void {
    const gen = this.wireGeneration;
    wire.onOpen(() => {
      if (gen !== this.wireGeneration) {
        return;
      }
      coopLog("webrtc", `channel OPEN role=${this.role} gen=${gen}`);
      this.setState("connected");
    });
    wire.onClose(() => {
      if (gen !== this.wireGeneration) {
        return;
      }
      coopLog("webrtc", `channel CLOSE role=${this.role} state=${this._state} gen=${gen}`);
      this.setState("disconnected");
    });
    wire.onMessage(data => {
      if (gen !== this.wireGeneration) {
        return;
      }
      this.receive(data);
    });
  }

  /**
   * #805 HOT REJOIN: swap a freshly-dialed channel into this live transport. Everything above
   * (controller, relays, streamers, the run itself) holds THIS object - swapping the wire
   * reconnects the whole co-op session in place, no teardown. The old channel is closed
   * best-effort and its events go inert via the generation counter.
   */
  replaceChannel(wire: CoopWireChannel): void {
    this.wireGeneration++;
    coopLog("webrtc", `replaceChannel role=${this.role} gen=${this.wireGeneration} readyState=${wire.readyState}`);
    try {
      this.wire.close();
    } catch {
      /* the dead channel may already be closed */
    }
    this.wire = wire;
    this.attach(wire);
    if (wire.readyState === "open") {
      this.setState("connected");
    }
  }

  get state(): CoopConnectionState {
    return this._state;
  }

  /**
   * #857: the reason the LIVE channel most recently died (the raw SCTP abort / error text, e.g.
   * "User-Initiated Abort, reason=Close called"), or undefined if none was captured. Surfaced so the
   * reconnect banner can tell the player WHY the channel dropped instead of a bare "connection lost".
   */
  disconnectReason(): string | undefined {
    return this.wire.lastError;
  }

  /**
   * #857: begin periodic keepalive pings so an idle data channel never goes ~30s without a validated
   * packet (which would trip ICE consent freshness / a NAT-binding expiry and tear the channel down ->
   * the disconnect/reconnect flap). Idempotent; a running timer is left in place. The scheduler is
   * injectable for deterministic unit tests. `intervalMs <= 0` disables it (used by the loopback/tests).
   */
  startKeepalive(
    intervalMs: number = COOP_KEEPALIVE_MS,
    schedule: (cb: () => void, ms: number) => () => void = defaultKeepaliveSchedule,
  ): void {
    if (this.keepaliveCancel != null || intervalMs <= 0) {
      return;
    }
    this.keepaliveCancel = schedule(() => this.sendKeepalive(), intervalMs);
  }

  /** Send one keepalive ping if the current wire is open and connected (best-effort; never throws). */
  private sendKeepalive(): void {
    if (this._state !== "connected" || this.wire.readyState !== "open") {
      return;
    }
    try {
      this.wire.send(JSON.stringify({ t: "ping", ts: Date.now() } satisfies CoopMessage));
    } catch {
      /* the channel may have died between the state check and the send - the close event will fire */
    }
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
    this.keepaliveCancel?.();
    this.keepaliveCancel = null;
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

  /** #diagnostics: age (ms) of the last inbound frame (incl. keepalive), or undefined if none yet. */
  lastRxMs(): number | undefined {
    return this.lastRxAt === 0 ? undefined : Date.now() - this.lastRxAt;
  }

  private receive(data: string): void {
    // #diagnostics: stamp the last-received-frame time for ANY inbound frame (BEFORE the ping/pong
    // swallow + the JSON parse) so a live-but-idle tab - which still receives ~5s keepalives - reads a
    // small age, while a suspended/dead tab that stops sending even keepalives reads a growing one.
    this.lastRxAt = Date.now();
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
      // #857: keepalive frames are TRANSPORT-INTERNAL - swallow them (no fan-out, no per-frame log
      // spam) so the ~5s ping cadence stays invisible to the session layer and the captured logs.
      if (msg.t === "ping" || msg.t === "pong") {
        return;
      }
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
export function webRtcTransportFromChannel(
  role: CoopRole,
  channel: RTCDataChannel,
  pc?: RTCPeerConnection,
): WebRtcTransport {
  const transport = new WebRtcTransport(role, wireFromRtcChannel(role, channel, pc));
  // #857: keep the real (live-network) channel warm so a long idle wait can't trip the ICE consent /
  // NAT-binding timeout and start the reconnect flap. The keepalive lives on the transport INSTANCE,
  // so it persists across #805 hot-rejoin replaceChannel swaps and is cancelled on close().
  transport.startKeepalive();
  return transport;
}

/**
 * Adapt a raw RTCDataChannel to the {@linkcode CoopWireChannel} surface. Factored out of
 * {@linkcode webRtcTransportFromChannel} so hot rejoin (#805) can wrap a freshly re-dialed
 * channel and {@linkcode WebRtcTransport.replaceChannel} it into the LIVE transport.
 *
 * #857 (round 2 - the intermittent FLAP): the owning {@linkcode RTCPeerConnection} is bound here so
 * closing the wire ALSO closes its pc. Each #805 hot rejoin dials a FRESH pc
 * ({@linkcode exchangeAndOpenChannel}); before this, {@linkcode WebRtcTransport.replaceChannel} closed
 * only the superseded data CHANNEL and the old pc was never closed - so every rejoin LEAKED a live
 * ICE/DTLS/TURN session, and a superseded (zombie) pc's teardown landed a
 * "User-Initiated Abort, reason=Close called" onto the freshly-established channel ~1s after it opened,
 * dropping it and re-triggering the rejoin: a permanent disconnect/reconnect flap. Retiring the pc with
 * its wire fully removes the zombie so it can't abort the live connection.
 */
export function wireFromRtcChannel(role: CoopRole, channel: RTCDataChannel, pc?: RTCPeerConnection): CoopWireChannel {
  // #857: capture the raw channel error message so the transport can surface the DROP REASON on the
  // reconnect banner (previously log-only, then discarded). Still logged for the captured console.
  let lastError: string | undefined;
  channel.addEventListener("error", ev => {
    const errLike = (ev as { error?: { message?: string } }).error;
    lastError = errLike?.message ?? "?";
    coopWarn("webrtc", `channel ERROR role=${role} readyState=${channel.readyState} err=${lastError}`);
  });
  const wire: CoopWireChannel = {
    get readyState() {
      return channel.readyState;
    },
    get lastError() {
      return lastError;
    },
    send: data => channel.send(data),
    close: () => {
      // #857 R2: retire the data channel AND its owning peer connection together. replaceChannel closes
      // the SUPERSEDED wire on every rejoin; without also closing the pc, the old connection stayed
      // alive (holding ICE/DTLS/TURN) and its teardown aborted the fresh channel -> the reconnect flap.
      try {
        channel.close();
      } catch {
        /* the channel may already be closed */
      }
      try {
        pc?.close();
      } catch {
        /* the pc may already be closed */
      }
    },
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
  return wire;
}
