# Usage-Tier Challenge System (OU / UU / RU / PU / NU)

Status: DESIGN, awaiting maintainer sign-off. Task #384.

## Goal

A self-balancing, Smogon-style tier ladder computed from REAL run data. Picking
a lower tier in the challenge menu restricts which starters you may choose and
rewards you with Favour (and, at the bottom tiers, a raised Favour cap).

## Tier definitions (from the maintainer spec)

Usage = how often a starter line's BASE FORM is picked in starter select,
as a percentage of all runs in the stats window. Egg gates stack downward.

| Tier | Usage gate (line is LEGAL if below) | Egg-tier gate (starters removed) | Favour | Favour cap |
|------|--------------------------------------|----------------------------------|--------|------------|
| OU+ (default, no challenge) | none (everything) | none | 0 | 3x |
| UU | < 2.25% | legendary-egg lines removed | 3 | 3x |
| RU | < 1% | + epic-egg lines removed | (mid, suggest 8) | 3x |
| PU | < 0.5% | + rare-egg lines removed | 15 | **5x** |
| NU | < 0.25% | common-egg lines ONLY | 20 | **5x** |

Notes:
- The maintainer named 4.5% as the OU threshold; anything >= 4.5% usage is
  "OU material" and is therefore excluded from every restricted tier.
- PU and NU raise the 3x shiny-Favour cap (er-shiny-favour.ts
  FAVOUR_SHINY_MAX_MULT) to 5x for the run.
- RU favour was not specified; 8 keeps the 3/8/15/20 curve monotonic. CONFIRM.

## Data pipeline (Cloudflare-quota safe)

The whole point: tiers come from run stats WITHOUT per-request D1 queries.

1. **Capture (already mostly exists).** The save worker already records runs
   (the ghost pool). Extend the run row with: starter root-species ids, the
   game mode (vanilla/challenge + which challenges), difficulty, outcome.
   This is one INSERT per run END - no new request load.
2. **Aggregate nightly (Worker cron).** A scheduled Worker (cron trigger,
   1/day) runs ONE aggregation query over the last N=30 days of runs and
   writes a single static JSON artifact:
   `usage-tiers.json` = { generatedAt, window, lines: { [rootSpeciesId]:
   { usagePct, winPct, tier } } }.
   Storage: KV (cheap, cacheable) or commit to er-assets via the GitHub API
   (zero CF storage, jsDelivr-cached like sprites). RECOMMEND er-assets:
   the client already loads pinned assets from there and it is free.
3. **Client.** The game fetches usage-tiers.json once at boot (cached by
   jsDelivr/browser). The Usage Tier challenge filters the starter grid by
   the chosen tier's usage gate + egg gates (egg gates computed locally from
   speciesEggTiers - no data dependency).

## Anti-skew weighting (challenge-mode bias)

Problem: challenge grinders inflate the usage of strong "challenge staples",
pushing them into OU even though normal players rarely pick them.

Approach:
- Compute usage per BUCKET: bucket A = non-challenge runs, bucket B =
  challenge runs (any modifier active). Weight buckets by their POPULATION
  SHARE OF PLAYERS (distinct accounts), not run count, so one grinder
  spamming 200 challenge runs counts like one player.
  usagePct(line) = wA * usageA + wB * usageB, where wA/wB = share of distinct
  players whose runs are mostly in that bucket.
- Tier-internal rebalancing for outliers: after the base tiering by usage,
  apply win-rate nudges INSIDE the restricted tiers:
  - winPct(line in tier) > tierMeanWin + 2 sigma for 2 consecutive windows
    -> promote one tier (it is too strong for the tier).
  - winPct < tierMeanWin - 2 sigma AND usage near zero -> demote one tier.
  Promotions/demotions move at most ONE tier per window so the ladder is
  stable and players can follow it.
- Usage-tier-challenge runs themselves are EXCLUDED from the usage stats
  (they are forced picks within a restricted pool; counting them would
  recursively skew the very tier they were played in). Their WIN rates are
  what feed the outlier nudges above.

## Client implementation sketch

- New challenge `USAGE_TIER` (value 0=Off, 1=UU, 2=RU, 3=PU, 4=NU).
- Starter select: when active, `starterSelectFilter` removes lines whose
  usagePct >= the tier gate, plus the egg-tier gates (speciesEggTiers on the
  root species), plus legendaries for UU+ down.
- Favour: er-shiny-favour FAVOUR_BY_CHALLENGE tiered like LIMITED_SUPPORT;
  PU/NU also lift FAVOUR_SHINY_MAX_MULT to 5 for the run.
- Fallback: if usage-tiers.json is unavailable, the challenge is greyed out
  ("tier data unavailable") - never guess.

## Open questions for the maintainer

1. RU favour = 8? (3/8/15/20 curve.)
2. Window: 30 days rolling? Update cadence: nightly?
3. Should UU..NU also exclude the BLACK-shiny-unlocked starters or only by
   usage/egg tier? (Current design: only usage + egg tier.)
4. Minimum sample size before a line can be tiered at all (suggest: lines
   with < 20 picks in the window default to the LOWEST tier, they are
   unpicked by definition)?
