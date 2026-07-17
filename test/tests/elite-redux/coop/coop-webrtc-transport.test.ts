/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op WebRTC transport (#633, P6): the FRAMING layer of the real-peer transport
// - JSON encode/decode, connection-state mapping, malformed-frame rejection - is
// verified headlessly against a mock data channel (no live ICE). Also proves the
// CoopSessionController runs unchanged over WebRtcTransport (transport-agnostic).

import { setCoopDurabilityEnabled } from "#data/elite-redux/coop/coop-durability";
import { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import type { CoopConnectionState, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { COOP_PROTOCOL_VERSION, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import {
  COOP_EARLY_RX_MAX_FRAMES,
  COOP_KEEPALIVE_MS,
  COOP_PC_DISCONNECTED_GRACE_MS,
  COOP_WIRE_BUFFER_HIGH_BYTES,
  COOP_WIRE_CHUNK_PAYLOAD_CHARS,
  type CoopWireChannel,
  WebRtcTransport,
  wireFromRtcChannel,
} from "#data/elite-redux/coop/coop-webrtc-transport";
import { GameModes } from "#enums/game-modes";
import { afterEach, describe, expect, it, vi } from "vitest";

const TEST_RUN_ID = `test-run-${"a".repeat(24)}`;
const TEST_CONTROL_PLANE = { interactionCounter: 0, journalHighWater: {} } as const;

function loadedResumeSession<T extends object>(session: T, sessionJson = JSON.stringify(session)) {
  return { session, sessionJson };
}

/** In-process mock of a data channel implementing {@linkcode CoopWireChannel}.
 *  Two are cross-wired (`link`) to simulate the two ends of an open channel. */
class MockWire implements CoopWireChannel {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MockWire | null = null;
  sent: string[] = [];
  throwOnSendNumber: number | null = null;
  private sendCount = 0;
  /** #857: settable so a test can assert the transport surfaces the channel's last error as the drop reason. */
  lastError: string | undefined = undefined;
  private msgHandler: ((d: string) => void) | null = null;
  private openHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private bufferedAmountLowHandler: (() => void) | null = null;

  send(data: string): void {
    this.sendCount++;
    if (this.throwOnSendNumber === this.sendCount) {
      throw new Error(`forced send failure ${this.sendCount}`);
    }
    this.sent.push(data);
    this.peer?.msgHandler?.(data);
  }
  close(): void {
    if (this.readyState === "closed") {
      return;
    }
    this.readyState = "closed";
    this.closeHandler?.();
    if (this.peer && this.peer.readyState !== "closed") {
      this.peer.readyState = "closed";
      this.peer.closeHandler?.();
    }
  }
  onMessage(handler: (d: string) => void): void {
    this.msgHandler = handler;
  }
  onOpen(handler: () => void): void {
    this.openHandler = handler;
  }
  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }
  onBufferedAmountLow(handler: () => void): void {
    this.bufferedAmountLowHandler = handler;
  }
  /** Deliver a RAW frame to this end (bypassing the peer) - for malformed-frame tests. */
  injectRaw(data: string): void {
    this.msgHandler?.(data);
  }
  /** Fire the open event (for the connecting->connected transition test). */
  fireOpen(): void {
    this.readyState = "open";
    this.openHandler?.();
  }
  fireBufferedAmountLow(): void {
    this.bufferedAmountLowHandler?.();
  }
}

function linkedWires(): { a: MockWire; b: MockWire } {
  const a = new MockWire();
  const b = new MockWire();
  a.peer = b;
  b.peer = a;
  return { a, b };
}

function resumeCommitment(wave: number, host = "H", guest = "G") {
  return {
    version: 1 as const,
    digest: "0".repeat(64),
    gameMode: GameModes.COOP,
    wave,
    revision: 0,
    runId: TEST_RUN_ID,
    checkpointRevision: wave,
    timestamp: wave * 10,
    participants: [host, guest].sort() as [string, string],
    seats: { host, guest },
  };
}

describe("co-op WebRTC transport (#633, P6) - framing", () => {
  it("serializes a message to JSON and the peer receives the parsed message", () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);

    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    const msg: CoopMessage = { t: "hello", version: "1", username: "Ash", role: "host", epoch: 1 };
    host.send(msg);

    // Sent as a JSON string on the wire...
    expect(a.sent).toEqual([JSON.stringify(msg)]);
    // ...and decoded back into the same message on the peer.
    expect(received).toEqual([msg]);
  });

  it("chunks and exactly reassembles a realistic late-campaign resume checkpoint below SCTP frame limits", () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    const msg: CoopMessage = {
      t: "resumeCheckpoint",
      checkpointId: "late-wave-large-save",
      commitment: resumeCommitment(200),
      session: JSON.stringify({ waveIndex: 200, accumulatedRunState: "x".repeat(512_000) }),
      mirrorCloud: true,
    };

    host.send(msg);

    expect(a.sent.length, "large checkpoint was split into bounded wire frames").toBeGreaterThan(1);
    expect(
      Math.max(...a.sent.map(frame => frame.length)),
      "each encoded chunk stays well below a typical RTCDataChannel maxMessageSize",
    ).toBeLessThan(COOP_WIRE_CHUNK_PAYLOAD_CHARS * 2);
    expect(received, "the protocol consumer sees one byte-exact logical checkpoint").toEqual([msg]);
  });

  it("uses UTF-8 byte chunks and restarts chunk zero with a new id after a mid-send channel replacement", () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    const msg: CoopMessage = {
      t: "resumeCheckpoint",
      checkpointId: "utf8-mid-send",
      commitment: resumeCommitment(77),
      session: JSON.stringify({
        waveIndex: 77,
        quoteHeavy: '"quoted\\\\path" — café — 漢字 — 🧬 — e\u0301\n'.repeat(20_000),
      }),
      mirrorCloud: false,
    };
    a.throwOnSendNumber = 6;

    host.send(msg);
    expect(received, "a partial transfer never reaches the protocol consumer").toEqual([]);
    const abandoned = a.sent.map(frame => JSON.parse(frame)).filter(frame => frame.__coopChunk === 1);
    expect(abandoned.length).toBe(5);
    expect(abandoned[0].index).toBe(0);

    const next = linkedWires();
    guest.replaceChannel(next.b);
    host.replaceChannel(next.a);

    expect(received, "replacement reassembles one complete logical checkpoint").toEqual([msg]);
    const restarted = next.a.sent.map(frame => JSON.parse(frame)).filter(frame => frame.__coopChunk === 1);
    expect(restarted[0].index, "replacement starts from chunk zero").toBe(0);
    expect(restarted[0].id, "replacement owns a new transfer id").not.toBe(abandoned[0].id);
    for (const frame of restarted) {
      expect(frame.bytes).toBeLessThanOrEqual(COOP_WIRE_CHUNK_PAYLOAD_CHARS);
      expect(Uint8Array.from(atob(frame.payload), char => char.charCodeAt(0)).byteLength).toBe(frame.bytes);
    }

    const continued: CoopMessage = { t: "stallBeat", waitingMs: 123 };
    host.send(continued);
    expect(received, "FIFO continues after the restarted logical transfer").toEqual([msg, continued]);
  });

  it("pauses above bufferedAmount high-water and resumes only on bufferedamountlow", () => {
    const { a, b } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    const msg: CoopMessage = { t: "stallBeat", waitingMs: 456 };

    host.send(msg);
    expect(a.sent, "no frame is accepted above the high-water byte budget").toEqual([]);
    expect(received).toEqual([]);

    a.bufferedAmount = 0;
    a.fireBufferedAmountLow();
    expect(a.bufferedAmountLowThreshold).toBeGreaterThan(0);
    expect(received, "the queued logical message resumes in FIFO order").toEqual([msg]);
  });

  it("isolates a throwing subscriber so later WebRTC and loopback protocol consumers still receive the frame", async () => {
    const msg: CoopMessage = { t: "stallBeat", waitingMs: 7 };

    const wire = new MockWire();
    const rtc = new WebRtcTransport("guest", wire);
    const rtcReceived: CoopMessage[] = [];
    rtc.onMessage(() => {
      throw new Error("diagnostic observer failed");
    });
    rtc.onMessage(frame => rtcReceived.push(frame));
    expect(() => wire.injectRaw(JSON.stringify(msg))).not.toThrow();
    expect(rtcReceived).toEqual([msg]);

    const loopback = createLoopbackPair();
    const loopbackReceived: CoopMessage[] = [];
    loopback.guest.onMessage(() => {
      throw new Error("UI observer failed");
    });
    loopback.guest.onMessage(frame => loopbackReceived.push(frame));
    loopback.host.send(msg);
    await Promise.resolve();
    expect(loopbackReceived).toEqual([msg]);
  });

  it("reports connected when the channel is already open, and maps open/close events", () => {
    const wire = new MockWire();
    wire.readyState = "connecting";
    const t = new WebRtcTransport("host", wire);
    const states: CoopConnectionState[] = [];
    t.onStateChange(s => states.push(s));
    expect(t.state).toBe("connecting");

    wire.fireOpen();
    expect(t.state).toBe("connected");
    expect(states).toContain("connected");
  });

  it("drops malformed frames without throwing (a bad peer can't crash us)", () => {
    const wire = new MockWire();
    const t = new WebRtcTransport("guest", wire);
    const received: CoopMessage[] = [];
    t.onMessage(m => received.push(m));

    wire.injectRaw("not json at all");
    wire.injectRaw("42"); // valid JSON but not an object
    wire.injectRaw(JSON.stringify({ noTypeField: true })); // object without `t`
    expect(received).toHaveLength(0); // all ignored

    // A well-formed (non-keepalive) frame still gets through.
    wire.injectRaw(JSON.stringify({ t: "stallBeat", waitingMs: 1 }));
    expect(received).toEqual([{ t: "stallBeat", waitingMs: 1 }]);
  });

  it("close() flips to closed, notifies listeners, and silences further sends", () => {
    const { a } = linkedWires();
    const t = new WebRtcTransport("host", a);
    const states: CoopConnectionState[] = [];
    t.onStateChange(s => states.push(s));

    t.close();
    expect(t.state).toBe("closed");
    expect(states).toContain("closed");

    // Sending after close is a no-op (nothing new on the wire).
    const before = a.sent.length;
    t.send({ t: "ping", ts: 2 });
    expect(a.sent.length).toBe(before);
  });

  it("does not send while the channel is not open", () => {
    const wire = new MockWire();
    wire.readyState = "connecting";
    const t = new WebRtcTransport("host", wire);
    t.send({ t: "ping", ts: 3 });
    expect(wire.sent).toHaveLength(0); // state is "connecting", not "connected"
  });
});

