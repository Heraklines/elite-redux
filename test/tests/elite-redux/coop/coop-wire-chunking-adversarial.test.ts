/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// P33 CLOSURE (A) - ADVERSARIAL VERIFICATION of the WebRTC transport chunked
// framing + bufferedAmount backpressure (coop-webrtc-transport.ts).
//
// Independent (ci/coop/p33-closure-verification) attack suite. Engine-free: it
// drives WebRtcTransport over the SAME MockWire the Lane-A framing tests use
// (no live ICE, no globalScene). Each `describe` block names the attack it
// encodes; blocks tagged "FINDING" pin a real gap the closure did NOT cover -
// they assert the CURRENT (unsafe) behavior so the gate stays green, and the
// header comment states the DESIRED behavior the owning stream must implement.
// When the owner fixes a finding, the pinned assertion flips and the test MUST
// be updated to assert safety.
// =============================================================================

import type { CoopMessage, CoopResumeCommitment } from "#data/elite-redux/coop/coop-transport";
import {
  COOP_KEEPALIVE_MS,
  COOP_WIRE_BUFFER_HIGH_BYTES,
  type CoopWireChannel,
  WebRtcTransport,
} from "#data/elite-redux/coop/coop-webrtc-transport";
import { GameModes } from "#enums/game-modes";
import { describe, expect, it } from "vitest";

const TEST_RUN_ID = `test-run-${"a".repeat(24)}`;

