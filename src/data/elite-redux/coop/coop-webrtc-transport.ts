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

import { routeCoopV2InboundFrame } from "#data/elite-redux/coop/authority-v2/shadow";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import {
  CoopOutboundQueue,
  classifyCoopMessage,
  isCoopDurabilityEnabled,
} from "#data/elite-redux/coop/coop-durability";
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

/**
 * #857 (round 3 - SUSPENSION resilience). Mobile browsers FREEZE `setInterval` when the screen locks or
 * the tab is heavily backgrounded, so the keepalive timer stops firing during exactly the long idle
 * barrier waits it exists to cover - the ICE consent / NAT binding lapses and the channel is torn down.
 * A resumed timer therefore observes a large WALL-CLOCK gap since its previous tick; when that gap exceeds
 * this multiple of the interval we treat it as a suspend/resume event (not a normal tick) and immediately
 * re-warm the path (and, if the channel didn't survive the freeze, kick the rejoin proactively). 3x keeps
 * ordinary scheduler jitter from misclassifying a healthy tick.
 */
export const COOP_KEEPALIVE_SUSPEND_FACTOR = 3;

/**
 * A peer connection may report `disconnected` while ICE is changing routes and recover without replacing
 * the carrier. Give that transient state a short bounded grace period, but never debounce `failed` or
 * `closed`: those states cannot carry another gameplay frame and must enter hot rejoin immediately.
 */
export const COOP_PC_DISCONNECTED_GRACE_MS = 5_000;

/**
 * Conservative application framing below common SCTP message ceilings. Session/launch snapshots
 * grow throughout a long campaign; splitting their JSON keeps a late-wave save from becoming one
 * oversized RTCDataChannel send while remaining transparent to every protocol consumer.
 */
export const COOP_WIRE_CHUNK_RAW_BYTES = 9_000;
/** Backward-compatible test/diagnostic alias; framing is byte-budgeted, not character-budgeted. */
export const COOP_WIRE_CHUNK_PAYLOAD_CHARS = COOP_WIRE_CHUNK_RAW_BYTES;
export const COOP_WIRE_BUFFER_HIGH_BYTES = 256 * 1024;
export const COOP_WIRE_BUFFER_LOW_BYTES = 64 * 1024;
const COOP_WIRE_MAX_CHUNKS = 2_048;
/** Cap on frames buffered for a not-yet-registered subscriber (early-rx); overflow fails the channel closed. */
export const COOP_EARLY_RX_MAX_FRAMES = 64;
const COOP_WIRE_MAX_REASSEMBLED_BYTES = 16 * 1024 * 1024;
const COOP_LOGICAL_QUEUE_MAX_BYTES = 32 * 1024 * 1024;
const COOP_LOGICAL_QUEUE_MAX_COUNT = 512;
const COOP_BROWSER_GAME_OVER_ENVELOPE_DELAY_MS = 250;
/** Bounded whole-transfer replay fence. Transfer ids are unique for one transport session. */
export const COOP_WIRE_COMPLETED_TRANSFER_RETENTION = 512;

interface CoopWireChunkFrame {
  __coopChunk: 1;
  id: string;
  index: number;
  total: number;
  payload: string;
  bytes: number;
}

