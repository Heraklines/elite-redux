import { ER_RAIN_PUMP_ABILITY_ID } from "#data/elite-redux/abilities/rain-pump";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const RAIN_PUMP = ER_RAIN_PUMP_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Rain Pump (5915)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(RAIN_PUMP)
      .moveset([MoveId.TACKLE, MoveId.GROWL, MoveId.HARDEN, MoveId.LEER]);
  });

  it("restores 1 PP to every move at end of turn while it is raining", async () => {
    game.override.weather(WeatherType.RAIN);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    // Spend PP on several moves so the restore is observable.
    for (const m of player.getMoveset()) {
      m.ppUsed = 5;
    }

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    // Tackle spent 1 PP this turn (6 used) then Rain Pump gave 1 back → 5.
    // Every other move simply gained 1 back → 4.
    for (const m of player.getMoveset()) {
      const expected = m.moveId === MoveId.TACKLE ? 5 : 4;
      expect(m.ppUsed).toBe(expected);
    }
  });

  it("does nothing when it is not raining", async () => {
    game.override.weather(WeatherType.NONE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    for (const m of player.getMoveset()) {
      m.ppUsed = 5;
    }

    game.move.select(MoveId.HARDEN);
    await game.toNextTurn();

    for (const m of player.getMoveset()) {
      // No restore: Harden spent 1 more (6), the rest are unchanged (5).
      const expected = m.moveId === MoveId.HARDEN ? 6 : 5;
      expect(m.ppUsed).toBe(expected);
    }
  });

  it("never restores above a move's maximum PP", async () => {
    game.override.weather(WeatherType.RAIN);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();

    // All moves already full — nothing to restore.
    for (const m of player.getMoveset()) {
      m.ppUsed = 0;
    }

    game.move.select(MoveId.GROWL);
    await game.toNextTurn();

    for (const m of player.getMoveset()) {
      // Growl spent 1 (now 1); Rain Pump would restore it back to 0. Others stay 0.
      expect(m.ppUsed).toBe(0);
    }
  });
});
