/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - the REAL Inferno challenge, modelled as a single community card.
//
// Unlike the demo feed (er-community-challenges.ts buildDemoChallengesConfig),
// every field here is DERIVED FROM REAL GAME DATA:
//   - RULES are derived from the actual Inferno apex stack: Hell difficulty +
//     USAGE_TIER(NU) + DOUBLES_ONLY + GHOST_TRAINERS (the exact predicate behind
//     the INFERNO ChallengeAchv / system/achv.ts apexStackActive).
//   - The ALLOWED POKEMON pool is recomputed LIVE from the M5cap usage-tier feed:
//     every starter root LINE currently ranked NU (tier index 4). This is exactly
//     the pool the run's USAGE_TIER(NU) challenge admits (challenge.ts
//     isErLineLegalForUsageTier), so the card mirrors real gameplay and shifts as
//     the tiers re-rank each cycle.
//   - The COMPLETION COUNT is the real number of trainers who have unlocked the
//     INFERNO achievement (achvUnlocks.INFERNO), read from the prod system saves.
//
// This is the "closest to non-mock data" card: a vanilla, achievement-backed
// challenge rendered with live data, used as the reference while the player-
// authored community feed comes online.
// =============================================================================

import { speciesStarterCosts } from "#balance/starters";
import {
  COMMUNITY_CHALLENGE_SCHEMA_VERSION,
  type CommunityChallengeConfig,
  type CommunityChallengeEntry,
  type CommunityChallengeFeed,
  type CommunityChallengeRule,
  type CommunityChallengeStats,
} from "#data/elite-redux/er-community-challenges";
import { getErLineTier } from "#data/elite-redux/er-usage-tiers";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Usage-tier index for NU (er-usage-tiers ER_USAGE_TIER_NAMES[4] = the lowest tier). */
const NU_TIER_VALUE = 4;
const ALLOWED_PREVIEW_LEN = 10;

/** Card-hero fallback when the NU pool isn't loaded yet (offline / pre-boot); in-game the
 *  hero is the live strongest-NU line (currently Volbeat) - the best mon you're allowed. */
const INFERNO_FALLBACK_HERO = SpeciesId.VOLBEAT;

// The Inferno apex stack, exactly as enforced in-game (system/achv.ts
// apexStackActive): Hell difficulty + NU usage tier + Doubles-only + Ghost trainers.
const INFERNO_BASE_CHALLENGES: ReadonlyArray<readonly [Challenges, number, number?]> = [
  [Challenges.USAGE_TIER, NU_TIER_VALUE],
  [Challenges.DOUBLES_ONLY, 1],
  [Challenges.GHOST_TRAINERS, 1],
];

// ---------------------------------------------------------------------------
// REAL completion data. The Inferno achievement is the apex of Elite Redux; a
// read-only scan of the prod system saves (achvUnlocks.INFERNO across all 963
// tracked trainers, 2026-06-30) is the source of truth. Snapshot below - exactly
// three trainers have conquered it. AmberMagnus's erroneous unlock was reset
// (#159) and is correctly absent. TODO(P1): swap for a live worker count endpoint
// once /community exposes achievement tallies; the shape stays identical.
// ---------------------------------------------------------------------------
const INFERNO_TOTAL_TRAINERS = 963; // total tracked system saves at snapshot (the rarity denominator)
const INFERNO_HOLDERS: ReadonlyArray<{ readonly user: string; readonly at: number }> = [
  { user: "GameMan654", at: 1782519557091 },
  { user: "moulas", at: 1782512382373 },
  { user: "BerNerd1499", at: 1782504455588 },
];

/**
 * The live NU pool: every starter root line currently ranked NU (tier 4). Matches
 * the USAGE_TIER(NU) gate the run actually applies (challenge.ts). Empty before the
 * usage-tier feed has loaded (offline harness); populated (~40-50 lines) in-game.
 */
export function getInfernoNuPool(): number[] {
  return Object.keys(speciesStarterCosts)
    .map(Number)
    .filter(id => getErLineTier(id) === NU_TIER_VALUE);
}

