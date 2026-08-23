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
import { isErSprintRun } from "#data/elite-redux/er-run-pacing";
import { erTunedTrainerCadence } from "#data/elite-redux/er-trainer-tuning";
import { ClassicFixedBossWaves } from "#enums/fixed-boss-waves";
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
  },
};

const ER_SPRINT_EXTRA_RIVAL_WAVES: Readonly<Record<string, Readonly<Record<number, TrainerType>>>> = {
  elite: {
    22: TrainerType.RIVAL_2,
    62: TrainerType.RIVAL_4,
  },
  hell: {
    8: TrainerType.RIVAL,
    22: TrainerType.RIVAL_2,
    38: TrainerType.RIVAL_3,
    62: TrainerType.RIVAL_4,
  },
};

const ER_SPRINT_CANONICAL_RIVAL_WAVES: ReadonlyArray<readonly [number, TrainerType]> = [
  [4, TrainerType.RIVAL],
  [13, TrainerType.RIVAL_2],
  [28, TrainerType.RIVAL_3],
  [48, TrainerType.RIVAL_4],
  [73, TrainerType.RIVAL_5],
  [98, TrainerType.RIVAL_6],
];

const ER_CANONICAL_RIVAL_WAVES: ReadonlyArray<readonly [number, TrainerType]> = [
  [ClassicFixedBossWaves.RIVAL_1, TrainerType.RIVAL],
  [ClassicFixedBossWaves.RIVAL_2, TrainerType.RIVAL_2],
  [ClassicFixedBossWaves.RIVAL_3, TrainerType.RIVAL_3],
  [ClassicFixedBossWaves.RIVAL_4, TrainerType.RIVAL_4],
  [ClassicFixedBossWaves.RIVAL_5, TrainerType.RIVAL_5],
  [ClassicFixedBossWaves.RIVAL_6, TrainerType.RIVAL_6],
];

/** Extra-trainer cadence per difficulty: force a trainer when `wave % N === 0`. */
// ER (#346): Elite eased from every-3rd to every-4th eligible wave — testers
// found the trainer density slightly too high. Hell stays a near-continuous
// gauntlet. Exported as the DEFAULT the editor tooling shows next to any
// er-trainer-tuning.json override.
export const ER_TRAINER_CADENCE: Readonly<Record<string, number>> = {
  elite: 4,
  hell: 2,
};

/** Resolve the generic trainer slots still needed after authored trainer-class
 * encounters have consumed a Sprint chapter's quota. */
export function erSprintForcedTrainerSlots(scheduledSlots: readonly number[]): readonly number[] {
  const difficulty = getErDifficulty();
  const scheduled = new Set(scheduledSlots.filter(slot => slot >= 1 && slot <= 4));
  if (difficulty === "elite") {
    return scheduled.size > 0 ? [] : [3];
  }
  if (difficulty === "hell") {
    const required = Math.max(0, 3 - scheduled.size);
    return [2, 3, 4].filter(slot => !scheduled.has(slot)).slice(0, required);
  }
  return [];
}

/**
 * For an Elite/Hell run, the extra-rival {@linkcode TrainerType} to spawn on this
 * wave, or `null` if this wave is not a designated extra-rival wave. On Ace this
 * is always `null` (vanilla behaviour).
 */
export function erExtraRivalTypeForWave(waveIndex: number): TrainerType | null {
  const table = (isErSprintRun() ? ER_SPRINT_EXTRA_RIVAL_WAVES : ER_EXTRA_RIVAL_WAVES)[getErDifficulty()];
  if (table === undefined) {
    return null;
  }
  return table[waveIndex] ?? null;
}

export function erRivalWaveSequence(): ReadonlyArray<readonly [number, TrainerType]> {
  const extra = (isErSprintRun() ? ER_SPRINT_EXTRA_RIVAL_WAVES : ER_EXTRA_RIVAL_WAVES)[getErDifficulty()];
  const canonical = isErSprintRun() ? ER_SPRINT_CANONICAL_RIVAL_WAVES : ER_CANONICAL_RIVAL_WAVES;
  const waves =
    extra === undefined
      ? canonical
      : [
          ...canonical,
          ...Object.entries(extra).map(([wave, trainerType]) => [Number(wave), trainerType] as const),
        ];
  return [...waves].sort(([a], [b]) => a - b);
}

export function erRivalWaveOrdinal(waveIndex: number, trainerType: TrainerType): number | null {
  const ordinal = erRivalWaveSequence().findIndex(([wave, type]) => wave === waveIndex && type === trainerType);
  if (ordinal >= 0) {
    return ordinal;
  }
  const fallback = (isErSprintRun() ? ER_SPRINT_CANONICAL_RIVAL_WAVES : ER_CANONICAL_RIVAL_WAVES)
    .findIndex(([, type]) => type === trainerType);
  return fallback >= 0 ? fallback : null;
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
  if (isErSprintRun()) {
    const slot = ((waveIndex - 1) % 5) + 1;
    return erExtraRivalTypeForWave(waveIndex) === null
      && ((difficulty === "elite" && slot === 3) || (difficulty === "hell" && slot >= 2 && slot <= 4));
  }
  // Editor-managed override first (er-trainer-tuning.json), then the default.
  const cadence = erTunedTrainerCadence(difficulty) ?? ER_TRAINER_CADENCE[difficulty];
  if (cadence === undefined) {
    return false;
  }
  if (erExtraRivalTypeForWave(waveIndex) !== null) {
    return false;
  }
  return waveIndex % cadence === 0;
}
