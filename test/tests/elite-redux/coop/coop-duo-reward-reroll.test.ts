/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PROBE #809 (matrix probe 3): REWARD-SHOP REROLL convergence across two engines. The reward-pick OWNER
// (host at interaction counter 0) REROLLS the shop: rerollModifiers deducts the reroll cost, unshifts a
// FRESH SelectModifierPhase (rerollCount+1) that re-rolls the option pool, and relays COOP_INTERACTION_REROLL
// (carrying the post-reroll money tag, #698). The WATCHER (guest) must (a) reroll its identical pool in
// lockstep + ADOPT the owner's newly-rolled option list for the new reroll round (the rewardOptions relay is
// keyed by [interactionCounter, rerollCount], so a stale round can't leak in), and (b) SET its money to the
// owner's streamed post-reroll value (the reroll cost deduction converges - no per-client cost recompute).
//
// This probe drives the owner through a REAL reroll then a leave, and the guest through its REAL two-round
// watch (round-0 adopt -> REROLL -> round-1 adopt -> LEAVE), and asserts: the guest adopted the EXACT
// rerolled option-id list the host rolled for round 1, the money deduction converged (both engines land on
// host_money0 - rerollCost), and the interaction counter advanced ONCE in lockstep on both engines.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-reward-reroll.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
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
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Enough money that the reroll is never gated by cost (rerollModifiers early-outs when money < cost). */
const SHOP_MONEY = 1_000_000;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** The reward-shop seam we drive for the reroll (extends the harness ShopPhaseSeam with rerollModifiers). */
interface RerollShopSeam extends ShopPhaseSeam {
  rerollModifiers(): boolean;
  rerollCount: number;
}

/** The reward option-id list currently on a shop phase (the identity we compare across engines). */
function optionIds(shop: ShopPhaseSeam): number[] {
  return (shop.typeOptions as { type?: { id?: number } }[]).map(o => o.type?.id ?? -1);
}

