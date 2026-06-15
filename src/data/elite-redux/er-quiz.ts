/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Quiz/Minigame engine (#439 biome overhaul) - DATA layer.
//
// One reusable question bank powers a whole family of knowledge events (the Town
// Guessing Booth, the Professor's Scrambled Pokedex, etc.). Two question kinds
// to start:
//   - "silhouette": render a Pokemon sprite as a black silhouette (the UI does
//                   the tint); the player names it from 4 choices.
//   - "dex":        show the Pokedex flavor text (from er-dex-flavor.json, with
//                   the species' own name already redacted at bake time); the
//                   player names it from 4 choices.
//
// Candidate pool = the species that ship with dex flavor text (national dex
// 1..898, clean vanilla names + loadable sprites). Questions are generated with
// the run RNG so they're deterministic within a seed.
// =============================================================================

import { getPokemonSpecies } from "#utils/pokemon-utils";
import { randSeedInt, randSeedShuffle } from "#utils/common";
import erDexFlavorRaw from "./er-dex-flavor.json";

const ER_DEX_FLAVOR = erDexFlavorRaw as Record<string, string>;

export type ErQuizKind = "silhouette" | "dex";

export interface ErQuizQuestion {
  kind: ErQuizKind;
  /** National-dex id of the correct answer. */
  answerId: number;
  /** Four species ids (the answer + 3 distractors), already shuffled. */
  options: number[];
  /** Dex flavor text for "dex" questions; empty for "silhouette". */
  prompt: string;
}

/**
 * The species the quiz can ask about: those with shipped dex flavor text. Built
 * once. Filtered to ids that resolve to a real species (defensive).
 */
const QUIZ_SPECIES_IDS: readonly number[] = Object.keys(ER_DEX_FLAVOR)
  .map(Number)
  .filter(id => {
    try {
      return !!getPokemonSpecies(id);
    } catch {
      return false;
    }
  });

/** Dex flavor text for a species, or undefined if none shipped. */
export function getErDexFlavor(speciesId: number): string | undefined {
  return ER_DEX_FLAVOR[String(speciesId)];
}

/** Build one quiz question of the given kind (4 options, run-seeded). */
export function buildErQuizQuestion(kind: ErQuizKind): ErQuizQuestion {
  const pool = QUIZ_SPECIES_IDS;
  const answerId = pool[randSeedInt(pool.length)];

  const distractors = new Set<number>();
  // Guard the loop in case the pool is unexpectedly tiny.
  let guard = 0;
  while (distractors.size < 3 && guard++ < 100) {
    const d = pool[randSeedInt(pool.length)];
    if (d !== answerId) {
      distractors.add(d);
    }
  }

  const options = randSeedShuffle([answerId, ...distractors]);
  const prompt = kind === "dex" ? (getErDexFlavor(answerId) ?? "") : "";
  return { kind, answerId, options, prompt };
}

/**
 * Build a sequence of `count` distinct-answer questions (no repeated answer
 * species within the round). Falls back to allowing repeats only if the pool is
 * somehow exhausted.
 */
export function buildErQuizRound(kind: ErQuizKind, count: number): ErQuizQuestion[] {
  const out: ErQuizQuestion[] = [];
  const usedAnswers = new Set<number>();
  let guard = 0;
  while (out.length < count && guard++ < count * 50) {
    const q = buildErQuizQuestion(kind);
    if (usedAnswers.has(q.answerId)) {
      continue;
    }
    usedAnswers.add(q.answerId);
    out.push(q);
  }
  return out;
}

/** The display name for a quiz option (species id -> localized name). */
export function erQuizOptionName(speciesId: number): string {
  try {
    return getPokemonSpecies(speciesId).getName();
  } catch {
    return "???";
  }
}
