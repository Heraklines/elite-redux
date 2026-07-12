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
  COOP_KEEPALIVE_MS,
  type CoopWireChannel,
  WebRtcTransport,
  wireFromRtcChannel,
} from "#data/elite-redux/coop/coop-webrtc-transport";
import { GameModes } from "#enums/game-modes";
import { afterEach, describe, expect, it, vi } from "vitest";

/** In-process mock of a data channel implementing {@linkcode CoopWireChannel}.
 *  Two are cross-wired (`link`) to simulate the two ends of an open channel. */
class MockWire implements CoopWireChannel {
  readyState = "open";
  peer: MockWire | null = null;
  sent: string[] = [];
  /** #857: settable so a test can assert the transport surfaces the channel's last error as the drop reason. */
  lastError: string | undefined = undefined;
  private msgHandler: ((d: string) => void) | null = null;
  private openHandler: (() => void) | null = null;
  private closeHandler: (() => void) | null = null;

  send(data: string): void {
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
  /** Deliver a RAW frame to this end (bypassing the peer) - for malformed-frame tests. */
  injectRaw(data: string): void {
    this.msgHandler?.(data);
  }
  /** Fire the open event (for the connecting->connected transition test). */
  fireOpen(): void {
    this.readyState = "open";
    this.openHandler?.();
  }
}

function linkedWires(): { a: MockWire; b: MockWire } {
  const a = new MockWire();
  const b = new MockWire();
  a.peer = b;
  b.peer = a;
  return { a, b };
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

    t.send({ t: "battleEvent", turn: 1, seq: 0, event: { k: "msg", text: "x" } as never }); // cosmetic
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
      close: () => log.push("pc.close"),
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
    const replyPromise = host.offerResume(42);
    let offeredWave = -1;
    guest.armResumeOfferHandler(wave => {
      offeredWave = wave;
    });
    expect(offeredWave, "buffered offer fired on arm").toBe(42);

    // Guest accepts: the host's promise resolves true.
    const guestCommit = guest.replyResume(true);
    await expect(replyPromise).resolves.toBe(true);
    await expect(guestCommit).resolves.toBe(true);

    // Second round, armed-first + decline path.
    let secondWave = -1;
    guest.armResumeOfferHandler(wave => {
      secondWave = wave;
    });
    const decline = host.offerResume(77);
    expect(secondWave).toBe(77);
    await guest.replyResume(false);
    await expect(decline).resolves.toBe(false);
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

    // Host releases BEFORE the guest arms: the release must buffer, not vanish (or the guest hangs).
    const committed = host.sendResumeStartNew();
    let released = 0;
    guest.armResumeStartNewHandler(() => {
      released++;
    });
    expect(released, "buffered release fired on arm").toBe(1);
    await expect(committed).resolves.toBeUndefined();

    // Repeating the already-ACKed decision is idempotent: it neither invents a new
    // operation epoch nor releases the guest UI a second time.
    let released2 = 0;
    guest.armResumeStartNewHandler(() => {
      released2++;
    });
    await expect(host.sendResumeStartNew()).resolves.toBeUndefined();
    expect(released2).toBe(0);
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
      const reply = host.offerResume(55);
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
    recordCoopResumeMarker(3, "Alice", "Bob", 27);
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
          coopParticipants: { players: ["Alice", "Carol"] as [string, string] },
        },
      ],
      [
        3,
        {
          gameMode: GameModes.COOP,
          waveIndex: 17,
          timestamp: 170,
          coopParticipants: { players: ["alice", "bob"] as [string, string] },
        },
      ],
    ]);

    const candidate = await findCoopResumeCandidate("Alice", "Bob", async slot => saves.get(slot));
    expect(candidate).toMatchObject({ slot: 3, wave: 17, self: "Alice", partner: "Bob" });
    expect(readCoopResumeMarker("Alice", "Bob")?.slot, "recovered pointer is repaired for the next lobby").toBe(3);
    clearCoopResumeMarker();
  });

  it("resume discovery validates stale pointers and never offers another pair's save", async () => {
    const { clearCoopResumeMarker, findCoopResumeCandidate, recordCoopResumeMarker } = await import(
      "#data/elite-redux/coop/coop-resume-marker"
    );
    clearCoopResumeMarker();
    recordCoopResumeMarker(2, "Alice", "Bob", 99);
    const saves = new Map([
      [
        2,
        {
          gameMode: GameModes.COOP,
          waveIndex: 30,
          timestamp: 300,
          coopParticipants: { players: ["Alice", "Carol"] as [string, string] },
        },
      ],
    ]);

    await expect(findCoopResumeCandidate("Alice", "Bob", async slot => saves.get(slot))).resolves.toBeNull();
    clearCoopResumeMarker();
  });
});
