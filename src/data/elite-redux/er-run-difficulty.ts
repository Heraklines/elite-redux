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
// Stored module-level (run-scoped). It defaults to "ace" on a fresh page load,
// but the run's choice IS persisted: GameData.getSessionSaveData writes
// `erDifficulty` and initSessionFromData restores it via setErDifficulty on load,
// so a continued/refreshed run keeps its difficulty (legacy saves with no field
// default to "ace"). `ErRosterTier` is re-exported from the trainer-overlay so
// callers map difficulty → tier here.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import type { ErRosterTier } from "#data/elite-redux/er-trainer-overlay";

export type ErDifficulty = "youngster" | "ace" | "elite" | "hell";

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

/**
 * HELL-ONLY enemy level scaling, eased in so the early game is survivable. Every
 * enemy mon spawns relative to the TOP of the player's party (the single highest
 * level among the player's current Pokemon), with a wave-based handicap that
 * eases off as the run goes:
 *   - waves  1-9 : top level - 3
 *   - waves 10-19: top level - 2
 *   - waves 20-39: top level - 1
 *   - waves 40+  : top level   (full parity)
 * So a lv10 best mon faces lv7 enemies at the very start, ramping to lv10 by w40.
 * Benching a low-level mon still can't soften a wave (it's keyed off the MAX).
 *
 * STRICTLY gated to `currentDifficulty === "hell"`: Youngster / Ace / Elite keep
 * the vanilla wave-scaled levels untouched. Returns the input unchanged off-Hell,
 * when there are no enemy levels, or when the party isn't populated yet (so a
 * mid-load construction can't zero out the levels).
 */
export function applyErHellEnemyLevelScaling(
  enemyLevels: number[] | undefined,
  waveIndex: number,
): number[] | undefined {
  if (currentDifficulty !== "hell" || !enemyLevels?.length) {
    return enemyLevels;
  }
  const party = globalScene.getPlayerParty();
  let topLevel = 0;
  for (const member of party) {
    if (member.level > topLevel) {
      topLevel = member.level;
    }
  }
  if (topLevel <= 0) {
    return enemyLevels;
  }
  const handicap = waveIndex < 10 ? 3 : waveIndex < 20 ? 2 : waveIndex < 40 ? 1 : 0;
  const target = Math.max(1, topLevel - handicap);
  return enemyLevels.map(() => target);
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

/**
 * "Vanilla" difficulties (#368): Youngster and Ace play PURE PokeRogue —
 * no ER trainer rosters, no ghost trainers, no ER finale, and the early
 * high-BST wild gate applies. Elite/Hell layer the full ER experience on top.
 */
export function isErVanillaDifficulty(difficulty: ErDifficulty = currentDifficulty): boolean {
  return difficulty === "ace" || difficulty === "youngster";
}

/**
 * Per-mode WILD shiny-rate multiplier (#368/#402): Elite 1.5x, Hell 2x
 * (Youngster and Ace 1x - their perk is candy gain instead). Stacks with the
 * Shiny Charm and the challenge "Favour" boost (up to 3x).
 */
export function getErDifficultyShinyMultiplier(difficulty: ErDifficulty = currentDifficulty): number {
  switch (difficulty) {
    case "hell":
      return erBalanceNum("er.shiny.multHell");
    case "elite":
      return erBalanceNum("er.shiny.multElite");
    default:
      return 1;
  }
}

/**
 * Per-mode CANDY gain multiplier (#402): the lower difficulties reward
 * candies, the higher ones reward shinies. Youngster 2x, Ace 1.5x,
 * Elite/Hell 1x. Run-scoped like the favour bonus (egg hatches excluded by
 * the caller in addStarterCandy).
 */
export function getErDifficultyCandyMultiplier(difficulty: ErDifficulty = currentDifficulty): number {
  switch (difficulty) {
    case "youngster":
      return erBalanceNum("er.candy.multYoungster");
    case "ace":
      return erBalanceNum("er.candy.multAce");
    default:
      return 1;
  }
}

/**
 * Youngster trial mode (#368): the player's innate slots are TEMP-unlocked by
 * LEVEL for the run (no candy purchase, nothing persisted) — the same ramp
 * enemies use. Returns how many innate slots (0-3) are live at `level`.
 * Returns 0 for every other difficulty (normal candy gating applies).
 */
export function erYoungsterFreeInnateSlots(level: number): number {
  if (currentDifficulty !== "youngster") {
    return 0;
  }
  if (level >= 24) {
    return 3;
  }
  if (level >= 15) {
    return 2;
  }
  return 1;
}
