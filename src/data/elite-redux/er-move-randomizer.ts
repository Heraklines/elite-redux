import { allMoves } from "#data/data-lists";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";
import type { PokemonMove } from "#moves/pokemon-move";
import { randSeedItem } from "#utils/common";

export const MOVE_RANDOMIZER_CATEGORIES = [MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS] as const;

export type MoveRandomizerCategory = (typeof MOVE_RANDOMIZER_CATEGORIES)[number];

interface MoveRandomizerPokemon {
  getTypes(): readonly PokemonType[];
  getMoveset(): readonly PokemonMove[];
  setMove(moveIndex: number, moveId: MoveId): void;
  updateInfo(): unknown;
}

export function getMoveRandomizerCandidates(
  pokemon: MoveRandomizerPokemon,
  category?: MoveRandomizerCategory,
): MoveId[] {
  const types = new Set(pokemon.getTypes());
  const knownMoves = new Set(pokemon.getMoveset().map(move => move.moveId));

  return allMoves
    .filter(
      move =>
        move != null
        && move.id !== MoveId.NONE
        && move.id !== MoveId.STRUGGLE
        && !move.isUnimplemented
        && types.has(move.type)
        && (category == null || move.category === category)
        && !knownMoves.has(move.id),
    )
    .map(move => move.id);
}

export function randomizePokemonMove(
  pokemon: MoveRandomizerPokemon,
  moveIndex: number,
  category?: MoveRandomizerCategory,
): boolean {
  if (moveIndex < 0 || moveIndex >= pokemon.getMoveset().length) {
    return false;
  }

  const candidates = getMoveRandomizerCandidates(pokemon, category);
  if (candidates.length === 0) {
    return false;
  }

  pokemon.setMove(moveIndex, randSeedItem(candidates));
  pokemon.updateInfo();
  return true;
}
