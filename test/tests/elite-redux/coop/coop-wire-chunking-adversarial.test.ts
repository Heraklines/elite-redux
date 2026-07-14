/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// P33 transport-closure adversarial verification. These tests are intentionally engine-free: they drive
// the production WebRtcTransport over an in-process RTCDataChannel-shaped carrier and attack reconnect,
// backpressure, oversize refusal, ordering, and duplicate whole-transfer delivery boundaries.

import type { CoopMessage, CoopResumeCommitment } from "#data/elite-redux/coop/coop-transport";
import {
  COOP_WIRE_BUFFER_HIGH_BYTES,
  type CoopWireChannel,
  WebRtcTransport,
} from "#data/elite-redux/coop/coop-webrtc-transport";
import { GameModes } from "#enums/game-modes";
import { describe, expect, it } from "vitest";

const TEST_RUN_ID = `test-run-${"a".repeat(24)}`;

class MockWire implements CoopWireChannel {
  readyState = "open";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  peer: MockWire | null = null;
  sent: string[] = [];
  throwOnSendNumber: number | null = null;
  lastError: string | undefined = undefined;
  private sendCount = 0;
  private msgHandler: ((data: string) => void) | null = null;
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

  onMessage(handler: (data: string) => void): void {
    this.msgHandler = handler;
  }

  onOpen(): void {}

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  onBufferedAmountLow(handler: () => void): void {
    this.bufferedAmountLowHandler = handler;
  }

  injectRaw(data: string): void {
    this.msgHandler?.(data);
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

describe("P33 chunk generation and ordering closure", () => {
  it("restarts a partially sent logical frame from chunk zero with a new generation id", () => {
    const first = linkedWires();
    const host = new WebRtcTransport("host", first.a);
    const guest = new WebRtcTransport("guest", first.b);
    const received: CoopMessage[] = [];
    guest.onMessage(value => received.push(value));
    const message = largeCheckpoint(200, 40_000);

    first.a.throwOnSendNumber = 3;
    host.send(message);
    const abandoned = chunkFrames(first.a.sent);
    const abandonedGeneration = host.connectionGeneration();
    expect(received).toEqual([]);
    expect(abandoned.length).toBeGreaterThan(0);
    expect(abandoned[0].id.split("-")[1]).toBe(String(abandonedGeneration));

    const replacement = linkedWires();
    guest.replaceChannel(replacement.b);
    host.replaceChannel(replacement.a);

    const restarted = chunkFrames(replacement.a.sent);
    expect(received).toEqual([message]);
    expect(restarted[0].index).toBe(0);
    expect(restarted[0].id).not.toBe(abandoned[0].id);
    expect(restarted[0].id.split("-")[1]).toBe(String(abandonedGeneration + 1));
  });

  it("preserves logical FIFO order across backpressure and hot rejoin", () => {
    const first = linkedWires();
    first.a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", first.a);
    const guest = new WebRtcTransport("guest", first.b);
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    const big = largeCheckpoint(60, 40_000);
    const trailing: CoopMessage = { t: "waveResolved", wave: 61, outcome: "win" };

    host.send(big);
    host.send(trailing);
    expect(first.a.sent).toEqual([]);

    const replacement = linkedWires();
    guest.replaceChannel(replacement.b);
    host.replaceChannel(replacement.a);
    expect(received).toEqual([big, trailing]);

    const before = replacement.a.sent.length;
    first.a.fireBufferedAmountLow();
    expect(replacement.a.sent.length).toBe(before);
  });
});

describe("P33 durable refusal closure", () => {
  it("turns a full logical FIFO into a shared disconnect and retained-resync debt", () => {
    const first = linkedWires();
    first.a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", first.a);
    const guest = new WebRtcTransport("guest", first.b);
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));

    for (let wave = 1; wave <= 513; wave++) {
      expect(() => host.send({ t: "waveResolved", wave, outcome: "win" })).not.toThrow();
    }

    expect(first.a.sent).toEqual([]);
    expect(host.state).toBe("disconnected");
    expect(guest.state).toBe("disconnected");
    expect(host.outboundQueueNeedsResync()).toBe(true);
    expect(host.disconnectReason()).toContain("durable transport refusal (waveResolved)");

    const replacement = linkedWires();
    guest.replaceChannel(replacement.b);
    host.replaceChannel(replacement.a);
    const waves = received.map(message => (message as Extract<CoopMessage, { t: "waveResolved" }>).wave);
    expect(waves).toHaveLength(512);
    expect(waves[0]).toBe(1);
    expect(waves.at(-1)).toBe(512);
    expect(host.outboundQueueNeedsResync(), "rejoin does not silently forgive a refused authoritative frame").toBe(
      true,
    );

    host.clearOutboundQueueResync();
    expect(host.outboundQueueNeedsResync()).toBe(false);
  });

  it("closes only the refused carrier when a recovery listener installs a replacement synchronously", () => {
    const first = linkedWires();
    first.a.bufferedAmount = COOP_WIRE_BUFFER_HIGH_BYTES;
    const host = new WebRtcTransport("host", first.a);
    const replacement = new MockWire();
    host.onStateChange(state => {
      if (state === "disconnected") {
        host.replaceChannel(replacement);
      }
    });

    for (let wave = 1; wave <= 513; wave++) {
      host.send({ t: "waveResolved", wave, outcome: "win" });
    }

    expect(first.a.readyState).toBe("closed");
    expect(replacement.readyState, "refusal cleanup must not close the synchronously installed recovery carrier").toBe(
      "open",
    );
    expect(host.state).toBe("connected");
  });

  it("turns an oversized durable heal into shared recovery instead of silent loss", () => {
    const first = linkedWires();
    const host = new WebRtcTransport("host", first.a);
    const guest = new WebRtcTransport("guest", first.b);
    const received: CoopMessage[] = [];
    guest.onMessage(message => received.push(message));
    const oversized: CoopMessage = { t: "stateSync", blob: "x".repeat(16 * 1024 * 1024 + 512), seq: 1 };

    expect(() => host.send(oversized)).not.toThrow();
    expect(first.a.sent).toEqual([]);
    expect(received).toEqual([]);
    expect(host.state).toBe("disconnected");
    expect(guest.state).toBe("disconnected");
    expect(host.outboundQueueNeedsResync()).toBe(true);
    expect(host.disconnectReason()).toContain("oversized logical frame");

    const replacement = linkedWires();
    guest.replaceChannel(replacement.b);
    host.replaceChannel(replacement.a);
    const normal: CoopMessage = { t: "stateSync", blob: "y".repeat(40_000), seq: 2 };
    host.send(normal);
    expect(received).toEqual([normal]);
  });
});

