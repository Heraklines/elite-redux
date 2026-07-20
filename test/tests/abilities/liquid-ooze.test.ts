import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Ability - Liquid Ooze", () => {
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
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(20)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.LIQUID_OOZE)
      .enemyMoveset(MoveId.GROWL);
  });

  it("should reverse the effect of HP-draining moves", async () => {
    game.override.startingLevel(20).enemyLevel(100).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.use(MoveId.GIGA_DRAIN);
    await game.toEndOfTurn();

    const karp = game.field.getEnemyPokemon();
    expect(karp).toHaveAbilityApplied(AbilityId.LIQUID_OOZE);
    expect(karp).not.toHaveFullHp();
    const feebas = game.field.getPlayerPokemon();
    expect(feebas).toHaveTakenDamage(karp.getInverseHp() / 2);
  });

  it("should not drain the attacker's HP if it ignores indirect damage", async () => {
    game.override.ability(AbilityId.MAGIC_GUARD);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.use(MoveId.GIGA_DRAIN);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toHaveFullHp();
  });

  // Regression test
  it("should not apply if suppressed", async () => {
    game.override.ability(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.use(MoveId.GIGA_DRAIN);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toHaveFullHp();
  });

  it("reverses Energy Tap's ability-driven recovery", async () => {
    game.override.ability(ErAbilityId.ENERGY_TAP as unknown as AbilityId).startingLevel(100);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.NIGHT_SHADE);
    await game.toEndOfTurn();

    expect(player.hp).toBeLessThan(player.getMaxHp());
  });

  it("reverses Predator's on-KO recovery", async () => {
    game.override
      .ability(ErAbilityId.PREDATOR as unknown as AbilityId)
      .startingLevel(100)
      .enemyLevel(1);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    enemy.hp = 1;
    const before = player.hp;

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy).toHaveFainted();
    expect(player.hp).toBeLessThan(before);
  });

  // TODO: Write test
  it.todo("should reverse drains from Leech Seed");
});
