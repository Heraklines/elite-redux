/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — run difficulty (Ace / Elite / Hell).
//
// Chosen by the player right after team selection (see starter-select-ui-handler
// `tryStart`). Drives which ER trainer roster TIER the trainer-runtime hook uses
// for the run:
//   - Ace   → "party"   (ER easy roster)
//   - Elite → "insane"  (ER mid roster)
//   - Hell  → "hell"    (ER hardest roster)
//
// Stored module-level (run-scoped). It resets to the default on a fresh page
// load; persisting it into session save data is a follow-up. `ErRosterTier` is
// re-exported from the trainer-overlay so callers map difficulty → tier here.
// =============================================================================

import type { ErRosterTier } from "#data/elite-redux/er-trainer-overlay";

export type ErDifficulty = "ace" | "elite" | "hell";

/** Default difficulty when the player hasn't chosen (or after a reload). */
const DEFAULT_DIFFICULTY: ErDifficulty = "ace";

let currentDifficulty: ErDifficulty = DEFAULT_DIFFICULTY;

/** The difficulty selected for the current run. */
export function getErDifficulty(): ErDifficulty {
  return currentDifficulty;
}

/** Set the run difficulty (called from the post-team-select chooser). */
export function setErDifficulty(difficulty: ErDifficulty): void {
  currentDifficulty = difficulty;
}

/** Reset to the default (e.g. when returning to the title / starting fresh). */
export function resetErDifficulty(): void {
  currentDifficulty = DEFAULT_DIFFICULTY;
}

/** Map the chosen difficulty to the ER trainer roster tier it should use. */
export function erDifficultyToRosterTier(difficulty: ErDifficulty = currentDifficulty): ErRosterTier {
  switch (difficulty) {
    case "hell":
      return "hell";
    case "elite":
      return "insane";
    default:
      return "party";
  }
}
