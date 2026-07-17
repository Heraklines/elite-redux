/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// MYSTERY GAUNTLET (#814) - the TESTING difficulty under Hell. Every wave is a
// scripted test target so a co-op (or solo) session exercises the whole ME
// surface fast, in a fixed cycle of 8:
//   waves 2-6: five mystery encounters, NON-REPEATING until the pool exhausts
//   wave 7:    a ghost trainer battle
//   wave 8:    a boss encounter (multi-bar wild boss)
//   wave 9:    Giratina's Bargain
//   ...then the cycle repeats with five MEs not yet encountered, and so on.
// Wave 1 stays a normal wild battle so the run (and the co-op launch snapshot
// machinery) boots exactly like any other run. Dev-gated in the difficulty
// picker (staging/dev only); the schedule itself is pure and deterministic, so
// in co-op the HOST rolls it and the guest adopts it like any other wave.
// =============================================================================

import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";

export type ErGauntletWaveKind = "wild" | "me" | "ghost" | "boss" | "bargain";

/** Whether the Mystery Gauntlet testing difficulty is active for this run. */
export function erGauntletActive(): boolean {
  return getErDifficulty() === "mystery";
}

/** The scripted kind for `waveIndex` (pure; cycle of 8 starting at wave 2). */
export function erGauntletWaveKind(waveIndex: number): ErGauntletWaveKind {
  if (waveIndex <= 1) {
    return "wild";
  }
  const pos = (waveIndex - 2) % 8; // 0..7
  if (pos <= 4) {
    return "me";
  }
  if (pos === 5) {
    return "ghost";
  }
  if (pos === 6) {
    return "boss";
  }
  return "bargain";
}

/** Synthetic/phase-driven types that cannot be force-spawned as a plain option ME. */
const GAUNTLET_EXCLUDED = new Set<MysteryEncounterType>([
  MysteryEncounterType.LLM_DIRECTED,
  MysteryEncounterType.ER_THE_BARGAIN,
]);

/**
 * Pick the ME type for a gauntlet "me"/"bargain" wave. Bargain waves always run
 * Giratina's deal; ME waves walk the FULL registry in enum order, skipping types
 * already encountered this run (non-repeating), wrapping when the pool exhausts.
 * `encountered` is the run's encounteredEvents type list (the save-tracked one).
 */
export function erGauntletPickMeType(
  waveIndex: number,
  encountered: readonly MysteryEncounterType[],
  runSeed = "",
  isEligible: (type: MysteryEncounterType) => boolean = () => true,
): MysteryEncounterType {
  if (erGauntletWaveKind(waveIndex) === "bargain") {
    return MysteryEncounterType.ER_THE_BARGAIN;
  }
  const all = Object.values(MysteryEncounterType).filter(
    (v): v is MysteryEncounterType => typeof v === "number" && !GAUNTLET_EXCLUDED.has(v),
  );
  let seedHash = 0;
  for (let i = 0; i < runSeed.length; i++) {
    seedHash = (seedHash * 31 + runSeed.charCodeAt(i)) >>> 0;
  }
  // #825: this picker is authority/solo-only. The authority uses its persisted encountered list;
  // a fresh test jump with no history reconstructs earlier picks from the run seed. Renderers never
  // call this function: they adopt the retained exact type, so account-local history cannot desync it.
  const seen = new Set<MysteryEncounterType>(encountered.filter(type => !GAUNTLET_EXCLUDED.has(type)));
  const eligibility = new Map<MysteryEncounterType, boolean>();
  const eligible = (type: MysteryEncounterType): boolean => {
    const cached = eligibility.get(type);
    if (cached != null) {
      return cached;
    }
    const verdict = isEligible(type);
    eligibility.set(type, verdict);
    return verdict;
  };
  const pickAt = (wave: number): MysteryEncounterType => {
    const eligiblePool = all.filter(eligible);
    const fresh = eligiblePool.filter(t => !seen.has(t));
    const pool = fresh.length > 0 ? fresh : eligiblePool; // pool exhausted -> start repeating
    if (pool.length === 0) {
      throw new Error(`Mystery Gauntlet wave ${wave} has no eligible registered encounter`);
    }
    return pool[(wave + seedHash) % pool.length];
  };
  if (seen.size === 0) {
    for (let w = 2; w < waveIndex; w++) {
      if (erGauntletWaveKind(w) === "me") {
        // Reconstruct a deterministic baseline for a fresh dev jump that omitted encounter history.
        seen.add(pickAt(w));
      }
    }
  }
  return pickAt(waveIndex);
}
