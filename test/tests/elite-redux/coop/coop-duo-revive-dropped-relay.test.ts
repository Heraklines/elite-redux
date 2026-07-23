/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op REVIVE with a DROPPED relay (#719 checksum backstop). The HAPPY path - a Revive on a
// fainted bench mon - already syncs via the owner->watcher interaction relay (coop-duo-revive-sync.test.ts,
// ZERO resync). This test covers the DROPPED-relay case (the #787 lost-relay class): the owner's revive
// relay message (`interactionChoice`) is DROPPED by the seeded faulting transport, so the watcher never
// applies the revive - the bench mon stays fainted on the guest. Every OTHER action has the per-turn
// checksum as a backstop; a revive changes NO species and NO level, so before this fix the checksum -
// which hashed party speciesId + LEVELS but NOT bench-mon hp/fainted - could not even DETECT the bench
// divergence, so the resync never fired and the mon stayed fainted on the partner FOREVER.
//
// This repro faints a bench mon on BOTH engines, plays a wave to a converged boundary, then reaches the
// reward shop, DROPS the owner's revive relay via wrapCoopFaultPair, and asserts:
//   1. the owner (host) revived its bench mon but the WATCHER (guest) stayed fainted (relay dropped),
//   2. DETECTION: the per-turn checksum now DIFFERS solely because of the new bench hp/fainted coverage
//      (`benchHp`) - the ONLY divergence between the two states (fails-before: pre-fix this was invisible),
//   3. HEAL: the resulting full-snapshot resync (the backstop the mismatch triggers) revives the guest
//      bench mon, so it ends ALIVE on BOTH engines and the checksums re-converge.
// Unlike the happy-path test this EXPECTS a resync-heal (it proves the backstop), so it does NOT assert
// zero resync.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-revive-dropped-relay.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { checksumState } from "#data/elite-redux/coop/coop-battle-checksum";
import { captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { type CoopMessage, createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  advanceCoopActiveTime,
  beginRewardShopWatch,
  buildDuo,
  clearCoopSchedulerActiveTimeClock,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostPartyRewardOwner,
  forceItemRewards,
  installCoopSchedulerActiveTimeClock,
  installDuoLogCapture,
  reachQueuedRewardShop,
  type ShopPhaseSeam,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { COOP_NO_FAULT_PROFILE, type CoopFaultProfile, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The FAINTED bench slot the Revive targets (a host-owned bench mon, off-field). */
const REVIVE_SLOT = 2;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO revive with a DROPPED relay: the per-turn checksum backstop detects + heals it (#719)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`revive-dropped-relay-${Date.now()}`);
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
      clearCoopSchedulerActiveTimeClock();
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
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
    }

    it("a dropped revive relay is DETECTED by the per-turn checksum + HEALED by the resync backstop", async () => {
      installCoopSchedulerActiveTimeClock();
      forceItemRewards(game.override, [{ name: "REVIVE" }]);
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX, // 0 host lead
        SpeciesId.GENGAR, // 1 guest lead
        SpeciesId.CHARIZARD, // 2 host bench (FAINTED - the Revive target)
      );
      // Seeded faulting transport (starts CLEAN - no faults during the wave / handshake).
      const faultPair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 1 });
      const rig = await buildDuo(game, faultPair, setCoopRuntime, toCoop);
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

      // Play wave 1 to a win + replay it on the guest (reaches the reward shop; the turn CONVERGES via the
      // per-turn checkpoint - no faults are active yet, so the two engines are byte-identical afterward).
      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      // BASELINE: the two engines are converged and AGREE on the bench (both slot-2 mons FAINTED).
      const hostState0 = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState0 = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestState0.benchHp, "baseline: both engines agree the bench mon is fainted").toEqual(hostState0.benchHp);
      expect(checksumState(guestState0), "baseline: the two engines' checksums match (converged)").toBe(
        checksumState(hostState0),
      );

      // Reach the WAVE-1 reward shop on the host (HOST-owned: interaction counter 0, even). This is where
      // the owner's party-target revive relay is emitted.
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("SelectModifierPhase", false);
      });
      const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      expect(hostShop.phaseName, "host reached SelectModifierPhase").toBe("SelectModifierPhase");
      const guestShop = await withClient(rig.guestCtx, () => reachQueuedRewardShop(rig.guestScene));
      await withClient(rig.guestCtx, () => beginRewardShopWatch(guestShop));

      // DROP the first immutable V2 reward commit. Raw interactionChoice is deliberately suppressed after
      // cutover, so faulting that obsolete carrier made this regression vacuous.
      let rewardCommitSends = 0;
      const dropReviveRelay: CoopFaultProfile = {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: (msg: CoopMessage): boolean => {
          if (
            msg.t !== "authorityEntry"
            || msg.body.kind !== "INTERACTION_COMMIT"
            || !msg.body.operationId.includes(":REWARD:")
          ) {
            return false;
          }
          rewardCommitSends += 1;
          return rewardCommitSends === 1;
        },
      };
      faultPair.setProfile(dropReviveRelay);

      // OWNER (host) picks the REVIVE onto the fainted bench slot: it applies on the host + emits the relay,
      // which the transport DROPS (never reaches the guest watcher).
      await withClient(rig.hostCtx, () => driveHostPartyRewardOwner(hostShop, { slot: REVIVE_SLOT }));

      // The revive relay was GENUINELY dropped by the transport (the fault was real, not vacuous).
      expect(
        faultPair.counters.host.dropped,
        "the owner's immutable revive INTERACTION_COMMIT was dropped",
      ).toBeGreaterThan(0);
      expect(rewardCommitSends).toBe(1);

      // OWNER: the fainted bench mon is now ALIVE on the host.
      const hostRevived = rig.hostScene.getPlayerParty()[REVIVE_SLOT];
      expect(hostRevived.hp > 0 && !hostRevived.isFainted(), "owner (host) revived the bench mon").toBe(true);

      // WATCHER has not applied the lost first delivery yet.
      withClientSync(rig.guestCtx, () => {
        expect(
          rig.guestScene.getPlayerParty()[REVIVE_SLOT].isFainted(),
          "watcher remains fainted before the retained entry is redelivered",
        ).toBe(true);
      });

      // The authority log, not a later checksum repair, owns recovery: advance its active-time lease and
      // consume the same immutable result on the already-open watcher surface.
      await withClient(rig.hostCtx, async () => {
        advanceCoopActiveTime(300);
        await drainLoopback();
      });
      expect(rewardCommitSends, "the authority log redelivered the exact revive commit").toBeGreaterThanOrEqual(2);
      await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));

      // WATCHER converged directly from the retained entry; no raw carrier or manual snapshot is involved.
      withClientSync(rig.guestCtx, () => {
        const guestHealed = rig.guestScene.getPlayerParty()[REVIVE_SLOT];
        expect(
          guestHealed.hp > 0 && !guestHealed.isFainted(),
          "the redelivered V2 result revived the guest bench mon",
        ).toBe(true);
        expect(guestHealed.hp, "both engines agree on the revived mon's HP after the heal").toBe(hostRevived.hp);
      });

      // The complete state remains byte-converged after retained exactly-once materialization.
      const hostState2 = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState2 = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestState2.benchHp, "post-heal: both engines agree the bench mon is revived").toEqual(hostState2.benchHp);
      expect(checksumState(guestState2), "post-heal: the checksums re-converge").toBe(checksumState(hostState2));

      logs.flush();
    }, 300_000);
  },
);