describe("W2b durability (§4.3): the outbound queue replaces drop-on-not-open for durable frames", () => {
  afterEach(() => setCoopDurabilityEnabled(true));

  it("QUEUES a durable frame sent while the channel is dark, then flushes it FIFO on open (no silent drop)", () => {
    setCoopDurabilityEnabled(true);
    const wire = new MockWire();
    wire.readyState = "connecting"; // transport starts "connecting", not "connected"
    const t = new WebRtcTransport("host", wire);

    // A durable frame sent while dark is NOT dropped - it is held in the queue.
    t.send({ t: "waveResolved", wave: 7, outcome: "win" });
    t.send({ t: "waveResolved", wave: 8, outcome: "win" });
    expect(wire.sent).toHaveLength(0); // nothing on the wire yet
    expect(t.outboundQueueDepth()).toBe(2);

    // The channel comes up: the queued frames flush FIFO.
    wire.fireOpen();
    expect(t.outboundQueueDepth()).toBe(0);
    expect(wire.sent.map(f => JSON.parse(f).wave)).toEqual([7, 8]);
  });

  it("SHEDS cosmetic + internal frames while dark (fire-and-forget, never queued)", () => {
    setCoopDurabilityEnabled(true);
    const wire = new MockWire();
    wire.readyState = "connecting";
    const t = new WebRtcTransport("host", wire);

    t.send({
      t: "battleEvent",
      epoch: 7,
      wave: 1,
      turn: 1,
      seq: 0,
      event: { k: "msg", text: "x" } as never,
    }); // cosmetic
    t.send({ t: "ping", ts: 1 }); // internal
    expect(t.outboundQueueDepth()).toBe(0);
    wire.fireOpen();
    expect(wire.sent).toHaveLength(0); // nothing queued, nothing replayed
  });

  it("with the flag OFF, a durable dark send is DROPPED (legacy behavior, no queue)", () => {
    setCoopDurabilityEnabled(false);
    const wire = new MockWire();
    wire.readyState = "connecting";
    const t = new WebRtcTransport("host", wire);
    t.send({ t: "waveResolved", wave: 9, outcome: "win" });
    expect(t.outboundQueueDepth()).toBe(0);
    wire.fireOpen();
    expect(wire.sent).toHaveLength(0); // dropped, never queued (pre-W2b behavior)
  });

  it("hot rejoin (#805): frames queued while dark flush over the FRESH wire on replaceChannel", () => {
    setCoopDurabilityEnabled(true);
    const wireA = new MockWire();
    const t = new WebRtcTransport("host", wireA);
    expect(t.state).toBe("connected");

    // Channel dies; a durable frame is committed while dark and must survive the rejoin.
    wireA.close();
    expect(t.state).toBe("disconnected");
    t.send({ t: "waveResolved", wave: 11, outcome: "win" });
    expect(t.outboundQueueDepth()).toBe(1);

    // Re-dial: a fresh already-open wire swaps in -> the queued frame flushes over it.
    const wireB = new MockWire(); // readyState "open"
    t.replaceChannel(wireB);
    expect(t.state).toBe("connected");
    expect(t.outboundQueueDepth()).toBe(0);
    expect(wireB.sent.map(f => JSON.parse(f).wave)).toEqual([11]);
  });

  it("error-caught send: a wire whose send() throws does not propagate out of transmit", () => {
    setCoopDurabilityEnabled(true);
    const wire = new MockWire();
    wire.send = () => {
      throw new Error("SCTP abort mid-send");
    };
    const t = new WebRtcTransport("host", wire);
    // Before W2b this threw out of send() into the caller; now it is caught (the close event drives rejoin).
    expect(() => t.send({ t: "waveResolved", wave: 12, outcome: "win" })).not.toThrow();
  });
});

