/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ER_LIFE_ORB_TYPE, ErLifeOrbModifier } from "#data/elite-redux/er-recreated-items";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Life Orb recoil", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .moveset([MoveId.DOUBLE_HIT])
      .ability(AbilityId.NO_GUARD)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100);
  });

  it("charges one recoil payment for an entire multi-hit move", async () => {
    await game.classicMode.startBattle(SpeciesId.REGIELEKI);
    const player = game.field.getPlayerPokemon();
    game.scene.addModifier(new ErLifeOrbModifier(ER_LIFE_ORB_TYPE(), player.id), true, false, false, true);
    const startingHp = player.hp;
    const expectedRecoil = toDmgValue(player.getMaxHp() / 10);

    game.move.select(MoveId.DOUBLE_HIT);
    await game.phaseInterceptor.to("MoveEndPhase", false);

    expect(player.turnData.hitCount).toBe(2);
    expect(startingHp - player.hp).toBe(expectedRecoil);
  });
});
