/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Challenge "Favour" → shiny-odds system.
//
// Roguelike-style reward for handicapping yourself: each active challenge grants
// some FAVOUR. The more favour a run carries, the higher its shiny odds —
// every FAVOUR_PER_STEP favour bumps the shiny multiplier by one step, capped at
// FAVOUR_SHINY_MAX_MULT (triple the base rate).
//
// Favour is derived live from the run's active challenges (which are persisted
// with the save), so it needs no separate storage. Read it at the shiny roll
// (Pokemon.trySetShiny) and in the challenge-select UI.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { Challenge } from "#data/challenge";
import { Challenges } from "#enums/challenges";

/** Favour granted by each challenge while it is active (value > 0). */
const FAVOUR_BY_CHALLENGE: Partial<Record<Challenges, number>> = {
  [Challenges.SINGLE_GENERATION]: 5, // Mono-generation
  [Challenges.SINGLE_TYPE]: 5, // Mono-type
  [Challenges.FRESH_START]: 3,
  [Challenges.INVERSE_BATTLE]: 3,
  [Challenges.FLIP_STAT]: 3,
  [Challenges.LIMITED_CATCH]: 4,
  [Challenges.LIMITED_SUPPORT]: 6,
  [Challenges.HARDCORE]: 8,
  [Challenges.PASSIVES]: 10, // No Passives — by far the biggest ER handicap
  [Challenges.LOWER_MAX_STARTER_COST]: 3,
  [Challenges.LOWER_STARTER_POINTS]: 3,
};

/** Favour granted per "step" of the shiny curve. */
export const FAVOUR_PER_STEP = 5;
/** Shiny multiplier added per step. */
export const FAVOUR_SHINY_STEP_BONUS = 0.5;
/** Hard cap on the shiny multiplier (triple the base rate). */
export const FAVOUR_SHINY_MAX_MULT = 3;

/** Favour a single challenge contributes right now (0 when inactive). */
export function getChallengeFavour(challenge: Challenge): number {
  return challenge.value > 0 ? (FAVOUR_BY_CHALLENGE[challenge.id] ?? 0) : 0;
}

/** Total favour from all active challenges on the current run. */
export function getRunShinyFavour(): number {
  const challenges = globalScene.gameMode?.challenges ?? [];
  return challenges.reduce((sum, c) => sum + getChallengeFavour(c), 0);
}

/**
 * Map a favour total to a shiny-odds multiplier: +{@linkcode FAVOUR_SHINY_STEP_BONUS}
 * per {@linkcode FAVOUR_PER_STEP} favour, capped at {@linkcode FAVOUR_SHINY_MAX_MULT}.
 * (e.g. 0→×1, 5→×1.5, 10→×2, 15→×2.5, 20+→×3.)
 */
export function favourToShinyMultiplier(favour: number): number {
  const steps = Math.floor(Math.max(0, favour) / FAVOUR_PER_STEP);
  return Math.min(FAVOUR_SHINY_MAX_MULT, 1 + FAVOUR_SHINY_STEP_BONUS * steps);
}

/** The current run's shiny multiplier from its challenge favour (≥1). */
export function getRunShinyMultiplier(): number {
  return favourToShinyMultiplier(getRunShinyFavour());
}