interface CoopLogicalOutbound {
  msg: CoopMessage;
  json: string;
  byteLength: number;
  attempt: { generation: number; id: string; frames: string[]; index: number } | null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8_192));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

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
  readonly bufferedAmount?: number;
  bufferedAmountLowThreshold?: number;
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
   * Register a carrier-loss handler. Unlike `onClose`, this also observes the owning RTCPeerConnection,
   * whose `failed`/`closed` state can strand an apparently-open RTCDataChannel.
   */
  onConnectionLost?(handler: (reason: string) => void): void;
  onBufferedAmountLow?(handler: () => void): void;
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
  private wireGeneration: number;
  private readonly msgHandlers = new Set<(msg: CoopMessage) => void>();
  private readonly stateHandlers = new Set<(state: CoopConnectionState) => void>();
  /** Co-op AUTHORITY V2: per-instance inbound handler for `v === 2` frames (see {@link CoopTransport.onV2Frame}). */
  private v2FrameHandler: ((frame: unknown) => void) | null = null;
  /**
   * #857 keepalive: cancel handle for the running ping timer AND the browser resume listeners (null until
   * {@linkcode startKeepalive}). Calling it stops the timer and unregisters every event listener - teardown
   * leaks nothing.
   */
  private keepaliveCancel: (() => void) | null = null;
  /** #857 keepalive interval (ms) captured from {@linkcode startKeepalive}; 0 while the timer is stopped. */
  private keepaliveIntervalMs = 0;
  /** #857 wall-clock (epoch-ms) of the previous keepalive tick / resume poke; drives suspend-gap detection. */
  private lastKeepaliveTickAt = 0;
  /** #857 injectable clock (real timer wall-clock by default; overridden by unit tests for deterministic gaps). */
  private keepaliveClock: () => number = Date.now;
  /** #diagnostics: epoch-ms the last inbound frame arrived (0 = none yet). Includes keepalive ping/pong. */
  private lastRxAt = 0;
  /**
   * W2b durability (§4.3): the bounded outbound queue that holds DURABLE frames sent while the channel is
   * dark, flushed FIFO on the next `open`. Lazily created on the first dark send while the flag is ON; when
   * the flag is OFF the transport keeps its legacy drop-on-not-open behavior (null queue). Cosmetic/internal
   * frames are shed, never queued (§4.1). Survives {@linkcode replaceChannel} (it lives on the instance).
   */
  private outboundQueue: CoopOutboundQueue | null = null;
  private outboundChunkSeq = 0;
  private readonly logicalOutbound: CoopLogicalOutbound[] = [];
  private logicalOutboundBytes = 0;
  private drainingLogicalOutbound = false;
  private blockedSendGeneration: number | null = null;
  /** A connected-path durable refusal lost exact bytes and therefore owes retained recovery/full resync. */
  private logicalOutboundNeedsResync = false;
  /** Prevent more than one recovery transition for the same failed channel generation. */
  private logicalRecoveryGeneration: number | null = null;
  /** Self-identifying local transport failure surfaced through the existing disconnect diagnostics. */
  private transportFailureReason: string | undefined;
  /** The current generation has already emitted its one lifecycle disconnect transition. */
  private disconnectedGeneration: number | null = null;
  /** Exact fixture authority keys already waiting for their one displaced real send. */
  private readonly delayedGameOverFixtureAuthorities = new Set<string>();
  private readonly inboundChunks = new Map<
    string,
    { readonly total: number; readonly parts: (string | undefined)[]; received: number; bytes: number }
  >();
  /** Recently completed chunk ids remain terminal so replaying an entire group cannot deliver twice. */
  private readonly completedInboundChunkIds = new Set<string>();
  /**
   * Frames that arrived BEFORE THE FIRST-EVER message handler registered (run 29551213918: the
   * host's one-shot `dataFingerprint` reached the guest at `handlers=0` while its session
   * controller was still constructing under CPU starvation, was dropped, and the compatibility
   * barrier correctly-but-permanently kept the lobby closed). Bounded; replayed in arrival
   * order on the first subscription. STRICTLY pre-first-subscription: once any handler has ever
   * registered, a later zero-handler window keeps the legacy drop semantics (tests inject loss
   * that way, and post-teardown frames must not leak into a successor subscriber). Delivery
   * robustness only - a buffered frame is indistinguishable from a slow network to every
   * consumer, so no protocol/determinism surface changes.
   */
  private readonly earlyRx: CoopMessage[] = [];
  private earlyRxDraining = false;
  private earlyRxDrainScheduled = false;
  private hasEverSubscribed = false;

  constructor(role: CoopRole, wire: CoopWireChannel, initialConnectionGeneration = 0) {
    if (!Number.isSafeInteger(initialConnectionGeneration) || initialConnectionGeneration < 0) {
      throw new Error("invalid co-op connection generation");
    }
    this.role = role;
    this.wire = wire;
    this.wireGeneration = initialConnectionGeneration;
    this._state = wire.readyState === "open" ? "connected" : "connecting";
    coopLog("webrtc", `ctor role=${role} readyState=${wire.readyState} state=${this._state}`);
    this.attach(wire);
  }

  /** Bind channel events for the CURRENT generation; a replaced channel's events are inert. */
  private attach(wire: CoopWireChannel): void {
    const gen = this.wireGeneration;
    try {
      wire.bufferedAmountLowThreshold = COOP_WIRE_BUFFER_LOW_BYTES;
    } catch {
      /* optional on minimal test wires */
    }
    wire.onBufferedAmountLow?.(() => {
      if (gen === this.wireGeneration) {
        this.drainLogicalOutbound();
      }
    });
    wire.onOpen(() => {
      if (gen !== this.wireGeneration || this.disconnectedGeneration === gen) {
        return;
      }
      coopLog("webrtc", `channel OPEN role=${this.role} gen=${gen}`);
      this.setState("connected");
      this.blockedSendGeneration = null;
      this.flushOutboundQueue();
      this.drainLogicalOutbound();
    });
    wire.onClose(() => {
      this.handleConnectionLost(wire, gen, wire.lastError ?? "data channel closed", true);
    });
    wire.onConnectionLost?.(reason => {
      this.handleConnectionLost(wire, gen, reason, true);
    });
    wire.onMessage(data => {
      if (gen !== this.wireGeneration || this.disconnectedGeneration === gen) {
        return;
      }
      this.receive(data);
    });
  }

  /**
   * Collapse every close/failure signal for one carrier generation into exactly one lifecycle transition.
   * The failing wire is captured before notifying listeners: a synchronous rejoin may install a replacement,
   * and cleanup must never close that fresh generation.
   */
  private handleConnectionLost(wire: CoopWireChannel, gen: number, reason: string, retireWire: boolean): void {
    if (gen !== this.wireGeneration || this.disconnectedGeneration === gen || this._state === "closed") {
      return;
    }
    this.disconnectedGeneration = gen;
    // A connected-path refusal records the more precise causal reason before it closes the carrier. Preserve
    // that evidence when the resulting channel-close callback arrives synchronously.
    this.transportFailureReason ??= reason;
    coopWarn("webrtc", `carrier LOST role=${this.role} state=${this._state} gen=${gen} reason=${reason}`);
    this.inboundChunks.clear();
    this.setState("disconnected");
    if (!retireWire) {
      return;
    }
    try {
      wire.close();
    } catch (error) {
      coopWarn(
        "webrtc",
        `failed carrier cleanup threw role=${this.role} gen=${gen}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * #805 HOT REJOIN: swap a freshly-dialed channel into this live transport. Everything above
   * (controller, relays, streamers, the run itself) holds THIS object - swapping the wire
   * reconnects the whole co-op session in place, no teardown. The old channel is closed
   * best-effort and its events go inert via the generation counter.
   */
  replaceChannel(wire: CoopWireChannel): void {
    this.wireGeneration++;
    this.inboundChunks.clear();
    this.blockedSendGeneration = null;
    this.logicalRecoveryGeneration = null;
    this.transportFailureReason = undefined;
    this.disconnectedGeneration = null;
    for (const logical of this.logicalOutbound) {
      logical.attempt = null;
    }
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
      // The fresh channel came up already open (no `open` event to wait for): flush the frames that
      // queued while it was dark (§4.3) so a #805 hot rejoin loses nothing sent during the blip.
      this.flushOutboundQueue();
      this.drainLogicalOutbound();
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
    return this.transportFailureReason ?? this.wire.lastError;
  }

  connectionGeneration(): number {
    return this.wireGeneration;
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
    clock: () => number = Date.now,
  ): void {
    if (this.keepaliveCancel != null || intervalMs <= 0) {
      return;
    }
    this.keepaliveIntervalMs = intervalMs;
    this.keepaliveClock = clock;
    this.lastKeepaliveTickAt = clock();
    // Each tick runs through pumpKeepalive so a resumed timer that observes a large wall-clock gap since its
    // previous tick (the mobile screen-lock / backgrounded-tab freeze) is classified as a suspend/resume
    // event rather than a normal ping - see #857 round 3.
    const cancelSchedule = schedule(() => this.pumpKeepalive("tick"), intervalMs);
    // In a browser, the OS delivers resume signals (tab visible, page shown from bfcache, window focus,
    // network back online) the instant the app wakes - fire an immediate re-warm off each so recovery does
    // not wait for the (possibly still-throttled) next timer tick. Feature-detected: a no-op headless.
    const cancelResumeListeners = this.installResumeListeners();
    this.keepaliveCancel = () => {
      cancelSchedule();
      cancelResumeListeners();
      this.keepaliveIntervalMs = 0;
    };
  }

  /**
   * #857: one keepalive step. On a normal tick it just re-warms the path with a ping. When the wall-clock
   * gap since the previous tick/poke exceeds {@linkcode COOP_KEEPALIVE_SUSPEND_FACTOR}x the interval - the
   * mobile screen-lock / backgrounded-tab timer FREEZE - it classifies the gap, logs it, pings immediately,
   * and (only if the channel did not survive the freeze) kicks the existing rejoin path proactively instead
   * of waiting for the eventual close event. `source` labels what drove this poke (timer tick or a browser
   * resume signal) for the log.
   */
  private pumpKeepalive(source: string): void {
    const now = this.keepaliveClock();
    const gap = now - this.lastKeepaliveTickAt;
    this.lastKeepaliveTickAt = now;
    if (this.keepaliveIntervalMs > 0 && gap > this.keepaliveIntervalMs * COOP_KEEPALIVE_SUSPEND_FACTOR) {
      coopLog(
        "webrtc",
        `keepalive suspend/resume gap role=${this.role} source=${source} gap=${gap}ms interval=${this.keepaliveIntervalMs}ms readyState=${this.wire.readyState} state=${this._state}`,
      );
      // Re-warm immediately: if the path is still up, one validated packet refreshes ICE consent / the NAT
      // binding before the peer times us out.
      this.sendKeepalive();
      // If the channel DIED (or is dying) during the freeze, the close event may be arbitrarily delayed on a
      // throttled tab - drive the transport to `disconnected` now so the runtime's existing rejoin reaction
      // (onStateChange -> rejoinDriver) fires without waiting for it.
      const readyState = this.wire.readyState;
      if ((readyState === "closing" || readyState === "closed") && this._state !== "closed") {
        coopLog(
          "webrtc",
          `keepalive proactive rejoin kick role=${this.role} readyState=${readyState} state=${this._state}`,
        );
        this.setState("disconnected");
      }
      return;
    }
    this.sendKeepalive();
  }

  /**
   * #857 round 3: register the browser resume signals that fire when a suspended/backgrounded app wakes, each
   * driving an immediate {@linkcode pumpKeepalive} (ping + suspend-gap check). Feature-detected via
   * `typeof document`/`typeof window`/`navigator` so the headless (vitest/node) environment - where these
   * globals are absent - is completely untouched and no listener is ever registered. Returns an unregister
   * function that removes every listener it added (called from {@linkcode keepaliveCancel} on stop/close).
   */
  private installResumeListeners(): () => void {
    const doc = typeof document === "undefined" ? undefined : document;
    const win = typeof window === "undefined" ? undefined : window;
    const cleanups: (() => void)[] = [];
    if (doc != null && typeof doc.addEventListener === "function") {
      // A backgrounded tab resumes with a `visibilitychange` to "visible"; ignore the hide half.
      const onVisibility = (): void => {
        if (doc.visibilityState === "visible") {
          this.pumpKeepalive("visibilitychange");
        }
      };
      doc.addEventListener("visibilitychange", onVisibility);
      cleanups.push(() => doc.removeEventListener("visibilitychange", onVisibility));
    }
    if (win != null && typeof win.addEventListener === "function") {
      const onPageShow = (): void => this.pumpKeepalive("pageshow");
      const onFocus = (): void => this.pumpKeepalive("focus");
      const onOnline = (): void => this.pumpKeepalive("online");
      // `pageshow` fires on a bfcache restore (mobile back-forward), `focus` on window re-focus, `online`
      // when connectivity returns - all points where a frozen keepalive should re-warm immediately.
      win.addEventListener("pageshow", onPageShow);
      win.addEventListener("focus", onFocus);
      win.addEventListener("online", onOnline);
      cleanups.push(() => win.removeEventListener("pageshow", onPageShow));
      cleanups.push(() => win.removeEventListener("focus", onFocus));
      cleanups.push(() => win.removeEventListener("online", onOnline));
    }
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  }

  /** Send one keepalive ping if the current wire is open and connected (best-effort; never throws). */
  private sendKeepalive(): void {
    if (this._state !== "connected" || this.wire.readyState !== "open") {
      return;
    }
    try {
      this.wire.send(JSON.stringify({ t: "ping", ts: this.keepaliveClock() } satisfies CoopMessage));
    } catch {
      /* the channel may have died between the state check and the send - the close event will fire */
    }
  }

  send(msg: CoopMessage): void {
    const fixtureAuthority = this.gameOverFixtureEnvelopeAuthority(msg);
    if (fixtureAuthority != null) {
      if (this.delayedGameOverFixtureAuthorities.has(fixtureAuthority)) {
        coopLog("webrtc", `fixture COALESCE retained gameOver retry authority=${fixtureAuthority}`);
        return;
      }
      this.delayedGameOverFixtureAuthorities.add(fixtureAuthority);
      coopLog(
        "webrtc",
        `fixture DELAY retained gameOver envelope role=${this.role} authority=${fixtureAuthority} delay=${COOP_BROWSER_GAME_OVER_ENVELOPE_DELAY_MS}ms`,
      );
      setTimeout(() => {
        this.delayedGameOverFixtureAuthorities.delete(fixtureAuthority);
        this.sendNow(msg);
      }, COOP_BROWSER_GAME_OVER_ENVELOPE_DELAY_MS);
      return;
    }
    this.sendNow(msg);
  }

  /**
   * Exact-build public-browser fault injection for the terminal ordering regression.
   *
   * The frame still traverses the normal RTC serialization, durability, receive, journal,
   * materialization, replay-unpark and ACK paths; only its wall-clock delivery is displaced.
   * Normal builds fail closed because neither a URL alone nor a build flag alone is sufficient.
   */
  private gameOverFixtureEnvelopeAuthority(msg: CoopMessage): string | null {
    const env = import.meta.env as unknown as Record<string, unknown> | undefined;
    if (
      env?.VITE_COOP_BROWSER_FIXTURE !== "game-over"
      || typeof location === "undefined"
      || new URLSearchParams(location.search).get("coopfixture") !== "game-over"
      || msg.t !== "envelope"
      || msg.envelope.pendingOperation?.kind !== "WAVE_ADVANCE"
    ) {
      return null;
    }
    const payload = msg.envelope.pendingOperation.payload as { outcome?: unknown } | undefined;
    return payload?.outcome === "gameOver"
      ? `${msg.envelope.sessionEpoch}:${msg.envelope.revision}:${msg.envelope.pendingOperation.id}`
      : null;
  }

  private sendNow(msg: CoopMessage): void {
    if (this._state !== "connected" || this.wire.readyState !== "open") {
      // W2b durability (§4.3): instead of dropping a DURABLE frame silently (the review-finding-3 hazard),
      // ENQUEUE it and flush FIFO on the next `open`. Cosmetic/internal frames are shed (§4.1). Keepalive
      // pings (internal) are never queued - they are time-sensitive. With the flag OFF this is the legacy
      // drop-on-not-open path unchanged.
      if (isCoopDurabilityEnabled() && classifyCoopMessage(msg) === "durable") {
        if (this.outboundQueue == null) {
          this.outboundQueue = new CoopOutboundQueue();
        }
        const queue = this.outboundQueue;
        const outcome = queue.offer(msg, new TextEncoder().encode(JSON.stringify(msg)).byteLength);
        if (isCoopDebug()) {
          coopWarn(
            "webrtc",
            `send DARK role=${this.role} t=${msg.t} -> ${outcome} (depth=${queue.size()} state=${this._state} readyState=${this.wire.readyState})`,
          );
        }
        return;
      }
      if (isCoopDebug()) {
        coopWarn(
          "webrtc",
          `raw send DROP (not open) role=${this.role} t=${msg.t} state=${this._state} readyState=${this.wire.readyState}`,
        );
      }
      return;
    }
    this.transmit(msg);
  }

  /**
   * W2b (§4.3): stringify + send one frame on the CURRENT open channel, with the send ERROR CAUGHT (the
   * channel can die between the state check and the send; before this a throw from `wire.send` propagated
   * uncaught out of every caller). A failed send is logged; the channel's close event drives the rejoin.
   */
  private transmit(msg: CoopMessage): void {
    const json = JSON.stringify(msg);
    const byteLength = new TextEncoder().encode(json).byteLength;
    if (isCoopDebug()) {
      coopLog("webrtc", `raw tx QUEUE role=${this.role} t=${msg.t} bytes=${byteLength}`);
    }
    if (
      byteLength > COOP_WIRE_MAX_REASSEMBLED_BYTES
      || this.logicalOutbound.length >= COOP_LOGICAL_QUEUE_MAX_COUNT
      || this.logicalOutboundBytes + byteLength > COOP_LOGICAL_QUEUE_MAX_BYTES
    ) {
      const reason =
        byteLength > COOP_WIRE_MAX_REASSEMBLED_BYTES
          ? `oversized logical frame bytes=${byteLength} max=${COOP_WIRE_MAX_REASSEMBLED_BYTES}`
          : `logical FIFO exhausted depth=${this.logicalOutbound.length}/${COOP_LOGICAL_QUEUE_MAX_COUNT} bytes=${this.logicalOutboundBytes}/${COOP_LOGICAL_QUEUE_MAX_BYTES}`;
      coopWarn(
        "webrtc",
        `raw send REFUSED role=${this.role} t=${msg.t} bytes=${byteLength} queue=${this.logicalOutbound.length}/${this.logicalOutboundBytes} (${reason})`,
      );
      this.escalateDurableRefusal(msg, reason);
      return;
    }
    this.logicalOutbound.push({ msg, json, byteLength, attempt: null });
    this.logicalOutboundBytes += byteLength;
    this.drainLogicalOutbound();
  }

  /** Build a fresh chunk-zero attempt for the current channel generation. */
  private buildLogicalAttempt(logical: CoopLogicalOutbound): NonNullable<CoopLogicalOutbound["attempt"]> | null {
    const bytes = new TextEncoder().encode(logical.json);
    if (bytes.byteLength <= COOP_WIRE_CHUNK_RAW_BYTES) {
      return {
        generation: this.wireGeneration,
        id: `${this.role}-${this.wireGeneration}-${++this.outboundChunkSeq}`,
        frames: [logical.json],
        index: 0,
      };
    }
    const total = Math.ceil(bytes.byteLength / COOP_WIRE_CHUNK_RAW_BYTES);
    if (total > COOP_WIRE_MAX_CHUNKS) {
      const reason = `logical frame needs ${total} chunks; max=${COOP_WIRE_MAX_CHUNKS}`;
      coopWarn(
        "webrtc",
        `raw send REFUSED role=${this.role} t=${logical.msg.t} bytes=${bytes.byteLength} chunks=${total} (${reason})`,
      );
      this.escalateDurableRefusal(logical.msg, reason);
      return null;
    }
    const id = `${this.role}-${this.wireGeneration}-${++this.outboundChunkSeq}`;
    const frames: string[] = [];
    for (let index = 0; index < total; index++) {
      const part = bytes.subarray(index * COOP_WIRE_CHUNK_RAW_BYTES, (index + 1) * COOP_WIRE_CHUNK_RAW_BYTES);
      const chunk: CoopWireChunkFrame = {
        __coopChunk: 1,
        id,
        index,
        total,
        payload: bytesToBase64(part),
        bytes: part.byteLength,
      };
      frames.push(JSON.stringify(chunk));
    }
    coopLog(
      "webrtc",
      `raw tx CHUNKED role=${this.role} t=${logical.msg.t} bytes=${bytes.byteLength} chunks=${total} id=${id}`,
    );
    return { generation: this.wireGeneration, id, frames, index: 0 };
  }

  /**
   * Drain the logical FIFO while the channel is open and below its byte watermark. A mid-attempt
   * exception leaves the logical item at the head; replacement builds a new id and restarts at chunk 0.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: framing, generation, and backpressure guards form one atomic drain state machine
  private drainLogicalOutbound(): void {
    if (
      this.drainingLogicalOutbound
      || this._state !== "connected"
      || this.wire.readyState !== "open"
      || this.blockedSendGeneration === this.wireGeneration
    ) {
      return;
    }
    this.drainingLogicalOutbound = true;
    try {
      while (this.logicalOutbound.length > 0) {
        const logical = this.logicalOutbound[0];
        if (logical.attempt == null || logical.attempt.generation !== this.wireGeneration) {
          logical.attempt = this.buildLogicalAttempt(logical);
          if (logical.attempt == null) {
            this.logicalOutbound.shift();
            this.logicalOutboundBytes -= logical.byteLength;
            // A durable refusal transitions the transport into the existing shared rejoin/resync path.
            // Never continue draining the superseded channel generation after that fail-closed boundary.
            return;
          }
        }
        const attempt = logical.attempt;
        while (attempt.index < attempt.frames.length) {
          const frame = attempt.frames[attempt.index];
          const encodedFrameBytes = new TextEncoder().encode(frame).byteLength;
          if ((this.wire.bufferedAmount ?? 0) + encodedFrameBytes > COOP_WIRE_BUFFER_HIGH_BYTES) {
            return;
          }
          try {
            this.wire.send(frame);
          } catch (error) {
            coopWarn(
              "webrtc",
              `raw send THREW role=${this.role} t=${logical.msg.t} chunk=${attempt.index}/${attempt.frames.length} err=${(error as Error)?.message ?? "?"} (restart on replacement)`,
            );
            logical.attempt = null;
            this.blockedSendGeneration = this.wireGeneration;
            return;
          }
          attempt.index++;
        }
        this.logicalOutbound.shift();
        this.logicalOutboundBytes -= logical.byteLength;
      }
    } finally {
      this.drainingLogicalOutbound = false;
    }
  }

  /** W2b (§4.3): flush any frames queued while the channel was dark, FIFO, on (re)connect. */
  private flushOutboundQueue(): void {
    const queue = this.outboundQueue;
    if (queue == null || queue.size() === 0) {
      return;
    }
    if (isCoopDebug()) {
      coopLog("webrtc", `flush outbound queue role=${this.role} depth=${queue.size()} bytes=${queue.byteSize()}`);
    }
    queue.drain(m => this.transmit(m));
  }

  /** W2b diagnostics: number of DURABLE frames queued while the channel is dark (health-line backpressure). */
  outboundQueueDepth(): number {
    return this.outboundQueue?.size() ?? 0;
  }

  /** W2b (§4.3): whether the outbound queue overflowed + dropped its backlog (a reconnect resync is owed). */
  outboundQueueNeedsResync(): boolean {
    return this.logicalOutboundNeedsResync || (this.outboundQueue?.needsResync() ?? false);
  }

  /** W2b (§4.3): clear the resync-owed flag once the caller has issued the reconnect-from-revision request. */
  clearOutboundQueueResync(): void {
    this.outboundQueue?.clearResync();
    this.logicalOutboundNeedsResync = false;
  }

  /**
   * A connected-path REFUSED durable frame cannot be silently dropped. Mark retained recovery owed, close
   * the current peer channel so BOTH endpoints enter the existing bounded hot-rejoin path, and let its
   * durability tail/full snapshot reconstruct the lost logical frame. Cosmetic frames remain shed-able.
   */
  private escalateDurableRefusal(msg: CoopMessage, reason: string): void {
    if (classifyCoopMessage(msg) !== "durable") {
      return;
    }
    this.logicalOutboundNeedsResync = true;
    this.transportFailureReason = `durable transport refusal (${msg.t}): ${reason}`;
    if (this._state !== "connected" || this.logicalRecoveryGeneration === this.wireGeneration) {
      return;
    }
    this.logicalRecoveryGeneration = this.wireGeneration;
    this.blockedSendGeneration = this.wireGeneration;
    coopWarn(
      "webrtc",
      `durable refusal -> shared channel recovery role=${this.role} gen=${this.wireGeneration} t=${msg.t} reason=${reason}`,
    );
    // Notify this endpoint immediately, then close the real RTCDataChannel so the peer observes the same
    // channel-loss boundary and joins the symmetric re-dial. The runtime's established disconnect reaction
    // retains waits, reconnects durability, requests a full snapshot, and terminates coherently on exhaustion.
    // Capture the refused generation's carrier before notifying: a synchronous state listener is allowed to
    // install a replacement, and must never have that fresh carrier closed by the refusal cleanup below.
    const refusedWire = this.wire;
    this.setState("disconnected");
    try {
      refusedWire.close();
    } catch (error) {
      coopWarn(
        "webrtc",
        `durable refusal channel close threw role=${this.role}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Isolated fan-out of one already-validated inbound frame to every registered handler. */
  private dispatchInbound(msg: CoopMessage): void {
    for (const h of [...this.msgHandlers]) {
      try {
        h(msg);
      } catch (error) {
        // Fan-out isolation is load-bearing: a diagnostics/UI observer must never prevent a
        // later command or recovery consumer from receiving this already-validated frame.
        coopWarn(
          "webrtc",
          `raw rx role=${this.role} t=${msg.t} handler threw (isolated): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Replay early-buffered frames once a subscriber exists. Microtask-deferred (mirrors the
   * loopback pair's delivery timing) so a session controller that registers its handler
   * mid-construction finishes wiring before the backlog lands. Loops until the buffer is
   * empty so frames arriving DURING the replay keep strict arrival order.
   */
  private scheduleEarlyRxDrain(): void {
    if (this.earlyRxDrainScheduled || this.earlyRx.length === 0 || this.msgHandlers.size === 0) {
      return;
    }
    this.earlyRxDrainScheduled = true;
    queueMicrotask(() => {
      this.earlyRxDrainScheduled = false;
      if (this.msgHandlers.size === 0 || this._state === "closed") {
        return; // subscriber vanished - keep the backlog for the next subscription
      }
      this.earlyRxDraining = true;
      let drained = 0;
      try {
        while (this.earlyRx.length > 0) {
          const queued = this.earlyRx.splice(0);
          drained += queued.length;
          for (const msg of queued) {
            this.dispatchInbound(msg);
          }
        }
      } finally {
        this.earlyRxDraining = false;
      }
      coopLog("webrtc", `early-rx drain role=${this.role} n=${drained}`);
    });
  }

  /**
   * More than a full bounded handshake backlog before the first consumer exists is not a slow
   * subscriber any more. Silently dropping a later frame can lose the sole hello/fingerprint
   * and strand the compatibility barrier forever, so retire this generation and let the normal
   * connection-loss/rejoin path produce a deterministic terminal or a fresh exact handshake.
   */
  private failEarlyRxOverflow(msg: CoopMessage): void {
    const reason =
      "early receive buffer overflow before first subscriber "
      + `(role=${this.role} cap=${COOP_EARLY_RX_MAX_FRAMES} next=${msg.t})`;
    this.earlyRx.length = 0;
    coopWarn("webrtc", reason);
    this.handleConnectionLost(this.wire, this.wireGeneration, reason, true);
  }

  onMessage(handler: (msg: CoopMessage) => void): () => void {
    this.hasEverSubscribed = true;
    this.msgHandlers.add(handler);
    this.scheduleEarlyRxDrain();
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

  onV2Frame(handler: (frame: unknown) => void): () => void {
    this.v2FrameHandler = handler;
    return () => {
      if (this.v2FrameHandler === handler) {
        this.v2FrameHandler = null;
      }
    };
  }

  close(): void {
    coopLog("webrtc", `close() role=${this.role} state=${this._state}`);
    this.keepaliveCancel?.();
    this.keepaliveCancel = null;
    this.setState("closed");
    this.wire.close();
    this.inboundChunks.clear();
    this.completedInboundChunkIds.clear();
    this.earlyRx.length = 0;
    this.logicalOutbound.length = 0;
    this.logicalOutboundBytes = 0;
    this.blockedSendGeneration = null;
    this.logicalRecoveryGeneration = null;
    this.disconnectedGeneration = null;
    this.transportFailureReason = undefined;
    this.msgHandlers.clear();
    this.stateHandlers.clear();
    this.v2FrameHandler = null;
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

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation and transport-internal control dispatch intentionally share one parse boundary
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
    if (this.isChunkFrame(parsed)) {
      this.receiveChunk(parsed);
      return;
    }
    // authority-v2 boundary: a decoded object stamped v===2 is a v2 frame, NOT a legacy CoopMessage.
    // Route it through the ONE boundary validator (never the legacy `parsed as CoopMessage` cast) so a
    // malformed v2 frame is classified, not smuggled downstream. A v2 frame is only ever emitted when
    // BOTH peers negotiated authority.v2shadow, so this path is dead when the capability is off.
    if (parsed != null && typeof parsed === "object" && (parsed as { v?: unknown }).v === 2) {
      // Prefer THIS endpoint's per-instance handler; fall back to the module-level handler for compat.
      if (this.v2FrameHandler == null) {
        routeCoopV2InboundFrame(parsed);
      } else {
        this.v2FrameHandler(parsed);
      }
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
      // Early-rx buffering: no FIRST subscriber yet (or the buffered replay is still pending/
      // running - appending preserves arrival order across the replay boundary). See `earlyRx`.
      if ((!this.hasEverSubscribed && this.msgHandlers.size === 0) || this.earlyRx.length > 0 || this.earlyRxDraining) {
        if (this.earlyRx.length >= COOP_EARLY_RX_MAX_FRAMES) {
          this.failEarlyRxOverflow(msg);
          return;
        }
        this.earlyRx.push(msg);
        coopLog(
          "webrtc",
          `raw rx BUFFERED (no handlers yet) role=${this.role} t=${msg.t} queued=${this.earlyRx.length}`,
        );
        this.scheduleEarlyRxDrain();
        return;
      }
      this.dispatchInbound(msg);
    } else {
      coopWarn(
        "webrtc",
        `raw rx UNKNOWN frame role=${this.role} bytes=${data.length} (no string .t discriminant, dropped)`,
      );
    }
  }

  private isChunkFrame(value: unknown): value is CoopWireChunkFrame {
    if (value == null || typeof value !== "object") {
      return false;
    }
    const chunk = value as Partial<CoopWireChunkFrame>;
    return (
      chunk.__coopChunk === 1
      && typeof chunk.id === "string"
      && chunk.id.length > 0
      && Number.isInteger(chunk.index)
      && Number.isInteger(chunk.total)
      && typeof chunk.payload === "string"
      && Number.isInteger(chunk.bytes)
    );
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: adversarial chunk validation must fail closed before mutating one assembly
  private receiveChunk(chunk: CoopWireChunkFrame): void {
    if (this.completedInboundChunkIds.has(chunk.id)) {
      // The transfer id is terminal for this transport session. This fences a looped/duplicated carrier
      // that replays every chunk after the first complete delivery, not merely duplicates within assembly.
      coopLog("webrtc", `raw rx completed chunk replay DROPPED role=${this.role} id=${chunk.id}`);
      return;
    }
    if (
      chunk.total <= 0
      || chunk.total > COOP_WIRE_MAX_CHUNKS
      || chunk.index < 0
      || chunk.index >= chunk.total
      || chunk.bytes <= 0
      || chunk.bytes > COOP_WIRE_CHUNK_RAW_BYTES
      || chunk.payload.length > Math.ceil(COOP_WIRE_CHUNK_RAW_BYTES / 3) * 4
    ) {
      coopWarn("webrtc", `raw rx invalid chunk role=${this.role} id=${chunk.id} index=${chunk.index}/${chunk.total}`);
      this.inboundChunks.delete(chunk.id);
      return;
    }
    let decodedPart: Uint8Array;
    try {
      decodedPart = base64ToBytes(chunk.payload);
    } catch {
      coopWarn("webrtc", `raw rx invalid base64 chunk role=${this.role} id=${chunk.id} index=${chunk.index}`);
      this.inboundChunks.delete(chunk.id);
      return;
    }
    if (decodedPart.byteLength !== chunk.bytes) {
      coopWarn("webrtc", `raw rx invalid byte count role=${this.role} id=${chunk.id} index=${chunk.index}`);
      this.inboundChunks.delete(chunk.id);
      return;
    }
    let assembly = this.inboundChunks.get(chunk.id);
    if (assembly == null) {
      // Bound concurrent partial frames as well as each frame's final size. Reliable ordered SCTP
      // normally leaves only one; four allows overlapping application sends without unbounded input.
      if (this.inboundChunks.size >= 4) {
        const oldest = this.inboundChunks.keys().next().value;
        if (typeof oldest === "string") {
          this.inboundChunks.delete(oldest);
        }
      }
      assembly = { total: chunk.total, parts: new Array(chunk.total), received: 0, bytes: 0 };
      this.inboundChunks.set(chunk.id, assembly);
    }
    if (assembly.total !== chunk.total) {
      coopWarn("webrtc", `raw rx inconsistent chunk total role=${this.role} id=${chunk.id}`);
      this.inboundChunks.delete(chunk.id);
      return;
    }
    const prior = assembly.parts[chunk.index];
    if (prior != null) {
      if (prior !== chunk.payload) {
        coopWarn("webrtc", `raw rx conflicting duplicate chunk role=${this.role} id=${chunk.id}`);
        this.inboundChunks.delete(chunk.id);
      }
      return;
    }
    assembly.parts[chunk.index] = chunk.payload;
    assembly.received++;
    assembly.bytes += decodedPart.byteLength;
    if (assembly.bytes > COOP_WIRE_MAX_REASSEMBLED_BYTES) {
      coopWarn("webrtc", `raw rx oversized chunk assembly role=${this.role} id=${chunk.id}`);
      this.inboundChunks.delete(chunk.id);
      return;
    }
    if (assembly.received !== assembly.total) {
      return;
    }
    this.inboundChunks.delete(chunk.id);
    const completeBytes = new Uint8Array(assembly.bytes);
    let offset = 0;
    try {
      for (const payload of assembly.parts) {
        if (payload == null) {
          throw new Error("missing chunk");
        }
        const part = base64ToBytes(payload);
        completeBytes.set(part, offset);
        offset += part.byteLength;
      }
    } catch {
      coopWarn("webrtc", `raw rx chunk decode failed role=${this.role} id=${chunk.id}`);
      return;
    }
    let complete: string;
    try {
      complete = new TextDecoder("utf-8", { fatal: true }).decode(completeBytes);
    } catch {
      coopWarn("webrtc", `raw rx invalid UTF-8 assembly role=${this.role} id=${chunk.id}`);
      return;
    }
    this.rememberCompletedInboundChunkId(chunk.id);
    coopLog("webrtc", `raw rx REASSEMBLED role=${this.role} bytes=${assembly.bytes} chunks=${assembly.total}`);
    this.receive(complete);
  }

  /** Retain a bounded insertion-ordered fence for completed logical transfer ids. */
  private rememberCompletedInboundChunkId(id: string): void {
    this.completedInboundChunkIds.add(id);
    while (this.completedInboundChunkIds.size > COOP_WIRE_COMPLETED_TRANSFER_RETENTION) {
      const oldest = this.completedInboundChunkIds.values().next().value;
      if (typeof oldest !== "string") {
        break;
      }
      this.completedInboundChunkIds.delete(oldest);
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
  initialConnectionGeneration = 0,
): WebRtcTransport {
  const transport = new WebRtcTransport(role, wireFromRtcChannel(role, channel, pc), initialConnectionGeneration);
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
  let connectionLostReason: string | undefined;
  let disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  const connectionLostHandlers = new Set<(reason: string) => void>();
  const clearDisconnectedTimer = (): void => {
    if (disconnectedTimer != null) {
      clearTimeout(disconnectedTimer);
      disconnectedTimer = null;
    }
  };
  const notifyConnectionLost = (reason: string): void => {
    if (connectionLostReason != null) {
      return;
    }
    clearDisconnectedTimer();
    connectionLostReason = reason;
    coopWarn("webrtc", `peer connection LOST role=${role} reason=${reason} channel=${channel.readyState}`);
    for (const handler of connectionLostHandlers) {
      handler(reason);
    }
  };
  const scheduleDisconnected = (source: "peer" | "ice"): void => {
    if (connectionLostReason != null || disconnectedTimer != null) {
      return;
    }
    coopWarn(
      "webrtc",
      `peer connection DISCONNECTED role=${role} source=${source} grace=${COOP_PC_DISCONNECTED_GRACE_MS}ms channel=${channel.readyState}`,
    );
    disconnectedTimer = setTimeout(() => {
      disconnectedTimer = null;
      notifyConnectionLost(`${source} connection remained disconnected for ${COOP_PC_DISCONNECTED_GRACE_MS}ms`);
    }, COOP_PC_DISCONNECTED_GRACE_MS);
  };
  const observePeerConnection = (): void => {
    if (pc == null || connectionLostReason != null) {
      return;
    }
    const state = pc.connectionState;
    coopLog("webrtc", `peer connection state role=${role} state=${state} channel=${channel.readyState}`);
    if (state === "failed" || state === "closed") {
      notifyConnectionLost(`peer connection ${state}`);
    } else if (state === "disconnected") {
      scheduleDisconnected("peer");
    } else if (state === "connected") {
      clearDisconnectedTimer();
    }
  };
  const observeIceConnection = (): void => {
    if (pc == null || connectionLostReason != null) {
      return;
    }
    const state = pc.iceConnectionState;
    coopLog("webrtc", `ICE connection state role=${role} state=${state} channel=${channel.readyState}`);
    if (state === "failed" || state === "closed") {
      notifyConnectionLost(`ICE connection ${state}`);
    } else if (state === "disconnected") {
      scheduleDisconnected("ice");
    } else if (state === "connected" || state === "completed") {
      clearDisconnectedTimer();
    }
  };
  channel.addEventListener("error", ev => {
    const errLike = (ev as { error?: { message?: string } }).error;
    lastError = errLike?.message ?? "?";
    coopWarn("webrtc", `channel ERROR role=${role} readyState=${channel.readyState} err=${lastError}`);
  });
  pc?.addEventListener("connectionstatechange", observePeerConnection);
  pc?.addEventListener("iceconnectionstatechange", observeIceConnection);
  const wire: CoopWireChannel = {
    get readyState() {
      return channel.readyState;
    },
    get bufferedAmount() {
      return channel.bufferedAmount;
    },
    get bufferedAmountLowThreshold() {
      return channel.bufferedAmountLowThreshold;
    },
    set bufferedAmountLowThreshold(value: number) {
      channel.bufferedAmountLowThreshold = value;
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
        clearDisconnectedTimer();
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
    onConnectionLost: handler => {
      connectionLostHandlers.add(handler);
      if (connectionLostReason != null) {
        handler(connectionLostReason);
      }
    },
    onBufferedAmountLow: handler => {
      channel.addEventListener("bufferedamountlow", () => handler());
    },
  };
  // Do not wait for a future event if the adapter is handed an already-terminal peer connection.
  observePeerConnection();
  observeIceConnection();
  return wire;
}
