/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - apply a CommunityChallengeConfig to the live run.
//
// Called from TitlePhase.end(), AFTER the CHALLENGE gameMode has been rebuilt
// (getGameMode re-clones every challenge at value 0) and BEFORE the phase pushes
// SelectStarterPhase. It reproduces the config's {baseChallenges, difficulty,
// allowedSpecies, seed} verbatim onto the run - which is also the worker
// `/community/clear` config-match anti-cheat key, so this MUST stay 1:1 with the
// config (any divergence makes future clears verify=0).
//
// Per-run resets (resetErRunTrainerTracking / GhostRunState / MapNodes /
// MoneyStreaks) are DELIBERATELY omitted: startRun() in starter-select runs them
// after the player confirms the team, so re-doing them here would just be
// overwritten.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { CommunityChallengeConfig } from "#data/elite-redux/er-community-challenges";
import {
  setCommunityAllowedSpecies,
  setForcedCommunityDifficulty,
} from "#data/elite-redux/er-community-run-state";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";

/** Apply a community challenge config to the already-rebuilt `globalScene.gameMode`. */
export function applyCommunityChallengeToRun(config: CommunityChallengeConfig): void {
  for (const [id, value, severity] of config.baseChallenges) {
    globalScene.gameMode.setChallengeValue(id, value, severity);
  }
  setErDifficulty(config.difficulty);
  setForcedCommunityDifficulty(config.difficulty); // starter-select skips the chooser
  setCommunityAllowedSpecies(config.allowedSpecies); // null => no grid gate (Inferno path)
  if (config.seed) {
    globalScene.setSeed(config.seed);
    globalScene.resetSeed();
  }
}
