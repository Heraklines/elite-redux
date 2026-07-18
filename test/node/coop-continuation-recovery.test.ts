/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op durability: the GENERIC continuation-timeout recovery defect (adversarial-audit promotion blocker).
//
// The bug: when a committed durable op is admitted by the peer (journalAdmitted/materialApplied) but its
// public continuation surface never proves `continuationReady`, the host's continuation deadline fired a
// DESTRUCTIVE shared terminal ("Durable operation recovery exhausted ... continuation-timeout") with
// `attempts` HARD-CODED to 0 - the safety layer performed NO continuation re-drive before nuking BOTH
// sessions to Title. Two campaign lanes died in this class (mystery ME op, depth WAVE_ADVANCE).
//
// The fix (src/data/elite-redux/coop/coop-durability.ts): before any destructive terminal for a
// continuation-timeout the layer now
//  (1) RE-DRIVES the exact stuck op (re-broadcasts its retained envelope so the peer re-runs its apply +
//      continuation ACK chain) for a bounded number of attempts, and only terminals AFTER real failed
//      attempts (attempts reflects the REAL count, >0);
//  (2) NEVER races a hard deadline into a terminal for an op that is legitimately AWAITING HUMAN INPUT with
//      a demonstrably LIVE peer (owner prompt open + fresh inbound frames): it re-arms, never terminal;
//  (3) still reaches the terminal for a genuinely lost continuation once the peer is gone (fail-closed).
//
// These are engine-free protocol-level contracts on CoopDurabilityManager, so they live in the node-pure
// project (no jsdom/Phaser). RED on base (single deadline fire => immediate terminal, attempts 0); GREEN
// with the fix (re-drive first; awaiting-input+live-peer held; terminal only after real attempts).

import { CoopDurabilityManager, type CoopDurabilityRecoveryFailure } from "#data/elite-redux/coop/coop-durability";
import { type CoopAuthoritativeEnvelopeV1, makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  notifyCoopOperationContinuationSurface,
  setCoopOperationDurability,
} from "#data/elite-redux/coop/coop-operation-journal";
import type { CoopAuthoritativeBattleStateV1, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, describe, expect, it } from "vitest";

const ME_COUNTER = 1;
const ME_WAVE = 12;
const SESSION_EPOCH = 7;
const COOP_ME_PUMP_SEQ_BASE = 8_000_000;
const mePickPinnedSeq = (counter: number, step = 0): number =>
  (COOP_ME_PUMP_SEQ_BASE + counter) * 8000 + 1 * 1000 + step;

