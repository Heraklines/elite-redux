/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op PARTY-TARGET reward items (#719). The duo harness historically drove only
// NON-party rewards + leave (a party-target reward opens the party UI to pick WHICH mon receives it,
// which the headless autopilot could not drive) - so the WHOLE party-target item class (Rare Candy,
// vitamins, mints, ability capsules, evo/form items, TMs) was UNTESTED across two engines. That is
// exactly the gap a LIVE report hit: RARE_CANDY did not sync (one player's mon leveled, the other's
// did not). This file closes the hole with driveHostPartyRewardOwner (it stubs the ONE party-UI open
// to auto-pick a slot, driving the GENUINE owner relay) and asserts the picked mon's LEVEL converges
// on BOTH engines, in BOTH ownership directions (host-owned even counter, guest-owned odd counter).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-reward-items.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BerryModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type DuoRig,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostPartyRewardOwner,
  forceItemRewards,
  installDuoLogCapture,
  pumpDuoDestinations,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO party-target reward items: apply + sync across two engines (#719)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`reward-items-${Date.now()}`);
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
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** Drive ONE host wave to a win; the partner slot came through the guest's real public command UI. */
  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
  }

  /** Reach + drive ONE alternating reward interaction where the OWNER picks party-target SLOT. Parks
   *  the watcher first so the real reciprocal shop boundary opens, then drives the owner and drains the
   *  retained result at its destination. No cross-wave (the candy's downstream move-learn is a SEPARATE
   *  concern - see the test note). */
  async function driveOneSlotReward(rig: DuoRig, slot: number): Promise<{ counterBefore: number; hostOwns: boolean }> {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    expect(hostShop.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
    // Slot must be the SAME mon on both engines for the convergence assertions to mean anything.
    expect(
      rig.guestScene.getPlayerParty()[slot]?.species.speciesId,
      `guest slot ${slot} is the same species as host`,
    ).toBe(rig.hostScene.getPlayerParty()[slot]?.species.speciesId);
    if (hostOwns) {
      expect(
        await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop)),
        "guest watcher parked on the host-owned reward",
      ).toBe(counterBefore);
      await withClient(rig.hostCtx, () => driveHostPartyRewardOwner(hostShop, { slot }));
      await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
    } else {
      expect(
        await withClient(rig.hostCtx, () => beginRewardShopWatch(hostShop)),
        "host watcher parked on the guest-owned reward",
      ).toBe(counterBefore);
      await withClient(rig.guestCtx, () => driveHostPartyRewardOwner(guestShop, { slot }));
      await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop, { alreadyStarted: true }));
    }
    await pumpDuoDestinations(rig);
    // The alternating-interaction counter advanced exactly once on BOTH engines (lockstep).
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the counter once").toBe(counterBefore + 1);
    return { counterBefore, hostOwns };
  }

  it("party-target rewards apply + SYNC on both engines: held item (host-owned) + RARE_CANDY level (guest-owned)", async () => {
    // Wave 1 forces a LEFTOVERS held item (a PokemonHeldItemModifierType, party-target, NO level change
    // -> no downstream move-learn, so the wave-cross stays clean). Wave 2 forces a RARE_CANDY (the LIVE
    // report: a party-target level-up). We DON'T cross after the candy: a candy that crosses a move-learn
    // threshold queues an interactive LearnMovePhase (its own co-op concern, tracked separately) - here we
    // verify the LEVEL itself converges, which is the reported desync.
    const SLOT = 0;
    forceItemRewards(game.override, [{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    pair.setAutomaticDelivery(false);

    // ===== WAVE 1 (host-owned, even counter): a party-target HELD ITEM. =====
    {
      await driveDuoGuestTackleThroughPublicUi(game, rig, { restartAlreadyOpenHost: true });
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      const hostModsBefore = rig.hostScene.modifiers.length;
      const guestModsBefore = rig.guestScene.modifiers.length;
      const { hostOwns } = await driveOneSlotReward(rig, SLOT);
      expect(hostOwns, "wave 1 reward is host-owned (even counter)").toBe(true);
      // The held item was granted on the OWNER's engine AND mirrored on the WATCHER's (the relayed pick
      // applied against the identical pool) - modifier counts move together, no desync.
      expect(rig.hostScene.modifiers.length, "wave 1: host granted the held item").toBe(hostModsBefore + 1);
      expect(rig.guestScene.modifiers.length, "wave 1: guest mirrored the held-item grant (no desync)").toBe(
        guestModsBefore + 1,
      );
    }

    // ===== Cross to wave 2 (LEFTOVERS triggers no level-up -> no LearnMovePhase -> clean cross). =====
    forceItemRewards(game.override, [{ name: "RARE_CANDY" }]);
    await withClient(rig.hostCtx, async () => {
      // Run the real host transition first so NextEncounterPhase publishes the immutable wave-2
      // enemy carrier. Stop before CommandPhase starts: neither peer may satisfy the reciprocal
      // command rendezvous until the guest has consumed its own queued transition.
      await game.phaseInterceptor.to("CommandPhase", false);
    });
    expect(rig.hostScene.currentBattle.waveIndex, "host advanced to wave 2").toBe(2);
    await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "wave 2 CommandPhase", {
        matches: phase => phase.phaseName === "CommandPhase" && rig.guestScene.currentBattle.waveIndex === 2,
      }),
    );
    expect(rig.guestScene.currentBattle.waveIndex, "guest consumed the real wave-2 carrier").toBe(2);
    await driveDuoGuestTackleThroughPublicUi(game, rig);

    // ===== WAVE 2 (guest-owned, odd counter): a party-target RARE_CANDY (the live desync). =====
    {
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      const hostLvlBefore = rig.hostScene.getPlayerParty()[SLOT].level;
      const guestLvlBefore = rig.guestScene.getPlayerParty()[SLOT].level;
      const { hostOwns } = await driveOneSlotReward(rig, SLOT);
      expect(hostOwns, "wave 2 reward is guest-owned (odd counter)").toBe(false);
      // The picked mon gained a level on the OWNER (guest) engine AND the WATCHER (host) mirrored the
      // SAME +1 - both engines agree on the leveled mon (the RARE_CANDY desync the player reported).
      expect(rig.guestScene.getPlayerParty()[SLOT].level, "wave 2: guest (owner) leveled the picked mon").toBe(
        guestLvlBefore + 1,
      );
      expect(rig.hostScene.getPlayerParty()[SLOT].level, "wave 2: host (watcher) mirrored the SAME level-up").toBe(
        hostLvlBefore + 1,
      );
      expect(
        rig.hostScene.getPlayerParty()[SLOT].level,
        "wave 2: both engines agree on the leveled mon (no RARE_CANDY desync)",
      ).toBe(rig.guestScene.getPlayerParty()[SLOT].level);
    }
    logs.flush();
  }, 300_000);

  it("a guest-owned generated BERRY reward preserves holder + concrete berry identity on both engines", async () => {
    const SLOT = 1;
    forceItemRewards(game.override, [{ name: "BERRY" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });
    pair.setAutomaticDelivery(false);

    // Force the first reward interaction onto the guest-owned odd counter: this is the live direction that
    // produced one host-only berry on the guest lead while every earlier turn checksum still matched.
    await withClient(rig.hostCtx, () => rig.hostRuntime.controller.advanceInteraction());
    await withClient(rig.guestCtx, () => rig.guestRuntime.controller.advanceInteraction());

    await driveDuoGuestTackleThroughPublicUi(game, rig, { restartAlreadyOpenHost: true });
    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));
    const { hostOwns } = await driveOneSlotReward(rig, SLOT);
    expect(hostOwns, "the forced berry reward is guest-owned").toBe(false);

    const berries = (scene: BattleScene): BerryModifier[] => {
      const mon = scene.getPlayerParty()[SLOT];
      return scene.modifiers.filter(
        (modifier): modifier is BerryModifier => modifier instanceof BerryModifier && modifier.pokemonId === mon.id,
      );
    };
    const hostBerries = berries(rig.hostScene);
    const guestBerries = berries(rig.guestScene);
    expect(hostBerries, "host watcher applied exactly one berry to the relayed slot").toHaveLength(1);
    expect(guestBerries, "guest owner applied exactly one berry to its local slot").toHaveLength(1);
    expect(guestBerries[0].berryType, "generated berry pregen identity survived option streaming").toBe(
      hostBerries[0].berryType,
    );
    expect(Object.values(BerryType)).toContain(hostBerries[0].berryType);
    expect(
      await withClient(rig.guestCtx, () => captureCoopChecksum()),
      "the post-reward guest checksum equals the host without waiting for a battle resync",
    ).toBe(await withClient(rig.hostCtx, () => captureCoopChecksum()));
    logs.flush();
  }, 300_000);
});
