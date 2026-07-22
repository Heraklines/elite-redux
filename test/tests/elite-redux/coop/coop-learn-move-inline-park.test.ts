/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op V2 learn-move-forward DEPTH-LANE circular deadlock (run 29933294323 depth-30w traces).
//
// THE DEADLOCK: after a wave-1 reward the HOST holds a wave-1 LearnMovePhase for a GUEST-owned mon and
// awaits the guest's relayed forget-pick. The guest renderer has ALREADY advanced to the wave-2
// NextEncounterPhase, PARKED inside `adoptCoopHostEnemyParty` -> `awaitEnemyParty` (a cross-wave enemy
// material wait). Under V2 (operationId != null) `wireCoopLearnMoveForward` forced the QUEUE-OWNED
// CoopReplayLearnMovePhase via `unshiftNew` - which never STARTS, stranded behind the parked
// NextEncounterPhase the host cannot end while awaiting this very pick. The guest never proves the
// learn-move surface, never relays the pick, the host never builds wave-2 enemies, and the guest's
// awaitEnemyParty for wave 2 eventually nulls -> fail-closed terminal.
//
// THE FIX: when the guest is PARKED awaiting cross-wave enemy material (detected via the streamer's
// live `hasPendingEnemyPartyWait()`, NOT a timer), route the V2 learn-move through the #787 INLINE
// opener THREADING the operationId - which installs the CoopReplayLearnMovePhase via `overridePhase`
// (it becomes the current phase OVER the parked renderer standby, carrying the exact operationId so it
// still proves controlInstalled). That is the same queue-owned identity + parked-queue immunity the
// batch path (#848) already has. When the queue is DRAINABLE (non-parked) the normal queue-owned
// `unshiftNew` path is preserved, and the exactly-once operation identity is threaded unchanged.
//
// This is an engine-free fixture (stub scene + REAL loopback runtime, like
// coop-single-turn-win-finalize.test.ts): it pins the DISPATCH decision + operation-identity threading
// directly. The stub phaseManager records `overridePhase` vs `unshiftNew` and does NOT start the phase,
// so no UI is driven. Pre-fix the parked V2 case takes `unshiftNew` (the queue-owned phase that never
// starts); post-fix it takes `overridePhase` with the SAME operationId.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import {
  assembleCoopRuntime,
  type CoopRuntime,
  clearCoopRuntime,
  getCoopController,
  getCoopInteractionRelay,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { type CoopTransport, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
// Import for its module-load side effect: registers the real #787 inline opener via
// setCoopLearnMovePickerOpener so wireCoopLearnMoveForward's inline branch is live.
import "#phases/coop-replay-learn-move-phase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/** A far-future wave the guest renderer has speculatively parked on (awaiting the host's enemy party). */
const PARKED_WAVE = 2;

// --- Recorder behind the injected stub scene: which phaseManager lever the dispatch pulls.
const rec = {
  unshifted: [] as { name: string; args: unknown[] }[],
  overridden: [] as Phase[],
};

function makeStubScene(): BattleScene {
  const currentPhaseStub = { phaseName: "NextEncounterPhase" } as unknown as Phase;
  return {
    currentBattle: { waveIndex: PARKED_WAVE, turn: 1 },
    getPlayerParty() {
      return [];
    },
    phaseManager: {
      getCurrentPhase() {
        return currentPhaseStub;
      },
      unshiftNew(name: string, ...args: unknown[]) {
        rec.unshifted.push({ name, args });
      },
      // Record the override but DO NOT start the phase: the fix's structural decision (queue-owned
      // identity + parked-queue immunity) is fully observable from the phase handed here.
      overridePhase(phase: Phase): boolean {
        rec.overridden.push(phase);
        return true;
      },
    },
    ui: {
      getMode() {
        return 0;
      },
      setMode() {
        return Promise.resolve();
      },
      setModeWithoutClear() {
        return Promise.resolve();
      },
      revertMode() {
        return Promise.resolve(true);
      },
    },
  } as unknown as BattleScene;
}

/** Assemble a genuinely guest-owned authoritative runtime on the pair's guest endpoint. */
function startGuestRuntime(): { runtime: CoopRuntime; peer: CoopTransport } {
  clearCoopRuntime();
  const { host, guest } = createLoopbackPair();
  const runtime = assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" });
  setCoopRuntime(runtime);
  runtime.controller.connect();
  return { runtime, peer: host };
}

/** The learn-move-forward outcome the host streams for a guest-owned mon (full moveset -> pick prompt). */
function forward(partySlot = 1) {
  return { k: "learnMoveForward" as const, partySlot, moveId: 33, maxMoveCount: 4, ownerIsGuest: true };
}

describe("co-op V2 learn-move forward: parked-queue immunity via inline override (depth-lane deadlock)", () => {
  let prevGlobalScene: BattleScene;
  let guestPeer: CoopTransport | null = null;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    rec.unshifted = [];
    rec.overridden = [];
    initGlobalScene(makeStubScene());
  });

  afterEach(() => {
    clearCoopRuntime();
    guestPeer?.close();
    guestPeer = null;
    initGlobalScene(prevGlobalScene);
  });

  it("sanity: an authoritative guest is standing + the renderer is parked awaiting the wave-2 enemy party", () => {
    const { runtime, peer } = startGuestRuntime();
    guestPeer = peer;
    expect(getCoopController()?.role).toBe("guest");
    // Register a real cross-wave enemy-party waiter (the park): the streamer now reports a pending wait.
    void runtime.battleStream.awaitEnemyParty(PARKED_WAVE, 10_000_000);
    expect(runtime.battleStream.hasPendingEnemyPartyWait()).toBe(true);
  });

  it("PARKED + V2: the forward opens INLINE via overridePhase threading the SAME operationId (never strands)", () => {
    const { runtime, peer } = startGuestRuntime();
    guestPeer = peer;
    // Park the guest renderer at the wave-2 encounter boundary (cross-wave enemy material pending).
    void runtime.battleStream.awaitEnemyParty(PARKED_WAVE, 10_000_000);
    expect(runtime.battleStream.hasPendingEnemyPartyWait()).toBe(true);

    const operationId = "op:learnMove#depth-lane-1";
    const relay = getCoopInteractionRelay();
    expect(relay?.onLearnMoveForward, "the forward listener is wired on the live relay").toBeTypeOf("function");
    relay!.onLearnMoveForward!(forward(1), operationId);

    // THE FIX: the picker is opened INLINE (overridePhase) OVER the parked renderer, NOT queued behind it.
    expect(rec.overridden.length, "the V2 picker opens inline via overridePhase (parked-queue immunity)").toBe(1);
    const phase = rec.overridden[0];
    expect(phase.phaseName, "the inline surface is a real CoopReplayLearnMovePhase (proves the V2 contract)").toBe(
      "CoopReplayLearnMovePhase",
    );
    // Operation identity is THREADED THROUGH, never minted anew - the inline surface proves the SAME address.
    expect(
      (phase as unknown as { coopV2ControlOperationId: string | null }).coopV2ControlOperationId,
      "the inline picker carries the exact host operationId (exactly-once identity preserved)",
    ).toBe(operationId);
    // It must NOT also queue the stranding queue-owned phase.
    expect(
      rec.unshifted.filter(u => u.name === "CoopReplayLearnMovePhase").length,
      "no stranding queue-owned CoopReplayLearnMovePhase is unshifted behind the parked renderer",
    ).toBe(0);
  });

  it("NOT parked + V2: the normal DRAINABLE queue-owned path is preserved (unshiftNew, no override)", () => {
    const { peer } = startGuestRuntime();
    guestPeer = peer;
    // No enemy-party waiter registered -> the queue is drainable; the queue-owned phase runs normally.
    const operationId = "op:learnMove#drainable-1";
    const relay = getCoopInteractionRelay();
    relay!.onLearnMoveForward!(forward(1), operationId);

    expect(rec.overridden.length, "a drainable queue does NOT use the inline override path").toBe(0);
    const queued = rec.unshifted.filter(u => u.name === "CoopReplayLearnMovePhase");
    expect(queued.length, "the normal queue-owned CoopReplayLearnMovePhase is unshifted").toBe(1);
    // The queue-owned path also threads the exact operationId (unchanged exactly-once identity).
    expect(queued[0].args, "the queued phase carries the exact operationId").toContain(operationId);
  });
});
