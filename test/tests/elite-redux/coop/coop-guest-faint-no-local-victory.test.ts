/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// BUG1 - faint auto-switch premature-victory DEADLOCK regression (#633, authoritative co-op).
//
// In authoritative co-op doubles, when the guest's mon faints the same turn ONE enemy survives at
// hp=1 on the host, the guest's end-of-turn path used to run its OWN damaging turn-end engine
// (queueTurnEndPhases -> WeatherEffect / TurnEnd chip damage). That LOCALLY chipped the host-
// surviving hp=1 enemy to 0 -> a local FaintPhase -> a premature VictoryPhase / BattleEnd the host
// never resolved, parking the guest as a reward watcher while the host awaited the guest's turn N+1
// move (DEADLOCK). The guest is a PURE RENDERER: the per-turn checkpoint applied at the top of
// CoopFinalizeTurnPhase.start() already carries the host's authoritative post-turn-end state, so the
// damaging engine is both redundant and the bug. The fix advances the turn MINIMALLY on the
// authoritative guest (incrementTurn + clearLastTurnOrder - exactly the structural bump TurnEndPhase
// does) and NEVER runs queueTurnEndPhases; victory arrives ONLY via the host's waveResolved tail.
// Solo / host / lockstep keep queueTurnEndPhases verbatim (byte-identical).
//
// The authoritative path is CoopFinalizeTurnPhase.finishTurn(). Protocol 33 deliberately has no
// no-stream gameplay fallback: missing authority routes both peers to the visible terminal instead.
//
// This drives the REAL private methods over a REAL local co-op session (the same engine-free spoof
// path the rest of the co-op suite uses): startLocalCoopSession in "authoritative" netcode, then flip
// the local controller to the GUEST role so isCoopAuthoritativeGuest() reads true natively (no module
// mock - the phase module's own binding is exercised). The scene is a minimal stub injected via the
// REAL initGlobalScene (a live `let` binding every importer - test AND phase module - reads), so no
// Phaser / GameManager boot is needed. The non-guest (host) cases drop the role flip so the gate reads
// false and the original turn-end path is asserted byte-for-byte.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, getCoopController, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type { CoopBattleCheckpoint } from "#data/elite-redux/coop/coop-transport";
import { CoopFinalizeTurnPhase } from "#phases/coop-replay-phases";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// --- The recorder behind the injected stub scene: the two end-of-turn levers the fix toggles.
const rec = {
  incrementTurnCalls: 0,
  queueTurnEndCalls: 0,
  clearLastTurnOrderCalls: 0,
  pushedPhases: [] as string[],
  turn: 1,
};

/** Minimal BattleScene-shaped stub exposing only the members finishTurn touches. */
function makeStubScene(): BattleScene {
  return {
    currentBattle: {
      waveIndex: 5,
      get turn() {
        return rec.turn;
      },
      incrementTurn() {
        rec.incrementTurnCalls++;
        rec.turn++;
      },
    },
    phaseManager: {
      // Phase.end() shifts to the next phase; a no-op here keeps the private methods from throwing.
      shiftPhase() {},
      queueTurnEndPhases() {
        rec.queueTurnEndCalls++;
        // The real queueTurnEndPhases pushes WeatherEffect / TurnEnd / Faint / Victory phases; model
        // that it MAY push a victory tail so the "no FaintPhase/VictoryPhase pushed by finishTurn"
        // assertion is meaningful (the minimal-advance branch must push NOTHING).
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
 * Start a REAL authoritative co-op session and flip the local controller to the GUEST role, so the
 * production isCoopAuthoritativeGuest() reads true (active session + authoritative netcode + role
 * guest). Mirrors the coop-guest-renderer harness's startCoopGuest, minus the GameManager.
 */
function startAuthoritativeGuestSession(): void {
  startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
  const controller = getCoopController();
  if (controller == null) {
    throw new Error("expected a live co-op controller after startLocalCoopSession");
  }
  controller.role = "guest";
}

/** Invoke a phase's private method by name without `as any` (cast through `unknown` to a callable). */
function callPrivate(instance: object, method: string): void {
  const fn = (instance as unknown as Record<string, () => void>)[method];
  fn.call(instance);
}

/**
 * Neutralize Phase.end() (which calls globalScene.phaseManager.shiftPhase to advance the real queue).
 * The methods under test call this.end() last; we only assert the turn-end DECISION they make before
 * it, not the queue shift, so stub it to a no-op on the instance.
 */
function stubEnd(instance: object): void {
  (instance as unknown as Record<string, () => void>).end = () => {};
}

function makeFinalizePhase(turn: number): CoopFinalizeTurnPhase {
  // The checkpoint / checksum are irrelevant to finishTurn (start() consumes them); pass benign stubs.
  const checkpoint = {} as unknown as CoopBattleCheckpoint;
  const phase = new CoopFinalizeTurnPhase(turn, checkpoint, "checksum");
  stubEnd(phase);
  return phase;
}

describe("BUG1 - guest faint must NOT trigger a local victory (premature-victory deadlock)", () => {
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
    // Tear down any session so the next test (and the rest of the suite) starts solo / off-session.
    clearCoopRuntime();
    // Citizenship (#710): this engine-free file replaces globalScene with a reset-less stub. Restore
    // the prior scene so the NEXT ER_SCENARIO file's `new GameManager` reuses a real scene instead of
    // crashing on `stub.reset is not a function`. Order-robust: each stub file restores before the
    // next file's beforeEach captures, so even back-to-back stub files chain the real scene through.
    initGlobalScene(prevGlobalScene);
  });

  it("the authoritative-guest gate reads true on the session and the stub scene reaches the phase module (sanity)", () => {
    startAuthoritativeGuestSession();
    expect(getCoopController()?.role).toBe("guest");
    expect(globalScene.currentBattle.waveIndex).toBe(5);
  });

  it("CoopFinalizeTurnPhase.finishTurn(): authoritative guest advances the turn MINIMALLY, never runs the damaging turn-end engine", () => {
    startAuthoritativeGuestSession();

    const phase = makeFinalizePhase(1);
    callPrivate(phase, "finishTurn");

    // The damaging turn-end engine MUST NOT run (it is what chipped the host-surviving hp=1 enemy).
    expect(rec.queueTurnEndCalls).toBe(0);
    // The turn is advanced minimally instead: exactly the single bump TurnEndPhase would have done.
    expect(rec.incrementTurnCalls).toBe(1);
    expect(rec.turn).toBe(2);
    expect(rec.clearLastTurnOrderCalls).toBe(1);
    // No local FaintPhase / VictoryPhase is ever pushed by finishTurn on the guest.
    expect(rec.pushedPhases).not.toContain("FaintPhase");
    expect(rec.pushedPhases).not.toContain("VictoryPhase");
    expect(rec.pushedPhases).toHaveLength(0);
  });

  it("CoopFinalizeTurnPhase.finishTurn(): solo / host / lockstep keeps queueTurnEndPhases (byte-identical)", () => {
    // No session -> isCoopAuthoritativeGuest() reads false -> the original turn-end path.
    const phase = makeFinalizePhase(1);
    callPrivate(phase, "finishTurn");

    expect(rec.queueTurnEndCalls).toBe(1);
    expect(rec.incrementTurnCalls).toBe(0);
    expect(rec.clearLastTurnOrderCalls).toBe(0);
    expect(rec.turn).toBe(1);
  });
});
