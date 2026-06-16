/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #504 - Biome NOTORIETY (overstay escalation).
//
// The first NOTORIETY_FREE_WAVES (10) waves spent in a biome run the GLOBAL
// difficulty curve EXACTLY as before (BST cap, level cap, encounter/boss/trainer
// rates). Linger PAST that and the biome turns hostile: the "overstay" amount
// (waves over the free window) drives additive, LOCAL escalation of:
//   - boss / trainer encounter RATE,
//   - the enemy BST cap (up to a +100 ceiling),
//   - enemy / trainer LEVEL (over the normal cap, to a fixed ceiling),
//   - resist-berry / ward-stone / held-item drop rates.
//
// CRITICAL INVARIANT: every getter here is a PURE function of `overstay`, and
// `overstay` is derived from `wavesSinceEnteredBiome(waveIndex)` - which reads the
// per-biome start wave that RESETS on every biome entry. So leaving an over-stayed
// biome drops overstay back to <=0 and the global curve resumes EXACTLY. Nothing
// here mutates any persistent / global BST or level state.
//
// All callers gate on erBiomeRoutingActive() so production / non-classic / daily /
// endless / random-biome runs are 100% unchanged.
// =============================================================================

import { erInLateGameZone, wavesSinceEnteredBiome } from "#data/elite-redux/er-biome-structure";

/** In-biome waves that run the global curve untouched. Past this = notoriety. */
export const NOTORIETY_FREE_WAVES = 10;

/** BST bonus ceiling (added to the wave's normal BST cap) at full notoriety. */
export const NOTORIETY_MAX_BST_BONUS = 100;

/** Over-cap LEVEL ceiling enemies may reach at full notoriety. */
export const NOTORIETY_MAX_OVER_LEVEL = 25;

/**
 * Overstay reached when the additive ceilings (BST +100, level) are hit and HELD.
 * Spec: the +100 BST ceiling is reached by ~10 waves OVER the free window
 * (~wave 20 in the biome), then holds. Level over-cap shares that scale point.
 */
const NOTORIETY_RAMP_WAVES = 10;

/**
 * Raw overstay at `waveIndex`: waves spent in the biome beyond the free window.
 * 0 inside the free window (and in the finale-safety zone, where notoriety is
 * disabled so the wave-200 finale is untouched).
 */
export function erBiomeOverstay(waveIndex: number): number {
  if (erInLateGameZone(waveIndex)) {
    return 0;
  }
  return Math.max(0, wavesSinceEnteredBiome(waveIndex) - NOTORIETY_FREE_WAVES);
}

/** Whether notoriety is in effect at `waveIndex` (overstay > 0). */
export function erHasNotoriety(waveIndex: number): boolean {
  return erBiomeOverstay(waveIndex) > 0;
}

/**
 * 0..1 ramp from the start of notoriety to the ceiling-hold point. Linear over
 * NOTORIETY_RAMP_WAVES, then clamped to 1 (held). Pure function of overstay.
 */
function notorietyRamp(overstay: number): number {
  if (overstay <= 0) {
    return 0;
  }
  return Math.min(1, overstay / NOTORIETY_RAMP_WAVES);
}

/**
 * Additive BST bonus on top of the wave's normal BST cap, 0..NOTORIETY_MAX_BST_BONUS.
 * Climbs to +100 by ~10 waves over the free window, then HOLDS.
 */
export function erNotorietyBstBonus(waveIndex: number): number {
  const overstay = erBiomeOverstay(waveIndex);
  return Math.round(notorietyRamp(overstay) * NOTORIETY_MAX_BST_BONUS);
}

/**
 * Additive over-cap LEVELS enemies/trainers may exceed the normal level cap by,
 * 0..NOTORIETY_MAX_OVER_LEVEL. Scales with notoriety to a fixed ceiling reached at
 * the same point as the +100 BST ceiling. The GLOBAL level cap itself is untouched.
 */
export function erNotorietyOverLevel(waveIndex: number): number {
  const overstay = erBiomeOverstay(waveIndex);
  return Math.round(notorietyRamp(overstay) * NOTORIETY_MAX_OVER_LEVEL);
}

/**
 * Multiplier on resist-berry / ward-stone / held-item drop RATES, >= 1.
 * +10% per overstay wave, capped at 3x (so over-stayed biomes get noticeably
 * gear-rich enemies without certainty). Pure function of overstay.
 */
export function erNotorietyItemRateMult(waveIndex: number): number {
  const overstay = erBiomeOverstay(waveIndex);
  if (overstay <= 0) {
    return 1;
  }
  return Math.min(3, 1 + overstay * 0.1);
}

/**
 * Extra percent-chance that a WILD wave is forced to spawn a boss, on top of the
 * vanilla every-10 boss cadence. Mirrors the spec rate ramp:
 *   - ~1-5 waves over   -> a boss roughly every 3 waves (~33%),
 *   - ~6-10 waves over  -> bosses ~every 2 waves (~50%),
 *   - ~10+ waves over   -> a boss EVERY wave (100%).
 * Returns 0..100. Pure function of overstay.
 */
export function erNotorietyBossChancePct(waveIndex: number): number {
  const overstay = erBiomeOverstay(waveIndex);
  if (overstay <= 0) {
    return 0;
  }
  if (overstay >= NOTORIETY_RAMP_WAVES) {
    return 100;
  }
  if (overstay >= 6) {
    return 50;
  }
  return 33;
}

/**
 * Extra percent-chance to force a TRAINER on a non-boss wave once over-stayed.
 * Lags the boss rate slightly (bosses come first) but climbs to near-certain at
 * full notoriety so the over-stayed biome is wall-to-wall trainers + bosses.
 * Returns 0..100. Pure function of overstay.
 */
export function erNotorietyTrainerChancePct(waveIndex: number): number {
  const overstay = erBiomeOverstay(waveIndex);
  if (overstay <= 0) {
    return 0;
  }
  if (overstay >= NOTORIETY_RAMP_WAVES) {
    return 90;
  }
  if (overstay >= 6) {
    return 50;
  }
  return 25;
}
