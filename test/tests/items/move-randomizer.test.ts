import { allMoves, modifierTypes } from "#data/data-lists";
import {
  getMoveRandomizerCandidates,
  MOVE_RANDOMIZER_CATEGORIES,
  randomizePokemonMove,
} from "#data/elite-redux/er-move-randomizer";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("Move Randomizer items", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").startingLevel(50).enemySpecies(SpeciesId.MAGIKARP);
  });

  test("uses every current type on a live Pokemon", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.summonData.addedType = PokemonType.FIRE;

    const types = new Set(pokemon.getTypes());
    const known = new Set(pokemon.getMoveset().map(move => move.moveId));
    const candidates = getMoveRandomizerCandidates(pokemon);

    expect(types).toEqual(new Set([PokemonType.DRAGON, PokemonType.GROUND, PokemonType.FIRE]));
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some(moveId => allMoves[moveId].type === PokemonType.FIRE)).toBe(true);
    for (const moveId of candidates) {
      expect(types.has(allMoves[moveId].type)).toBe(true);
      expect(known.has(moveId)).toBe(false);
    }

    const original = pokemon.getMoveset()[0].moveId;
    const modifier = modifierTypes.MOVE_RANDOMIZER().newModifier(pokemon, 0)!;
    expect(modifier.apply(pokemon)).toBe(true);
    expect(pokemon.getMoveset()[0].moveId).not.toBe(original);
    expect(types.has(pokemon.getMoveset()[0].getMove().type)).toBe(true);
  });

  test("randomizes a move index beyond the fifth slot", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const moves = [
      MoveId.TACKLE,
      MoveId.GROWL,
      MoveId.TAIL_WHIP,
      MoveId.FOCUS_ENERGY,
      MoveId.TACKLE,
      MoveId.GROWL,
      MoveId.TAIL_WHIP,
      MoveId.FOCUS_ENERGY,
    ].map(moveId => new PokemonMove(moveId));
    const pokemon = {
      getTypes: () => [PokemonType.DRAGON, PokemonType.GROUND, PokemonType.FIRE],
      getMoveset: () => moves,
      setMove: (moveIndex: number, moveId: MoveId) => {
        moves[moveIndex] = new PokemonMove(moveId);
      },
      updateInfo: () => undefined,
    };

    const original = moves[7].moveId;
    expect(randomizePokemonMove(pokemon, 7)).toBe(true);
    expect(moves).toHaveLength(8);
    expect(moves[7].moveId).not.toBe(original);
    expect(pokemon.getTypes()).toContain(moves[7].getMove().type);
  });

  test("filters Greater Move Randomizer choices by category and current type", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.summonData.addedType = PokemonType.FIRE;
    const types = new Set(pokemon.getTypes());

    expect(MOVE_RANDOMIZER_CATEGORIES).toEqual([MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS]);
    for (const category of MOVE_RANDOMIZER_CATEGORIES) {
      const candidates = getMoveRandomizerCandidates(pokemon, category);
      expect(candidates.length).toBeGreaterThan(0);
      for (const moveId of candidates) {
        expect(allMoves[moveId].category).toBe(category);
        expect(types.has(allMoves[moveId].type)).toBe(true);
      }
    }
  });
});
