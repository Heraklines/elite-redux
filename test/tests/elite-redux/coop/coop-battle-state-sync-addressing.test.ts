/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import type { CoopFrameContextV1 } from "#data/elite-redux/coop/coop-session-binding";
import {
  type CoopConnectionState,
  type CoopMessage,
  type CoopTransport,
  createLoopbackPair,
} from "#data/elite-redux/coop/coop-transport";
import { describe, expect, it } from "vitest";

interface Point {
  epoch: number;
  wave: number;
  turn: number;
}

const flushWire = () => new Promise<void>(resolve => queueMicrotask(resolve));

function proof(point: Point) {
  return { wave: point.wave, turn: point.turn, stateTick: 1, controlDigest: "capture-digest" };
}

function frame(role: "host" | "guest", epoch: number, generation: number): CoopFrameContextV1 {
  return {
    sessionId: `session-${epoch}`,
    sessionEpoch: epoch,
    seatMapId: "seat-map",
    membershipRevision: generation + 1,
    fromSeatId: role === "host" ? 0 : 1,
    connectionGeneration: generation,
  };
}

function statefulTransport(inner: CoopTransport, requestCount: { value: number }) {
  const handlers = new Set<(state: CoopConnectionState) => void>();
  let generation = 0;
  const transport: CoopTransport = {
    get role() {
      return inner.role;
    },
    get state() {
      return inner.state;
    },
    send(message: CoopMessage) {
      if (message.t === "requestStateSync") {
        requestCount.value++;
      }
      inner.send(message);
    },
    onMessage: inner.onMessage.bind(inner),
    onStateChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: inner.close.bind(inner),
    connectionGeneration: () => generation,
  };
  return {
    transport,
    transition(state: CoopConnectionState) {
      if (state === "connected") {
        generation++;
      }
      for (const handler of handlers) {
        handler(state);
      }
    },
  };
}

describe("co-op protocol-38 addressed recovery", () => {
  it.each([
    ["next turn", { epoch: 7, wave: 1, turn: 2 }],
    ["same turn in another wave", { epoch: 7, wave: 2, turn: 1 }],
    ["another epoch", { epoch: 8, wave: 1, turn: 1 }],
  ] as const)("refuses a delayed request after the host advanced to %s", async (_label, next) => {
    const pair = createLoopbackPair();
    const hostPoint: Point = { epoch: 7, wave: 1, turn: 1 };
    const guestPoint: Point = { epoch: 7, wave: 1, turn: 1 };
    const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => hostPoint });
    const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => guestPoint });
    let captures = 0;
    hostStream.onStateSyncRequest(ticket => {
      captures++;
      hostStream.sendStateSync("wrong-frontier", ticket, proof(hostPoint));
    });

    const pending = guestStream.requestStateSync("turn-checksum");
    Object.assign(hostPoint, next);

    await expect(pending).resolves.toBeNull();
    expect(captures, "the ambient snapshot builder never runs at a different host frontier").toBe(0);
    hostStream.dispose();
    guestStream.dispose();
  });

  it("accepts only an exact echoed ticket and captured frontier", async () => {
    const pair = createLoopbackPair();
    const point: Point = { epoch: 11, wave: 20, turn: 3 };
    const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => point });
    const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => point });
    hostStream.onStateSyncRequest(ticket => hostStream.sendStateSync("exact-boundary", ticket, proof(point)));

    const result = await guestStream.requestStateSync("mystery-checksum");
    expect(result?.blob).toBe("exact-boundary");
    expect(result?.admission.ticket.frontier).toEqual(point);
    expect(result?.admission.captured.frontier).toEqual(point);
    hostStream.dispose();
    guestStream.dispose();
  });

  it("rejects an old connection-generation response", async () => {
    const pair = createLoopbackPair();
    const point: Point = { epoch: 13, wave: 7, turn: 3 };
    let generation = 0;
    const options = (role: "host" | "guest") => ({
      authorityContext: () => point,
      recoveryBinding: () => frame(role, point.epoch, generation),
      validatePeerRecoveryBinding: (binding: CoopFrameContextV1) =>
        JSON.stringify(binding) === JSON.stringify(frame(role === "host" ? "guest" : "host", point.epoch, generation)),
    });
    const hostStream = new CoopBattleStreamer(pair.host, options("host"));
    const guestStream = new CoopBattleStreamer(pair.guest, options("guest"));
    let retainedTicket: Parameters<typeof hostStream.sendStateSync>[1] | undefined;
    hostStream.onStateSyncRequest(ticket => {
      retainedTicket = ticket;
    });

    const pending = guestStream.requestStateSync("stall");
    await flushWire();
    generation++;
    expect(hostStream.sendStateSync("old-generation", retainedTicket!, proof(point))).toBe(false);
    await expect(pending).resolves.toBeNull();
    hostStream.dispose();
    guestStream.dispose();
  });

  it("cancels an in-flight ticket on reconnect instead of resending it on the new channel", async () => {
    const pair = createLoopbackPair();
    const requests = { value: 0 };
    const wrapped = statefulTransport(pair.guest, requests);
    const point: Point = { epoch: 17, wave: 4, turn: 2 };
    const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => point });
    const guestStream = new CoopBattleStreamer(wrapped.transport, { authorityContext: () => point });
    hostStream.onStateSyncRequest(() => undefined);

    const pending = guestStream.requestStateSync("rejoin");
    await flushWire();
    expect(requests.value).toBe(1);
    wrapped.transition("disconnected");
    wrapped.transition("connected");

    await expect(pending).resolves.toBeNull();
    expect(requests.value, "an old-generation logical request is never replayed").toBe(1);
    hostStream.dispose();
    guestStream.dispose();
  });

  it("admits an exact durability push and drops it after a same-turn wave change", async () => {
    const pair = createLoopbackPair();
    const hostPoint: Point = { epoch: 23, wave: 8, turn: 1 };
    const guestPoint: Point = { ...hostPoint };
    const hostStream = new CoopBattleStreamer(pair.host, { authorityContext: () => hostPoint });
    const guestStream = new CoopBattleStreamer(pair.guest, { authorityContext: () => guestPoint });
    const received: string[] = [];
    guestStream.onDurabilitySnapshot(result => received.push(result.blob));

    expect(hostStream.sendDurabilitySnapshot("exact-durability", proof(hostPoint))).toBe(true);
    await flushWire();
    expect(received).toEqual(["exact-durability"]);

    expect(hostStream.sendDurabilitySnapshot("old-wave-durability", proof(hostPoint))).toBe(true);
    guestPoint.wave++;
    await flushWire();
    expect(received).toEqual(["exact-durability"]);
    hostStream.dispose();
    guestStream.dispose();
  });
});
