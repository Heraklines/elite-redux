/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — editor-managed trainer tuning (battle frequency + factory sets).
//
// The DATA lives in `er-trainer-tuning.json` so the team balancing editor can
// read/write it without touching TypeScript:
//
//   {
//     "frequency": {
//       "elite": { "trainerCadence": 4, "factoryTeamPct": 15 },
//       "hell":  { "trainerCadence": 2, "factoryTeamPct": 25 }
//     },
//     "sets": { "factoryExcludeSpecies": ["SPECIES_SLAKING"] }
//   }
//
// Overrides are ADDITIVE: an absent difficulty / absent field keeps the
// hardcoded default. Consumers read these getters at call time:
//   - `trainerCadence`   — force a regular trainer battle every Nth eligible
//                          wave (er-battle-frequency.ts).
//   - `factoryTeamPct`   — % of eligible Elite/Hell trainer waves that field a
//                          Battle-Factory team (er-trainer-runtime-hook.ts).
//   - `factoryExcludeSpecies` — speciesConsts whose factory sets are removed
//                          from the pool (set membership, mapped BY KEY through
//                          the ER draft ids the sets are stored under).
// =============================================================================

import { ER_SPECIES } from "#data/elite-redux/er-species";
import trainerTuningJson from "./er-trainer-tuning.json";

export interface ErTrainerFrequencyTuning {
  /** Force a regular trainer battle when `wave % N === 0`. */
  trainerCadence?: number;
  /** % of eligible trainer waves that field a Battle-Factory team. */
  factoryTeamPct?: number;
}

export interface ErTrainerTuning {
  frequency?: Record<string, ErTrainerFrequencyTuning>;
  sets?: {
    factoryExcludeSpecies?: readonly string[];
  };
}

let activeTuning: ErTrainerTuning = trainerTuningJson as ErTrainerTuning;
let excludedDraftIdsCache: ReadonlySet<number> | null = null;

/** Test hook: replace (or with `undefined` restore) the active tuning table. */
export function setErTrainerTuningForTesting(tuning?: ErTrainerTuning): void {
  activeTuning = tuning ?? (trainerTuningJson as ErTrainerTuning);
  excludedDraftIdsCache = null;
}

/** Editor-tuned trainer cadence for a difficulty, or `undefined` (use default). */
export function erTunedTrainerCadence(difficulty: string): number | undefined {
  const cadence = activeTuning.frequency?.[difficulty]?.trainerCadence;
  return typeof cadence === "number" && cadence >= 1 ? Math.floor(cadence) : undefined;
}

/** Editor-tuned factory-team chance (%) for a difficulty, or `undefined` (use default). */
export function erTunedFactoryTeamPct(difficulty: string): number | undefined {
  const pct = activeTuning.frequency?.[difficulty]?.factoryTeamPct;
  return typeof pct === "number" && pct >= 0 && pct <= 100 ? pct : undefined;
}

/**
 * ER draft ids whose Battle-Factory sets are excluded from the pool. Factory
 * sets are stored under ER draft species ids, so the speciesConsts from the
 * JSON are mapped through `ER_SPECIES` (unknown consts are ignored).
 */
export function erFactoryExcludedDraftIds(): ReadonlySet<number> {
  if (excludedDraftIdsCache !== null) {
    return excludedDraftIdsCache;
  }
  const excluded = new Set<number>();
  const consts = activeTuning.sets?.factoryExcludeSpecies ?? [];
  if (consts.length > 0) {
    const draftIdByConst = new Map<string, number>();
    for (const draft of ER_SPECIES) {
      draftIdByConst.set(draft.speciesConst, draft.id);
    }
    for (const speciesConst of consts) {
      const draftId = draftIdByConst.get(speciesConst);
      if (draftId !== undefined) {
        excluded.add(draftId);
      }
    }
  }
  excludedDraftIdsCache = excluded;
  return excluded;
}