/** In-process mock of an RTCDataChannel implementing {@linkcode CoopWireChannel} (mirrors the Lane-A mock). */
class MockWire implements CoopWireChannel {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MockWire | null = null;
  sent: string[] = [];
  throwOnSendNumber: number | null = null;
  private sendCount = 0;
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
  injectRaw(data: string): void {
    this.msgHandler?.(data);
  }
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

/** A manual keepalive scheduler that captures the callback so the test drives ticks deterministically. */
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

function resumeCommitment(wave: number, host = "H", guest = "G"): CoopResumeCommitment {
  return {
    version: 1,
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

/** A durable resumeCheckpoint whose serialized size forces multi-frame chunking (>1 wire frame). */
function largeCheckpoint(wave: number, filler = 30_000): CoopMessage {
  return {
    t: "resumeCheckpoint",
    checkpointId: `heal-${wave}`,
    commitment: resumeCommitment(wave),
    session: JSON.stringify({ waveIndex: wave, heal: "x".repeat(filler) }),
    mirrorCloud: false,
  };
}

function chunkFrames(
  sent: string[],
): { __coopChunk: 1; id: string; index: number; total: number; payload: string; bytes: number }[] {
  return sent.map(frame => JSON.parse(frame)).filter(frame => frame.__coopChunk === 1);
}

// -----------------------------------------------------------------------------
// ATTACK A1: channel-generation change MID-CHUNK. Prove the sender restarts at
// chunk 0 with a NEW id whose generation is bumped, the receiver discards the
// partial assembly, and a STALE chunk from generation G cannot corrupt / spoof a
// completion on generation G+1.
// -----------------------------------------------------------------------------
describe("A1: mid-chunk channel-generation change (reconnect)", () => {
  it("restarts chunk zero with a new id that embeds the bumped generation, discarding the partial", () => {
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));
    const msg = largeCheckpoint(200, 40_000);

    // Abort mid-transfer: the 3rd wire frame throws (SCTP death), leaving a partial assembly on the guest.
    a.throwOnSendNumber = 3;
    host.send(msg);
    expect(received, "a partial transfer never reaches the protocol consumer").toEqual([]);
    const genGid = host.connectionGeneration();
    const abandoned = chunkFrames(a.sent);
    expect(abandoned.length, "some but not all frames were emitted before the abort").toBeGreaterThan(0);
    // The id carries the sending generation: `${role}-${generation}-${seq}`.
    expect(abandoned[0].id.split("-")[1], "the abandoned id belongs to generation G").toBe(String(genGid));

    // Hot rejoin: fresh wires swap into both live transports (guest first so its handler is attached).
    const next = linkedWires();
    guest.replaceChannel(next.b);
    host.replaceChannel(next.a);

    expect(received, "the rejoin reassembles exactly one complete logical checkpoint").toEqual([msg]);
    const restarted = chunkFrames(next.a.sent);
    expect(restarted[0].index, "the replacement transfer restarts at chunk zero").toBe(0);
    expect(restarted[0].id, "the replacement owns a brand-new transfer id").not.toBe(abandoned[0].id);
    expect(
      restarted[0].id.split("-")[1],
      "the new id embeds the bumped generation G+1 - a stale-G chunk can never key into it",
    ).toBe(String(host.connectionGeneration()));
    expect(host.connectionGeneration(), "generation advanced across the rejoin").toBe(genGid + 1);
  });

  it("a stale generation-G chunk injected onto the G+1 wire cannot corrupt or spoof the new assembly", () => {
    // ONE host transport across a rejoin: gen-0 emits a partial transfer, then a hot rejoin bumps it to
    // gen 1 and it re-emits. Because the transfer id is `${role}-${generation}-${seq}`, the gen-0 chunk keys
    // `host-0-*` and the gen-1 transfer keys `host-1-*` - distinct ids by construction, so a leftover gen-0
    // chunk can never poison nor complete a gen-1 assembly.
    const genGwire = new MockWire();
    const host = new WebRtcTransport("host", genGwire);
    host.send(largeCheckpoint(150, 40_000));
    const genGframes = chunkFrames(genGwire.sent);
    expect(genGframes.length).toBeGreaterThan(2);
    expect(genGframes[0].id.split("-")[1], "stale frames are stamped generation 0").toBe("0");

    // The guest is rejoined onto a fresh wire (generation 1); the host is rejoined too and re-sends on gen 1.
    const guestWire = new MockWire();
    const guest = new WebRtcTransport("guest", new MockWire());
    guest.replaceChannel(guestWire);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    const genG1wire = new MockWire();
    host.replaceChannel(genG1wire); // bump the host to generation 1
    const fresh = largeCheckpoint(151, 40_000);
    host.send(fresh);
    const genG1frames = chunkFrames(genG1wire.sent);
    expect(genG1frames[0].id.split("-")[1], "the fresh transfer is stamped generation 1").toBe("1");
    expect(genG1frames[0].id, "and therefore owns an id disjoint from the stale gen-0 transfer").not.toBe(
      genGframes[0].id,
    );

    // Inject a STALE generation-0 chunk BEFORE the fresh transfer's frames. It can only ever create its own
    // orphan partial (keyed by its gen-0 id); it shares no id with the gen-1 assembly.
    guestWire.injectRaw(JSON.stringify(genGframes[0]));
    expect(received, "a lone stale chunk never fabricates a delivery").toEqual([]);
    for (const frame of genG1wire.sent) {
      guestWire.injectRaw(frame);
    }
    expect(received, "the stale gen-0 orphan did not corrupt the legitimate gen-1 reassembly").toEqual([fresh]);
  });
});

// -----------------------------------------------------------------------------
// ATTACK A2 + A3: the "REFUSED" drop paths. Two exist in the closure and BOTH
// silently drop a DURABLE frame with only a log - reintroducing the original
// silent-drop-of-a-heal bug in a new costume at a much higher size threshold:
//   (i)  transmit() refuses a single frame > 16 MiB (COOP_WIRE_MAX_REASSEMBLED_BYTES).
//   (ii) transmit() refuses once the logical FIFO hits 512 frames / 32 MiB.
// Neither path raises outboundQueueNeedsResync(), unlike the DARK-queue collapse
// which DOES flag a resync. So a stuck reader or an oversized heal loses
// authoritative frames with NO recovery signal to any caller.
// -----------------------------------------------------------------------------
describe("A2/A3: bounded REFUSED paths drop durable frames without a resync signal", () => {
  it("bounds the logical FIFO under sustained backpressure (no unbounded growth / OOM)", () => {
    const { a, b } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES; // reader is stuck: every drain attempt pauses
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    // Offer 513 durable frames while paused. The FIFO caps at 512; the 513th is REFUSED and dropped.
    for (let wave = 1; wave <= 513; wave++) {
      expect(
        () => host.send({ t: "waveResolved", wave, outcome: "win" }),
        "a refused frame never throws",
      ).not.toThrow();
    }
    expect(a.sent, "nothing left the stuck wire").toEqual([]);

    // Release backpressure: the retained 512 flush FIFO.
    a.bufferedAmount = 0;
    a.fireBufferedAmountLow();
    const waves = received.map(m => (m as Extract<CoopMessage, { t: "waveResolved" }>).wave);
    expect(waves.length, "the FIFO was bounded to 512 - it did not grow unboundedly").toBe(512);
    expect(waves[0], "FIFO order preserved from the head").toBe(1);
    expect(waves.at(-1), "the 513th durable frame was the one dropped").toBe(512);
  });

  it("FINDING F-A3: the 512-cap refuse drops a durable frame with needsResync() STILL false (silent authoritative loss)", () => {
    // DESIRED: dropping a durable frame under backpressure MUST raise outboundQueueNeedsResync() (as the DARK
    // outbound-queue COLLAPSE does) so the caller issues a reconnect-from-revision. CURRENT: the logicalOutbound
    // refuse path (transmit(): "bounded FIFO limit") is log-only and touches NOTHING recoverable. This pins the
    // gap; when the owning stream wires a resync flag into the refuse path, the assertion below flips to true.
    const { a } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", a);
    for (let wave = 1; wave <= 600; wave++) {
      host.send({ t: "waveResolved", wave, outcome: "win" });
    }
    expect(
      host.outboundQueueNeedsResync(),
      "VULNERABILITY: backpressure-refused durable frames raise NO resync signal (should be true)",
    ).toBe(false);
  });

  it("FINDING F-A2: an oversized (>16 MiB) durable heal frame is silently dropped, exactly the original bug", () => {
    // RATIONALE for the closure: large stateSync/meResync heals used to exceed the SCTP ceiling and be
    // silently dropped by a log-only catch. The chunking closure fixes that up to a 16 MiB reassembly cap -
    // ABOVE which transmit() refuses and drops with only a log. DESIRED: an un-sendable heal must degrade /
    // re-request / terminate, never silently vanish. CURRENT: it vanishes (peer never sees it, no throw, no
    // resync). Pinned as characterization at the (very high) 16 MiB threshold.
    const { a, b } = linkedWires();
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    const oversized: CoopMessage = { t: "stateSync", blob: "x".repeat(16 * 1024 * 1024 + 512), seq: 1 };
    expect(() => host.send(oversized), "the oversized heal is caught, never thrown").not.toThrow();
    expect(a.sent, "VULNERABILITY: the heal never reached the wire").toEqual([]);
    expect(received, "VULNERABILITY: the guest never received the heal").toEqual([]);
    expect(host.outboundQueueNeedsResync(), "VULNERABILITY: the silent drop raised no resync signal").toBe(false);

    // A normal-sized heal still flows (the closure works within the cap).
    host.send({ t: "stateSync", blob: "y".repeat(40_000), seq: 2 });
    expect(received.map(m => (m as Extract<CoopMessage, { t: "stateSync" }>).seq)).toEqual([2]);
  });
});

// -----------------------------------------------------------------------------
// ATTACK A3 (ordering + low/close race): durable frames must not reorder around
// a backpressure pause or a rejoin, and the low-watermark resume must not race
// the close handler into a send on a dead / stale channel.
// -----------------------------------------------------------------------------
describe("A3: backpressure ordering + low-watermark/close race", () => {
  it("preserves FIFO order across a backpressure pause (chunked frame ahead of a small frame)", () => {
    const { a, b } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    const big = largeCheckpoint(50, 40_000);
    const small: CoopMessage = { t: "waveResolved", wave: 51, outcome: "win" };
    host.send(big);
    host.send(small);
    expect(a.sent, "both paused behind the high-water budget").toEqual([]);

    a.bufferedAmount = 0;
    a.fireBufferedAmountLow();
    expect(received, "the large chunked frame drains fully BEFORE the trailing small frame").toEqual([big, small]);
  });

  it("preserves FIFO order across a backpressure pause THEN a hot rejoin (frames restart, never reorder)", () => {
    const { a, b } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    const big = largeCheckpoint(60, 40_000);
    const small: CoopMessage = { t: "waveResolved", wave: 61, outcome: "win" };
    host.send(big);
    host.send(small);
    expect(a.sent).toEqual([]); // parked under backpressure

    // Rejoin onto fresh OPEN wires (guest first). The parked FIFO restarts and drains in order.
    const next = linkedWires();
    guest.replaceChannel(next.b);
    host.replaceChannel(next.a);
    expect(received, "durable frames survive the pause+rejoin without reordering around each other").toEqual([
      big,
      small,
    ]);
  });

  it("the low-watermark handler after close is a no-op (no send on a disconnected transport)", () => {
    const { a } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", a);
    host.send({ t: "waveResolved", wave: 1, outcome: "win" }); // parked
    expect(a.sent).toEqual([]);

    a.close(); // channel dies -> state disconnected
    expect(host.state).toBe("disconnected");
    a.bufferedAmount = 0;
    a.fireBufferedAmountLow(); // the buffered-low callback must not resurrect a send on the dead wire
    expect(a.sent, "no frame is emitted after close, even if the low-watermark fires").toEqual([]);
  });

  it("a STALE (superseded) wire's low-watermark event is inert after a rejoin (generation guard)", () => {
    const { a, b } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));
    host.send({ t: "waveResolved", wave: 7, outcome: "win" }); // parked on generation 0

    const next = linkedWires();
    guest.replaceChannel(next.b);
    host.replaceChannel(next.a); // generation 1; the parked frame flushes over the NEW wire
    expect(received.map(m => (m as Extract<CoopMessage, { t: "waveResolved" }>).wave)).toEqual([7]);

    const before = next.a.sent.length;
    a.fireBufferedAmountLow(); // stale generation-0 wire fires late - the gen guard must ignore it
    expect(next.a.sent.length, "a superseded wire's low-watermark cannot drive the live channel").toBe(before);
  });
});

