/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — own ghost-icon summary builder (P1.5 board). Turns the
// player's authored GhostTrainerProfile (globalScene.gameData.ghostProfile) into
// the tiny appearance summary carried in the registration payload: the resolved
// trainer sprite key + display name + title. Mirrors buildShowdownTrainer's
// profile -> TrainerType -> hasGenders -> female -> getSpriteKey resolution
// (battle-scene.ts), so the board draws the SAME ghost identity the wager screen
// and battle field use. Engine-aware (imports trainerConfigs) — kept out of the
// pure tournament-types mirror.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { type GhostTrainerProfile, sanitizeGhostProfile } from "#data/elite-redux/er-ghost-profile";
import type { GhostIconSummary } from "#data/elite-redux/showdown/tournament-types";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerType } from "#enums/trainer-type";

/** The neutral ghost-trainer sprite key when a player has authored no profile. */
export const DEFAULT_GHOST_SPRITE_KEY = "veteran_m";

/**
 * Resolve a GhostTrainerProfile to its trainer atlas key (the same path buildShowdownTrainer
 * uses): the authored TrainerType if it maps to a real config, else VETERAN; the female
 * variant only when the class hasGenders and the profile chose it.
 */
export function resolveGhostSpriteKey(profile: GhostTrainerProfile | null): string {
  const authoredType = profile?.trainerType != null && trainerConfigs[profile.trainerType] ? profile.trainerType : null;
  const trainerType = authoredType ?? TrainerType.VETERAN;
  const cfg = trainerConfigs[trainerType];
  const hasGenders = !!cfg?.hasGenders;
  const female = hasGenders && profile?.female === true;
  return cfg?.getSpriteKey(female, false) ?? DEFAULT_GHOST_SPRITE_KEY;
}

/**
 * Build the OWN ghost-icon summary from the player's saved profile, for the tournament
 * registration payload. Always carries a sprite key (resolves to the neutral default when
 * unauthored); name/title only when the player set them.
 */
export function buildOwnGhostIconSummary(): GhostIconSummary {
  const profile = sanitizeGhostProfile(globalScene.gameData.ghostProfile);
  const summary: GhostIconSummary = { spriteKey: resolveGhostSpriteKey(profile) };
  if (profile?.displayName) {
    summary.name = profile.displayName;
  }
  if (profile?.title) {
    summary.title = profile.title;
  }
  return summary;
}
