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

import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves, tmPoolTiers } from "#balance/tms";
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
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

  /** Extract the move id from a forward-map entry (plain id or [variant, id]). */
  const entryMoveId = (entry: MoveId | [string | SpeciesId, MoveId]): number =>
    Array.isArray(entry) ? (entry[1] as number) : (entry as number);
  /** Whether a reverse-map entry refers to the given species id (plain or [id, …]). */
  const reverseEntryIsSpecies = (entry: SpeciesId | Array<SpeciesId | string>, id: number): boolean =>
    Array.isArray(entry) ? entry[0] === id : entry === id;

  for (const draft of ER_SPECIES) {
    const pokerogueSpeciesId = ER_ID_MAP.species[draft.id];
    if (pokerogueSpeciesId === undefined) {
      result.pairsSkippedUnmapped += draft.tutorMoves.length;
      continue;
    }

    // ER's authoritative teachable-move set for a species is its `tutorMoves`
    // (ER uses universal tutors instead of per-TM compatibility; every record
    // ships `tmhmMoves: []`). The TM-learnable set must therefore be EXACTLY the
    // mapped tutorMoves — NOT vanilla's TM compatibility plus ER additions. The
    // old additive merge left vanilla-only moves reachable that ER never grants
    // (e.g. enemy Salazzle using Scald). Build the ER set, then reconcile both
    // the forward (species→moves) and reverse (move→species) maps to it.
    const erSet = new Set<number>();
    for (const tutorMoveId of draft.tutorMoves) {
      const pokerogueMoveId = ER_ID_MAP.moves[tutorMoveId];
      if (pokerogueMoveId === undefined || !allMoves[pokerogueMoveId]) {
        result.pairsSkippedUnmapped++;
        continue;
      }
      erSet.add(pokerogueMoveId);
    }

    // Previous forward list for this species (to compute removals).
    const oldForward = tmsBySpecies[pokerogueSpeciesId] ?? [];
    const oldMoveIds = new Set<number>(oldForward.map(entryMoveId));

    // Reverse-map removals: drop this species from any move it no longer learns.
    for (const oldMoveId of oldMoveIds) {
      if (!erSet.has(oldMoveId) && speciesByTm[oldMoveId]) {
        speciesByTm[oldMoveId] = speciesByTm[oldMoveId].filter(e => !reverseEntryIsSpecies(e, pokerogueSpeciesId));
      }
    }

    // Forward map: replace wholesale with the ER set (deterministic order).
    tmsBySpecies[pokerogueSpeciesId] = [...erSet] as MoveId[];

    // Reverse-map additions + reward-pool registration for newly-learnable moves.
    for (const moveId of erSet) {
      if (oldMoveIds.has(moveId)) {
        result.pairsSkippedDup++;
      } else {
        if (!speciesByTm[moveId]) {
          speciesByTm[moveId] = [];
        }
        speciesByTm[moveId].push(pokerogueSpeciesId as SpeciesId);
        result.pairsAdded++;
      }
      if (tiers[moveId] === undefined) {
        tiers[moveId] = ModifierTier.ULTRA;
        result.movesAddedToPool++;
      }
    }
  }

  return result;
}
