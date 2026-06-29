/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Community Challenge System (P1).
//
// A community challenge is a player-authored run configuration that other
// trainers browse, play, bookmark, and clear. This module holds:
//   - the `CommunityChallengeConfig` source-of-truth type (serializes 1:1 to a
//     run's {gameMode, challenges[], difficulty, allowedSpecies, seed}, which is
//     also the config-match anti-cheat key),
//   - the stats/feed shapes the browser UI binds to,
//   - a graceful-degradation fetch client to the er-save-api `/community/*`
//     routes (degrades to empty feeds when VITE_SERVER_URL is unset/unreachable,
//     exactly like er-ghost-teams.ts),
//   - `buildDemoChallengesConfig()` - self-contained demo data so the render
//     harness + Tier-1 UI runner can drive the screen with NO backend.
//
// The big card art is NOT stored here - it is derived deterministically from the
// ruleset by the "Trial Plates" compositor (src/ui/community-challenge-card.ts).
// Economy/pacing creator knobs are P2 (the `economy`/`constraints` fields are
// reserved but unused in P1).
// =============================================================================

import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { Challenges } from "#enums/challenges";
import type { GameModes } from "#enums/game-modes";
import type { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";

/** Schema version for forward-compatible config migration. */
export const COMMUNITY_CHALLENGE_SCHEMA_VERSION = 1;

/** The restriction toggles shown in the detail panel's RESTRICTIONS column. */
export interface CommunityChallengeRestrictions {
  readonly noLegendary?: boolean;
  readonly noMythical?: boolean;
  readonly noUltraBeasts?: boolean;
  readonly noRepeats?: boolean;
  readonly starterNotGuaranteed?: boolean;
}

/** Deterministic art-derivation hints (NOT image bytes - see the compositor). */
export interface CommunityChallengeArt {
  /** Pinned "hero" species for the silhouette; else derived from the ruleset. */
  readonly themeSpeciesId?: number;
  /** 0 = normal, 1 = shiny, "black" = black-shiny obsidian accent. */
  readonly variant?: 0 | 1 | "black";
  /** Override the dominant type tincture; else the mode of the allowed/required types. */
  readonly accentType?: PokemonType;
  /** Optional biome backdrop silhouette. */
  readonly biomeId?: number;
}

/** Per-run economy / pacing knobs. RESERVED for P2 - unused in P1. */
export interface CommunityChallengeEconomy {
  readonly goldMult?: number;
  readonly xpMult?: number;
  readonly trainerFreq?: number;
  readonly shopFreq?: number;
  readonly startLevel?: number;
  readonly startMoney?: number;
  readonly meRate?: number;
  readonly levelCapPerGym?: boolean;
}

/** The single source-of-truth artifact for a community challenge. */
export interface CommunityChallengeConfig {
  readonly schemaVersion: number;
  readonly id: string;
  readonly name: string;
  readonly subtitle: string;
  readonly description: string;
  readonly author: string;
  readonly authorId?: number;
  readonly createdAt?: number;
  readonly gameModeId: GameModes;
  readonly difficulty: ErDifficulty;
  /** Self-rated 1-5 bin; drives the plate art + the difficulty emblem + filtering. */
  readonly difficultyTier: 1 | 2 | 3 | 4 | 5;
  /** Present => fixed-seed challenge (everyone gets the same run). */
  readonly seed?: string;
  /** REUSES the Challenges enum: [challengeId, value, severity?]. */
  readonly baseChallenges: ReadonlyArray<readonly [Challenges, number, number?]>;
  /** Root speciesIds the run is restricted to; null = all species allowed. */
  readonly allowedSpecies: number[] | null;
  readonly restrictions: CommunityChallengeRestrictions;
  /** A clear must reach this wave (<= 200) to verify. */
  readonly targetWave: number;
  /** Display chips: NUZLOCKE / RANDOMIZER / HARDCORE / ... */
  readonly tags: string[];
  readonly art?: CommunityChallengeArt;
  /** RESERVED for P2. */
  readonly economy?: CommunityChallengeEconomy;
}

/** A human-readable rule line for the detail panel's RULES column. */
export interface CommunityChallengeRule {
  /** A short glyph/icon key hint (resolved by the handler); falls back to a bullet. */
  readonly icon?: string;
  readonly text: string;
}

/** A recent clear/completion row for the Community Stats panel. */
export interface CommunityCompletion {
  readonly user: string;
  /** Epoch ms; the UI renders "Xh ago" / "Xd ago". */
  readonly at: number;
}

/** Aggregate stats for one challenge (drives the donut + clear rate + recent). */
export interface CommunityChallengeStats {
  readonly attempts: number;
  readonly cleared: number;
  readonly inProgress: number;
  readonly failed: number;
  readonly firstClearUser?: string;
  readonly recent: CommunityCompletion[];
}

/** A challenge plus its derived display fields, as the browser binds it. */
export interface CommunityChallengeEntry {
  readonly config: CommunityChallengeConfig;
  readonly stats: CommunityChallengeStats;
  /** The human RULES list shown in the detail panel (derived from baseChallenges). */
  readonly rules: CommunityChallengeRule[];
  /** Preview of allowed species (root ids) for the ALLOWED grid; total in `allowedCount`. */
  readonly allowedPreview: number[];
  readonly allowedCount: number;
  readonly bookmarked?: boolean;
}

/** The full feed the browser screen renders. */
export interface CommunityChallengeFeed {
  readonly featured: CommunityChallengeEntry[];
  /** The currently-selected detail entry (featured[0] by default), or null when empty. */
  readonly selected: CommunityChallengeEntry | null;
  readonly totalCount: number;
}

// ---------------------------------------------------------------------------
// Demo data (NO backend) - used by the render harness + the Tier-1 UI runner so
// the screen renders fully offline. Mirrors the concept art.
// ---------------------------------------------------------------------------

function entry(
  config: CommunityChallengeConfig,
  stats: CommunityChallengeStats,
  rules: CommunityChallengeRule[],
  allowedPreview: number[],
  allowedCount: number,
): CommunityChallengeEntry {
  return { config, stats, rules, allowedPreview, allowedCount };
}

/**
 * Self-contained demo feed mirroring the concept art (4 featured plates +
 * the NOZLOCKE detail). `populated: false` returns the ZERO-at-launch empty
 * feed so the "vacant standards" empty state can be rendered + golden-tested.
 */
export function buildDemoChallengesConfig(opts: { populated?: boolean } = {}): CommunityChallengeFeed {
  if (opts.populated === false) {
    return { featured: [], selected: null, totalCount: 0 };
  }

  // baseChallenges use raw Challenges enum ids; the demo keeps them illustrative.
  const nozlocke = entry(
    {
      schemaVersion: COMMUNITY_CHALLENGE_SCHEMA_VERSION,
      id: "demo-nozlocke",
      name: "Nozlocke",
      subtitle: "The Ultimate Test",
      description:
        "A merciless Nuzlocke variant that randomizes encounters, abilities, and even movesets. Can you survive the unknown?",
      author: "UmbraKai",
      gameModeId: 0 as GameModes,
      difficulty: "hell",
      difficultyTier: 5,
      baseChallenges: [],
      allowedSpecies: null,
      restrictions: {
        noLegendary: true,
        noMythical: true,
        noUltraBeasts: true,
        noRepeats: true,
        starterNotGuaranteed: true,
      },
      targetWave: 200,
      tags: ["NUZLOCKE", "RANDOMIZER", "HARDCORE"],
      art: { themeSpeciesId: SpeciesId.GENGAR },
    },
    {
      attempts: 24147,
      cleared: Math.round(24147 * 0.073),
      inProgress: Math.round(24147 * 0.481),
      failed: Math.round(24147 * 0.446),
      firstClearUser: "Solaris",
      recent: [
        { user: "Solaris", at: 0 - 2 * 3600_000 },
        { user: "Kitsune", at: 0 - 5 * 3600_000 },
        { user: "PokeMasterT", at: 0 - 8 * 3600_000 },
        { user: "LunaEcho", at: 0 - 12 * 3600_000 },
        { user: "BlazeRunner", at: 0 - 24 * 3600_000 },
      ],
    },
    [
      { text: "Faint it, box it." },
      { text: "Randomized wild encounters." },
      { text: "Randomized abilities and moves." },
      { text: "No items in battle." },
      { text: "Set mode." },
      { text: "Level cap per gym." },
    ],
    [
      SpeciesId.GENGAR,
      SpeciesId.LUCARIO,
      SpeciesId.GARDEVOIR,
      SpeciesId.GARCHOMP,
      SpeciesId.WEAVILE,
      SpeciesId.HOUNDOOM,
      SpeciesId.SYLVEON,
      SpeciesId.GRENINJA,
      SpeciesId.AGGRON,
    ],
    351,
  );

  const featured: CommunityChallengeEntry[] = [
    nozlocke,
    entry(
      {
        schemaVersion: COMMUNITY_CHALLENGE_SCHEMA_VERSION,
        id: "demo-doubles",
        name: "Doubles Only",
        subtitle: "Team Synergy",
        description: "Only Double Battles. Every move, every switch, every turn matters.",
        author: "TwinFlame",
        gameModeId: 0 as GameModes,
        difficulty: "elite",
        difficultyTier: 4,
        baseChallenges: [],
        allowedSpecies: null,
        restrictions: {},
        targetWave: 200,
        tags: ["DOUBLES", "SYNERGY"],
        art: { themeSpeciesId: SpeciesId.ZOROARK },
      },
      { attempts: 12400, cleared: Math.round(12400 * 0.186), inProgress: 0, failed: 0, recent: [] },
      [{ text: "Only Double Battles." }],
      [],
      0,
    ),
    entry(
      {
        schemaVersion: COMMUNITY_CHALLENGE_SCHEMA_VERSION,
        id: "demo-ghosts",
        name: "Ghosts Only",
        subtitle: "Beyond the Grave",
        description: "You can only use Ghost-type Pokemon. No exceptions.",
        author: "Necromancer",
        gameModeId: 0 as GameModes,
        difficulty: "elite",
        difficultyTier: 4,
        baseChallenges: [],
        allowedSpecies: [SpeciesId.GENGAR, SpeciesId.MIMIKYU, SpeciesId.DUSKNOIR, SpeciesId.CHANDELURE],
        restrictions: {},
        targetWave: 200,
        tags: ["MONOTYPE", "GHOST"],
        art: { themeSpeciesId: SpeciesId.MIMIKYU },
      },
      { attempts: 8700, cleared: Math.round(8700 * 0.121), inProgress: 0, failed: 0, recent: [] },
      [{ text: "Ghost-type Pokemon only." }],
      [],
      0,
    ),
    entry(
      {
        schemaVersion: COMMUNITY_CHALLENGE_SCHEMA_VERSION,
        id: "demo-featherlocke",
        name: "Featherlocke",
        subtitle: "Light as a Feather",
        description: "Only Flying-type Pokemon. One faint is one less feather.",
        author: "SkyWarden",
        gameModeId: 0 as GameModes,
        difficulty: "ace",
        difficultyTier: 3,
        baseChallenges: [],
        allowedSpecies: [SpeciesId.TALONFLAME, SpeciesId.STARAPTOR, SpeciesId.CORVIKNIGHT],
        restrictions: {},
        targetWave: 200,
        tags: ["MONOTYPE", "FLYING", "NUZLOCKE"],
        art: { themeSpeciesId: SpeciesId.TALONFLAME },
      },
      { attempts: 5200, cleared: Math.round(5200 * 0.214), inProgress: 0, failed: 0, recent: [] },
      [{ text: "Flying-type Pokemon only." }],
      [],
      0,
    ),
  ];

  return { featured, selected: nozlocke, totalCount: featured.length };
}

// ---------------------------------------------------------------------------
// Graceful-degradation fetch client (the worker routes land in P1-A). Until the
// worker is deployed, every call resolves to an empty feed / no-op, exactly like
// er-ghost-teams.ts degrades when the save API is unreachable.
// ---------------------------------------------------------------------------

function serverBase(): string | null {
  // import.meta.env.VITE_SERVER_URL is wired into the staging build.
  const url = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_SERVER_URL;
  return url && url.length > 0 ? url.replace(/\/+$/, "") : null;
}

/** Fetch the browse/featured feed. Degrades to an empty feed offline. */
export async function fetchCommunityFeed(_query?: { filter?: string; sort?: string; page?: number }): Promise<
  CommunityChallengeFeed
> {
  const base = serverBase();
  if (!base) {
    return { featured: [], selected: null, totalCount: 0 };
  }
  try {
    const res = await fetch(`${base}/community/challenges`);
    if (!res.ok) {
      return { featured: [], selected: null, totalCount: 0 };
    }
    return (await res.json()) as CommunityChallengeFeed;
  } catch {
    return { featured: [], selected: null, totalCount: 0 };
  }
}
