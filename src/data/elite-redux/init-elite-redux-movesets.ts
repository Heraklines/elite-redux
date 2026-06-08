// =============================================================================
// Elite Redux — Phase B Task B6 (movesets): wire ER per-species level-up
// movesets onto pokerogue's `pokemonSpeciesLevelMoves` table.
//
// ER ships its own moveset for every species in `er-species.ts`:
//   - `levelUpMoves`: `{ id: number; level: number }[]`
//   - `tmhmMoves` / `tutorMoves` / `eggMoves`: ER move ids (unused here)
//
// For each ER species whose pokerogue id resolves cleanly, we OVERWRITE
// pokerogue's level-up moveset entry with ER's data (after translating each
// ER move id through `ER_ID_MAP.moves`).
//
// Mutability boundary: `pokemonSpeciesLevelMoves` is a regular mutable object
// literal exported as `const` (the binding is frozen, not the object). Direct
// property assignment is safe. We do NOT touch `pokemonFormLevelMoves` — ER
// does not ship per-form movesets (ER models megas as their own species,
// not as forms).
//
// Order constraint: must run AFTER `initMoves()` (so move ids are stable) and
// AFTER `initEliteReduxCustomMoves()` (so ER-custom move ids ≥ 5000 are
// guaranteed valid). The patcher does NOT need pokerogue's species table —
// the level-moves table is keyed purely by species id.
//
// Vanilla-vs-custom species handling:
//   - VANILLA species (pokerogue id < 10000): OVERWRITE the existing entry.
//   - ER-CUSTOM species (pokerogue id >= 10000): CREATE a fresh entry —
//     pokerogue's `pokemonSpeciesLevelMoves` won't have one yet (B1b
//     registered the species but not its moves).
//
// Idempotency: a second invocation observes the already-patched state and
// counts the same number of writes (we don't compare against the pre-existing
// pokerogue baseline — that semantic would require snapshotting). The result
// type reports `speciesPatched` per run, not "deltas".
// =============================================================================

import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { LevelMoves } from "#types/pokemon-level-moves";

const CASCOON_PRIMAL_ER_ID = 2157;
const CASCOON_ANGELS_WRATH_MOVES: LevelMoves = [
  [1, MoveId.TACKLE],
  [1, MoveId.POISON_STING],
  [1, MoveId.STRING_SHOT],
  [1, MoveId.HARDEN],
  [1, MoveId.IRON_DEFENSE],
  [1, MoveId.ELECTROWEB],
  [1, MoveId.BUG_BITE],
];

/** Aggregated result of a single `initEliteReduxMovesets()` run. */
export interface InitEliteReduxMovesetsResult {
  /** Number of species whose level-up moveset table entry was written. */
  speciesPatched: number;
  /** Total `[level, MoveId]` pairs applied across all patched species. */
  movesetEntriesApplied: number;
  /** ER species skipped because they had no `ER_ID_MAP.species` mapping. */
  speciesSkippedNoMapping: number;
  /** ER species skipped because their `levelUpMoves` array is empty. */
  speciesSkippedEmpty: number;
  /**
   * Count of individual ER move ids that had no `ER_ID_MAP.moves` entry and
   * were dropped from the patched moveset. Pre-existing id-map drift —
   * surfaces a coverage gap without failing the patcher.
   */
  moveIdsDropped: number;
  /** Non-fatal real errors. */
  errors: string[];
}

/**
 * Patch pokerogue's `pokemonSpeciesLevelMoves` table with ER's per-species
 * level-up movesets. Idempotent: safe to call multiple times — the second
 * call overwrites the first with identical data.
 *
 * @returns A summary of how many species/movesets were touched and any
 *          non-fatal errors encountered.
 */
export function initEliteReduxMovesets(): InitEliteReduxMovesetsResult {
  const result: InitEliteReduxMovesetsResult = {
    speciesPatched: 0,
    movesetEntriesApplied: 0,
    speciesSkippedNoMapping: 0,
    speciesSkippedEmpty: 0,
    moveIdsDropped: 0,
    errors: [],
  };

  // The level-moves table is a regular mutable object literal; the `const`
  // export freezes the binding, not the object. Direct property assignment
  // is safe at runtime.
  const table = pokemonSpeciesLevelMoves as Record<number, LevelMoves>;

  for (const draft of ER_SPECIES) {
    if (draft.levelUpMoves.length === 0) {
      result.speciesSkippedEmpty++;
      continue;
    }

    const pokerogueSpeciesId = ER_ID_MAP.species[draft.id];
    if (pokerogueSpeciesId === undefined) {
      result.speciesSkippedNoMapping++;
      continue;
    }

    // Translate each ER move id through ER_ID_MAP.moves and drop any that
    // can't be resolved. We preserve ER's ordering (ER orders by level
    // ascending; pokerogue does the same).
    const translated: LevelMoves = [];
    for (const lvm of draft.levelUpMoves) {
      const pokerogueMoveId = ER_ID_MAP.moves[lvm.id];
      if (pokerogueMoveId === undefined) {
        result.moveIdsDropped++;
        continue;
      }
      // SECOND defense: verify the resolved pokerogue id actually has a
      // registered Move in `allMoves`. ER-custom ids that failed to register
      // in `initEliteReduxCustomMoves` would otherwise slip through to a
      // trainer's moveset and crash later reads (getMatchupScore,
      // loadAssets, etc.).
      if (!allMoves[pokerogueMoveId]) {
        result.moveIdsDropped++;
        continue;
      }
      // Cast through `MoveId` — we know the id is in range because the
      // id-map points to either a vanilla id (< 5000) or an ER-custom id
      // (≥ 5000) that B2 already registered.
      translated.push([lvm.level, pokerogueMoveId as MoveId]);
    }

    if (translated.length === 0) {
      // All move ids dropped — defensive skip (don't clobber an existing
      // pokerogue moveset with an empty array).
      continue;
    }

    table[pokerogueSpeciesId] = translated;
    result.speciesPatched++;
    result.movesetEntriesApplied += translated.length;
  }

  installCascoonAngelsWrathMoves(table, SpeciesId.CASCOON);
  installCascoonAngelsWrathMoves(table, ER_ID_MAP.species[CASCOON_PRIMAL_ER_ID]);

  return result;
}

function installCascoonAngelsWrathMoves(table: Record<number, LevelMoves>, speciesId: number | undefined): void {
  if (speciesId === undefined) {
    return;
  }
  const moves = table[speciesId] ? [...table[speciesId]] : [];
  for (const [level, moveId] of CASCOON_ANGELS_WRATH_MOVES) {
    if (!moves.some(([, existingMove]) => existingMove === moveId)) {
      moves.push([level, moveId]);
    }
  }
  moves.sort((a, b) => a[0] - b[0]);
  table[speciesId] = moves;
}
