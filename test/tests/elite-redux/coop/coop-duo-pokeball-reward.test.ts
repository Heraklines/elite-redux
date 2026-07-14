/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op POKEBALL reward sync (#843). Repro for the soak's postShopScalarOverGrant finding:
// a ball reward TAKEN by the OWNER must leave BOTH engines' pokeballCounts EQUAL (owner grants + relays,
// watcher mirrors), and it must STAY equal across the next wave's authoritative turn (the SET must not
// race the ADD). The bug: the guest ends up with MORE balls than the host after the shop.
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-pokeball-reward.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  arriveGuestCommandBoundary,
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  forceItemRewards,
  installDuoLogCapture,
  pumpDuoDestinations,
  reachQueuedRewardShop,
  remirrorWave,
  type ShopPhaseSeam,
  withClient,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair, type ScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO pokeball reward: ball grant SYNCs across two engines (#843)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`pokeball-reward-${Date.now()}`);
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
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
  }

  /** Drive ONE alternating reward interaction where the OWNER TAKES the forced (non-party) ball reward. */
  async function driveBallReward(rig: DuoRig, pair: ScheduledCoopPair): Promise<{ hostOwns: boolean }> {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    // Command request/reply uses ordinary automatic delivery. At the reward boundary, queue every frame
    // until its destination ClientCtx is installed: a real browser can never resume the host watcher's
    // await against the guest's global scene (or vice versa).
    pair.setAutomaticDelivery(false);
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    expect(hostShop.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    if (hostOwns) {
      const watcherPinned = await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
      expect(watcherPinned, "guest watcher parked before the host-owned ball pick").toBe(counterBefore);
      await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward: true }));
      await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
    } else {
      // The host is still the option authority on a guest-owned reward. Starting its real watcher first
      // both arrives at the reciprocal shop barrier and streams the canonical pool the guest must adopt
      // before a human-visible pick can occur. Driving the guest first let the 50 ms harness barrier expire,
      // observed an empty not-yet-adopted pool, and silently exercised LEAVE instead of the asserted TAKE.
      const watcherPinned = await withClient(rig.hostCtx, () => beginRewardShopWatch(hostShop));
      expect(watcherPinned, "host watcher parked before the guest-owned ball pick").toBe(counterBefore);
      await withClient(rig.guestCtx, () => driveHostRewardShopOwner(guestShop, { takeReward: true }));
      await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true }));
    }
    // A guest-owned TAKE is an intent: the host watcher commits it, then the retained result must return
    // to the guest owner before either scene is inspected. Real browsers receive that final hop in the
    // guest process; the one-realm harness closes it explicitly under each destination context.
    await pumpDuoDestinations(rig, 8);
    pair.setAutomaticDelivery(true);
    return { hostOwns };
  }

  it("a ball reward taken by EITHER owner leaves host & guest pokeballCounts EQUAL (and stays equal next wave)", async () => {
    const ballCount = (s: BattleScene): number => (s.pokeballCounts as Record<number, number>)[PokeballType.GREAT_BALL];
    forceItemRewards(game.override, [{ name: "GREAT_BALL" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const hostBase = ballCount(rig.hostScene);
    const guestBase = ballCount(rig.guestScene);
    expect(guestBase, "guest starts with the same GREAT_BALL count as host").toBe(hostBase);

    // ===== WAVE 1 (host-owned, even counter): take the ball reward. =====
    {
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      const { hostOwns } = await driveBallReward(rig, pair);
      expect(hostOwns, "wave 1 reward is host-owned").toBe(true);
      expect(ballCount(rig.hostScene), "wave 1: host granted +5 great balls").toBe(hostBase + 5);
      expect(ballCount(rig.guestScene), "wave 1: guest (watcher) mirrored the SAME +5 (no drift)").toBe(guestBase + 5);
    }

    // ===== Cross to wave 2 (force another ball reward). =====
    forceItemRewards(game.override, [{ name: "GREAT_BALL" }]);
    await arriveGuestCommandBoundary(rig, 2);
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase");
    });
    expect(rig.hostScene.currentBattle.waveIndex, "host advanced to wave 2").toBe(2);
    await remirrorWave(rig);

    // ===== WAVE 2 (guest-owned, odd counter): take the ball reward. =====
    {
      const hostBefore = ballCount(rig.hostScene);
      const guestBefore = ballCount(rig.guestScene);
      expect(guestBefore, "wave 2 start: guest ball count matches host (no residual drift)").toBe(hostBefore);
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      const { hostOwns } = await driveBallReward(rig, pair);
      expect(hostOwns, "wave 2 reward is guest-owned").toBe(false);
      expect(ballCount(rig.guestScene), "wave 2: guest (owner) granted +5 great balls").toBe(guestBefore + 5);
      expect(ballCount(rig.hostScene), "wave 2: host (watcher) mirrored the SAME +5 (no drift)").toBe(hostBefore + 5);
      expect(ballCount(rig.hostScene), "wave 2: both engines agree on the ball count").toBe(ballCount(rig.guestScene));
    }
    logs.flush();
  }, 300_000);
});
