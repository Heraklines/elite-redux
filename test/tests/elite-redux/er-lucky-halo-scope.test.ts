/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const LUCKY_HALO = 5426 as AbilityId;

describe.skipIf(!RUN)("ER Lucky Halo holder scope", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("blocks only the holder's self-drop, not its ally's", async () => {
    game.override
      .startingWave(2)
      .battleStyle("double")
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(LUCKY_HALO)
      .enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GALLADE, SpeciesId.SNORLAX);

    const [holder, ally] = game.scene.getPlayerField();
    ally.summonData.ability = AbilityId.BALL_FETCH;

    globalScene.phaseManager.unshiftNew("StatStageChangePhase", ally.getBattlerIndex(), true, [Stat.ATK], -1);
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.ATK], -1);
    game.move.select(MoveId.SPLASH, 0);
    game.move.select(MoveId.SPLASH, 1);
    await game.toEndOfTurn();

    expect(holder.getStatStage(Stat.ATK)).toBe(0);
    expect(ally.getStatStage(Stat.ATK)).toBe(-1);
  });
});
