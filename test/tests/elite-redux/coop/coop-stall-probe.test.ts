/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #P33 asym-watchdog - engine-free coverage for the machine-wait registry and the
// asymmetric stall escalator. Pure state + injected clock/beats, no engine/transport.
//   - registry semantics (age, oldest, labels, idempotent end, empty sentinel)
//   - asymmetric detection with injected beats (mutual vs asymmetric vs none)
//   - bounded escalation: recover x N (with cooldown) -> terminate ONCE -> quiet
//   - the CRITICAL design rule: only MACHINE waits count; a human-input wait that is
//     never registered is never counted (no false positive from an open menu / shop).
// =============================================================================

import {
  beginCoopMachineWait,
  classifyCoopStall,
  clearCoopMachineWaits,
  coopMachineWaitLabels,
  createCoopAsymmetricEscalator,
  oldestCoopAsymmetricMachineWaitMs,
  oldestCoopMachineWaitMs,
  setCoopStallProbeClock,
} from "#data/elite-redux/coop/coop-stall-probe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TRIGGER = 20_000;

describe("#P33 coop machine-wait registry", () => {
  let now = 0;
  beforeEach(() => {
    now = 1_000_000;
    setCoopStallProbeClock(() => now);
    clearCoopMachineWaits();
  });
  afterEach(() => {
    clearCoopMachineWaits();
    setCoopStallProbeClock(null);
  });

  it("reports -1 when nothing is registered", () => {
    expect(oldestCoopMachineWaitMs()).toBe(-1);
    expect(oldestCoopAsymmetricMachineWaitMs()).toBe(-1);
    expect(coopMachineWaitLabels()).toEqual([]);
  });

  it("keeps reciprocal barriers as mutual-stall evidence without manufacturing an asymmetric deadlock", () => {
    const endBarrier = beginCoopMachineWait("coop-rendezvous:cmd:1:1", {
      asymmetricEligible: false,
    });
    now += TRIGGER + 10_000;
    expect(oldestCoopMachineWaitMs(), "the barrier still participates in mutual deadlock detection").toBe(30_000);
    expect(
      oldestCoopAsymmetricMachineWaitMs(),
      "a peer still rendering its route to the barrier is healthy, not asymmetric-deadlock proof",
    ).toBe(-1);

    const endHold = beginCoopMachineWait("coop-resync-hold:t1");
    now += 5_000;
    expect(oldestCoopMachineWaitMs()).toBe(35_000);
    expect(oldestCoopAsymmetricMachineWaitMs()).toBe(5_000);
    endBarrier();
    endHold();
  });

  it("tracks the age of a registered machine wait and clears it on end", () => {
    const end = beginCoopMachineWait("coop-resync-hold:t4");
    now += 5_000;
    expect(oldestCoopMachineWaitMs()).toBe(5_000);
    expect(coopMachineWaitLabels()).toEqual(["coop-resync-hold:t4@5000ms"]);
    end();
    expect(oldestCoopMachineWaitMs()).toBe(-1);
    expect(coopMachineWaitLabels()).toEqual([]);
  });

  it("returns the OLDEST across multiple waits and recomputes as waits end", () => {
    const endOld = beginCoopMachineWait("coop-rendezvous:cmd:4:2");
    now += 10_000;
    const endNew = beginCoopMachineWait("coop-resync-hold:t7");
    now += 3_000;
    // oldest = the rendezvous wait, 13s old
    expect(oldestCoopMachineWaitMs()).toBe(13_000);
    // labels are oldest-first
    expect(coopMachineWaitLabels()).toEqual(["coop-rendezvous:cmd:4:2@13000ms", "coop-resync-hold:t7@3000ms"]);
    endOld();
    // now only the newer wait remains
    expect(oldestCoopMachineWaitMs()).toBe(3_000);
    endNew();
    expect(oldestCoopMachineWaitMs()).toBe(-1);
  });

  it("end is idempotent and never disturbs a re-registered wait of the same label", () => {
    const endA = beginCoopMachineWait("dup");
    endA();
    endA(); // idempotent
    const endB = beginCoopMachineWait("dup");
    now += 2_000;
    expect(oldestCoopMachineWaitMs()).toBe(2_000);
    endA(); // stale handle must NOT remove the fresh registration
    expect(oldestCoopMachineWaitMs()).toBe(2_000);
    endB();
    expect(oldestCoopMachineWaitMs()).toBe(-1);
  });

  it("CRITICAL RULE: a HUMAN-INPUT wait is never registered, so it is never counted", () => {
    // A machine wait (blocked on the peer) counts.
    const endMachine = beginCoopMachineWait("coop-resync-hold:t9");
    now += TRIGGER + 1;
    expect(oldestCoopMachineWaitMs()).toBeGreaterThanOrEqual(TRIGGER);
    endMachine();
    // An open menu / reward-shop browse awaiting the LOCAL player is NOT a machine wait: the site simply
    // does not call beginCoopMachineWait, so the registry stays empty and cannot escalate a thinking human.
    now += 10 * TRIGGER;
    expect(oldestCoopMachineWaitMs(), "no human-input wait is ever registered here").toBe(-1);
    expect(coopMachineWaitLabels()).toEqual([]);
  });
});

