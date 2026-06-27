/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #698 - single-turn-win finalize must NOT start a phantom next turn (post-battle-1 softlock regression).
//
// This is a regression of the BUG1 fix (coop-guest-faint-no-local-victory). On the wave's FINAL turn the
// host streams `waveResolved("win")` and parks as the reward WATCHER. When the host wins the wave in a
// SINGLE turn, the guest consumes that pending wave-advance in the SAME finalize that runs the winning
// turn - and `lastResolvedWave` is still behind, so `coopWaveAdvanceSignaledFor(wave)` reads false.
// Pre-fix, finishTurn then fell into the turn-advance branch and called incrementTurn(), starting a
// phantom turn N+1 the host already passed: the guest broadcast a command + awaited a turn-N+1 resolution
// the host (now in the reward shop) never sent -> hard softlock right after the first battle.
//
// The fix peeks the still-PENDING advance (coopHasPendingWaveAdvance) and routes the single-turn win
// through the TERMINAL branch: run the wave-advance tail (VictoryPhase), advance NO turn - exactly like a
// multi-turn wave whose advance had already signaled. The same guard gates the host-stall fallback
// CoopReplayTurnPhase.finishTurnNoStream so it never starts the phantom turn either.
//
// The pending advance is set through the REAL wired receive path: startLocalCoopSession exposes the
// spoof partner's transport endpoint, so sending a genuine host->guest `waveResolved` over it fires the
// runtime's own onWaveResolved handler (the production code that sets the module's pendingWaveAdvance).
// No test-only production surface is added. The scene is a minimal stub injected via the REAL
// initGlobalScene, so no Phaser / GameManager boot is needed.

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import {
  type CoopRuntime,
  clearCoopRuntime,
  coopHasPendingWaveAdvance,
  getCoopController,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleCheckpoint } from "#data/elite-redux/coop/coop-transport";
