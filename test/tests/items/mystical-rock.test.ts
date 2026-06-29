import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Mystical Rock", () => {
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
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset([MoveId.SUNNY_DAY, MoveId.GRASSY_TERRAIN])
      .startingHeldItems([{ name: "MYSTICAL_ROCK", count: 2 }])
      .battleStyle("single");
  });

  it("should increase weather duration by +2 turns per stack", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);

    game.move.select(MoveId.SUNNY_DAY);

    await game.phaseInterceptor.to("MoveEndPhase");

    const weather = globalScene.arena.weather;

    expect(weather).toBeDefined();
    expect(weather!.turnsLeft).toBe(9);
  });

  it("also extends ER ABILITY-set weather (Drought) - was hard-overwritten to the flat ER duration", async () => {
    // ER replaced Drought's PostSummon weather attr with one that hard-set turnsLeft to a
    // flat 8, discarding the Mystical Rock bonus (reported: Drought didn't gain turns). Now
    // the +2/stack extender is re-applied on top: ER Drought base 8 + 2 stacks * 2 = 12.
    game.override.ability(AbilityId.DROUGHT);
    await game.classicMode.startBattle(SpeciesId.GASTLY);

    const weather = globalScene.arena.weather;
    expect(weather?.weatherType).toBe(WeatherType.SUNNY);
    expect(weather!.turnsLeft).toBe(12);
  });

  it("should increase terrain duration by +2 turns per stack", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);

    game.move.select(MoveId.GRASSY_TERRAIN);

    await game.phaseInterceptor.to("MoveEndPhase");

    const terrain = globalScene.arena.terrain;

    expect(terrain).toBeDefined();
    expect(terrain!.turnsLeft).toBe(9);
  });
});