// -----------------------------------------------------------------------------
// ATTACK A4: interleaving / head-of-line blocking. A large chunked transfer must
// not starve the keepalive long enough to trip the ICE consent timeout.
// -----------------------------------------------------------------------------
describe("A4: chunked transfer does not head-of-line-block the keepalive", () => {
  it("emits a keepalive ping DIRECTLY even while a large chunked transfer is parked under backpressure", () => {
    const wire = new MockWire();
    wire.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES; // a huge transfer is stuck mid-flight
    const host = new WebRtcTransport("host", wire);
    const sched = new ManualSchedule();
    host.startKeepalive(COOP_KEEPALIVE_MS, sched.schedule);

    host.send(largeCheckpoint(80, 60_000)); // parked behind the high-water budget
    expect(chunkFrames(wire.sent), "the chunked transfer is head-of-line-parked").toEqual([]);

    // The keepalive uses a SEPARATE direct-send path (not the logical FIFO), so it keeps the ICE path warm
    // regardless of a parked bulk transfer - the transfer cannot idle the channel into the reconnect flap.
    sched.tick();
    const pings = wire.sent.map(f => JSON.parse(f)).filter(f => f.t === "ping");
    expect(pings.length, "the keepalive is not blocked by the parked chunked transfer").toBe(1);
  });

  it("small control frames queued behind a chunked transfer still flow, in FIFO, once it drains", () => {
    const { a, b } = linkedWires();
    a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", a);
    const guest = new WebRtcTransport("guest", b);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    const big = largeCheckpoint(90, 40_000);
    const beat: CoopMessage = { t: "stallBeat", waitingMs: 123 };
    host.send(big);
    host.send(beat);
    a.bufferedAmount = 0;
    a.fireBufferedAmountLow();
    expect(received, "the trailing control frame is delivered after the bulk transfer, in order").toEqual([big, beat]);
  });
});