const STATE: CoopAuthoritativeBattleStateV1 = {
  version: 1,
  tick: 40,
  wave: ME_WAVE,
  turn: 0,
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

/** A committed GUEST-OWNED (owner seat 1) top-level ME_PICK envelope, exactly as the host commits it. */
function mePickEnvelope(revision = 1): CoopAuthoritativeEnvelopeV1 {
  return {
    version: 1,
    sessionEpoch: SESSION_EPOCH,
    revision,
    wave: ME_WAVE,
    turn: 0,
    logicalPhase: "MYSTERY_ENCOUNTER",
    pendingOperation: {
      id: makeCoopOperationId(SESSION_EPOCH, 1, mePickPinnedSeq(ME_COUNTER), "ME_PICK"),
      kind: "ME_PICK",
      owner: 1,
      status: "applied",
      payload: { optionIndex: 0 },
    },
    authoritativeState: { ...STATE, tick: STATE.tick + revision - 1 },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
}

/** A captured injected continuation timer (fired manually to advance deterministically). */
interface CapturedDeadline {
  callback: () => void;
  cancelled: boolean;
}

afterEach(() => setCoopOperationDurability(null));

describe("co-op durable-operation continuation-timeout performs real recovery before any destructive terminal", () => {
  it("re-drives an admitted-but-continuation-lost op instead of nuking to Title, and completes when the surface opens", async () => {
    const pair = createLoopbackPair();
    const deadlines: CapturedDeadline[] = [];
    const failures: CoopDurabilityRecoveryFailure[] = [];
    const envelopesToGuest: Extract<CoopMessage, { t: "envelope" }>[] = [];
    pair.guest.onMessage(message => {
      if (message.t === "envelope") {
        envelopesToGuest.push(message);
      }
    });
    const host = new CoopDurabilityManager(pair.host, {
      operationContinuationDeadlineMs: 25,
      operationContinuationRecoveryWindowMs: 25,
      operationContinuationRecoveryMaxAttempts: 4,
      scheduleOperationContinuationDeadline: (callback, _ms) => {
        const deadline: CapturedDeadline = { callback, cancelled: false };
        deadlines.push(deadline);
        return () => {
          deadline.cancelled = true;
        };
      },
      onRecoveryExhausted: failure => failures.push(failure),
    });
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:me", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    setCoopOperationDurability(guest);
    try {
      const committed = mePickEnvelope();
      expect(host.commit("op:me", committed.revision, { t: "envelope", envelope: committed })).toBe(true);
      await flush();
      expect(host.unackedCount(), "the committed pick is retained awaiting continuationReady").toBe(1);
      expect(envelopesToGuest, "the op was broadcast once at commit").toHaveLength(1);
      expect(deadlines, "one continuation deadline is armed").toHaveLength(1);

      // The deadline elapses with the guest's public surface still closed. OLD behavior: immediate destroy-to-
      // Title with attempts 0. NEW behavior: a REAL re-drive (re-broadcast) + a re-armed window, NO terminal.
      deadlines[0].callback();
      await flush();
      expect(failures, "no destructive terminal on the first continuation timeout").toEqual([]);
      expect(envelopesToGuest.length, "the exact stuck op was really re-broadcast to the peer").toBe(2);
      expect(deadlines.length, "a bounded recovery window was re-armed").toBe(2);
      expect(host.unackedCount(), "the retained op survives - both sessions are NOT nuked").toBe(1);

      // The guest's public continuation surface now opens at the pick's exact address -> continuationReady ->
      // the host RELEASES the retained op. Recovery drove it to completion with NO terminal.
      expect(
        notifyCoopOperationContinuationSurface("sharedInput", { epoch: SESSION_EPOCH, wave: ME_WAVE, turn: 0 }),
        "the post-pick surface at the pick address releases exactly one retained continuation",
      ).toBe(1);
      await flush();
      expect(host.unackedCount(), "recovery drove the op to continuationReady with no terminal").toBe(0);
      expect(failures, "still no terminal after a clean completion").toEqual([]);

      // A now-stale re-armed timer firing after release is a harmless no-op - never a late terminal.
      for (const stale of deadlines) {
        stale.callback();
      }
      await flush();
      expect(failures, "a stale post-release timer never fires a late terminal").toEqual([]);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("terminals fail-closed with attempts>0 once the peer's continuation is genuinely lost (recovery exhausted)", async () => {
    const pair = createLoopbackPair();
    const deadlines: CapturedDeadline[] = [];
    const failures: CoopDurabilityRecoveryFailure[] = [];
    const envelopesToGuest: Extract<CoopMessage, { t: "envelope" }>[] = [];
    pair.guest.onMessage(message => {
      if (message.t === "envelope") {
        envelopesToGuest.push(message);
      }
    });
    const host = new CoopDurabilityManager(pair.host, {
      operationContinuationDeadlineMs: 25,
      operationContinuationRecoveryWindowMs: 25,
      operationContinuationRecoveryMaxAttempts: 3,
      scheduleOperationContinuationDeadline: (callback, _ms) => {
        const deadline: CapturedDeadline = { callback, cancelled: false };
        deadlines.push(deadline);
        return () => {
          deadline.cancelled = true;
        };
      },
      onRecoveryExhausted: failure => failures.push(failure),
    });
    // The guest applies the op (materialApplied) but its public continuation surface NEVER opens.
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:me", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    try {
      const committed = mePickEnvelope();
      host.commit("op:me", committed.revision, { t: "envelope", envelope: committed });
      await flush();
      expect(host.unackedCount()).toBe(1);
      expect(deadlines).toHaveLength(1);

      // Each of the first maxAttempts elapses re-drives (re-broadcasts) + re-arms; NONE terminals.
      let cursor = 0;
      for (let attempt = 1; attempt <= 3; attempt++) {
        expect(deadlines[cursor], `recovery window ${attempt} is armed`).toBeDefined();
        deadlines[cursor].callback();
        await flush();
        expect(failures, `no terminal until real attempts are exhausted (after ${attempt} re-drives)`).toEqual([]);
        cursor++;
      }
      expect(envelopesToGuest.length, "every recovery attempt really re-broadcast the exact op").toBe(1 + 3);

      // The next elapse finds the re-drive budget spent -> the peer-coherent terminal fires with the REAL count.
      expect(deadlines[cursor], "a final window is armed after the last re-drive").toBeDefined();
      deadlines[cursor].callback();
      await flush();
      expect(failures, "the terminal fires only after real failed attempts, and reports attempts>0").toEqual([
        {
          cls: "op:me",
          from: 0,
          blockedSeq: committed.revision,
          attempts: 3,
          reason: "continuation-timeout",
        },
      ]);
      expect(failures[0].attempts, "attempts is no longer hard-coded to 0").toBeGreaterThan(0);
      expect(host.unackedCount(), "fail-closed: the exact retained op stays available for diagnosis").toBe(1);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });

  it("an op awaiting a human pick with a LIVE peer is never terminated; when the peer dies it recovers then terminals", async () => {
    const pair = createLoopbackPair();
    const deadlines: CapturedDeadline[] = [];
    const failures: CoopDurabilityRecoveryFailure[] = [];
    const envelopesToGuest: Extract<CoopMessage, { t: "envelope" }>[] = [];
    pair.guest.onMessage(message => {
      if (message.t === "envelope") {
        envelopesToGuest.push(message);
      }
    });
    const host = new CoopDurabilityManager(pair.host, {
      operationContinuationDeadlineMs: 25,
      operationContinuationRecoveryWindowMs: 25,
      operationContinuationRecoveryMaxAttempts: 2,
      // Generous freshness: the loopback just delivered acks, so the peer reads as LIVE.
      operationPeerLivenessFreshMs: 60_000,
      scheduleOperationContinuationDeadline: (callback, _ms) => {
        const deadline: CapturedDeadline = { callback, cancelled: false };
        deadlines.push(deadline);
        return () => {
          deadline.cancelled = true;
        };
      },
      onRecoveryExhausted: failure => failures.push(failure),
    });
    const guest = new CoopDurabilityManager(pair.guest, {
      extractKey: message => (message.t === "envelope" ? { cls: "op:me", seq: message.envelope.revision } : null),
      apply: () => "applied",
    });
    /** The currently-active (latest, un-cancelled) injected continuation timer. */
    const active = (): CapturedDeadline => {
      const live = deadlines.filter(deadline => !deadline.cancelled).at(-1);
      if (live == null) {
        throw new Error("no active continuation deadline");
      }
      return live;
    };
    try {
      const committed = mePickEnvelope();
      host.commit("op:me", committed.revision, { t: "envelope", envelope: committed });
      await flush();
      expect(host.unackedCount()).toBe(1);

      // The host's OWN public prompt/UI for this op opens - the durability-layer proxy for "awaitingActionInput":
      // an owner prompt is now open, awaiting the human's pick. This re-arms the peer-convergence window.
      expect(
        host.notifyOperationAuthorityContinuationSurface("sharedInput", {
          epoch: SESSION_EPOCH,
          wave: ME_WAVE,
          turn: 0,
        }),
        "the host authority surface opened for the retained pick",
      ).toBe(1);

      // With the prompt open AND the peer demonstrably live, every deadline elapse HOLDS (re-arms) - it never
      // races the human into a destructive terminal, and it burns no recovery attempt / re-drives nothing.
      for (let round = 0; round < 8; round++) {
        active().callback();
        await flush();
        expect(failures, `awaiting-input with a live peer is never terminated (round ${round})`).toEqual([]);
      }
      expect(host.unackedCount(), "the retained pick is still held for the human, not nuked").toBe(1);
      expect(envelopesToGuest.length, "holding for an open prompt does not re-drive the op").toBe(1);

      // The peer goes dark (tab suspended / channel dropped). Liveness now fails, so the SAME deadline stops
      // holding: it recovers (bounded re-drives) and then terminals fail-closed with attempts>0.
      pair.guest.close();
      let terminalFires = 0;
      for (let round = 0; round < 6 && failures.length === 0; round++) {
        active().callback();
        await flush();
        terminalFires++;
      }
      expect(failures, "a genuinely-lost continuation still reaches the terminal once the peer is gone").toHaveLength(
        1,
      );
      expect(failures[0]).toMatchObject({
        cls: "op:me",
        blockedSeq: committed.revision,
        reason: "continuation-timeout",
      });
      expect(failures[0].attempts, "the fail-closed terminal reports real re-drive attempts (>0)").toBeGreaterThan(0);
      expect(terminalFires, "it took bounded elapses after the peer died, not an infinite wait").toBeLessThanOrEqual(6);
    } finally {
      host.dispose();
      guest.dispose();
    }
  });
});
