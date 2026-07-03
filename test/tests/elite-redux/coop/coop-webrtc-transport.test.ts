/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op WebRTC transport (#633, P6): the FRAMING layer of the real-peer transport
// - JSON encode/decode, connection-state mapping, malformed-frame rejection - is
// verified headlessly against a mock data channel (no live ICE). Also proves the
// CoopSessionController runs unchanged over WebRtcTransport (transport-agnostic).

import { CoopSessionController } from "#data/elite-redux/coop/coop-session-controller";
import type { CoopConnectionState, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { type CoopWireChannel, WebRtcTransport } from "#data/elite-redux/coop/coop-webrtc-transport";
import { describe, expect, it } from "vitest";

/** In-process mock of a data channel implementing {@linkcode CoopWireChannel}.
 *  Two are cross-wired (`link`) to simulate the two ends of an open channel. */
class MockWire implements CoopWireChannel {
  readyState = "open";
  peer: MockWire | null = null;
  sent: string[] = [];
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

    const msg: CoopMessage = { t: "hello", version: "1", username: "Ash", role: "host" };
    host.send(msg);

    // Sent as a JSON string on the wire...
    expect(a.sent).toEqual([JSON.stringify(msg)]);
    // ...and decoded back into the same message on the peer.
    expect(received).toEqual([msg]);
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

    // A well-formed frame still gets through.
    wire.injectRaw(JSON.stringify({ t: "ping", ts: 1 }));
    expect(received).toEqual([{ t: "ping", ts: 1 }]);
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
