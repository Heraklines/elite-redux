import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Weather - Fog", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .weather(WeatherType.FOG)
      .battleStyle("single")
      .moveset([MoveId.TACKLE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset([MoveId.SPLASH]);
  });

  // ER "Eerie Fog" no longer applies the vanilla 0.9× accuracy penalty.
  it("move accuracy is NOT reduced by fog (ER Eerie Fog)", async () => {
    const moveToCheck = allMoves[MoveId.TACKLE];

    vi.spyOn(moveToCheck, "calculateBattleAccuracy");

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(moveToCheck.calculateBattleAccuracy).toHaveReturnedWith(100);
  });
});
