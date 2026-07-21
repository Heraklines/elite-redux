import { isInnateSlotSuppressed } from "#data/elite-redux/ability-upgrades/attrs/innate-slot-suppression";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Mummy ability family - Elite Redux innate suppression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .hasPassiveAbility(true)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.MUMMY)
      .enemySpecies(SpeciesId.YAMASK)
      .moveset(MoveId.BITE)
      .enemyMoveset(MoveId.GROWL)
      .startingLevel(50)
      .enemyLevel(50);
  });

  it("keeps Mummy's original ability replacement and disables innate slot one", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    player.customPokemonData.passive = AbilityId.RUN_AWAY;

    game.move.use(MoveId.BITE);
    await game.toEndOfTurn();

    expect(player.getAbility().id).toBe(AbilityId.MUMMY);
    expect(isInnateSlotSuppressed(player, 0)).toBe(true);
    expect(player.hasAbility(AbilityId.RUN_AWAY)).toBe(false);
  });

  it("does not affect another Mummy-family holder", async () => {
    game.override.ability(AbilityId.LINGERING_AROMA);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    player.customPokemonData.passive = AbilityId.RUN_AWAY;

    game.move.use(MoveId.BITE);
    await game.toEndOfTurn();

    expect(player.getAbility().id).toBe(AbilityId.LINGERING_AROMA);
    expect(isInnateSlotSuppressed(player, 0)).toBe(false);
    expect(player.hasAbility(AbilityId.RUN_AWAY)).toBe(true);
  });
});
