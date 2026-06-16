/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Quiz/Minigame engine (#439 biome overhaul) - DATA layer.
//
// One reusable question bank powers a whole family of knowledge events (the Town
// Guessing Booth, the Professor's Scrambled Pokedex, the Snowy Forest footprint
// hunt, etc.). Question kinds:
//   - "silhouette": render a Pokemon sprite as a black silhouette (the UI does
//                   the tint); the player names it from the choices.
//   - "dex":        show the Pokedex flavor text (from er-dex-flavor.json, with
//                   the species' own name already redacted at bake time); the
//                   player names it from the choices.
//   - "footprint":  show the species' FOOTPRINT sprite (er-assets, per slug); the
//                   player names whose tracks they are. Falls back to a silhouette
//                   in the UI when a species ships no footprint art.
//
// Candidate pool = the species that ship with dex flavor text (national dex
// 1..898, clean vanilla names + loadable sprites). Questions are generated with
// the run RNG so they're deterministic within a seed.
// =============================================================================

import { ER_SPRITE_MANIFEST } from "#data/elite-redux/er-sprite-manifest";
import { randSeedInt, randSeedShuffle } from "#utils/common";
import { getCachedUrl } from "#utils/fetch-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import erDexFlavorRaw from "./er-dex-flavor.json";

const ER_DEX_FLAVOR = erDexFlavorRaw as Record<string, string>;

export type ErQuizKind = "silhouette" | "dex" | "footprint";

export interface ErQuizQuestion {
  kind: ErQuizKind;
  /** National-dex id of the correct answer. */
  answerId: number;
  /** The answer + distractors species ids, already shuffled (3 or 4 entries). */
  options: number[];
  /** Dex flavor text for "dex" questions; empty for the sprite-based kinds. */
  prompt: string;
}

/** A loaded-asset descriptor for a species' footprint sprite. */
export interface ErFootprintAsset {
  /** Phaser texture key the phase/UI use for this footprint image. */
  key: string;
  /** Cache-busted runtime URL of the footprint PNG. */
  url: string;
}

/**
 * speciesId -> footprint runtime URL, built from the sprite manifest. The
 * manifest stores build-time paths (`assets/images/...`); the served path drops
 * the leading `assets/` (matching how ER pokemon atlases load from
 * `images/pokemon/elite-redux/<slug>/`). Memoized.
 */
let cachedFootprintUrls: Map<number, string> | null = null;
function footprintUrls(): Map<number, string> {
  if (cachedFootprintUrls === null) {
    cachedFootprintUrls = new Map();
    for (const entry of ER_SPRITE_MANIFEST) {
      if (entry.paths.footprint) {
        cachedFootprintUrls.set(entry.speciesId, entry.paths.footprint.replace(/^assets\//, ""));
      }
    }
  }
  return cachedFootprintUrls;
}

/**
 * The footprint texture key + cache-busted URL for a species, or undefined if
 * the manifest lists no footprint path for it. (The file may still 404 at load
 * time for a species with no shipped footprint art - callers fall back to a
 * silhouette in that case.)
 */
export function getErFootprintAsset(speciesId: number): ErFootprintAsset | undefined {
  const rel = footprintUrls().get(speciesId);
  if (!rel) {
    return undefined;
  }
  return { key: `er_footprint__${speciesId}`, url: getCachedUrl(rel) };
}

/**
 * The species the quiz can ask about: those with shipped dex flavor text,
 * filtered to ids that resolve to a real species. Computed LAZILY and memoized -
 * this module is imported during early init (encounters/scenarios) BEFORE the
 * species data is registered, so building the pool at module-load time would
 * filter everything out (getPokemonSpecies not ready) and yield an empty quiz.
 */
let cachedQuizSpeciesIds: number[] | null = null;
function quizSpeciesIds(): number[] {
  if (cachedQuizSpeciesIds === null) {
    cachedQuizSpeciesIds = Object.keys(ER_DEX_FLAVOR)
      .map(Number)
      .filter(id => {
        try {
          return !!getPokemonSpecies(id);
        } catch {
          return false;
        }
      });
  }
  return cachedQuizSpeciesIds;
}

/**
 * The species a FOOTPRINT question can ask about: those that ship a footprint
 * path in the sprite manifest AND resolve to a real, vanilla-named species
 * (national dex 1..1025, so option labels stay clean). Memoized for the same
 * early-init reason as {@linkcode quizSpeciesIds}.
 */
let cachedFootprintSpeciesIds: number[] | null = null;
function footprintSpeciesIds(): number[] {
  if (cachedFootprintSpeciesIds === null) {
    cachedFootprintSpeciesIds = [...footprintUrls().keys()].filter(id => {
      if (id > 1025) {
        return false;
      }
      try {
        return !!getPokemonSpecies(id);
      } catch {
        return false;
      }
    });
  }
  return cachedFootprintSpeciesIds;
}

/** The candidate species pool for a question kind. */
function quizPool(kind: ErQuizKind): number[] {
  return kind === "footprint" ? footprintSpeciesIds() : quizSpeciesIds();
}

/** Dex flavor text for a species, or undefined if none shipped. */
export function getErDexFlavor(speciesId: number): string | undefined {
  return ER_DEX_FLAVOR[String(speciesId)];
}

/**
 * Build one quiz question of the given kind, run-seeded. `optionCount` is the
 * total number of choices (the answer + N-1 distractors); defaults to 4, clamped
 * to 2..4 (the footprint hunt uses 3).
 */
export function buildErQuizQuestion(kind: ErQuizKind, optionCount = 4): ErQuizQuestion {
  const pool = quizPool(kind);
  const answerId = pool[randSeedInt(pool.length)];

  const distractorTarget = Math.max(1, Math.min(3, optionCount - 1));
  const distractors = new Set<number>();
  // Guard the loop in case the pool is unexpectedly tiny.
  let guard = 0;
  while (distractors.size < distractorTarget && guard++ < 100) {
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
 * somehow exhausted. `optionCount` is forwarded to each question.
 */
export function buildErQuizRound(kind: ErQuizKind, count: number, optionCount = 4): ErQuizQuestion[] {
  const out: ErQuizQuestion[] = [];
  const usedAnswers = new Set<number>();
  let guard = 0;
  while (out.length < count && guard++ < count * 50) {
    const q = buildErQuizQuestion(kind, optionCount);
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
