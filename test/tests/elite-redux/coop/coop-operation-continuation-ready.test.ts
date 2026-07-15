/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopDurabilityManager, type CoopDurabilityRecoveryFailure } from "#data/elite-redux/coop/coop-durability";
import type { CoopAuthoritativeEnvelopeV1 } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  notifyCoopOperationAuthorityContinuationSurface,
  notifyCoopOperationContinuationSurface,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import type { CoopAuthoritativeBattleStateV1, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 41,
  wave: 10,
  turn: 3,
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

function envelope(revision = 1): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: 7,
    revision,
    wave: 10,
    turn: 3,
    logicalPhase: "REWARD_SELECT",
    pendingOperation: {
      id: `7:0:REWARD:${revision}`,
      kind: "REWARD",
      owner: 0,
      status: "committed",
      payload: { label: "reward", choice: 0, terminal: false },
    },
    authoritativeState: { ...STATE, tick: STATE.tick + revision - 1 },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

afterEach(() => setCoopOperationDurability(null));

describe("protocol-33 retained operation continuation lifecycle", () => {
  it("re-sends a dropped final operation without requiring a follower or reconnect", async () => {
    const pair = createLoopbackPair();
    const realSend = pair.host.send.bind(pair.host);
    let dropEnvelope = true;
    pair.host.send = message => {
      if (dropEnvelope && message.t === "envelope") {
        dropEnvelope = false;
        return;
      }
      realSend(message);
    };
    const scheduled: { callback: () => void; cancelled: boolean }[] = [];
    let applications = 0;
    const host = new CoopDurabilityManager(pair.host, {
      recoveryInitialMs: 1,
      recoveryMaxMs: 1,
      recoveryMaxAttempts: 2,
      recoveryDeadlineMs: 100,
      scheduleRecovery: callback => {
        const pending = { callback, cancelled: false };
        scheduled.push(pending);
        return () => {
          pending.cancelled = true;
        };
      },
    });
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => {
        applications++;
        return "applied";
      },
    });
    setCoopOperationDurability(guest);
    try {
      const committed = envelope();
      expect(host.commit("op:global", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      await flush();
      expect(applications, "the one initial delivery was intentionally lost").toBe(0);
      expect(scheduled).toHaveLength(1);

      scheduled[0].cancelled = true;
      scheduled[0].callback();
      await flush();
      expect(applications, "the retained final revision retransmits without a later gap signal").toBe(1);
      expect(scheduled.at(-1)?.cancelled, "materialApplied stops the next delivery retry").toBe(true);
      expect(host.unackedCount(), "material receipt still does not weaken continuation retention").toBe(1);

      expect(notifyCoopOperationContinuationSurface("sharedInput", { epoch: 7, wave: 10, turn: 3 })).toBe(1);
      await flush();
      expect(host.unackedCount()).toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("retains after material apply, rejects unrelated readiness, re-ACKs retransmit, and releases only at final UI", async () => {
    const pair = createLoopbackPair();
    const guestAcks: Extract<CoopMessage, { t: "coopAck" }>[] = [];
    pair.host.onMessage(message => {
      if (message.t === "coopAck") {
        guestAcks.push(message);
      }
    });
    let applications = 0;
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => {
        applications++;
        return "applied";
      },
    });
    setCoopOperationDurability(guest);
    try {
      const committed = envelope();
      expect(host.commit("op:global", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      await flush();

      expect(applications).toBe(1);
      expect(guest.appliedMarks()).toEqual({ "op:global": 1 });
      expect(
        host.unackedCount(),
        "P33_MUTATION_CAUGHT[operation-retained-continuation]: material ACK must retain canonical operation",
      ).toBe(1);
      expect(guestAcks.map(ack => ack.stage)).toEqual(["materialApplied"]);

      // The committer retransmits its retained canonical result. The guest must not apply it twice and
      // must re-send the exact current stage instead of a release-capable cumulative ACK.
      host.reconnect();
      await flush();
      expect(applications).toBe(1);
      expect(guestAcks.map(ack => ack.stage)).toEqual(["materialApplied", "materialApplied"]);
      expect(guestAcks[1]).toEqual(guestAcks[0]);
      expect(host.unackedCount()).toBe(1);

      expect(notifyCoopOperationContinuationSurface("terminal", { epoch: 7, wave: 10, turn: 3 })).toBe(0);
      expect(notifyCoopOperationContinuationSurface("sharedInput", { epoch: 8, wave: 10, turn: 3 })).toBe(0);
      expect(notifyCoopOperationContinuationSurface("sharedInput", { epoch: 7, wave: 12, turn: 1 })).toBe(0);
      await flush();
      expect(guestAcks).toHaveLength(2);
      expect(host.unackedCount(), "wrong surface/address cannot retire authority").toBe(1);

      expect(notifyCoopOperationContinuationSurface("sharedInput", { epoch: 7, wave: 10, turn: 3 })).toBe(1);
      await flush();
      expect(guestAcks.slice(-2).map(ack => ack.stage)).toEqual(["presentationReady", "continuationReady"]);
      expect(guestAcks.at(-1)).toMatchObject({
        operationId: committed.pendingOperation?.id,
        epoch: 7,
        wave: 10,
        turn: 3,
        surface: "sharedInput",
        continuationEpoch: 7,
        continuationWave: 10,
        continuationTurn: 3,
      });
      expect(host.unackedCount(), "only exact continuationReady releases the journal").toBe(0);
      expect(guest.operationContinuationDiagnostics().pending).toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("captures a public surface that opens synchronously inside material application", async () => {
    const pair = createLoopbackPair();
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => {
        expect(notifyCoopOperationContinuationSurface("sharedInput", { epoch: 7, wave: 10, turn: 3 })).toBe(0);
        return "applied";
      },
    });
    setCoopOperationDurability(guest);
    try {
      const committed = envelope();
      host.commit("op:global", committed.revision, { t: "envelope", envelope: committed });
      await flush();
      expect(host.unackedCount(), "the deferred synchronous observation finishes after material evidence").toBe(0);
      expect(guest.operationContinuationDiagnostics().pending).toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("parks a later plain wave ACK behind an earlier operation until its continuation is ready", async () => {
    const pair = createLoopbackPair();
    const host = new CoopDurabilityManager(pair.host);
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    try {
      const reward = envelope(1);
      const wave: CoopAuthoritativeEnvelopeV1 = {
        ...envelope(2),
        logicalPhase: "WAVE_VICTORY",
        pendingOperation: {
          id: "7:0:WAVE_ADVANCE:2",
          kind: "WAVE_ADVANCE",
          owner: 0,
          status: "committed",
          payload: {
            wave: 10,
            outcome: "win",
            nextLogicalPhase: "WAVE_VICTORY",
            nextWave: 11,
            biomeChange: false,
            eggLapse: false,
            meBoundary: "none",
            victoryKind: "wild",
            settledStateTick: STATE.tick + 1,
          },
        },
      };
      expect(host.commit("op:global", 1, { t: "envelope", envelope: reward })).toBe(true);
      expect(host.commit("op:global", 2, { t: "envelope", envelope: wave })).toBe(true);
      await flush();

      expect(guest.appliedMarks()).toEqual({ "op:global": 2 });
      expect(
        host.unackedCount(),
        "a later cumulative wave ACK cannot jump the reward's missing continuation proof",
      ).toBe(2);

      expect(guest.notifyOperationContinuationSurface("sharedInput", { epoch: 7, wave: 10, turn: 3 })).toBe(1);
      await flush();
      expect(host.unackedCount(), "the contiguous prefix releases only after both exact proofs exist").toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("gives peer convergence one fixed budget after the host opens its real continuation exactly once", async () => {
    const pair = createLoopbackPair();
    const deadlines: { callback: () => void; cancelled: boolean; ms: number }[] = [];
    const failures: CoopDurabilityRecoveryFailure[] = [];
    const host = new CoopDurabilityManager(pair.host, {
      operationContinuationDeadlineMs: 25,
      scheduleOperationContinuationDeadline: (callback, ms) => {
        const deadline = { callback, cancelled: false, ms };
        deadlines.push(deadline);
        return () => {
          deadline.cancelled = true;
        };
      },
      onRecoveryExhausted: failure => failures.push(failure),
    });
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    try {
      setCoopOperationDurability(host);
      const committed = envelope();
      expect(host.commit("op:global", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      await flush();
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].ms).toBe(25);
      expect(host.unackedCount()).toBe(1);

      expect(notifyCoopOperationAuthorityContinuationSurface("terminal", { epoch: 7, wave: 10, turn: 3 })).toBe(0);
      expect(notifyCoopOperationAuthorityContinuationSurface("command", { epoch: 8, wave: 11, turn: 1 })).toBe(0);
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].cancelled).toBe(false);

      expect(notifyCoopOperationAuthorityContinuationSurface("command", { epoch: 7, wave: 11, turn: 1 })).toBe(1);
      expect(deadlines).toHaveLength(2);
      expect(deadlines[0].cancelled).toBe(true);
      expect(deadlines[1]).toMatchObject({ cancelled: false, ms: 25 });

      expect(notifyCoopOperationAuthorityContinuationSurface("sharedInput", { epoch: 7, wave: 11, turn: 1 })).toBe(0);
      expect(deadlines).toHaveLength(2);
      // Even if a cancelled callback was already queued, it cannot exhaust or cancel the replacement stage.
      deadlines[0].callback();
      expect(failures).toEqual([]);
      expect(deadlines[1].cancelled).toBe(false);
      expect(host.unackedCount()).toBe(1);

      setCoopOperationDurability(guest);
      expect(notifyCoopOperationContinuationSurface("command", { epoch: 7, wave: 11, turn: 1 })).toBe(1);
      await flush();
      expect(host.unackedCount(), "only the guest's exact continuationReady releases retained authority").toBe(0);
      expect(deadlines[1].cancelled).toBe(true);
      expect(failures).toEqual([]);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("routes a missing continuation through the bounded failure callback without discarding authority", async () => {
    const pair = createLoopbackPair();
    const deadlines: { callback: () => void; cancelled: boolean; ms: number }[] = [];
    const failures: CoopDurabilityRecoveryFailure[] = [];
    const host = new CoopDurabilityManager(pair.host, {
      operationContinuationDeadlineMs: 25,
      scheduleOperationContinuationDeadline: (callback, ms) => {
        const deadline = { callback, cancelled: false, ms };
        deadlines.push(deadline);
        return () => {
          deadline.cancelled = true;
        };
      },
      onRecoveryExhausted: failure => failures.push(failure),
    });
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:global", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    try {
      const committed = envelope();
      host.commit("op:global", committed.revision, { t: "envelope", envelope: committed });
      await flush();
      expect(deadlines).toHaveLength(1);
      expect(deadlines[0].ms).toBe(25);
      expect(host.unackedCount()).toBe(1);

      deadlines[0].callback();
      expect(failures).toEqual([
        {
          cls: "op:global",
          from: 0,
          blockedSeq: 1,
          attempts: 0,
          reason: "continuation-timeout",
        },
      ]);
      expect(host.unackedCount(), "bounded failure is fail-closed; authority remains available for diagnosis").toBe(1);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });
});
