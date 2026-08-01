import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Moves - No Retreat", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.NO_RETREAT, MoveId.SPLASH])
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH);
  });

  it("prevents the user from voluntarily switching after the boost", async () => {
    await game.classicMode.startBattle(SpeciesId.FALINKS, SpeciesId.PIKACHU);
    const user = game.field.getPlayerPokemon();

    game.move.select(MoveId.NO_RETREAT);
    await game.toNextTurn();

    expect(user.getTag(BattlerTagType.NO_RETREAT)).toBeDefined();
    expect(user.isTrapped()).toBe(true);
  });
});
