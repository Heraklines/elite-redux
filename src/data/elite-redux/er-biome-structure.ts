/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 - World Map core, VARIABLE BIOME LENGTH + the every-5 Crossroads flag.
//
// Vanilla biomes are a fixed 10 waves: isNewBiome() fires on waveIndex % 10 === 0.
// This module replaces that (behind erBiomeRoutingActive()) with a PER-RUN ROLLED
// length per biome instance, so two runs of the same biome can differ. Lengths are
// drawn from a per-biome band (SHORT / MED / LONG) and snapped to a multiple of 5,
// so:
//   - every biome still ENDS on a wave that is a multiple of 5 (the Crossroads
//     cadence and the boss/level cadence line up cleanly), and
//   - the every-5-waves Crossroads ("Stay / Move on") has a clean tick.
//
// FINALE SAFETY (critical): variable length is INACTIVE in the late game. Past
// `finalWave - LATE_GAME_MARGIN` everything reverts to the vanilla %10 cadence, and
// a biome is only given a rolled length if its WORST-CASE end (band max) still
// lands strictly before that zone. This guarantees the classic wave-200 END biome
// enters at 191 and the finale triggers at 200 exactly as vanilla - the variable
// path never reaches the late waves at all.
//
// State is module-level, reset per run (alongside the other ER resets) and folded
// additively into the erMapState save blob so a reload restores the same boundary.
// =============================================================================

import { BiomeId } from "#enums/biome-id";
import { randSeedIntRange } from "#utils/common";

/** Per-biome length band. Picked by biome id; MED is the default. */
type LengthBand = "short" | "med" | "long";

/** Inclusive [min, max] wave-count band per category (spec #486). */
const BANDS: Record<LengthBand, readonly [number, number]> = {
  short: [5, 10],
  med: [10, 18],
  long: [18, 30],
};

/** Breather / overworld biomes get the SHORT band. */
const SHORT_BIOMES: ReadonlySet<BiomeId> = new Set([BiomeId.TOWN, BiomeId.PLAINS]);

/** Delve / dungeon biomes get the LONG band. */
const LONG_BIOMES: ReadonlySet<BiomeId> = new Set([
  BiomeId.CAVE,
  BiomeId.SEABED,
  BiomeId.RUINS,
  BiomeId.JUNGLE,
  BiomeId.ICE_CAVE,
  BiomeId.WASTELAND,
  BiomeId.ABYSS,
]);

/**
 * How many waves before the run finale variable length switches off entirely.
 * Inside this margin the engine reverts to the vanilla %10 cadence so the END
 * biome / finale align exactly. 30 = three vanilla biomes of headroom.
 */
const LATE_GAME_MARGIN = 30;

/** The largest length any band can roll (used for the worst-case finale clamp). */
const MAX_BAND_LENGTH = BANDS.long[1];

function bandFor(biome: BiomeId): LengthBand {
  if (SHORT_BIOMES.has(biome)) {
    return "short";
  }
  if (LONG_BIOMES.has(biome)) {
    return "long";
  }
  return "med";
}

/** Round to the nearest multiple of 5, clamped into [min, max] and never below 5. */
function snapToFive(value: number, min: number, max: number): number {
  const snapped = Math.round(value / 5) * 5;
  return Math.max(5, Math.min(max, Math.max(min, snapped)));
}

// --- Run-scoped state -------------------------------------------------------

/** The rolled length (in waves) of the CURRENT biome instance, or null if vanilla. */
let currentLength: number | null = null;
/** The wave index the current biome was entered on (its first wave). */
let currentStartWave = 1;
/** Set by the Crossroads "Move on" choice: force the next wave to end the biome. */
let leaveBiomeNow = false;

/** Clear all structure state at run start (module state outlives a run). */
export function resetErBiomeStructure(): void {
  currentLength = null;
  currentStartWave = 1;
  leaveBiomeNow = false;
}

/** The classic mode final wave (isWaveFinal pins wave 200). */
const CLASSIC_FINAL_WAVE = 200;

