/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Production-path T2: one two-engine wave-10 battle followed by explicitly sought real phase/UI segments
// (this is not an untouched queue proof) -> fixed reward popups -> biome market
// -> Crossroads -> (Leave: real World Map pick + committed SwitchBiome/NewBiomeEncounter) -> wave 11.
// No relay injection, direct phase terminal, remirror, or manual rendezvous arrival is permitted here.

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  captureCoopChecksum,
  captureCoopChecksumState,
  captureCoopSaveDataNormalized,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  commitAuthoritativeBiomeTransition,
  coopAuthoritativeBiomeTransitionOperationId,
  resetCoopBiomeCommitWaitMs,
} from "#data/elite-redux/coop/coop-biome-operation";
import {
  resetCoopBiomePickerDrivenByTest,
  setCoopBiomePickerDrivenByTest,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { CoopInteractionRelay, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { makeCoopOperationId, parseCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import {
  adoptCoopBiomeTransitionSwitchPermit,
  armCoopBiomeTransitionTailPermit,
  clearCoopBiomeTransitionTailPermit,
  consumeCoopBiomeTransitionEncounterPermit,
  getCoopBiomeTransitionTailPermit,
  getCoopRendererNeutralizedLog,
  getCoopTailWouldBlockLog,
  getObservedCoopGuestPhases,
  markCoopBiomeTransitionHistoryRecorded,
  markCoopBiomeTransitionSwitchPrepared,
  resetCoopRendererNeutralizedLog,
  resetCoopTailWouldBlockLog,
  resetObservedCoopGuestPhases,
  setCoopWaveTailSanction,
} from "#data/elite-redux/coop/coop-renderer-gate";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, getCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { getCoopStagedWaveAdvanceTransaction } from "#data/elite-redux/coop/coop-wave-operation";
import {
  type ErRouteNode,
  getErPendingNodes,
  markErPendingNodesAwaitingAuthority,
  setErPendingNodes,
} from "#data/elite-redux/er-biome-routing";
import { resetErBiomeStructure, restoreErBiomeStructure } from "#data/elite-redux/er-biome-structure";
import {
  getErMapSaveData,
  getMapTravelTarget,
  resetErMapNodes,
  setMapTravelTarget,
} from "#data/elite-redux/er-map-nodes";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { BattleSceneEventType } from "#events/battle-scene";
import { BiomeShopPhase, setCoopBiomeMarketTestSkip } from "#phases/biome-shop-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { ErCrossroadsPhase } from "#phases/er-crossroads-phase";
import { NewBiomeEncounterPhase } from "#phases/new-biome-encounter-phase";
import { SelectBiomePhase } from "#phases/select-biome-phase";
import { SwitchBiomePhase } from "#phases/switch-biome-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type ClientCtx,
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  setCoopHarnessModuleLetIsolation,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

async function pumpBoth(rig: DuoRig, rounds = 1): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await withClient(rig.hostCtx, () => drainLoopback());
    await withClient(rig.guestCtx, () => drainLoopback());
  }
}

async function waitForMode(ctx: ClientCtx, mode: UiMode, label: string): Promise<void> {
  // Every authoritative transition below opens its target directly through setModeBoundedWhen. In the
  // headless renderer the fade tween may never tick, so allow the production 2s force-path to complete.
  // Keep the destination engine installed while its local timer/tween callbacks run, matching separate
  // browser processes. Alternating the ambient harness client during this local-only settle can falsely
  // supersede the exact receiver's immutable phase fence.
  await withClient(ctx, async () => {
    for (let i = 0; i < 320; i++) {
      if (ctx.scene.ui.getMode() === mode) {
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`${label} never opened ${UiMode[mode]} (stuck on ${UiMode[ctx.scene.ui.getMode()]})`);
  });
}

async function pressUntilAccepted(rig: DuoRig, ctx: ClientCtx, button: Button, label: string): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const accepted = await withClient(ctx, () => ctx.scene.ui.processInput(button));
    await pumpBoth(rig);
    if (accepted) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${label} never accepted ${Button[button]}`);
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function installHeadlessPlayerAtlasCompletion(scene: BattleScene): {
  productionLoadsCompleted(): number;
  restore(): void;
} {
  // The shared HEADLESS fixture deliberately replaces Phaser's atlas population and Sprite.play effects
  // with no-ops. Model only those missing cache/live-key effects after the real production loader resolves;
  // the transition still awaits Pokemon.loadAssets(false) and still exercises every fail-closed production
  // presentation assertion before command continuation can open.
  // buildDuo owns the one scene-level cache model. This helper counts production player loads only;
  // wrapping the already-spied cache methods again creates a self-recursive Vitest mock.
  let productionLoadsCompleted = 0;
  const assetLoads = scene.getPlayerParty().map(pokemon => {
    const original = pokemon.loadAssets.bind(pokemon);
    return vi.spyOn(pokemon, "loadAssets").mockImplementation(async (ignoreOverride = true, useIllusion = false) => {
      await original(ignoreOverride, useIllusion);
      const key = pokemon.getBattleSpriteKey();
      const sprite = pokemon.getSprite() as unknown as
        | {
            texture?: { key: string };
            anims?: { currentAnim?: { key: string } };
          }
        | undefined;
      if (sprite?.texture) {
        sprite.texture.key = key;
      }
      if (sprite?.anims) {
        sprite.anims.currentAnim = { key };
      }
      if (!ignoreOverride) {
        productionLoadsCompleted++;
      }
    });
  });

  return {
    productionLoadsCompleted: () => productionLoadsCompleted,
    restore: () => {
      for (const assetLoad of assetLoads) {
        assetLoad.mockRestore();
      }
    },
  };
}

const OPERATION_SURFACES = [
  "ability",
  "bargain",
  "biome",
  "catchFull",
  "colosseum",
  "faintSwitch",
  "learnMove",
  "me",
  "revival",
  "reward",
  "stormglass",
  "wave",
] as const;

function expectOperationSurfaceEpochs(runtime: DuoRig["hostRuntime"], expectedEpoch: number, label: string): void {
  for (const surface of OPERATION_SURFACES) {
    const state = runtime.opState.surfaces.get(surface) as { epoch?: unknown } | undefined;
    expect(state, `${label} owns a ${surface} runtime record`).toBeDefined();
    expect(state?.epoch, `${label} ${surface} epoch is scoped to its destination runtime`).toBe(expectedEpoch);
  }
}

describe.skipIf(!RUN)("T2 segmented production-path co-op wave-10 biome transition", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  const syntheticBoundaries = new Set<{ live: boolean }>();

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopHarnessModuleLetIsolation(true);
    setCoopBiomePickerDrivenByTest();
    setCoopWaveBarrierMs(10_000);
    setCoopRendezvousWaitMs(10_000);
    resetCoopRendererNeutralizedLog();
    resetCoopTailWouldBlockLog();
    resetObservedCoopGuestPhases();
    setCoopWaveTailSanction(null);
    game = new GameManager(phaserGame);
    // GameManager deliberately defaults legacy co-op tests to skipping the x0 market. This journey
    // owns the real queued market/UI boundary, so opt back in only after that constructor default runs.
    setCoopBiomeMarketTestSkip(false);
    logs = installDuoLogCapture(`transition-t2-biome-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(10)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    // Direct fault probes intentionally hold a synthetic phase at one boundary. Fence every retained UI
    // callback before test teardown so a parked mismatch cannot retry in the next test's scene/runtime.
    for (const boundary of syntheticBoundaries) {
      boundary.live = false;
    }
    syntheticBoundaries.clear();
    setCoopBiomeMarketTestSkip(true);
    resetCoopBiomePickerDrivenByTest();
    setCoopWaveBarrierMs(60_000);
    setCoopHarnessModuleLetIsolation(false);
    resetCoopRendezvousWaitMs();
    resetCoopBiomeCommitWaitMs();
    setCoopWaveTailSanction(null);
    clearCoopBiomeTransitionTailPermit();
    resetErBiomeStructure();
    setErPendingNodes([]);
    resetErMapNodes();
    logs?.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best effort
  });

  /** Direct fault/permit probes bypass the queue only after explicitly installing a live-boundary seam. */
  function liveSwitch(nextBiome: BiomeId): SwitchBiomePhase {
    const phase = new SwitchBiomePhase(nextBiome);
    const boundary = { live: true };
    syntheticBoundaries.add(boundary);
    (phase as unknown as { coopBoundaryStillLive(): boolean }).coopBoundaryStillLive = () => boundary.live;
    return phase;
  }

  function liveNewBiome(): NewBiomeEncounterPhase {
    const phase = new NewBiomeEncounterPhase();
    const boundary = { live: true };
    syntheticBoundaries.add(boundary);
    (phase as unknown as { coopBoundaryStillLive(requirePermit?: boolean): boolean }).coopBoundaryStillLive = () =>
      boundary.live;
    return phase;
  }

  async function driveGuestCommandUi(rig: DuoRig): Promise<void> {
    const guestCommand = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "guest-owned CommandPhase", {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
      }),
    );
    await withClient(rig.guestCtx, async () => {
      guestCommand.start();
      await drainLoopback();
    });
    await withClient(rig.hostCtx, async () => {
      // The launch CommandPhase pre-dates the runtime; re-enter the same phase so both real rendezvous arms fire.
      rig.hostScene.phaseManager.getCurrentPhase().start();
      await drainLoopback();
    });
    await withClient(rig.guestCtx, async () => {
      await drainLoopback();
      expect(rig.guestScene.ui.processInput(Button.ACTION), "guest opens Fight through public COMMAND UI").toBe(true);
      expect(rig.guestScene.ui.processInput(Button.ACTION), "guest picks Tackle through public FIGHT UI").toBe(true);
      const target = await driveClientPhaseQueueTo(rig.guestScene, "SelectTargetPhase");
      target.start();
      await drainLoopback();
      expect(rig.guestScene.ui.processInput(Button.RIGHT), "guest targets enemy slot 2").toBe(true);
      expect(rig.guestScene.ui.processInput(Button.ACTION), "guest confirms target through public UI").toBe(true);
      await driveClientPhaseQueueTo(rig.guestScene, "CoopReplayTurnPhase");
    });
    await withClient(rig.hostCtx, () => drainLoopback());
  }

  async function driveRealBiomeMarketLeave(rig: DuoRig): Promise<void> {
    const counter = rig.hostRuntime.controller.interactionCounter();
    expect(counter % 2, "wave-10 first interaction is host-owned market").toBe(0);

    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
    const hostMarket = rig.hostScene.phaseManager.getCurrentPhase();
    expect(hostMarket, "host reached the actual queued BiomeShopPhase").toBeInstanceOf(BiomeShopPhase);
    const guestMarket = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "BiomeShopPhase", {
        matches: phase => phase instanceof BiomeShopPhase,
      }),
    );
    const retained = getCoopStagedWaveAdvanceTransaction(10, rig.guestRuntime.waveOperationBinding);
    expect(retained?.dataApplied, "the market cannot open before retained wave DATA applies").toBe(true);
    expect(retained?.continuationReady, "phase construction alone cannot release retained authority").toBe(false);

    await withClient(rig.guestCtx, () => {
      (
        guestMarket as unknown as {
          notifyCoopBiomeContinuationSurfaceReady(): void;
        }
      ).notifyCoopBiomeContinuationSurfaceReady();
    });
    expect(retained?.continuationReady, "an inactive watcher cannot attest a public continuation").toBe(false);

    // Reproduce the production wave-20/160 shape: a previous public handler is still active when the
    // watcher starts. The watcher must explicitly replace it with a real MESSAGE surface before stock.
    await withClient(rig.guestCtx, async () => {
      await rig.guestScene.ui.setModeBounded(
        UiMode.CONFIRM,
        2_000,
        () => {},
        () => {},
      );
      expect(rig.guestScene.ui.getMode()).toBe(UiMode.CONFIRM);
      expect(rig.guestScene.ui.getHandler().active).toBe(true);
    });

    // Start the real watcher first, then drive the owner's real BIOME_SHOP/CANCEL/CONFIRM handlers.
    await withClient(rig.guestCtx, async () => {
      guestMarket.start();
      await drainLoopback();
    });
    await waitForMode(rig.guestCtx, UiMode.MESSAGE, "guest market watcher message");
    expect(rig.guestScene.ui.getHandler().active, "watcher MESSAGE handler is executable").toBe(true);
    await withClient(rig.hostCtx, async () => {
      hostMarket.start();
      await drainLoopback();
    });
    await withClient(rig.guestCtx, () => drainLoopback());
    expect(
      retained?.continuationReady,
      "authoritative stock plus the live watcher loop attests the phase-owned continuation",
    ).toBe(true);
    await waitForMode(rig.hostCtx, UiMode.BIOME_SHOP, "host biome market");
    await pressUntilAccepted(rig, rig.hostCtx, Button.CANCEL, "market leave");
    await waitForMode(rig.hostCtx, UiMode.CONFIRM, "market leave confirmation");
    await pressUntilAccepted(rig, rig.hostCtx, Button.ACTION, "market confirm yes");

    for (let i = 0; i < 80; i++) {
      await pumpBoth(rig);
      if (
        rig.hostRuntime.controller.interactionCounter() === counter + 1
        && rig.guestRuntime.controller.interactionCounter() === counter + 1
      ) {
        const retained = getCoopStagedWaveAdvanceTransaction(10, rig.guestRuntime.waveOperationBinding);
        expect(retained?.dataApplied, "the watcher opened only after retained wave DATA applied").toBe(true);
        expect(
          retained?.continuationReady,
          "the phase-owned market watcher proves the real terminal-consumer continuation",
        ).toBe(true);
        return;
      }
    }
    throw new Error("biome market did not terminate in lockstep");
  }

  async function driveRealCrossroads(rig: DuoRig, leave: boolean): Promise<void> {
    const counter = rig.hostRuntime.controller.interactionCounter();
    expect(counter % 2, "after the host-owned market, the guest owns Crossroads").toBe(1);
    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("ErCrossroadsPhase", false));
    const hostCrossroads = rig.hostScene.phaseManager.getCurrentPhase();
    expect(hostCrossroads).toBeInstanceOf(ErCrossroadsPhase);
    const guestCrossroads = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "ErCrossroadsPhase", {
        matches: phase => phase instanceof ErCrossroadsPhase,
      }),
    );

    // No manual rendezvous arrival: both real phases enter xroads:10 and release each other.
    await withClient(rig.hostCtx, async () => {
      hostCrossroads.start();
      await drainLoopback();
    });
    await withClient(rig.guestCtx, async () => {
      guestCrossroads.start();
      await drainLoopback();
    });
    await waitForMode(rig.guestCtx, UiMode.OPTION_SELECT, "guest-owned Crossroads");
    if (leave) {
      await pressUntilAccepted(rig, rig.guestCtx, Button.DOWN, "Crossroads Leave cursor");
    }
    await pressUntilAccepted(rig, rig.guestCtx, Button.ACTION, `Crossroads ${leave ? "Leave" : "Stay"}`);
    await pumpBoth(rig, 8);
  }

  async function driveRealGuestOwnedMapPick(rig: DuoRig, destination: BiomeId): Promise<void> {
    const pinned = rig.hostRuntime.controller.interactionCounter();
    expect(pinned % 2, "the chained map retains the guest-owned Crossroads pin").toBe(1);
    await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectBiomePhase", false));
    const hostMap = rig.hostScene.phaseManager.getCurrentPhase();
    expect(hostMap).toBeInstanceOf(SelectBiomePhase);
    const guestMap = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "SelectBiomePhase", {
        matches: phase => phase instanceof SelectBiomePhase,
      }),
    );
    await withClient(rig.hostCtx, async () => {
      hostMap.start();
      await drainLoopback();
    });
    await withClient(rig.guestCtx, async () => {
      // Deliberately poison the renderer's old process-local target BEFORE operation classification.
      // The carrier says this boundary is interactive, so SelectBiome must ignore this stale value and
      // still open ER_MAP. Consuming it only after the pick is not sufficient: that would leave the old
      // target able to misclassify this transition as deterministic before the picker ever opens.
      setMapTravelTarget(BiomeId.LAKE);
      guestMap.start();
      await drainLoopback();
    });
    await waitForMode(rig.guestCtx, UiMode.ER_MAP, "guest-owned World Map");
    // The real full World Map uses LEFT/RIGHT. Choose the second revealed route, then ACTION.
    await pressUntilAccepted(rig, rig.guestCtx, Button.RIGHT, "World Map second route");
    await pressUntilAccepted(rig, rig.guestCtx, Button.ACTION, "World Map travel");

    for (let i = 0; i < 120; i++) {
      await pumpBoth(rig);
      if (
        rig.hostRuntime.controller.interactionCounter() === pinned + 1
        && rig.guestRuntime.controller.interactionCounter() === pinned + 1
      ) {
        break;
      }
      if (i === 119) {
        throw new Error("guest-owned BIOME_PICK never returned as a host-committed envelope");
      }
    }
    expect(
      withClientSync(rig.guestCtx, () => getMapTravelTarget()),
      "stale wrong travel target was consumed",
    ).toBeNull();
    expect(withClientSync(rig.hostCtx, () => getCoopBiomeTransitionTailPermit())).toMatchObject({
      destinationBiomeId: destination,
      switchAdopted: false,
    });
    expect(withClientSync(rig.guestCtx, () => getCoopBiomeTransitionTailPermit())).toMatchObject({
      destinationBiomeId: destination,
      switchAdopted: false,
    });
  }

  it("permit mismatches park SwitchBiome/NewBiome in place without mutation or queue advance", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    // Exercise the controller callback while the OTHER client is ambient. Before the runtime-scoped callback,
    // this rewrote all twelve host ledgers and left the destination guest ledger stale. Restore the negotiated
    // value before the gameplay assertions so this is a pure ownership probe, not a synthetic epoch change.
    const hostEpoch = rig.hostRuntime.controller.sessionEpoch;
    const guestEpoch = rig.guestRuntime.controller.sessionEpoch;
    const nextGuestEpoch = Math.max(hostEpoch, guestEpoch) + 1;
    const guestEpochCallback = (
      rig.guestRuntime.controller as unknown as { onEpochNegotiated?: (epoch: number) => void }
    ).onEpochNegotiated;
    const hostEpochCallback = (rig.hostRuntime.controller as unknown as { onEpochNegotiated?: (epoch: number) => void })
      .onEpochNegotiated;
    expect(guestEpochCallback, "guest controller retained its runtime-scoped epoch callback").toBeTypeOf("function");
    try {
      await withClient(rig.hostCtx, () => guestEpochCallback!(nextGuestEpoch));
      expectOperationSurfaceEpochs(rig.guestRuntime, nextGuestEpoch, "guest");
      expectOperationSurfaceEpochs(rig.hostRuntime, hostEpoch, "host");
    } finally {
      guestEpochCallback?.(guestEpoch);
      hostEpochCallback?.(hostEpoch);
    }
    expectOperationSurfaceEpochs(rig.guestRuntime, guestEpoch, "restored guest");
    expectOperationSurfaceEpochs(rig.hostRuntime, hostEpoch, "restored host");

    await withClient(rig.guestCtx, async () => {
      const ui = rig.guestScene.ui as unknown as { showText: (...args: unknown[]) => void };
      const realShowText = ui.showText.bind(rig.guestScene.ui);
      ui.showText = () => {
        // Hold the recovery callback: this assertion proves the phase itself stays parked.
      };
      try {
        rig.guestScene.currentBattle.waveIndex = 10;
        const deterministicOperationId = coopAuthoritativeBiomeTransitionOperationId(10);
        expect(deterministicOperationId).not.toBeNull();
        const deterministicAddress = parseCoopOperationId(deterministicOperationId!);
        expect(deterministicAddress).not.toBeNull();
        const sessionEpoch = deterministicAddress!.epoch;
        const wrongOwnerOperationId = makeCoopOperationId(
          sessionEpoch,
          1,
          deterministicAddress!.pinnedSeq,
          "BIOME_PICK",
        );
        const sourceBiomeId = rig.guestScene.arena.biomeId;
        const beforeArena = rig.guestScene.arena;
        const beforeNodes = getErPendingNodes().map(node => ({ ...node }));
        markErPendingNodesAwaitingAuthority();
        const randomBiome = vi.spyOn(rig.guestScene, "generateRandomBiome");
        new SelectBiomePhase().start();
        expect(randomBiome, "an authoritative renderer never rolls a missing route graph").not.toHaveBeenCalled();
        setErPendingNodes(beforeNodes);
        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: deterministicOperationId!,
            sessionEpoch,
            revision: 1,
            wave: 10,
            sourceBiomeId: -1,
            destinationBiomeId: BiomeId.VOLCANO,
            nextWave: 11,
          }),
          "a negative source biome cannot authorize world mutation",
        ).toBe(false);
        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: deterministicOperationId!,
            sessionEpoch,
            revision: 1,
            wave: 10,
            sourceBiomeId,
            destinationBiomeId: 999_999,
            nextWave: 11,
          }),
          "an unknown destination biome cannot authorize world mutation",
        ).toBe(false);
        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: wrongOwnerOperationId,
            sessionEpoch,
            revision: 1,
            wave: 10,
            sourceBiomeId,
            destinationBiomeId: BiomeId.VOLCANO,
            nextWave: 11,
          }),
          "a forged owner cannot authorize a deterministic host-owned transition",
        ).toBe(false);
        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: deterministicOperationId!,
            sessionEpoch,
            revision: 1,
            wave: 10,
            sourceBiomeId,
            destinationBiomeId: BiomeId.VOLCANO,
            nextWave: 11,
          }),
        ).toBe(true);
        const staleSwitch = new SwitchBiomePhase(BiomeId.VOLCANO);
        staleSwitch.start();
        expect(
          getCoopBiomeTransitionTailPermit(),
          "a replayed Switch that is not the current phase cannot even adopt the permit",
        ).toMatchObject({ switchAdopted: false, historyRecorded: false, switchPrepared: false });
        expect(rig.guestScene.arena, "stale public entry cannot replace the arena").toBe(beforeArena);
        expect(getErPendingNodes(), "stale public entry cannot rewrite routes").toEqual(beforeNodes);
        const wrongSwitch = liveSwitch(BiomeId.FOREST);
        const switchEnd = vi.spyOn(wrongSwitch, "end");
        wrongSwitch.start();
        expect(switchEnd, "a mismatched destination cannot shift the queue").not.toHaveBeenCalled();
        expect(rig.guestScene.arena, "a mismatched permit cannot replace the arena").toBe(beforeArena);
        expect(getErPendingNodes(), "a mismatched permit cannot roll/clear map routes").toEqual(beforeNodes);

        clearCoopBiomeTransitionTailPermit();
        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: deterministicOperationId!,
            sessionEpoch,
            revision: 2,
            wave: 10,
            sourceBiomeId,
            destinationBiomeId: BiomeId.VOLCANO,
            nextWave: 11,
          }),
        ).toBe(true);
        const laterOperationId = coopAuthoritativeBiomeTransitionOperationId(15);
        expect(laterOperationId).not.toBeNull();
        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: laterOperationId!,
            sessionEpoch,
            revision: 3,
            wave: 15,
            sourceBiomeId: BiomeId.VOLCANO,
            destinationBiomeId: BiomeId.FOREST,
            nextWave: 16,
          }),
          "a later commit cannot displace an unconsumed transition permit",
        ).toBe(false);
        expect(
          adoptCoopBiomeTransitionSwitchPermit({
            sourceBiomeId,
            destinationBiomeId: BiomeId.VOLCANO,
            wave: 10,
          }),
        ).not.toBeNull();
        const historyBeforePreparation = [...(getErMapSaveData().biomeHistory ?? [])];
        const correctSwitch = liveSwitch(BiomeId.VOLCANO);
        const correctSwitchEnd = vi.spyOn(correctSwitch, "end").mockImplementation(() => {});
        correctSwitch.start();
        expect(correctSwitchEnd, "authoritative renderer Switch is synchronous/non-gating").toHaveBeenCalledOnce();
        expect(getCoopBiomeTransitionTailPermit()).toMatchObject({
          switchAdopted: true,
          historyRecorded: true,
          switchPrepared: true,
        });
        const historyAfterPreparation = [...(getErMapSaveData().biomeHistory ?? [])];
        expect(historyAfterPreparation.length).toBe(historyBeforePreparation.length + 1);
        correctSwitch.start();
        expect(
          getErMapSaveData().biomeHistory,
          "retry after permit adoption cannot duplicate arena/recent-biome preparation",
        ).toEqual(historyAfterPreparation);
        expect(
          adoptCoopBiomeTransitionSwitchPermit({
            sourceBiomeId,
            destinationBiomeId: BiomeId.VOLCANO,
            wave: 10,
          }),
          "the same SwitchBiome retry re-adopts idempotently after a lost tween callback",
        ).not.toBeNull();
        expect(
          adoptCoopBiomeTransitionSwitchPermit({
            sourceBiomeId: BiomeId.VOLCANO,
            destinationBiomeId: BiomeId.VOLCANO,
            wave: 10,
          }),
          "a retry after newArena already landed still belongs to the same committed SwitchBiome",
        ).not.toBeNull();
        expect(
          adoptCoopBiomeTransitionSwitchPermit({
            sourceBiomeId: BiomeId.VOLCANO,
            destinationBiomeId: BiomeId.VOLCANO,
            wave: 11,
          }),
          "a retry after newBattle already advanced recognizes the permitted destination wave",
        ).not.toBeNull();
        expect(markCoopBiomeTransitionHistoryRecorded(deterministicOperationId!)).not.toBeNull();
        expect(markCoopBiomeTransitionSwitchPrepared(deterministicOperationId!)).not.toBeNull();
        expect(
          consumeCoopBiomeTransitionEncounterPermit({ destinationBiomeId: BiomeId.VOLCANO, nextWave: 11 }),
        ).not.toBeNull();
        expect(
          consumeCoopBiomeTransitionEncounterPermit({ destinationBiomeId: BiomeId.VOLCANO, nextWave: 11 }),
          "the same NewBiome start retry re-adopts without spending the one-shot before end()",
        ).not.toBeNull();
        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: deterministicOperationId!,
            sessionEpoch,
            revision: 2,
            wave: 10,
            sourceBiomeId,
            destinationBiomeId: BiomeId.VOLCANO,
            nextWave: 11,
          }),
          "a journal resend cannot reset an already-adopted permit back to its initial stage",
        ).toBe(true);
        expect(getCoopBiomeTransitionTailPermit()).toMatchObject({ switchAdopted: true, encounterAdopted: true });
        // Model a wrong ensuing encounter address: even with a switch-adopted permit, wave 12 cannot consume
        // the operation that authorizes only destination wave 11.
        await rig.guestScene.newArena(BiomeId.VOLCANO);
        rig.guestScene.currentBattle.waveIndex = 12;
        const beforeEncounterBattle = rig.guestScene.currentBattle;
        const wrongEncounter = liveNewBiome();
        const encounterEnd = vi.spyOn(wrongEncounter, "end");
        wrongEncounter.start();
        expect(encounterEnd, "a mismatched next-wave cannot shift into command").not.toHaveBeenCalled();
        expect(rig.guestScene.currentBattle, "the parked encounter cannot replace the battle").toBe(
          beforeEncounterBattle,
        );
        expect(getCoopBiomeTransitionTailPermit(), "the mismatched consumer cannot spend the permit").not.toBeNull();

        expect(
          armCoopBiomeTransitionTailPermit({
            operationId: laterOperationId!,
            sessionEpoch,
            revision: 3,
            wave: 15,
            sourceBiomeId: BiomeId.VOLCANO,
            destinationBiomeId: BiomeId.FOREST,
            nextWave: 16,
          }),
          "a later dense commit replaces a fully consumed permit whose post-shift finalizer was displaced",
        ).toBe(true);
        expect(getCoopBiomeTransitionTailPermit()).toMatchObject({
          operationId: laterOperationId,
          revision: 3,
          wave: 15,
          switchAdopted: false,
          encounterAdopted: false,
        });
      } finally {
        ui.showText = realShowText;
      }
    });
    clearCoopBiomeTransitionTailPermit();
    await withClient(rig.hostCtx, () => {
      rig.hostScene.currentBattle.waveIndex = 10;
      const sourceBiomeId = rig.hostScene.arena.biomeId;
      const tweenAdd = vi.spyOn(rig.hostScene.tweens, "add");
      tweenAdd.mockClear();
      const blockedHostSwitch = liveSwitch(BiomeId.VOLCANO);
      const blockedHostEnd = vi.spyOn(blockedHostSwitch, "end").mockImplementation(() => {});
      blockedHostSwitch.start();
      expect(blockedHostEnd, "even the host cannot switch before a successful exact commit").not.toHaveBeenCalled();
      expect(rig.hostScene.arena.biomeId, "an uncommitted host switch cannot replace the arena").toBe(sourceBiomeId);

      expect(
        commitAuthoritativeBiomeTransition({
          sourceWave: 10,
          sourceBiomeId,
          destinationBiomeId: BiomeId.VOLCANO,
          turn: 0,
          localRole: "host",
        }),
        "the sole authority commits and arms the exact local permit before constructing the switch tail",
      ).not.toBeNull();
      const committedHostSwitch = liveSwitch(BiomeId.VOLCANO);
      const committedHostEnd = vi.spyOn(committedHostSwitch, "end").mockImplementation(() => {});
      committedHostSwitch.start();
      expect(committedHostEnd, "the committed host switch remains synchronous/non-gating").toHaveBeenCalledOnce();
      expect(tweenAdd, "co-op authority Switch materializes canonical endpoints synchronously").not.toHaveBeenCalled();
      expect(rig.hostScene.arena.biomeId).toBe(BiomeId.VOLCANO);
    });
  }, 120_000);

  it("SwitchBiome retries one retained deterministic plan across roll/write/reveal/structure/newArena faults", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, () => {
      rig.hostScene.currentBattle.waveIndex = 10;
      const sourceBiomeId = rig.hostScene.arena.biomeId;
      expect(
        commitAuthoritativeBiomeTransition({
          sourceWave: 10,
          sourceBiomeId,
          destinationBiomeId: BiomeId.VOLCANO,
          turn: 0,
          localRole: "host",
        }),
      ).not.toBeNull();

      type Plan = {
        readonly nodes: readonly ErRouteNode[];
        readonly visibleNodes: readonly { biome: BiomeId; label: string; kind: "biome" }[];
        readonly structure: { readonly length: number | null; readonly startWave: number };
      };
      type SwitchFaultSeam = {
        buildAuthoritativePreparationPlan(authoritativeGuest: boolean, entryWave: number): Plan;
        applyAuthoritativeRoutes(authoritativeGuest: boolean, plan: Plan): void;
        applyAuthoritativeReveals(authoritativeGuest: boolean, plan: Plan): void;
        applyAuthoritativeStructure(plan: Plan): void;
      };
      const phase = liveSwitch(BiomeId.VOLCANO);
      const seam = phase as unknown as SwitchFaultSeam;
      vi.spyOn(phase, "end").mockImplementation(() => {});

      let planCalls = 0;
      const buildPlan = seam.buildAuthoritativePreparationPlan.bind(seam);
      seam.buildAuthoritativePreparationPlan = (guest, wave) => {
        planCalls++;
        if (planCalls === 1) {
          throw new Error("synthetic roll fault");
        }
        return buildPlan(guest, wave);
      };
      let routeCalls = 0;
      const applyRoutes = seam.applyAuthoritativeRoutes.bind(seam);
      seam.applyAuthoritativeRoutes = (guest, plan) => {
        routeCalls++;
        applyRoutes(guest, plan);
        if (routeCalls === 1) {
          throw new Error("synthetic route write fault");
        }
      };
      let revealCalls = 0;
      const applyReveals = seam.applyAuthoritativeReveals.bind(seam);
      seam.applyAuthoritativeReveals = (guest, plan) => {
        revealCalls++;
        applyReveals(guest, plan);
        if (revealCalls === 1) {
          throw new Error("synthetic reveal fault");
        }
      };
      let structureCalls = 0;
      const applyStructure = seam.applyAuthoritativeStructure.bind(seam);
      seam.applyAuthoritativeStructure = plan => {
        structureCalls++;
        applyStructure(plan);
        if (structureCalls === 1) {
          throw new Error("synthetic structure fault");
        }
      };
      let arenaCalls = 0;
      const newArena = rig.hostScene.newArena.bind(rig.hostScene);
      vi.spyOn(rig.hostScene, "newArena").mockImplementation((biome, playerFaints, restoring) => {
        arenaCalls++;
        const arena = newArena(biome, playerFaints, restoring);
        if (arenaCalls === 1) {
          throw new Error("synthetic post-newArena fault");
        }
        return arena;
      });

      for (let attempt = 0; attempt < 6; attempt++) {
        phase.start();
      }
      expect(planCalls, "only the pre-plan roll failure reruns; partial writes retain the exact plan").toBe(2);
      expect(routeCalls, "an interrupted idempotent route write is retried").toBe(2);
      expect(revealCalls, "an interrupted idempotent reveal write is retried").toBe(2);
      expect(structureCalls, "an interrupted idempotent structure write is retried").toBe(2);
      expect(arenaCalls, "newArena is not called twice after it already landed before throwing").toBe(1);
      expect(rig.hostScene.arena.biomeId).toBe(BiomeId.VOLCANO);
      expect(getCoopBiomeTransitionTailPermit()).toMatchObject({
        historyRecorded: true,
        switchPrepared: true,
      });
      expect(getErPendingNodes().length, "the retained route plan remains installed").toBeGreaterThan(0);
      expect(getErMapSaveData().biomeHistory?.filter(biome => biome === sourceBiomeId)).toHaveLength(1);
    });
  }, 120_000);

  it("SwitchBiome retires its exact permit when retained authority already installed the destination battle", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.guestCtx, () => {
      const sourceWave = 10;
      const nextWave = 11;
      const sourceBiomeId = rig.guestScene.arena.biomeId;
      const operationId = coopAuthoritativeBiomeTransitionOperationId(sourceWave);
      const address = operationId == null ? null : parseCoopOperationId(operationId);
      expect(address).not.toBeNull();
      expect(
        armCoopBiomeTransitionTailPermit({
          operationId: operationId!,
          sessionEpoch: address!.epoch,
          revision: 1,
          wave: sourceWave,
          sourceBiomeId,
          destinationBiomeId: BiomeId.VOLCANO,
          nextWave,
        }),
      ).toBe(true);

      // Model the production ordering from the soak: retained WAVE_ADVANCE has installed wave 11 while
      // SelectBiome's ordinary NewBattlePhase is still the immediate queued duplicate.
      rig.guestScene.currentBattle.waveIndex = nextWave;
      const phase = new SwitchBiomePhase(BiomeId.VOLCANO, sourceWave);
      const boundary = { live: true };
      syntheticBoundaries.add(boundary);
      (phase as unknown as { coopBoundaryStillLive(): boolean }).coopBoundaryStillLive = () => boundary.live;
      const phaseManager = rig.guestScene.phaseManager;
      const current = vi.spyOn(phaseManager, "getCurrentPhase").mockReturnValue(phase);
      const queued = vi.spyOn(phaseManager, "getQueuedPhaseNames").mockReturnValue(["NewBattlePhase"]);
      const remove = vi.spyOn(phaseManager, "tryRemovePhase").mockReturnValue(true);
      const replacement = {} as ReturnType<typeof phaseManager.getCurrentPhase>;
      const shift = vi.spyOn(phaseManager, "shiftPhase").mockImplementation(() => {
        current.mockReturnValue(replacement);
      });

      phase.start();

      expect(remove).toHaveBeenCalledWith("NewBattlePhase");
      expect(
        shift,
        "SwitchBiome moved into the retained carrier's already-installed continuation",
      ).toHaveBeenCalledOnce();
      expect(rig.guestScene.arena.biomeId).toBe(BiomeId.VOLCANO);
      expect(
        getCoopBiomeTransitionTailPermit(),
        "the skipped duplicate encounter tail cannot strand the single permit slot",
      ).toBeNull();
      queued.mockRestore();
      remove.mockRestore();
      shift.mockRestore();
      current.mockRestore();
    });
  }, 120_000);

  it("stale Crossroads and biome-market callbacks cannot relay, mutate, or advance after replacement", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      const send = vi.spyOn(CoopInteractionRelay.prototype, "sendInteractionChoice");
      const ui = rig.hostScene.ui as unknown as {
        setModeBoundedWhen: (
          mode: UiMode,
          timeoutMs: number,
          isCurrent: (() => boolean) | undefined,
          ...args: unknown[]
        ) => Promise<"completed" | "forced" | "superseded">;
        showText: (...args: unknown[]) => void;
      };
      const realSetModeBoundedWhen = ui.setModeBoundedWhen.bind(rig.hostScene.ui);
      const realShowText = ui.showText.bind(rig.hostScene.ui);
      let optionConfig: { options: { handler: () => boolean }[] } | null = null;
      let confirm: (() => void) | null = null;
      let cancel: (() => void) | null = null;
      ui.showText = () => {};
      ui.setModeBoundedWhen = (
        mode: UiMode,
        _timeoutMs: number,
        isCurrent: (() => boolean) | undefined,
        ...args: unknown[]
      ): Promise<"completed" | "forced" | "superseded"> => {
        if (!(isCurrent?.() ?? true)) {
          return Promise.resolve("superseded");
        }
        if (mode === UiMode.OPTION_SELECT) {
          optionConfig = args[0] as { options: { handler: () => boolean }[] };
        } else if (mode === UiMode.CONFIRM) {
          confirm = args[0] as () => void;
          cancel = args[1] as () => void;
        }
        return Promise.resolve("completed");
      };
      try {
        let crossroadsLive = true;
        const crossroads = new ErCrossroadsPhase() as unknown as {
          coopOwnerFlow(pinned: number): void;
          boundaryStillLive(generation: number, wave: number): boolean;
        };
        crossroads.boundaryStillLive = () => crossroadsLive;
        crossroads.coopOwnerFlow(counterBefore);
        await Promise.resolve();
        expect(optionConfig, "captured the real owner option handlers").not.toBeNull();
        crossroadsLive = false;
        expect(optionConfig!.options[0].handler(), "stale Stay callback fails closed").toBe(false);
        expect(optionConfig!.options[1].handler(), "stale Leave callback fails closed").toBe(false);

        let marketLive = true;
        const market = new BiomeShopPhase() as unknown as {
          coopBiomeStart: number;
          coopBiomeOwner: boolean;
          confirmLeave(): void;
          hideShopForOverlay(): void;
          coopBoundaryStillLive(generation: number, wave: number): boolean;
          end(): void;
        };
        market.coopBiomeStart = counterBefore;
        market.coopBiomeOwner = true;
        market.hideShopForOverlay = () => {};
        market.coopBoundaryStillLive = () => marketLive;
        const marketEnd = vi.spyOn(market, "end");
        market.confirmLeave();
        await Promise.resolve();
        expect(confirm, "captured the real bounded market confirm handler").not.toBeNull();
        expect(cancel, "captured the real bounded market cancel handler").not.toBeNull();
        marketLive = false;
        confirm!();
        cancel!();

        expect(send, "stale callbacks emit no relay choice").not.toHaveBeenCalled();
        expect(marketEnd, "stale confirm cannot shift the phase queue").not.toHaveBeenCalled();
        expect(rig.hostRuntime.controller.interactionCounter(), "stale callbacks cannot advance ownership").toBe(
          counterBefore,
        );
      } finally {
        ui.setModeBoundedWhen = realSetModeBoundedWhen;
        ui.showText = realShowText;
      }
    });
  }, 120_000);

  it("stale rendezvous, market-stock, and market-action awaits cannot resume a replaced phase", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      const boundary = deferred<{
        point: string;
        timedOut: boolean;
        authoritativePoint?: string;
        crossPoint?: string;
      }>();
      vi.spyOn(rig.hostRuntime.rendezvous, "rendezvous").mockReturnValueOnce(boundary.promise);
      let selectLive = true;
      const select = new SelectBiomePhase() as unknown as {
        boundaryStillLive(generation: number, wave: number): boolean;
        coopAwaitBoundaryBarrier(): Promise<boolean>;
      };
      select.boundaryStillLive = () => selectLive;
      const selectWait = select.coopAwaitBoundaryBarrier();
      selectLive = false;
      boundary.resolve({ point: "select-biome", timedOut: false });
      await expect(selectWait, "a resolved stale SelectBiome rendezvous stays closed").resolves.toBe(false);

      const crossroadsBoundary = deferred<{
        point: string;
        timedOut: boolean;
        authoritativePoint?: string;
        crossPoint?: string;
      }>();
      vi.spyOn(rig.hostRuntime.rendezvous, "rendezvous").mockReturnValueOnce(crossroadsBoundary.promise);
      let crossroadsLive = true;
      const crossroads = new ErCrossroadsPhase() as unknown as {
        boundaryStillLive(generation: number, wave: number): boolean;
        coopAwaitBoundaryBarrier(): Promise<boolean>;
      };
      crossroads.boundaryStillLive = () => crossroadsLive;
      const crossroadsWait = crossroads.coopAwaitBoundaryBarrier();
      crossroadsLive = false;
      crossroadsBoundary.resolve({ point: "crossroads", timedOut: false });
      await expect(crossroadsWait, "a resolved stale Crossroads rendezvous stays closed").resolves.toBe(false);

      const stock = deferred<null>();
      vi.spyOn(rig.hostRuntime.interactionRelay, "awaitRewardOptions").mockReturnValueOnce(stock.promise);
      let stockLive = true;
      const marketStock = new BiomeShopPhase() as unknown as {
        coopBiomeStart: number;
        coopAsyncBoundaryStillLive(generation: number, wave: number, pinned: number): boolean;
        coopBiomeDriveAdoptOptions(): Promise<void>;
        openBiomeShop(): void;
        coopBiomeAuthoritativeStockUnavailable(context: string): void;
      };
      marketStock.coopBiomeStart = rig.hostRuntime.controller.interactionCounter();
      marketStock.coopAsyncBoundaryStillLive = () => stockLive;
      const open = vi.spyOn(marketStock, "openBiomeShop");
      const recovery = vi.spyOn(marketStock, "coopBiomeAuthoritativeStockUnavailable");
      const stockWait = marketStock.coopBiomeDriveAdoptOptions();
      stockLive = false;
      stock.resolve(null);
      await stockWait;
      expect(open, "stale stock cannot reopen a replaced market").not.toHaveBeenCalled();
      expect(recovery, "stale stock cannot install recovery UI into the new phase").not.toHaveBeenCalled();

      const action = deferred<{
        choice: number;
        data: number[] | undefined;
        operationId?: string;
      } | null>();
      vi.spyOn(rig.hostRuntime.interactionRelay, "awaitInteractionChoice").mockReturnValueOnce(action.promise);
      let actionLive = true;
      const marketAction = new BiomeShopPhase() as unknown as {
        coopBiomeStart: number;
        coopBiomeOptionOwner: boolean;
        coopAsyncBoundaryStillLive(generation: number, wave: number, pinned: number): boolean;
        coopBiomeWatch(): Promise<void>;
        buildStock(): void;
        applyModifier(...args: unknown[]): void;
        finishCoopBiomeShopLeave(): void;
      };
      marketAction.coopBiomeStart = rig.hostRuntime.controller.interactionCounter();
      marketAction.coopBiomeOptionOwner = true;
      marketAction.coopAsyncBoundaryStillLive = () => actionLive;
      marketAction.buildStock = () => {};
      const apply = vi.spyOn(marketAction, "applyModifier");
      const leave = vi.spyOn(marketAction, "finishCoopBiomeShopLeave");
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      const actionWait = marketAction.coopBiomeWatch();
      actionLive = false;
      action.resolve({ choice: 0, data: [0, 1] });
      await actionWait;
      expect(apply, "a stale buy cannot mutate a party").not.toHaveBeenCalled();
      expect(leave, "a stale action cannot terminate the replacement phase").not.toHaveBeenCalled();
      expect(rig.hostRuntime.controller.interactionCounter(), "a stale action cannot advance ownership").toBe(
        counterBefore,
      );
    });
  }, 120_000);

  it("market LEAVE waits for journal retention and a missing watcher terminal never implies LEAVE", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      const pinned = rig.hostRuntime.controller.interactionCounter();
      const durability = rig.hostRuntime.durability;
      expect(durability, "the production-shaped runtime has an active durability journal").not.toBeNull();
      const rawTerminal = vi.spyOn(rig.hostRuntime.interactionRelay, "sendInteractionChoice");
      let counterAtFailedRetention = -1;
      let rawCallsAtFailedRetention = -1;
      const retain = vi.spyOn(durability!, "commit").mockImplementationOnce(() => {
        counterAtFailedRetention = rig.hostRuntime.controller.interactionCounter();
        rawCallsAtFailedRetention = rawTerminal.mock.calls.length;
        return false;
      });
      const market = new BiomeShopPhase() as unknown as {
        coopBiomeStart: number;
        coopBiomeOwner: boolean;
        coopAsyncBoundaryStillLive(generation: number, wave: number, expectedPinned: number): boolean;
        coopBiomeTerminal(): Promise<boolean>;
      };
      market.coopBiomeStart = pinned;
      market.coopBiomeOwner = true;
      market.coopAsyncBoundaryStillLive = () => true;

      const terminal = market.coopBiomeTerminal();
      expect(
        counterAtFailedRetention,
        "the first committed-but-unretained attempt cannot advance market ownership",
      ).toBe(pinned);
      expect(rawCallsAtFailedRetention, "the host cannot expose an unretained raw terminal companion").toBe(0);
      await expect(terminal).resolves.toBe(true);
      expect(retain, "the immutable host commit is journaled again on its exact re-ACK").toHaveBeenCalledTimes(2);
      expect(rawTerminal, "the retained terminal may keep its legacy-compatible companion").toHaveBeenCalledOnce();
      expect(rig.hostRuntime.controller.interactionCounter()).toBe(pinned + 1);
    });

    await withClient(rig.guestCtx, async () => {
      const pinned = rig.guestRuntime.controller.interactionCounter();
      vi.spyOn(rig.guestRuntime.interactionRelay, "awaitInteractionChoice").mockResolvedValue(null);
      const market = new BiomeShopPhase() as unknown as {
        coopBiomeStart: number;
        coopBiomeOptionOwner: boolean;
        coopAsyncBoundaryStillLive(generation: number, wave: number, expectedPinned: number): boolean;
        coopBiomeWatch(): Promise<void>;
        buildStock(): void;
        finishCoopBiomeShopLeave(): void;
      };
      market.coopBiomeStart = pinned;
      market.coopBiomeOptionOwner = true;
      market.coopAsyncBoundaryStillLive = () => true;
      market.buildStock = () => {};
      const leave = vi.spyOn(market, "finishCoopBiomeShopLeave");

      await market.coopBiomeWatch();
      expect(leave, "three missing exact terminals cannot be reinterpreted as LEAVE").not.toHaveBeenCalled();
      expect(rig.guestRuntime.controller.interactionCounter(), "missing terminals cannot advance ownership").toBe(
        pinned,
      );
      expect(getCoopRuntime(), "bounded terminal recovery stops the binary session safely").toBeNull();
    });
  }, 120_000);

  it("committed Crossroads and map terminal faults fail closed instead of consuming their receipt", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, () => {
      const pinned = rig.hostRuntime.controller.interactionCounter();
      const crossroads = new ErCrossroadsPhase() as unknown as {
        coopApply(expectedPinned: number, moveOn: boolean): boolean;
      };
      const queue = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew").mockImplementationOnce(() => {
        throw new Error("synthetic Crossroads queue failure");
      });
      expect(crossroads.coopApply(pinned, true), "the failed committed terminal is not acknowledged").toBe(false);
      expect(getCoopRuntime(), "a partially mutated Crossroads cannot continue as a split session").toBeNull();
      queue.mockRestore();
    });

    await withClient(rig.guestCtx, () => {
      const map = new SelectBiomePhase() as unknown as {
        applyNextBiomeAndEnd(nextBiome: BiomeId): boolean;
      };
      const queue = vi.spyOn(rig.guestScene.phaseManager, "unshiftNew").mockImplementationOnce(() => {
        throw new Error("synthetic map queue failure");
      });
      expect(map.applyNextBiomeAndEnd(BiomeId.VOLCANO), "the failed committed map terminal is not acknowledged").toBe(
        false,
      );
      expect(getCoopRuntime(), "a partially mutated map transition cannot continue as a split session").toBeNull();
      queue.mockRestore();
    });
  }, 120_000);

  it("NewBiome retires its consumed permit and fails closed when the installed next phase throws", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, () => {
      const sourceWave = 20;
      const nextWave = sourceWave + 1;
      const biome = rig.hostScene.arena.biomeId;
      const operationId = coopAuthoritativeBiomeTransitionOperationId(sourceWave);
      expect(operationId).not.toBeNull();
      expect(
        armCoopBiomeTransitionTailPermit({
          operationId: operationId!,
          sessionEpoch: rig.hostRuntime.controller.sessionEpoch,
          revision: 1,
          wave: sourceWave,
          sourceBiomeId: biome,
          destinationBiomeId: biome,
          nextWave,
        }),
      ).toBe(true);
      expect(
        adoptCoopBiomeTransitionSwitchPermit({
          sourceBiomeId: biome,
          destinationBiomeId: biome,
          wave: sourceWave,
        }),
      ).not.toBeNull();
      expect(markCoopBiomeTransitionHistoryRecorded(operationId!)).not.toBeNull();
      expect(markCoopBiomeTransitionSwitchPrepared(operationId!)).not.toBeNull();
      rig.hostScene.currentBattle.waveIndex = nextWave;
      expect(consumeCoopBiomeTransitionEncounterPermit({ destinationBiomeId: biome, nextWave })).not.toBeNull();

      const phase = new NewBiomeEncounterPhase() as unknown as {
        coopWave: number;
        coopOperationId: string;
        coopAuthoritativeGuest: boolean;
        coopCompleted: boolean;
        coopBoundaryStillLive(requirePermit?: boolean): boolean;
        shiftCoopAuthoritativeGuestPresentationOnly(): void;
        completeEncounterEnd(): void;
      };
      phase.coopWave = nextWave;
      phase.coopOperationId = operationId!;
      phase.coopAuthoritativeGuest = true;
      phase.coopBoundaryStillLive = () => true;
      const replacement = {} as ReturnType<typeof rig.hostScene.phaseManager.getCurrentPhase>;
      vi.spyOn(rig.hostScene.phaseManager, "getCurrentPhase").mockReturnValueOnce(replacement);
      phase.shiftCoopAuthoritativeGuestPresentationOnly = () => {
        throw new Error("synthetic next phase start failure after queue install");
      };

      phase.completeEncounterEnd();
      expect(phase.coopCompleted, "the exact consumed permit is retired before terminal teardown").toBe(true);
      expect(getCoopBiomeTransitionTailPermit()).toBeNull();
      expect(getCoopRuntime(), "the installed-but-failed next phase cannot leave shared play half-alive").toBeNull();
      expect(
        rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
        "terminal teardown replaces a lifetime-fenced retained phase without calling its stale end hook",
      ).toBe("TitlePhase");
      expect(rig.hostScene.phaseManager.getQueuedPhaseNames()).toEqual([]);
    });
  }, 120_000);

  it("solo SelectBiome terminal failures still propagate to the phase manager", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const phase = new SelectBiomePhase() as unknown as {
      applyNextBiomeAndEnd(nextBiome: BiomeId): boolean;
    };
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementationOnce(() => {
      throw new Error("synthetic solo queue failure");
    });
    expect(() => phase.applyNextBiomeAndEnd(BiomeId.VOLCANO)).toThrow(/synthetic solo queue failure/);
    queue.mockRestore();
  });

  it("stale enemy carrier/assets and failed new-biome cosmetics cannot strand or revive a replaced phase", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createScheduledCoopPair({ automatic: true }), setCoopRuntime, toCoop);

    await withClient(rig.guestCtx, async () => {
      type EncounterSeam = {
        adoptCoopHostEnemyParty(isCurrent?: () => boolean): Promise<void>;
        prepareCoopAuthoritativeGuestPresentationOnly(onReady: () => void | Promise<void>): Promise<void>;
      };
      const originalCurrent = rig.guestScene.phaseManager.getCurrentPhase();

      const carrierPhase = new EncounterPhase() as unknown as EncounterSeam;
      const carrier = deferred<void>();
      carrierPhase.adoptCoopHostEnemyParty = () => carrier.promise;
      const current = vi.spyOn(rig.guestScene.phaseManager, "getCurrentPhase").mockReturnValue(carrierPhase as never);
      const carrierReady = vi.fn();
      const carrierPreparation = carrierPhase.prepareCoopAuthoritativeGuestPresentationOnly(carrierReady);
      await Promise.resolve();
      current.mockReturnValue(originalCurrent);
      carrier.resolve();
      await expect(carrierPreparation, "a late carrier cannot resume the old encounter").rejects.toThrow(
        /boundary replacement/,
      );
      expect(carrierReady).not.toHaveBeenCalled();
      current.mockRestore();

      const assetPhase = new EncounterPhase() as unknown as EncounterSeam;
      assetPhase.adoptCoopHostEnemyParty = async () => {};
      const assetCurrent = vi
        .spyOn(rig.guestScene.phaseManager, "getCurrentPhase")
        .mockReturnValue(assetPhase as never);
      const assetLoads = rig.guestScene.currentBattle.enemyParty.map(() => deferred<void>());
      const assetSpies = rig.guestScene.currentBattle.enemyParty.map((enemy, index) =>
        vi.spyOn(enemy, "loadAssets").mockReturnValue(assetLoads[index].promise),
      );
      const assetReady = vi.fn();
      const assetPreparation = assetPhase.prepareCoopAuthoritativeGuestPresentationOnly(assetReady);
      await Promise.resolve();
      assetCurrent.mockReturnValue(originalCurrent);
      for (const load of assetLoads) {
        load.resolve();
      }
      await expect(assetPreparation, "late assets cannot materialize into the replacement phase").rejects.toThrow(
        /assets arrived after boundary replacement/,
      );
      expect(assetReady).not.toHaveBeenCalled();
      assetSpies.forEach(spy => spy.mockRestore());
      assetCurrent.mockRestore();

      const presentationRetry = new NewBiomeEncounterPhase() as unknown as {
        coopPresentationPreparing: boolean;
        coopBoundaryStillLive(requirePermit?: boolean): boolean;
        prepareCoopAuthoritativeGuestPresentationOnly(onReady: () => void | Promise<void>): Promise<void>;
        parkForAuthoritativePresentation(retry: () => void): void;
        beginAuthoritativeGuestPresentation(): void;
        start(): void;
      };
      presentationRetry.coopBoundaryStillLive = () => true;
      const preparePresentation = vi
        .spyOn(presentationRetry, "prepareCoopAuthoritativeGuestPresentationOnly")
        .mockRejectedValueOnce(new Error("synthetic first atlas completion failure"))
        .mockResolvedValueOnce();
      let retryPresentation: (() => void) | null = null;
      vi.spyOn(presentationRetry, "parkForAuthoritativePresentation").mockImplementation(retry => {
        retryPresentation = retry;
      });
      const reenterStart = vi.spyOn(presentationRetry, "start");
      presentationRetry.beginAuthoritativeGuestPresentation();
      await Promise.resolve();
      await Promise.resolve();
      expect(preparePresentation).toHaveBeenCalledOnce();
      expect(presentationRetry.coopPresentationPreparing).toBe(false);
      expect(retryPresentation).toBeTypeOf("function");
      (retryPresentation as unknown as () => void)();
      await Promise.resolve();
      expect(preparePresentation).toHaveBeenCalledTimes(2);
      expect(reenterStart, "presentation recovery never re-enters permit acquisition").not.toHaveBeenCalled();

      vi.useFakeTimers();
      try {
        const newBiome = new NewBiomeEncounterPhase() as unknown as {
          coopBoundaryStillLive(requirePermit?: boolean): boolean;
          isBoundedAuthoritativeCoop(): boolean;
          startPresentationIntro(authoritativeGuest: boolean): void;
          end(): void;
        };
        newBiome.coopBoundaryStillLive = () => true;
        newBiome.isBoundedAuthoritativeCoop = () => true;
        const end = vi.spyOn(newBiome, "end").mockImplementation(() => {});
        const tween = vi.spyOn(rig.guestScene.tweens, "add").mockImplementation(config => config as never);
        const failedCosmetic = vi.spyOn(rig.guestScene.tweens, "killTweensOf").mockImplementation(() => {
          throw new Error("synthetic cosmetic failure");
        });
        newBiome.startPresentationIntro(true);
        const intro = tween.mock.calls[0][0] as unknown as { onComplete(): void };
        expect(() => intro.onComplete(), "the cosmetic failure is contained by the phase").not.toThrow();
        expect(end).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(12_000);
        expect(end, "the pre-armed terminal watchdog recovers the failed cosmetic path").toHaveBeenCalledOnce();
        failedCosmetic.mockRestore();
        tween.mockRestore();

        const lostCallback = new NewBiomeEncounterPhase() as unknown as {
          coopCompleted: boolean;
          coopBoundaryStillLive(requirePermit?: boolean): boolean;
          isBoundedAuthoritativeCoop(): boolean;
          startPresentationIntro(authoritativeGuest: boolean): void;
          end(): void;
        };
        lostCallback.coopBoundaryStillLive = () => true;
        lostCallback.isBoundedAuthoritativeCoop = () => true;
        const lostEnd = vi.spyOn(lostCallback, "end").mockImplementation(() => {
          // Preserve end()'s idempotence side effect while suppressing the unrelated phase-queue mutation.
          lostCallback.coopCompleted = true;
        });
        vi.spyOn(rig.guestScene.tweens, "add").mockImplementation(config => config as never);
        lostCallback.startPresentationIntro(true);
        await vi.advanceTimersByTimeAsync(17_000);
        expect(lostEnd, "lost tween and text callbacks still reach the authoritative terminal").toHaveBeenCalledOnce();

        const humanWait = new NewBiomeEncounterPhase() as unknown as {
          coopAuthoritativeGuest: boolean;
          coopBoundaryStillLive(requirePermit?: boolean): boolean;
          isBoundedAuthoritativeCoop(): boolean;
          armTerminalWatchdog(authoritativeGuest: boolean): void;
          setInteractivePresentationWaiting(waiting: boolean): void;
          end(): void;
        };
        humanWait.coopAuthoritativeGuest = false;
        humanWait.coopBoundaryStillLive = () => true;
        humanWait.isBoundedAuthoritativeCoop = () => true;
        const humanWaitEnd = vi.spyOn(humanWait, "end").mockImplementation(() => {});
        humanWait.armTerminalWatchdog(false);
        humanWait.setInteractivePresentationWaiting(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(
          humanWaitEnd,
          "a real player may read trainer/ME dialogue longer than the mechanical watchdog",
        ).not.toHaveBeenCalled();
        humanWait.setInteractivePresentationWaiting(false);
        await vi.advanceTimersByTimeAsync(12_000);
        expect(
          humanWaitEnd,
          "the bounded recovery resumes only after the human-owned UI resolves",
        ).toHaveBeenCalledOnce();
      } finally {
        vi.useRealTimers();
      }

      const battle = rig.guestScene.currentBattle;
      const originalBattleType = battle.battleType;
      const originalTrainer = battle.trainer;
      let trainerDialogueCallback: (() => void) | undefined;
      const trainerDialogue = vi
        .spyOn(rig.guestScene.ui, "showDialogue")
        .mockImplementation((_text, _name, _delay, callback) => {
          trainerDialogueCallback = callback ?? undefined;
        });
      try {
        battle.battleType = BattleType.TRAINER;
        battle.trainer = {
          untint: vi.fn(),
          playAnim: vi.fn(),
          applyErGhostAuraFx: vi.fn(),
          getEncounterMessages: () => ["A deliberately human-paced trainer line."],
          getName: () => "Lifecycle Tester",
          config: { hasCharSprite: false },
        } as never;
        let live = true;
        const waiting = vi.fn();
        const startedBeforeLateCallback = battle.started;
        const queueBeforeLateCallback = [...rig.guestScene.phaseManager.getQueuedPhaseNames()];
        const phase = new EncounterPhase();
        phase.doEncounterCommon(false, () => live, waiting);
        expect(waiting).toHaveBeenLastCalledWith(true);
        expect(trainerDialogueCallback).toBeTypeOf("function");
        live = false;
        trainerDialogueCallback?.();
        await Promise.resolve();
        expect(battle.started, "a late trainer callback cannot alter the replacement battle start state").toBe(
          startedBeforeLateCallback,
        );
        expect(rig.guestScene.phaseManager.getQueuedPhaseNames()).toEqual(queueBeforeLateCallback);
      } finally {
        trainerDialogue.mockRestore();
        battle.battleType = originalBattleType;
        battle.trainer = originalTrainer;
      }

      const retained = new NewBiomeEncounterPhase() as unknown as {
        coopGeneration: number;
        coopWave: number;
        coopBattle: typeof rig.guestScene.currentBattle;
        isBoundedAuthoritativeCoop(): boolean;
        start(): void;
        end(): void;
        completeEncounterEnd(): void;
      };
      retained.coopGeneration = 0; // a previously captured lifetime; deliberately not the replacement generation
      retained.coopWave = rig.guestScene.currentBattle.waveIndex;
      retained.coopBattle = rig.guestScene.currentBattle;
      retained.isBoundedAuthoritativeCoop = () => false; // model runtime teardown/replacement
      const shift = vi.spyOn(rig.guestScene.phaseManager, "shiftPhase");
      retained.start();
      retained.end();
      retained.completeEncounterEnd();
      expect(
        shift,
        "a retained co-op phase can never fall back to solo super.* after its runtime disappears",
      ).not.toHaveBeenCalled();
    });
  }, 120_000);

  it.each([
    { branch: "Stay", leave: false },
    { branch: "Leave", leave: true },
  ])("wave 10 -> market -> Crossroads $branch -> wave 11 stays converged", async ({ leave }) => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    pair.setAutomaticDelivery(false);
    const headlessAtlas = withClientSync(rig.guestCtx, () => installHeadlessPlayerAtlasCompletion(rig.guestScene));

    const sourceBiome = rig.hostScene.arena.biomeId;
    const routes: ErRouteNode[] = [
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true, source: "upgrade" },
    ];
    for (const ctx of [rig.hostCtx, rig.guestCtx]) {
      await withClient(ctx, () => {
        // Wave 10 is deliberately MID-biome: WAVE_ADVANCE biomeChange=false, but Crossroads is due.
        restoreErBiomeStructure(25, 1, null);
        setErPendingNodes(routes.map(node => ({ ...node })));
      });
    }

    const resync = installCoopResyncProbe(rig.guestRuntime);
    try {
      await driveGuestCommandUi(rig);
      const turn = rig.hostScene.currentBattle.turn;
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
        await game.phaseInterceptor.to("TurnEndPhase");
      });
      await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
      expect(
        rig.guestScene.currentBattle.enemyParty.every(mon => mon.isFainted()),
        "wave-10 battle converged",
      ).toBe(true);

      await driveRealBiomeMarketLeave(rig);
      await driveRealCrossroads(rig, leave);
      const guestApplyModifiers = leave ? vi.spyOn(rig.guestScene, "applyModifiers") : null;
      let guestSelectBiomeApplyModifierCalls: number | null = null;
      const guestInitSession = leave ? vi.spyOn(rig.guestScene, "initSession") : null;
      const guestEncounterEvent = leave ? vi.spyOn(rig.guestScene.eventTarget, "dispatchEvent") : null;
      const guestTailQueue = leave ? vi.spyOn(rig.guestScene.phaseManager, "unshiftNew") : null;
      const guestResetBattle = leave
        ? rig.guestScene.getPlayerParty().map(pokemon => vi.spyOn(pokemon, "resetBattleAndWaveData"))
        : [];
      const guestResetWave = leave
        ? rig.guestScene.getPlayerParty().map(pokemon => vi.spyOn(pokemon, "resetWaveData"))
        : [];
      if (leave) {
        await driveRealGuestOwnedMapPick(rig, BiomeId.VOLCANO);
        // Scope this guard to the SelectBiome renderer itself. The later post-summon authoritative
        // carrier intentionally uses applyModifiers while adopting/recalculating host state; counting
        // that required apply as a map-owned MoneyInterest mutation would be a false positive.
        guestSelectBiomeApplyModifierCalls = guestApplyModifiers?.mock.calls.length ?? null;
        guestApplyModifiers?.mockRestore();
      }
      const guestMeChanceBeforeNewBiome = rig.guestScene.mysteryEncounterSaveData.encounterSpawnChance;

      // First drive the host through its real encounter/PostSummon queue to the CommandPhase boundary
      // without starting that phase. This makes the pre-summon wave carrier available, while deliberately
      // withholding the command-start refresh and rendezvous arrival. Then let the renderer reach and START
      // its own real CommandPhase first: it consumes that initial carrier, arrives at the reciprocal command
      // barrier, and must keep public input closed. Starting the already-current host CommandPhase publishes
      // the refreshed complete state and arrives at the same barrier. Ordered delivery puts that refresh before the arrival;
      // the guest's crossed-barrier continuation must re-consume it before opening COMMAND. This is the
      // production guest-first schedule that exposed the entry-stage split; stopping before CommandPhase
      // start would inspect an intentionally pre-continuation boundary and bypass the recovery seam.
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("CommandPhase", false));
      const guestCommand = await withClient(rig.guestCtx, () =>
        driveClientPhaseQueueTo(rig.guestScene, "guest-owned CommandPhase", {
          matches: phase =>
            phase.phaseName === "CommandPhase"
            && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
        }),
      );
      await withClient(rig.guestCtx, async () => {
        guestCommand.start();
        await drainLoopback();
        expect(
          rig.guestScene.ui.getMode(),
          "guest-first command remains closed until host post-summon authority is available",
        ).not.toBe(UiMode.COMMAND);
      });
      await withClient(rig.hostCtx, async () => {
        const hostCommand = rig.hostScene.phaseManager.getCurrentPhase();
        expect(hostCommand.phaseName, "host is parked immediately before command-start authority publication").toBe(
          "CommandPhase",
        );
        hostCommand.start();
        await drainLoopback();
      });
      const hostCommandReadyState = withClientSync(rig.hostCtx, () => captureCoopChecksumState());
      await withClient(rig.guestCtx, async () => {
        await drainLoopback();
        expect(
          captureCoopChecksumState(),
          "the post-summon refresh is applied before the guest command continuation opens",
        ).toEqual(hostCommandReadyState);
        expect(rig.guestScene.ui.getMode(), "guest command opens only after settled authority is applied").toBe(
          UiMode.COMMAND,
        );
      });

      const expectedBiome = leave ? BiomeId.VOLCANO : sourceBiome;
      expect(rig.hostScene.currentBattle.waveIndex).toBe(11);
      expect(rig.guestScene.currentBattle.waveIndex).toBe(11);
      expect(rig.hostScene.arena.biomeId).toBe(expectedBiome);
      expect(rig.guestScene.arena.biomeId).toBe(expectedBiome);
      expect(rig.hostRuntime.controller.interactionCounter()).toBe(2);
      expect(rig.guestRuntime.controller.interactionCounter()).toBe(2);
      expect(withClientSync(rig.guestCtx, () => getErPendingNodes())).toEqual(
        withClientSync(rig.hostCtx, () => getErPendingNodes()),
      );
      expect(withClientSync(rig.guestCtx, () => getErMapSaveData())).toEqual(
        withClientSync(rig.hostCtx, () => getErMapSaveData()),
      );
      expect(
        withClientSync(rig.guestCtx, () => captureCoopSaveDataNormalized()),
        "every normalized persistent substrate converges before the opaque checksum",
      ).toEqual(withClientSync(rig.hostCtx, () => captureCoopSaveDataNormalized()));
      expect(
        withClientSync(rig.guestCtx, () => captureCoopChecksumState()),
        "every structured battle component converges before the opaque checksum",
      ).toEqual(withClientSync(rig.hostCtx, () => captureCoopChecksumState()));
      expect(
        headlessAtlas.productionLoadsCompleted(),
        "the renderer completes both real production player-atlas loads before command readiness",
      ).toBeGreaterThanOrEqual(2);
      expect(withClientSync(rig.guestCtx, () => captureCoopChecksum())).toBe(
        withClientSync(rig.hostCtx, () => captureCoopChecksum()),
      );
      expect(resync.count(), "the UI-driven boundary requires no forced recovery").toBe(0);
      if (leave) {
        expect(
          guestSelectBiomeApplyModifierCalls,
          "SelectBiome renderer skips MoneyInterest and every modifier mutation",
        ).toBe(0);
        expect(
          guestTailQueue?.mock.calls.some(call => call[0] === "PartyHealPhase" || call[0] === "SelectModifierPhase"),
          "SelectBiome renderer cannot queue local heal/challenge rewards",
        ).toBe(false);
        expect(
          guestInitSession,
          "NewBiome renderer bypasses EncounterPhase.runEncounter/initSession",
        ).not.toHaveBeenCalled();
        const guestSceneEventTypes = guestEncounterEvent?.mock.calls.map(([event]) => event.type) ?? [];
        expect(
          guestSceneEventTypes.filter(type => type === BattleSceneEventType.ENCOUNTER_PHASE),
          "NewBiome renderer cannot dispatch a second shared encounter event",
        ).toHaveLength(0);
        expect(
          guestSceneEventTypes.filter(type => type === BattleSceneEventType.NEW_ARENA),
          "the renderer dispatches exactly one local NewArena presentation event",
        ).toHaveLength(1);
        expect(
          guestResetBattle.every(spy => spy.mock.calls.length === 0),
          "NewBiome renderer skips biome reset hooks",
        ).toBe(true);
        expect(
          guestResetWave.every(spy => spy.mock.calls.length === 0),
          "NewBiome renderer skips encounter wave reset hooks",
        ).toBe(true);
        expect(
          rig.guestScene.mysteryEncounterSaveData.encounterSpawnChance,
          "NewBiome presentation cannot derive Mystery Encounter chance on the authoritative renderer",
        ).toBe(guestMeChanceBeforeNewBiome);
      }
      expect(
        [...getObservedCoopGuestPhases()].filter(phase =>
          ["PartyHealPhase", "ReturnPhase", "LevelCapPhase"].includes(phase),
        ),
        "the renderer never constructs host-owned post-battle mutation phases",
      ).toEqual([]);
      expect(getCoopRendererNeutralizedLog(), "no guest boundary phase became CoopInert").toEqual([]);
      expect(getCoopTailWouldBlockLog(), "the committed BIOME_PICK sanctions the late biome tail").toEqual([]);
      expect(
        withClientSync(rig.hostCtx, () => getCoopBiomeTransitionTailPermit()),
        "the host one-shot permit is finalized by its NewBiomeEncounter",
      ).toBeNull();
      expect(
        withClientSync(rig.guestCtx, () => getCoopBiomeTransitionTailPermit()),
        "the guest one-shot permit is finalized independently by its NewBiomeEncounter",
      ).toBeNull();
      expect(rig.guestScene.ui.getMode(), "the bounded teardown cannot leave the renderer trapped on ER_MAP").not.toBe(
        UiMode.ER_MAP,
      );
      if (leave) {
        expect(getObservedCoopGuestPhases()).toContain("SwitchBiomePhase");
        expect(getObservedCoopGuestPhases()).toContain("NewBiomeEncounterPhase");
        expect(game.phaseInterceptor.log).toContain("SwitchBiomePhase");
        expect(game.phaseInterceptor.log).toContain("NewBiomeEncounterPhase");
      }
      logs.flush();
    } finally {
      headlessAtlas.restore();
      resync.restore();
    }
  }, 300_000);

  it.todo("P33 debt: retain/address/ACK the post-PostSummon refresh before command continuation readiness");
});
