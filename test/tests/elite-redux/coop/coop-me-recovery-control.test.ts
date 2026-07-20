/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Production CoopReplayMePhase recovery boundary: timeout/cancellation is not a terminal; a delayed exact
// carrier or checksum-verified active-control snapshot is. Uses the real phase/runtime over loopback with a
// minimal scene UI so it runs in the external co-op gate without booting a second Phaser engine.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import {
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
} from "#data/elite-redux/coop/coop-me-operation";
import { setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import { makeCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { CoopOperationHost } from "#data/elite-redux/coop/coop-operation-runtime";
import {
  assembleCoopRuntime,
  clearCoopRuntime,
  getCoopRuntime,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_ME_PUMP_SEQ_BASE, COOP_ME_TERM_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopInteractionOutcome } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { UiMode } from "#enums/ui-mode";
import { CoopReplayMePhase, setActiveCoopReplayMePhaseForHarness } from "#phases/coop-replay-me-phase";
import { PostMysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function terminalOp(counter: number, step: number): string {
  return makeCoopOperationId(1, 0, (COOP_ME_TERM_SEQ_BASE + counter) * 8000 + 4000 + step, "ME_TERMINAL");
}

interface ReplayRecoverySeam {
  settled: boolean;
  acceptedTerminal:
    | { kind: "pending" }
    | { kind: "battle-handoff" | "leave"; operationId: string; step: number; revision: number };
  handleTerminalAction(action: { choice: number } | null): void;
  handleDetachedBattleTerminal(action: { choice: number } | null, retry: () => void): void;
  leaveDefensive(): boolean;
  completeDetachedBattleEnd(): boolean;
  finishWithoutLeaving(hostTurn?: number): void;
  disposeRecoveryTimer(): void;
}

describe("CoopReplayMePhase fail-closed terminal recovery", () => {
  let previousScene: BattleScene;
  let setMode: ReturnType<typeof vi.fn>;
  let setModeBoundedWhen: ReturnType<typeof vi.fn>;
  let clearPhaseQueue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    previousScene = globalScene;
    setCoopMeOperationEnabled(false); // isolate the raw fallback boundary; journal recovery has its own suite
    resetCoopMeOperationState();
    const { guest } = createLoopbackPair();
    setCoopRuntime(assembleCoopRuntime(guest, { username: "Guest", netcodeMode: "authoritative" }));
    setMode = vi.fn(() => Promise.resolve());
    setModeBoundedWhen = vi.fn(() => Promise.resolve("completed"));
    clearPhaseQueue = vi.fn();
    initGlobalScene({
      gameMode: { isCoop: true, isEndless: false, isWaveFinal: vi.fn(() => false) },
      currentBattle: {
        waveIndex: 7,
        mysteryEncounter: { dialogueTokens: {} },
      },
      phaseManager: {
        clearPhaseQueue,
        pushNew: vi.fn(),
        unshiftNew: vi.fn(),
        getCurrentPhase: vi.fn(() => undefined),
      },
      getPlayerParty: vi.fn(() => []),
      reset: vi.fn(),
      ui: {
        setMode,
        setModeBoundedWhen,
        showText: vi.fn(),
      },
    } as unknown as BattleScene);
  });

  afterEach(() => {
    clearCoopRuntime();
    setActiveCoopReplayMePhaseForHarness(null);
    setCoopMeInteractionStart(-1);
    resetCoopMeOperationFlag();
    resetCoopMeOperationState();
    initGlobalScene(previousScene);
  });

  it("a null terminal holds the event; the later exact 9M leave exits once", () => {
    const counter = 9;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    const leave = vi.fn(() => true);
    seam.leaveDefensive = leave;

    seam.handleTerminalAction(null);
    expect(leave, "timeout/cancel never becomes a local host-leave inference").not.toHaveBeenCalled();
    expect(seam.settled).toBe(false);

    seam.handleTerminalAction({ choice: -1 });
    expect(leave, "the delayed exact terminal is accepted").toHaveBeenCalledTimes(1);
    seam.disposeRecoveryTimer();
  });

  it("drops a valid terminal callback after the runtime/controller generation was replaced", () => {
    const counter = 10;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    const leave = vi.fn(() => true);
    seam.leaveDefensive = leave;

    const { guest } = createLoopbackPair();
    setCoopRuntime(assembleCoopRuntime(guest, { username: "Replacement", netcodeMode: "authoritative" }));
    seam.handleTerminalAction({ choice: -1 });

    expect(leave).not.toHaveBeenCalled();
  });

  it("post-battle ME completion also rejects null and foreign terminals before the exact leave", () => {
    const counter = 11;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    const complete = vi.fn(() => true);
    const retry = vi.fn();
    seam.completeDetachedBattleEnd = complete;
    seam.acceptedTerminal = { kind: "battle-handoff", operationId: "legacy-battle", step: 0, revision: 1 };

    seam.handleDetachedBattleTerminal(null, retry);
    seam.handleDetachedBattleTerminal({ choice: -1000 }, retry);
    expect(complete, "null/battle sentinel cannot masquerade as the true post-battle leave").not.toHaveBeenCalled();

    seam.handleDetachedBattleTerminal({ choice: -1 }, retry);
    expect(complete).toHaveBeenCalledTimes(1);
    seam.disposeRecoveryTimer();
  });

  it("a verified hot-rejoin snapshot restores the exact active selector without advancing", () => {
    const counter = 13;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    const leave = vi.fn(() => true);
    seam.leaveDefensive = leave;

    phase.rebindFromActiveMysterySnapshot({
      version: 1,
      interactionCounter: counter,
      revision: 2,
      round: 1,
      terminal: "pending",
      presentation: {
        k: "mePresent",
        tokens: { itemName: "Host Relic" },
        meetsReqs: [true, false],
        labels: ["Investigate", "Leave"],
      },
    });

    expect(setModeBoundedWhen).toHaveBeenCalledWith(UiMode.MYSTERY_ENCOUNTER, 2_000, expect.any(Function), undefined);
    expect(leave, "presentation rebound is not a terminal").not.toHaveBeenCalled();
    expect(seam.settled).toBe(false);
  });

  it("an ordinary verified leave is idempotent and is never reclassified as a detached battle leave", () => {
    const counter = 14;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    const leave = vi.fn(() => true);
    const detached = vi.fn(() => true);
    seam.leaveDefensive = leave;
    seam.completeDetachedBattleEnd = detached;
    const snapshot = {
      version: 1 as const,
      interactionCounter: counter,
      revision: 2,
      round: 1,
      terminal: "leave" as const,
      terminalOperationId: terminalOp(counter, 0),
      terminalStep: 0,
      terminalChoice: -1,
    };

    phase.rebindFromActiveMysterySnapshot(snapshot);
    phase.rebindFromActiveMysterySnapshot(snapshot);

    expect(leave).toHaveBeenCalledTimes(1);
    expect(detached).not.toHaveBeenCalled();
  });

  it("retries the same verified battle handoff after an injected first apply failure", () => {
    const counter = 16;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    const finish = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("injected handoff apply failure");
      })
      .mockImplementation(() => undefined);
    seam.finishWithoutLeaving = finish;
    const snapshot = {
      version: 1 as const,
      interactionCounter: counter,
      revision: 2,
      round: 1,
      terminal: "battle" as const,
      terminalOperationId: terminalOp(counter, 0),
      terminalStep: 0,
      terminalChoice: -1000,
      hostTurn: 4,
    };

    phase.rebindFromActiveMysterySnapshot(snapshot);
    expect(seam.acceptedTerminal.kind).toBe("pending");
    phase.rebindFromActiveMysterySnapshot(snapshot);

    expect(finish).toHaveBeenCalledTimes(2);
    expect(seam.acceptedTerminal.kind).toBe("battle-handoff");
  });

  it("a dropped TRUE post-handoff leave is recovered from the verified rejoin snapshot", () => {
    const counter = 15;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    seam.settled = true; // the initial, exact battle-handoff terminal already ended the replay phase
    seam.acceptedTerminal = { kind: "battle-handoff", operationId: "battle-op", step: 0, revision: 2 };
    const complete = vi.fn(() => true);
    seam.completeDetachedBattleEnd = complete;

    // The raw final 9M leave was dropped: its wait resolves null. That must not leave locally.
    seam.handleDetachedBattleTerminal(null, vi.fn());
    expect(complete).not.toHaveBeenCalled();

    phase.rebindFromActiveMysterySnapshot({
      version: 1,
      interactionCounter: counter,
      revision: 3,
      round: 1,
      terminal: "leave",
      terminalOperationId: terminalOp(counter, 0),
      terminalStep: 0,
      terminalChoice: -1,
    });
    expect(complete, "normal step-0 leave cannot complete a prior battle handoff").not.toHaveBeenCalled();

    // Hot rejoin returns the host's checksum-bound active control with the exact TRUE leave.
    phase.rebindFromActiveMysterySnapshot({
      version: 1,
      interactionCounter: counter,
      revision: 3,
      round: 1,
      terminal: "leave",
      terminalOperationId: terminalOp(counter, 1),
      terminalStep: 1,
      terminalChoice: -1,
    });
    expect(complete, "the verified snapshot, not null inference, completes the post-battle ME").toHaveBeenCalledTimes(
      1,
    );
    seam.disposeRecoveryTimer();
  });

  it("never accepts an ordinary leave when its real queue rebuild throws", () => {
    const counter = 17;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    clearPhaseQueue.mockImplementationOnce(() => {
      throw new Error("injected ordinary Mystery queue failure");
    });

    seam.handleTerminalAction({ choice: -1 });

    expect(seam.acceptedTerminal.kind, "failed queue mutation is not recorded as an accepted leave").toBe("pending");
    expect(
      getCoopRuntime(),
      "a partially-applied leave stops the shared session instead of continuing solo",
    ).toBeNull();
  });

  it("never accepts a post-battle leave when its real counter advance throws", () => {
    const counter = 18;
    setCoopMeInteractionStart(counter);
    const phase = new CoopReplayMePhase(counter);
    setActiveCoopReplayMePhaseForHarness(phase);
    const seam = phase as unknown as ReplayRecoverySeam;
    seam.acceptedTerminal = { kind: "battle-handoff", operationId: "legacy-battle", step: 0, revision: 1 };
    vi.spyOn(getCoopRuntime()!.controller, "advanceInteraction").mockImplementationOnce(() => {
      throw new Error("injected detached Mystery advance failure");
    });

    seam.handleDetachedBattleTerminal({ choice: -1 }, vi.fn());

    expect(seam.acceptedTerminal.kind, "failed detached mutation retains the accepted battle boundary").toBe(
      "battle-handoff",
    );
    expect(getCoopRuntime(), "a partial post-battle transition stops the shared session").toBeNull();
  });

  it("drops an exact terminal retry after the PostMysteryEncounterPhase was replaced", async () => {
    vi.useFakeTimers();
    try {
      clearCoopRuntime();
      const { host } = createLoopbackPair();
      const runtime = assembleCoopRuntime(host, { username: "Host", netcodeMode: "authoritative" });
      setCoopRuntime(runtime);
      setCoopMeOperationEnabled(true);
      const counter = 0;
      setCoopMeInteractionStart(counter);
      runtime.mePump.beginOwner(COOP_ME_PUMP_SEQ_BASE + counter, COOP_ME_TERM_SEQ_BASE + counter);

      let current: { phaseName: string } | undefined;
      const pushNew = vi.fn();
      initGlobalScene({
        gameMode: { isCoop: true, hasRandomBiomes: true },
        currentBattle: { waveIndex: 27, mysteryEncounter: { dialogue: {} } },
        phaseManager: {
          getCurrentPhase: vi.fn(() => current),
          pushNew,
        },
        isNewBiome: vi.fn(() => false),
        ui: { showText: vi.fn() },
      } as unknown as BattleScene);
      const phase = new PostMysteryEncounterPhase();
      current = phase;
      const terminalOutcome = {
        k: "meResync",
        base: null,
        party: [],
        meSaveData: "[]",
        seed: "seed",
        waveSeed: "wave-seed",
        dex: "dex",
        authoritativeState: {
          version: 1,
          tick: 1,
          wave: 27,
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
        },
      } as unknown as Extract<CoopInteractionOutcome, { k: "meResync" }>;
      const phaseSeam = phase as unknown as {
        terminalOutcomeLatch: {
          getOrCapture: () => Extract<CoopInteractionOutcome, { k: "meResync" }>;
        };
      };
      vi.spyOn(phaseSeam.terminalOutcomeLatch, "getOrCapture").mockReturnValue(terminalOutcome);

      const originalSubmit = CoopOperationHost.prototype.submit;
      let terminalSubmits = 0;
      vi.spyOn(CoopOperationHost.prototype, "submit").mockImplementation(function (
        this: CoopOperationHost,
        intent,
        ctx,
        validate,
      ) {
        if (intent.kind === "ME_TERMINAL") {
          terminalSubmits++;
          throw new Error("injected terminal commit failure");
        }
        return originalSubmit.call(this, intent, ctx, validate);
      });

      phase.continueEncounter();
      expect(terminalSubmits).toBe(1);
      current = { phaseName: "ReplacementPhase" };
      await vi.advanceTimersByTimeAsync(500);

      expect(terminalSubmits, "the replaced phase cannot run its stale terminal retry").toBe(1);
      expect(pushNew, "the stale timer cannot queue a biome or next-wave tail").not.toHaveBeenCalled();
      expect(runtime.controller.interactionCounter(), "the stale timer cannot advance the old pin").toBe(counter);
    } finally {
      vi.useRealTimers();
    }
  });
});
