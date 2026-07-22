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
// Pre-fix, finishTurn then fell into the ordinary continuation branch: it advanced the cursor AND allowed
// the queue to start TurnInit/Command for a turn the host already passed. The guest broadcast a command +
// awaited a turn-N+1 resolution the host (now in the reward shop) never sent -> hard post-battle softlock.
//
// The fix peeks the still-PENDING advance (coopHasPendingWaveAdvance) and routes the single-turn win
// through the TERMINAL branch: run the wave-advance tail (VictoryPhase), mirror the host's settled numeric
// turn, but queue no TurnInit/Command. Protocol 32 has no gameplay fallback on a missing
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
  coopRetainedWinSupersedesReplay,
  getCoopController,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import {
  type CoopAuthoritativeBattleStateV1,
  type CoopBattleCheckpoint,
  type CoopTransport,
  createLoopbackPair,
} from "#data/elite-redux/coop/coop-transport";
import { getCoopWaveAdvanceOperationEpoch } from "#data/elite-redux/coop/coop-wave-operation";
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
  clearPhaseQueueCalls: 0,
  queuedFuture: [] as string[],
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
      getQueuedPhaseNames() {
        return [...rec.queuedFuture];
      },
      clearPhaseQueue() {
        rec.clearPhaseQueueCalls++;
        rec.queuedFuture = [];
      },
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
async function startGuestWithPendingWin(settledTurn = 1): Promise<CoopRuntime> {
  const { runtime, peer } = startGuestRuntime();
  const controller = getCoopController();
  if (controller == null) {
    throw new Error("expected a live guest co-op controller");
  }
  // The host endpoint sends both the compatibility cue and the authoritative committed envelope.
  // Under durability the raw cue alone must not advance; the envelope is the one mutation authority.
  peer.send({ t: "waveResolved", wave: WAVE, outcome: "win" });
  // This engine-free fixture does not stand up a peer controller to negotiate a run epoch. Address the
  // retained envelope to the owning operation runtime's valid epoch, never the controller's pre-handshake
  // sentinel epoch 0.
  const epoch = getCoopWaveAdvanceOperationEpoch(runtime.waveOperationBinding);
  const authoritativeState: CoopAuthoritativeBattleStateV1 = {
    version: 1,
    tick: 0,
    wave: WAVE,
    turn: settledTurn,
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
      turn: settledTurn,
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
    rec.clearPhaseQueueCalls = 0;
    rec.queuedFuture = [];
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

  it("CoopFinalizeTurnPhase.finishTurn(): a same-turn win mirrors the settled turn without queuing a phantom loop", async () => {
    await startGuestWithPendingWin();
    // A delayed final carrier may arrive after local presentation speculatively queued the next encounter.
    // The retained host transition must replace that future instead of appending Victory behind it.
    rec.queuedFuture = ["NextEncounterPhase", "NewBattlePhase"];

    const phase = makeFinalizePhase(1);
    callPrivate(phase, "finishTurn");

    // Match the host's already-settled numeric turn boundary, but never queue the damaging turn-end engine
    // or its TurnInit/Command continuation. A turn number alone is not a phantom playable turn.
    expect(rec.incrementTurnCalls).toBe(1);
    expect(rec.clearLastTurnOrderCalls).toBe(1);
    expect(rec.turn).toBe(2);
    expect(rec.queueTurnEndCalls).toBe(0);
    expect(rec.clearPhaseQueueCalls, "the retained transition fences speculative future phases").toBe(1);
    expect(rec.queuedFuture, "the speculative local next-wave tail was discarded").toEqual([]);
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

// Dirty-lane won-by-faint DEFERRED-settlement supersession (campaign run 29912693840, SHA ad1744d4b,
// wave-2-turn-3 mutual-wait deadlock). When a faint on the wave's winning turn co-wins the wave, the host's
// automatic victory boundary settles on `sourceTurn + 1` (the host's currentBattle.turn already advanced past
// the faint before the seal - see stageAutomaticVictory..., `currentTurn === identity.turn + 1`). The guest's
// pure-renderer replay for that same wave is still parked at the SOURCE (faint) turn = `settledTurn - 1`, one
// BELOW the propagated settledTurn. Pre-fix the WIN supersession fence used `turn >= settledTurn`, so the
// parked source-turn replay (2) tested `2 >= 3` = false and never dissolved into the queued wave-advance
// boundary; it awaited a turn-2 resolution that a WON wave never sends. The guest thus never reached its
// wave-2 reward SelectModifierPhase (it is the reward OWNER there), the host WATCHER network-waited on the
// guest's pick, and BOTH engines mutual-waited -> the STALL WATCHDOG fired repeatedly on each seat and the
// campaign harness timed out on the phantom wave-2-turn-3 command. The duo harness cannot reproduce this: it
// CONSUMES the wave-advance on the guest (nulling pendingWaveAdvance), the exact fidelity gap documented in
// coop-duo-won-wave-replacement.test.ts. This engine-free fixture pins pendingWaveAdvance.settledTurn through
// the REAL wired receive path, so the fence is asserted directly with no browser dispatch.
describe("dirty-lane won-by-faint: deferred WIN settlement supersedes the source-turn replay", () => {
  let prevGlobalScene: BattleScene;

  afterEach(() => {
    clearCoopRuntime();
    guestPeer?.close();
    guestPeer = null;
    initGlobalScene(prevGlobalScene);
  });

  it("a deferred WON settlement supersedes the stranded source-turn replay ONLY once the settled cursor is adopted", async () => {
    prevGlobalScene = globalScene;
    // Model the guest AFTER the replacement adopted the settled cursor: currentBattle.turn = 3 (= settledTurn),
    // while the parked replay is still CoopReplayTurnPhase turn=2 = settledTurn-1 (the faint's own winning turn).
    rec.turn = 3;
    initGlobalScene(makeStubScene());
    // settledTurn = 3 models the deferred automatic-victory boundary (faint on the winning turn 2 bumped the
    // host cursor to 3 before the seal).
    await startGuestWithPendingWin(3);
    expect(coopHasPendingWaveAdvance(), "a WON advance is pending for the wave").toBe(true);

    // The stranded SOURCE-turn replay (2), now behind the adopted cursor, must be recognized as superseded so
    // it ends into the queued wave-advance boundary instead of awaiting a turn-2 resolution a won wave never sends.
    expect(
      coopRetainedWinSupersedesReplay(WAVE, 2),
      "the source-turn (settledTurn-1) replay is superseded once the settled cursor is adopted",
    ).toBe(true);
    // The settled turn itself and any speculative phantom beyond it remain superseded (unchanged behavior).
    expect(coopRetainedWinSupersedesReplay(WAVE, 3), "the settled turn is superseded").toBe(true);
    expect(coopRetainedWinSupersedesReplay(WAVE, 4), "a phantom turn beyond the settled turn is superseded").toBe(true);
    // Never supersede a genuinely earlier, still-unresolved turn (two below the settled turn) or another wave.
    expect(
      coopRetainedWinSupersedesReplay(WAVE, 1),
      "a turn two below the settled turn is NOT dissolved (only the exact source turn)",
    ).toBe(false);
    expect(coopRetainedWinSupersedesReplay(WAVE + 1, 2), "a different wave's replay is never dissolved").toBe(false);
  });

  it("a NORMAL single-turn win (cursor still AT the winning turn) does NOT dissolve the winning-turn replay early", async () => {
    prevGlobalScene = globalScene;
    // No faint deferral: the guest cursor is still at the winning turn. The host invariant still settles on
    // winningTurn + 1 (= 3), but the winning-turn replay (2) must FINALIZE (mirror EXP), never dissolve early.
    rec.turn = 2;
    initGlobalScene(makeStubScene());
    await startGuestWithPendingWin(3);
    expect(coopHasPendingWaveAdvance(), "a WON advance is pending for the wave").toBe(true);
    expect(
      coopRetainedWinSupersedesReplay(WAVE, 2),
      "the winning-turn replay is NOT superseded while its cursor has not adopted the settled turn",
    ).toBe(false);
  });
});
