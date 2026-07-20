import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Ability - Snow Cloak (Elite Redux)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.SNOW_CLOAK)
      .weather(WeatherType.HAIL)
      .moveset([MoveId.SPLASH, MoveId.SUNNY_DAY])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("creates an indefinite Aurora Veil during hail", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const veil = game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER);
    expect(veil?.turnCount).toBe(0);
    expect(veil?.sourceId).toBe(game.field.getPlayerPokemon().id);
  });

  it("removes its Aurora Veil as soon as hail ends", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.override.weather(WeatherType.NONE);
    game.scene.arena.trySetWeather(WeatherType.NONE);

    expect(game.scene.arena.weatherType).toBe(WeatherType.NONE);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.AURORA_VEIL, ArenaTagSide.PLAYER)).toBeUndefined();
  });
});
