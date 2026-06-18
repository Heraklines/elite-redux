/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #542 - Fairy's Boon TEMPORARY LUCK.
//
// The Fairy's Boon (Fairy Cave) no longer hands out a permanent free relic (too
// basic, too generous). Instead, accepting the blessing grants a TEMPORARY luck
// surge: the party's effective luck is boosted by FAIRY_LUCK_BONUS for the next
// FAIRY_LUCK_DURATION waves, then it fades. This sweetens reward rolls (shinies,
// reward-tier upgrades, the luck UI) only while the blessing lasts.
//
// Modelled as a PURE function of the current wave: a single expiry wave is
// stored, so getErTemporaryLuck(wave) returns the bonus while wave <= expiry and
// 0 after - no per-wave decrement hook needed (which would be fragile across
// save/load). State is run-scoped, reset per run, and folded into the erMapState
// save blob so a reload keeps the remaining blessing.
// =============================================================================

/** Effective luck added to the party total while a Fairy's Boon is active. */
export const FAIRY_LUCK_BONUS = 6;

/** How many waves a Fairy's Boon blessing lasts from the wave it is granted. */
export const FAIRY_LUCK_DURATION = 12;

// --- Run-scoped state -------------------------------------------------------

/** Luck bonus currently granted (0 = none active). */
let activeBonus = 0;
/** The last wave (inclusive) the active bonus applies on; 0 = none. */
let expiryWave = 0;

/** Clear the blessing at run start (module state outlives a run). */
export function resetErFairyLuck(): void {
  activeBonus = 0;
  expiryWave = 0;
}

/**
 * Grant (or refresh) a temporary luck blessing of `bonus` luck for `duration`
 * waves starting at `currentWave`. A fresh blessing overwrites any prior one.
 */
export function grantErFairyLuck(bonus: number, duration: number, currentWave: number): void {
  activeBonus = Math.max(0, Math.floor(bonus));
  expiryWave = currentWave + Math.max(0, Math.floor(duration));
}

/** The temporary luck bonus in effect at `currentWave` (0 once it has faded). */
export function getErTemporaryLuck(currentWave: number): number {
  if (activeBonus <= 0 || currentWave > expiryWave) {
    return 0;
  }
  return activeBonus;
}

/** Waves of blessing remaining at `currentWave` (0 if none / expired). */
export function erFairyLuckWavesLeft(currentWave: number): number {
  if (activeBonus <= 0 || currentWave > expiryWave) {
    return 0;
  }
  return expiryWave - currentWave + 1;
}

/** Save snapshot: the active bonus + its expiry wave (for the erMapState blob). */
export function getErFairyLuckSave(): { bonus: number; expiryWave: number } {
  return { bonus: activeBonus, expiryWave };
}

/** Restore the blessing from a save (defensive: ignores malformed values). */
export function restoreErFairyLuck(bonus: number | null | undefined, expiry: number | null | undefined): void {
  activeBonus = typeof bonus === "number" && bonus > 0 ? Math.floor(bonus) : 0;
  expiryWave = typeof expiry === "number" && expiry > 0 ? Math.floor(expiry) : 0;
}
