import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { ErRelicModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("Pharaoh's Ankh visual state", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  test("clears a stale faint marker when lethal damage is stopped at 1 HP", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    const modifier = modifierTypes.ER_RELIC_PHARAOH_ANKH().newModifier();
    if (!(modifier instanceof ErRelicModifier)) {
      throw new Error("Pharaoh's Ankh modifier was not created");
    }
    globalScene.addModifier(modifier, true, false, false, true);
    pokemon.doSetStatus(StatusEffect.FAINT);

    expect(pokemon.damage(pokemon.hp)).toBe(pokemon.getMaxHp() - 1);
    expect(pokemon.hp).toBe(1);
    expect(pokemon.status).toBeNull();
    expect(pokemon.isFainted()).toBe(false);
  });
});
