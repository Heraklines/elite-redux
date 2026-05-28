// =============================================================================
// Elite Redux — extend the TM-learnable move pool with each species's full ER
// tutor move list.
//
// In Elite Redux's source, every Pokémon has a `tutor` array on the species
// dump that lists every move it could learn from a move tutor. Pokerogue's
// equivalent — TMs in starter-select / TM rewards in runs — only includes
// moves explicitly listed in `tmSpecies` (move → species[]) and the inverse
// `speciesTmMoves` (species → moves[]).
//
// Pokerogue runs primarily reward:
//   - level-up moves (the species's own moveset, gated by current level)
//   - TM rewards (random TMs from the pool that match species's tmMoves)
//
// Without this patch, every move ER added to a species's tutor pool is
// effectively unreachable in a run — players can't put those moves on a
// Pokémon at all. This is a big chunk of the ER experience.
//
// This module:
//   1. Adds every (species, tutorMove) pair to BOTH `tmSpecies` and
//      `speciesTmMoves` so the move is treated as TM-learnable for that
//      species in starter-select, pokedex page, and AI moveset gen.
//   2. Adds each NEW move (one not already in `tmPoolTiers`) to the TM reward
//      pool at the ULTRA tier so it can actually drop as a TM reward in runs.
//      ULTRA is a reasonable mid-tier default — common enough to see, rare
//      enough that not every wave drops one.
//
// Idempotent: re-running it is a no-op (each `(species, move)` pair is
// deduped, tier assignments are skipped if already set).
//
// Order constraint: must run AFTER initEliteReduxCustomSpecies() (so ER
// custom species ids resolve through ER_ID_MAP), AFTER initEliteReduxCustomMoves
// (so move ids resolve), and AFTER pokerogue's initialization of tmSpecies /
// speciesTmMoves / tmPoolTiers (which happens at module-load time, so any
// runtime call here is fine).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { speciesTmMoves, tmPoolTiers } from "#balance/tms";
import { tmSpecies } from "#balance/tm-species-map";
import { ModifierTier } from "#enums/modifier-tier";
import type { MoveId } from "#enums/move-id";
import type { SpeciesId } from "#enums/species-id";

export interface InitEliteReduxTmMovesResult {
  /** Number of (species, move) pairs newly added across the run. */
  pairsAdded: number;
  /** Number of pairs skipped because the species/move id couldn't resolve. */
  pairsSkippedUnmapped: number;
  /** Number of pairs skipped because already present (idempotent re-run). */
  pairsSkippedDup: number;
  /** Number of NEW moves added to tmPoolTiers (won't drop as rewards otherwise). */
  movesAddedToPool: number;
}

export function initEliteReduxTmMoves(): InitEliteReduxTmMovesResult {
  const result: InitEliteReduxTmMovesResult = {
    pairsAdded: 0,
    pairsSkippedUnmapped: 0,
    pairsSkippedDup: 0,
    movesAddedToPool: 0,
  };

  // Looser typings for safe runtime mutation. The `const` export freezes the
  // binding, not the object — assignment works at runtime.
  const tmsBySpecies = speciesTmMoves as Record<number, (MoveId | [string | SpeciesId, MoveId])[]>;
  const speciesByTm = tmSpecies as Record<number, Array<SpeciesId | Array<SpeciesId | string>>>;
  const tiers = tmPoolTiers as Record<number, ModifierTier>;

  for (const draft of ER_SPECIES) {
    const pokerogueSpeciesId = ER_ID_MAP.species[draft.id];
    if (pokerogueSpeciesId === undefined) {
      result.pairsSkippedUnmapped += draft.tutorMoves.length;
      continue;
    }

    // Build a quick set of moves already TM-learnable for dedup.
    const existing = tmsBySpecies[pokerogueSpeciesId];
    const existingMoveSet = new Set<number>();
    if (existing) {
      for (const entry of existing) {
        if (Array.isArray(entry)) {
          existingMoveSet.add(entry[1] as number);
        } else {
          existingMoveSet.add(entry as number);
        }
      }
    }

    for (const tutorMoveId of draft.tutorMoves) {
      const pokerogueMoveId = ER_ID_MAP.moves[tutorMoveId];
      if (pokerogueMoveId === undefined) {
        result.pairsSkippedUnmapped++;
        continue;
      }
      // Verify the move actually has an `allMoves` entry — a partial init
      // could otherwise leak a phantom move id into the TM pool, crashing
      // downstream consumers that index allMoves[moveId].
      if (!allMoves[pokerogueMoveId]) {
        result.pairsSkippedUnmapped++;
        continue;
      }
      if (existingMoveSet.has(pokerogueMoveId)) {
        result.pairsSkippedDup++;
        continue;
      }
      existingMoveSet.add(pokerogueMoveId);

      // Forward: species → move
      if (!tmsBySpecies[pokerogueSpeciesId]) {
        tmsBySpecies[pokerogueSpeciesId] = [];
      }
      tmsBySpecies[pokerogueSpeciesId].push(pokerogueMoveId as MoveId);

      // Reverse: move → species
      if (!speciesByTm[pokerogueMoveId]) {
        speciesByTm[pokerogueMoveId] = [];
      }
      speciesByTm[pokerogueMoveId].push(pokerogueSpeciesId as SpeciesId);

      // Reward pool: ensure the move drops as a TM in runs.
      if (tiers[pokerogueMoveId] === undefined) {
        tiers[pokerogueMoveId] = ModifierTier.ULTRA;
        result.movesAddedToPool++;
      }

      result.pairsAdded++;
    }
  }

  return result;
}
