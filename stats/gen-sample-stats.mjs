/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// SAMPLE stats generator for the "Pokédex & Usage" SPA. Reads stats/data/dex.json
// and writes stats/data/stats.sample.json — DETERMINISTIC, plausible placeholder
// metrics keyed by sprite slug, seeded from each species' numeric id so the same
// dex always yields the same numbers.
//
// 🔴 THESE ARE NOT REAL STATS. The real per-species win/pick/usage feed comes
// from the `runs` D1 table via the nightly cron (a future species-stats.json of
// the SAME SHAPE); swapping that in is a one-line URL change in stats/app.js.
//
// Run (after regenerating dex.json):
//   node stats/gen-sample-stats.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEX_PATH = join(HERE, "data", "dex.json");
const OUT_PATH = join(HERE, "data", "stats.sample.json");

// ---- Seeded PRNG (mulberry32) — stable per-species from the numeric id. ------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Tier weights — most mons land in RU/PU/NU, very few reach OU (matches a real
// competitive ladder shape). The roll is BST-biased: stronger mons skew up.
const TIERS = ["OU", "UU", "RU", "PU", "NU"];

/** Pick a tier from a BST-biased roll: high BST shifts the distribution upward. */
function pickTier(rng, bst) {
  // bias 0..1: ~0 around BST 300, ~1 around BST 700.
  const bias = clamp((bst - 300) / 400, 0, 1);
  // Base cumulative weights heavily favouring the low tiers, nudged by bias.
  const r = rng() * 0.78 + bias * 0.22; // 0..1, shifted up for strong mons
  if (r > 0.955) {
    return "OU";
  }
  if (r > 0.85) {
    return "UU";
  }
  if (r > 0.6) {
    return "RU";
  }
  if (r > 0.3) {
    return "PU";
  }
  return "NU";
}

/** A plausible usage% for a tier (OU highest), jittered per-species. */
function usageForTier(rng, tier) {
  const base = { OU: 3.5, UU: 1.6, RU: 0.72, PU: 0.36, NU: 0.14 }[tier];
  const spread = { OU: 2.6, UU: 0.6, RU: 0.27, PU: 0.13, NU: 0.1 }[tier];
  return round2(clamp(base + (rng() - 0.4) * spread, 0.03, 9.5));
}

// ---- Build ------------------------------------------------------------------
const dex = JSON.parse(readFileSync(DEX_PATH, "utf8"));

// Teammate pool: only entries with a sprite slug (so the chip renders) — fall
// back to all entries if too few have slugs.
const teammatePool = dex.filter(d => d.slug).length >= 50 ? dex.filter(d => d.slug) : dex;

