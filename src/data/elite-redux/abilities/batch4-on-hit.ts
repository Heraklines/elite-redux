/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Batch 4 on-hit dispatcher.
//
// Sibling of `batch3-on-hit.ts`, called from `MoveEffectPhase.applyOnTargetEffects`
// (once per target per hit, for AttackMoves) AFTER the Batch-3 seam. Drives the
// Batch-4 on-hit effects:
//   - Draconic Voodoo (5930): graft Dragon onto any target hit with a
//     biting / Dragon-type move.
//   - Hydrapex (5931): after a single-target biting/Dragon move lands, launch
//     side heads at other Dragon-typed opponents.
// =============================================================================

import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { erDraconicVoodooOnHit } from "./draconic-voodoo";
import { erHydrapexOnHit } from "./hydrapex";

/** Drive Batch-4 on-hit effects for `user`'s hit on `target`. */
export function erBatch4OnTargetHit(user: Pokemon, target: Pokemon, move: Move, damaging: boolean): void {
  erDraconicVoodooOnHit(user, target, move, damaging);
  erHydrapexOnHit(user, target, move);
}