describe("#857 keepalive: an idle data channel is kept warm so it can't idle out into the reconnect flap", () => {
  /** A manual scheduler: captures the keepalive callback so the test drives ticks deterministically. */
  class ManualSchedule {
    private cb: (() => void) | null = null;
    ms = -1;
    readonly schedule = (fn: () => void, interval: number): (() => void) => {
      this.cb = fn;
      this.ms = interval;
      return () => {
        this.cb = null;
      };
    };
    tick(): void {
      this.cb?.();
    }
  }

  it("REGRESSION (flap root): an idle connected channel sends a keepalive ping on each tick", () => {
    const wire = new MockWire();
    const t = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();

    // Before startKeepalive, an idle channel sends NOTHING (the pre-fix behavior that let it idle out).
    sched.tick();
    expect(wire.sent).toHaveLength(0);

    t.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule);
    expect(sched.ms).toBe(COOP_KEEPALIVE_MS);

    // Now every tick keeps the path warm with a ping frame (the fix).
    sched.tick();
    sched.tick();
    expect(wire.sent).toHaveLength(2);
    for (const frame of wire.sent) {
      expect(JSON.parse(frame).t).toBe("ping");
    }
  });

  it("does not ping when disconnected/closed (no traffic on a dead wire)", () => {
    const wire = new MockWire();
    wire.readyState = "connecting"; // -> transport starts "connecting", not "connected"
    const t = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    t.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule);

    sched.tick();
    expect(wire.sent).toHaveLength(0); // not connected yet

    wire.fireOpen(); // -> connected
    sched.tick();
    expect(wire.sent).toHaveLength(1); // now warms the path

    t.close();
    const before = wire.sent.length;
    sched.tick(); // the timer is cancelled on close; even if driven, a closed transport sends nothing
    expect(wire.sent.length).toBe(before);
  });

  it("startKeepalive is idempotent (a second call does not start a second timer)", () => {
    const wire = new MockWire();
    const t = new WebRtcTransport("host", wire);
    let scheduled = 0;
    const schedule = (_cb: () => void, _ms: number) => {
      scheduled++;
      return () => {};
    };
    t.startKeepalive(COOP_KEEPALIVE_MS, schedule);
    t.startKeepalive(COOP_KEEPALIVE_MS, schedule);
    expect(scheduled).toBe(1);
  });

  it("keepalive ping/pong frames are transport-internal (never surface to the session layer)", () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const guestGot: string[] = [];
    guest.onMessage(m => guestGot.push(m.t));

    // A keepalive from the host is swallowed by the guest transport (no fan-out)...
    host.send({ t: "ping", ts: 1 });
    host.send({ t: "pong", ts: 2 });
    expect(guestGot).toHaveLength(0);

    // ...but a real gameplay frame still flows through.
    host.send({ t: "waveResolved", wave: 3, outcome: "win" });
    expect(guestGot).toEqual(["waveResolved"]);
  });

  it("disconnectReason() surfaces the wire's last channel error for the reconnect banner", () => {
    const wire = new MockWire();
    const t = new WebRtcTransport("guest", wire);
    expect(t.disconnectReason()).toBeUndefined();

    wire.lastError = "User-Initiated Abort, reason=Close called";
    expect(t.disconnectReason()).toBe("User-Initiated Abort, reason=Close called");
  });
});

describe("co-op session controller over WebRtcTransport (#633, P6) - transport-agnostic", () => {
  it("runs the full roster handshake unchanged over the WebRTC framing", () => {
    const { a, b } = linkedWires();
    const h = new CoopSessionController(new WebRtcTransport("host", a), { username: "Red" });
    const g = new CoopSessionController(new WebRtcTransport("guest", b), { username: "Blue" });

    // The mock delivers synchronously, so no microtask flush is needed.
    h.connect();
    g.connect();
    expect(h.partnerName).toBe("Blue");
    expect(g.partnerName).toBe("Red");

    h.setLocalRoster([{ speciesId: 3, cost: 5 }]);
    g.setLocalRoster([{ speciesId: 6, cost: 3 }]);
    h.setLocalReady(true);
    g.setLocalReady(true);

    expect(h.partnerEntries().map(e => e.speciesId)).toEqual([6]);
    expect(g.partnerEntries().map(e => e.speciesId)).toEqual([3]);
    expect(h.bothReady()).toBe(true);
    expect(g.bothReady()).toBe(true);
  });
});

