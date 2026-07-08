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
// phase (its UI mocked headlessly, exactly like driveHostRewardShopOwner mocks the party
// picker), streams its cursor + relays its pick; the watcher opens the mirrored copy and
// adopts the relayed pick. Asserts, across two engines:
//   1. CROSSROADS STAY: owner picks Stay -> both continue in the SAME biome, matching
//      overstay/notoriety state; the counter advances exactly once on BOTH.
//   2. CROSSROADS LEAVE + WORLD-MAP PICK: owner picks Leave (deferring its terminal) then
//      a NON-DEFAULT biome; the watcher's mirror session began; BOTH land in the SAME
//      chosen biome; the WHOLE chain is ONE interaction (one counter advance on both).
//   3. ALTERNATION: the picker owner flips to the other player at the next crossroads.
//   4. FALLBACK: a disconnected owner (the watcher's relay times out) backstops to the
//      SAME deterministic auto-resolve both engines compute off the shared seed.
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
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { CoopUiMirror } from "#data/elite-redux/coop/coop-ui-mirror";
import { type ErRouteNode, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { erBiomeOverstayAnchor, resetErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { ErCrossroadsPhase } from "#phases/er-crossroads-phase";
import { SelectBiomePhase } from "#phases/select-biome-phase";
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
    showText: (text: string, delay?: number | null, cb?: (() => void) | null, ...rest: unknown[]) => void;
  };
  const realSetMode = ui.setMode.bind(ui);
  const realShowText = ui.showText.bind(ui);
  const cap: UiCapture = {
    restore: () => {
      ui.setMode = realSetMode;
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
    showText: (text: string, delay?: number | null, cb?: (() => void) | null, ...rest: unknown[]) => void;
    getMode: () => number;
  };
  const realSetMode = ui.setMode.bind(ui);
  const realShowText = ui.showText.bind(ui);
  let cur = ui.getMode();
  ui.setMode = (mode: number): Promise<void> => {
    cur = mode;
    return Promise.resolve();
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
    resetCoopBiomePickerDrivenByTest();
    resetErBiomeStructure();
    setErPendingNodes([]);
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

  interface CrossroadsSeam {
    phaseName: string;
    start(): void;
    resolving: boolean;
  }

  /** Drive the OWNER crossroads: start (opens mocked OPTION_SELECT after the #858 boundary barrier), then
   *  press Stay(0)/Leave(1). The owner drives alone here, so its reciprocal boundary barrier resolves via
   *  the anti-hang timeout (setCoopRendezvousWaitMs(50)) - poll for the menu across it. */
  async function driveCrossroadsOwner(cap: UiCapture, moveOn: boolean): Promise<void> {
    const phase = new ErCrossroadsPhase();
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
    const phase = new ErCrossroadsPhase() as unknown as CrossroadsSeam;
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
    let ownerCap = installUiCapture(ownerCtx.scene);
    let watcherCap = installUiCapture(watcherCtx.scene);
    try {
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
    ownerCap = installUiCapture(ownerCtx.scene);
    watcherCap = installUiCapture(watcherCtx.scene);
    try {
      setCoopBiomeInteractionStart(pinAfterLeave); // the owner engine's chained pin
      await withClient(ownerCtx, async () => {
        const phase = new SelectBiomePhase();
        phase.start(); // reaches coopBiomePickOwner (ER_MAP mocked), beginSession("owner")
        expect(ownerCap.erMapConfig, "owner opened the real ER_MAP route picker").toBeDefined();
        ownerCap.erMapConfig!.onSelect(chosen); // owner picks VOLCANO -> relays + applies
        await drainLoopback();
      });
      setCoopBiomeInteractionStart(pinAfterLeave); // the watcher engine's own chained pin
      await withClient(watcherCtx, async () => {
        const phase = new SelectBiomePhase();
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
      ownerCap.restore();
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
  // SCENARIO 4: FALLBACK - a disconnected owner (relay times out) backstops to the SAME
  // deterministic roll both engines compute off the shared seed (cannot desync).
  // =====================================================================================
  it("FALLBACK: a timed-out owner pick backstops the watcher to the deterministic roll (no desync)", async () => {
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
    const { watcherCtx } = ownerCtxFor(rig, counterBefore);
    const watcherCounterBefore = watcherCtx.runtime.controller.interactionCounter();
    const switchSpy = vi.spyOn(watcherCtx.scene.phaseManager, "unshiftNew");

    // The watcher runs the biome pick alone; the owner never sends -> deterministic fallback.
    const cap = installUiCapture(watcherCtx.scene);
    let fallbackBiome: BiomeId | undefined;
    try {
      await withClient(watcherCtx, async () => {
        const phase = new SelectBiomePhase();
        phase.start();
        // #858: the watcher first crosses its natural-pick boundary barrier (owner absent -> anti-hang
        // timeout at setCoopRendezvousWaitMs(50)), THEN falls back on the mocked relay timeout - poll across.
        for (let i = 0; i < 80; i++) {
          await drainLoopback();
          fallbackBiome = switchSpy.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1] as BiomeId | undefined;
          if (fallbackBiome !== undefined) {
            return;
          }
        }
        throw new Error("fallback HANG: the watcher never resolved on timeout");
      });
    } finally {
      cap.restore();
    }

    // The fallback equals the SAME deterministic roll both engines compute off the just-reset shared seed.
    const deterministic = await withClient(watcherCtx, () => {
      watcherCtx.scene.resetSeed();
      return watcherCtx.scene.generateRandomBiome(12);
    });
    expect(fallbackBiome, "the watcher fell back to a biome (never hangs)").not.toBeUndefined();
    expect(fallbackBiome, "the fallback IS the deterministic shared-seed roll (cannot desync)").toBe(deterministic);
    // The counter still advances once on the engine that ran (the interaction terminates even on the
    // fallback path, so alternation never freezes). Only the watcher engine ran (owner "disconnected").
    expect(
      watcherCtx.runtime.controller.interactionCounter(),
      "the interaction still terminates (advances once) on fallback",
    ).toBe(watcherCounterBefore + 1);
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
  // down to MESSAGE, and applies the deterministic fallback biome (run proceeds).
  // =====================================================================================
  it("ORPHAN (#863): owner advances past the biome pick with NO relay -> watcher LEAVES the map + the run proceeds", async () => {
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
    const watcherCounterBefore = watcherCtx.runtime.controller.interactionCounter();

    // The OWNER commits + moves on WITHOUT relaying a biomePick: advance the shared interaction counter and
    // broadcast it. The watcher receives ONLY this advance (never a pick) - the exact one-sided orphan.
    withClientSync(ownerCtx, () => ownerCtx.runtime.controller.advanceInteraction(counterBefore));
    await drainLoopback();

    try {
      await withClient(watcherCtx, async () => {
        setCoopBiomeInteractionStart(counterBefore); // chained pin -> the watcher takes coopBiomePickWatch
        const phase = new SelectBiomePhase();
        phase.start();
        for (let i = 0; i < 200; i++) {
          await drainLoopback();
          if (watcherTracker.mode() !== UiMode.ER_MAP && switchSpy.mock.calls.some(c => c[0] === "SwitchBiomePhase")) {
            return;
          }
        }
        throw new Error(
          "biome pick ORPHAN HANG: the watcher never left ER_MAP - it is stuck on the 20-min relay timeout (#863 fails-before)",
        );
      });
    } finally {
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
      "the run PROCEEDS: the watcher queued SwitchBiomePhase (deterministic fallback biome) (#863)",
    ).toBe(true);
    // The interaction terminates on the watcher (advances once), so alternation never freezes.
    expect(
      watcherCtx.runtime.controller.interactionCounter(),
      "the interaction terminates (advances once) on the orphan dismiss",
    ).toBe(watcherCounterBefore + 1);
    logs.flush();
  }, 300_000);
});
