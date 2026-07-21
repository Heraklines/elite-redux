/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op REVIVE-in-shop sync (live seed 5ncYiLOw1a4JQZ0MAzWA1izj, both parties down to ~2 live
// mons). A Revive / Max Revive is a PARTY-TARGET modifier (#719 class) applied OFF-FIELD to a FAINTED bench
// mon: the owner restores its HP + clears the fainted flag. The reported desync: the owner sees the mon
// revived, the PARTNER never does - the revived bench mon stays fainted on the watcher's client (it then
// "can't be sent out" / re-faints on summon). Unlike RARE_CANDY (which the #719 test already covers) a
// revive changes NO level, so the per-turn checksum - which hashes party speciesId + LEVELS but NOT bench-mon
// hp/fainted - cannot even DETECT the divergence, so it never self-heals: the watcher must apply the relayed
// revive itself.
//
// This repro faints a bench mon on BOTH engines, forces a REVIVE reward, drives the GENUINE owner party-target
// relay (driveHostPartyRewardOwner) + the watcher (driveGuestRewardWatch), and asserts the revived mon is
// alive (hp>0, fainted=false) on BOTH engines with ZERO forced resyncs.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-revive-sync.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  beginRewardShopWatch,
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostPartyRewardOwner,
  forceItemRewards,
  installCoopResyncProbe,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The FAINTED bench slot the Revive targets (a host-owned bench mon, off-field). */
const REVIVE_SLOT = 2;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO revive-in-shop: a Revive on a fainted bench mon syncs to BOTH engines (#719)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let resyncProbe: CoopResyncProbe | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`revive-sync-${Date.now()}`);
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
    resyncProbe?.restore();
    resyncProbe = undefined;
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /** Wire the guest's OWN-slot command answer (the genuine production CoopBattleSync relay). */
  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  /** Drive ONE host wave to a win (both player slots FIGHT the frail enemies) under the host ctx. */
  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
  }

  it("a fainted bench mon revived in the shop is ALIVE on both engines (owner + watcher), no resync", async () => {
    forceItemRewards(game.override, [{ name: "REVIVE" }]);
    await game.classicMode.startBattle(
      SpeciesId.SNORLAX, // 0 host lead
      SpeciesId.GENGAR, // 1 guest lead
      SpeciesId.CHARIZARD, // 2 host bench (FAINTED - the Revive target)
    );
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // FAINT the bench mon (slot 2) on BOTH engines, so the Revive has a legal fainted target on each.
    for (const scene of [rig.hostScene, rig.guestScene]) {
      const mon = scene.getPlayerParty()[REVIVE_SLOT];
      mon.hp = 0;
      mon.status = null;
    }
    expect(rig.hostScene.getPlayerParty()[REVIVE_SLOT].isFainted(), "host bench mon starts fainted").toBe(true);
    withClientSync(rig.guestCtx, () => {
      expect(rig.guestScene.getPlayerParty()[REVIVE_SLOT].isFainted(), "guest bench mon starts fainted").toBe(true);
    });

    // Play wave 1 to a win + replay it on the guest (reaches the reward shop on both).
    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    // WAVE-1 shop is HOST-owned (interaction counter 0, even). Probe the WATCHER (guest) for forced resyncs.
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore % 2, "wave-1 shop is host-owned (even counter)").toBe(0);
    resyncProbe = installCoopResyncProbe(rig.guestRuntime);

    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    expect(hostShop.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
    const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));

    // OWNER (host) picks the REVIVE onto the fainted bench slot; WATCHER (guest) mirrors the relayed pick.
    // V2 reciprocal shop rendezvous: park the watcher at shop:<wave>:<counter> BEFORE the owner commits so
    // the commit is admitted (not refused into a shared-session terminal), then drain its relayed terminal.
    await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));
    await withClient(rig.hostCtx, () => driveHostPartyRewardOwner(hostShop, { slot: REVIVE_SLOT }));
    await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));

    // The interaction advanced once on both (lockstep).
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the counter once").toBe(counterBefore + 1);

    // OWNER: the fainted bench mon is now ALIVE on the host.
    const hostRevived = rig.hostScene.getPlayerParty()[REVIVE_SLOT];
    expect(hostRevived.hp > 0 && !hostRevived.isFainted(), "owner (host) revived the bench mon").toBe(true);

    // WATCHER (the reported desync): the SAME bench mon is ALIVE on the guest - the relayed revive applied,
    // not silently dropped. Pre-fix the guest never saw the HP/faint-clear and the mon stayed fainted.
    withClientSync(rig.guestCtx, () => {
      const guestRevived = rig.guestScene.getPlayerParty()[REVIVE_SLOT];
      expect(
        guestRevived.hp > 0 && !guestRevived.isFainted(),
        "watcher (guest) mirrored the revive - the bench mon is alive on both engines (no revive desync)",
      ).toBe(true);
      expect(guestRevived.hp, "both engines agree on the revived mon's HP").toBe(hostRevived.hp);
    });

    // ZERO forced resyncs across the revive interaction (a resync would be a player-facing divergence).
    expect(resyncProbe.count(), "the revive-in-shop interaction forced NO resync").toBe(0);

    logs.flush();
  }, 300_000);
});
