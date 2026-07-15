/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Spore Bed`.
//
// On entry, lays a one-use Infestation trap on the opposing side. The next
// grounded opposing Pokemon to switch in is trapped by Infestation for its
// ordinary duration. Uses the reusable `entry-trap-on-foe-side` primitive with
// {@linkcode BattlerTagType.INFESTATION}. Wired in
// `init-elite-redux-custom-abilities.ts` via the manual-drafts registration path.
// =============================================================================

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_SPORE_BED_ABILITY_ID = 5902;