describe("P33 completed-transfer replay closure", () => {
  function buildChunks(message: CoopMessage): string[] {
    const wire = new MockWire();
    const host = new WebRtcTransport("host", wire);
    host.send(message);
    return wire.sent;
  }

  it("delivers an identical duplicate chunk only once within an assembly", () => {
    const message = largeCheckpoint(100, 40_000);
    const frames = buildChunks(message);
    const guestWire = new MockWire();
    const guest = new WebRtcTransport("guest", guestWire);
    const received: CoopMessage[] = [];
    guest.onMessage(value => received.push(value));

    guestWire.injectRaw(frames[0]);
    guestWire.injectRaw(frames[0]);
    for (const frame of frames.slice(1)) {
      guestWire.injectRaw(frame);
    }
    expect(received).toEqual([message]);
  });

  it("rejects a conflicting duplicate without fabricating a logical message", () => {
    const message = largeCheckpoint(110, 40_000);
    const frames = buildChunks(message);
    const parsed = frames.map(frame => JSON.parse(frame));
    const conflicting = JSON.stringify({ ...parsed[0], payload: parsed[1].payload });
    const guestWire = new MockWire();
    const guest = new WebRtcTransport("guest", guestWire);
    const received: CoopMessage[] = [];
    guest.onMessage(value => received.push(value));

    guestWire.injectRaw(frames[0]);
    guestWire.injectRaw(conflicting);
    for (const frame of frames.slice(1)) {
      guestWire.injectRaw(frame);
    }
    expect(received).toEqual([]);
  });

  it("fences replay of every chunk after an already completed transfer", () => {
    const message = largeCheckpoint(120, 40_000);
    const frames = buildChunks(message);
    const guestWire = new MockWire();
    const guest = new WebRtcTransport("guest", guestWire);
    const received: CoopMessage[] = [];
    guest.onMessage(value => received.push(value));

    for (const frame of frames) {
      guestWire.injectRaw(frame);
    }
    for (const frame of frames) {
      guestWire.injectRaw(frame);
    }
    expect(received).toEqual([message]);
  });
});
