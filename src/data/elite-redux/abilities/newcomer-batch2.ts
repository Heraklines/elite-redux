/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Newcomer BATCH 2 signature abilities (Meteor Mass, Inverse Room).
//
// The bulk of the batch-2 signature abilities are authored (with real mechanics)
// in `newcomer-signature-mechanics.ts` (ids 5971-5994, the codex batch). These two
// were previously NAMED-but-INERT placeholders; they are now DEFINED (maintainer
// verdicts 2026-07-22) with real mechanics wired in `newcomer-signature-mechanics.ts`
// (`wireNewcomerSignatureAbility`), consuming this table's names/descriptions here:
//
//   - Meteor Mass  (Metagross Battle Bond innate) — a WEIGHT-centric signature: the
//     holder's weight is tripled, maxing its own Heavy Slam / Heat Crash weight ratio
//     and empowering its punching moves the heavier it is than the target; weight
//     attacks against it (Grass Knot / Low Kick) also scale up with the huge weight.
//     FLAG: the 3x multiplier is a designer-sign-off number (no 2.65 dex text exists
//     for this slot — it was a bare placeholder; 3x matches ER Lead Coat / Chrome Coat).
//   - Inverse Room (Egoelk active) — on entry, auto-sets the SAME Inverse Room field
//     effect the MOVE "Inverse Room" (er-moves.ts, id 844) sets: type matchups are
//     reversed field-wide for 5 turns (the Drought pattern; reuses `InverseRoomTag`,
//     one source of truth). Re-entering while its own room is up toggles it off (faithful
//     Room-overlap semantics).
//
// The composites Crude Steel (5995) + Minigun (5996) live in composite-newcomers.ts.
// =============================================================================

export const ER_METEOR_MASS_ABILITY_ID = 5997; // Metagross Battle Bond innate
export const ER_INVERSE_ROOM_ABILITY_ID = 5998; // Egoelk active

/** A batch-2 signature ability's registration draft (name + verbatim description). */
export interface Batch2PlaceholderDef {
  readonly id: number;
  readonly name: string;
  readonly description: string;
}

/** The two batch-2 signature abilities (mechanics in newcomer-signature-mechanics.ts). */
export const ER_BATCH2_PLACEHOLDER_ABILITIES: readonly Batch2PlaceholderDef[] = [
  {
    id: ER_METEOR_MASS_ABILITY_ID,
    name: "Meteor Mass",
    description:
      "This Pokemon's weight is tripled. Its Heavy Slam and Heat Crash hit at their maximum weight ratio, and its weight-based and punching attacks grow stronger the heavier it is than the target. Its immense weight also makes Grass Knot and Low Kick hit it harder.",
  },
  {
    id: ER_INVERSE_ROOM_ABILITY_ID,
    name: "Inverse Room",
    description:
      "On entry, sets Inverse Room for 5 turns: type matchups are reversed across the field, so super effective becomes not very effective and immunities become weaknesses.",
  },
];
