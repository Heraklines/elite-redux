/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown ranked ladder — REWARDS HOOK REGISTRY (engine-free). A tiny subscribe/emit
// bus so the ACHIEVEMENTS / rewards layer can react to ranked milestones WITHOUT this
// module (or the ladder core) importing achv.ts / the trackers — a hard ownership
// boundary. The rank-result flow (showdown-rank-client.ts, driven by ShowdownResultPhase)
// EMITS; the achievements layer SUBSCRIBES later. Each subscriber is fired defensively
// (a throwing handler never breaks the emit or the return-to-title flow).
//
// Intended reward mapping (documented in docs/plans/2026-07-10-showdown-ranked-ladder.md;
// wiring is a mechanical follow-up in the achievements layer):
//   - onRankedTierFirstReached(greatball)  -> Plus voucher + title
//   - onRankedTierFirstReached(ultraball)  -> Premium voucher + ranked-exclusive effect
//   - onRankedTierFirstReached(masterball) -> Epic egg + title
//   - onRankedTierFirstReached(champion)   -> tier-2 shiny + exclusive Champion aura
//   - onRankedSeasonEnd(finalTier)         -> scaled candy / eggs
//   - onRankedMatchWin()                   -> incremental win-count achievements
// =============================================================================

import type { ShowdownRankTier } from "#data/elite-redux/showdown/showdown-rank-types";

/** Fired once when a player reaches a tier for the FIRST TIME EVER (career-first promotion). */
export type RankedTierReachedHandler = (tier: ShowdownRankTier) => void;
/** Fired when a season ends (evaluated lazily at the first ranked action of the new season). */
export type RankedSeasonEndHandler = (finalTier: ShowdownRankTier) => void;
/** Fired once per confirmed ranked match win. */
export type RankedMatchWinHandler = () => void;

const tierReachedHandlers = new Set<RankedTierReachedHandler>();
const seasonEndHandlers = new Set<RankedSeasonEndHandler>();
const matchWinHandlers = new Set<RankedMatchWinHandler>();

/** Subscribe to career-first tier promotions. Returns an unsubscribe fn. */
export function onRankedTierFirstReached(handler: RankedTierReachedHandler): () => void {
  tierReachedHandlers.add(handler);
  return () => {
    tierReachedHandlers.delete(handler);
  };
}

/** Subscribe to season-end events. Returns an unsubscribe fn. */
export function onRankedSeasonEnd(handler: RankedSeasonEndHandler): () => void {
  seasonEndHandlers.add(handler);
  return () => {
    seasonEndHandlers.delete(handler);
  };
}

/** Subscribe to confirmed ranked match wins. Returns an unsubscribe fn. */
export function onRankedMatchWin(handler: RankedMatchWinHandler): () => void {
  matchWinHandlers.add(handler);
  return () => {
    matchWinHandlers.delete(handler);
  };
}

/** Fire every {@linkcode onRankedTierFirstReached} subscriber defensively. */
export function emitRankedTierFirstReached(tier: ShowdownRankTier): void {
  for (const handler of [...tierReachedHandlers]) {
    try {
      handler(tier);
    } catch (err) {
      console.warn("[showdown-rank-events] a tier-reached handler threw (ignored)", err);
    }
  }
}

/** Fire every {@linkcode onRankedSeasonEnd} subscriber defensively. */
export function emitRankedSeasonEnd(finalTier: ShowdownRankTier): void {
  for (const handler of [...seasonEndHandlers]) {
    try {
      handler(finalTier);
    } catch (err) {
      console.warn("[showdown-rank-events] a season-end handler threw (ignored)", err);
    }
  }
}

/** Fire every {@linkcode onRankedMatchWin} subscriber defensively. */
export function emitRankedMatchWin(): void {
  for (const handler of [...matchWinHandlers]) {
    try {
      handler();
    } catch (err) {
      console.warn("[showdown-rank-events] a match-win handler threw (ignored)", err);
    }
  }
}

/** TEST-ONLY: drop all subscribers (isolate tests; never called in production paths). */
export function _clearRankedEventSubscribers(): void {
  tierReachedHandlers.clear();
  seasonEndHandlers.clear();
  matchWinHandlers.clear();
}
