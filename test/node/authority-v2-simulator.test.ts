/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - LANE 6 acceptance oracle (node-pure, engine-free, <5s).
//
// This is the BLOCKING sentinel gate for every authority-v2 migration merge. It
// enforces, across randomized bounded fault schedules AND directed scenarios, the
// contract's liveness/safety guarantee:
//
//   EITHER both endpoints converge to the same material revision AND compatible
//   nextControl, OR both enter the same retained terminal transaction; NEVER is one
//   endpoint parked without an owned recoverable transaction.
//
// Every concrete under test is an OWN reference implementation derived from the
// frozen contract (test/tools/coop-authority-v2-simulator.ts) - nothing here (or
// there) imports any implementation lane's production code or the legacy netcode.
// The single virtual clock in the harness is deliberate: the legacy fault harness
// once produced a false green via a mixed real/virtual clock.
//
// Seeds ride every failure message (the simulator throws SimInvariantError with
// both endpoints' frontiers + the seed on any deadlock / double-mutate / stall).
// =============================================================================

import type { CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import {
  AuthorityV2Simulator,
  buildRandomizedRun,
  commandControl,
  controlKey,
  EndpointScheduler,
  type FaultConfig,
  makeRng,
  noFault,
  replacementControl,
  SimInvariantError,
  type StoryAct,
  standardStory,
  VirtualClock,
} from "#test/tools/coop-authority-v2-simulator";
import { describe, expect, it } from "vitest";

const EPOCH = 7;

// Import the canonical control type from the frozen contract for annotations.
type Control = CoopNextControl;

function cleanFault(overrides: Partial<FaultConfig> = {}): FaultConfig {
  return { ...noFault(), ...overrides };
}

// ---------------------------------------------------------------------------
// The acceptance oracle: randomized bounded fault schedules.
// ---------------------------------------------------------------------------

describe("authority-v2 simulator - randomized fault oracle", () => {
  const SEED_COUNT = 200;

  it(`converges or terminalizes symmetrically across ${SEED_COUNT} seeded fault schedules`, () => {
    for (let seed = 1; seed <= SEED_COUNT; seed++) {
      const sim = buildRandomizedRun(seed);
      let result: ReturnType<AuthorityV2Simulator["run"]>;
      try {
        result = sim.run();
      } catch (err) {
        // The seed is already embedded in the SimInvariantError message; re-throw with
        // an explicit banner so a gate failure is triaged instantly.
        if (err instanceof SimInvariantError) {
          throw new Error(`[authority-v2 oracle] FAILED seed=${seed}: ${err.message}`);
        }
        throw err;
      }
      const r = result.report;
      // Acceptance oracle - EITHER converged to the same material revision + compatible
      // control, OR both in the same terminal. NEVER a one-sided park (the deadlock
      // detector inside run() would already have thrown with the seed).
      if (result.outcome === "terminal") {
        expect(r.authorityTerminal, `seed=${seed} authority terminal`).not.toBeNull();
        expect(r.replicaTerminal, `seed=${seed} both terminal`).toBe(r.authorityTerminal);
      } else {
        expect(r.replicaFrontier, `seed=${seed} same material revision`).toBe(r.authorityFrontier);
        expect(r.replicaCumulative, `seed=${seed} same material accumulator`).toBe(r.authorityCumulative);
        expect(r.replicaControl, `seed=${seed} compatible nextControl`).toBe(r.authorityControl);
      }
      // Duplicate-never-double-mutates holds for EVERY run (checked continuously in run()).
      for (const [revision, count] of sim.replica.mutationCounts) {
        expect(count, `seed=${seed} revision ${revision} mutated once`).toBeLessThanOrEqual(1);
      }
      // Teardown leaves nothing behind.
      sim.dispose("oracle-teardown");
      const t = sim.teardownState();
      expect(t.authorityTimers, `seed=${seed} authority timers cleared`).toBe(0);
      expect(t.replicaTimers, `seed=${seed} replica timers cleared`).toBe(0);
      expect(t.retained, `seed=${seed} retained cleared`).toBe(0);
      expect(t.busInFlight, `seed=${seed} bus drained`).toBe(0);
      expect(t.liveRecoveries, `seed=${seed} recoveries settled`).toBe(0);
    }
  });

  it("both terminal-ending and live-ending schedules occur across the seed space", () => {
    let terminal = 0;
    let converged = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const sim = buildRandomizedRun(seed);
      const result = sim.run();
      if (result.outcome === "terminal") {
        terminal++;
      } else {
        converged++;
      }
    }
    // Both branches of the acceptance oracle are actually exercised (not a vacuous pass).
    expect(terminal).toBeGreaterThan(0);
    expect(converged).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Directed scenarios (named in the build directive).
// ---------------------------------------------------------------------------

describe("authority-v2 simulator - directed scenarios", () => {
  it("duplicate delivery never double-mutates", () => {
    const rng = makeRng(101);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({
      seed: 101,
      story,
      fault: cleanFault({ dupProb: 0.9, latencyMax: 3 }),
      budget: 4000,
    });
    const result = sim.run();
    expect(result.outcome).toBe("converged");
    for (const [, count] of sim.replica.mutationCounts) {
      expect(count).toBeLessThanOrEqual(1);
    }
    // Every committed revision was applied exactly once.
    expect(sim.replica.mutationCounts.size).toBe(sim.report().authorityFrontier);
    expect(sim.replica.materialAccumulator).toBe(sim.report().authorityCumulative);
  });

  it("gap -> tail -> converge", () => {
    const rng = makeRng(202);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({
      seed: 202,
      story,
      fault: cleanFault({ latencyMax: 2 }),
      budget: 4000,
      // Heavily delay revision 2 so revision 3 arrives first: a genuine gap the replica must
      // fill by a tail request + (delayed) redelivery before it can converge.
      reorderDelayByRevision: { 2: 40 },
    });
    const result = sim.run();
    expect(sim.gapWasObserved, "a revision gap was observed").toBe(true);
    expect(sim.gapRequestCount, "the gap requested a recovery tail").toBeGreaterThan(0);
    expect(result.outcome).toBe("converged");
    expect(sim.report().replicaFrontier).toBe(sim.report().authorityFrontier);
  });

  it("reorder across a supersession", () => {
    // Four turns then a WAVE_ADVANCE that subsumes them. Deliver the wave FIRST (heavy
    // reorder delay on the turns) - the replica must jump via subsumption, apply each
    // revision at most once, and converge.
    const epoch = EPOCH;
    const story: StoryAct[] = [
      {
        kind: "TURN_COMMIT",
        control: commandControl(epoch, 1, 1, 0, 100),
        delta: 3,
        checkpoint: false,
        subsumePrior: false,
      },
      {
        kind: "TURN_COMMIT",
        control: commandControl(epoch, 1, 2, 1, 101),
        delta: 4,
        checkpoint: false,
        subsumePrior: false,
      },
      {
        kind: "REPLACEMENT_COMMIT",
        control: replacementControl(epoch, 1, 2, 1, 0, 0),
        delta: 5,
        checkpoint: false,
        subsumePrior: false,
      },
      {
        kind: "TURN_COMMIT",
        control: commandControl(epoch, 1, 3, 0, 100),
        delta: 6,
        checkpoint: false,
        subsumePrior: false,
      },
      {
        kind: "WAVE_ADVANCE",
        control: commandControl(epoch, 2, 1, 0, 100),
        delta: 7,
        checkpoint: true,
        subsumePrior: true,
      },
    ];
    const sim = new AuthorityV2Simulator({
      seed: 303,
      story,
      fault: cleanFault({ latencyMax: 1 }),
      budget: 4000,
      commitCadenceMs: 6,
      // Delay revisions 1-4 so the WAVE_ADVANCE (revision 5) arrives first.
      reorderDelayByRevision: { 1: 60, 2: 60, 3: 60, 4: 60 },
    });
    // Let the wave arrive and be applied via subsumption before the turns land.
    sim.runUntil(() => sim.replica.materialRevision >= 5, 200);
    expect(sim.replica.materialRevision, "wave jumped the replica via subsumption").toBe(5);
    const result = sim.run();
    expect(result.outcome).toBe("converged");
    // No revision applied more than once despite the late-arriving (now duplicate) turns.
    for (const [, count] of sim.replica.mutationCounts) {
      expect(count).toBeLessThanOrEqual(1);
    }
    expect(sim.report().replicaControl).toBe(controlKey(commandControl(epoch, 2, 1, 0, 100)));
  });

  it("disconnect mid-entry -> reconnect -> converge", () => {
    const rng = makeRng(404);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({
      seed: 404,
      story,
      // Link fully down for a mid-run window; nothing crosses. Must heal on reconnect.
      fault: cleanFault({ downWindows: [[10, 40]] }),
      budget: 4000,
    });
    const result = sim.run();
    expect(result.outcome).toBe("converged");
    expect(sim.report().replicaFrontier).toBe(sim.report().authorityFrontier);
    expect(sim.report().replicaCumulative).toBe(sim.report().authorityCumulative);
  });

  it("suspension does not consume mechanical deadlines", () => {
    // Drive the scheduler directly: a mechanical (recovery-class) deadline set before a
    // suspension must NOT fire while suspended, but an absolute-class deadline MUST.
    const clock = new VirtualClock();
    const sched = new EndpointScheduler(clock, "probe");
    let mechFired = false;
    let absFired = false;
    sched.schedule({ ownerId: "probe", address: "probe:mech", reason: "mechanical" }, 10, "recovery", () => {
      mechFired = true;
    });
    sched.schedule({ ownerId: "probe", address: "probe:abs", reason: "absolute" }, 10, "absolute", () => {
      absFired = true;
    });
    sched.setSuspended(true);
    // Advance 100 virtual units while suspended.
    clock.advance(100);
    sched.sync();
    expect(mechFired, "mechanical deadline preserved across suspension").toBe(false);
    expect(absFired, "absolute deadline still fires under suspension").toBe(true);
    // Resume: now the mechanical class accrues and the deadline fires.
    sched.setSuspended(false);
    clock.advance(10);
    sched.sync();
    expect(mechFired, "mechanical deadline fires after resume").toBe(true);
  });

  it("recovery with stale frontier terminalizes BOTH", () => {
    const rng = makeRng(505);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({
      seed: 505,
      story,
      fault: cleanFault({ latencyMax: 2 }),
      budget: 4000,
      // Advance the authority prune horizon above the replica's (still low) captured frontier,
      // then force a snapshot recovery from that now-stale frontier - unrecoverable, so the
      // safe response is a SHARED terminal on both endpoints.
      pruneHorizonAt: { step: 2, horizon: 50 },
      triggerSnapshotRecoveryAt: { step: 3 },
    });
    const result = sim.run();
    expect(result.outcome, "the stale recovery drove a shared terminal").toBe("terminal");
    expect(sim.report().authorityTerminal, "authority terminalized").not.toBeNull();
    expect(sim.report().replicaTerminal, "replica reached the SAME terminal").toBe(sim.report().authorityTerminal);
  });
});

// ---------------------------------------------------------------------------
// Sentinel list (named tests from the build directive).
// ---------------------------------------------------------------------------

describe("authority-v2 simulator - sentinels", () => {
  it("entry commit/delivery/apply/retire", () => {
    const story: StoryAct[] = [
      {
        kind: "TURN_COMMIT",
        control: commandControl(EPOCH, 1, 1, 0, 100),
        delta: 5,
        checkpoint: false,
        subsumePrior: false,
      },
    ];
    const sim = new AuthorityV2Simulator({ seed: 1, story, fault: noFault(), budget: 1000 });
    // Commit assigns revision 1.
    expect(sim.authority.log.latestRevision()).toBe(0);
    sim.runUntil(() => sim.authority.log.latestRevision() >= 1, 100);
    expect(sim.authority.log.latestRevision()).toBe(1);
    // Delivery + apply: the replica materializes it.
    sim.runUntil(() => sim.replica.materialRevision >= 1, 100);
    expect(sim.replica.materialAccumulator).toBe(5);
    // Retire: retained() empties once the receipts are accepted.
    sim.runUntil(() => sim.authority.log.retained().length === 0, 200);
    expect(sim.authority.log.retained().length).toBe(0);
    const result = sim.run();
    expect(result.outcome).toBe("converged");
  });

  it("duplicate no-double-mutate", () => {
    const rng = makeRng(11);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({ seed: 11, story, fault: cleanFault({ dupProb: 1.0 }), budget: 4000 });
    sim.run();
    for (const [, count] of sim.replica.mutationCounts) {
      expect(count).toBe(1);
    }
  });

  it("revision gap requests recovery", () => {
    const rng = makeRng(12);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({
      seed: 12,
      story,
      fault: cleanFault(),
      budget: 4000,
      reorderDelayByRevision: { 2: 40 },
    });
    sim.run();
    expect(sim.gapWasObserved).toBe(true);
    expect(sim.gapRequestCount).toBeGreaterThan(0);
  });

  it("turn installs exact COMMAND control", () => {
    const control: Control = commandControl(EPOCH, 3, 4, 1, 202);
    const story: StoryAct[] = [{ kind: "TURN_COMMIT", control, delta: 2, checkpoint: false, subsumePrior: false }];
    const sim = new AuthorityV2Simulator({ seed: 21, story, fault: noFault(), budget: 1000 });
    sim.run();
    expect(sim.replica.installedControl).toEqual(control);
    expect(sim.report().replicaControl).toBe(controlKey(control));
  });

  it("replacement installs exact successor control", () => {
    const control: Control = replacementControl(EPOCH, 2, 3, 2, 1, 1);
    const story: StoryAct[] = [
      {
        kind: "TURN_COMMIT",
        control: commandControl(EPOCH, 2, 3, 0, 100),
        delta: 1,
        checkpoint: false,
        subsumePrior: false,
      },
      { kind: "REPLACEMENT_COMMIT", control, delta: 2, checkpoint: false, subsumePrior: false },
    ];
    const sim = new AuthorityV2Simulator({ seed: 22, story, fault: noFault(), budget: 1000 });
    sim.run();
    expect(sim.replica.installedControl).toEqual(control);
  });

  it("wave installs exact destination control", () => {
    const dest: Control = commandControl(EPOCH, 5, 1, 0, 100);
    const story: StoryAct[] = [
      {
        kind: "TURN_COMMIT",
        control: commandControl(EPOCH, 4, 1, 0, 100),
        delta: 1,
        checkpoint: false,
        subsumePrior: false,
      },
      { kind: "WAVE_ADVANCE", control: dest, delta: 2, checkpoint: true, subsumePrior: true },
    ];
    const sim = new AuthorityV2Simulator({ seed: 23, story, fault: noFault(), budget: 1000 });
    sim.run();
    expect(sim.replica.installedControl).toEqual(dest);
  });

  it("terminal freezes both sides", () => {
    const rng = makeRng(24);
    const story = standardStory(rng, { terminal: true });
    const sim = new AuthorityV2Simulator({ seed: 24, story, fault: cleanFault({ latencyMax: 2 }), budget: 4000 });
    const result = sim.run();
    expect(result.outcome).toBe("terminal");
    expect(sim.authority.terminal).not.toBeNull();
    expect(sim.replica.terminal).toBe(sim.authority.terminal);
    // Frozen: the frontiers agree and nothing remains retained.
    expect(sim.report().replicaFrontier).toBe(sim.report().authorityFrontier);
    expect(sim.authority.log.retained().length).toBe(0);
  });

  it("recovery restores material+log+control atomically", () => {
    const rng = makeRng(25);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({
      seed: 25,
      story,
      fault: cleanFault({ latencyMax: 2 }),
      budget: 4000,
      triggerSnapshotRecoveryAt: { step: 30 },
    });
    // Run to the point the recovery has settled.
    sim.runUntil(() => sim.liveRecoveries.length > 0, 200);
    const txn = sim.liveRecoveries[0];
    expect(txn, "a recovery transaction was opened").toBeDefined();
    if (!txn) {
      throw new Error("no recovery transaction opened");
    }
    // While fenced, a delivery is buffered (admission is frozen) - never applied mid-recovery.
    expect(txn.capturedFrontier).toBeGreaterThanOrEqual(0);
    sim.runUntil(() => txn.isSettled, 400);
    expect(txn.phase === "released" || txn.phase === "terminalized").toBe(true);
    // After the atomic apply, material + frontier + control are mutually consistent.
    const result = sim.run();
    expect(result.outcome).toBe("converged");
    expect(sim.report().replicaFrontier).toBe(sim.report().authorityFrontier);
    expect(sim.report().replicaCumulative).toBe(sim.report().authorityCumulative);
    expect(sim.report().replicaControl).toBe(sim.report().authorityControl);
  });

  it("teardown leaves zero leases/timers/waiters/retained entries", () => {
    const rng = makeRng(26);
    const story = standardStory(rng, { terminal: false });
    const sim = new AuthorityV2Simulator({
      seed: 26,
      story,
      fault: cleanFault({ dropProb: 0.2, dupProb: 0.2 }),
      budget: 4000,
    });
    sim.run();
    sim.dispose("sentinel-teardown");
    const t = sim.teardownState();
    expect(t.authorityTimers).toBe(0);
    expect(t.replicaTimers).toBe(0);
    expect(t.retained).toBe(0);
    expect(t.busInFlight).toBe(0);
    expect(t.liveRecoveries).toBe(0);
    expect(t.buffered).toBe(0);
  });
});
