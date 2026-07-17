/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, pumpDuoDestinations, withClient, withClientSync } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO authority-failure destination context", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .disableTrainerWaves();
  });

  afterEach(() => {
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("validates and ACKs under the receiver scene when the sender ambient turn differs", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const wave = rig.guestScene.currentBattle.waveIndex;
    const receiverTurn = rig.guestScene.currentBattle.turn;
    withClientSync(rig.hostCtx, () => {
      rig.hostScene.currentBattle.turn = receiverTurn + 1;
    });
    const received: string[] = [];
    const offFailure = rig.guestRuntime.battleStream.onAuthorityFailure(failure => {
      received.push(failure.failureId);
    });
    try {
      const failureId = `destination-context:${wave}:${receiverTurn}`;
      const acknowledged = withClient(rig.hostCtx, () =>
        rig.hostRuntime.battleStream.broadcastAuthorityFailure({
          failureId,
          epoch: rig.hostRuntime.controller.sessionEpoch,
          wave,
          turn: receiverTurn,
          boundary: "replacement",
          reason: "destination-context regression",
        }),
      );
      await pumpDuoDestinations(rig, 4);

      expect(await acknowledged, "the receiver accepted the exact failure and returned its ACK").toBe(true);
      expect(received, "the failure handler ran once under the receiver's own battle address").toEqual([failureId]);
      expect(
        rig.hostScene.currentBattle.turn,
        "sender ambient state remained intentionally different throughout delivery",
      ).toBe(receiverTurn + 1);
    } finally {
      offFailure();
    }
  });
});
