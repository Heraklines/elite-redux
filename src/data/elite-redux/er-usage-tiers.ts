/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — usage tiers (#384): OU/UU/RU/PU/NU computed from REAL run
// stats (see docs/design/usage-tiers.md).
//
// CLOUDFLARE-QUOTA RULE: the tier data is a single static JSON committed to
// er-assets by a once-nightly worker cron and served by jsDelivr's CDN. The
// client fetches it AT MOST ONCE PER SESSION, lazily, and NEVER from the
// save worker — choosing or playing the Usage Tier challenge adds ZERO worker
// requests.
//
// Tier gates (challenge value 1-4):
//   UU: usage < 2.25%, no legendary-egg lines.
//   RU: usage < 1%,    also no epic-egg lines.
//   PU: usage < 0.5%,  also no rare-egg lines (common-egg only from here).
//   NU: usage < 0.25%, common-egg lines only.
// A line absent from the data counts as 0% usage (unpicked = legal anywhere
// its egg tier allows). If the data cannot be fetched at all, the EGG gates
// (purely local) still apply, so the challenge stays playable offline.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { erBalanceArr } from "#data/elite-redux/er-balance-tuning";
import { EggTier } from "#enums/egg-type";

/** Challenge value → human name (0 = Off). */
export const ER_USAGE_TIER_NAMES = ["Off", "UU", "RU", "PU", "NU"] as const;

/** Usage-percent gate per challenge value (a line must be BELOW it). */
const USAGE_GATE_PCT = [Number.POSITIVE_INFINITY, 2.25, 1, 0.5, 0.25] as const;

/** Highest egg tier still allowed per challenge value. */
const MAX_EGG_TIER = [EggTier.LEGENDARY, EggTier.EPIC, EggTier.RARE, EggTier.COMMON, EggTier.COMMON] as const;

interface UsageTierLine {
  /** Deduped usage: share of distinct players who picked the line (percent). */
  usagePct: number;
  /** Performance lift vs stratum baseline (percentage points), if computed. */
  lift?: number;
  /** Effective sample (player-picks) behind the numbers. */
  sample?: number;
}

interface UsageTierData {
  generatedAt: string;
  windowDays: number;
  lines: Record<number, UsageTierLine>;
}

const TIER_DATA_URL = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/usage-tiers.json";

let tierData: UsageTierData | null = null;
let fetchStarted = false;

/**
 * Kick off the one-per-session tier-data fetch (idempotent, fire-and-forget).
 * Call from the challenge screen; until/unless it resolves, only the local
 * egg gates apply.
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

/**
 * Whether a starter LINE (root species id) is legal under the given Usage
 * Tier challenge value (1=UU .. 4=NU). Value 0 allows everything.
 */
export function isErLineLegalForUsageTier(rootSpeciesId: number, tierValue: number): boolean {
  if (tierValue <= 0) {
    return true;
  }
  const value = Math.min(tierValue, USAGE_GATE_PCT.length - 1);
  // Egg gate (local, always available). Lines without a recorded egg tier
  // (some ER customs) count as COMMON - they are deep off-meta picks.
  const eggTier = speciesEggTiers[rootSpeciesId as keyof typeof speciesEggTiers] ?? EggTier.COMMON;
  if (eggTier > MAX_EGG_TIER[value]) {
    return false;
  }
  // Usage gate (from the nightly data; 0 when unknown). The gate percentages
  // are editor-tunable (er.usageTiers.gates: [UU, RU, PU, NU]).
  const gate = value >= 1 ? erBalanceArr("er.usageTiers.gates")[value - 1] : Number.POSITIVE_INFINITY;
  return getErLineUsagePct(rootSpeciesId) < (gate ?? USAGE_GATE_PCT[value]);
}
