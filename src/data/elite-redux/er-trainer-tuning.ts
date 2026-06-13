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
//     "sets": {
//       "factoryExcludeSpecies": ["SPECIES_SLAKING"],
//       "factorySetOverrides": {
//         "SPECIES_GARCHOMP": [
//           { "moves": ["EARTHQUAKE", "DRAGON_CLAW", "SWORDS_DANCE", "FIRE_FANG"], "abilitySlot": 1 }
//         ]
//       }
//     }
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
//   - `factorySetOverrides`  — a species key present here REPLACES that
//                          species' shipped Battle-Factory sets wholesale with
//                          the listed sets (move NAMES resolve over the same
//                          vanilla + ER pool as egg moves; an empty list means
//                          "no sets"). Absent species keep their shipped sets.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import trainerTuningJson from "./er-trainer-tuning.json";

export interface ErFactorySetOverride {
  /** Move enum NAMES (vanilla MoveId keys or ER-custom enum-keyed names). */
  moves: readonly string[];
  abilitySlot: 0 | 1 | 2;
}

/** A factory-set override resolved to live pokerogue ids. */
export interface ErFactorySetOverrideResolved {
  speciesConst: string;
  /** Live pokerogue species id (undefined when the const doesn't resolve). */
  speciesId: number | undefined;
  moves: readonly number[];
  abilitySlot: 0 | 1 | 2;
}

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
    factorySetOverrides?: Record<string, readonly ErFactorySetOverride[]>;
  };
}

let activeTuning: ErTrainerTuning = trainerTuningJson as ErTrainerTuning;
let excludedDraftIdsCache: ReadonlySet<number> | null = null;
let setOverridesCache: readonly ErFactorySetOverrideResolved[] | null = null;
let overriddenDraftIdsCache: ReadonlySet<number> | null = null;

/** Test hook: replace (or with `undefined` restore) the active tuning table. */
export function setErTrainerTuningForTesting(tuning?: ErTrainerTuning): void {
  activeTuning = tuning ?? (trainerTuningJson as ErTrainerTuning);
  excludedDraftIdsCache = null;
  setOverridesCache = null;
  overriddenDraftIdsCache = null;
}

/** Move enum NAME → pokerogue MoveId, vanilla + ER customs (mirror of er-egg-moves.ts). */
let moveByNameCache: Map<string, number> | null = null;
function moveByName(): Map<string, number> {
  if (moveByNameCache !== null) {
    return moveByNameCache;
  }
  const map = new Map<string, number>();
  for (const [key, value] of Object.entries(MoveId)) {
    if (typeof value === "number") {
      map.set(key, value);
    }
  }
  for (const draft of ER_MOVES) {
    const pkrgId = ER_ID_MAP.moves[draft.id];
    if (pkrgId === undefined) {
      continue;
    }
    const key = draft.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!map.has(key)) {
      map.set(key, pkrgId);
    }
  }
  moveByNameCache = map;
  return map;
}

function draftIdByConst(): Map<string, number> {
  const map = new Map<string, number>();
  for (const draft of ER_SPECIES) {
    map.set(draft.speciesConst, draft.id);
  }
  return map;
}

/**
 * The editor-managed factory-set replacements, resolved to live pokerogue ids
 * (unresolvable move names are dropped; a species const that resolves to no
 * live species gets `speciesId: undefined` and is skipped by the consumer).
 */
export function erFactorySetOverrideEntries(): readonly ErFactorySetOverrideResolved[] {
  if (setOverridesCache !== null) {
    return setOverridesCache;
  }
  const out: ErFactorySetOverrideResolved[] = [];
  const overrides = activeTuning.sets?.factorySetOverrides ?? {};
  if (Object.keys(overrides).length > 0) {
    const drafts = draftIdByConst();
    const moves = moveByName();
    const speciesIdByName = SpeciesId as unknown as Record<string, number | undefined>;
    for (const [speciesConst, sets] of Object.entries(overrides)) {
      const draftId = drafts.get(speciesConst);
      const speciesId =
        draftId === undefined ? speciesIdByName[speciesConst.replace(/^SPECIES_/, "")] : ER_ID_MAP.species[draftId];
      for (const set of sets ?? []) {
        out.push({
          speciesConst,
          speciesId: typeof speciesId === "number" ? speciesId : undefined,
          moves: (set.moves ?? []).map(name => moves.get(name)).filter((id): id is number => id !== undefined),
          abilitySlot: set.abilitySlot === 1 || set.abilitySlot === 2 ? set.abilitySlot : 0,
        });
      }
    }
  }
  setOverridesCache = out;
  return out;
}

/** ER draft ids whose shipped factory sets are REPLACED by an override entry. */
export function erFactoryOverriddenDraftIds(): ReadonlySet<number> {
  if (overriddenDraftIdsCache !== null) {
    return overriddenDraftIdsCache;
  }
  const set = new Set<number>();
  const overrides = activeTuning.sets?.factorySetOverrides ?? {};
  if (Object.keys(overrides).length > 0) {
    const drafts = draftIdByConst();
    for (const speciesConst of Object.keys(overrides)) {
      const draftId = drafts.get(speciesConst);
      if (draftId !== undefined) {
        set.add(draftId);
      }
    }
  }
  overriddenDraftIdsCache = set;
  return set;
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
