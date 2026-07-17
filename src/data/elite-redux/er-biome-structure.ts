/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #486 / #504 - World Map core, VARIABLE BIOME LENGTH + the every-5 Crossroads
// flag + biome NOTORIETY (overstay escalation).
//
// Vanilla biomes are a fixed 10 waves: isNewBiome() fires on waveIndex % 10 === 0.
// This module replaces that (behind erBiomeRoutingActive()) with a PER-RUN ROLLED
// length per biome instance, so two runs of the same biome can differ.
//
// #504 reworks the lengths: a single rolled range [BIOME_LENGTH_MIN,
// BIOME_LENGTH_MAX] = [7, 25] waves, re-rolled on EVERY biome entry, with a mild
// bias toward the longer end (most rolls > 10). The roll is a HARD CAP: when
// waves-spent-in-biome reaches it the biome ENDS even if the player kept choosing
// "Stay" at the Crossroads. Leaving early via the 5-wave Crossroads still works.
//
// NOTORIETY (#504): the first 10 waves in a biome follow the GLOBAL difficulty
// curve unchanged. PAST 10 in-biome waves the place grows hostile - "overstay" =
// max(0, wavesSinceEnteredBiome - NOTORIETY_FREE_WAVES). Notoriety is a PURE
// function of the current biome's wave position (it reads the per-biome start wave,
// which resets on every biome entry), so it is local + additive and never shifts
// the persistent/global curve. After leaving an over-stayed biome the global curve
// resumes exactly: wave N enemies match a fresh run at wave N.
//
// FINALE SAFETY (critical): variable length AND notoriety are INACTIVE in the late
// game. Past `finalWave - LATE_GAME_MARGIN` everything reverts to the vanilla %10
// cadence, and a biome is only given a rolled length if its WORST-CASE end (range
// max) still lands strictly before that zone. This guarantees the classic wave-200
// END biome enters at 191 and the finale triggers at 200 exactly as vanilla - the
// variable path never reaches the late waves at all.
//
// State is module-level, reset per run (alongside the other ER resets) and folded
// additively into the erMapState save blob so a reload restores the same boundary.
// =============================================================================

import type { BiomeId } from "#enums/biome-id";
import { randSeedIntRange } from "#utils/common";

/** Minimum rolled biome length in waves (#504). */
const BIOME_LENGTH_MIN = 7;
/** Maximum rolled biome length in waves and the hard cap (#504). */
const BIOME_LENGTH_MAX = 25;

// --- Run-scoped state -------------------------------------------------------

/**
 * How many waves before the run finale variable length switches off entirely.
 * Inside this margin the engine reverts to the vanilla %10 cadence so the END
 * biome / finale align exactly. 30 = three vanilla biomes of headroom.
 */
const LATE_GAME_MARGIN = 30;

/** The largest length a biome can roll (used for the worst-case finale clamp). */
const MAX_BAND_LENGTH = BIOME_LENGTH_MAX;

/** First N in-biome waves run the GLOBAL curve untouched; past it = notoriety (#504). */
const NOTORIETY_FREE_WAVES = 10;

/** The rolled length (in waves) of the CURRENT biome instance, or null if vanilla. */
let currentLength: number | null = null;
/** The wave index the current biome was entered on (its first wave). */
let currentStartWave = 1;
/** Set by the Crossroads "Move on" choice: force the next wave to end the biome. */
let leaveBiomeNow = false;
/**
 * The wave the player DELIBERATELY chose to stay past the notoriety-free window in
 * this biome (via the Crossroads "Stay" choice), or null if they never did.
 * Notoriety is anchored here - NOT to raw waves-in-biome - so simply progressing
 * through a long (rolled 7-25) biome never escalates difficulty. Only choosing to
 * linger past the free window does. Resets on every biome entry.
 */
let overstayAnchorWave: number | null = null;

