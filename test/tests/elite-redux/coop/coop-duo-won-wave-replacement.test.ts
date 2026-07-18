/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE WON-WAVE replacement pivot (Track R depth lane, campaign run 29654429335).
//
// Sibling of coop-duo-double-faint.test.ts (cycle-8's checkpoint-deferral regression) and
// coop-duo-barrier-deadlock.test.ts (the replay->command pivot). This locks the DEPTH-lane
// mechanism those two did not cover: a player field slot that faints AND refills on a turn the
// wave is WON (a mutual KO - every enemy faints the same turn).
//
// THE BUG (host + guest browser traces): the host still auto-summons the surviving-owner's
// replacement into its fainted slot and ships the (cycle-8 deferred, complete-field) out-of-band
// replacement checkpoint, THEN commits WAVE_ADVANCE(outcome=win). The guest, seeing its OWN slot
// refilled, took the mid-wave pivot and opened a CommandPhase for a wave that has NO next turn ->
// parked in UiMode.COMMAND forever ("guest host-liveness pending turn commit") awaiting a turn the
// host (already advanced) never resolves. The host's WAVE_ADVANCE op continuation deadline then
// expired: "[coop:runtime] shared session terminal requested: Durable operation recovery exhausted
// for op:global at N (blocked N+1, 0 attempts, continuation-timeout)."
//
// THE FIX (two parts, both exercised here):
//   1. coop-replay-turn-phase.ts: at the replacement->command pivot, detect the WON wave (the host's
//      just-applied authoritative frame has every enemy fainted) and DO NOT open a CommandPhase -
//      ack the replacement continuation and hold the replay park instead.
//   2. coop-runtime.ts: a retained WIN WAVE_ADVANCE (not only gameOver) dissolves that held replay
//      park, so it drains into the authoritative CoopWaveAdvanceBoundaryPhase / victory tail.
//
// RED before the fix: driveClientPhaseQueueTo stalls at the phantom CommandPhase (never reaches the
// victory tail) and the guest logs "opening own CommandPhase" on the won wave. GREEN after: the
// guest suppresses the command, the WIN unpark drains it into VictoryPhase, no continuation-timeout.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-won-wave-replacement.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installDuoLogCapture,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest picks party slot 3 (CHARIZARD) as its own faint replacement (a guest-owned bench mon). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO won-wave replacement: guest never opens a phantom CommandPhase for a slot refilled on a WON wave (Track R depth)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`won-wave-replacement-${Date.now()}`);
      // Bounded host faint-switch wait so a regression that stops the guest's pick surfaces fast.
      setCoopFaintSwitchWaitMs(4000);
      game.override
        .battleStyle("double")
        .startingWave(1)
        // FRAIL enemies: the host lead's spread EARTHQUAKE KOs BOTH the same turn it KOs the 1-HP guest
        // ally -> the wave is WON on the exact turn the guest-owned field slot faints and refills.
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(3)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopFaintSwitchWaitMs(60_000);
      setCoopWaveBarrierMs(60_000);
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    /** The guest's TURN-1 own-slot command answer (the genuine production CoopBattleSync relay). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.ENEMY],
      }));
    }

    it("suppresses the won-wave phantom command and drains the held replay into the wave-advance victory tail", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Guest-owned bench (LAPRAS + CHARIZARD), so the guest's faint has an own bench to replace from and
      // the host lead (SNORLAX, slot 0) is the sole host mon - it survives, so no host faint/auto-pick.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        scene.getPlayerParty()[2].coopOwner = "guest";
        scene.getPlayerParty()[3].coopOwner = "guest";
      }
      rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;

      // TURN 1 (host): SNORLAX EARTHQUAKE (spread) faints BOTH lv3 Magikarp AND the 1-HP guest Gengar the
      // same turn = a WON wave with a guest-owned faint. The guest slot's relayed SPLASH is moot.
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
        game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      expect(
        rig.hostScene.getEnemyParty().every(e => e == null || e.isFainted()),
        "the wave is WON: EARTHQUAKE fainted the whole enemy party the same turn",
      ).toBe(true);
      const hostGuestSlot = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(
        hostGuestSlot == null || hostGuestSlot.isFainted(),
        "the guest-owned field slot was vacated by the faint on the host",
      ).toBe(true);

      // GUEST renders turn 1: the faint opens the guest's OWN picker (CoopGuestFaintSwitchPhase). Stub the
      // ONE PARTY open to pick CHARIZARD (slot 3); the relay send + seq keying stay fully real.
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            setCoopRuntime(rig.hostRuntime);
            try {
              (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0);
            } finally {
              setCoopRuntime(rig.guestRuntime);
            }
            return;
          }
          if (args[0] === UiMode.MESSAGE) {
            return; // the picker's close transition - a no-op headlessly
          }
          return realSetMode(...args);
        };
        try {
          await driveGuestReplayTurn(rig.guestScene, turn, { sealRetainedWaveBoundary: false });
        } finally {
          ui.setMode = realSetMode;
        }
      });

      // HOST: summon the guest's pick into the fainted slot, push the out-of-band replacement checkpoint,
      // then WIN - run THROUGH BattleEndPhase (which commits + sends the retained WAVE_ADVANCE(win) op) and
      // stop at the post-battle reward shop. Stopping only at BattleEndPhase left the op uncommitted, so the
      // guest (which correctly ignores the raw waveResolved and awaits the retained transaction) never got it.
      let hostAdvance: Promise<void> | undefined;
      await withClient(rig.hostCtx, async () => {
        hostAdvance = game.phaseInterceptor.to("SelectModifierPhase", false);
        await drainLoopback();
      });
      expect(hostAdvance, "the host win crossing was started").toBeDefined();
      await settleDuoPromise(rig, hostAdvance!, "won-wave replacement host crossing");
      await withClient(rig.hostCtx, () => drainLoopback());
      const hostReplacement = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(
        hostReplacement?.species.speciesId,
        "the HOST summoned the guest's replacement (CHARIZARD) before winning",
      ).toBe(SpeciesId.CHARIZARD);

      // GUEST: drive the turn-2 replay through the WON-WAVE replacement pivot. Pre-fix the guest opens a
      // phantom CommandPhase and STALLS (host-liveness pending turn commit -> continuation-timeout). Post-fix
      // it suppresses the command and the WIN unpark drains the held replay into the authoritative victory
      // tail - driveClientPhaseQueueTo reaches VictoryPhase / BattleEndPhase / the reward shop.
      await withClient(rig.guestCtx, async () => {
        rig.guestScene.currentBattle.turn = turn + 1;
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
        await driveClientPhaseQueueTo(rig.guestScene, "guest wave-advance victory tail", {
          matches: phase =>
            phase.phaseName === "VictoryPhase"
            || phase.phaseName === "BattleEndPhase"
            || phase.phaseName === "SelectModifierPhase",
          perPhaseTimeoutMs: 8_000,
        });
      });

      const allLogs = [...logs.host, ...logs.guest];
      // The exact defect: no phantom CommandPhase was opened for the refilled slot on the won wave.
      expect(
        allLogs.some(l => /replacement filled OUR slot .* -> opening own CommandPhase/.test(l)),
        "no phantom CommandPhase was opened for the refilled slot on the WON wave (the depth deadlock trigger)",
      ).toBe(false);
      // The guest took the won-wave suppression branch (positive proof the fix path ran).
      expect(
        allLogs.some(l => /on a WON wave .*-> ack continuation/.test(l)),
        "the guest took the won-wave replacement suppression path",
      ).toBe(true);
      // No durable-op continuation-timeout terminal (the host's WAVE_ADVANCE continuation ACKed).
      expect(
        allLogs.some(l => /continuation-timeout|Durable operation recovery exhausted/.test(l)),
        "no WAVE_ADVANCE op continuation-timeout terminal fired",
      ).toBe(false);
      // The guest is not parked in a phantom CommandPhase.
      const current = withClientSync(rig.guestCtx, () => rig.guestScene.phaseManager.getCurrentPhase()?.phaseName);
      expect(current, "the guest is NOT parked in a phantom CommandPhase on the won wave").not.toBe("CommandPhase");

      logs.flush();
    }, 240_000);
  },
);
