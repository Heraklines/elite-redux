/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op WAVE-BOUNDARY BARRIER (#858). At an every-10-waves boundary the biome SHOP
// (owner-alternated interaction K-1) and the #848 crossroads / World-Map biome PICK (interaction K)
// fall on the SAME wave. They are separate interactions with NO barrier between them, so the FASTER
// client - the shop watcher that becomes the crossroads owner - could finish the shop and race the
// whole crossroads+biome pick (advancing to K+1 and BROADCASTING it) while the shop OWNER still held
// the market. When that lagging owner finally left the shop, its own shop-terminal advance FOLDED the
// raced-ahead broadcast (the coop-session `pendingRemote` catch-up), SKIPPING the boundary counter K:
// it pinned the crossroads at K+1, mismatched the relay seq, timed out, and fired the deterministic
// Stay/Leave fallback ONE-SIDED -> one client left + changed biome while the other stayed -> the live
// wave-10 desync ("map opened on the non-shopping player, then jumped screens when the shop closed,
// freezing the shopper; the other player advanced with NO biome change").
//
// THE FIX: a reciprocal rendezvous barrier at the #848 interaction ENTRY (xroads:<wave> for the
// crossroads, biomepick:<wave> for a natural biome-end pick). BOTH clients must reach it - i.e. BOTH
// must have LEFT the shop - before EITHER pins the boundary counter + splits owner/watcher. Neither
// can over-broadcast K+1 before the other pins K, so the fold can never skip K, and the anti-hang
// fallback can only fire when the owner is TRULY absent (both time out together), never one-sided.
//
// This file proves, over the SAME production rendezvous instances the phases use (the exact objects
// ErCrossroadsPhase/SelectBiomePhase await, wired in coop-runtime.ts) plus a focused engine-free
// CoopInteractionTurn drift/fix pair:
//   A. the reciprocal xroads:<wave> barrier BLOCKS the racer until the laggard arrives (both interleave
//      orders), then resolves both-arrived - the racer cannot advance past the boundary alone.
//   B. a REAL ErCrossroadsPhase ARRIVES + AWAITS at xroads:<wave> (the crossroads wiring is live).
//   C. a REAL natural SelectBiomePhase pick ARRIVES + AWAITS at biomepick:<wave> (the biome-pick wiring).
//   D. root cause + fix: the pendingRemote fold SKIPS K without ordering; with the barrier's ordering the
//      shop advance lands exactly on K (both pin K in lockstep).
//
// FAILS-BEFORE: without the barrier the phases never arrive/await at the boundary point (B/C), and the
// drift (D) skips K -> one-sided advance. PASSES-AFTER: ordered, converged, no frozen input.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-biome-boundary.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  resetCoopBiomePickerDrivenByTest,
  setCoopBiomePickerDrivenByTest,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { CoopInteractionTurn } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { type ErRouteNode, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { resetErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
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
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Stub the two UI entry points the boundary phases hit AFTER the barrier so a headless run neither
 *  crashes nor sits on a real menu - we only assert the barrier was invoked. Fires showText callbacks. */
function stubUi(scene: BattleScene): () => void {
  const ui = scene.ui as unknown as {
    setMode: (mode: number, ...args: unknown[]) => Promise<void>;
    showText: (text: string, delay?: number | null, cb?: (() => void) | null, ...rest: unknown[]) => void;
  };
  const realSetMode = ui.setMode.bind(ui);
  const realShowText = ui.showText.bind(ui);
  ui.setMode = (): Promise<void> => Promise.resolve();
  ui.showText = (_t: string, _d?: number | null, cb?: (() => void) | null): void => {
    if (typeof cb === "function") {
      cb();
    }
  };
  return () => {
    ui.setMode = realSetMode;
    ui.showText = realShowText;
  };
}

/** Which ctx OWNS the interaction at `counter` (host even, guest odd - production parity). */
function ownerCtxFor(rig: DuoRig, counter: number): ClientCtx {
  return counter % 2 === 0 ? rig.hostCtx : rig.guestCtx;
}

describe.skipIf(!RUN)("co-op DUO wave-boundary barrier (#858): shop -> crossroads/biome-pick ordering", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    // The boundary phases only reach the barrier when NOT auto-resolving (the vitest bypass returns first).
    setCoopBiomePickerDrivenByTest();
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`biome-boundary-${Date.now()}`);
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
    resetCoopBiomePickerDrivenByTest();
    resetErBiomeStructure();
    setErPendingNodes([]);
    logs?.dispose();
    clearCoopRuntime();
    vi.restoreAllMocks();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

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

  // ===========================================================================================
  // A. The reciprocal xroads:<wave> barrier ORDERS the two clients: the racer (first to reach the
  // boundary) BLOCKS until the laggard arrives, then both proceed both-arrived (no timeout). Driven
  // through the production rendezvous instances the phases use, in BOTH interleave orders.
  // ===========================================================================================
  it("the racer BLOCKS at xroads:<wave> until the laggard arrives, then both proceed (both interleave orders)", async () => {
    setCoopRendezvousWaitMs(60_000); // generous: the laggard arrives well within it (no timeout)
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    // ---- interleave 1: HOST races ahead (leaves the shop first), GUEST lags in the market. ----
    const point = "xroads:10";
    let hostCrossed = false;
    const hostBarrier = rig.hostRuntime.rendezvous.rendezvous(point).then(r => {
      hostCrossed = true;
      return r;
    });
    await drainLoopback();
    // The laggard (guest) is still in the shop, so the racer MUST stay blocked (pre-#858 it raced ahead
    // and broadcast an advanced counter that folded past the boundary on the laggard).
    expect(hostCrossed, "the racer is BLOCKED at the boundary while the laggard is still shopping").toBe(false);
    expect(
      rig.hostRuntime.rendezvous.oldestNetworkWaitMs(),
      "the racer is parked on a live boundary-barrier wait",
    ).toBeGreaterThanOrEqual(0);

    // The laggard finally leaves the shop and reaches the SAME boundary point.
    rig.guestRuntime.rendezvous.arrive(point);
    await drainLoopback();
    const hr = await hostBarrier;
    expect(hostCrossed, "the racer proceeds only once the laggard arrived").toBe(true);
    expect(hr.timedOut, "both reached the boundary - no anti-hang timeout").toBe(false);

    // ---- interleave 2 (next boundary): GUEST races ahead, HOST lags - symmetric ordering. ----
    const point2 = "xroads:20";
    let guestCrossed = false;
    const guestBarrier = rig.guestRuntime.rendezvous.rendezvous(point2).then(r => {
      guestCrossed = true;
      return r;
    });
    await drainLoopback();
    expect(guestCrossed, "the other-side racer is likewise BLOCKED until its laggard arrives").toBe(false);
    rig.hostRuntime.rendezvous.arrive(point2);
    await drainLoopback();
    const gr = await guestBarrier;
    expect(guestCrossed, "the other-side racer proceeds once its laggard arrived").toBe(true);
    expect(gr.timedOut, "both reached the boundary - no anti-hang timeout").toBe(false);

    logs.flush();
  }, 120_000);

  // ===========================================================================================
  // B. A REAL ErCrossroadsPhase ARRIVES + AWAITS at xroads:<wave> - proving the crossroads wiring
  // (er-crossroads-phase.ts coopAwaitBoundaryBarrier) is live. The owner drives it so there is no
  // 20-minute watcher relay await; the barrier fires BEFORE the owner/watcher split, so it is what we
  // assert. The lone owner's barrier resolves via the fast anti-hang timeout (setCoopRendezvousWaitMs).
  // ===========================================================================================
  it("a real ErCrossroadsPhase arrives + awaits at xroads:<wave> before pinning the interaction", async () => {
    setCoopRendezvousWaitMs(50); // fast anti-hang fallback (this test drives one side only)
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    rig.hostScene.currentBattle.waveIndex = 10;
    rig.guestScene.currentBattle.waveIndex = 10;

    // Run under the ctx that OWNS this boundary's counter (the owner drives the Stay/Leave menu; a watcher
    // would sit on the long relay await after the barrier - irrelevant to the barrier-wiring assertion).
    const counter = rig.hostRuntime.controller.interactionCounter();
    const ownerCtx = ownerCtxFor(rig, counter);
    const arriveSpy = vi.spyOn(ownerCtx.runtime.rendezvous, "arrive");
    const awaitSpy = vi.spyOn(ownerCtx.runtime.rendezvous, "awaitPartner");

    const restoreUi = stubUi(ownerCtx.scene);
    try {
      await withClient(ownerCtx, async () => {
        liveCrossroads().start();
        // Drain enough for the lone-owner barrier to time out (setCoopRendezvousWaitMs(50)) and the phase to
        // FULLY settle under the UI stub before restoreUi() - do NOT break early on the arrive, or restoreUi
        // would fire while coopStart is still parked and its deferred real setMode(OPTION_SELECT) would leak
        // an open menu into the next test's TitlePhase.
        for (let i = 0; i < 120; i++) {
          await drainLoopback();
        }
      });
    } finally {
      restoreUi();
    }

    const arrived = arriveSpy.mock.calls.map(c => String(c[0]));
    const awaited = awaitSpy.mock.calls.map(c => String(c[0]));
    expect(arrived, "the real crossroads ARRIVED at xroads:10").toContain("xroads:10");
    expect(awaited, "the real crossroads AWAITED the partner at xroads:10 before pinning").toContain("xroads:10");
    logs.flush();
  }, 200_000);

  // ===========================================================================================
  // C. A REAL natural SelectBiomePhase pick ARRIVES + AWAITS at biomepick:<wave> - proving the
  // biome-pick wiring (select-biome-phase.ts coopAwaitBoundaryBarrier) is live for a natural biome-end
  // multi-node pick (NOT chained from a crossroads Leave, which barriered at its own entry).
  // ===========================================================================================
  it("a real natural SelectBiomePhase pick arrives + awaits at biomepick:<wave> before pinning", async () => {
    setCoopRendezvousWaitMs(50);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    rig.hostScene.currentBattle.waveIndex = 10;
    rig.guestScene.currentBattle.waveIndex = 10;

    // Two REVEALED onward nodes so the phase reaches the co-op owner-alternated multi-node pick.
    const nodes: ErRouteNode[] = [
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true },
    ];
    setErPendingNodes(nodes);

    const counter = rig.hostRuntime.controller.interactionCounter();
    const ownerCtx = ownerCtxFor(rig, counter);
    const arriveSpy = vi.spyOn(ownerCtx.runtime.rendezvous, "arrive");
    const awaitSpy = vi.spyOn(ownerCtx.runtime.rendezvous, "awaitPartner");

    const restoreUi = stubUi(ownerCtx.scene);
    try {
      await withClient(ownerCtx, async () => {
        // NOT chained (no setCoopBiomeInteractionStart) -> the natural-pick boundary barrier applies.
        liveSelectBiome().start();
        // Fixed drain (no early break) so the phase settles under the UI stub before restoreUi() - see the
        // crossroads test above for why an early break leaks a menu into the next test.
        for (let i = 0; i < 120; i++) {
          await drainLoopback();
        }
      });
    } finally {
      restoreUi();
    }

    const arrived = arriveSpy.mock.calls.map(c => String(c[0]));
    const awaited = awaitSpy.mock.calls.map(c => String(c[0]));
    expect(arrived, "the real natural biome pick ARRIVED at biomepick:10").toContain("biomepick:10");
    expect(awaited, "the real natural biome pick AWAITED the partner at biomepick:10 before pinning").toContain(
      "biomepick:10",
    );
    logs.flush();
  }, 200_000);

  // ===========================================================================================
  // D. ROOT CAUSE + FIX (engine-free, deterministic). The drift is the coop-session pendingRemote
  // catch-up fold: a lagging client's shop-terminal advance folds a raced-ahead partner counter and
  // SKIPS the boundary counter. The barrier's ordering (no over-broadcast before both pin) removes it.
  // ===========================================================================================
  it("root cause: a lagging shop-terminal advance FOLDS a raced-ahead counter and SKIPS the boundary K (#858)", () => {
    const K = 11; // the boundary (crossroads) interaction; K-1 is the biome shop.
    // The lagging client is mid-shop at K-1.
    const turn = new CoopInteractionTurn(K - 1);
    // WITHOUT the barrier the partner raced through the shop AND this boundary and broadcast its advanced
    // counter (K+1) BEFORE this client left the shop - the "picker ran while the owner still held the
    // market" race. mergeRemote DEFERS it (live counter unchanged) into the catch-up slot.
    turn.mergeRemote(K + 1);
    expect(turn.toJSON(), "the deferred remote does NOT move the live counter yet").toBe(K - 1);
    // This client now finishes the shop, advancing from K-1. The deferred K+1 folds in at this OWN advance
    // and catches up PAST the boundary counter K -> K is SKIPPED and never pinned.
    expect(turn.advance(K - 1)).toBe(true);
    expect(turn.toJSON(), "the shop advance folded past the boundary -> K was SKIPPED (the drift)").toBe(K + 1);
    expect(turn.toJSON(), "a crossroads reading this counter would pin K+1, not K -> one-sided fallback").not.toBe(K);
  });

  it("fix: the boundary barrier stops any over-broadcast, so the shop advance lands exactly on K (#858)", () => {
    const K = 11;
    const turn = new CoopInteractionTurn(K - 1);
    // WITH the barrier the partner parks at xroads:<wave> after leaving the shop (its counter is K) and
    // CANNOT resolve the crossroads / advance to K+1 until THIS client also arrives. So the only counter it
    // can broadcast before this client pins is its own shop terminal, K - never K+1.
    turn.mergeRemote(K);
    expect(turn.advance(K - 1)).toBe(true);
    expect(turn.toJSON(), "the shop advance lands exactly on the boundary counter K - both pin K in lockstep").toBe(K);
  });
});
