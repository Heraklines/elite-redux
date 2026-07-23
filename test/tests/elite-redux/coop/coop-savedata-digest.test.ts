/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #837 - the systemic desync-blind-spot closer. The per-turn co-op checksum now folds a NORMALIZED
// digest of getSessionSaveData() (the saveDataDigest field), so every run-state substrate the session
// save serializes - money-streak, ward-stone charges, relic-battle-state, biome overstay anchor, and
// all player-wide modifiers as full ModifierData blobs incl. their getArgs internals - becomes
// desync-DETECTABLE and HEALABLE by construction (the [typeId,stackCount] modifier digest was blind to
// modifier-internal drift; three MODULE-LET substrates were in NO heal path at all). This file proves:
//   1. GUARD - the digest is DERIVED FROM the save-data serializer, so any NEW substrate is auto-covered.
//   2. NO FALSE DESYNC - two REAL engines sharing state legitimately produce the SAME digest each wave.
//   3. DIVERGE + HEAL - two engines with a deliberately diverged money-streak counter now MISMATCH and
//      heal to convergence THROUGH the existing full-snapshot resync (also overstay + relic).
//   4. STORM GUARD - the healed substrates CONVERGE (so a real drift does not loop); an unconvergeable
//      one still trips the untouched #793 give-up cap (asserted here by construction: the constant + the
//      keyed-by-host-checksum give-up logic are unchanged; the multiwave test's `resyncs <= WAVES` holds).
//   5. TRANSFORM (#836) - a host Ditto/Imposter transform (copied identity in summonData, invisible to
//      speciesId) now converges on the pure-renderer guest through the per-turn field-snapshot heal.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-savedata-digest.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import {
  applyCoopFullSnapshot,
  captureCoopChecksumState,
  captureCoopFieldSnapshot,
  captureCoopFullSnapshot,
  captureCoopSaveDataDigest,
  captureCoopSaveDataNormalized,
} from "#data/elite-redux/coop/coop-battle-engine";
import {
  resetCoopBiomePickerDrivenByTest,
  setCoopBiomePickerDrivenByTest,
} from "#data/elite-redux/coop/coop-biome-pin-state";
import { CoopInteractionRelay, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, getCoopBattleStreamer, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { erAchvRun } from "#data/elite-redux/er-achievement-run-state";
import { type ErRouteNode, getErPendingNodes, setErPendingNodes } from "#data/elite-redux/er-biome-routing";
import {
  erBiomeOverstayAnchor,
  getErBiomeLength,
  getErBiomeStartWave,
  resetErBiomeStructure,
  restoreErBiomeStructure,
  setErBiomeOverstayAnchor,
} from "#data/elite-redux/er-biome-structure";
import {
  getRevealedMapNodes,
  resetErMapNodes,
  revealMapNodes,
  setAuthoritativeMapTravelClassification,
} from "#data/elite-redux/er-map-nodes";
import { getErMoneyStreakEntries, restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { getErRelicBattleState, restoreErRelicBattleState } from "#data/elite-redux/er-relic-battle-state";
import { restoreErResistBerries } from "#data/elite-redux/er-resist-berries";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { BerryModifier } from "#modifiers/modifier";
import { BerryModifierType } from "#modifiers/modifier-type";
import { SelectBiomePhase } from "#phases/select-biome-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  disposeDuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  setCoopHarnessModuleLetIsolation,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair, type ScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("#837 co-op full-save-data checksum digest + heal", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let activeRig: DuoRig | null;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    activeRig = null;
    setCoopWaveBarrierMs(50);
    // #858: the biome-pick tests below drive one side at a time, so the boundary barrier resolves via the
    // fast anti-hang timeout - keep it tiny + explicit (do not lean on the module-global vitest default).
    setCoopRendezvousWaitMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`savedata-digest-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH, MoveId.TRANSFORM])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
    setCoopHarnessModuleLetIsolation(false);
    setErPendingNodes([]);
    resetErMapNodes(); // #865: clear any revealed map nodes a test seeded so they don't leak
    resetErBiomeStructure();
    resetCoopBiomePickerDrivenByTest();
    logs.dispose();
    if (activeRig == null) {
      clearCoopRuntime();
    } else {
      disposeDuoRig(activeRig);
      activeRig = null;
    }
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

  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  async function buildSavedataDuo(pair: ReturnType<typeof createLoopbackPair>): Promise<DuoRig> {
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    activeRig = rig;
    return rig;
  }

  async function hostPlayWave(rig: DuoRig, guestCommandAlreadyCommitted = false): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      if (!guestCommandAlreadyCommitted) {
        game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
        game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      }
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
  }

  async function leaveRewardShop(rig: DuoRig): Promise<void> {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    if (hostOwns) {
      await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
      await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward: false }));
      await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
      await withClient(rig.hostCtx, () => drainLoopback());
      await withClient(rig.guestCtx, () => drainLoopback());
    } else {
      await withClient(rig.hostCtx, () => beginRewardShopWatch(hostShop));
      await withClient(rig.guestCtx, () => driveHostRewardShopOwner(guestShop, { takeReward: false }));
      await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true }));
      // A guest-owned UI action is still adjudicated by the host. The host watcher emits the retained
      // result, the guest owner applies it and publishes its new counter, then the host adopts that exact
      // counter before either phase queue may cross into the next encounter.
      await withClient(rig.guestCtx, () => drainLoopback());
      await withClient(rig.hostCtx, () => drainLoopback());
    }
  }

  it("GUARD: the digest is DERIVED FROM getSessionSaveData (new substrate auto-covered) + detects a substrate change", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);

    await withClient(rig.hostCtx, () => {
      // Every key the normalized view hashes MUST be a real key of getSessionSaveData() - i.e. the digest
      // is a PROJECTION of the serializer's output, never a hand-maintained parallel field list. This is
      // what makes a NEW substrate added to SessionSaveData automatically covered (it is not on the
      // exclusion denylist, so it flows straight into the digest).
      const session = globalScene.gameData.getSessionSaveData() as unknown as Record<string, unknown>;
      const normalized = captureCoopSaveDataNormalized();
      for (const key of Object.keys(normalized)) {
        expect(Object.hasOwn(session, key), `normalized key '${key}' is a real getSessionSaveData key`).toBe(true);
      }
      // The blind-spot substrates the fix targets MUST be present in the hashed view (not excluded).
      for (const key of ["erMoneyStreaks", "erRelicBattleState", "erMapState", "modifiers", "erWardStones"]) {
        expect(Object.hasOwn(normalized, key), `blind-spot substrate '${key}' is hashed by the digest`).toBe(true);
      }
      // DETECTION: mutating a substrate the base checksum is blind to (money-streak) changes the digest.
      const before = captureCoopSaveDataDigest();
      const saved = getErMoneyStreakEntries();
      restoreErMoneyStreaks([[424242, 9]]);
      expect(captureCoopSaveDataDigest(), "a money-streak change moves the save-data digest").not.toBe(before);
      restoreErMoneyStreaks(saved);
      expect(captureCoopSaveDataDigest(), "restoring the money-streak restores the digest").toBe(before);

      // LIVE wave-1 regression (build mrhpa314-147u): only the authoritative engine executes the
      // lethal-hit achievement tracker, so its PARALLEL_PLAY KO set advances while the renderer's does
      // not. This is account/progression bookkeeping, not battle state, and the battle snapshot cannot
      // (nor should it) overwrite it. It must therefore be excluded from the convergence comparator.
      const beforeAchievement = captureCoopSaveDataDigest();
      erAchvRun().parallelPlayKoIds.add(globalScene.getPlayerParty()[0].id);
      expect(
        captureCoopSaveDataDigest(),
        "host-only achievement bookkeeping does not manufacture an unhealable battle desync",
      ).toBe(beforeAchievement);
      erAchvRun().parallelPlayKoIds.clear();
      expect(Object.hasOwn(captureCoopSaveDataNormalized(), "erAchievementRunState")).toBe(false);
    });
    logs.flush();
  }, 300_000);

  it("NO FALSE DESYNC: two real engines produce the SAME save-data digest at each wave boundary", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair: ScheduledCoopPair = createScheduledCoopPair({ automatic: true });
    const rig = await buildSavedataDuo(pair);
    // Align the direct guest scene to the real TurnInit/Command queue. Its constructor starts on TitlePhase;
    // shiftPhase on an empty queue selects production TurnInitPhase, which builds both command slots.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    // The handshake may use ordinary delivery, but every gameplay continuation is delivered only while
    // its addressed client's complete process-global context is installed. This models two browser
    // processes and prevents either engine's async phase tail from running against its partner's scene.
    pair.setAutomaticDelivery(false);

    const WAVES = 3;
    for (let w = 1; w <= WAVES; w++) {
      // The full checksum states (which now INCLUDE saveDataDigest) match host-vs-guest at wave start.
      const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestStart.saveDataDigest, `wave ${w}: save-data digest matches host at wave start`).toBe(
        hostStart.saveDataDigest,
      );

      await driveDuoGuestTackleThroughPublicUi(game, rig, {
        restartAlreadyOpenHost: false,
        submitHostTackle: true,
      });
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig, true);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      const guestAuthorityTerminated = await withClient(
        rig.guestCtx,
        () => getCoopBattleStreamer()?.retainedAuthorityDiagnostics().terminal,
      );
      expect(
        guestAuthorityTerminated,
        `wave ${w}: renderer mutation never invalidates the immutable admitted authority ACK`,
      ).toBe(false);
      const hostPost = await withClient(rig.hostCtx, () => captureCoopSaveDataDigest());
      const guestPost = await withClient(rig.guestCtx, () => captureCoopSaveDataDigest());
      expect(guestPost, `wave ${w}: save-data digest matches host post-turn`).toBe(hostPost);

      await leaveRewardShop(rig);
      if (w < WAVES) {
        // Advance the real queues in authority order. The host first generates and publishes the next
        // encounter carrier; only then may the guest consume it and open the matching command surface.
        await withClient(rig.hostCtx, async () => {
          await game.phaseInterceptor.to("CommandPhase", false);
        });
        await withClient(rig.guestCtx, () =>
          driveClientPhaseQueueTo(rig.guestScene, `wave ${w + 1} CommandPhase`, {
            matches: phase => phase.phaseName === "CommandPhase" && rig.guestScene.currentBattle.waveIndex === w + 1,
          }),
        );
        expect(rig.hostScene.currentBattle.waveIndex, `wave ${w}: host opened wave ${w + 1}`).toBe(w + 1);
        expect(rig.guestScene.currentBattle.waveIndex, `wave ${w}: guest adopted wave ${w + 1}`).toBe(w + 1);
      }
    }
    logs.flush();
  }, 300_000);

  it("DIVERGE + HEAL: a deliberately diverged money-streak / overstay / relic MISMATCHES then heals to convergence via the resync", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);

    // Turn ON faithful per-client module-let isolation so the two engines can hold DIFFERENT module state
    // (production has one process per client; the shared-state default would collapse them onto one map).
    setCoopHarnessModuleLetIsolation(true);

    // Seed a KNOWN authoritative host state for the three module-let substrates.
    withClientSync(rig.hostCtx, () => {
      restoreErMoneyStreaks([
        [111, 4],
        [222, 7],
      ]);
      setErBiomeOverstayAnchor(13);
      restoreErRelicBattleState({ wave: 1, lists: { cursedIdol: [111, 222] } });
    });
    // Deliberately DIVERGE the guest's copies (a real host-vs-guest drift).
    withClientSync(rig.guestCtx, () => {
      restoreErMoneyStreaks([[999, 1]]);
      setErBiomeOverstayAnchor(null);
      restoreErRelicBattleState({ wave: 1, lists: {} });
    });

    const hostDigest = await withClient(rig.hostCtx, () => captureCoopSaveDataDigest());
    const guestDigestDiverged = await withClient(rig.guestCtx, () => captureCoopSaveDataDigest());
    expect(guestDigestDiverged, "the diverged guest digest MISMATCHES the host").not.toBe(hostDigest);

    // The host builds the authoritative full-snapshot (what the resync sends); the guest APPLIES it (the
    // exact production resync heal path). This is host-state -> wire -> guest-apply across two real engines.
    const snapshot = await withClient(rig.hostCtx, () => captureCoopFullSnapshot());
    expect(snapshot, "host built a full snapshot").not.toBeNull();
    expect(snapshot?.erMoneyStreaks, "the snapshot carries the host money-streak").toEqual([
      [111, 4],
      [222, 7],
    ]);
    expect(snapshot?.biomeOverstayAnchor, "the snapshot carries the host overstay anchor").toBe(13);

    const healed = withClientSync(rig.guestCtx, () => {
      applyCoopFullSnapshot(snapshot!, /* authoritativeGuest */ true, /* suppressResummon */ false);
      return {
        digest: captureCoopSaveDataDigest(),
        streaks: getErMoneyStreakEntries(),
        overstay: erBiomeOverstayAnchor(),
        relic: getErRelicBattleState(),
      };
    });
    expect(healed.digest, "the guest digest CONVERGED to the host after the resync heal").toBe(hostDigest);
    expect(healed.streaks, "money-streak healed through restoreErMoneyStreaks").toEqual([
      [111, 4],
      [222, 7],
    ]);
    expect(healed.overstay, "overstay anchor healed through setErBiomeOverstayAnchor").toBe(13);
    expect(healed.relic.lists.cursedIdol, "relic-battle-state healed through restoreErRelicBattleState").toEqual([
      111, 222,
    ]);
    logs.flush();
  }, 300_000);

  it("DIVERGE + HEAL (#841 item 5): a diverged biome-structure extent (length / start-wave) MISMATCHES the digest then heals via the resync", async () => {
    // The erMapState biome-structure trio (biomeOverstayAnchor + biomeLength + biomeStartWave) rides the
    // saveDataDigest (normalizeCoopErMapState), so a drift is DETECTED - but only the overstay anchor had a
    // heal. The rolled length + start wave (set by SwitchBiomePhase's erRollBiomeLength, which the pure-
    // renderer guest never runs) were carried by NO per-turn/resync heal, so a divergence loop-detected with
    // no heal path. This proves the extent now rides the full-snapshot resync + heals to convergence.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);

    // Biome-structure is process-global (er-biome-structure module state), so we set the divergent extents
    // INSIDE each digest-capture block (no per-client module-let isolation needed): the host rolled a variable
    // biome (length 12, entered on wave 11); the pure-renderer guest never ran SwitchBiomePhase so its extent
    // sits at the vanilla-cadence default (null length, start wave 1) - a real host-vs-guest drift.
    const hostDigest = await withClient(rig.hostCtx, () => {
      restoreErBiomeStructure(12, 11, null);
      return captureCoopSaveDataDigest();
    });
    const guestDiverged = await withClient(rig.guestCtx, () => {
      restoreErBiomeStructure(null, 1, null);
      return captureCoopSaveDataDigest();
    });
    expect(guestDiverged, "the diverged biome-structure extent MISMATCHES the host digest (detected)").not.toBe(
      hostDigest,
    );

    // The host (re-asserting its extent - the guest's set clobbered the shared module) builds the
    // authoritative full-snapshot; the guest APPLIES it (the production resync heal path).
    const snapshot = await withClient(rig.hostCtx, () => {
      restoreErBiomeStructure(12, 11, null);
      return captureCoopFullSnapshot();
    });
    expect(snapshot, "host built a full snapshot").not.toBeNull();
    expect(snapshot?.erBiomeStructure, "the snapshot carries the host biome-structure extent").toEqual({
      biomeLength: 12,
      biomeStartWave: 11,
    });

    const healed = await withClient(rig.guestCtx, () => {
      restoreErBiomeStructure(null, 1, null); // the guest's pre-heal divergent extent
      applyCoopFullSnapshot(snapshot!, /* authoritativeGuest */ true, /* suppressResummon */ false);
      return {
        digest: captureCoopSaveDataDigest(),
        length: getErBiomeLength(),
        startWave: getErBiomeStartWave(),
      };
    });
    expect(healed.length, "biome length healed through restoreErBiomeStructure").toBe(12);
    expect(healed.startWave, "biome start wave healed").toBe(11);
    expect(healed.digest, "the guest digest CONVERGED to the host after the biome-structure heal").toBe(hostDigest);
    logs.flush();
  }, 300_000);

  it("DIVERGE + HEAL (#865 / #841 item 1): a diverged erMapState (revealed nodes) MISMATCHES the digest then heals via the resync", async () => {
    // Audit #841 item 1: the ER world-map state (revealed onward nodes + travel target + Treasure-Map
    // fragments) rides the saveDataDigest, so a host-vs-guest map drift is DETECTED - but before #865 NO
    // per-turn/resync heal carried it, so a divergence loop-detected with NO heal path. Worse, the NATURAL
    // single-node biome-travel terminal (revealed.length===1, non-chained) relays no biomePick and relies on
    // both clients computing the SAME onward set from their OWN pending nodes (getErPendingNodes) - so a map
    // drift could land the two clients in DIFFERENT biomes. This proves the map state now rides the
    // full-snapshot resync (erMapState + the routing erPendingNodes) and heals to convergence.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);

    // The revealed-node set + pending nodes are process-global (er-map-nodes / er-biome-routing module
    // state), so - like the biome-structure test above - we set the divergent state INSIDE each
    // digest-capture block (no per-client module-let isolation needed).
    const hostBiome = BiomeId.VOLCANO;
    const hostNode = (): ErRouteNode[] => [{ biome: hostBiome, revealed: true }];
    const guestNodes = (): ErRouteNode[] => [
      { biome: BiomeId.FOREST, revealed: true },
      { biome: hostBiome, revealed: true },
    ];
    const seedMap = (nodes: ErRouteNode[]): void => {
      resetErMapNodes();
      setErPendingNodes(nodes);
      // A real string label (production uses getBiomeName) so the getErMapSaveData/restoreErMapState
      // round-trip keeps the node (restoreErMapState drops nodes whose label is not a string).
      revealMapNodes(
        nodes.filter(n => n.revealed).map(n => ({ biome: n.biome, label: `biome-${n.biome}`, kind: "biome" })),
      );
    };

    // HOST: a SINGLE revealed onward node (the natural single-node terminal - no picker, no relay).
    const hostDigest = await withClient(rig.hostCtx, () => {
      seedMap(hostNode());
      return captureCoopSaveDataDigest();
    });
    // GUEST: DIVERGENT map state - TWO revealed nodes (would open a picker the host never had).
    const guestDiverged = await withClient(rig.guestCtx, () => {
      seedMap(guestNodes());
      return captureCoopSaveDataDigest();
    });
    expect(guestDiverged, "the diverged revealed-node set MISMATCHES the host digest (detected)").not.toBe(hostDigest);

    // The host (re-asserting its single node - the guest's set clobbered the shared module) builds the
    // authoritative full-snapshot; the guest APPLIES it (the production resync heal path).
    const snapshot = await withClient(rig.hostCtx, () => {
      seedMap(hostNode());
      return captureCoopFullSnapshot();
    });
    expect(snapshot, "host built a full snapshot").not.toBeNull();
    expect(
      snapshot?.erPendingNodes?.map(n => n.biome),
      "the snapshot carries the host routing pending-node set",
    ).toEqual([hostBiome]);
    expect(
      snapshot?.erMapState?.nodes.map(n => n.biome),
      "the snapshot carries the host revealed map nodes",
    ).toEqual([hostBiome]);

    const healed = await withClient(rig.guestCtx, () => {
      seedMap(guestNodes()); // the guest's pre-heal divergent state
      applyCoopFullSnapshot(snapshot!, /* authoritativeGuest */ true, /* suppressResummon */ false);
      return {
        digest: captureCoopSaveDataDigest(),
        pending: getErPendingNodes().map(n => n.biome),
        nodes: getRevealedMapNodes()
          .filter(n => n.kind === "biome")
          .map(n => n.biome),
      };
    });
    // THE FIX: the guest ADOPTED the host's map state - a SINGLE onward node (both the routing pending set
    // the decision reads AND the revealed map overlay), so the natural single-node terminal is now coherent.
    expect(healed.pending, "the guest adopted the host's single routing pending node (#865)").toEqual([hostBiome]);
    expect(healed.nodes, "the guest adopted the host's revealed map nodes (#865)").toEqual([hostBiome]);
    expect(healed.digest, "the guest digest CONVERGED to the host after the erMapState heal (#841 item 1)").toBe(
      hostDigest,
    );
    logs.flush();
  }, 300_000);

  it("SAME BIOME (#841 item 1, owner-pick): the OWNER relays a NON-DEFAULT World-Map biome and BOTH engines adopt it", async () => {
    // Audit #841 item 1, FLIPPED for #848: the ER World-Map biome pick is no longer BYPASSED in co-op - it
    // is an OWNER-ALTERNATED, MIRRORED interaction (select-biome-phase.ts). The interaction OWNER drives the
    // real ER_MAP picker and relays its CHOSEN biome; the WATCHER adopts that biome verbatim. So both clients
    // converge on the OWNER'S CHOICE (which can be a NON-DEFAULT node, NOT the old deterministic roll) - no
    // split run, but the player's choice is honored. This drives the REAL SelectBiomePhase owner/watcher over
    // both engines and asserts they land in the SAME owner-chosen biome, distinct from the deterministic roll.
    // (The full owner/mirror/relay + crossroads chain lives in coop-duo-biome-choice.test.ts.)
    // This test DRIVES the real owner picker (mocked ER_MAP + invoked onSelect), so opt OUT of the vitest
    // owner auto-resolve (reset in afterEach).
    setCoopBiomePickerDrivenByTest();
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);

    // The guest is seed-pinned to the host (adoptCoopHostRunConfig, #658 - proven in coop-duo-launch-sync).
    expect(rig.guestScene.seed, "the guest is seed-pinned to the host").toBe(rig.hostScene.seed);

    const WAVE = 11; // a biome-boundary wave (not a %50 END wave)
    rig.hostScene.currentBattle.waveIndex = WAVE;
    rig.guestScene.currentBattle.waveIndex = WAVE;
    // Two REVEALED onward nodes (shared er-map state); the owner picks the SECOND (a non-default choice).
    const routeNodes = [
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true },
    ] satisfies ErRouteNode[];
    // The duo harness always isolates world-map routing state per simulated browser. Seed the route
    // inside BOTH client contexts; writing the ambient module let leaves each ctx's saved route unchanged.
    await withClient(rig.hostCtx, () => setErPendingNodes(routeNodes));
    await withClient(rig.guestCtx, () => setErPendingNodes(routeNodes));
    const chosen = BiomeId.VOLCANO;

    // What the OLD deterministic bypass WOULD have rolled (so we prove the owner's pick is honored INSTEAD).
    const deterministicRoll = await withClient(rig.hostCtx, () => {
      rig.hostScene.resetSeed(WAVE);
      return rig.hostScene.generateRandomBiome(WAVE + 1);
    });

    const counter = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counter % 2 === 0;
    const ownerCtx = hostOwns ? rig.hostCtx : rig.guestCtx;
    const watcherCtx = hostOwns ? rig.guestCtx : rig.hostCtx;
    const hostSwitch = vi.spyOn(rig.hostScene.phaseManager, "unshiftNew");
    const guestSwitch = vi.spyOn(rig.guestScene.phaseManager, "unshiftNew");
    const biomeArg = (spy: typeof hostSwitch): BiomeId | undefined =>
      spy.mock.calls.find(c => c[0] === "SwitchBiomePhase")?.[1] as BiomeId | undefined;

    // Headless UI capture: record the ER_MAP picker config so the owner can commit its non-default pick.
    interface ErMapMock {
      box: { onSelect?: (b: BiomeId) => void };
      restore: () => void;
    }
    const mockErMap = (scene: BattleScene): ErMapMock => {
      type BoundedResult = "completed" | "forced" | "superseded";
      const ui = scene.ui as unknown as {
        setMode: (m: number, ...a: unknown[]) => Promise<void>;
        setModeBoundedWhen: (
          m: number,
          timeoutMs: number,
          isCurrent: (() => boolean) | undefined,
          ...a: unknown[]
        ) => Promise<BoundedResult>;
      };
      const realSetMode = ui.setMode.bind(ui);
      const realSetModeBoundedWhen = ui.setModeBoundedWhen.bind(ui);
      const box: { onSelect?: (b: BiomeId) => void } = {};
      const capture = (m: number, a: unknown[]): void => {
        if (m === UiMode.ER_MAP) {
          box.onSelect = (a[0] as { onSelect: (b: BiomeId) => void }).onSelect;
        }
      };
      ui.setMode = (m: number, ...a: unknown[]): Promise<void> => {
        capture(m, a);
        return Promise.resolve();
      };
      ui.setModeBoundedWhen = (m, _timeoutMs, isCurrent, ...a): Promise<BoundedResult> => {
        if (!(isCurrent?.() ?? true)) {
          return Promise.resolve("superseded");
        }
        capture(m, a);
        return Promise.resolve("completed");
      };
      return {
        box,
        restore: () => {
          ui.setMode = realSetMode;
          ui.setModeBoundedWhen = realSetModeBoundedWhen;
        },
      };
    };

    const ownerMock = mockErMap(ownerCtx.scene);
    const watcherMock = mockErMap(watcherCtx.scene);
    try {
      // The harness drives the two clients sequentially. Materialize the watcher's production boundary
      // arrival first; a timeout is recovery telemetry and must never authorize the owner unilaterally.
      await withClient(watcherCtx, () => watcherCtx.runtime.rendezvous.arrive(`biomepick:${WAVE}`));
      await drainLoopback();
      // OWNER drives the real picker + relays its chosen biome (buffered for the watcher). #858: the picker
      // opens AFTER the reciprocal boundary barrier, which buffer-hits the watcher arrival above.
      await withClient(ownerCtx, async () => {
        const phase = liveSelectBiome();
        phase.start();
        for (let i = 0; i < 80 && ownerMock.box.onSelect == null; i++) {
          await drainLoopback();
        }
        expect(ownerMock.box.onSelect, "owner opened the ER_MAP picker after the boundary barrier").toBeDefined();
        ownerMock.box.onSelect!(chosen);
        await drainLoopback();
      });
      // WATCHER opens the mirrored copy + adopts the owner's relayed biome.
      await withClient(watcherCtx, async () => {
        // The harness alternates two engines in one JS process, so the owner's transition just consumed the
        // process-global classification that remains isolated in two real browsers. Re-materialize the exact
        // guest carrier field before driving its phase; the retained BIOME_PICK receipt remains untouched.
        setAuthoritativeMapTravelClassification(WAVE, null);
        const phase = liveSelectBiome();
        phase.start();
        for (let i = 0; i < 40; i++) {
          await drainLoopback();
          if (biomeArg(hostOwns ? guestSwitch : hostSwitch) !== undefined) {
            return;
          }
        }
        throw new Error("biome pick WATCH HANG: the watcher never adopted the owner's biome");
      });
    } finally {
      ownerMock.restore();
      watcherMock.restore();
    }

    // BOTH engines switch to the OWNER'S chosen biome (no split run) - and it is the player's pick, NOT the
    // old deterministic roll (so the choice is genuinely restored, not re-derived).
    expect(biomeArg(hostSwitch), "host adopts the owner's chosen biome").toBe(chosen);
    expect(biomeArg(guestSwitch), "guest adopts the SAME owner-chosen biome").toBe(chosen);
    expect(chosen, "the owner picked a NON-DEFAULT node (not the deterministic auto-roll)").not.toBe(deterministicRoll);
    logs.flush();
  }, 300_000);

  it("SAME BIOME (#841 item 1, missing commit): a disconnected owner cannot make the watcher advance unilaterally", async () => {
    // A missing raw relay and missing authoritative commit must leave the watcher fail-closed. Re-deriving a
    // destination locally used to look deterministic, but it allowed one client to enter SwitchBiomePhase
    // without proof that its partner committed the same route. Recovery/terminal supervision owns liveness;
    // this surface must never trade a bounded wait for unilateral gameplay mutation.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);

    expect(rig.guestScene.seed, "the guest is seed-pinned to the host").toBe(rig.hostScene.seed);

    const WAVE = 11;
    rig.hostScene.currentBattle.waveIndex = WAVE;
    rig.guestScene.currentBattle.waveIndex = WAVE;
    const routeNodes = [
      { biome: BiomeId.FOREST, revealed: true },
      { biome: BiomeId.VOLCANO, revealed: true },
    ] satisfies ErRouteNode[];
    await withClient(rig.hostCtx, () => setErPendingNodes(routeNodes));
    await withClient(rig.guestCtx, () => setErPendingNodes(routeNodes));
    // Force every raw relay await to time out. There is deliberately no retained authoritative receipt.
    vi.spyOn(CoopInteractionRelay.prototype, "awaitInteractionChoice").mockResolvedValue(null);

    const counter = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counter % 2 === 0;
    const ownerCtx = hostOwns ? rig.hostCtx : rig.guestCtx;
    const watcherCtx = hostOwns ? rig.guestCtx : rig.hostCtx;

    // The owner reached the shared boundary, then disappeared before committing its choice.
    await withClient(ownerCtx, () => ownerCtx.runtime.rendezvous.arrive(`biomepick:${WAVE}`));
    await drainLoopback();

    const hostCounter = rig.hostRuntime.controller.interactionCounter();
    const guestCounter = rig.guestRuntime.controller.interactionCounter();
    await withClient(watcherCtx, async () => {
      setAuthoritativeMapTravelClassification(WAVE, null);
      const spy = vi.spyOn(watcherCtx.scene.phaseManager, "unshiftNew");
      const phase = liveSelectBiome();
      phase.start();
      for (let i = 0; i < 80; i++) {
        await drainLoopback();
      }
      expect(
        spy.mock.calls.some(c => c[0] === "SwitchBiomePhase"),
        "the watcher never derives or applies a biome without the owner's retained commit",
      ).toBe(false);
    });
    expect(rig.hostRuntime.controller.interactionCounter(), "the disconnected owner did not advance").toBe(hostCounter);
    expect(rig.guestRuntime.controller.interactionCounter(), "the watcher did not advance alone").toBe(guestCounter);
    logs.flush();
  }, 300_000);

  it("GRANTED-MON HELD ITEM (#839): host + guest hold the SAME berry + streak on a slot-0 mon with DIFFERENT local ids -> save-data digest MATCHES", async () => {
    // The live #839 softlock root: an ME-GRANTED mon (species 6100) is MATERIALIZED independently on
    // each client, so its `Pokemon.id` DIFFERS host-vs-guest. Every save-data field keyed by that raw id
    // (a held-item modifier's `getArgs()[0]`, a money-streak `[id, streak]` entry) then diverged the
    // saveDataDigest FOREVER - the me-entry checksum never healed, the ME loop wedged. The fix: held
    // items are EXCLUDED from the digest (their per-mon identity + stacks ride the base checksum's
    // bi-keyed `heldItems` field), and mon-keyed ER substrates map the id to their stable party SLOT.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);
    // Per-client module-let isolation so the two engines can hold DIFFERENT money-streak maps (production
    // is one process per client; the shared-state default would collapse them onto one map).
    setCoopHarnessModuleLetIsolation(true);

    const HOST_ID = 111_111; // the host's local id for the granted slot-0 mon
    const GUEST_ID = 999_999; // the guest's DIFFERENT local id for the SAME slot-0 mon (the #839 root)

    // Attach the SAME Sitrus berry + the SAME money-streak (survived 5 waves) to slot 0 on BOTH engines,
    // each keyed by that engine's OWN divergent local id.
    const seed = (id: number) => {
      const lead = globalScene.getPlayerParty()[0];
      lead.id = id;
      globalScene.addModifier(new BerryModifier(new BerryModifierType(BerryType.SITRUS), id, BerryType.SITRUS), true);
      restoreErMoneyStreaks([[id, 5]]);
      restoreErResistBerries([[id, PokemonType.FIRE]]);
    };
    const hostDigest = withClientSync(rig.hostCtx, () => {
      seed(HOST_ID);
      // Structural proof: the berry is EXCLUDED from the normalized modifier view (per-client id gone),
      // and the money-streak key is the stable slot token, not the raw id.
      const normalized = captureCoopSaveDataNormalized();
      expect(
        (normalized.modifiers as { className: string }[]).some(m => m.className === "BerryModifier"),
        "the held-item berry is EXCLUDED from the save-data digest's modifier view (#839)",
      ).toBe(false);
      expect(normalized.erMoneyStreaks, "the money-streak id normalized to its stable party slot token").toEqual([
        ["p0", 5],
      ]);
      expect(
        normalized.erResistBerries,
        "the legacy resist-berry id normalized to its stable party slot token",
      ).toEqual([["p0", PokemonType.FIRE]]);
      return captureCoopSaveDataDigest();
    });
    const guestDigest = withClientSync(rig.guestCtx, () => {
      seed(GUEST_ID);
      return captureCoopSaveDataDigest();
    });
    expect(guestDigest, "the digest MATCHES despite the granted mon's divergent per-client ids (#839)").toBe(
      hostDigest,
    );

    // CONTROL 1 - id-normalization does NOT blind a REAL drift: a money-streak VALUE change still moves
    // the digest (only the per-client id is normalized away, the streak count stays hashed).
    const guestDrifted = withClientSync(rig.guestCtx, () => {
      restoreErMoneyStreaks([[GUEST_ID, 7]]);
      return captureCoopSaveDataDigest();
    });
    expect(
      guestDrifted,
      "a money-streak VALUE change still diverges the digest (id-normalization is not a blind-spot)",
    ).not.toBe(hostDigest);

    // CONTROL 2 - restoring the streak value re-converges (deterministic, no residual divergence).
    const guestRestored = withClientSync(rig.guestCtx, () => {
      restoreErMoneyStreaks([[GUEST_ID, 5]]);
      return captureCoopSaveDataDigest();
    });
    expect(guestRestored, "restoring the streak value re-converges the digest to the host").toBe(hostDigest);
    logs.flush();
  }, 300_000);

  it("TRANSFORM (#836): a host Ditto/Imposter transform converges on the pure-renderer guest through the field-snapshot heal", async () => {
    // Re-state this scenario's required moves at its launch boundary. Grouped external shards deliberately
    // reuse one controller, and another scenario can leave a Splash-only override behind despite module
    // isolation; this proof must never depend on file order to give Ditto Transform.
    game.override.moveset([MoveId.TRANSFORM, MoveId.TACKLE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.DITTO, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildSavedataDuo(pair);
    wireGuestCommand(rig);

    // Host lead (Ditto) TRANSFORMs into the enemy Magikarp; partner TACKLEs the other enemy.
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TRANSFORM, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // The host's lead is now transformed (copied identity in summonData, species stays DITTO).
    const hostLead = await withClient(rig.hostCtx, () => {
      const lead = rig.hostScene.getPlayerField()[0];
      return {
        species: lead.species.speciesId,
        transformed: lead.isTransformed(),
        formSpecies: lead.summonData.speciesForm?.speciesId ?? 0,
      };
    });
    expect(hostLead.species, "host lead is still base DITTO").toBe(SpeciesId.DITTO);
    expect(hostLead.transformed, "host lead transformed").toBe(true);
    expect(hostLead.formSpecies, "host lead copied MAGIKARP").toBe(SpeciesId.MAGIKARP);

    // The guest replays the turn; the per-turn field snapshot carries + applies the transform.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    const guestLead = await withClient(rig.guestCtx, () => {
      const lead = rig.guestScene.getPlayerField()[0];
      return { transformed: lead.isTransformed(), formSpecies: lead.summonData.speciesForm?.speciesId ?? 0 };
    });
    expect(guestLead.transformed, "the guest's lead CONVERGED to transformed").toBe(true);
    expect(guestLead.formSpecies, "the guest's lead copied the SAME species (MAGIKARP) as the host").toBe(
      SpeciesId.MAGIKARP,
    );
    logs.flush();
  }, 300_000);

  it("TRANSFORM round-trip: readFullMon captures + applyFullMon restores the copied summonData identity", async () => {
    // A focused single-engine proof that the snapshot carry+restore is exact: transform a mon, capture the
    // field snapshot, CLEAR the summonData transform (simulate a not-yet-transformed guest), re-apply, and
    // assert the copied identity is restored byte-for-byte through the same production readFullMon/applyFullMon.
    await game.classicMode.startBattle(SpeciesId.DITTO);
    game.move.select(MoveId.TRANSFORM, 0, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("TurnEndPhase");

    const lead = globalScene.getPlayerField()[0];
    expect(lead.isTransformed(), "the Ditto transformed").toBe(true);
    const copiedSpecies = lead.summonData.speciesForm?.speciesId ?? 0;
    expect(copiedSpecies, "copied a real species").toBeGreaterThan(0);
    const copiedMoves = lead.getMoveset().map(m => m.moveId);

    const fieldSnap = captureCoopFieldSnapshot();
    expect(fieldSnap, "captured a field snapshot").not.toBeNull();
    const leadSnap = fieldSnap!.find(s => s.bi === lead.getBattlerIndex());
    expect(leadSnap?.transform?.speciesId, "the snapshot carried the copied species").toBe(copiedSpecies);

    // Wipe the guest-side transform, then heal from the snapshot.
    lead.summonData.speciesForm = null;
    lead.summonData.moveset = null;
    lead.summonData.types = [];
    expect(lead.isTransformed(), "cleared the transform").toBe(false);

    // Apply the ORIGINAL (transformed) snapshot back onto the mon via the full-snapshot resync path.
    applyCoopFullSnapshot(
      {
        tick: 999_999,
        field: [leadSnap!],
        weather: globalScene.arena.weather?.weatherType ?? 0,
        weatherTurnsLeft: 0,
        terrain: globalScene.arena.terrain?.terrainType ?? 0,
        terrainTurnsLeft: 0,
        arenaTags: [],
        party: globalScene.getPlayerParty().map(p => p.species.speciesId),
        money: globalScene.money,
        modifiers: [],
      },
      true,
      false,
    );
    const restored = globalScene.getPlayerField()[0];
    expect(restored.isTransformed(), "the transform was RESTORED by the heal").toBe(true);
    expect(restored.summonData.speciesForm?.speciesId ?? 0, "restored the same copied species").toBe(copiedSpecies);
    expect(
      restored.getMoveset().map(m => m.moveId),
      "restored the copied moveset",
    ).toEqual(copiedMoves);
  }, 300_000);
  it("NO FALSE DESYNC (#846): a WAVE-CROSSING transient (host-ahead waveIndex / relic wave) does NOT move the digest, but a relic-LISTS change does", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const startWave = globalScene.currentBattle.waveIndex;

    // Baseline digest at the current wave (fresh relic state, empty lists).
    const d0 = captureCoopSaveDataDigest();

    // Simulate the HOST-AHEAD wave-crossing window (#846): the host advanced its waveIndex (post-victory)
    // while the pure-renderer guest is a wave behind. `waveIndex` is excluded and `erRelicBattleState.wave`
    // (which IS the waveIndex) is normalized out, so this transient must NOT move the digest - the exact
    // FALSE desync the level soak hit at wave 52 (host 53 vs guest 52).
    globalScene.currentBattle.waveIndex = startWave + 1;
    restoreErRelicBattleState({ wave: startWave + 1, lists: {} });
    const d1 = captureCoopSaveDataDigest();
    expect(d1, "the host-ahead waveIndex / relic-wave skew leaves the digest UNCHANGED").toBe(d0);

    // DETECTION preserved: a real per-battle relic LISTS divergence still moves the digest (the sync-relevant
    // part is kept; only the wave-coupled transient is dropped).
    restoreErRelicBattleState({ wave: startWave + 1, lists: { cursedIdol: [7] } });
    const d2 = captureCoopSaveDataDigest();
    expect(d2, "a real relic-lists change still moves the digest (detection preserved)").not.toBe(d1);
  }, 300_000);
});
