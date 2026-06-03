/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — denser trainer + rival cadence for Elite / Hell difficulty.
//
// Ace difficulty is left exactly as vanilla PokeRogue. On Elite/Hell we:
//   1. Force a regular trainer battle on a fixed cadence of otherwise-wild waves
//      (Elite ≈ every 3rd eligible wave, Hell ≈ every 2nd), so the run plays out
//      as a near-continuous gauntlet like ER's trainer-dense routes.
//   2. Inject EXTRA rival (May/Brendan) encounters between PokeRogue's canonical
//      rival waves, reusing the existing RIVAL_n trainer types so the ER rival
//      override (er-trainer-runtime-hook) maps each onto the right Hoenn stage.
//
// Both hooks deliberately avoid boss / x1 / fixed-battle-adjacent waves so they
// never collide with the scripted progression. See:
//   - GameMode.isWaveTrainer  (trainer cadence)
//   - BattleScene.handleNonFixedBattle  (rival injection)
// =============================================================================

import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { TrainerType } from "#enums/trainer-type";

/**
 * Extra rival encounters per difficulty, keyed by wave index → which RIVAL_n
 * trainer type to spawn. The RIVAL_n choice feeds the ER rival stage mapping
 * (RIVAL=Route 103 … RIVAL_6=Lilycove), so these are ordered to climb the Hoenn
 * rival progression alongside the canonical rival waves (8/25/55/95/145/195).
 *
 * Chosen to dodge boss waves (`% 10 === 0`), x1 waves (`% 10 === 1`), gym waves
 * (`% 30 === 20`), the wave-200 finale, and a ±2 buffer around every scripted
 * fixed battle so the injected rival never lands next to another forced fight.
 */
const ER_EXTRA_RIVAL_WAVES: Readonly<Record<string, Readonly<Record<number, TrainerType>>>> = {
  // Elite: a couple of mid-run rematches.
  elite: {
    42: TrainerType.RIVAL_2,
    122: TrainerType.RIVAL_4,
  },
  // Hell: a near-complete second rival ladder.
  hell: {
    16: TrainerType.RIVAL,
    42: TrainerType.RIVAL_2,
    76: TrainerType.RIVAL_3,
    122: TrainerType.RIVAL_4,
    158: TrainerType.RIVAL_5,
  },
};

/** Extra-trainer cadence per difficulty: force a trainer when `wave % N === 0`. */
const ER_TRAINER_CADENCE: Readonly<Record<string, number>> = {
  elite: 3,
  hell: 2,
};

/**
 * For an Elite/Hell run, the extra-rival {@linkcode TrainerType} to spawn on this
 * wave, or `null` if this wave is not a designated extra-rival wave. On Ace this
 * is always `null` (vanilla behaviour).
 */
export function erExtraRivalTypeForWave(waveIndex: number): TrainerType | null {
  const table = ER_EXTRA_RIVAL_WAVES[getErDifficulty()];
  if (table === undefined) {
    return null;
  }
  return table[waveIndex] ?? null;
}

/**
 * Whether an Elite/Hell run should FORCE a (regular) trainer battle on this wave,
 * over-and-above PokeRogue's biome trainer roll. The caller is responsible for the
 * fixed-battle-proximity / boss-wave guards (this only adds the difficulty cadence
 * on top of an already-eligible wave). Returns `false` on Ace.
 *
 * Extra-rival waves are excluded here — the rival injection handles those, and we
 * don't want the regular cadence to also flag them.
 */
export function erForcesTrainerWave(waveIndex: number): boolean {
  const difficulty = getErDifficulty();
  const cadence = ER_TRAINER_CADENCE[difficulty];
  if (cadence === undefined) {
    return false;
  }
  if (erExtraRivalTypeForWave(waveIndex) !== null) {
    return false;
  }
  return waveIndex % cadence === 0;
}
