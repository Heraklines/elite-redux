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
import type { Phase } from "#app/phase";
import { PhaseManager } from "#app/phase-manager";
import { clearCoopRuntime, getCoopController, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import {
  clearCoopMachineWaits,
  coopMachineWaitLabels,
  oldestCoopAsymmetricMachineWaitMs,
  oldestCoopMachineWaitMs,
  setCoopStallProbeClock,
} from "#data/elite-redux/coop/coop-stall-probe";
import type { CoopBattleCheckpoint } from "#data/elite-redux/coop/coop-transport";
import { CoopInertPhase } from "#phases/coop-inert-phase";
import { CoopFinalizeTurnPhase, type CoopV2ControlSuccessorClaim } from "#phases/coop-replay-phases";
import { CoopReplayTurnPhase } from "#phases/coop-replay-turn-phase";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// --- The recorder behind the injected stub scene: the two end-of-turn levers the fix toggles.
const rec = {
  incrementTurnCalls: 0,
  queueTurnEndCalls: 0,
  clearLastTurnOrderCalls: 0,
  shiftPhaseCalls: 0,
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
      shiftPhase() {
        rec.shiftPhaseCalls++;
      },
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

/** Model the retained N commit being materially superseded by an out-of-band N+1 replacement image. */
function markSupersededByNextTurnReplacement(phase: CoopFinalizeTurnPhase, turn: number): void {
  (phase as unknown as Record<string, unknown>).turnCommitSupersededBy = {
    reason: "replacement",
    turn: turn + 1,
  };
}

describe("BUG1 - guest faint must NOT trigger a local victory (premature-victory deadlock)", () => {
  let prevGlobalScene: BattleScene;
  let stallProbeNow = 0;

  beforeEach(() => {
    prevGlobalScene = globalScene;
    rec.incrementTurnCalls = 0;
    rec.queueTurnEndCalls = 0;
    rec.clearLastTurnOrderCalls = 0;
    rec.shiftPhaseCalls = 0;
    rec.pushedPhases = [];
    rec.turn = 1;
    stallProbeNow = 0;
    setCoopStallProbeClock(() => stallProbeNow);
    initGlobalScene(makeStubScene());
  });

  afterEach(() => {
    clearCoopMachineWaits();
    setCoopStallProbeClock(null);
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

  it("advances the LIVE cursor when an N+1 replacement superseded material but did not advance currentBattle.turn", () => {
    startAuthoritativeGuestSession();

    const phase = makeFinalizePhase(1);
    markSupersededByNextTurnReplacement(phase, 1);
    // This is the public-browser dirty-account failure: replacement state tick N+1 converged while the
    // mutable Battle cursor remained N. Envelope metadata must not masquerade as a cursor mutation.
    expect(rec.turn).toBe(1);
    callPrivate(phase, "finishTurn");

    expect(rec.incrementTurnCalls).toBe(1);
    expect(rec.turn).toBe(2);
    expect(rec.clearLastTurnOrderCalls).toBe(1);
    expect(rec.queueTurnEndCalls).toBe(0);
  });

  it("does not double-increment when the LIVE cursor already reached the replacement's N+1 boundary", () => {
    startAuthoritativeGuestSession();
    rec.turn = 2;

    const phase = makeFinalizePhase(1);
    markSupersededByNextTurnReplacement(phase, 1);
    callPrivate(phase, "finishTurn");

    expect(rec.incrementTurnCalls).toBe(0);
    expect(rec.turn).toBe(2);
    expect(rec.clearLastTurnOrderCalls).toBe(1);
    expect(rec.queueTurnEndCalls).toBe(0);
  });

  it("destructive Authority V2 projection retires a parked turn's machine wait without deriving progression", () => {
    startAuthoritativeGuestSession();
    const wait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "TURN/e1/w5/t1",
      epoch: 1,
      wave: 5,
      turn: 1,
      allowedKinds: ["INTERACTION_COMMIT" as const],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
    const phase = new CoopFinalizeTurnPhase(
      1,
      {} as CoopBattleCheckpoint,
      "checksum",
      undefined,
      undefined,
      undefined,
      1,
      5,
      16,
      wait,
      7,
    );
    callPrivate(phase, "finishTurn");
    expect(coopMachineWaitLabels()).toEqual([expect.stringContaining("authority-v2-successor:w5:t1:r16")]);
    expect(oldestCoopMachineWaitMs(), "the successor barrier still proves a mutual stall").toBeGreaterThanOrEqual(0);
    expect(
      oldestCoopAsymmetricMachineWaitMs(),
      "an authority still rendering the route to its successor starts inside a bounded grace",
    ).toBe(-1);
    stallProbeNow = 119_999;
    expect(oldestCoopAsymmetricMachineWaitMs(), "slow presentation remains safe through the grace").toBe(-1);
    stallProbeNow = 120_000;
    expect(
      oldestCoopAsymmetricMachineWaitMs(),
      "a genuinely missing successor eventually becomes one-sided recovery evidence",
    ).toBe(120_000);

    // Reward/market/Mystery opens replace the finalizer without calling end(): end() would let the old turn
    // derive another local phase. The scheduler must nevertheless retire its wait before starting the exact
    // committed successor, or the stall watchdog will cancel that healthy interaction about 20 seconds later.
    const phaseManager = new PhaseManager();
    (phaseManager as unknown as { currentPhase: Phase }).currentPhase = phase;
    const successor = new CoopInertPhase("MovePhase");
    expect(phaseManager.replaceWithCoopAuthoritativePhase(phase, successor)).toBe(true);
    expect(phaseManager.getCurrentPhase()).toBe(successor);
    expect(coopMachineWaitLabels()).toEqual([]);

    // Retirement is idempotent: late detached completion cannot resurrect or re-clean the discarded turn.
    phase.retire();
    expect(coopMachineWaitLabels()).toEqual([]);
    const shiftsAfterSuccessorStart = rec.shiftPhaseCalls;
    phase.end();
    expect(rec.shiftPhaseCalls).toBe(shiftsAfterSuccessorStart);

    const ordinaryDiscard = new CoopInertPhase("MovePhase");
    ordinaryDiscard.retire();
    ordinaryDiscard.end();
    expect(rec.shiftPhaseCalls).toBe(shiftsAfterSuccessorStart);
  });

  it("keeps a remote-owned replacement bridge parked until its consecutive immutable result arrives", () => {
    startAuthoritativeGuestSession();
    const controller = getCoopController();
    expect(controller).not.toBeNull();
    const ownerSeatId = controller?.localSeatId === 0 ? 1 : 0;
    const wait = {
      kind: "AWAIT_SUCCESSOR" as const,
      afterOperationId: "TURN/e1/w5/t1",
      epoch: 1,
      wave: 5,
      turn: 1,
      allowedKinds: ["CONTROL_COMMIT" as const],
      allowNextWaveStart: false,
      expectedOperationId: null,
    };
    const phase = new CoopFinalizeTurnPhase(
      1,
      {} as CoopBattleCheckpoint,
      "checksum",
      undefined,
      undefined,
      undefined,
      1,
      5,
      16,
      wait,
      7,
    );
    callPrivate(phase, "finishTurn");
    const replacementOperationId = "RC/e1/w5/t2/o0/f0/s0";
    const replacementOpen: CoopV2ControlSuccessorClaim = {
      sessionEpoch: 1,
      revision: 8,
      kind: "CONTROL_COMMIT",
      operationId: "CONTROL/e1/w5/t2/replacement",
      nextControl: {
        kind: "REPLACEMENT",
        operationId: replacementOperationId,
        ownerSeatId,
        epoch: 1,
        wave: 5,
        turn: 2,
        occurrence: 0,
        fieldIndex: 0,
        remaining: [],
      },
    };
    expect(phase.releaseForCoopV2Control(replacementOpen)).toBe(true);
    expect(rec.shiftPhaseCalls, "the remote picker is not a renderer wake").toBe(0);
    expect(
      phase.releaseForCoopV2Control({
        ...replacementOpen,
        operationId: "CONTROL/e1/w5/t2/other-replacement",
        nextControl: {
          kind: "REPLACEMENT",
          operationId: "RC/e1/w5/t2/o1/f0/s0",
          ownerSeatId,
          epoch: 1,
          wave: 5,
          turn: 2,
          occurrence: 1,
          fieldIndex: 0,
          remaining: [],
        },
      }),
      "a different replacement cannot overwrite the retained global revision",
    ).toBe(false);

    const replacementResult: CoopV2ControlSuccessorClaim = {
      sessionEpoch: 1,
      revision: 9,
      kind: "REPLACEMENT_COMMIT",
      operationId: replacementOperationId,
      nextControl: {
        kind: "AWAIT_SUCCESSOR",
        afterOperationId: replacementOperationId,
        epoch: 1,
        wave: 5,
        turn: 2,
        allowedKinds: ["WAVE_ADVANCE"],
        allowNextWaveStart: false,
        expectedOperationId: null,
      },
    };
    expect(
      phase.releaseForCoopV2Control({ ...replacementResult, revision: 10 }),
      "a gapped replacement result cannot release the turn",
    ).toBe(false);
    expect(
      phase.releaseForCoopV2Control({ ...replacementResult, operationId: "RC/e1/w5/t2/o0/f1/s0" }),
      "a result for another field operation cannot release the turn",
    ).toBe(false);
    expect(phase.releaseForCoopV2Control(replacementResult)).toBe(true);
    expect(rec.shiftPhaseCalls, "the exact immutable answer releases the parked turn once").toBe(1);
  });

  it("does not mistake a TURN_COMMIT's remote replacement control for its immutable result", () => {
    startAuthoritativeGuestSession();
    const controller = getCoopController();
    expect(controller).not.toBeNull();
    const ownerSeatId = controller?.localSeatId === 0 ? 1 : 0;
    const replacementOperationId = "RC/e1/w5/t1/o0/f0/s0";
    const replacementControl = {
      kind: "REPLACEMENT" as const,
      operationId: replacementOperationId,
      ownerSeatId,
      epoch: 1,
      wave: 5,
      turn: 1,
      occurrence: 0,
      fieldIndex: 0,
      remaining: [],
    };
    const phase = new CoopFinalizeTurnPhase(
      1,
      {} as CoopBattleCheckpoint,
      "checksum",
      undefined,
      undefined,
      undefined,
      1,
      5,
      16,
      replacementControl,
      8,
    );
    callPrivate(phase, "finishTurn");
    expect(coopMachineWaitLabels()).toEqual([expect.stringContaining("authority-v2-successor:w5:t1:r16")]);

    const sourceTurn: CoopV2ControlSuccessorClaim = {
      sessionEpoch: 1,
      revision: 8,
      kind: "TURN_COMMIT",
      operationId: "TURN/e1/w5/t1",
      nextControl: replacementControl,
    };
    expect(phase.releaseForCoopV2Control(sourceTurn)).toBe(true);
    expect(rec.shiftPhaseCalls, "the renderer has no local picker and must remain parked").toBe(0);
    expect(coopMachineWaitLabels()).toEqual([expect.stringContaining("authority-v2-successor:w5:t1:r16")]);

    const replacementResult: CoopV2ControlSuccessorClaim = {
      sessionEpoch: 1,
      revision: 9,
      kind: "REPLACEMENT_COMMIT",
      operationId: replacementOperationId,
      nextControl: {
        kind: "COMMAND_FRONTIER",
        epoch: 1,
        wave: 5,
        turn: 2,
        commands: [{ ownerSeatId: 0, fieldIndex: 0, pokemonId: 100 }],
      },
    };
    expect(phase.releaseForCoopV2Control(replacementResult)).toBe(true);
    expect(rec.shiftPhaseCalls, "only the consecutive immutable replacement answer releases the turn").toBe(1);
    expect(rec.turn).toBe(2);
    expect(coopMachineWaitLabels()).toEqual([]);
  });

  it("destructive Authority V2 projection retires a replay pump without letting its late completion shift the successor", async () => {
    startAuthoritativeGuestSession();
    const phaseManager = new PhaseManager();
    const replay = new CoopReplayTurnPhase(1).bindOwnerPhaseManager(phaseManager);
    const cleanup = {
      authority: 0,
      retrySubscription: 0,
      retryTimer: 0,
      entryWait: 0,
    };
    Object.assign(replay as unknown as Record<string, unknown>, {
      authorityFailureUnsubscribe: () => cleanup.authority++,
      replacementRetryUnsubscribe: () => cleanup.retrySubscription++,
      replacementRetryCancelTimer: () => cleanup.retryTimer++,
      v2EntryPresentationResolver: (prefix: unknown) => {
        expect(prefix).toBeNull();
        cleanup.entryWait++;
      },
    });
    (phaseManager as unknown as { currentPhase: Phase }).currentPhase = replay;
    const successor = new CoopInertPhase("MovePhase");

    expect(phaseManager.replaceWithCoopAuthoritativePhase(replay, successor)).toBe(true);
    expect(phaseManager.getCurrentPhase()).toBe(successor);
    expect(cleanup).toEqual({ authority: 1, retrySubscription: 1, retryTimer: 1, entryWait: 1 });

    // Model either detached pump continuation after its await resolves. Both calls must be inert, and
    // retirement must remain idempotent rather than invoking cleanup callbacks a second time.
    await Promise.resolve();
    replay.end();
    replay.retire();
    expect(phaseManager.getCurrentPhase()).toBe(successor);
    expect(cleanup).toEqual({ authority: 1, retrySubscription: 1, retryTimer: 1, entryWait: 1 });
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