describe("hot rejoin (#805): replaceChannel swaps a fresh wire into the LIVE transport", () => {
  function pairedWires(): [MockWire, MockWire] {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  it("channel death -> disconnected; replaceChannel -> connected; messages flow over the NEW wire; stale wire events are inert", () => {
    const [hostWireA, guestWireA] = pairedWires();
    const host = new WebRtcTransport("host", hostWireA);
    const guest = new WebRtcTransport("guest", guestWireA);
    expect(host.state).toBe("connected");

    const guestGot: string[] = [];
    guest.onMessage(msg => guestGot.push(msg.t));
    const hostStates: string[] = [];
    host.onStateChange(st => hostStates.push(st));

    // The live channel dies (network blip): both transports report disconnected.
    hostWireA.close();
    expect(host.state).toBe("disconnected");
    expect(guest.state).toBe("disconnected");
    expect(hostStates).toContain("disconnected");

    // Re-dial: a fresh wire pair is swapped into BOTH live transports in place.
    const [hostWireB, guestWireB] = pairedWires();
    host.replaceChannel(hostWireB);
    guest.replaceChannel(guestWireB);
    expect(host.state).toBe("connected");
    expect(guest.state).toBe("connected");
    expect(hostStates).toContain("connected");

    // The SAME transport objects carry messages over the new wire - the session stack
    // above (controller/relays/streamers) never noticed the swap.
    host.send({ t: "waveResolved", wave: 5, outcome: "win" });
    expect(guestGot).toContain("waveResolved");

    // Stale events from the DEAD wire are inert (generation guard): a late frame or
    // close on wire A must not corrupt the reconnected transport.
    guestWireA.injectRaw(JSON.stringify({ t: "waveResolved", wave: 99, outcome: "win" }));
    expect(guestGot.filter(t => t === "waveResolved").length).toBe(1);
    hostWireA.close();
    expect(host.state).toBe("connected");
  });
});

describe("#857 R2 (intermittent flap): the hot-rejoin transport retires the SUPERSEDED RTCPeerConnection", () => {
  // Minimal duck-typed stand-ins for the real DOM RTC objects (browser-only; not constructible headless).
  // wireFromRtcChannel only touches these members, so a structural fake exercises the close path exactly.
  function fakeChannel(log: string[], readyState = "open"): RTCDataChannel {
    return {
      readyState,
      send: (d: string) => log.push(`ch.send:${d}`),
      close: () => log.push("ch.close"),
      addEventListener: (type: string) => log.push(`ch.on:${type}`),
    } as unknown as RTCDataChannel;
  }
  function fakePc(log: string[]): RTCPeerConnection {
    return {
      connectionState: "connected",
      iceConnectionState: "connected",
      close: () => log.push("pc.close"),
      addEventListener: (type: string) => log.push(`pc.on:${type}`),
    } as unknown as RTCPeerConnection;
  }

  it("REGRESSION (flap root): closing a wire closes BOTH the data channel and its OWNING pc (no leaked zombie pc)", () => {
    const log: string[] = [];
    const wire = wireFromRtcChannel("host", fakeChannel(log), fakePc(log));

    // Superseding a wire (what replaceChannel does to the OLD wire on every #805 hot rejoin) must retire
    // the pc too. Before the fix the pc was never closed -> it stayed live (ICE/DTLS/TURN) and a superseded
    // (zombie) pc later aborted the fresh channel ("User-Initiated Abort, reason=Close called") -> the flap.
    wire.close();
    expect(log).toContain("ch.close");
    expect(log).toContain("pc.close");
  });

  it("replaceChannel retires the OLD generation's pc and leaves the NEW one live (the leak that caused the flap)", () => {
    const oldLog: string[] = [];
    const newLog: string[] = [];
    const transport = new WebRtcTransport("host", wireFromRtcChannel("host", fakeChannel(oldLog), fakePc(oldLog)));
    expect(transport.state).toBe("connected");

    // Hot rejoin (#805): a freshly-dialed channel+pc swaps into the LIVE transport in place.
    transport.replaceChannel(wireFromRtcChannel("host", fakeChannel(newLog), fakePc(newLog)));
    expect(transport.state).toBe("connected");

    // The superseded pc is fully retired (before the fix it leaked and later aborted the live channel)...
    expect(oldLog).toContain("pc.close");
    // ...and the live pc is untouched (still carrying the session).
    expect(newLog).not.toContain("pc.close");
  });
});

describe("peer-connection lifecycle: a failed PC cannot hide behind an open DataChannel", () => {
  class FakeRtcChannel {
    readyState: RTCDataChannelState = "open";
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    closeCount = 0;
    private readonly listeners = new Map<string, Array<(event: Event) => void>>();

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(callback);
      this.listeners.set(type, listeners);
    }

    send(): void {}

    close(): void {
      this.closeCount++;
      if (this.readyState === "closed") {
        return;
      }
      this.readyState = "closed";
      this.fire("close");
    }

    fire(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    }
  }

  class FakeRtcPeerConnection {
    connectionState: RTCPeerConnectionState = "connected";
    iceConnectionState: RTCIceConnectionState = "connected";
    closeCount = 0;
    private readonly listeners = new Map<string, Array<(event: Event) => void>>();

    addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
      const callback = typeof listener === "function" ? listener : (event: Event) => listener.handleEvent(event);
      const listeners = this.listeners.get(type) ?? [];
      listeners.push(callback);
      this.listeners.set(type, listeners);
    }

    close(): void {
      this.closeCount++;
      if (this.connectionState === "closed") {
        return;
      }
      this.connectionState = "closed";
      this.fire("connectionstatechange");
    }

    setConnectionState(state: RTCPeerConnectionState): void {
      this.connectionState = state;
      this.fire("connectionstatechange");
    }

    fire(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(new Event(type));
      }
    }
  }

  function makeTransport() {
    const channel = new FakeRtcChannel();
    const pc = new FakeRtcPeerConnection();
    const transport = new WebRtcTransport(
      "host",
      wireFromRtcChannel("host", channel as unknown as RTCDataChannel, pc as unknown as RTCPeerConnection),
    );
    const states: CoopConnectionState[] = [];
    transport.onStateChange(state => states.push(state));
    return { channel, pc, states, transport };
  }

  it.each([
    "failed",
    "closed",
  ] as const)("treats peer connection %s as immediately terminal even while the DataChannel still says open", terminalState => {
    const { channel, pc, states, transport } = makeTransport();
    expect(channel.readyState).toBe("open");

    pc.setConnectionState(terminalState);

    expect(transport.state).toBe("disconnected");
    expect(states, "lifecycle/rejoin receives exactly one disconnect transition").toEqual(["disconnected"]);
    expect(transport.disconnectReason()).toBe(`peer connection ${terminalState}`);
    expect(channel.closeCount, "the stuck-open data channel is retired").toBe(1);
    expect(pc.closeCount, "the failed peer connection is retired").toBe(1);

    pc.fire("connectionstatechange");
    channel.fire("close");
    expect(states, "duplicate carrier callbacks cannot start another rejoin").toEqual(["disconnected"]);
  });

  it("debounces a transient disconnected state, cancels on recovery, then fails once after the bounded grace", async () => {
    vi.useFakeTimers();
    try {
      const { channel, pc, states, transport } = makeTransport();
      pc.setConnectionState("disconnected");
      await vi.advanceTimersByTimeAsync(COOP_PC_DISCONNECTED_GRACE_MS - 1);
      expect(transport.state).toBe("connected");
      expect(channel.readyState).toBe("open");

      pc.setConnectionState("connected");
      await vi.advanceTimersByTimeAsync(COOP_PC_DISCONNECTED_GRACE_MS + 1);
      expect(transport.state, "a recovered ICE route keeps the current generation").toBe("connected");
      expect(states).toEqual([]);

      pc.setConnectionState("disconnected");
      await vi.advanceTimersByTimeAsync(COOP_PC_DISCONNECTED_GRACE_MS);
      expect(transport.state).toBe("disconnected");
      expect(states).toEqual(["disconnected"]);
      expect(transport.disconnectReason()).toContain("remained disconnected");
    } finally {
      vi.useRealTimers();
    }
  });

  it("generation-fences obsolete peer-connection callbacks after a replacement", () => {
    const first = makeTransport();
    const replacementChannel = new FakeRtcChannel();
    const replacementPc = new FakeRtcPeerConnection();
    first.transport.replaceChannel(
      wireFromRtcChannel(
        "host",
        replacementChannel as unknown as RTCDataChannel,
        replacementPc as unknown as RTCPeerConnection,
      ),
    );
    expect(first.transport.state).toBe("connected");

    first.pc.setConnectionState("failed");
    expect(first.transport.state, "the superseded PC cannot tear down the replacement").toBe("connected");
    expect(first.states).toEqual([]);
    expect(replacementChannel.closeCount).toBe(0);

    replacementPc.setConnectionState("failed");
    expect(first.transport.state).toBe("disconnected");
    expect(first.states).toEqual(["disconnected"]);
    expect(replacementChannel.closeCount).toBe(1);
  });
});