import { CoopFinalizeTurnPhase } from "#phases/coop-replay-phases";
import { CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** LoopbackTransport delivers on a microtask; let it drain before asserting. */
const flush = () => new Promise<void>(r => setTimeout(r, 0));

/** The wave the stub battle is on - the host wins THIS wave in one turn. */
const WAVE = 5;

// --- The recorder behind the injected stub scene: the levers finishTurn / maybeRunCoopWaveAdvance pull.
const rec = {
  incrementTurnCalls: 0,
  queueTurnEndCalls: 0,
  clearLastTurnOrderCalls: 0,
  pushedPhases: [] as string[],
  turn: 1,
};

/**
 * Minimal BattleScene-shaped stub exposing only the members finishTurn / finishTurnNoStream and the
 * "win" arm of maybeRunCoopWaveAdvance touch (getEnemyParty -> battlerArg, pushNew("VictoryPhase")).
 */
function makeStubScene(): BattleScene {
  return {
    currentBattle: {
      waveIndex: WAVE,
      battleType: 0,
      get turn() {
        return rec.turn;
      },
      incrementTurn() {
        rec.incrementTurnCalls++;
        rec.turn++;
      },
    },
    // The "win" wave-advance tail addresses the last enemy by id; an empty party falls back to the
    // player battler index, so no real Pokemon is needed.
    getEnemyParty() {
      return [];
    },
    phaseManager: {
      shiftPhase() {},
      pushNew(name: string, ..._args: unknown[]) {
        rec.pushedPhases.push(name);
      },
      queueTurnEndPhases() {
        rec.queueTurnEndCalls++;
        rec.pushedPhases.push("TurnEndPhase", "FaintPhase", "VictoryPhase");
      },
      dynamicQueueManager: {
        clearLastTurnOrder() {
          rec.clearLastTurnOrderCalls++;
        },
      },
    },
  } as unknown as BattleScene;
}

/**
 * Start a REAL authoritative local session, flip the local controller to GUEST (so the production
 * isCoopAuthoritativeGuest() and the onWaveResolved guest-gate read true), and deliver a genuine
 * host->guest `waveResolved("win")` over the spoof partner's transport so the runtime's wired handler
 * sets the module's pendingWaveAdvance for THIS wave. Returns once the loopback has drained.
 */
async function startGuestWithPendingWin(): Promise<CoopRuntime> {
  const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
  const controller = getCoopController();
  if (controller == null) {
    throw new Error("expected a live co-op controller after startLocalCoopSession");
  }
  controller.role = "guest";
  if (runtime.partnerTransport == null) {
    throw new Error("expected a spoof partner transport in a local session");
  }
  // The spoof (host end) tells the guest the wave resolved with a win - the real receive path.
  runtime.partnerTransport.send({ t: "waveResolved", wave: WAVE, outcome: "win" });
  await flush();
  return runtime;
}

/** Invoke a phase's private method by name without `as any` (cast through `unknown` to a callable). */
function callPrivate(instance: object, method: string): void {
  const fn = (instance as unknown as Record<string, () => void>)[method];
  fn.call(instance);
}

/** Neutralize Phase.end() so the methods under test only exercise the turn-end DECISION, not the queue. */
function stubEnd(instance: object): void {
  (instance as unknown as Record<string, () => void>).end = () => {};
}

function makeFinalizePhase(turn: number): CoopFinalizeTurnPhase {
  const checkpoint = {} as unknown as CoopBattleCheckpoint;
  const phase = new CoopFinalizeTurnPhase(turn, checkpoint, "checksum");
  stubEnd(phase);
  return phase;
}

describe("#698 - single-turn-win finalize must not start a phantom next turn", () => {
  beforeEach(() => {
    rec.incrementTurnCalls = 0;
    rec.queueTurnEndCalls = 0;
    rec.clearLastTurnOrderCalls = 0;
    rec.pushedPhases = [];
    rec.turn = 1;
    initGlobalScene(makeStubScene());
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  it("sanity: the host->guest waveResolved sets a PENDING advance for this wave", async () => {
    await startGuestWithPendingWin();
    expect(getCoopController()?.role).toBe("guest");
    // coopWaveAdvanceSignaledFor(WAVE) is still false (lastResolvedWave behind) but the advance is pending.
    expect(coopHasPendingWaveAdvance()).toBe(true);
  });

  it("CoopFinalizeTurnPhase.finishTurn(): a same-turn win runs the wave-advance tail and advances NO turn", async () => {
    await startGuestWithPendingWin();

    const phase = makeFinalizePhase(1);
    callPrivate(phase, "finishTurn");

    // The phantom turn must NOT be created: no incrementTurn, no turn-order clear, turn stays put.
    expect(rec.incrementTurnCalls).toBe(0);
    expect(rec.clearLastTurnOrderCalls).toBe(0);
    expect(rec.turn).toBe(1);
    // The damaging turn-end engine must NOT run on the terminal branch either.
    expect(rec.queueTurnEndCalls).toBe(0);
    // Instead the wave-advance tail runs: the pending advance is consumed and a VictoryPhase is queued.
    expect(coopHasPendingWaveAdvance()).toBe(false);
    expect(rec.pushedPhases).toContain("VictoryPhase");
  });

  it("CoopReplayTurnPhase.finishTurnNoStream(): the host-stall fallback ALSO skips the phantom turn when an advance is pending", async () => {
    await startGuestWithPendingWin();

    const phase = new CoopReplayTurnPhase(1);
    stubEnd(phase);
    callPrivate(phase, "finishTurnNoStream");

    // No phantom turn, no turn-end engine. The fallback has no wave-advance tail, so it leaves the
    // pending advance in place for the next finalize / checkpoint resync to consume.
    expect(rec.incrementTurnCalls).toBe(0);
    expect(rec.clearLastTurnOrderCalls).toBe(0);
    expect(rec.queueTurnEndCalls).toBe(0);
    expect(coopHasPendingWaveAdvance()).toBe(true);
  });

  it("CoopFinalizeTurnPhase.finishTurn(): with NO pending advance the guest still advances the turn minimally (BUG1 path intact)", async () => {
    // Authoritative guest session but NO waveResolved delivered -> no pending advance.
    startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    const controller = getCoopController();
    if (controller != null) {
      controller.role = "guest";
    }
    expect(coopHasPendingWaveAdvance()).toBe(false);

    const phase = makeFinalizePhase(1);
    callPrivate(phase, "finishTurn");

    // The normal mid-wave turn still advances minimally (the BUG1 fix), and queues NO local victory.
    expect(rec.incrementTurnCalls).toBe(1);
    expect(rec.clearLastTurnOrderCalls).toBe(1);
    expect(rec.turn).toBe(2);
    expect(rec.queueTurnEndCalls).toBe(0);
    expect(rec.pushedPhases).not.toContain("VictoryPhase");
  });
});
