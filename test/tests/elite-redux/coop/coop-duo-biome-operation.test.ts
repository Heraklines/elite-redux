/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op BIOME TRAVEL through the AUTHORITATIVE OPERATION PRIMITIVE
// (Wave-2a run-state migration; docs/plans/2026-07-10-coop-authoritative-run-state-migration.md
// §2.5 item 1, §5.1). The migrated path proof obligation (§5.3):
//
//   1. END-TO-END (flag ON): the OWNER travels a biome; the WATCHER adopts it THROUGH the
//      operation primitive (host commits the typed intent, watcher gates + applies it). Both
//      real engines land in the SAME biome - the migrated successor of the #864 owner funnel.
//   2. ADVERSARIAL (#861 shape): a STALE buffered pick from a PREVIOUS operation, arriving at
//      the watcher after a newer interaction already resolved, is REJECTED - never applied. The
//      watcher's biome is NOT overwritten by the leftover. This is the exactly-once / late-
//      rejection guarantee the operation model buys structurally (invariants 5, 6, §1.6), which
//      the legacy seq-blind await could not (the stale pick could satisfy a live await).
//
// The adversarial rejection is ITSELF proof the primitive is active: with the flag OFF the
// watcher would adopt the stale relay verbatim (legacy pass-through). The companion suite
// coop-duo-biome-choice / coop-duo-biome-boundary prove the surface stays green under BOTH
// flag states; this suite proves the NEW behavior the flag turns on.
//
// HOW TO RUN (gated ER_SCENARIO=1):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-biome-operation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  adoptBiomeWatcherChoice,
  captureCoopBiomeOperationBinding,
  isCoopBiomeOperationEnabled,
  resetCoopBiomeOperationFlag,
  resetCoopBiomeOperationState,
  setCoopBiomeOperationEnabled,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
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
import { setCoopOperationDurability } from "#data/elite-redux/coop/coop-operation-journal";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_BIOME_PICK_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { type ErRouteNode, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { resetErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import { resetErMapNodes } from "#data/elite-redux/er-map-nodes";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
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
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into co-op mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Headless UI capture: swallow setMode, fire showText callbacks (the biome phases open ER_MAP / show text). */
function installUiCapture(scene: BattleScene): { restore: () => void } {
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
  return {
    restore: () => {
      ui.setMode = realSetMode;
      ui.showText = realShowText;
    },
  };
}

describe.skipIf(!RUN)("co-op DUO biome travel via the operation primitive (Wave-2a)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    setCoopRendezvousWaitMs(50);
    setCoopOrphanGraceMs(20);
    // DRIVE the real crossroads / World-Map picker (opt out of the vitest owner auto-resolve), so the owner
    // opens the real terminal + relays. Reset in afterEach (anti-latch).
    setCoopBiomePickerDrivenByTest();
    // Explicitly select the MIGRATED path and start from clean operation state (no leftover from a prior file).
    setCoopBiomeOperationEnabled(true);
    resetCoopBiomeOperationState();
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`biome-op-${Date.now()}`);
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
    resetCoopBiomeOperationFlag();
    resetCoopBiomeOperationState();
    resetErBiomeStructure();
    setErPendingNodes([]);
    resetErMapNodes();
    logs.dispose();
    clearCoopRuntime();
    vi.restoreAllMocks();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  function liveSelectBiome(): SelectBiomePhase {
    const phase = new SelectBiomePhase();
    (phase as unknown as { boundaryStillLive(generation: number, wave: number): boolean }).boundaryStillLive = () =>
      true;
    return phase;
  }

  /** Which ctx OWNS the interaction at `counter` (host even, guest odd - production parity). */
  function rolesFor(
    rig: DuoRig,
    counter: number,
  ): { ownerCtx: ClientCtx; watcherCtx: ClientCtx; watcherRole: "host" | "guest" } {
    const hostOwns = counter % 2 === 0;
    return hostOwns
      ? { ownerCtx: rig.hostCtx, watcherCtx: rig.guestCtx, watcherRole: "guest" }
      : { ownerCtx: rig.guestCtx, watcherCtx: rig.hostCtx, watcherRole: "host" };
  }

  const biomeArg = (spy: ReturnType<typeof vi.spyOn>): BiomeId | undefined =>
    spy.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1] as BiomeId | undefined;

  // =====================================================================================
  // END-TO-END + ADVERSARIAL: the migrated biome pick converges through the primitive, and a
  // stale buffered pick from a previous op is rejected.
  // =====================================================================================
  it("END-TO-END: owner travels, watcher ADOPTS through the primitive; a STALE previous-op pick is REJECTED (#861 shape)", async () => {
    expect(isCoopBiomeOperationEnabled(), "the migrated biome-operation path is active for this test").toBe(true);

    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    rig.hostScene.currentBattle.waveIndex = 11;
    rig.guestScene.currentBattle.waveIndex = 11;

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const { ownerCtx, watcherCtx, watcherRole } = rolesFor(rig, counterBefore);
    const ownerBiome = BiomeId.VOLCANO;

    const sendSpy = vi.spyOn(CoopInteractionRelay.prototype, "sendInteractionChoice");
    const guestSwitch = vi.spyOn(watcherCtx.scene.phaseManager, "unshiftNew");

    // ===== OWNER: a chained crossroads-Leave that resolves to a SINGLE revealed node (deterministic
    // terminal, never opens the picker). It relays the biome AND commits the typed intent (dual-run). =====
    const ownerCap = installUiCapture(ownerCtx.scene);
    try {
      setErPendingNodes([{ biome: ownerBiome, revealed: true } satisfies ErRouteNode]);
      await withClient(ownerCtx, async () => {
        setCoopBiomeInteractionStart(counterBefore);
        liveSelectBiome().start();
        await drainLoopback();
      });
    } finally {
      ownerCap.restore();
    }
    const ownerBiomePickSends = sendSpy.mock.calls.filter(c => c[1] === "biomePick");
    expect(ownerBiomePickSends.length, "the owner relayed its biome (dual-run legacy path still fires)").toBe(1);

    // ===== WATCHER: divergent-state boundary (MULTIPLE nodes) -> opens the mirrored map, awaits the owner's
    // relay, and ADOPTS it THROUGH the operation primitive (adoptBiomeWatcherChoice gate). =====
    const watcherCap = installUiCapture(watcherCtx.scene);
    try {
      setErPendingNodes([
        { biome: BiomeId.FOREST, revealed: true },
        { biome: ownerBiome, revealed: true },
      ] satisfies ErRouteNode[]);
      await withClient(watcherCtx, async () => {
        setCoopBiomeInteractionStart(counterBefore);
        liveSelectBiome().start();
        for (let i = 0; i < 80; i++) {
          await drainLoopback();
          if (biomeArg(guestSwitch) !== undefined) {
            return;
          }
        }
        throw new Error("biome pick WATCH HANG: the watcher never adopted the owner's biome through the primitive");
      });
    } finally {
      watcherCap.restore();
    }

    // THE CONVERGENCE: the watcher adopted the owner's biome verbatim through the migrated primitive.
    expect(biomeArg(guestSwitch), "the watcher adopts the owner's biome through the operation primitive").toBe(
      ownerBiome,
    );
    // sanity: keep the watcher role referenced (host-owned even counter -> guest watches).
    expect(watcherRole === "host" || watcherRole === "guest").toBe(true);

    // ===== ADVERSARIAL (#861 shape): drive the watcher gate over a controlled sequence of interactions to
    // prove a STALE buffered pick from a PREVIOUS operation can NEVER overwrite a newer one (invariant 6),
    // and a duplicate re-delivery is a no-op (invariant 5). With the flag OFF every one of these would adopt
    // verbatim (legacy pass-through), so the rejections are proof the primitive is gating adoption. =====
    await withClient(watcherCtx, () => {
      resetCoopBiomeOperationState();
      // This sub-proof exercises the pure adapter directly against the WATCHER runtime's own state, outside a
      // transport/journal delivery. The production legs above/below prove durable routing separately.
      setCoopOperationDurability(null);
      const HOST_OWNED_LATER = 4; // even counter -> host owns, guest watches
      const HOST_OWNED_EARLIER = 2; // an EARLIER interaction (also host-owned)

      // A fresh, newer interaction resolves on the watcher first.
      const fresh = adoptBiomeWatcherChoice({
        kind: "BIOME_PICK",
        seq: COOP_BIOME_PICK_SEQ_BASE + HOST_OWNED_LATER,
        pinned: HOST_OWNED_LATER,
        res: { choice: 0, data: [BiomeId.VOLCANO] },
        localRole: "guest",
        wave: 11,
        turn: 0,
        sourceBiomeId: BiomeId.PLAINS,
        nextWave: 12,
        allowedRoutes: [BiomeId.VOLCANO],
        deterministicDestination: null,
      });
      expect(fresh.adopt, "the newer interaction's pick is adopted").toBe(true);

      // The STALE pick from the EARLIER operation now arrives late - it must be REJECTED, not applied.
      const stale = adoptBiomeWatcherChoice({
        kind: "BIOME_PICK",
        seq: COOP_BIOME_PICK_SEQ_BASE + HOST_OWNED_EARLIER,
        pinned: HOST_OWNED_EARLIER,
        res: { choice: 0, data: [BiomeId.SWAMP] }, // a DIFFERENT biome
        localRole: "guest",
        wave: 11,
        turn: 0,
        sourceBiomeId: BiomeId.PLAINS,
        nextWave: 12,
        allowedRoutes: [BiomeId.SWAMP],
        deterministicDestination: null,
      });
      expect(stale.adopt, "the stale previous-op pick is REJECTED, not applied (#861 shape)").toBe(false);
      if (stale.adopt === false) {
        expect(stale.reason).toBe("stale-or-duplicate");
      }

      // A DUPLICATE re-delivery of the already-applied newer interaction is also a no-op (idempotency).
      const dup = adoptBiomeWatcherChoice({
        kind: "BIOME_PICK",
        seq: COOP_BIOME_PICK_SEQ_BASE + HOST_OWNED_LATER,
        pinned: HOST_OWNED_LATER,
        res: { choice: 0, data: [BiomeId.VOLCANO] },
        localRole: "guest",
        wave: 11,
        turn: 0,
        sourceBiomeId: BiomeId.PLAINS,
        nextWave: 12,
        allowedRoutes: [BiomeId.VOLCANO],
        deterministicDestination: null,
      });
      expect(dup.adopt, "a duplicate re-delivery of an already-applied op is a no-op (invariant 5)").toBe(false);
    });

    logs.flush();
  }, 300_000);

  it("keeps reciprocal watcher cursors isolated and rejects a role-mismatched captured runtime", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    const hostBinding = await withClient(rig.hostCtx, () => {
      setCoopOperationDurability(null);
      return captureCoopBiomeOperationBinding();
    });
    const guestBinding = await withClient(rig.guestCtx, () => {
      setCoopOperationDurability(null);
      return captureCoopBiomeOperationBinding();
    });

    const decision = (pinned: number, localRole: "host" | "guest", biomeId: BiomeId, binding: typeof hostBinding) =>
      adoptBiomeWatcherChoice(
        {
          kind: "BIOME_PICK",
          seq: COOP_BIOME_PICK_SEQ_BASE + pinned,
          pinned,
          res: { choice: 0, data: [biomeId] },
          localRole,
          wave: 11,
          turn: 0,
          sourceBiomeId: BiomeId.PLAINS,
          nextWave: 12,
          allowedRoutes: [biomeId],
          deterministicDestination: null,
        },
        binding,
      );

    expect(decision(5, "host", BiomeId.SWAMP, hostBinding).adopt).toBe(true);
    expect(
      decision(2, "guest", BiomeId.VOLCANO, guestBinding).adopt,
      "the host watcher's later pin cannot make the guest runtime reject its own earlier valid pin",
    ).toBe(true);
    expect(
      () => decision(7, "host", BiomeId.LAKE, guestBinding),
      "a callback cannot execute host authority against a captured guest runtime",
    ).toThrow(/binding role=guest.*localRole=host/);
  });

  it("DURABILITY: dropping only biomePick still materializes the committed op through the real guest travel path", async () => {
    expect(isCoopBiomeOperationEnabled(), "the migrated biome-operation path is active for this test").toBe(true);

    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "biomePick",
      },
      { seed: 0xb10e },
    );
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    rig.hostScene.currentBattle.waveIndex = 11;
    rig.guestScene.currentBattle.waveIndex = 11;

    const pinned = rig.hostRuntime.controller.interactionCounter();
    expect(pinned % 2, "this leg requires the host to own the biome interaction").toBe(0);
    const ownerBiome = BiomeId.VOLCANO;
    const fallbackBiome = BiomeId.SWAMP;
    const guestSwitch = vi.spyOn(rig.guestScene.phaseManager, "unshiftNew");
    vi.spyOn(rig.guestScene, "generateRandomBiome").mockReturnValue(fallbackBiome);

    const ownerCap = installUiCapture(rig.hostScene);
    try {
      setErPendingNodes([{ biome: ownerBiome, revealed: true } satisfies ErRouteNode]);
      await withClient(rig.hostCtx, async () => {
        setCoopBiomeInteractionStart(pinned);
        liveSelectBiome().start();
        await drainLoopback();
      });
    } finally {
      ownerCap.restore();
    }
    expect(pair.faultsInjected(), "the legacy biomePick relay must actually be dropped").toBeGreaterThan(0);

    const watcherCap = installUiCapture(rig.guestScene);
    try {
      setErPendingNodes([
        { biome: fallbackBiome, revealed: true },
        { biome: ownerBiome, revealed: true },
      ] satisfies ErRouteNode[]);
      await withClient(rig.guestCtx, async () => {
        setCoopBiomeInteractionStart(pinned);
        liveSelectBiome().start();
        for (let i = 0; i < 80; i++) {
          await drainLoopback();
          if (biomeArg(guestSwitch) !== undefined) {
            return;
          }
        }
        throw new Error("durable biome op did not wake the guest's real SelectBiomePhase");
      });
    } finally {
      watcherCap.restore();
    }

    expect(
      biomeArg(guestSwitch),
      "the journal-delivered committed op, not the dropped legacy relay or deterministic fallback, drives travel",
    ).toBe(ownerBiome);
    expect(biomeArg(guestSwitch)).not.toBe(fallbackBiome);
    logs.flush();
  }, 300_000);
});