describe.skipIf(!RUN)(
  "co-op DUO reward reroll: the watcher adopts the rerolled options + the money deduction converges (#809)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // #788 v2 partner-sync gate: a tiny barrier so the manually-driven shop leave proceeds via the gate's
      // timeout fallback instead of the 60s live default.
      setCoopWaveBarrierMs(50);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`reward-reroll-${Date.now()}`);
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
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
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
        await game.phaseInterceptor.to("TurnEndPhase");
      });
    }

    it("owner rerolls then leaves; the watcher adopts the rerolled option list + money converges", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Play wave 1 to a win + replay it on the guest (reaches the reward shop on both engines).
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      // WAVE-1 shop is HOST-owned (interaction counter 0, even).
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore % 2, "wave-1 shop is host-owned (even counter)").toBe(0);

      // Set an IDENTICAL, generous money baseline on both engines so the reroll is never cost-gated and the
      // post-reroll convergence is measured against a known equal start.
      rig.hostScene.money = SHOP_MONEY;
      rig.guestScene.money = SHOP_MONEY;

      // Reach the host's live SelectModifierPhase (round 0).
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("SelectModifierPhase", false);
      });
      const hostShop0 = withClientSync(rig.hostCtx, () =>
        rig.hostScene.phaseManager.getCurrentPhase(),
      ) as unknown as RerollShopSeam;
      expect(hostShop0.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
      // Follow the same queued Victory -> BattleEnd -> SelectModifier transition as production. A detached
      // phase never owns the guest's public surface, so the retained transition is correct to reject it.
      const guestShop0 = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));

      // ===== OWNER SIDE (host): start round 0, capture its options, REROLL, then start + leave round 1. =====
      let hostOptionIds1: number[] = [];
      let hostMoneyAfterReroll = -1;
      await withClient(rig.hostCtx, async () => {
        hostShop0.start(); // streams round-0 options + opens the owner screen (pins counter 0)
        await drainLoopback();
        expect(hostShop0.rerollCount, "round 0 has rerollCount 0").toBe(0);

        // REROLL: deducts the cost, unshifts a fresh SelectModifierPhase(rerollCount 1), relays REROLL.
        const ok = hostShop0.rerollModifiers();
        expect(ok, "the owner reroll succeeded (money was sufficient)").toBe(true);
        for (let i = 0; i < 4; i++) {
          await drainLoopback();
        }
        hostMoneyAfterReroll = rig.hostScene.money;
        expect(hostMoneyAfterReroll, "owner: the reroll deducted a positive cost").toBeLessThan(SHOP_MONEY);

        // The reroll ended round 0 and made the fresh round-1 SelectModifierPhase CURRENT (unstarted: the
        // test framework stubs startCurrentPhase). Retrieve + start it (streams the REROLLED options), then leave.
        const hostShop1 = rig.hostScene.phaseManager.getCurrentPhase() as unknown as RerollShopSeam;
        expect(hostShop1.phaseName, "the reroll made a fresh round-1 SelectModifierPhase current").toBe(
          "SelectModifierPhase",
        );
        hostShop1.start();
        await drainLoopback();
        expect(hostShop1.rerollCount, "round 1 has rerollCount 1").toBe(1);
        hostOptionIds1 = optionIds(hostShop1);

        // LEAVE round 1 (the terminal that advances the alternating-interaction counter; the watcher mirrors it).
        hostShop1.coopEndMirror();
        hostShop1.coopRelaySend(/* COOP_INTERACTION_LEAVE */ -1, undefined, "skip");
        hostShop1.end();
        hostShop1.coopAdvanceInteraction();
        await drainLoopback();
      });

      // ===== WATCHER SIDE (guest): round-0 watch consumes the buffered REROLL (rerolls its pool + sets the
      // relayed money), then the round-1 watch adopts the rerolled options + consumes the buffered LEAVE. =====
      await withClient(rig.guestCtx, async () => {
        await driveGuestRewardWatch(guestShop0); // adopt round-0 -> REROLL -> rerolls -> returns
      });
      // The watcher reroll ended round 0 and made the fresh round-1 SelectModifierPhase current (unstarted).
      const guestShop1 = withClientSync(rig.guestCtx, () =>
        rig.guestScene.phaseManager.getCurrentPhase(),
      ) as unknown as ShopPhaseSeam;
      expect(guestShop1.phaseName, "the watcher reroll made a fresh round-1 SelectModifierPhase current").toBe(
        "SelectModifierPhase",
      );
      let guestOptionIds1: number[] = [];
      await withClient(rig.guestCtx, async () => {
        await driveGuestRewardWatch(guestShop1); // adopt round-1 (rerolled) options -> LEAVE
        guestOptionIds1 = optionIds(guestShop1);
      });

      // ----- ASSERTIONS -----

      // (1) OPTION ADOPTION: the watcher's round-1 option-id list is EXACTLY the owner's rerolled list (the
      // rewardOptions relay, keyed by [counter, rerollCount], carried the rerolled round to the watcher).
      expect(guestOptionIds1.length, "the guest has a non-empty round-1 option list").toBeGreaterThan(0);
      expect(guestOptionIds1, "the watcher adopted the owner's REROLLED option-id list for round 1").toEqual(
        hostOptionIds1,
      );

      // (2) MONEY CONVERGENCE: both engines land on the SAME post-reroll money (host deducted the cost; the
      // watcher SET the streamed value host-authoritatively, no per-client recompute / double-deduct).
      expect(rig.guestScene.money, "the watcher's money converged to the owner's post-reroll value").toBe(
        hostMoneyAfterReroll,
      );

      // (3) LOCKSTEP: the whole reroll+leave was ONE interaction - the counter advanced exactly once on BOTH.
      expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the interaction once").toBe(
        counterBefore + 1,
      );
      expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the interaction once (lockstep)").toBe(
        counterBefore + 1,
      );

      logs.flush();
    }, 300_000);
  },
);
