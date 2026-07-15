/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getCoopCausalTrace, resetCoopCausalTrace } from "#data/elite-redux/coop/coop-causal-trace";
import { CoopDurabilityManager } from "#data/elite-redux/coop/coop-durability";
import type { CoopAuthoritativeEnvelopeV1 } from "#data/elite-redux/coop/coop-operation-envelope";
import { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 80,
  wave: 12,
  turn: 4,
  playerParty: [],
  enemyParty: [],
  field: [],
  weather: 0,
  weatherTurnsLeft: 0,
  terrain: 0,
  terrainTurnsLeft: 0,
  arenaTags: [],
  money: 0,
  pokeballCounts: [],
  playerModifiers: [],
  enemyModifiers: [],
};

function envelope(operationId = "9:0:REWARD:12004"): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: 9,
    revision: 1,
    wave: 12,
    turn: 4,
    logicalPhase: "REWARD_SELECT",
    pendingOperation: {
      id: operationId,
      kind: "REWARD",
      owner: 0,
      status: "committed",
      payload: { label: "payload-must-not-enter-causal-trace", choice: 0, terminal: false },
    },
    authoritativeState: STATE,
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index++) {
    await Promise.resolve();
  }
}

function manualScheduler() {
  const scheduled: Array<{ callback: () => void; cancelled: boolean }> = [];
  return {
    scheduled,
    schedule(callback: () => void): () => void {
      const entry = { callback, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    fire(index: number): void {
      const entry = scheduled[index];
      if (entry == null || entry.cancelled) {
        throw new Error(`scheduled callback ${index} is unavailable`);
      }
      entry.cancelled = true;
      entry.callback();
    },
  };
}

describe("co-op causal barrier tracing", () => {
  beforeEach(() => resetCoopCausalTrace());
  afterEach(() => resetCoopCausalTrace());

  it("correlates retained material, continuation, and journal release without duplicate replay noise", async () => {
    const pair = createLoopbackPair();
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message =>
        message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null,
      apply: () => "applied",
    });
    const committed = envelope();

    try {
      expect(host.commit("op:global", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      await flush();
      expect(guest.notifyOperationContinuationSurface("sharedInput", { epoch: 9, wave: 12, turn: 4 })).toBe(1);
      await flush();

      const operationEvents = getCoopCausalTrace().filter(event => event.causalId === "9:0:REWARD:12004");
      expect(operationEvents.map(event => `${event.role}:${event.stage}`)).toEqual([
        "host:retained",
        "guest:material-applied",
        "host:material-applied",
        "guest:presentation-ready",
        "guest:continuation-ready",
        "host:presentation-ready",
        "host:continuation-ready",
        "host:released",
      ]);
      expect(operationEvents.every(event => event.epoch === 9 && event.revision === 1)).toBe(true);
      expect(JSON.stringify(operationEvents)).not.toContain("payload-must-not-enter-causal-trace");

      const edgeCount = getCoopCausalTrace().length;
      pair.host.send({ t: "envelope", envelope: committed });
      await flush();
      expect(getCoopCausalTrace(), "a duplicate carrier re-ACKs without duplicating lifecycle edges").toHaveLength(
        edgeCount,
      );
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("records bounded delivery retry and terminal edges without exposing an unsafe operation id or payload", () => {
    const pair = createLoopbackPair();
    const recovery = manualScheduler();
    const continuation = manualScheduler();
    const unsafeId = `private-operation\n${"sensitive".repeat(40)}`;
    const committed = envelope(unsafeId);
    const host = new CoopDurabilityManager(pair.host, {
      recoveryInitialMs: 1,
      recoveryMaxMs: 1,
      recoveryMaxAttempts: 2,
      recoveryDeadlineMs: 100,
      scheduleRecovery: callback => recovery.schedule(callback),
      operationContinuationDeadlineMs: 10,
      scheduleOperationContinuationDeadline: callback => continuation.schedule(callback),
    });

    try {
      expect(host.commit("op:global", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      recovery.fire(0);
      continuation.fire(0);

      const events = getCoopCausalTrace();
      expect(events.map(event => event.stage)).toEqual(["retained", "delivery-retry", "terminal"]);
      expect(new Set(events.map(event => event.causalId)).size).toBe(1);
      expect(events[0].causalId).toMatch(/^operation:e9:r1:id#[0-9a-f]{8}:len=\d+$/);
      expect(events[0].causalId.length).toBeLessThan(80);
      expect(JSON.stringify(events)).not.toContain("private-operation");
      expect(JSON.stringify(events)).not.toContain("payload-must-not-enter-causal-trace");
    } finally {
      host.dispose();
    }
  });

  it("records one reciprocal arrival/wait/release chain per seat and suppresses duplicate arrivals", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host, { getEpoch: () => 23 });
    const guest = new CoopRendezvous(pair.guest, { getEpoch: () => 23 });
    const point = "cmd:31:7";

    try {
      const hostWait = host.rendezvous(point);
      host.arrive(point);
      const guestWait = guest.rendezvous(point);
      guest.arrive(point);
      await flush();
      await Promise.all([hostWait, guestWait]);

      const rendezvousEvents = getCoopCausalTrace().filter(event => event.causalId === "rendezvous:e23:cmd:31:7");
      expect(rendezvousEvents.map(event => `${event.role}:${event.stage}`)).toEqual([
        "host:local-arrival",
        "host:wait-open",
        "guest:local-arrival",
        "guest:wait-open",
        "guest:peer-arrival",
        "guest:release",
        "host:peer-arrival",
        "host:release",
      ]);
      expect(rendezvousEvents.every(event => event.wave === 31 && event.turn === 7)).toBe(true);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("uses one stable bounded id for a torn-down wait without copying an unsafe point into reports", async () => {
    const pair = createLoopbackPair();
    const host = new CoopRendezvous(pair.host, { getEpoch: () => 29 });
    const unsafePoint = `shop:${"private-note".repeat(40)}`;
    const wait = host.awaitPartner(unsafePoint);

    host.dispose();
    expect(await wait).toMatchObject({ timedOut: true });

    const events = getCoopCausalTrace();
    expect(events.map(event => event.stage)).toEqual(["wait-open", "abort"]);
    expect(new Set(events.map(event => event.causalId)).size).toBe(1);
    expect(events[0].causalId).toMatch(/^rendezvous:e29:point#[0-9a-f]{8}:len=\d+$/);
    expect(events[0].causalId.length).toBeLessThan(80);
    expect(JSON.stringify(events)).not.toContain("private-note");
  });
});
