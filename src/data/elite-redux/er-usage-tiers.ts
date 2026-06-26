/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - usage tiers (#384): OU/UU/RU/PU/NU. The TIER POLICY lives here;
// the nightly worker cron only produces per-starter-LINE SIGNALS (deduped usage
// %, raw win/wave, and the SKILL-ADJUSTED win/wave lift - each run scored vs the
// picking player's own average, EB-shrunk). See stats/model-deconfound.mjs.
//
// CLOUDFLARE-QUOTA RULE: the data is a single static JSON committed to er-assets
// and served by jsDelivr. The client fetches it AT MOST ONCE PER SESSION, lazily,
// and NEVER from the save worker - choosing/playing the Usage Tier challenge adds
// ZERO worker requests.
//
// THE MODEL (M5cap):
//  - COMMON-egg lines are ranked by performance, not popularity, so the pool no
//    longer collapses as the playerbase grows (a fixed % cutoff mapped to ~2 picks
//    once we hit ~540 players). We rank winLift + waveLift among common-egg lines,
//    blend, quantile-bin into UU/RU/PU/NU, then CAP: a line picked by > USAGE_CAP %
//    of players can't fall into PU/NU (keeps the popular gen-starters, which beginners
//    pick and lose with, out of the weakest tiers - the de-confound can't fully
//    remove that learning-time effect, so the cap does).
//  - NON-common lines keep the legacy USAGE tier (usage band floored by egg tier);
//    they can never be PU/NU anyway, and this keeps a strong rare-egg mon OU
//    (excluded from UU/RU) instead of slipping through unranked.
//  - A line ABSENT from the data (unpicked) is legal anywhere its egg tier allows;
//    if the data can't be fetched at all, only the local EGG gates apply, so the
//    challenge stays playable offline.
//
// Egg gates per challenge value: UU<=EPIC, RU<=RARE, PU/NU=COMMON only.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { erBalanceArr } from "#data/elite-redux/er-balance-tuning";
import { EggTier } from "#enums/egg-type";

/** Challenge value -> human name (0 = Off). */
export const ER_USAGE_TIER_NAMES = ["Off", "UU", "RU", "PU", "NU"] as const;

/** Highest egg tier still allowed per challenge value (a line must be AT or BELOW it). */
const MAX_EGG_TIER = [EggTier.LEGENDARY, EggTier.EPIC, EggTier.RARE, EggTier.COMMON, EggTier.COMMON] as const;

/** Legacy usage-percent gate per challenge value (NON-common lines only). */
const USAGE_GATE_PCT = [Number.POSITIVE_INFINITY, 2.25, 1, 0.5, 0.25] as const;

// --- M5cap tuning (offline prototype: stats/model-deconfound.mjs) ---------------
/** Blend weight for skill-adjusted WIN lift vs avg-WAVE lift (the two sum to 1). */
const BLEND_WIN = 0.5;
/** Cumulative perf-rank cut points (ascending) for [NU, PU, RU, UU]; above UU = OU. */
const TIER_CUTS = [0.35, 0.6, 0.8, 0.92] as const;
/** A common-egg line picked by MORE than this % of players cannot sit in PU/NU. */
const USAGE_CAP_PCT = 8;
/** A line whose RAW win rate is >= this multiple of the baseline can't be NU - a clear
 *  winner is never "the weakest tier", even if its skill-adjusted lift is negative
 *  (its pickers happen to do even better with their OTHER mons). */
const RAW_WIN_FLOOR_MULT = 2;
/** Baseline win % fallback when the published data omits it (old json / offline). */
const DEFAULT_BASE_WIN_PCT = 6.3;

/** Tier index a line can be AT MOST given its egg tier (higher index = lower tier). */
function eggBand(eggTier: EggTier): number {
  for (let v = MAX_EGG_TIER.length - 1; v >= 0; v--) {
    if (eggTier <= MAX_EGG_TIER[v]) {
      return v;
    }
  }
  return 0;
}

interface UsageTierLine {
  /** Deduped usage: share of distinct players who picked the line (percent). */
  usagePct: number;
  /** Raw win rate (percent) and avg wave reached - for display/transparency. */
  win?: number;
  wave?: number;
  /** Skill-adjusted win lift (pts vs the picking player's own mean), EB-shrunk. */
  winLift?: number;
  /** Skill-adjusted avg-wave lift, EB-shrunk. */
  waveLift?: number;
  /** Effective sample (player-picks) behind the numbers. */
  sample?: number;
}

interface UsageTierData {
  generatedAt: string;
  windowDays: number;
  /** Global baseline win % over the window (drives the raw-win floor). */
  baseWinPct?: number;
  lines: Record<number, UsageTierLine>;
}

const TIER_DATA_URL = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/usage-tiers.json";

let tierData: UsageTierData | null = null;
let fetchStarted = false;
/** Lazily-built {root line id -> tier index 0..4}; invalidated when data arrives. */
let tierMap: Map<number, number> | null = null;

/**
 * Kick off the one-per-session tier-data fetch (idempotent, fire-and-forget).
 * Call from the challenge screen; until/unless it resolves, only the local egg
 * gates apply.
 */
export function preloadErUsageTiers(): void {
  if (fetchStarted) {
    return;
  }
  fetchStarted = true;
  fetch(TIER_DATA_URL)
    .then(res => (res.ok ? res.json() : null))
    .then(data => {
      if (data && typeof data === "object" && data.lines) {
        tierData = data as UsageTierData;
        tierMap = null; // rebuild lazily on next query
      }
    })
    .catch(() => {
      // Offline / CDN hiccup: egg gates still apply; retry next session.
    });
}

/** Whether real usage data is loaded (vs egg-gates-only fallback). */
export function hasErUsageTierData(): boolean {
  return tierData != null;
}

/** The recorded usage percent for a root line (0 when unknown/unpicked). */
export function getErLineUsagePct(rootSpeciesId: number): number {
  return tierData?.lines?.[rootSpeciesId]?.usagePct ?? 0;
}

const eggTierOf = (rootSpeciesId: number): EggTier =>
  speciesEggTiers[rootSpeciesId as keyof typeof speciesEggTiers] ?? EggTier.COMMON;

const isCommonEgg = (rootSpeciesId: number): boolean => eggTierOf(rootSpeciesId) <= EggTier.COMMON;

/** Legacy usage band (NON-common lines): the strictest tier a usage % qualifies for. */
function usageBand(usagePct: number): number {
  const gates = erBalanceArr("er.usageTiers.gates");
  for (let v = MAX_EGG_TIER.length - 1; v >= 1; v--) {
    const gate = gates?.[v - 1] ?? USAGE_GATE_PCT[v];
    if (usagePct < gate) {
      return v;
    }
  }
  return 0;
}

/**
 * Build (once, cached) the tier index per root line. COMMON-egg lines are tiered by
 * PERFORMANCE (rank the skill-adjusted win + wave lift among common-egg lines, blend,
 * quantile-bin, then usage-cap); NON-common lines keep the legacy usage tier floored
 * by egg. A line absent from the data is left out (caller falls back to the egg gate).
 */
function getTierMap(): Map<number, number> {
  if (tierMap) {
    return tierMap;
  }
  const map = new Map<number, number>();
  const data = tierData;
  if (!data) {
    tierMap = map;
    return map;
  }
  const baseWin = data.baseWinPct ?? DEFAULT_BASE_WIN_PCT;
  // SAFETY: only run the performance model on NEW-FORMAT data (the cron stamps
  // baseWinPct). An OLD or CDN-stale json lacks the lift signals, so every common-egg
  // line would rank identically and collapse into one tier - fall back to the legacy
  // usage tiering for ALL lines until the fresh data propagates.
  const hasPerfSignals = data.baseWinPct !== undefined;
  // Rank the common-egg lines by each lift, then blend the two ranks 50/50.
  const common: number[] = [];
  for (const key of Object.keys(data.lines)) {
    const id = Number(key);
    if (isCommonEgg(id)) {
      common.push(id);
    }
  }
  const rankMap = (key: "winLift" | "waveLift"): Map<number, number> => {
    const sorted = [...common].sort((a, b) => (data.lines[a]?.[key] ?? 0) - (data.lines[b]?.[key] ?? 0));
    const m = new Map<number, number>();
    const denom = Math.max(1, sorted.length - 1);
    sorted.forEach((id, i) => m.set(id, i / denom));
    return m;
  };
  const rWin = rankMap("winLift");
  const rWave = rankMap("waveLift");

  for (const key of Object.keys(data.lines)) {
    const id = Number(key);
    const line = data.lines[id];
    if (isCommonEgg(id) && hasPerfSignals) {
      const perf = BLEND_WIN * (rWin.get(id) ?? 0) + (1 - BLEND_WIN) * (rWave.get(id) ?? 0);
      // Higher performance -> higher tier (lower index). Bottom band -> NU(4).
      let tier =
        perf >= TIER_CUTS[3] ? 0 : perf >= TIER_CUTS[2] ? 1 : perf >= TIER_CUTS[1] ? 2 : perf >= TIER_CUTS[0] ? 3 : 4;
      if (tier >= 3 && (line.usagePct ?? 0) > USAGE_CAP_PCT) {
        tier = 2; // popular line -> can't sit in PU/NU
      }
      if (tier === 4 && (line.win ?? 0) >= RAW_WIN_FLOOR_MULT * baseWin) {
        tier = 3; // clear winner -> never NU, whatever its skill-adjusted lift
      }
      map.set(id, tier);
    } else {
      // Non-common: legacy usage tier, floored by egg rarity.
      map.set(id, Math.min(usageBand(line.usagePct ?? 0), eggBand(eggTierOf(id))));
    }
  }
  tierMap = map;
  return map;
}

/** The computed tier index (0=OU .. 4=NU) for a root line, or undefined if unranked. */
export function getErLineTier(rootSpeciesId: number): number | undefined {
  return getTierMap().get(rootSpeciesId);
}

/**
 * Whether a starter LINE (root species id) is legal under the given Usage Tier
 * challenge value (1=UU .. 4=NU). Value 0 allows everything.
 *
 * Egg gate is LOCAL (always available, offline-safe). When the line has a computed
 * tier, it is legal in challenge `value` iff its tier is value-or-weaker (the tiers
 * nest: a NU line is also legal in PU/RU/UU). A line without data (or fully offline)
 * falls back to permissive once the egg gate passes - the old "unpicked = off-meta"
 * rule, so the challenge stays playable.
 */
export function isErLineLegalForUsageTier(rootSpeciesId: number, tierValue: number): boolean {
  if (tierValue <= 0) {
    return true;
  }
  const value = Math.min(tierValue, MAX_EGG_TIER.length - 1);
  // Egg gate (local, always available). Lines without a recorded egg tier
  // (some ER customs) count as COMMON - they are deep off-meta picks.
  if (eggTierOf(rootSpeciesId) > MAX_EGG_TIER[value]) {
    return false;
  }
  const tier = getErLineTier(rootSpeciesId);
  if (tier === undefined) {
    return true; // unpicked / no data: egg gate already passed -> legal
  }
  return tier >= value;
}
