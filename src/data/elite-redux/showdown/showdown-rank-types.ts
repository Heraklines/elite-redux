/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown ranked ladder — CLIENT-side shared types + pure display helpers. The
// AUTHORITATIVE progression math lives server-side (workers/er-save-api/src/showdown-rank.ts,
// exhaustively unit-tested); the client never computes progression — it only FETCHES the
// server's state and renders it. This module mirrors the wire shape (like showdown-stakes.ts
// mirrors the escrow's stakeTier) and carries engine-free formatting for the RANK CARD.
// =============================================================================

/** Tier ladder, mirrors the worker `RANK_TIER` (pokeball -> champion). */
export const SHOWDOWN_RANK_TIER = {
  pokeball: 0,
  greatball: 1,
  ultraball: 2,
  masterball: 3,
  champion: 4,
} as const;

export type ShowdownRankTier = (typeof SHOWDOWN_RANK_TIER)[keyof typeof SHOWDOWN_RANK_TIER];

/** Segments per rank (mirrors the worker `SEGMENTS_PER_RANK`); the gauge shows this many pips. */
export const SHOWDOWN_SEGMENTS_PER_RANK = 4;
/** Bottom (entry) rank of a non-champion tier. */
export const SHOWDOWN_FLOOR_RANK = 4;

/** A player's ranked state as served by GET /showdown/rank. Mirrors the worker `RankState`. */
export interface ShowdownRankState {
  seasonId: string;
  tier: number;
  rank: number;
  segments: number;
  streak: number;
  highestTierReached: number;
  careerBestTier: number;
}

/** A default (unranked / offline) state for the pokeball floor, so the card always renders. */
export function defaultShowdownRankState(seasonId = ""): ShowdownRankState {
  return {
    seasonId,
    tier: SHOWDOWN_RANK_TIER.pokeball,
    rank: SHOWDOWN_FLOOR_RANK,
    segments: 0,
    streak: 0,
    highestTierReached: SHOWDOWN_RANK_TIER.pokeball,
    careerBestTier: SHOWDOWN_RANK_TIER.pokeball,
  };
}

/** Runtime guard for a server-served rank state (untrusted JSON off the wire). */
export function isShowdownRankState(v: unknown): v is ShowdownRankState {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const s = v as Record<string, unknown>;
  return (
    typeof s.seasonId === "string"
    && typeof s.tier === "number"
    && typeof s.rank === "number"
    && typeof s.segments === "number"
    && typeof s.streak === "number"
    && typeof s.highestTierReached === "number"
    && typeof s.careerBestTier === "number"
  );
}

/**
 * The "pb" atlas FRAME for a tier's ball emblem (reuse the ball sprites — texture "pb",
 * frames "pb"/"gb"/"ub"/"mb"). Champion has no dedicated ball, so it reuses the master-ball
 * frame (distinguished by its gold label + aura on the card).
 */
export function tierBallFrame(tier: number): string {
  switch (tier) {
    case SHOWDOWN_RANK_TIER.pokeball:
      return "pb";
    case SHOWDOWN_RANK_TIER.greatball:
      return "gb";
    case SHOWDOWN_RANK_TIER.ultraball:
      return "ub";
    case SHOWDOWN_RANK_TIER.masterball:
      return "mb";
    case SHOWDOWN_RANK_TIER.champion:
      return "mb";
    default:
      return "pb";
  }
}

/** The untranslated fallback display name for a tier (locale key `battle:showdownRankTier<Name>`). */
export function tierDisplayName(tier: number): string {
  switch (tier) {
    case SHOWDOWN_RANK_TIER.pokeball:
      return "Poke Ball";
    case SHOWDOWN_RANK_TIER.greatball:
      return "Great Ball";
    case SHOWDOWN_RANK_TIER.ultraball:
      return "Ultra Ball";
    case SHOWDOWN_RANK_TIER.masterball:
      return "Master Ball";
    case SHOWDOWN_RANK_TIER.champion:
      return "Champion";
    default:
      return "Unranked";
  }
}

/** The i18n locale key suffix for a tier name (`battle:showdownRankTier<Suffix>`). */
export function tierLocaleSuffix(tier: number): string {
  switch (tier) {
    case SHOWDOWN_RANK_TIER.pokeball:
      return "Pokeball";
    case SHOWDOWN_RANK_TIER.greatball:
      return "Greatball";
    case SHOWDOWN_RANK_TIER.ultraball:
      return "Ultraball";
    case SHOWDOWN_RANK_TIER.masterball:
      return "Masterball";
    case SHOWDOWN_RANK_TIER.champion:
      return "Champion";
    default:
      return "Unranked";
  }
}

/**
 * A compact one-line rank label, e.g. "Ultra Ball 2" or "Champion". Champion is a single rank,
 * so its rank number is omitted. Pure — the caller supplies the localized tier name if desired.
 */
export function rankLabel(tier: number, rank: number, tierName = tierDisplayName(tier)): string {
  if (tier === SHOWDOWN_RANK_TIER.champion) {
    return tierName;
  }
  return `${tierName} ${rank}`;
}