describe("stall watchdog sensor (#806): oldestNetworkWaitMs tracks parked network waits", () => {
  it("is -1 with no waits, grows while parked, -1 again after resolution", async () => {
    const [a, b] = (() => {
      const x = new MockWire();
      const y = new MockWire();
      x.peer = y;
      y.peer = x;
      return [x, y];
    })();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const relay = new CoopInteractionRelay(host);
    const guestRelay = new CoopInteractionRelay(guest);
    expect(relay.oldestNetworkWaitMs()).toBe(-1);

    // Park a network wait (no buffered choice): the sensor must report a non-negative age.
    const wait = relay.awaitInteractionChoice(4242, 5_000);
    expect(relay.oldestNetworkWaitMs()).toBeGreaterThanOrEqual(0);

    // The peer answers: the wait resolves and the sensor returns to idle.
    guestRelay.sendInteractionChoice(4242, "test", 1);
    const res = await wait;
    expect(res?.choice).toBe(1);
    expect(relay.oldestNetworkWaitMs()).toBe(-1);
  });
});

describe("#807 C: protocol version negotiation", () => {
  it("a partner hello with a DIFFERENT version flips versionMismatch (stale-bundle detection)", () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const hostCtl = new CoopSessionController(host, { username: "H", version: COOP_PROTOCOL_VERSION });
    const guestCtl = new CoopSessionController(guest, { username: "G", version: "er-coop-STALE" });
    hostCtl.connect();
    guestCtl.connect();
    expect(hostCtl.versionMismatch).toBe(true);
    expect(hostCtl.partnerVersion).toBe("er-coop-STALE");
    expect(guestCtl.versionMismatch).toBe(true);
    hostCtl.setLocalRoster([{ speciesId: 1, cost: 1 }]);
    guestCtl.setLocalRoster([{ speciesId: 2, cost: 1 }]);
    hostCtl.setLocalReady(true);
    guestCtl.setLocalReady(true);
    expect(hostCtl.bothReady(), "incompatible peers can never cross the launch barrier").toBe(false);
    expect(guestCtl.bothReady(), "incompatible peers can never cross the launch barrier").toBe(false);

    // Same version on both sides: no mismatch.
    const c = new MockWire();
    const d = new MockWire();
    c.peer = d;
    d.peer = c;
    const h2 = new CoopSessionController(new WebRtcTransport("host", c), {
      username: "H",
      version: COOP_PROTOCOL_VERSION,
    });
    const g2 = new CoopSessionController(new WebRtcTransport("guest", d), {
      username: "G",
      version: COOP_PROTOCOL_VERSION,
    });
    h2.connect();
    g2.connect();
    expect(h2.versionMismatch).toBe(false);
    expect(g2.versionMismatch).toBe(false);
  });
});

