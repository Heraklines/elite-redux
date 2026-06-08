/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — apply the editor-managed egg-move table to `speciesEggMoves`.
//
// PokeRogue stores egg moves on BASE species (the evolution line inherits via
// the root species). `ER_EGG_MOVES` is keyed by `speciesConst` and now covers the
// FULL roster (vanilla + ER customs); it is the authoritative source the team
// edits. This pass resolves each const to its live pokerogue species id and
// OVERRIDES `speciesEggMoves` with the table value:
//   - vanilla species  → the `SpeciesId` enum (SPECIES_PIKACHU → SpeciesId.PIKACHU)
//   - ER customs        → the ER id-map (draft id → pokerogue id)
// Override (not skip-if-present) is what makes a team edit to a vanilla species'
// egg moves actually take effect. Vanilla entries that weren't edited carry the
// same values they were migrated from, so re-applying them is a no-op.
// =============================================================================

import { speciesEggMoves } from "#balance/moves/egg-moves";
import { ER_EGG_MOVES } from "#data/elite-redux/er-egg-moves";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import type { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";

export interface InitEliteReduxEggMovesResult {
  /** Species that gained egg moves they didn't have before (mostly ER customs). */
  added: number;
  /** Existing entries overridden in place (mostly vanilla — usually unchanged). */
  alreadyPresent: number;
  /** speciesConsts that didn't resolve to a pokerogue id (id-map drift). */
  skippedUnmapped: number;
}

export function initEliteReduxEggMoves(): InitEliteReduxEggMovesResult {
  const result: InitEliteReduxEggMovesResult = { added: 0, alreadyPresent: 0, skippedUnmapped: 0 };

  // speciesConst → ER draft id, so we can map ER customs through the species id-map.
  const draftIdByConst = new Map<string, number>();
  for (const draft of ER_SPECIES) {
    draftIdByConst.set(draft.speciesConst, draft.id);
  }

  const speciesIdByName = SpeciesId as unknown as Record<string, number | undefined>;
  const table = speciesEggMoves as Record<number, readonly MoveId[]>;

  for (const [speciesConst, moves] of Object.entries(ER_EGG_MOVES)) {
    // Prefer the ER id-map for known ER customs (collision-safe), else vanilla SpeciesId.
    const draftId = draftIdByConst.get(speciesConst);
    let pkrgId: number | undefined;
    if (draftId === undefined) {
      pkrgId = speciesIdByName[speciesConst.replace(/^SPECIES_/, "")];
    } else {
      pkrgId = ER_ID_MAP.species[draftId];
    }
    if (typeof pkrgId !== "number") {
      result.skippedUnmapped++;
      continue;
    }
    if (moves.length === 0) {
      continue; // nothing resolved — leave any existing entry untouched
    }
    if (table[pkrgId] === undefined) {
      result.added++;
    } else {
      result.alreadyPresent++;
    }
    table[pkrgId] = [...moves];
  }

  return result;
}