/** Highest-BST line in the pool - the strongest mon the player is allowed, used as the card hero. */
function strongestRoot(pool: number[]): number | undefined {
  let best: number | undefined;
  let bestBst = -1;
  for (const id of pool) {
    const s = safeSpecies(id);
    if (s && s.baseTotal > bestBst) {
      bestBst = s.baseTotal;
      best = id;
    }
  }
  return best;
}

function safeSpecies(id: number) {
  try {
    return getPokemonSpecies(id);
  } catch {
    return null; // unknown id - skip
  }
}

/**
 * Derive the human RULES list from the difficulty + base challenges, so the card
 * text tracks the real ruleset rather than being hand-authored.
 */
function deriveInfernoRules(config: CommunityChallengeConfig): CommunityChallengeRule[] {
  const rules: CommunityChallengeRule[] = [];
  if (config.difficulty === "hell") {
    rules.push({ text: "Hell difficulty: maximum enemy scaling." });
  }
  for (const [id, value] of config.baseChallenges) {
    switch (id) {
      case Challenges.USAGE_TIER:
        if (value === NU_TIER_VALUE) {
          rules.push({ text: "NU usage tier: only the lowest-usage lines are legal." });
        }
        break;
      case Challenges.DOUBLES_ONLY:
        rules.push({ text: "Double Battles only." });
        break;
      case Challenges.GHOST_TRAINERS:
        rules.push({ text: "Ghost trainers haunt every battle." });
        break;
      default:
        break;
    }
  }
  rules.push({ text: "Clear it to earn a one-of-a-kind Black Shiny." });
  return rules;
}

/** Build the single real Inferno entry (live NU pool + real completion count). */
export function buildInfernoEntry(): CommunityChallengeEntry {
  const pool = getInfernoNuPool();
  const hero = strongestRoot(pool) ?? INFERNO_FALLBACK_HERO;

  const config: CommunityChallengeConfig = {
    schemaVersion: COMMUNITY_CHALLENGE_SCHEMA_VERSION,
    id: "er-inferno",
    name: "Inferno",
    subtitle: "The Apex Trial",
    description:
      "The hardest stacked challenge in Pokerogue Redux. Conquer Hell difficulty using only the weakest, "
      + "lowest-usage Pokemon, in Double Battles, hunted by Ghost trainers at every turn. Survivors are "
      + "crowned with a one-of-a-kind Black Shiny.",
    author: "Heraklines",
    gameModeId: GameModes.CHALLENGE,
    difficulty: "hell",
    difficultyTier: 5,
    baseChallenges: INFERNO_BASE_CHALLENGES,
    allowedSpecies: null, // gated dynamically by the USAGE_TIER challenge, not a fixed whitelist
    restrictions: {},
    targetWave: 200,
    tags: ["APEX", "HELL", "NU", "DOUBLES", "GHOSTS"],
    art: { accentType: PokemonType.FIRE, themeSpeciesId: hero },
  };

  const byOldest = [...INFERNO_HOLDERS].sort((a, b) => a.at - b.at);
  const byNewest = [...INFERNO_HOLDERS].sort((a, b) => b.at - a.at);
  const stats: CommunityChallengeStats = {
    // attempts = the whole tracked population, so the clear rate reads as the real
    // rarity (3 / 963 ~ 0.3%); cleared = the real holder count.
    attempts: INFERNO_TOTAL_TRAINERS,
    cleared: INFERNO_HOLDERS.length,
    inProgress: 0,
    failed: 0,
    firstClearUser: byOldest[0]?.user,
    recent: byNewest.map(h => ({ user: h.user, at: h.at })),
  };

  return {
    config,
    stats,
    rules: deriveInfernoRules(config),
    allowedPreview: pool.slice(0, ALLOWED_PREVIEW_LEN),
    allowedCount: pool.length,
  };
}

/** Single-card feed containing only the real Inferno challenge. */
export function buildInfernoFeed(): CommunityChallengeFeed {
  const inferno = buildInfernoEntry();
  return { featured: [inferno], selected: inferno, totalCount: 1 };
}