describe("#810: resume offer/reply protocol + marker", () => {
  it("identity barrier waits for the peer hello before pair-keyed resume discovery", async () => {
    const a = new MockWire();
    const b = new MockWire();
    // Delay host -> guest delivery to model the real data-channel scheduling gap between
    // connectCoopSession returning and the peer hello arriving.
    a.peer = null;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "Alice" });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "Bob" });

    // This is the live ordering: connectCoopSession sends OUR hello and returns before the
    // peer has necessarily sent theirs. The title callback must not read partnerName yet.
    host.connect();
    expect(host.partnerName, "peer identity is genuinely not known at the old decision seam").toBeNull();
    let settled = false;
    const identity = host.awaitPartnerIdentity(1_000).then(snapshot => {
      settled = true;
      return snapshot;
    });
    await Promise.resolve();
    expect(settled, "resume discovery remains behind the hello barrier").toBe(false);

    a.peer = b;
    guest.connect();
    await expect(identity).resolves.toMatchObject({
      localRole: "host",
      partnerConnected: true,
      partnerName: "Bob",
    });
  });

  it("identity barrier fails closed when no peer hello arrives", async () => {
    vi.useFakeTimers();
    try {
      const a = new MockWire();
      const b = new MockWire();
      a.peer = b;
      b.peer = a;
      const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "Alice" });
      const identity = host.awaitPartnerIdentity(250);
      await vi.advanceTimersByTimeAsync(250);
      await expect(identity, "a missing identity never authorizes a unilateral new run").resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("compatibility barrier waits for identity plus the required functional fingerprint", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = null;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), {
      username: "Alice",
      version: COOP_PROTOCOL_VERSION,
      requireFunctionalFingerprint: true,
    });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), {
      username: "Bob",
      version: COOP_PROTOCOL_VERSION,
      requireFunctionalFingerprint: true,
    });

    host.connect();
    let settled = false;
    const compatible = host.awaitPartnerCompatibility(1_000).then(snapshot => {
      settled = true;
      return snapshot;
    });
    await Promise.resolve();
    expect(settled, "an open channel without peer hello/fingerprint remains behind the barrier").toBe(false);

    a.peer = b;
    guest.connect();
    await expect(compatible).resolves.toMatchObject({ partnerName: "Bob", partnerConnected: true });
  });

  it("compatibility barrier fails immediately on functional drift and controller disposal", async () => {
    const a = new MockWire();
    const host = new CoopSessionController(new WebRtcTransport("host", a), {
      username: "Alice",
      version: COOP_PROTOCOL_VERSION,
      requireFunctionalFingerprint: true,
    });
    host.connect();
    const localFingerprint = a.sent
      .map(raw => JSON.parse(raw) as CoopMessage)
      .find((frame): frame is Extract<CoopMessage, { t: "dataFingerprint" }> => frame.t === "dataFingerprint");
    expect(localFingerprint, "connect sent the local functional fingerprint").toBeDefined();
    a.injectRaw(
      JSON.stringify({
        t: "hello",
        version: COOP_PROTOCOL_VERSION,
        username: "Bob",
        role: "guest",
        epoch: 1,
      } satisfies CoopMessage),
    );
    a.injectRaw(
      JSON.stringify({
        t: "dataFingerprint",
        fp: {
          ...localFingerprint!.fp,
          movesData: { ...localFingerprint!.fp.movesData, hash: `${localFingerprint!.fp.movesData.hash}-drift` },
        },
      } satisfies CoopMessage),
    );
    await expect(
      host.awaitPartnerCompatibility(1_000),
      "functional drift is terminal, not a ready proxy",
    ).resolves.toBeNull();

    const isolated = new CoopSessionController(new WebRtcTransport("host", new MockWire()), {
      username: "Carol",
      requireFunctionalFingerprint: true,
    });
    const pending = isolated.awaitPartnerCompatibility(10_000);
    isolated.dispose();
    await expect(pending, "teardown settles the barrier without waiting for its timeout").resolves.toBeNull();
  });

  it("offer -> guest handler fires (buffered if armed late) -> reply resolves the host promise", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
    host.connect();
    guest.connect();

    // Host offers BEFORE the guest arms its handler: the offer must buffer, not vanish.
    const replyPromise = host.offerResume(resumeCommitment(42));
    let offeredWave = -1;
    guest.armResumeOfferHandler(commitment => {
      offeredWave = commitment.wave;
    });
    expect(offeredWave, "buffered offer fired on arm").toBe(42);

    // Guest accepts: the host's promise resolves true.
    const guestCommit = guest.replyResume(true);
    await expect(replyPromise).resolves.toBe(true);
    await expect(guestCommit).resolves.toBe(true);

    // Second round, armed-first + decline path.
    let secondWave = -1;
    guest.armResumeOfferHandler(commitment => {
      secondWave = commitment.wave;
    });
    const decline = host.offerResume(resumeCommitment(77));
    expect(secondWave).toBe(77);
    await guest.replyResume(false);
    await expect(decline).resolves.toBe(false);
  });

  it("resume commitments reject duplicate, non-canonical, and foreign authority-seat identities", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
    host.connect();
    guest.connect();

    await expect(
      host.offerResume({ ...resumeCommitment(4), participants: ["H", "H"], seats: { host: "H", guest: "H" } }),
    ).resolves.toBe(false);
    await expect(
      host.offerResume({ ...resumeCommitment(4), participants: ["H", "G"] }),
      "wire participants must use canonical order",
    ).resolves.toBe(false);
    await expect(
      host.offerResume({ ...resumeCommitment(4), seats: { host: "G", guest: "H" } }),
      "a structurally valid foreign/reversed seat map is not this controller's session",
    ).resolves.toBe(false);
  });

  it("barrier: host sendResumeStartNew releases the guest, ACKs it, and remains idempotent", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
    host.connect();
    guest.connect();

    // A new-run decision atomically supersedes an offer that beat the guest UI. The abandoned host waiter
    // settles and arming the offer handler later must not resurrect that stale prompt.
    const supersededOffer = host.offerResume(resumeCommitment(12));
    const committed = host.sendResumeStartNew();
    let staleOffers = 0;
    guest.armResumeOfferHandler(() => {
      staleOffers++;
    });
    expect(staleOffers, "the superseded offer buffer was cleared by start-new").toBe(0);
    await expect(supersededOffer, "the superseded host offer waiter was settled").resolves.toBe(false);

    // Host releases BEFORE the guest arms: the release must buffer, not vanish (or the guest hangs).
    let released = 0;
    guest.armResumeStartNewHandler(() => {
      released++;
    });
    expect(released, "buffered release fired on arm").toBe(1);
    await expect(committed).resolves.toBe(true);

    // Repeating the already-ACKed decision is idempotent: it neither invents a new
    // operation epoch nor releases the guest UI a second time.
    let released2 = 0;
    guest.armResumeStartNewHandler(() => {
      released2++;
    });
    await expect(host.sendResumeStartNew()).resolves.toBe(true);
    expect(released2).toBe(0);
  });

  it("start-new ACK survives a delayed return path and fails closed when it is permanently dropped", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
    guest.armResumeStartNewHandler(() => {});

    // Host->guest lands, but the first guest->host ACK is dark. A repeat uses the same decision id;
    // the guest re-ACKs the duplicate and the original promise settles true.
    b.peer = null;
    const delayed = host.sendResumeStartNew(1_000);
    b.peer = a;
    expect(host.sendResumeStartNew(1_000), "repeat returns the same pending transaction").toBe(delayed);
    await expect(delayed).resolves.toBe(true);

    vi.useFakeTimers();
    try {
      const isolated = new CoopSessionController(new WebRtcTransport("host", new MockWire()), { username: "Solo" });
      const dropped = isolated.sendResumeStartNew(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(dropped, "a permanently missing ACK cannot release the host").resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("negative resumeApplied waits for explicit host observation and bounds a dropped ACK", async () => {
    vi.useFakeTimers();
    try {
      const a = new MockWire();
      const b = new MockWire();
      a.peer = b;
      b.peer = a;
      const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
      const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
      host.connect();
      guest.connect();
      guest.armResumeOfferHandler(() => {});
      const offered = host.offerResume(resumeCommitment(9));
      const committed = guest.replyResume(true);
      await expect(offered).resolves.toBe(true);
      await expect(committed).resolves.toBe(true);

      const hostObserved = host.awaitResumeApplied(1_000);
      a.peer = null; // guest->host result lands through b; host->guest resumeAppliedAck is dropped.
      const guestDelivery = guest.reportResumeApplied(false, 25);
      await expect(hostObserved, "host observes the explicit negative result immediately").resolves.toBe(false);
      await vi.advanceTimersByTimeAsync(25);
      await expect(guestDelivery, "guest teardown wait is bounded when the ACK is lost").resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsafe-save blockers are mirrored and ACKed before either lobby tears down", async () => {
    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
    let blocked: { reason: string; wave: number } | null = null;
    guest.armResumeBlockedHandler((reason, wave) => {
      blocked = { reason, wave };
    });
    await expect(host.sendResumeBlocked("unsafe-role-reversal", 41)).resolves.toBe(true);
    expect(blocked).toEqual({ reason: "unsafe-role-reversal", wave: 41 });
  });

  it("dispose settles every pending resume transaction instead of leaving stale continuations", async () => {
    const offerA = new MockWire();
    const offerB = new MockWire();
    offerA.peer = offerB;
    offerB.peer = offerA;
    const isolatedOffer = new CoopSessionController(new WebRtcTransport("host", offerA), { username: "H" });
    const silentGuest = new CoopSessionController(new WebRtcTransport("guest", offerB), { username: "G" });
    isolatedOffer.connect();
    silentGuest.connect();
    silentGuest.armResumeOfferHandler(() => {});
    const offer = isolatedOffer.offerResume(resumeCommitment(3), 60_000);
    const checkpoint = isolatedOffer.sendResumeCheckpoint("{}", resumeCommitment(3), 60_000);
    isolatedOffer.dispose();
    await expect(offer).resolves.toBe(false);
    await expect(checkpoint).resolves.toBe(false);
    silentGuest.dispose();

    const isolatedStart = new CoopSessionController(new WebRtcTransport("host", new MockWire()), { username: "H" });
    const startNew = isolatedStart.sendResumeStartNew(60_000);
    const blocked = isolatedStart.sendResumeBlocked("legacy-unmappable", 8, 60_000);
    isolatedStart.dispose();
    await expect(startNew).resolves.toBe(false);
    await expect(blocked).resolves.toBe(false);

    const a = new MockWire();
    const b = new MockWire();
    a.peer = b;
    b.peer = a;
    const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
    const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
    host.connect();
    guest.connect();
    guest.armResumeOfferHandler(() => {});
    const acceptedByHost = host.offerResume(resumeCommitment(5));
    a.peer = null; // host receives the reply but its resumeAccepted cannot return to the guest.
    const guestCommit = guest.replyResume(true, 60_000);
    await expect(acceptedByHost).resolves.toBe(true);
    const hostApply = host.awaitResumeApplied(60_000);
    guest.dispose();
    host.dispose();
    await expect(guestCommit).resolves.toBe(false);
    await expect(hostApply).resolves.toBe(false);
  });

  it("barrier: an unanswered resume offer times out to declined (host never hangs)", async () => {
    vi.useFakeTimers();
    try {
      const a = new MockWire();
      const b = new MockWire();
      a.peer = b;
      b.peer = a;
      const host = new CoopSessionController(new WebRtcTransport("host", a), { username: "H" });
      const guest = new CoopSessionController(new WebRtcTransport("guest", b), { username: "G" });
      host.connect();
      guest.connect();

      // Guest arms but NEVER replies (AFK / dropped): the host's promise must still resolve.
      guest.armResumeOfferHandler(() => {
        /* deliberately no reply */
      });
      const reply = host.offerResume(resumeCommitment(55));
      await vi.advanceTimersByTimeAsync(60_000);
      await expect(reply, "no-reply offer resolves declined after the 60s timeout").resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resume marker: records the (self,partner) pair, matches case-insensitively, gates identity, clears", async () => {
    const { recordCoopResumeMarker, readCoopResumeMarker, clearCoopResumeMarker } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    clearCoopResumeMarker();
    expect(readCoopResumeMarker("Alice", "Bob")).toBeNull();
    recordCoopResumeMarker(3, "Alice", "Bob", 27, TEST_RUN_ID, 4);
    // Exact pair matches, case-insensitively on BOTH identities.
    expect(readCoopResumeMarker("alice", "bob")?.slot, "case-insensitive pair match").toBe(3);
    expect(readCoopResumeMarker("ALICE", "BOB")?.wave).toBe(27);
    // Identity gate (maintainer negative case): a save is NEVER offered with a different partner...
    expect(readCoopResumeMarker("Alice", "Carol"), "different partner does not match").toBeNull();
    // ...nor to a different local account on the same browser.
    expect(readCoopResumeMarker("Zoe", "Bob"), "different self does not match").toBeNull();
    // Missing either identity -> no match.
    expect(readCoopResumeMarker(null, "Bob")).toBeNull();
    expect(readCoopResumeMarker("Alice", null)).toBeNull();
    clearCoopResumeMarker();
    expect(readCoopResumeMarker("Alice", "Bob"), "cleared").toBeNull();
  });

  it("resume discovery recovers a missing marker from the newest exact-pair co-op save", async () => {
    const { clearCoopResumeMarker, findCoopResumeCandidate, readCoopResumeMarker } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    clearCoopResumeMarker();
    const saves = new Map([
      [
        1,
        {
          gameMode: GameModes.COOP,
          waveIndex: 20,
          timestamp: 200,
          coopParticipants: {
            version: 1 as const,
            players: ["Alice", "Carol"] as [string, string],
            seats: { host: "Alice", guest: "Carol" },
          },
          coopControlPlane: TEST_CONTROL_PLANE,
          coopRun: { version: 1 as const, runId: `test-run-${"c".repeat(24)}`, checkpointRevision: 8 },
        },
      ],
      [
        3,
        {
          gameMode: GameModes.COOP,
          waveIndex: 17,
          timestamp: 170,
          coopParticipants: {
            version: 1 as const,
            players: ["alice", "bob"] as [string, string],
            seats: { host: "alice", guest: "bob" },
          },
          coopControlPlane: TEST_CONTROL_PLANE,
          coopRun: { version: 1 as const, runId: TEST_RUN_ID, checkpointRevision: 7 },
        },
      ],
    ]);

    const discovery = await findCoopResumeCandidate("Alice", "Bob", "host", async slot => {
      const session = saves.get(slot);
      return session == null ? undefined : loadedResumeSession(session);
    });
    expect(discovery).toMatchObject({
      kind: "candidate",
      candidate: { slot: 3, wave: 17, self: "Alice", partner: "Bob" },
    });
    expect(discovery.kind).toBe("candidate");
    if (discovery.kind !== "candidate") {
      throw new Error("expected a same-seat resume candidate");
    }
    expect(discovery.candidate.commitment).toMatchObject({ gameMode: GameModes.COOP, wave: 17, revision: 0 });
    expect(discovery.candidate.commitment.digest).toMatch(/^[0-9a-f]{64}$/u);
    expect(readCoopResumeMarker("Alice", "Bob")?.slot, "recovered pointer is repaired for the next lobby").toBe(3);
    clearCoopResumeMarker();
  });

  it("resume discovery validates stale pointers and never offers another pair's save", async () => {
    const { clearCoopResumeMarker, findCoopResumeCandidate, recordCoopResumeMarker } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    clearCoopResumeMarker();
    recordCoopResumeMarker(2, "Alice", "Bob", 99, TEST_RUN_ID, 1);
    const saves = new Map([
      [
        2,
        {
          gameMode: GameModes.COOP,
          waveIndex: 30,
          timestamp: 300,
          coopParticipants: {
            version: 1 as const,
            players: ["Alice", "Carol"] as [string, string],
            seats: { host: "Alice", guest: "Carol" },
          },
          coopRun: { version: 1 as const, runId: `test-run-${"c".repeat(24)}`, checkpointRevision: 2 },
        },
      ],
    ]);

    await expect(
      findCoopResumeCandidate("Alice", "Bob", "host", async slot => {
        const session = saves.get(slot);
        return session == null ? undefined : loadedResumeSession(session);
      }),
    ).resolves.toEqual({ kind: "no-save" });
    clearCoopResumeMarker();
  });

  it("cold resume rejects a reversed host/guest seat assignment instead of swapping player ownership", async () => {
    const { coopResumeBlockMessage, findCoopResumeCandidate } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    const saved = {
      gameMode: GameModes.COOP,
      waveIndex: 41,
      timestamp: 410,
      coopParticipants: {
        version: 1 as const,
        players: ["Alice", "Bob"] as [string, string],
        seats: { host: "Alice", guest: "Bob" },
      },
      coopControlPlane: TEST_CONTROL_PLANE,
      coopRun: { version: 1 as const, runId: TEST_RUN_ID, checkpointRevision: 12 },
    };
    const discovery = await findCoopResumeCandidate("Alice", "Bob", "guest", async slot =>
      slot === 0 ? loadedResumeSession(saved) : undefined,
    );
    expect(discovery, "Alice was host in the snapshot and cannot silently resume as guest").toMatchObject({
      kind: "unsafe-role-reversal",
      slot: 0,
      wave: 41,
    });
    expect(coopResumeBlockMessage(discovery)).toContain("same player accepting the invite");
  });

  it("does not advertise a legacy unordered-pair save as safely resumable", async () => {
    const { coopResumeBlockMessage, findCoopResumeCandidate } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    const legacy = {
      gameMode: GameModes.COOP,
      waveIndex: 8,
      timestamp: 80,
      coopParticipants: { players: ["Alice", "Bob"] as [string, string] },
    };
    const discovery = await findCoopResumeCandidate("Alice", "Bob", "host", async slot =>
      slot === 0 ? loadedResumeSession(legacy as never) : undefined,
    );
    expect(discovery, "an unordered pair cannot prove authority-seat ownership").toMatchObject({
      kind: "legacy-unmappable",
      slot: 0,
      wave: 8,
    });
    expect(coopResumeBlockMessage(discovery)).toContain("no safe player-seat mapping");
  });

  it("surfaces the oldest participant-less co-op save when an exact-pair marker points to it", async () => {
    const { clearCoopResumeMarker, findCoopResumeCandidate, recordCoopResumeMarker } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    clearCoopResumeMarker();
    recordCoopResumeMarker(2, "Alice", "Bob", 6, TEST_RUN_ID, 1);
    const legacy = { gameMode: GameModes.COOP, waveIndex: 6, timestamp: 60 };
    await expect(
      findCoopResumeCandidate("Alice", "Bob", "host", async slot =>
        slot === 2 ? loadedResumeSession(legacy as never) : undefined,
      ),
      "the exact marker turns identity-unknown legacy bytes into a visible blocker, never New Game",
    ).resolves.toMatchObject({ kind: "legacy-unmappable", slot: 2, wave: 6 });
    clearCoopResumeMarker();
  });

  it("freezes discovered resume bytes so a later slot replacement cannot change the accepted snapshot", async () => {
    const { findCoopResumeCandidate, digestCoopResumeSession } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    const saves = new Map([
      [
        0,
        {
          gameMode: GameModes.COOP,
          waveIndex: 12,
          timestamp: 120,
          coopParticipants: {
            version: 1 as const,
            players: ["Alice", "Bob"] as [string, string],
            seats: { host: "Alice", guest: "Bob" },
          },
          coopControlPlane: TEST_CONTROL_PLANE,
          coopRun: { version: 1 as const, runId: TEST_RUN_ID, checkpointRevision: 3 },
        },
      ],
    ]);
    const selectedRaw = `  ${JSON.stringify(saves.get(0))}\n`;
    const discovery = await findCoopResumeCandidate("Alice", "Bob", "host", async slot => {
      const session = saves.get(slot);
      return session == null ? undefined : loadedResumeSession(session, selectedRaw);
    });
    expect(discovery.kind).toBe("candidate");
    if (discovery.kind !== "candidate") {
      throw new Error("expected frozen resume candidate");
    }
    const candidate = discovery.candidate;
    expect(candidate.sessionJson, "discovery preserves exact selected raw bytes").toBe(selectedRaw);
    saves.set(0, {
      ...saves.get(0)!,
      waveIndex: 99,
      timestamp: 999,
    });
    expect(JSON.parse(candidate.sessionJson).waveIndex, "candidate retains the scanned bytes").toBe(12);
    await expect(digestCoopResumeSession(candidate.sessionJson)).resolves.toBe(candidate.commitment.digest);
  });

  it("participant matching is exact, order-independent, and rejects malformed serialized identities", async () => {
    const { coopParticipantPairMatches } = await import("#data/elite-redux/coop/coop-resume-marker");
    expect(coopParticipantPairMatches(["Bob", "Alice"], "Alice", "Bob")).toBe(true);
    expect(coopParticipantPairMatches(["Alice", "Carol"], "Alice", "Bob")).toBe(false);
    expect(coopParticipantPairMatches(undefined, "Alice", "Bob")).toBe(false);
    expect(coopParticipantPairMatches(["Alice"], "Alice", "Bob")).toBe(false);
    expect(coopParticipantPairMatches(["Alice", 7], "Alice", "Bob")).toBe(false);
  });
});

// Early-rx buffering: run 29551213918 (mystery profile) delivered the host's one-shot
// `dataFingerprint` while the guest's session controller was still wiring up
// (`raw rx role=guest t=dataFingerprint handlers=0`) - the frame was dropped, the
// compatibility barrier never settled, and the lobby (correctly, fail-safe) never opened.
// The transport now buffers frames that arrive before ANY handler is registered and
// replays them in arrival order on first subscription - a bounded delivery-robustness
// fix below the protocol layer; no message semantics change.
describe("co-op WebRTC transport - early-rx buffering (pre-subscription frames)", () => {
  const hello = (username: string): CoopMessage => ({
    t: "hello",
    version: "1",
    username,
    role: "host",
    epoch: 1,
  });

  it("replays frames received before the first handler registers, in arrival order", async () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    // The guest side has NO onMessage subscriber yet (session controller still constructing).
    host.send(hello("first"));
    host.send(hello("second"));
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    await Promise.resolve(); // buffered replay is microtask-deferred (matches loopback delivery)
    expect(received.map(message => ("username" in message ? message.username : message.t))).toEqual([
      "first",
      "second",
    ]);
    guest.close();
    host.close();
  });

  it("keeps arrival order when a live frame lands between subscription and the deferred replay", async () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    host.send(hello("buffered"));
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    // Arrives synchronously AFTER subscription but BEFORE the microtask replay runs.
    host.send(hello("late"));
    await Promise.resolve();
    expect(received.map(message => ("username" in message ? message.username : message.t))).toEqual([
      "buffered",
      "late",
    ]);
    guest.close();
    host.close();
  });

  it("bounds the buffer and keeps the EARLIEST frames on overflow", async () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    for (let i = 0; i < COOP_EARLY_RX_MAX_FRAMES + 8; i++) {
      host.send(hello(`frame-${i}`));
    }
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    await Promise.resolve();
    expect(received).toHaveLength(COOP_EARLY_RX_MAX_FRAMES);
    expect(received[0]).toMatchObject({ t: "hello", username: "frame-0" });
    expect(received.at(-1)).toMatchObject({ t: "hello", username: `frame-${COOP_EARLY_RX_MAX_FRAMES - 1}` });
    guest.close();
    host.close();
  });
});

// The buffer is STRICTLY pre-first-subscription: harness fault-injection simulates loss via
// zero-handler windows, and post-teardown frames must never leak into a successor subscriber.
describe("co-op WebRTC transport - early-rx stays scoped to the first subscription", () => {
  it("drops frames arriving in a zero-handler window AFTER the first subscription", async () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const first: CoopMessage[] = [];
    const unsubscribe = guest.onMessage(message => first.push(message));
    host.send({ t: "hello", version: "1", username: "before", role: "host", epoch: 1 });
    unsubscribe();
    // Legacy loss semantics: nobody is listening and the first subscription already happened.
    host.send({ t: "hello", version: "1", username: "lost", role: "host", epoch: 1 });
    const second: CoopMessage[] = [];
    guest.onMessage(message => second.push(message));
    await Promise.resolve();
    expect(first).toHaveLength(1);
    expect(second, "the post-subscription gap frame stays dropped").toHaveLength(0);
    guest.close();
    host.close();
  });
});