const out = {};
for (const mon of dex) {
  const rng = mulberry32(mon.id * 2654435761);
  const bst = mon.bst || 400;
  // bstNorm: 0 around 300 BST, 1 around 700 BST — drives win/usage skew.
  const bstNorm = clamp((bst - 300) / 400, 0, 1);

  const tier = pickTier(rng, bst);
  const usagePct = usageForTier(rng, tier);
  // Pick% (share of teams that drafted it when offered) tracks usage but higher.
  const pickPct = round2(clamp(usagePct * (1.6 + rng() * 1.2) + bstNorm * 4, 0.2, 38));

  // Win rate: centered ~50, pushed up by BST, with per-difficulty drift (harder
  // difficulties win less). Deterministic jitter keeps mons distinct.
  const baseWin = 46 + bstNorm * 14 + (rng() - 0.5) * 10;
  const winPct = {
    all: round1(clamp(baseWin, 22, 82)),
    ace: round1(clamp(baseWin + 6 + (rng() - 0.5) * 4, 24, 90)),
    elite: round1(clamp(baseWin - 1 + (rng() - 0.5) * 5, 18, 84)),
    hell: round1(clamp(baseWin - 9 + (rng() - 0.5) * 6, 10, 76)),
  };

  // Lift: performance vs the stratum baseline (percentage points), -15..+20,
  // correlated with BST so strong mons over-perform.
  const lift = round1(clamp((bstNorm - 0.45) * 26 + (rng() - 0.5) * 10, -15, 20));

  // Average wave reached when this mon was on the team (20..180), BST-skewed.
  const avgWave = Math.round(clamp(40 + bstNorm * 95 + (rng() - 0.5) * 50, 20, 180));

  // Sample size (player-picks behind the numbers), 50..5000, more for popular.
  const sample = Math.round(clamp(60 + usagePct * 480 + rng() * 900, 50, 5000));

  // Top abilities — drawn from THIS mon's own abilities, descending share.
  const monAbils = mon.abilities.length > 0 ? mon.abilities : ["Unknown"];
  const abilShares = [52, 31, 17].map(p => clamp(p + (rng() - 0.5) * 8, 4, 70));
  const topAbilities = monAbils.slice(0, 3).map((name, i) => ({ name, pct: round1(abilShares[i] ?? 6) }));

  // Top moves / items — plausible labels (placeholder names; clearly SAMPLE).
  const MOVE_POOL = [
    "Protect",
    "Substitute",
    "Earthquake",
    "Stealth Rock",
    "U-turn",
    "Knock Off",
    "Roost",
    "Swords Dance",
    "Calm Mind",
    "Recover",
    "Flamethrower",
    "Ice Beam",
    "Thunderbolt",
    "Shadow Ball",
    "Close Combat",
    "Dragon Dance",
    "Toxic",
    "Will-O-Wisp",
    "Volt Switch",
    "Scald",
    "Moonblast",
    "Nasty Plot",
    "Sludge Bomb",
    "Spikes",
  ];
  const ITEM_POOL = [
    "Leftovers",
    "Choice Scarf",
    "Choice Band",
    "Choice Specs",
    "Life Orb",
    "Focus Sash",
    "Assault Vest",
    "Rocky Helmet",
    "Heavy-Duty Boots",
    "Eviolite",
    "Sitrus Berry",
    "Black Sludge",
  ];
  const pickN = (pool, n, startPct, step) => {
    const used = new Set();
    const res = [];
    let pct = startPct;
    for (let i = 0; i < n; i++) {
      let idx = Math.floor(rng() * pool.length);
      for (let guard = 0; guard < pool.length && used.has(idx); guard++) {
        idx = (idx + 1) % pool.length;
      }
      used.add(idx);
      res.push({ name: pool[idx], pct: round1(clamp(pct + (rng() - 0.5) * step, 2, 80)) });
      pct = Math.max(4, pct - step - rng() * step * 0.5);
    }
    return res;
  };
  const topMoves = pickN(MOVE_POOL, 4, 44, 12);
  const topItems = pickN(ITEM_POOL, 3, 40, 14);

  // Top teammates — 5 other dex entries (with sprites), descending share.
  const teammates = [];
  const usedIds = new Set([mon.id]);
  let tmPct = 26;
  for (let i = 0; i < 5 && teammates.length < 5; i++) {
    let pick = null;
    for (let guard = 0; guard < 40; guard++) {
      const cand = teammatePool[Math.floor(rng() * teammatePool.length)];
      if (cand && !usedIds.has(cand.id)) {
        pick = cand;
        break;
      }
    }
    if (!pick) {
      break;
    }
    usedIds.add(pick.id);
    teammates.push({ slug: pick.slug, name: pick.name, pct: round1(clamp(tmPct + (rng() - 0.5) * 8, 3, 40)) });
    tmPct = Math.max(4, tmPct - 4 - rng() * 3);
  }

  const key = mon.slug || `id-${mon.id}`;
  out[key] = {
    id: mon.id,
    tier,
    usagePct,
    pickPct,
    winPct,
    lift,
    avgWave,
    sample,
    topAbilities,
    topMoves,
    topItems,
    topTeammates: teammates,
  };
}

// Stamp the file so the UI can clearly label it SAMPLE.
const payload = {
  _sample: true,
  _note:
    "SAMPLE placeholder stats — deterministic per species id, NOT real run data. "
    + "Real win/pick/usage will come from the runs D1 table via the nightly cron "
    + "(a species-stats.json of the same shape).",
  generatedAt: new Date().toISOString().slice(0, 10),
  species: out,
};
writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

const tierCounts = {};
for (const v of Object.values(out)) {
  tierCounts[v.tier] = (tierCounts[v.tier] || 0) + 1;
}
console.log(
  `WROTE ${OUT_PATH}: ${Object.keys(out).length} species. Tier spread: ${TIERS.map(t => `${t} ${tierCounts[t] || 0}`).join(", ")}`,
);
