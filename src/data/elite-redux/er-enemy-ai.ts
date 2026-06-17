/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — a difficulty-gated, smarter enemy AI ("AI profile").
//
// See docs/plans/2026-06-17-battle-ai-elite-hell-design.md. The enhanced logic
// runs ONLY for trainer/boss enemies on the Elite and Hell difficulties; for
// everyone else (Youngster/Ace, wild) `getErAiProfile().active` is false and the
// core combat code takes its byte-for-byte vanilla path. The whole feature is
// reversible: flip the profile off and it's stock PokeRogue.
//
// SLICE 1 (this file's job today): real-damage / accuracy / KO-aware ATTACK move
// scoring + a determinism dial (Hell = always best move, Elite = rare misplays).
// Switching, field/strategy and doubles come in later slices.
//
// Sharpness + switch-threshold defaults live in the balance-knob registry
// (er-balance-knobs.ts, group "Battle AI") so they're editor-tunable; invalid
// overrides fall back to the defaults, so a bad edit can never break a build.
// =============================================================================

import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";

/** The enemy a profile is resolved for (structural - avoids importing Pokemon). */
interface ErAiPokemon {
  hasTrainer(): boolean;
  isBoss(): boolean;
}

export interface ErAiProfile {
  /** When false, every consumer takes the vanilla path unchanged. */
  active: boolean;
  /** 0..1. 1 = always play the best evaluated move; <1 = some chance to slide to a worse one. */
  sharpness: number;
  /** Switch eagerness threshold (lower = switches to a counter more readily). Consumed in Slice 2. */
  switchThreshold: number;
}

const INACTIVE_PROFILE: ErAiProfile = { active: false, sharpness: 0.5, switchThreshold: 3 };

/**
 * Calibration so a real-damage attack score lands on roughly the same scale as
 * the vanilla per-move benefit numbers (so attack-vs-status comparisons stay
 * sane until Slice 3 refines status/setup valuation): a hit doing ~40% of the
 * target's max HP scores ~30, matching a strong vanilla STAB attack.
 */
export const ER_DAMAGE_SCORE_SCALE = 75;
/** Added (accuracy-weighted) when a move would secure a KO this turn - dominates non-KO moves. */
export const ER_KO_BONUS = 1000;

/**
 * Whether the smarter switching logic is on (Elite/Hell). Used at switch sites
 * that don't have an enemy handle (the forced/faint replacement resolver), where
 * the gate is the run difficulty - those paths only run in trainer battles.
 */
export function isErSmartSwitching(): boolean {
  const difficulty = getErDifficulty();
  return difficulty === "elite" || difficulty === "hell";
}

/** Resolve the AI profile for a given enemy. Active only for Elite/Hell trainers & bosses. */
export function getErAiProfile(pokemon: ErAiPokemon): ErAiProfile {
  const difficulty = getErDifficulty();
  const hardMode = difficulty === "elite" || difficulty === "hell";
  if (!hardMode || !(pokemon.hasTrainer() || pokemon.isBoss())) {
    return INACTIVE_PROFILE;
  }
  const hell = difficulty === "hell";
  return {
    active: true,
    sharpness: hell ? erBalanceNum("er.ai.sharpnessHell") : erBalanceNum("er.ai.sharpnessElite"),
    switchThreshold: hell ? erBalanceNum("er.ai.switchThresholdHell") : erBalanceNum("er.ai.switchThresholdElite"),
  };
}

/**
 * Convert a simulated damage roll into a move score. Pure (unit-tested):
 *   - base = (damage / maxHp) * SCALE, accuracy-weighted;
 *   - a guaranteed KO (damage >= current HP) adds the accuracy-weighted KO bonus,
 *     so the AI prefers a *reliable* KO over a bigger but less accurate hit.
 *
 * @param accuracy move base accuracy; <= 0 means "never misses" (treated as 100).
 */
export function damageToScore(damage: number, maxHp: number, hp: number, accuracy: number): number {
  if (damage <= 0) {
    return 0;
  }
  const accFactor = (accuracy <= 0 ? 100 : Math.min(accuracy, 100)) / 100;
  const pct = damage / Math.max(1, maxHp);
  let score = pct * ER_DAMAGE_SCORE_SCALE * accFactor;
  if (damage >= hp) {
    score += ER_KO_BONUS * accFactor;
  }
  return score;
}

/**
 * Pick a move index from scores sorted DESCENDING, honoring `sharpness`. Pure
 * (unit-tested), RNG injected as `rand(n) -> 0..n-1`:
 *   - sharpness 1   -> always index 0 (the best move) - no misplays (Hell).
 *   - sharpness <1  -> may slide to the next move when scores are close, scaled
 *     by (1 - sharpness); sharpness 0.5 reproduces vanilla's slide chance.
 * Sliding stops at a sign change or a zero pivot (mirrors the vanilla guard).
 */
export function chooseMoveIndex(sortedScores: readonly number[], sharpness: number, rand: (n: number) => number): number {
  const factor = Math.max(0, (1 - sharpness) * 2);
  if (factor === 0 || sortedScores.length <= 1) {
    return 0;
  }
  let i = 0;
  while (i < sortedScores.length - 1) {
    const a = sortedScores[i];
    const b = sortedScores[i + 1];
    if (a === 0 || b / a < 0) {
      break;
    }
    const slideChance = Math.round((b / a) * 50 * factor);
    if (rand(100) < slideChance) {
      i++;
    } else {
      break;
    }
  }
  return i;
}
