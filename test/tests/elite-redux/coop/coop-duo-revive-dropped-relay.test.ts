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
import { type CoopChecksumState, checksumState } from "#data/elite-redux/coop/coop-battle-checksum";
import {
  applyCoopFullSnapshot,
  captureCoopChecksumState,
  captureCoopFullSnapshot,
} from "#data/elite-redux/coop/coop-battle-engine";
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
  driveGuestReplayTurn,
  driveHostPartyRewardOwner,
  forceItemRewards,
  installDuoLogCapture,
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

/** Copy a checksum state with its bench hp/fainted coverage stripped (the pre-fix hash shape). */
function withoutBenchHp(state: CoopChecksumState): CoopChecksumState {
  return { ...state, benchHp: [] };
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

      // DROP the owner's revive relay: a party-target reward pick relays an `interactionChoice`
      // ([COOP_ACT_REWARD, slot, option]) to the watcher. Faulting exactly that message (drop 100%)
      // reproduces the #787 lost-relay class - the watcher never receives the revive.
      const dropReviveRelay: CoopFaultProfile = {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice",
      };
      faultPair.setProfile(dropReviveRelay);

      // OWNER (host) picks the REVIVE onto the fainted bench slot: it applies on the host + emits the relay,
      // which the transport DROPS (never reaches the guest watcher).
      await withClient(rig.hostCtx, () => driveHostPartyRewardOwner(hostShop, { slot: REVIVE_SLOT }));

      // Stop dropping so the resync backbone (the heal below) can flow.
      faultPair.setProfile(COOP_NO_FAULT_PROFILE);

      // The revive relay was GENUINELY dropped by the transport (the fault was real, not vacuous).
      expect(
        faultPair.counters.host.dropped,
        "the owner's revive relay (interactionChoice) was dropped",
      ).toBeGreaterThan(0);

      // OWNER: the fainted bench mon is now ALIVE on the host.
      const hostRevived = rig.hostScene.getPlayerParty()[REVIVE_SLOT];
      expect(hostRevived.hp > 0 && !hostRevived.isFainted(), "owner (host) revived the bench mon").toBe(true);

      // WATCHER (the dropped-relay desync): the SAME bench mon stayed FAINTED on the guest.
      withClientSync(rig.guestCtx, () => {
        expect(
          rig.guestScene.getPlayerParty()[REVIVE_SLOT].isFainted(),
          "watcher (guest) never saw the revive - its bench mon is still fainted (relay dropped)",
        ).toBe(true);
      });

      // DETECTION (the fix): capture both checksum states post-divergence.
      const hostState1 = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState1 = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      // The guest state is UNCHANGED from the converged baseline (the relay never touched it).
      expect(guestState1.benchHp, "guest bench state unchanged (dropped relay)").toEqual(guestState0.benchHp);
      // The bench hp/fainted now DIVERGES: host slot-2 alive (hp>0, flag 0) vs guest slot-2 fainted (flag 1).
      expect(hostState1.benchHp, "host bench mon reads revived in the checksum").toEqual([
        [REVIVE_SLOT, hostRevived.hp, 0],
      ]);
      expect(hostState1.benchHp, "the bench hp/fainted diverges between the two engines").not.toEqual(
        guestState1.benchHp,
      );
      // The per-turn checksum now DETECTS the divergence (the whole point of the fix).
      expect(checksumState(guestState1), "the per-turn checksum DETECTS the dropped-revive divergence").not.toBe(
        checksumState(hostState1),
      );
      // FAILS-BEFORE: the divergence is SOLELY the new bench-hp coverage - strip `benchHp` (the pre-fix hash
      // shape) and the two states are byte-identical, so before this fix the mismatch was INVISIBLE to the
      // checksum and no resync ever fired -> the mon stayed fainted on the partner forever.
      expect(
        checksumState(withoutBenchHp(guestState1)),
        "without the benchHp coverage the states are identical (pre-fix: undetected)",
      ).toBe(checksumState(withoutBenchHp(hostState1)));

      // HEAL: the checksum mismatch triggers the full-snapshot resync (the backstop). Apply the host's real
      // authoritative snapshot on the guest (authoritativeGuest) - its benchParty reconcile revives the mon.
      const snapshot = await withClient(rig.hostCtx, () => captureCoopFullSnapshot());
      expect(snapshot, "host produced a full resync snapshot").not.toBeNull();
      if (snapshot == null) {
        throw new Error("host full snapshot was null - cannot drive the resync heal");
      }
      await withClient(rig.guestCtx, () => {
        applyCoopFullSnapshot(snapshot, true);
      });

      // WATCHER healed: the bench mon is now ALIVE on the guest too (revived on BOTH engines).
      withClientSync(rig.guestCtx, () => {
        const guestHealed = rig.guestScene.getPlayerParty()[REVIVE_SLOT];
        expect(
          guestHealed.hp > 0 && !guestHealed.isFainted(),
          "the resync backstop revived the guest bench mon (alive on both engines)",
        ).toBe(true);
        expect(guestHealed.hp, "both engines agree on the revived mon's HP after the heal").toBe(hostRevived.hp);
      });

      // The two engines' checksums RE-CONVERGE after the heal (the divergence is closed).
      const hostState2 = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestState2 = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestState2.benchHp, "post-heal: both engines agree the bench mon is revived").toEqual(hostState2.benchHp);
      expect(checksumState(guestState2), "post-heal: the checksums re-converge").toBe(checksumState(hostState2));

      logs.flush();
    }, 300_000);
  },
);
