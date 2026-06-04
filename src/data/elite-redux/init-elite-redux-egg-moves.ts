/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — inject hand-audited ER-custom egg moves into `speciesEggMoves`.
//
// PokeRogue stores egg moves on BASE species (the evolution line inherits via
// the root species). `ER_EGG_MOVES` is keyed by ER `speciesConst`; this pass
// resolves each to its live pokerogue species id (via the ER id-map) and writes
// the 4-move tuple into `speciesEggMoves`. Idempotent + non-destructive: it never
// overwrites an existing entry, and skips any speciesConst that didn't resolve.
// =============================================================================

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { ER_EGG_MOVES } from "#data/elite-redux/er-egg-moves";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import type { MoveId } from "#enums/move-id";

export interface InitEliteReduxEggMovesResult {
  /** Number of ER species whose egg moves were registered. */
  added: number;
  /** speciesConsts that didn't resolve to a pokerogue id (id-map drift). */
  skippedUnmapped: number;
  /** Entries skipped because the species already had egg moves. */
  alreadyPresent: number;
}

export function initEliteReduxEggMoves(): InitEliteReduxEggMovesResult {
  const result: InitEliteReduxEggMovesResult = { added: 0, skippedUnmapped: 0, alreadyPresent: 0 };

  // speciesConst → ER draft id, so we can map through the species id-map.
  const draftIdByConst = new Map<string, number>();
  for (const draft of ER_SPECIES) {
    draftIdByConst.set(draft.speciesConst, draft.id);
  }

  const table = speciesEggMoves as Record<number, readonly MoveId[]>;

  for (const [speciesConst, moves] of Object.entries(ER_EGG_MOVES)) {
    const draftId = draftIdByConst.get(speciesConst);
    const pkrgId = draftId === undefined ? undefined : ER_ID_MAP.species[draftId];
    if (pkrgId === undefined) {
      result.skippedUnmapped++;
      continue;
    }
    if (table[pkrgId] !== undefined) {
      result.alreadyPresent++;
      continue;
    }
    table[pkrgId] = [...moves];
    result.added++;
  }

  return result;
}
