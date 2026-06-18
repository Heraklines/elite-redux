/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER per-biome ENCOUNTER COMPOSITION (#439 §3 / biome-encounter-item-design §6).
//
// Each biome weights its wave-type mix so the WORLD feels distinct, not just the
// spawn table: how often you hit a mystery event, a trainer, or a wild boss. This
// is the COMPOSITION layer; the in-battle field identity (weather/terrain/ambush/
// double-odds) lives in er-biome-rules.ts, and the on-mon item flavor in
// er-biome-item-flavor.ts. Kept in its own file so it never collides with the
// hand-edited battle-identity table.
//
// All knobs are multipliers/additions on the VANILLA roll (default = no change),
// so biome rules apply on every difficulty and a missing entry is pure vanilla.
//
// COMPOSES WITH NOTORIETY (#504): biome values are the BASE; the overstay
// escalation in er-biome-notoriety.ts adds ON TOP at the same hook sites. And
// with the Mystery Charm relic (which raises the ME run target) for events.
//
// Hook sites (thin reads):
//   - event rate   -> battle-scene.ts isWaveMysteryEncounter (successRate *=)
//   - trainer rate -> game-mode.ts isWaveTrainer (trainerChance / mult)
//   - boss rate    -> battle-scene.ts getEncounterBossSegments (+ bossPct / every-wave)
//
// Shorthand -> number mapping (design §6 legend):
//   Trainer  -- 0.3  - 0.6  · 1  + 1.6  ++ 2.5   (DOJO "force" handled in game-mode)
//   Event    -  0.7  · 1  + 1.6  ++ 2.2
//   Boss     · +0    + +25%   ++ boss-heavy (50%) / every-wave (Wasteland)
// =============================================================================

import { BiomeId } from "#enums/biome-id";

/** One biome's encounter-composition weights. Every field optional; default = vanilla. */
export interface ErBiomeEncounter {
  /** Multiplier on the per-wave mystery-encounter success rate (1 = vanilla). */
  eventMult?: number;
  /** Multiplier on the per-wave trainer odds (1 = vanilla; <1 rarer, >1 denser). */
  trainerMult?: number;
  /** Flat % added to the per-wave WILD-boss roll (0 = vanilla). */
  bossPct?: number;
  /** Wasteland: every non-trainer wave is a boss-bar mon (a short brutal gauntlet). */
  bossEveryWave?: boolean;
  /** With bossEveryWave, force the bar count to a [min, max] toss-up. */
  bossBars?: [number, number];
  /** Desert: % of waves that are EMPTY - auto-advance, no fight ("nothing out here"). */
  skipChance?: number;
  /** When a skip-biome wave is NOT skipped, the weights for what it becomes. */
  skipFallback?: { event: number; boss: number };
}

/**
 * The per-biome composition table. Derived from the design's 34-biome grid (§6).
 * Only biomes that deviate from vanilla appear. DOJO's trainer density is the
 * existing "force every wave" branch in game-mode, so it carries no trainerMult.
 * WASTELAND is the only every-wave boss biome (its defining gauntlet); VOLCANO and
 * ABYSS are "boss-heavy" via a high bossPct rather than literally every wave.
 */
const ER_BIOME_ENCOUNTERS: Partial<Record<BiomeId, ErBiomeEncounter>> = {
  [BiomeId.TOWN]: { trainerMult: 0.6 },
  [BiomeId.PLAINS]: { eventMult: 0.7 },
  [BiomeId.GRASS]: { trainerMult: 0.6 },
  [BiomeId.TALL_GRASS]: { trainerMult: 0.6 },
  [BiomeId.METROPOLIS]: { trainerMult: 1.6, eventMult: 1.6 },
  // FOREST: vanilla composition (its identity is ambush + doubles, in biome-rules).
  [BiomeId.SEA]: { eventMult: 0.7 },
  [BiomeId.SWAMP]: { trainerMult: 0.6 },
  [BiomeId.BEACH]: { trainerMult: 0.6 },
  [BiomeId.LAKE]: { trainerMult: 0.6, eventMult: 0.7 },
  [BiomeId.SEABED]: { trainerMult: 0.6, bossPct: 25 },
  [BiomeId.MOUNTAIN]: { eventMult: 0.7 },
  [BiomeId.BADLANDS]: { eventMult: 0.7, bossPct: 25 },
  [BiomeId.CAVE]: { trainerMult: 0.6, bossPct: 25 },
  // DESERT: a sparse crossing - ~40% of plain waves are EMPTY (the skip), trainers
  // are rare (0.3x), and the waves that DO fire lean hard toward "something notable"
  // - elevated events (2x) and a high wild-boss % - so a desert wave is mostly
  // nothing, then an event or a boss. (skipFallback is the eventual hard ME/boss-
  // only split; for now the elevated event/boss weights approximate it.)
  [BiomeId.DESERT]: { trainerMult: 0.3, eventMult: 2, bossPct: 45, skipChance: 40, skipFallback: { event: 60, boss: 40 } },
  [BiomeId.ICE_CAVE]: { trainerMult: 0.6, bossPct: 25 },
  [BiomeId.MEADOW]: { trainerMult: 0.6 },
  // POWER_PLANT: vanilla composition (identity is Electric terrain).
  [BiomeId.VOLCANO]: { trainerMult: 0.6, bossPct: 50 }, // boss-heavy, a notch under Wasteland
  [BiomeId.GRAVEYARD]: { trainerMult: 0.6, eventMult: 2.2, bossPct: 25 }, // haunted: event-heavy
  [BiomeId.DOJO]: { eventMult: 0.7, bossPct: 25 }, // trainer density = the force branch in game-mode
  [BiomeId.FACTORY]: { eventMult: 0.7, bossPct: 25 },
  [BiomeId.RUINS]: { trainerMult: 0.6, eventMult: 2.2, bossPct: 25 }, // ancient: event-heavy
  [BiomeId.WASTELAND]: { trainerMult: 0.3, eventMult: 0.7, bossEveryWave: true, bossBars: [2, 3] },
  [BiomeId.ABYSS]: { trainerMult: 0.3, eventMult: 1.6, bossPct: 50 },
  [BiomeId.SPACE]: { trainerMult: 0.3, bossPct: 25 },
  // CONSTRUCTION: vanilla composition (identity is debris hazards).
  [BiomeId.JUNGLE]: { trainerMult: 0.6, bossPct: 25 },
  [BiomeId.FAIRY_CAVE]: { trainerMult: 0.6 },
  [BiomeId.TEMPLE]: { trainerMult: 0.6, bossPct: 25 },
  [BiomeId.SLUM]: { eventMult: 1.6 }, // dirty-fighting style is wired separately
  [BiomeId.SNOWY_FOREST]: { trainerMult: 0.6 },
  [BiomeId.ISLAND]: { trainerMult: 0.6, bossPct: 25 },
  [BiomeId.LABORATORY]: { trainerMult: 0.6 },
};

/** The composition config for a biome, or undefined (pure vanilla). */
export function getErBiomeEncounter(biomeId: BiomeId): ErBiomeEncounter | undefined {
  return ER_BIOME_ENCOUNTERS[biomeId];
}

/** Multiplier on the per-wave mystery-encounter success rate (1 = vanilla). */
export function erBiomeEventRateMult(biomeId: BiomeId): number {
  const m = ER_BIOME_ENCOUNTERS[biomeId]?.eventMult;
  return typeof m === "number" && m > 0 ? m : 1;
}

/** Multiplier on the per-wave trainer odds (1 = vanilla; higher = more trainers). */
export function erBiomeTrainerRateMult(biomeId: BiomeId): number {
  const m = ER_BIOME_ENCOUNTERS[biomeId]?.trainerMult;
  return typeof m === "number" && m > 0 ? m : 1;
}

/** Flat % added to the per-wave wild-boss roll (0 = vanilla). */
export function erBiomeBossChancePct(biomeId: BiomeId): number {
  const p = ER_BIOME_ENCOUNTERS[biomeId]?.bossPct;
  return typeof p === "number" && p > 0 ? p : 0;
}

/** Whether every (wild) wave in this biome is a boss-bar mon (Wasteland). */
export function erBiomeBossEveryWave(biomeId: BiomeId): boolean {
  return ER_BIOME_ENCOUNTERS[biomeId]?.bossEveryWave === true;
}

/** The forced [min, max] boss-bar toss-up for an every-wave boss biome, or undefined. */
export function erBiomeForcedBossBars(biomeId: BiomeId): [number, number] | undefined {
  return ER_BIOME_ENCOUNTERS[biomeId]?.bossBars;
}

/** Desert-style: % of waves that are empty/auto-skipped (0 = none). */
export function erBiomeWaveSkipChance(biomeId: BiomeId): number {
  const c = ER_BIOME_ENCOUNTERS[biomeId]?.skipChance;
  return typeof c === "number" && c > 0 ? c : 0;
}

/** Desert-style: the weights for what a NON-skipped wave becomes, or undefined. */
export function erBiomeSkipFallback(biomeId: BiomeId): { event: number; boss: number } | undefined {
  return ER_BIOME_ENCOUNTERS[biomeId]?.skipFallback;
}