/** Clear all structure state at run start (module state outlives a run). */
export function resetErBiomeStructure(): void {
  currentLength = null;
  currentStartWave = 1;
  leaveBiomeNow = false;
  overstayAnchorWave = null;
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
 * first battle sits on. The length is a single rolled value in [BIOME_LENGTH_MIN,
 * BIOME_LENGTH_MAX] with a mild bias toward the longer end (so most rolls clear 10
 * and start to attract notoriety). The roll is the biome's HARD CAP. If the biome's
 * worst-case end (start + max - 1) would reach the finale-safety zone, we DO NOT
 * assign a rolled length - the biome falls back to the vanilla %10 cadence so it
 * can never straddle into the late game.
 *
 * The `biome` arg is retained for API/signature stability (callers pass it) even
 * though #504 dropped the per-biome bands - lengths are now uniform-ish per entry.
 */
export function erRollBiomeLength(_biome: BiomeId, startWave: number, runSeed?: string): void {
  const plan = planErBiomeStructure(startWave, runSeed);
  restoreErBiomeStructure(plan.length, plan.startWave, null);
}

export interface ErBiomeStructurePlan {
  readonly length: number | null;
  readonly startWave: number;
}

/** Pure, addressable structure plan used by retryable authoritative biome preparation. */
export function planErBiomeStructure(startWave: number, runSeed?: string): ErBiomeStructurePlan {
  // Finale safety: never roll a variable length once we're at/inside the late
  // zone, or if the biome's worst case could spill into it.
  if (startWave >= lateGameThreshold() || startWave + MAX_BAND_LENGTH - 1 >= lateGameThreshold()) {
    return { length: null, startWave };
  }

  // Mild bias toward the longer end: take the higher of two rolls so the median
  // sits above 10 (most biomes will tip into notoriety territory) while short
  // biomes (down to 7) still happen. No snap-to-5 - the cap is exact (#504).
  // Run-seeded callers use a LOCAL, addressable stream so the structural boundary cannot depend on
  // unrelated RNG consumption before newArena (starter ability rolls, rendering, test process history).
  // Legacy/unit callers without a seed preserve the existing shared-RNG behavior.
  const localRng = runSeed
    ? new Phaser.Math.RandomDataGenerator([`${runSeed}:er-biome-length:${startWave}`])
    : null;
  const roll = (): number =>
    localRng?.integerInRange(BIOME_LENGTH_MIN, BIOME_LENGTH_MAX)
    ?? randSeedIntRange(BIOME_LENGTH_MIN, BIOME_LENGTH_MAX);
  const a = roll();
  const b = roll();
  return { length: Math.max(a, b), startWave };
}

/** Restore a biome's rolled length + start wave + overstay anchor from a save. */
export function restoreErBiomeStructure(
  length: number | null | undefined,
  startWave: number | null | undefined,
  overstayAnchor?: number | null | undefined,
): void {
  currentLength = typeof length === "number" && length > 0 ? Math.floor(length) : null;
  currentStartWave = typeof startWave === "number" && startWave > 0 ? Math.floor(startWave) : 1;
  overstayAnchorWave = typeof overstayAnchor === "number" && overstayAnchor > 0 ? Math.floor(overstayAnchor) : null;
  leaveBiomeNow = false;
}

/**
 * Record that the player DELIBERATELY chose to stay (at a Crossroads) at
 * `waveIndex`. Only the FIRST such choice past the notoriety-free window arms the
 * overstay anchor - from then on notoriety ramps with each further wave in the
 * biome. Staying while still inside the free window does nothing (it is free).
 */
export function erMarkBiomeStay(waveIndex: number): void {
  if (overstayAnchorWave !== null) {
    return;
  }
  if (wavesSinceEnteredBiome(waveIndex) >= NOTORIETY_FREE_WAVES) {
    overstayAnchorWave = waveIndex;
  }
}

/** The wave the player armed overstay (chose to linger past the free window), or null. */
export function erBiomeOverstayAnchor(): number | null {
  return overstayAnchorWave;
}

/**
 * Co-op (#837): force the overstay anchor to the host's authoritative value WITHOUT touching the
 * biome length / start wave (unlike {@linkcode restoreErBiomeStructure}, which is the full save/resume
 * path). Used by the gated guest resync heal so a diverged overstay anchor - the ONE biome-structure
 * blind spot the checksum now detects (audit Part 1 #2) - converges through the substrate's own setter,
 * not a hand-rolled write. Additive: an older host omits the field and this is never called.
 */
export function setErBiomeOverstayAnchor(anchor: number | null | undefined): void {
  overstayAnchorWave = typeof anchor === "number" && anchor > 0 ? Math.floor(anchor) : null;
}

/**
 * Co-op (#841): force the biome-structure EXTENT (rolled length + start wave) to the host's authoritative
 * values WITHOUT touching the overstay anchor or the leave-now flag (the complement of {@linkcode
 * setErBiomeOverstayAnchor}, which is length/start-wave-blind). Both extent fields ride the saveDataDigest
 * via erMapState's biome-structure trio, but - unlike the overstay anchor - no per-turn/resync heal carried
 * them, so a divergence loop-DETECTED with no heal path (audit #841 item 5). Used by the gated guest resync
 * heal so the extent converges through the substrate's own setter, not a hand-rolled write. An invalid
 * length -> null (vanilla cadence); an invalid start wave leaves the current one intact. Additive: an older
 * host omits the field and this is never called.
 */
export function setErBiomeStructureExtent(length: number | null | undefined, startWave: number | null | undefined): void {
  currentLength = typeof length === "number" && length > 0 ? Math.floor(length) : null;
  if (typeof startWave === "number" && startWave > 0) {
    currentStartWave = Math.floor(startWave);
  }
}

/** The current biome's rolled length, or null if it is on the vanilla cadence. */
export function getErBiomeLength(): number | null {
  return currentLength;
}

/** The wave the current biome was entered on. */
export function getErBiomeStartWave(): number {
  return currentStartWave;
}

/**
 * True when the biome structure has ALREADY been rolled forward to a new biome
 * that starts on the wave AFTER `waveIndex` - i.e. a {@link SwitchBiomePhase} has
 * run {@link erRollBiomeLength} with `startWave = waveIndex + 1`, so `waveIndex`
 * was the FINAL wave of the biome we just left.
 *
 * `isNewBiome` is consulted twice across the SwitchBiomePhase boundary: VictoryPhase
 * reads it (correctly true) to push the biome change, then doPostBattleCleanup reads
 * it again to pick the next encounter phase - but by then erRollBiomeLength has reset
 * `currentStartWave` to the NEW biome, so a raw `erIsBiomeEnd(waveIndex)` wrongly says
 * "0 waves in, not an end" and `NextEncounterPhase` runs instead of
 * `NewBiomeEncounterPhase`, skipping the new biome's weather/terrain + arena reset
 * (e.g. Beach never set its sun). This post-switch signal restores the correct answer
 * without re-deriving from the rolled-forward length. #486
 */
export function erBiomeJustEnteredAfterWave(waveIndex: number): boolean {
  return currentStartWave === waveIndex + 1;
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
