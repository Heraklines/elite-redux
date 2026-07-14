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
// multi-turn wave whose advance had already signaled. Protocol 32 has no gameplay fallback on a missing
// commit; that condition terminates visibly instead of manufacturing a local turn.
//
// The pending advance is set through the REAL wired receive path: a runtime assembled on the guest
// transport endpoint receives a genuine host->guest `waveResolved`, firing the production handler that
// sets the module's pendingWaveAdvance. The runtime's operation state therefore owns the guest role from
// assembly onward; the test never mutates a host runtime into a synthetic guest after its bindings exist.
// No test-only production surface is added. The scene is a minimal stub injected via the REAL
// initGlobalScene, so no Phaser / GameManager boot is needed.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  assembleCoopRuntime,
  type CoopRuntime,
  clearCoopRuntime,
  coopHasPendingWaveAdvance,
  getCoopController,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import {
  type CoopAuthoritativeBattleStateV1,
  type CoopBattleCheckpoint,
  type CoopTransport,
  createLoopbackPair,
} from "#data/elite-redux/coop/coop-transport";
import { CoopFinalizeTurnPhase } from "#phases/coop-replay-phases";
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
 * Minimal BattleScene-shaped stub exposing only the members finishTurn and the
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
 * Start a REAL authoritative runtime on the pair's guest endpoint and deliver a genuine
 * host->guest `waveResolved("win")` over its peer transport so the runtime's wired handler
 * sets the module's pendingWaveAdvance for THIS wave. Returns once the loopback has drained.
 */
async function startGuestWithPendingWin(): Promise<CoopRuntime> {
  const { runtime, peer } = startGuestRuntime();
  const controller = getCoopController();
  if (controller == null) {
    throw new Error("expected a live guest co-op controller");
  }
  // The host endpoint sends both the compatibility cue and the authoritative committed envelope.
  // Under durability the raw cue alone must not advance; the envelope is the one mutation authority.
  peer.send({ t: "waveResolved", wave: WAVE, outcome: "win" });
  const epoch = controller.sessionEpoch;
  const authoritativeState: CoopAuthoritativeBattleStateV1 = {
    version: 1,
    tick: 0,
    wave: WAVE,
    turn: 1,
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
  peer.send({
    t: "envelope",
    envelope: {
      version: 1,
      sessionEpoch: epoch,
      revision: 1,
      wave: WAVE,
      turn: 1,
      logicalPhase: "WAVE_VICTORY",
      pendingOperation: {
        id: makeCoopOperationId(epoch, 0, WAVE, "WAVE_ADVANCE"),
        kind: "WAVE_ADVANCE",
        owner: 0,
        status: "applied",
        payload: {
          wave: WAVE,
          outcome: "win",
          nextLogicalPhase: "WAVE_VICTORY",
          nextWave: WAVE + 1,
          biomeChange: false,
          eggLapse: false,
          meBoundary: "none",
          victoryKind: "wild",
          settledStateTick: authoritativeState.tick,
        },
      },
      authoritativeState,
    },
  });
  await flush();
  return runtime;
}

let guestPeer: CoopTransport | null = null;

/** Assemble with a genuinely guest-owned runtime state; mutating a host controller after assembly is invalid. */
function startGuestRuntime(): { runtime: CoopRuntime; peer: CoopTransport } {
  clearCoopRuntime();
  const { host, guest } = createLoopbackPair();
  const runtime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
  setCoopRuntime(runtime);
  runtime.controller.connect();
  guestPeer = host;
  return { runtime, peer: host };
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
  let prevGlobalScene: BattleScene;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    rec.incrementTurnCalls = 0;
    rec.queueTurnEndCalls = 0;
    rec.clearLastTurnOrderCalls = 0;
    rec.pushedPhases = [];
    rec.turn = 1;
    initGlobalScene(makeStubScene());
  });

  afterEach(() => {
    clearCoopRuntime();
    guestPeer?.close();
    guestPeer = null;
    // Citizenship (#710): this engine-free file replaces globalScene with a reset-less stub. Restore
    // the prior scene so the NEXT ER_SCENARIO file's `new GameManager` reuses a real scene instead of
    // crashing on `stub.reset is not a function`. Order-robust: each stub file restores before the
    // next file's beforeEach captures, so even back-to-back stub files chain the real scene through.
    initGlobalScene(prevGlobalScene);
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

  it("CoopFinalizeTurnPhase.finishTurn(): with NO pending advance the guest still advances the turn minimally (BUG1 path intact)", async () => {
    // Authoritative guest session but NO waveResolved delivered -> no pending advance.
    startGuestRuntime();
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
