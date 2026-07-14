/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op BIOME CHOICE (#848). Proves the maintainer directive: the ER
// World-Map biome pick + the every-5-waves crossroads are restored as an OWNER-
// alternated, MIRRORED interaction in co-op instead of the deterministic auto-roll
// co-op used to amputate them to.
//
// BOTH sides are REAL BattleScene engines paired over createLoopbackPair, driven with
// the harness owner/watcher pattern (the reward-shop recipe): the owner drives the real
// phase; the World-Map case presses the public ER_MAP UI while the simpler crossroads captures
// its option callback, streams its cursor + relays its pick; the watcher opens the mirrored copy and
// adopts the relayed pick. Asserts, across two engines:
//   1. CROSSROADS STAY: owner picks Stay -> both continue in the SAME biome, matching
//      overstay/notoriety state; the counter advances exactly once on BOTH.
//   2. CROSSROADS LEAVE + WORLD-MAP PICK: owner picks Leave (deferring its terminal) then
//      a NON-DEFAULT biome; the watcher's mirror session began; BOTH land in the SAME
//      chosen biome; the WHOLE chain is ONE interaction (one counter advance on both).
//   3. ALTERNATION: the picker owner flips to the other player at the next crossroads.
//   4. FAIL-CLOSED: a disconnected owner cannot make the watcher derive a biome locally;
//      it remains parked until the exact host-committed BIOME_PICK arrives.
//
// FAILS-BEFORE: under the old bypass (select-biome-phase auto-rolled generateNextBiome;
// er-crossroads auto-resolved erHasNotoriety), NO picker opens, NO mirror session begins,
// and the owner's NON-DEFAULT choice is never honored - scenario 2's asserts fail.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-biome-choice.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { applyCoopFullSnapshot, captureCoopFullSnapshot } from "#data/elite-redux/coop/coop-battle-engine";
import {
  coopBiomeOperationId,
  getCoopBiomeTransitionCommitReceipt,
  resetCoopBiomeCommitWaitMs,
  setCoopBiomeCommitWaitMs,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  coopBiomeInteractionStartValue,
  resetCoopBiomePickerDrivenByTest,
  setCoopBiomeInteractionStart,
  setCoopBiomePickerDrivenByTest,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import {
  CoopInteractionRelay,
  resetCoopOrphanGraceMs,
  setCoopOrphanGraceMs,
  setCoopWaveBarrierMs,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_BIOME_PICK_SEQ_BASE, COOP_CROSSROADS_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { CoopUiMirror } from "#data/elite-redux/coop/coop-ui-mirror";
import { getCoopUiRelayEdges, resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { type ErRouteNode, getErPendingNodes, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { erBiomeOverstayAnchor, resetErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import { getRevealedMapNodes, resetErMapNodes, revealMapNodes } from "#data/elite-redux/er-map-nodes";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import {
  ErCrossroadsPhase,
  resetCoopCrossroadsContinuationRecoveryPolicyForTest,
  setCoopCrossroadsContinuationRecoveryPolicyForTest,
} from "#phases/er-crossroads-phase";
import {
  resetCoopBiomeContinuationRecoveryPolicyForTest,
  SelectBiomePhase,
  setCoopBiomeContinuationRecoveryPolicyForTest,
} from "#phases/select-biome-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type ClientCtx,
  type DuoRig,
  drainLoopback,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Headless UI capture: record the last ER_MAP / OPTION_SELECT config; fire showText callbacks. */
type ErMapCfg = { nodes?: ErRouteNode[]; origin?: BiomeId; onSelect: (b: BiomeId) => void };
type OptionCfg = { options: { label: string; handler: () => boolean }[] };
interface UiCapture {
  erMapConfig?: ErMapCfg;
  optionConfig?: OptionCfg;
  restore: () => void;
}

function installUiCapture(scene: BattleScene): UiCapture {
  const ui = scene.ui as unknown as {
    setMode: (mode: number, ...args: unknown[]) => Promise<void>;
    setModeBoundedWhen: (
      mode: number,
      timeoutMs: number,
      isCurrent: (() => boolean) | undefined,
      ...args: unknown[]
    ) => Promise<"completed" | "forced" | "superseded">;
    showText: (text: string, delay?: number | null, cb?: (() => void) | null, ...rest: unknown[]) => void;
  };
  const realSetMode = ui.setMode.bind(ui);
  const realSetModeBoundedWhen = ui.setModeBoundedWhen;
  const realShowText = ui.showText.bind(ui);
  const cap: UiCapture = {
    restore: () => {
      ui.setMode = realSetMode;
      ui.setModeBoundedWhen = realSetModeBoundedWhen;
      ui.showText = realShowText;
    },
  };
  ui.setMode = (mode: number, ...args: unknown[]): Promise<void> => {
    if (mode === UiMode.ER_MAP) {
      cap.erMapConfig = args[0] as ErMapCfg;
    } else if (mode === UiMode.OPTION_SELECT) {
      cap.optionConfig = args[0] as OptionCfg;
    }
    return Promise.resolve();
  };
  ui.setModeBoundedWhen = (
    mode: number,
    _timeoutMs: number,
    isCurrent: (() => boolean) | undefined,
    ...args: unknown[]
  ): Promise<"completed" | "forced" | "superseded"> => {
    if (!(isCurrent?.() ?? true)) {
      return Promise.resolve("superseded");
    }
    if (mode === UiMode.ER_MAP) {
      cap.erMapConfig = args[0] as ErMapCfg;
    } else if (mode === UiMode.OPTION_SELECT) {
      cap.optionConfig = args[0] as OptionCfg;
    }
    return Promise.resolve("completed");
  };
  ui.showText = (_text: string, _delay?: number | null, cb?: (() => void) | null): void => {
    if (typeof cb === "function") {
      cb();
    }
  };
  return cap;
}

/**
 * #863: a REAL ui-mode TRACKER (vs {@linkcode installUiCapture}, which only records the config). Records
 * the last target mode so a test can assert the watcher's UI mode LEAVES the map (the "stuck in the map
 * screen" symptom is an observable UI-mode state, not just a config). Fires showText callbacks.
 */
function installUiModeTracker(scene: BattleScene): { mode: () => number; restore: () => void } {
  const ui = scene.ui as unknown as {
    setMode: (mode: number, ...args: unknown[]) => Promise<void>;
    setModeBoundedWhen: (
      mode: number,
      timeoutMs: number,
      isCurrent: (() => boolean) | undefined,
      ...args: unknown[]
    ) => Promise<"completed" | "forced" | "superseded">;
    showText: (text: string, delay?: number | null, cb?: (() => void) | null, ...rest: unknown[]) => void;
    getMode: () => number;
  };
  const realSetMode = ui.setMode.bind(ui);
  const realSetModeBoundedWhen = ui.setModeBoundedWhen;
  const realShowText = ui.showText.bind(ui);
  let cur = ui.getMode();
  ui.setMode = (mode: number): Promise<void> => {
    cur = mode;
    return Promise.resolve();
  };
  ui.setModeBoundedWhen = (
    mode: number,
    _timeoutMs: number,
    isCurrent: (() => boolean) | undefined,
  ): Promise<"completed" | "forced" | "superseded"> => {
    if (!(isCurrent?.() ?? true)) {
      return Promise.resolve("superseded");
    }
    cur = mode;
    return Promise.resolve("completed");
  };
  ui.showText = (_text: string, _delay?: number | null, cb?: (() => void) | null): void => {
    if (typeof cb === "function") {
      cb();
    }
  };
  return {
    mode: () => cur,
    restore: () => {
      ui.setMode = realSetMode;
      ui.setModeBoundedWhen = realSetModeBoundedWhen;
      ui.showText = realShowText;
    },
  };
}

describe.skipIf(!RUN)("co-op DUO biome choice: owner-alternated + mirrored crossroads/World-Map pick (#848)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    setCoopRendezvousWaitMs(50);
    setCoopOrphanGraceMs(20); // #863: fast orphan-backstop poll for the stuck-map repro
    setCoopBiomeCommitWaitMs(20);
    // This suite DRIVES the real crossroads / World-Map picker (the owner opens the actual screen and we
    // invoke its callbacks), so opt OUT of the vitest owner auto-resolve. Reset in afterEach (anti-latch).
    setCoopBiomePickerDrivenByTest();
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`biome-choice-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
    resetCoopOrphanGraceMs();
    resetCoopBiomeCommitWaitMs();
    resetCoopBiomeContinuationRecoveryPolicyForTest();
    resetCoopCrossroadsContinuationRecoveryPolicyForTest();
    resetCoopBiomePickerDrivenByTest();
    resetErBiomeStructure();
    setErPendingNodes([]);
    resetErMapNodes(); // #865: clear any revealed map nodes a test seeded so they don't leak
    logs.dispose();
    clearCoopRuntime();
    vi.restoreAllMocks();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  // ---- owner/watcher helpers (the reward-shop recipe, applied to the biome phases) ----

  /** Which ctx OWNS the interaction at `counter` (host even, guest odd - production parity). */
  function ownerCtxFor(
    rig: DuoRig,
    counter: number,
  ): { ownerCtx: ClientCtx; watcherCtx: ClientCtx; hostOwns: boolean } {
    const hostOwns = counter % 2 === 0;
    return hostOwns
      ? { ownerCtx: rig.hostCtx, watcherCtx: rig.guestCtx, hostOwns }
      : { ownerCtx: rig.guestCtx, watcherCtx: rig.hostCtx, hostOwns };
  }

  /** Materialize the other engine's real reciprocal-boundary arrival before driving one side. */
  async function arriveBoundary(ctx: ClientCtx, point: string): Promise<void> {
    await withClient(ctx, () => ctx.runtime.rendezvous.arrive(point));
    await drainLoopback();
  }

  interface CrossroadsSeam {
    phaseName: string;
    start(): void;
    resolving: boolean;
  }

  /** These legacy focused probes construct a phase directly; make that synthetic instance the live seam. */
  function liveCrossroads(): ErCrossroadsPhase {
    const phase = new ErCrossroadsPhase();
    (phase as unknown as { boundaryStillLive(generation: number, wave: number): boolean }).boundaryStillLive = () =>
      true;
    return phase;
  }

  function liveSelectBiome(): SelectBiomePhase {
    const phase = new SelectBiomePhase();
    (phase as unknown as { boundaryStillLive(generation: number, wave: number): boolean }).boundaryStillLive = () =>
      true;
    return phase;
  }

  it("bounded map recovery retries automatically, deduplicates timers, and fences a replaced boundary", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    setCoopBiomeContinuationRecoveryPolicyForTest({
      retryDelayMs: 5,
      maxAutomaticRetries: 2,
      deadlineMs: 100,
    });

    await withClient(rig.hostCtx, async () => {
      rig.hostScene.currentBattle.waveIndex = 11;
      rig.hostScene.currentBattle.turn = 4;
      const pinned = rig.hostRuntime.controller.interactionCounter();
      let live = true;
      const phase = new SelectBiomePhase() as unknown as {
        coopAdvancePinned: number;
        boundaryStillLive(generation: number, wave: number): boolean;
        parkBiomeCommitRecovery(retry: () => void): void;
      };
      phase.coopAdvancePinned = pinned;
      phase.boundaryStillLive = () => live;
      vi.spyOn(rig.hostScene.ui, "setModeBoundedWhen").mockResolvedValue("completed");
      vi.spyOn(rig.hostScene.ui, "showText").mockImplementation(() => {});
      const queue = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
      const firstRetry = vi.fn();

      // Duplicate failure callbacks share one supervisor/timer. No confirm input is supplied.
      phase.parkBiomeCommitRecovery(firstRetry);
      phase.parkBiomeCommitRecovery(firstRetry);
      await new Promise(resolve => setTimeout(resolve, 8));
      expect(firstRetry, "the first exact retry is automatic and deduplicated").toHaveBeenCalledOnce();

      const lateRetry = vi.fn();
      phase.parkBiomeCommitRecovery(lateRetry);
      live = false;
      await new Promise(resolve => setTimeout(resolve, 25));
      expect(lateRetry, "a callback from the replaced boundary is fenced").not.toHaveBeenCalled();
      expect(
        queue.mock.calls.some(call => call[0] === "SwitchBiomePhase"),
        "recovery alone cannot authorize biome mutation",
      ).toBe(false);
      expect(rig.hostRuntime.controller.interactionCounter(), "recovery cannot advance ownership").toBe(pinned);
    });
  });

  it("invalid map authority exhausts into the host shared terminal without RNG, mutation, or counter advance", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    setCoopBiomeCommitWaitMs(10);
    setCoopBiomeContinuationRecoveryPolicyForTest({
      retryDelayMs: 5,
      maxAutomaticRetries: 1,
      deadlineMs: 100,
    });

    await withClient(rig.hostCtx, async () => {
      rig.hostScene.currentBattle.waveIndex = 11;
      rig.hostScene.currentBattle.turn = 6;
      const pinned = rig.hostRuntime.controller.interactionCounter();
      const revealed: ErRouteNode[] = [
        { biome: BiomeId.FOREST, revealed: true },
        { biome: BiomeId.VOLCANO, revealed: true },
      ];
      const phase = new SelectBiomePhase() as unknown as {
        coopAdvancePinned: number;
        boundaryStillLive(generation: number, wave: number): boolean;
        applyBiomeWatcherDecision(
          nodes: ErRouteNode[],
          operationId: string,
          expectedPinned: number,
          role: "host" | "guest",
          result: { choice: number; data?: number[] },
          committed: boolean,
        ): Promise<void>;
        applyNextBiomeAndEnd(nextBiome: BiomeId): boolean;
        coopCommitRecovery: {
          wave: number;
          turn: number;
          boundaryRevision: number;
          terminalRequested: boolean;
        } | null;
      };
      phase.coopAdvancePinned = pinned;
      phase.boundaryStillLive = () => true;
      vi.spyOn(rig.hostScene.ui, "setModeBoundedWhen").mockResolvedValue("completed");
      vi.spyOn(rig.hostScene.ui, "showText").mockImplementation(() => {});
      const apply = vi.spyOn(phase, "applyNextBiomeAndEnd");
      const randomBiome = vi.spyOn(rig.hostScene, "generateRandomBiome");
      const queue = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
      const operationId = coopBiomeOperationId("BIOME_PICK", COOP_BIOME_PICK_SEQ_BASE + pinned, pinned);

      await phase.applyBiomeWatcherDecision(revealed, operationId, pinned, "host", { choice: 99 }, true);
      for (let i = 0; i < 30 && rig.hostRuntime.localTransport.state !== "closed"; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      expect(apply, "invalid/missing authority cannot reach the biome terminal").not.toHaveBeenCalled();
      expect(randomBiome, "the renderer never derives a fallback biome").not.toHaveBeenCalled();
      expect(
        queue.mock.calls.some(call => call[0] === "SwitchBiomePhase"),
        "no uncommitted switch is queued",
      ).toBe(false);
      expect(rig.hostRuntime.controller.interactionCounter(), "missing authority cannot advance ownership").toBe(
        pinned,
      );
      expect(phase.coopCommitRecovery, "the terminal is addressed to the exact failed map boundary").toMatchObject({
        wave: 11,
        turn: 6,
        boundaryRevision: pinned,
        terminalRequested: true,
      });
      expect(rig.hostRuntime.localTransport.state, "host exhaustion clears its shared runtime").toBe("closed");
    });
  });

  it("invalid crossroads authority exhausts into the guest shared terminal without applying or advancing", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    setCoopBiomeCommitWaitMs(10);
    setCoopCrossroadsContinuationRecoveryPolicyForTest({
      retryDelayMs: 5,
      maxAutomaticRetries: 1,
      deadlineMs: 100,
    });

    await withClient(rig.guestCtx, async () => {
      rig.guestScene.currentBattle.waveIndex = 11;
      rig.guestScene.currentBattle.turn = 7;
      const pinned = rig.guestRuntime.controller.interactionCounter();
      const phase = new ErCrossroadsPhase() as unknown as {
        coopStartCounter: number;
        boundaryStillLive(generation: number, wave: number): boolean;
        applyCrossroadsWatcherDecision(
          expectedPinned: number,
          operationId: string,
          role: "host" | "guest",
          result: { choice: number },
          committed: boolean,
        ): void;
        coopApply(expectedPinned: number, moveOn: boolean): boolean;
        coopCommitRecovery: {
          wave: number;
          turn: number;
          boundaryRevision: number;
          terminalRequested: boolean;
        } | null;
      };
      phase.coopStartCounter = pinned;
      phase.boundaryStillLive = () => true;
      vi.spyOn(rig.guestScene.ui, "setModeBoundedWhen").mockResolvedValue("completed");
      vi.spyOn(rig.guestScene.ui, "showText").mockImplementation(() => {});
      const apply = vi.spyOn(phase, "coopApply");
      const operationId = coopBiomeOperationId("CROSSROADS_PICK", COOP_CROSSROADS_SEQ_BASE + pinned, pinned);

      phase.applyCrossroadsWatcherDecision(pinned, operationId, "guest", { choice: 99 }, true);
      for (let i = 0; i < 30 && rig.guestRuntime.localTransport.state !== "closed"; i++) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      expect(apply, "invalid/missing authority cannot execute Stay or Leave").not.toHaveBeenCalled();
      expect(rig.guestRuntime.controller.interactionCounter(), "missing authority cannot advance ownership").toBe(
        pinned,
      );
      expect(
        phase.coopCommitRecovery,
        "the terminal is addressed to the exact failed crossroads boundary",
      ).toMatchObject({
        wave: 11,
        turn: 7,
        boundaryRevision: pinned,
        terminalRequested: true,
      });
      expect(rig.guestRuntime.localTransport.state, "guest exhaustion clears its shared runtime").toBe("closed");
    });
  });

  /** Drive the OWNER crossroads: start (opens mocked OPTION_SELECT after the #858 boundary barrier), then
   *  press Stay(0)/Leave(1). The owner drives alone here, so its reciprocal boundary barrier resolves via
   *  the anti-hang timeout (setCoopRendezvousWaitMs(50)) - poll for the menu across it. */
  async function driveCrossroadsOwner(cap: UiCapture, moveOn: boolean): Promise<void> {
    const phase = liveCrossroads();
    phase.start();
    for (let i = 0; i < 80 && cap.optionConfig == null; i++) {
      await drainLoopback();
    }
    const opts = cap.optionConfig?.options;
    expect(opts, "owner crossroads opened the Stay/Leave menu (mirrored)").toBeDefined();
    // Press Stay (0) or Leave (1).
    opts![moveOn ? 1 : 0].handler();
    await drainLoopback();
  }

  /** Drive the WATCHER crossroads: start (opens mirrored copy + awaits), drain until it applies. */
  async function driveCrossroadsWatch(): Promise<CrossroadsSeam> {
    const phase = liveCrossroads() as unknown as CrossroadsSeam;
    phase.start();
    for (let i = 0; i < 40; i++) {
      await drainLoopback();
      if (phase.resolving) {
        return phase;
      }
    }
    throw new Error("crossroads WATCH HANG: watcher never applied the owner's pick");
  }

  // =====================================================================================
  // SCENARIO 1: CROSSROADS STAY - both continue the same biome, overstay armed, one advance.
  // =====================================================================================
  it("CROSSROADS STAY: owner picks Stay -> both stay in the same biome, counter advances once on both", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    // Drive a deep wave so the crossroads is PAST the notoriety-free window (Stay arms the overstay anchor).
    rig.hostScene.currentBattle.waveIndex = 26;
    rig.guestScene.currentBattle.waveIndex = 26;

    const beginSpy = vi.spyOn(CoopUiMirror.prototype, "beginSession");
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const { ownerCtx, watcherCtx } = ownerCtxFor(rig, counterBefore);
    const biomeBefore = rig.hostScene.arena.biomeId;

    const ownerCap = installUiCapture(ownerCtx.scene);
    const watcherCap = installUiCapture(watcherCtx.scene);
    try {
      await arriveBoundary(watcherCtx, "xroads:26");
      // OWNER first (buffers its relay), THEN watcher (drains it) - sequential, per-ctx.
      await withClient(ownerCtx, () => driveCrossroadsOwner(ownerCap, /* moveOn */ false));
      await withClient(watcherCtx, () => driveCrossroadsWatch());
    } finally {
      ownerCap.restore();
      watcherCap.restore();
    }

    // Both engines stayed in the SAME biome (no SwitchBiomePhase queued).
    expect(rig.guestScene.arena.biomeId, "both engines stay in the same biome on STAY").toBe(biomeBefore);
    // The overstay anchor was armed (past the free window) - the matching notoriety machinery.
    expect(erBiomeOverstayAnchor(), "STAY past the free window arms the overstay anchor").not.toBeNull();
    // The watcher mirror session began (the crossroads screen was MIRRORED, not amputated).
    expect(
      beginSpy.mock.calls.some(c => c[0] === "watcher"),
      "the watcher opened a mirrored crossroads session (#848)",
    ).toBe(true);
    expect(
      beginSpy.mock.calls.some(c => c[0] === "owner"),
      "the owner streamed its crossroads cursor",
    ).toBe(true);
    // The counter advanced EXACTLY once on BOTH clients (STAY is the interaction terminal).
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced once").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced once (lockstep)").toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // SCENARIO 2 + 3: CROSSROADS LEAVE -> WORLD-MAP PICK (one interaction), then ALTERNATION.
  // =====================================================================================
  it("CROSSROADS LEAVE + WORLD-MAP PICK: one interaction, both land in the owner's NON-DEFAULT biome; alternation flips", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    // A mid-run wave (not a finale); both engines share it.
    rig.hostScene.currentBattle.waveIndex = 11;
    rig.guestScene.currentBattle.waveIndex = 11;

    // Two REVEALED onward nodes (shared er-map state). The owner will pick the SECOND (non-default).
    const nodes: ErRouteNode[] = [
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true },
    ];
    setErPendingNodes(nodes);
    const chosen = BiomeId.VOLCANO;

    const beginSpy = vi.spyOn(CoopUiMirror.prototype, "beginSession");
    const hostSwitch = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
    const guestSwitch = vi.spyOn(rig.guestScene.phaseManager, "unshiftNew");
    const biomeArg = (spy: typeof hostSwitch): BiomeId | undefined =>
      spy.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1] as BiomeId | undefined;

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const { ownerCtx, watcherCtx } = ownerCtxFor(rig, counterBefore);

    // ===== Step A: the CROSSROADS (owner picks LEAVE - defers its terminal to the map pick). =====
    const ownerCap = installUiCapture(ownerCtx.scene);
    let watcherCap = installUiCapture(watcherCtx.scene);
    try {
      await arriveBoundary(watcherCtx, "xroads:11");
      await withClient(ownerCtx, () => driveCrossroadsOwner(ownerCap, /* moveOn */ true));
      await withClient(watcherCtx, () => driveCrossroadsWatch());
    } finally {
      ownerCap.restore();
      watcherCap.restore();
    }

    // LEAVE defers: the counter has NOT advanced yet (the chained map pick owns the single terminal).
    expect(rig.hostRuntime.controller.interactionCounter(), "LEAVE defers - host counter unchanged").toBe(
      counterBefore,
    );
    expect(rig.guestRuntime.controller.interactionCounter(), "LEAVE defers - guest counter unchanged").toBe(
      counterBefore,
    );
    // Both engines queued the chained SelectBiomePhase (the World-Map picker follows the Leave).
    expect(biomeArg(hostSwitch)).toBeUndefined(); // no SwitchBiomePhase yet - the map pick is still pending

    // ===== Step B: the WORLD-MAP PICK (same owner drives; owner picks the NON-DEFAULT biome). =====
    // The crossroads deferred its terminal by pinning the biome interaction (shared module state here;
    // one per-process pin in production). Snapshot it so the WATCHER engine sees its OWN pin too (the
    // owner engine clears the shared global at its terminal - production-faithful restore).
    const pinAfterLeave = coopBiomeInteractionStartValue();
    expect(pinAfterLeave, "the crossroads Leave pinned the biome interaction").toBe(counterBefore);
    watcherCap = installUiCapture(watcherCtx.scene);
    try {
      await arriveBoundary(watcherCtx, "biomepick:11");
      setCoopBiomeInteractionStart(pinAfterLeave); // the owner engine's chained pin
      await withClient(ownerCtx, async () => {
        const phase = liveSelectBiome();
        phase.start(); // reaches coopBiomePickOwner and opens the real ER_MAP handler
        for (let i = 0; i < 100 && ownerCtx.scene.ui.getMode() !== UiMode.ER_MAP; i++) {
          await drainLoopback();
        }
        expect(ownerCtx.scene.ui.getMode(), "owner opened the real ER_MAP route picker").toBe(UiMode.ER_MAP);
        resetCoopUiRelayTrace();
        expect(ownerCtx.scene.ui.processInput(Button.RIGHT), "owner moves to the non-default route via UI").toBe(true);
        expect(ownerCtx.scene.ui.processInput(Button.ACTION), "owner commits VOLCANO via the real map UI").toBe(true);
        expect(
          getCoopUiRelayEdges().some(edge => edge.mode === UiMode.ER_MAP && edge.carrier === "interactionChoice"),
          "the public World-Map input reached the production biome relay",
        ).toBe(true);
        await drainLoopback();
      });
      // Retained receipts are receiver-side materialization evidence. The harness deliberately queues
      // operation envelopes until the destination client is installed, matching separate browser globals.
      await withClient(rig.guestCtx, () => drainLoopback());
      expect(
        withClientSync(
          rig.guestCtx,
          () =>
            getCoopBiomeTransitionCommitReceipt({
              sourceWave: 11,
              interactivePinned: pinAfterLeave,
            })?.payload,
        ),
        "the retained interactive terminal names the owner's exact non-default route",
      ).toMatchObject({ biomeId: chosen, nodeIndex: 1, nextWave: 12 });
      setCoopBiomeInteractionStart(pinAfterLeave); // the watcher engine's own chained pin
      await withClient(watcherCtx, async () => {
        const phase = liveSelectBiome();
        phase.start(); // reaches coopBiomePickWatch (ER_MAP mocked), beginSession("watcher"), awaits relay
        for (let i = 0; i < 40; i++) {
          await drainLoopback();
          if (biomeArg(guestSwitch) !== undefined) {
            return;
          }
        }
        throw new Error("biome pick WATCH HANG: watcher never adopted the owner's biome");
      });
    } finally {
      watcherCap.restore();
    }

    // BOTH engines switch to the owner's CHOSEN (non-default) biome - the core mechanic, restored.
    expect(biomeArg(hostSwitch), "host switches to the owner's chosen biome").toBe(chosen);
    expect(biomeArg(guestSwitch), "guest switches to the SAME owner-chosen biome").toBe(chosen);
    // The watcher mirror session began for the map screen too.
    expect(
      beginSpy.mock.calls.some(c => c[0] === "watcher"),
      "the watcher opened a mirrored MAP session",
    ).toBe(true);
    // ONE interaction for the WHOLE crossroads->map chain: the counter advanced EXACTLY once, on both.
    expect(rig.hostRuntime.controller.interactionCounter(), "host: one advance for the whole chain").toBe(
      counterBefore + 1,
    );
    expect(rig.guestRuntime.controller.interactionCounter(), "guest: one advance for the whole chain (lockstep)").toBe(
      counterBefore + 1,
    );

    // ===== Step C: ALTERNATION - the NEXT crossroads is owned by the OTHER player. =====
    const counterNext = rig.hostRuntime.controller.interactionCounter();
    const next = ownerCtxFor(rig, counterNext);
    expect(next.ownerCtx.label, "the picker owner flipped to the other player at the next boundary").not.toBe(
      ownerCtx.label,
    );
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // SCENARIO 4: FAIL CLOSED - a disconnected owner cannot make the authoritative renderer
  // derive a biome locally. It remains parked until the exact host BIOME_PICK is journaled.
  // =====================================================================================
  it("AUTHORITY LOSS: a timed-out owner pick parks without renderer RNG, mutation, or counter advance", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    rig.hostScene.currentBattle.waveIndex = 11;
    rig.guestScene.currentBattle.waveIndex = 11;
    setErPendingNodes([
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true },
    ]);

    // Force EVERY relay await to TIME OUT (simulate a disconnected owner) - the anti-hang path.
    vi.spyOn(CoopInteractionRelay.prototype, "awaitInteractionChoice").mockResolvedValue(null);

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const { ownerCtx, watcherCtx } = ownerCtxFor(rig, counterBefore);
    const watcherCounterBefore = watcherCtx.runtime.controller.interactionCounter();
    const switchSpy = vi.spyOn(watcherCtx.scene.phaseManager, "unshiftNew");
    const randomBiome = vi.spyOn(watcherCtx.scene, "generateRandomBiome");
    const sourceBiome = watcherCtx.scene.arena.biomeId;

    // The owner reached the shared boundary, then disappeared before sending a choice. This lets the
    // watcher cross the reciprocal barrier while still exercising the deterministic relay fallback.
    await arriveBoundary(ownerCtx, "biomepick:11");
    const cap = installUiCapture(watcherCtx.scene);
    const ui = watcherCtx.scene.ui as unknown as {
      showText: (text: string, delay?: number | null, cb?: (() => void) | null, ...rest: unknown[]) => void;
    };
    ui.showText = () => {
      // Hold the explicit recovery action: authority loss must park rather than self-select.
    };
    const phase = liveSelectBiome();
    try {
      await withClient(watcherCtx, async () => {
        phase.start();
        for (let i = 0; i < 40; i++) {
          await drainLoopback();
          await new Promise(resolve => setTimeout(resolve, 2));
        }
      });
    } finally {
      (phase as unknown as { clearBiomeCommitRecovery(): void }).clearBiomeCommitRecovery();
      cap.restore();
    }

    expect(
      switchSpy.mock.calls.some(c => c[0] === "SwitchBiomePhase"),
      "no uncommitted switch",
    ).toBe(false);
    expect(randomBiome, "the authoritative renderer cannot choose a timeout fallback").not.toHaveBeenCalled();
    expect(watcherCtx.scene.arena.biomeId, "the renderer keeps its source arena while parked").toBe(sourceBiome);
    expect(
      watcherCtx.runtime.controller.interactionCounter(),
      "the renderer cannot advance an interaction that authority never committed",
    ).toBe(watcherCounterBefore);
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // SCENARIO 5 (#863): ORPHAN backstop - "partner chose map but I am stuck in the map screen".
  //
  // Live wave-10 report (build mrbdf344): the biome-pick WATCHER pins the interaction, opens the
  // mirrored ER_MAP, and awaits the owner's relayed biome on COOP_BIOME_PICK_SEQ_BASE + counter. The
  // OWNER picked + advanced PAST the interaction, but its relay never reached the watcher's waiter (a
  // lost/raced pick at the wave boundary). The generic seq-based orphan-rescue can't see this OFFSET band
  // (it compares the relay seq against the peer's COUNTER), there is no between-wave resync to fire it, and
  // the stall watchdog only recovers a MUTUAL stall - so the watcher FROZE on the 20-min COOP_BIOME_WAIT_MS,
  // input-blocked by the still-open cursor mirror.
  //
  // Here BOTH engines are real: the OWNER advances the shared interaction counter past the pinned biome
  // pick (committed + moved on) WITHOUT ever relaying a biomePick choice. Unlike SCENARIO 4 (which forces
  // EVERY relay await to time out), this leaves COOP_BIOME_WAIT_MS at its real 20-min value: only the
  // one-sided ORPHAN backstop (owner-advanced-past, no pick) can dismiss the watcher.
  //
  // FAILS-BEFORE: with only the choice-relay await, the watcher's UI mode never leaves ER_MAP (it sits on
  // the 20-min timeout) - the drain loop below never satisfies "mode left ER_MAP", so it throws.
  // PASSES-AFTER: the orphan backstop returns null promptly, the watcher ends its mirror, tears the map
  // down to MESSAGE, and parks for the missing exact commit without choosing a biome locally.
  // =====================================================================================
  it("ORPHAN (#863): owner advances with NO exact commit -> watcher leaves the map and parks without mutation", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    rig.hostScene.currentBattle.waveIndex = 11;
    rig.guestScene.currentBattle.waveIndex = 11;

    setErPendingNodes([
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true },
    ]);

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const { ownerCtx, watcherCtx } = ownerCtxFor(rig, counterBefore);

    const beginSpy = vi.spyOn(CoopUiMirror.prototype, "beginSession");
    const watcherTracker = installUiModeTracker(watcherCtx.scene);
    const switchSpy = vi.spyOn(watcherCtx.scene.phaseManager, "unshiftNew");
    const randomBiome = vi.spyOn(watcherCtx.scene, "generateRandomBiome");
    const sourceBiome = watcherCtx.scene.arena.biomeId;
    const ui = watcherCtx.scene.ui as unknown as {
      showText: (text: string, delay?: number | null, cb?: (() => void) | null, ...rest: unknown[]) => void;
    };
    ui.showText = () => {
      // Hold the recovery action after the orphan detector closes the map.
    };

    // The OWNER commits + moves on WITHOUT relaying a biomePick: advance the shared interaction counter and
    // broadcast it. The watcher receives ONLY this advance (never a pick) - the exact one-sided orphan.
    withClientSync(ownerCtx, () => ownerCtx.runtime.controller.advanceInteraction(counterBefore));
    await drainLoopback();
    expect(
      getCoopBiomeTransitionCommitReceipt({ sourceWave: 11, interactivePinned: counterBefore }),
      "a counter-only orphan is not biome authority",
    ).toBeNull();

    const phase = liveSelectBiome();
    try {
      await withClient(watcherCtx, async () => {
        setCoopBiomeInteractionStart(counterBefore); // chained pin -> the watcher takes coopBiomePickWatch
        phase.start();
        for (let i = 0; i < 200; i++) {
          await drainLoopback();
          await new Promise(resolve => setTimeout(resolve, 2));
          if (watcherTracker.mode() !== UiMode.ER_MAP) {
            return;
          }
        }
        throw new Error(
          "biome pick ORPHAN HANG: the watcher never left ER_MAP - it is stuck on the 20-min relay timeout (#863 fails-before)",
        );
      });
    } finally {
      (phase as unknown as { clearBiomeCommitRecovery(): void }).clearBiomeCommitRecovery();
      watcherTracker.restore();
    }

    // The watcher opened the MIRRORED map (so this is the real owner-alternated path), then LEFT it.
    expect(
      beginSpy.mock.calls.some(c => c[0] === "watcher"),
      "the watcher opened a mirrored MAP session before the orphan dismiss",
    ).toBe(true);
    expect(watcherTracker.mode(), "the watcher's UI mode LEFT the map (not stuck in ER_MAP) (#863)").not.toBe(
      UiMode.ER_MAP,
    );
    expect(
      switchSpy.mock.calls.some(c => c[0] === "SwitchBiomePhase"),
      "the renderer cannot queue SwitchBiomePhase without the exact journal commit",
    ).toBe(false);
    expect(randomBiome, "the orphan path cannot derive a renderer fallback").not.toHaveBeenCalled();
    expect(watcherCtx.scene.arena.biomeId, "the orphan path leaves authoritative run state untouched").toBe(
      sourceBiome,
    );
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // PROBE (#864): drive the REAL ErMapUiHandler owner path via the REAL ui.processInput mirror
  // pump - the untested gap. The other scenarios call the captured onSelect DIRECTLY (mocking
  // setMode), so they never exercise the real handler input -> confirmPick -> onSelect funnel NOR
  // the real ui.processInput owner-drive/relay pump. This one does. Assert the owner emits the
  // biomePick relay + advances the counter.
  // =====================================================================================
  it("PROBE: owner drives the REAL ER_MAP handler via real input -> emits biomePick relay + advances", async () => {
    const { Button } = await import("#enums/buttons");
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    rig.hostScene.currentBattle.waveIndex = 11;
    rig.guestScene.currentBattle.waveIndex = 11;

    setErPendingNodes([
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true },
    ]);

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const { ownerCtx, watcherCtx } = ownerCtxFor(rig, counterBefore);

    const sendSpy = vi.spyOn(CoopInteractionRelay.prototype, "sendInteractionChoice");

    await arriveBoundary(watcherCtx, "biomepick:11");
    await withClient(ownerCtx, async () => {
      const phase = liveSelectBiome();
      phase.start();
      // Poll across the #858 boundary barrier after the watcher has genuinely arrived; then the real handler opens.
      let opened = false;
      for (let i = 0; i < 120 && !opened; i++) {
        await drainLoopback();
        opened = ownerCtx.scene.ui.getMode() === UiMode.ER_MAP;
      }
      // eslint-disable-next-line no-console
      console.log(
        `[PROBE #864] after start: ui.getMode()=${ownerCtx.scene.ui.getMode()} (ER_MAP=${UiMode.ER_MAP}) opened=${opened}`,
      );
      if (opened) {
        // Drive the REAL picker: RIGHT to the 2nd node (VOLCANO), ACTION to travel.
        ownerCtx.scene.ui.processInput(Button.RIGHT);
        ownerCtx.scene.ui.processInput(Button.ACTION);
        await drainLoopback();
      }
    });

    const biomePickSends = sendSpy.mock.calls.filter(c => c[1] === "biomePick");
    // eslint-disable-next-line no-console
    console.log(
      `[PROBE #864] sendInteractionChoice calls=${JSON.stringify(sendSpy.mock.calls.map(c => ({ seq: c[0], kind: c[1], choice: c[2], data: c[3] })))} counterBefore=${counterBefore} counterAfter=${rig.hostRuntime.controller.interactionCounter()}`,
    );
    expect(biomePickSends.length, "the owner emitted a biomePick relay via the REAL handler input path").toBe(1);
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // SCENARIO 6 (#864): the OWNER travels via a DETERMINISTIC terminal (NOT the World-Map picker) and
  // MUST STILL relay the biome. The live P0: at a boundary the biome-pick owner changed biome WITHOUT
  // emitting the biomePick relay (a non-picker terminal - a single revealed node / a travel-event
  // target), so the watcher, parked on the map awaiting the pick, adopted a DIFFERENT deterministic
  // fallback -> the two clients landed in different biomes ("map changed without letting me choose" on
  // one, "Desynced waves" on the other).
  //
  // Here the OWNER is a chained crossroads-Leave whose SelectBiomePhase resolves to a SINGLE revealed
  // node (a deterministic terminal that NEVER opens the picker). The WATCHER's SelectBiomePhase sees
  // MULTIPLE nodes (a divergent-state boundary), opens the mirrored map, and awaits the owner's relay.
  //
  // FAILS-BEFORE: the single-node terminal advanced the counter but sent NO biomePick relay, so the
  // watcher's #863 orphan backstop fired -> it fell back to generateNextBiome (a DIFFERENT biome than
  // the owner's single node) -> the two engines DIVERGED.
  // PASSES-AFTER: setNextBiomeAndEnd's owner funnel relays the single-node biome, so the watcher adopts
  // it verbatim -> both engines land in the SAME biome.
  // =====================================================================================
  it("SCENARIO 6: a chained deterministic terminal uses an exact host BIOME_PICK, not a phantom interaction relay", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    rig.hostScene.currentBattle.waveIndex = 11;
    rig.guestScene.currentBattle.waveIndex = 11;
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const destination = BiomeId.VOLCANO;
    const sendSpy = vi.spyOn(CoopInteractionRelay.prototype, "sendInteractionChoice");
    const hostSwitch = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
    const guestSwitch = vi.spyOn(rig.guestScene.phaseManager, "unshiftNew");
    const biomeArg = (spy: typeof hostSwitch): BiomeId | undefined =>
      spy.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1] as BiomeId | undefined;

    await withClient(rig.hostCtx, async () => {
      setErPendingNodes([{ biome: destination, revealed: true }]);
      setCoopBiomeInteractionStart(counterBefore);
      liveSelectBiome().start();
      await drainLoopback();
    });
    await withClient(rig.guestCtx, () => drainLoopback());
    expect(
      withClientSync(
        rig.guestCtx,
        () => getCoopBiomeTransitionCommitReceipt({ sourceWave: 11, interactivePinned: counterBefore })?.payload,
      ),
      "the guest materialized the host's exact retained deterministic boundary terminal",
    ).toMatchObject({ biomeId: destination, nodeIndex: -1, nextWave: 12 });
    await withClient(rig.guestCtx, async () => {
      setErPendingNodes([{ biome: destination, revealed: true }]);
      setCoopBiomeInteractionStart(counterBefore);
      liveSelectBiome().start();
      for (let i = 0; i < 80 && biomeArg(guestSwitch) === undefined; i++) {
        await drainLoopback();
      }
    });

    expect(biomeArg(hostSwitch)).toBe(destination);
    expect(biomeArg(guestSwitch)).toBe(destination);
    expect(
      sendSpy.mock.calls.filter(c => c[1] === "biomePick"),
      "no phantom deterministic relay",
    ).toHaveLength(0);
    expect(rig.hostRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // SCENARIO 7 (#865): the NATURAL single-node biome-travel terminal (revealed.length===1,
  // NON-chained). #864 closed the CHAINED single-node case (a crossroads Leave pinned the interaction, so
  // setNextBiomeAndEnd relayed the biome). The RESIDUAL: a NATURAL single-node transition ticks NO
  // interaction counter (coopAdvancePinned stays -1) and relays NO biomePick - both clients rely on
  // computing the SAME revealed[0] from their OWN getErPendingNodes(). But the routing pending-node set is
  // NOT part of the persisted erMapState and was NOT synced, so if the two clients' onward node sets diverge
  // (a Map-Upgrade / mystery-event reveal that rolled differently), the host could see 1 node (auto-travels
  // silently) while the guest sees 2 (opens a picker the host never had) -> different biomes.
  //
  // THE FIX (option b): erMapState + the routing pending-node set are host-authoritative, carried in the
  // full-state resync snapshot and ADOPTED by the guest (restoreErMapState + setErPendingNodes). So when the
  // guest heals from the host's snapshot it adopts the host's SINGLE onward node -> both clients take the
  // deterministic single-node terminal to the SAME biome, coherent BY CONSTRUCTION (no relay, no picker).
  //
  // FAILS-BEFORE: the resync snapshot carried NO erPendingNodes, so applyCoopFullSnapshot left the guest's
  // divergent 2-node set intact -> the guest opens a picker (revealed.length>1) instead of the single-node
  // terminal, and never lands on the host's biome. PASSES-AFTER: the guest adopts the host's single node.
  // =====================================================================================
  it("SCENARIO 7 (#865): divergent map state -> guest adopts host's pending nodes via resync -> NATURAL single-node terminal converges", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    // A mid-run wave, NOT a boundary/finale and NOT chained from a crossroads (the NATURAL terminal).
    rig.hostScene.currentBattle.waveIndex = 13;
    rig.guestScene.currentBattle.waveIndex = 13;

    const hostBiome = BiomeId.VOLCANO;
    const seedMap = (nodes: ErRouteNode[]): void => {
      resetErMapNodes();
      setErPendingNodes(nodes);
      // A real string label (production uses getBiomeName) so the getErMapSaveData/restoreErMapState
      // round-trip keeps the node (restoreErMapState drops nodes whose label is not a string).
      revealMapNodes(
        nodes.filter(n => n.revealed).map(n => ({ biome: n.biome, label: `biome-${n.biome}`, kind: "biome" })),
      );
    };

    // HOST: a SINGLE revealed onward node -> the natural single-node terminal (no picker, no relay).
    const hostSnapshot = withClientSync(rig.hostCtx, () => {
      seedMap([{ biome: hostBiome, revealed: true }]);
      return captureCoopFullSnapshot();
    });
    expect(
      hostSnapshot?.erPendingNodes?.map(n => n.biome),
      "host snapshot carries its single pending node",
    ).toEqual([hostBiome]);

    // GUEST: DIVERGENT map state - TWO revealed nodes (would open a picker the host never had).
    withClientSync(rig.guestCtx, () => {
      seedMap([
        { biome: BiomeId.FOREST, revealed: true },
        { biome: hostBiome, revealed: true },
      ]);
    });

    // Apply the host's resync snapshot on the guest (the production stateSync heal path).
    const guestAfter = withClientSync(rig.guestCtx, () => {
      applyCoopFullSnapshot(hostSnapshot!, /* authoritativeGuest */ true, /* suppressResummon */ false);
      return {
        pending: getErPendingNodes(),
        mapNodes: getRevealedMapNodes()
          .filter(n => n.kind === "biome")
          .map(n => n.biome),
      };
    });
    // The guest ADOPTED the host's map state: a SINGLE revealed onward node (both the routing decision input
    // AND the map overlay), so its SelectBiomePhase now takes the SAME single-node branch as the host.
    expect(
      guestAfter.pending.filter(n => n.revealed).length,
      "the guest adopted the host's SINGLE revealed pending node (#865)",
    ).toBe(1);
    expect(guestAfter.pending[0]?.biome, "the guest's pending node IS the host's biome").toBe(hostBiome);
    expect(guestAfter.mapNodes, "the guest's revealed MAP nodes match the host").toEqual([hostBiome]);

    // The host commits the exact deterministic BIOME_PICK first; the guest then adopts that receipt/permit.
    const hostSwitch = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
    const guestSwitch = vi.spyOn(rig.guestScene.phaseManager, "unshiftNew");
    const sendSpy = vi.spyOn(CoopInteractionRelay.prototype, "sendInteractionChoice");
    const counterBefore = rig.guestRuntime.controller.interactionCounter();
    const guestTracker = installUiModeTracker(rig.guestScene);
    try {
      await withClient(rig.hostCtx, async () => {
        liveSelectBiome().start();
        await drainLoopback();
      });
      await withClient(rig.guestCtx, () => drainLoopback());
      expect(
        withClientSync(rig.guestCtx, () => getCoopBiomeTransitionCommitReceipt({ sourceWave: 13 })?.payload),
        "the guest materialized the host's retained single-node terminal before renderer projection",
      ).toMatchObject({ biomeId: hostBiome, nodeIndex: -1, nextWave: 14 });
      expect(
        hostSwitch.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1],
        "the authority may finish before the renderer opens its continuation",
      ).toBe(hostBiome);
      expect(
        guestSwitch.mock.calls.find(c => c[0] === "SwitchBiomePhase"),
        "the renderer has not projected the pre-delivered terminal yet",
      ).toBeUndefined();
      await withClient(rig.guestCtx, async () => {
        // NOT chained (no setCoopBiomeInteractionStart): the natural single-node deterministic terminal.
        liveSelectBiome().start();
        for (let i = 0; i < 80; i++) {
          await drainLoopback();
          if (
            (guestSwitch.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1] as BiomeId | undefined) !== undefined
          ) {
            return;
          }
        }
        throw new Error("SCENARIO 7 HANG: the guest single-node terminal never resolved (#865 fails-before)");
      });
    } finally {
      guestTracker.restore();
    }

    const biomeArg = (spy: typeof guestSwitch): BiomeId | undefined =>
      spy.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1] as BiomeId | undefined;
    expect(biomeArg(hostSwitch), "the authority committed its exact single-node tail").toBe(hostBiome);
    // THE CONVERGENCE: the guest travels only after adopting the host's exact single-node operation.
    expect(biomeArg(guestSwitch), "the guest travels to the host's single-node biome (coherent) (#865)").toBe(
      hostBiome,
    );
    // The NATURAL single-node terminal is NOT an interaction: no biomePick relay, no counter advance, no map.
    expect(
      sendSpy.mock.calls.filter(c => c[1] === "biomePick").length,
      "the natural single-node terminal sends NO biomePick relay (not an interaction)",
    ).toBe(0);
    expect(rig.guestRuntime.controller.interactionCounter(), "the natural single-node terminal ticks NO counter").toBe(
      counterBefore,
    );
    expect(guestTracker.mode(), "the natural single-node terminal never opened the ER_MAP picker").not.toBe(
      UiMode.ER_MAP,
    );
    logs.flush();
  }, 300_000);
});