describe("#P33 asymmetric stall classification (injected beats)", () => {
  const base = { transportConnected: true, now: 0 };

  it("no local stall -> none regardless of the peer", () => {
    expect(
      classifyCoopStall({
        ...base,
        localMs: TRIGGER - 1,
        peerBeatMs: null,
        peerBeatAgeMs: null,
      }),
    ).toBe("none");
  });

  it("both stalled with a fresh high peer beat -> mutual (handled by the existing path)", () => {
    expect(
      classifyCoopStall({
        ...base,
        localMs: 40_000,
        peerBeatMs: 30_000,
        peerBeatAgeMs: 2_000,
      }),
    ).toBe("mutual");
  });

  it("peer beat is fresh but LOW (peer progressing / short wait) -> asymmetric", () => {
    expect(
      classifyCoopStall({
        ...base,
        localMs: 40_000,
        peerBeatMs: 1_000,
        peerBeatAgeMs: 2_000,
      }),
    ).toBe("asymmetric");
  });

  it("peer has NEVER beaten while connected (advanced or non-reporting hold) -> asymmetric", () => {
    expect(
      classifyCoopStall({
        ...base,
        localMs: 40_000,
        peerBeatMs: null,
        peerBeatAgeMs: null,
      }),
    ).toBe("asymmetric");
  });

  it("peer beat has gone SILENT past the window while connected -> asymmetric", () => {
    expect(
      classifyCoopStall({
        ...base,
        localMs: 40_000,
        peerBeatMs: 30_000,
        peerBeatAgeMs: 25_000,
      }),
    ).toBe("asymmetric");
  });

  it("peer silent but transport DISCONNECTED -> none (reconnect/disconnect path owns this)", () => {
    expect(
      classifyCoopStall({
        ...base,
        transportConnected: false,
        localMs: 40_000,
        peerBeatMs: null,
        peerBeatAgeMs: null,
      }),
    ).toBe("none");
  });

  it("peer beat aging inside the silence window (still plausibly mutually stalled) -> none (wait longer)", () => {
    // fresh window (12.5s) < age (15s) < silence window (20s), high waitingMs: ambiguous, keep waiting.
    expect(
      classifyCoopStall({
        ...base,
        localMs: 40_000,
        peerBeatMs: 30_000,
        peerBeatAgeMs: 15_000,
      }),
    ).toBe("none");
  });
});

describe("#P33 bounded asymmetric escalation", () => {
  it("recovers a bounded number of times (respecting cooldown) then terminates ONCE", () => {
    const escalator = createCoopAsymmetricEscalator({
      maxRecoveryAttempts: 3,
      recoveryCooldownMs: 30_000,
    });
    // A persistent asymmetric stall: peer never beats while connected, local always stalled.
    const asym = (now: number) => ({
      localMs: 40_000,
      peerBeatMs: null,
      peerBeatAgeMs: null,
      transportConnected: true,
      now,
    });

    // First tick: recover.
    expect(escalator.assess(asym(0))).toBe("recover");
    expect(escalator.attemptCount()).toBe(1);
    // Within cooldown: no action.
    expect(escalator.assess(asym(5_000))).toBe("none");
    expect(escalator.assess(asym(29_999))).toBe("none");
    // Cooldown elapsed: recover #2.
    expect(escalator.assess(asym(30_000))).toBe("recover");
    // Cooldown elapsed: recover #3 (the bound).
    expect(escalator.assess(asym(60_000))).toBe("recover");
    expect(escalator.attemptCount()).toBe(3);
    // Bound exhausted: escalate to the shared terminal exactly once.
    expect(escalator.assess(asym(90_000))).toBe("terminate");
    // Idempotent afterward: it does not re-fire the terminal every tick.
    expect(escalator.assess(asym(120_000))).toBe("none");
    expect(escalator.assess(asym(150_000))).toBe("none");
  });

  it("a resolved stall (non-asymmetric tick) re-arms the full recovery budget", () => {
    const escalator = createCoopAsymmetricEscalator({
      maxRecoveryAttempts: 2,
      recoveryCooldownMs: 30_000,
    });
    const asym = (now: number) => ({
      localMs: 40_000,
      peerBeatMs: null,
      peerBeatAgeMs: null,
      transportConnected: true,
      now,
    });
    const healthy = (now: number) => ({
      localMs: 0,
      peerBeatMs: null,
      peerBeatAgeMs: null,
      transportConnected: true,
      now,
    });

    expect(escalator.assess(asym(0))).toBe("recover");
    // Stall clears (e.g. the hold converged) -> reset.
    expect(escalator.assess(healthy(1_000))).toBe("none");
    expect(escalator.attemptCount()).toBe(0);
    // A brand-new asymmetric stall gets the full budget again, immediately (cooldown was reset).
    expect(escalator.assess(asym(2_000))).toBe("recover");
    expect(escalator.assess(asym(32_000))).toBe("recover");
    expect(escalator.assess(asym(62_000))).toBe("terminate");
  });

  it("mutual stalls are never owned by the escalator (returns none so the existing path handles them)", () => {
    const escalator = createCoopAsymmetricEscalator();
    for (let i = 0; i < 5; i++) {
      expect(
        escalator.assess({
          localMs: 40_000,
          peerBeatMs: 40_000,
          peerBeatAgeMs: 1_000,
          transportConnected: true,
          now: i * 40_000,
        }),
      ).toBe("none");
    }
  });
});
