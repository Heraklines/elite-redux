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

import { randSeedInt, randSeedShuffle } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import erDexFlavorRaw from "./er-dex-flavor.json";
import erFootprintIdsRaw from "./er-footprint-species.json";

const ER_DEX_FLAVOR = erDexFlavorRaw as Record<string, string>;

/**
 * National-dex ids that ship a bundled footprint sprite (public/footprints/<id>.png,
 * extracted from the decomp by scripts/elite-redux/copy-footprints.mjs). Footprint
 * art only exists for the Gen 1-5-era roster, so this list IS the footprint-quiz
 * candidate pool - a species without one can never be asked or offered.
 */
const ER_FOOTPRINT_IDS = new Set<number>(erFootprintIdsRaw as number[]);

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
 * The footprint texture key + runtime URL for a species, or undefined if no
 * footprint sprite is bundled for it. The URL is `images/footprints/<id>.png`,
 * which the deploy redirects to the er-assets CDN (jsDelivr) like every other
 * sprite - so footprints are served off-Cloudflare (no bandwidth-quota cost),
 * NOT bundled into the app. (Requires the er-assets pin to include them.)
 */
export function getErFootprintAsset(speciesId: number): ErFootprintAsset | undefined {
  if (!ER_FOOTPRINT_IDS.has(speciesId)) {
    return undefined;
  }
  return { key: `er_footprint__${speciesId}`, url: `images/footprints/${speciesId}.png` };
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
 * The species a FOOTPRINT question can ask about: those that ship a bundled
 * footprint sprite AND resolve to a real, vanilla-named species (national dex
 * 1..1025, so option labels stay clean). Memoized for the same early-init reason
 * as {@linkcode quizSpeciesIds}.
 */
/** Footprint sprites are canon only through Gen 5 (#649, Genesect); Gen 6+ never
 * had them, and the decomp only auto-generated placeholder prints for those. Cap
 * the pool here so every answer and distractor is a real Gen 1-5 footprint. */
const LAST_FOOTPRINT_DEX_ID = 649;
let cachedFootprintSpeciesIds: number[] | null = null;
function footprintSpeciesIds(): number[] {
  if (cachedFootprintSpeciesIds === null) {
    cachedFootprintSpeciesIds = [...ER_FOOTPRINT_IDS].filter(id => {
      if (id > LAST_FOOTPRINT_DEX_ID) {
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
