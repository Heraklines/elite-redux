/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #867 - the co-op GUEST's newBattle ADOPTS the host's WILD-vs-TRAINER verdict instead of
// re-deriving it via isWaveTrainer. This is the PRODUCTION-path proof: a real BattleScene in
// co-op-guest mode runs its REAL newBattle for the next wave with (a) the host's wave-start
// enemyPartySync verdict populated and (b) its own isWaveTrainer FORCED to the OPPOSITE answer.
// Before the fix the guest took its (diverging) local roll -> the wave-42 saveDataDigest
// battleType split (host TRAINER, guest WILD). After the fix the guest adopts the host's verdict.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-guest-battletype-adopt.test.ts
// =============================================================================

import { Battle } from "#app/battle";
import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { COOP_WAVE_NO_ME } from "#data/elite-redux/coop/coop-battle-stream";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import type { Trainer } from "#field/trainer";
import { applyCoopEncounterAuthority } from "#phases/encounter-phase";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op GUEST newBattle adopts the host's battleType verdict (#867)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    setCoopFaintSwitchWaitMs(4000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`guest-battletype-adopt-${Date.now()}`);
    game.override.battleStyle("double").startingWave(1);
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  /**
   * Drive the guest's REAL newBattle for the next wave with isWaveTrainer forced to `localRoll` and the
   * host verdict `hostVerdict` populated for that wave; return the resulting guest battleType.
   */
  async function guestNewBattleType(hostVerdict: BattleType, localRoll: boolean): Promise<BattleType> {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.DRAGONITE, SpeciesId.TYRANITAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    const nextWave = rig.guestScene.currentBattle.waveIndex + 1;
    // The HOST states its authoritative verdict for the next wave (the production enemyPartySync path).
    rig.hostRuntime.battleStream.sendEnemyParty(nextWave, [], COOP_WAVE_NO_ME, hostVerdict);
    // Deliver the destination-owned carrier only while the guest scene/runtime is installed, exactly as
    // the independent browser does before constructing its next battle.
    return withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 4; i++) {
        await rig.guestCtx.pumpInbound?.();
        await Promise.resolve();
      }
      // Force the guest's LOCAL wave-type roll to the OPPOSITE of the host verdict, so a passing test can
      // ONLY be the adoption (never the local roll happening to agree).
      rig.guestScene.gameMode.isWaveTrainer = () => localRoll;
      rig.guestScene.newBattle();
      return rig.guestScene.currentBattle.battleType;
    });
  }

  it("adopts TRAINER when the host verdict is TRAINER even though the local isWaveTrainer rolls WILD", async () => {
    const battleType = await guestNewBattleType(BattleType.TRAINER, /* localRoll (WILD) */ false);
    expect(battleType, "guest adopted the host's TRAINER verdict over its WILD local roll").toBe(BattleType.TRAINER);
    logs.flush();
  }, 240_000);

  it("adopts WILD when the host verdict is WILD even though the local isWaveTrainer rolls TRAINER", async () => {
    const battleType = await guestNewBattleType(BattleType.WILD, /* localRoll (TRAINER) */ true);
    expect(battleType, "guest adopted the host's WILD verdict over its TRAINER local roll").toBe(BattleType.WILD);
    logs.flush();
  }, 240_000);

  it("late authority atomically replaces a locally-built wild wave with the host trainer encounter", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.DRAGONITE, SpeciesId.TYRANITAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    await withClient(rig.guestCtx, () => {
      const battle = rig.guestScene.currentBattle;
      battle.battleType = BattleType.WILD;
      battle.trainer = null;
      battle.setDouble(false);
      battle.enemyLevels = [3];
      expect(battle.enemyParty.length).toBeGreaterThan(0);

      applyCoopEncounterAuthority(battle, {
        battleType: BattleType.TRAINER,
        mysteryEncounterType: COOP_WAVE_NO_ME,
        formatId: "double",
        enemyLevels: [44, 45],
        trainer: {
          trainerType: TrainerType.BACKPACKER,
          variant: TrainerVariant.DOUBLE,
          partyTemplateIndex: 0,
          name: "Host Atlas",
          partnerName: "Host Echo",
          nameWithTitle: "Backpackers Host Atlas & Host Echo",
          renderNames: {
            none: "Host Atlas & Host Echo",
            noneWithTitle: "Backpackers Host Atlas & Host Echo",
            trainer: "Host Atlas",
            trainerWithTitle: "Backpacker Host Atlas",
            partner: "Host Echo",
            partnerWithTitle: "Backpacker Host Echo",
          },
          encounterMessages: ["The host-authored challenge."],
          victoryMessages: ["The host-authored defeat."],
          defeatMessages: ["The host-authored victory."],
        },
      });

      expect(battle.battleType).toBe(BattleType.TRAINER);
      expect(battle.format.id).toBe("double");
      expect(battle.enemyLevels).toEqual([44, 45]);
      expect(battle.enemyParty, "late descriptor drops every locally-derived enemy before carrier rebuild").toEqual([]);
      expect(Object.keys(battle.turnCommands).map(Number)).toEqual([0, 1, 2, 3]);
      expect(Object.keys(battle.preTurnCommands).map(Number)).toEqual([0, 1, 2, 3]);
      const adoptedTrainer = battle.trainer as Trainer | null;
      expect(adoptedTrainer?.config.trainerType).toBe(TrainerType.BACKPACKER);
      expect(adoptedTrainer?.name).toBe("Host Atlas");
      expect(adoptedTrainer?.partnerName).toBe("Host Echo");
      expect(adoptedTrainer?.getName(TrainerSlot.NONE, true)).toBe("Backpackers Host Atlas & Host Echo");
      expect(adoptedTrainer?.getName(TrainerSlot.TRAINER, false)).toBe("Host Atlas");
      expect(adoptedTrainer?.getName(TrainerSlot.TRAINER_PARTNER, false)).toBe("Host Echo");
      expect(adoptedTrainer?.getEncounterMessages()).toEqual(["The host-authored challenge."]);
      expect(adoptedTrainer?.getVictoryMessages()).toEqual(["The host-authored defeat."]);
      expect(adoptedTrainer?.getDefeatMessages()).toEqual(["The host-authored victory."]);
    });
    logs.flush();
  }, 240_000);

  it("constructs a valid command substrate before any turn or encounter-adoption hook runs", () => {
    const battle = new Battle(getGameMode(GameModes.COOP), {
      waveIndex: 15,
      battleType: BattleType.MYSTERY_ENCOUNTER,
      double: true,
    });

    expect(Object.keys(battle.turnCommands).map(Number)).toEqual([0, 1, 2, 3]);
    expect(Object.keys(battle.preTurnCommands).map(Number)).toEqual([0, 1, 2, 3]);
    expect(Object.values(battle.turnCommands).every(command => command == null)).toBe(true);
    expect(Object.values(battle.preTurnCommands).every(command => command == null)).toBe(true);
  });
});
