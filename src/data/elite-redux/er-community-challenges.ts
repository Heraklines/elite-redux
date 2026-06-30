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

import { bypassLogin } from "#constants/app-constants";
import type { ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import type { Challenges } from "#enums/challenges";
import type { GameModes } from "#enums/game-modes";
import type { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { sessionIdKey } from "#utils/common";
import { getCookie } from "#utils/cookies";

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
// Shared config validator. The er-save-api worker carries a VERBATIM copy of
// this function (workers/er-save-api/src/index.ts `validateChallengeConfig`) -
// workers can't import from `src/`. A parity vitest asserts the two agree
// (test/tests/elite-redux/er-community-challenge-validator-parity.test.ts). Keep
// the bodies byte-identical when either is edited.
// ---------------------------------------------------------------------------

/** Result of validating an untrusted community-challenge config. */
export interface ChallengeConfigValidation {
  ok: boolean;
  errors: string[];
}

// The `Challenges` enum (src/enums/challenges.ts) has 15 members (0..14),
// SINGLE_GENERATION..GHOST_TRAINERS. Hardcoded as a constant so the worker copy
// and the client copy bind the same range without importing the enum.
const CC_CHALLENGE_ID_MAX = 14;
const CC_VALID_DIFFICULTIES = ["youngster", "ace", "elite", "hell"];
const CC_MAX_NAME = 60;
const CC_MAX_SUBTITLE = 80;
const CC_MAX_DESC = 600;
const CC_MAX_TAGS = 8;
const CC_MAX_TAG_LEN = 24;
const CC_MAX_BASE_CHALLENGES = 20;
const CC_MAX_ALLOWED_SPECIES = 300;
const CC_MAX_TARGET_WAVE = 200;

export function validateChallengeConfig(config: unknown): ChallengeConfigValidation {
  const errors: string[] = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: ["config must be an object"] };
  }
  const c = config as Record<string, unknown>;
  if (typeof c.name !== "string" || c.name.trim().length === 0) {
    errors.push("name is required");
  } else if (c.name.length > CC_MAX_NAME) {
    errors.push(`name must be <= ${CC_MAX_NAME} characters`);
  }
  if (c.subtitle !== undefined && (typeof c.subtitle !== "string" || c.subtitle.length > CC_MAX_SUBTITLE)) {
    errors.push(`subtitle must be a string <= ${CC_MAX_SUBTITLE} characters`);
  }
  if (c.description !== undefined && (typeof c.description !== "string" || c.description.length > CC_MAX_DESC)) {
    errors.push(`description must be a string <= ${CC_MAX_DESC} characters`);
  }
  if (typeof c.difficulty !== "string" || !CC_VALID_DIFFICULTIES.includes(c.difficulty)) {
    errors.push("difficulty must be one of youngster|ace|elite|hell");
  }
  if (
    typeof c.difficultyTier !== "number" ||
    !Number.isInteger(c.difficultyTier) ||
    c.difficultyTier < 1 ||
    c.difficultyTier > 5
  ) {
    errors.push("difficultyTier must be an integer 1..5");
  }
  if (typeof c.gameModeId !== "number" || !Number.isFinite(c.gameModeId)) {
    errors.push("gameModeId must be a number");
  }
  if (!Array.isArray(c.baseChallenges)) {
    errors.push("baseChallenges must be an array");
  } else {
    if (c.baseChallenges.length > CC_MAX_BASE_CHALLENGES) {
      errors.push(`baseChallenges must have <= ${CC_MAX_BASE_CHALLENGES} entries`);
    }
    for (const entry of c.baseChallenges) {
      if (!Array.isArray(entry) || entry.length < 2) {
        errors.push("each baseChallenge must be [id, value, severity?]");
        continue;
      }
      const id = entry[0];
      const value = entry[1];
      const severity = entry[2];
      if (typeof id !== "number" || !Number.isInteger(id) || id < 0 || id > CC_CHALLENGE_ID_MAX) {
        errors.push(`baseChallenge id ${String(id)} is out of range 0..${CC_CHALLENGE_ID_MAX}`);
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        errors.push("baseChallenge value must be a number");
      }
      if (severity !== undefined && (typeof severity !== "number" || !Number.isFinite(severity))) {
        errors.push("baseChallenge severity must be a number");
      }
    }
  }
  if (c.allowedSpecies !== null && !Array.isArray(c.allowedSpecies)) {
    errors.push("allowedSpecies must be null or an array");
  } else if (Array.isArray(c.allowedSpecies)) {
    if (c.allowedSpecies.length > CC_MAX_ALLOWED_SPECIES) {
      errors.push(`allowedSpecies must have <= ${CC_MAX_ALLOWED_SPECIES} entries`);
    }
    for (const sp of c.allowedSpecies) {
      if (typeof sp !== "number" || !Number.isInteger(sp) || sp <= 0) {
        errors.push("allowedSpecies entries must be positive integers");
        break;
      }
    }
  }
  if (
    typeof c.targetWave !== "number" ||
    !Number.isInteger(c.targetWave) ||
    c.targetWave < 1 ||
    c.targetWave > CC_MAX_TARGET_WAVE
  ) {
    errors.push(`targetWave must be an integer 1..${CC_MAX_TARGET_WAVE}`);
  }
  if (!Array.isArray(c.tags)) {
    errors.push("tags must be an array");
  } else {
    if (c.tags.length > CC_MAX_TAGS) {
      errors.push(`tags must have <= ${CC_MAX_TAGS} entries`);
    }
    for (const tag of c.tags) {
      if (typeof tag !== "string" || tag.length === 0 || tag.length > CC_MAX_TAG_LEN) {
        errors.push(`each tag must be a non-empty string <= ${CC_MAX_TAG_LEN} characters`);
        break;
      }
    }
  }
  if (
    c.restrictions !== undefined &&
    (typeof c.restrictions !== "object" || c.restrictions === null || Array.isArray(c.restrictions))
  ) {
    errors.push("restrictions must be an object");
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Graceful-degradation fetch client (matches the er-save-api `/community/*`
// routes, P1-A). Until the worker is deployed (or offline, or for a guest), every
// call resolves to an empty feed / null / no-op and NEVER throws, exactly like
// er-ghost-teams.ts degrades when the save API is unreachable. Read routes
// (feed/detail) need only VITE_SERVER_URL; write routes (create/attempt/bookmark)
// additionally need the session token.
// ---------------------------------------------------------------------------

/** Page size used to translate a `page` index into a row offset. */
const COMMUNITY_PAGE_SIZE = 12;

function serverBase(): string | null {
  // import.meta.env.VITE_SERVER_URL is wired into the staging build.
  const url = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_SERVER_URL;
  return url && url.length > 0 ? url.replace(/\/+$/, "") : null;
}

/** The session token for authed routes, or null (guest / login bypassed / no DOM). */
function authToken(): string | null {
  if (bypassLogin || typeof document === "undefined") {
    return null;
  }
  const token = getCookie(sessionIdKey);
  return token && token.length > 0 ? token : null;
}

function emptyFeed(): CommunityChallengeFeed {
  return { featured: [], selected: null, totalCount: 0 };
}

/** Fetch the browse/featured feed. Degrades to an empty feed offline. */
export async function fetchCommunityFeed(query?: {
  filter?: string;
  sort?: string;
  page?: number;
}): Promise<CommunityChallengeFeed> {
  const base = serverBase();
  if (!base || typeof fetch !== "function") {
    return emptyFeed();
  }
  try {
    const params = new URLSearchParams();
    if (query?.sort) {
      params.set("sort", query.sort);
    }
    if (query?.filter) {
      params.set("tag", query.filter);
    }
    if (query?.page && query.page > 0) {
      params.set("offset", String(query.page * COMMUNITY_PAGE_SIZE));
    }
    const qs = params.toString();
    const res = await fetch(`${base}/community/challenges${qs ? `?${qs}` : ""}`);
    if (!res.ok) {
      return emptyFeed();
    }
    const data = (await res.json()) as CommunityChallengeFeed;
    return data && Array.isArray(data.featured) ? data : emptyFeed();
  } catch {
    return emptyFeed();
  }
}

/** Fetch one challenge's full detail entry (config + stats + recent). Null on any failure. */
export async function fetchCommunityChallenge(id: string): Promise<CommunityChallengeEntry | null> {
  const base = serverBase();
  if (!base || typeof fetch !== "function" || !id) {
    return null;
  }
  try {
    const res = await fetch(`${base}/community/challenge?id=${encodeURIComponent(id)}`);
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { challenge?: CommunityChallengeEntry };
    return data?.challenge ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a DRAFT challenge from a config. Returns its server id, or null when
 * offline / guest / invalid. Validates client-side first (the worker re-validates).
 */
export async function createCommunityChallenge(config: CommunityChallengeConfig): Promise<string | null> {
  const base = serverBase();
  const token = authToken();
  if (!base || !token || typeof fetch !== "function") {
    return null;
  }
  if (!validateChallengeConfig(config).ok) {
    return null;
  }
  try {
    const res = await fetch(`${base}/community/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify(config),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { id?: string };
    return typeof data?.id === "string" ? data.id : null;
  } catch {
    return null;
  }
}

/** Record a run START (in-progress) for a challenge. Idempotent server-side; false on failure. */
export async function recordCommunityAttempt(challengeId: string, wave?: number): Promise<boolean> {
  const base = serverBase();
  const token = authToken();
  if (!base || !token || typeof fetch !== "function" || !challengeId) {
    return false;
  }
  try {
    const res = await fetch(`${base}/community/attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify(wave === undefined ? { challengeId } : { challengeId, wave }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Record a VICTORY clear of a challenge. For the FOUNDER of a draft this flips it
 * draft -> active (auto-publish); the run's config fields are sent so the worker can
 * config-match + verify (anti-cheat). Returns whether the call succeeded (false offline
 * / guest / non-victory). `run.party` is the serialized team (PokemonData[]).
 */
export async function recordCommunityClear(
  draftId: string,
  config: CommunityChallengeConfig,
  run: { wave: number; clearTimeMs?: number; party: unknown[] },
): Promise<boolean> {
  const base = serverBase();
  const token = authToken();
  if (!base || !token || typeof fetch !== "function" || !draftId) {
    return false;
  }
  try {
    const res = await fetch(`${base}/community/clear`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        challengeId: draftId,
        outcome: "victory",
        wave: run.wave,
        clearTimeMs: run.clearTimeMs,
        party: run.party,
        // Config-match inputs (the worker compares these to the stored challenge):
        gameModeId: config.gameModeId,
        difficulty: config.difficulty,
        baseChallenges: config.baseChallenges,
        allowedSpecies: config.allowedSpecies,
        seed: config.seed,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Toggle a bookmark on/off for a challenge. Returns the success of the call (no-op false offline). */
export async function setCommunityBookmark(challengeId: string, on: boolean): Promise<boolean> {
  const base = serverBase();
  const token = authToken();
  if (!base || !token || typeof fetch !== "function" || !challengeId) {
    return false;
  }
  try {
    const res = await fetch(`${base}/community/bookmark`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({ challengeId, on }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fetch this player's bookmarked challenges. Empty on any failure. */
export async function fetchCommunityBookmarks(): Promise<CommunityChallengeEntry[]> {
  const base = serverBase();
  const token = authToken();
  if (!base || !token || typeof fetch !== "function") {
    return [];
  }
  try {
    const res = await fetch(`${base}/community/bookmarks`, { headers: { Authorization: token } });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { items?: CommunityChallengeEntry[] };
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}
