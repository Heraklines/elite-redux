/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Newcomer BATCH 2 RESIDUAL placeholder abilities.
//
// The bulk of the batch-2 signature abilities are authored (with real mechanics)
// in `newcomer-signature-mechanics.ts` (ids 5971-5994, the codex batch). Only the
// TWO names that batch-2 mons reference but that batch does NOT define remain as
// NAMED, battle-INERT placeholders here — so the mon carries the correctly-named
// slot and renders on every surface, but does nothing until the designer defines
// it (batch-1 "PARKED" precedent). Both are flagged for the designer.
//
//   - Meteor Mass  (Metagross Battle Bond innate)
//   - Inverse Room (Egoelk active) — NOTE: a MOVE named "Inverse Room" exists in
//     er-moves.ts; the designer's intent for this ability slot is unresolved.
//
// The composites Crude Steel (5995) + Minigun (5996) live in composite-newcomers.ts.
// =============================================================================

export const ER_METEOR_MASS_ABILITY_ID = 5997; // Metagross Battle Bond innate
export const ER_INVERSE_ROOM_ABILITY_ID = 5998; // Egoelk active

/** A parked placeholder's registration draft (name + inert description). */
export interface Batch2PlaceholderDef {
  readonly id: number;
  readonly name: string;
  readonly description: string;
}

/** The residual parked placeholders (no design yet — flagged for the designer). */
export const ER_BATCH2_PLACEHOLDER_ABILITIES: readonly Batch2PlaceholderDef[] = [
  { id: ER_METEOR_MASS_ABILITY_ID, name: "Meteor Mass", description: "Signature ability (definition pending)." },
  { id: ER_INVERSE_ROOM_ABILITY_ID, name: "Inverse Room", description: "Signature ability (definition pending)." },
];