// -----------------------------------------------------------------------------
// ATTACK A5: duplicate chunk delivery (loopback duplication fault). Assembly must
// be idempotent WITHIN a transfer. It is - but there is no completed-transfer id
// memory, so a full re-delivery of an already-completed transfer re-delivers the
// logical message (transport does not dedup; higher layers must).
// -----------------------------------------------------------------------------
describe("A5: duplicate chunk delivery", () => {
  function buildChunks(msg: CoopMessage): string[] {
    const wire = new MockWire();
    const host = new WebRtcTransport("host", wire);
    host.send(msg);
    return wire.sent;
  }

  it("an identical duplicate chunk is idempotent - the message reassembles exactly once", () => {
    const msg = largeCheckpoint(100, 40_000);
    const frames = buildChunks(msg);
    expect(frames.length).toBeGreaterThan(2);

    const guestWire = new MockWire();
    const guest = new WebRtcTransport("guest", guestWire);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    guestWire.injectRaw(frames[0]);
    guestWire.injectRaw(frames[0]); // benign duplicate of chunk 0 (loopback duplication)
    for (const frame of frames.slice(1)) {
      guestWire.injectRaw(frame);
    }
    expect(received, "a duplicated chunk does not double-count nor corrupt the assembly").toEqual([msg]);
  });

  it("a CONFLICTING duplicate (same id+index, different payload) poisons and discards the assembly", () => {
    const msg = largeCheckpoint(110, 40_000);
    const frames = buildChunks(msg);
    const parsed = frames.map(f => JSON.parse(f));
    // Non-final chunks are all full-width, so chunk 1's payload is a byte-length-valid but WRONG payload for
    // index 0 - it passes structural validation yet conflicts with the stored chunk 0.
    const conflicting = JSON.stringify({ ...parsed[0], payload: parsed[1].payload });

    const guestWire = new MockWire();
    const guest = new WebRtcTransport("guest", guestWire);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    guestWire.injectRaw(frames[0]);
    guestWire.injectRaw(conflicting); // conflict -> assembly deleted
    for (const frame of frames.slice(1)) {
      guestWire.injectRaw(frame);
    }
    expect(received, "a conflicting duplicate discards the assembly (no partial/spoofed delivery)").toEqual([]);
  });

  it("FINDING F-A5: a full re-delivery of an ALREADY-COMPLETED transfer re-delivers the logical message", () => {
    // DESIRED: the transport should remember recently-completed transfer ids and drop a whole duplicate group
    // (a duplicating/looping transport must not double-apply an authoritative frame). CURRENT: the completed
    // id is deleted immediately, so replaying every frame rebuilds and re-delivers it. Sender-side this is
    // benign (ids never reused - seq is monotonic); it only bites under a duplicating transport, and higher
    // layers (interaction/journal dedup by seq) are the actual backstop. Pinned as low-severity characterization.
    const msg = largeCheckpoint(120, 40_000);
    const frames = buildChunks(msg);

    const guestWire = new MockWire();
    const guest = new WebRtcTransport("guest", guestWire);
    const received: CoopMessage[] = [];
    guest.onMessage(m => received.push(m));

    for (const frame of frames) {
      guestWire.injectRaw(frame);
    }
    for (const frame of frames) {
      guestWire.injectRaw(frame); // replay the WHOLE completed group
    }
    expect(received, "VULNERABILITY: no completed-id memory -> the whole-transfer replay re-delivers").toEqual([
      msg,
      msg,
    ]);
  });
});