/**
 * The wave past which variable length is disabled (vanilla %10 cadence resumes).
 * For classic this is 200 - 30 = 170. This module is only consulted under the
 * World Map gate, which is classic-only, so the classic final wave is correct.
 */
function lateGameThreshold(): number {
  return CLASSIC_FINAL_WAVE - LATE_GAME_MARGIN;
}

/** True once we are inside the finale-safety zone (vanilla cadence forced). */
export function erInLateGameZone(waveIndex: number): boolean {
  return waveIndex >= lateGameThreshold();
}

/**
 * Record a biome entry and roll its length. `startWave` is the wave the biome's
 * first battle sits on. If the biome's worst-case end (start + band-max - 1) would
 * reach the finale-safety zone, we DO NOT assign a rolled length - the biome falls
 * back to the vanilla %10 cadence so it can never straddle into the late game.
 */
export function erRollBiomeLength(biome: BiomeId, startWave: number): void {
  leaveBiomeNow = false;
  currentStartWave = startWave;

  // Finale safety: never roll a variable length once we're at/inside the late
  // zone, or if the biome's worst case could spill into it.
  if (startWave >= lateGameThreshold() || startWave + MAX_BAND_LENGTH - 1 >= lateGameThreshold()) {
    currentLength = null;
    return;
  }

  const [min, max] = BANDS[bandFor(biome)];
  const raw = randSeedIntRange(min, max);
  currentLength = snapToFive(raw, min, max);
}

/** Restore a biome's rolled length + start wave from a loaded save (defensive). */
export function restoreErBiomeStructure(length: number | null | undefined, startWave: number | null | undefined): void {
  currentLength = typeof length === "number" && length > 0 ? Math.floor(length) : null;
  currentStartWave = typeof startWave === "number" && startWave > 0 ? Math.floor(startWave) : 1;
  leaveBiomeNow = false;
}

/** The current biome's rolled length, or null if it is on the vanilla cadence. */
export function getErBiomeLength(): number | null {
  return currentLength;
}

/** The wave the current biome was entered on. */
export function getErBiomeStartWave(): number {
  return currentStartWave;
}

/** How many waves have been spent in the current biome AT `waveIndex` (1-based). */
export function wavesSinceEnteredBiome(waveIndex: number): number {
  return waveIndex - currentStartWave + 1;
}

/** Mark the current biome to end on the next boundary check (Crossroads "Move on"). */
export function setErLeaveBiomeNow(): void {
  leaveBiomeNow = true;
}

/** Whether the Crossroads "Move on" choice has flagged an early biome exit. */
export function getErLeaveBiomeNow(): boolean {
  return leaveBiomeNow;
}

/**
 * Whether the current biome ENDS at `waveIndex` under the variable-length rules.
 * Returns null when variable length is NOT in effect (no rolled length, or we are
 * in the finale-safety zone) so the caller falls back to vanilla %10.
 */
export function erIsBiomeEnd(waveIndex: number): boolean | null {
  if (erInLateGameZone(waveIndex)) {
    return null;
  }
  if (leaveBiomeNow) {
    return true;
  }
  if (currentLength == null) {
    return null;
  }
  return wavesSinceEnteredBiome(waveIndex) >= currentLength;
}

/**
 * Whether a Crossroads ("Stay / Move on") choice should be raised after the reward
 * at `waveIndex`: every 5 waves spent in the biome, while the biome is NOT already
 * ending this wave and we are not in the finale-safety zone or on the vanilla
 * cadence (no rolled length = nothing to "stay" in).
 */
export function erShouldRaiseCrossroads(waveIndex: number): boolean {
  if (currentLength == null || leaveBiomeNow || erInLateGameZone(waveIndex)) {
    return false;
  }
  const spent = wavesSinceEnteredBiome(waveIndex);
  if (spent <= 0 || spent % 5 !== 0) {
    return false;
  }
  // Don't offer "Stay" on the wave the biome is already ending on.
  return spent < currentLength;
}
