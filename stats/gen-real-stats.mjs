/*
 * Build stats/data/species-stats.json from a REAL prod run dump (stats/data/_runs.json,
 * read-only export of the er-saves `runs` table). Mirrors the nightly cron's
 * starter-line signal (computeAndPublishUsageTiers in workers/er-save-api) and adds
 * the headline numbers the page shows: pick rate, win rate (overall + per difficulty),
 * win-rate lift vs the average pick, average wave reached, sample size, and common
 * teammates. Keyed by dex slug (mapped from starter-line id via dex.json `id`).
 *
 * Held items and per-species top moves/abilities are NOT derived here: held items
 * aren't captured in the run snapshot, and attributing an evolved team member back to
 * one starter line needs the evolution graph (a cron-side follow-up). Those insight
 * lists are left empty so the page shows "no data" rather than a placeholder.
 *
 *   node stats/gen-real-stats.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const DIR = new URL("./data/", import.meta.url);
const runs = JSON.parse(readFileSync(new URL("_runs.json", DIR), "utf8"))[0].results;
const dex = JSON.parse(readFileSync(new URL("dex.json", DIR), "utf8"));

// starter-line id -> dex entry (the line root that appears in the grid).
const byId = new Map();
for (const m of dex) {
  if (typeof m.id === "number") {
    byId.set(m.id, m);
  }
}

const SHOWN_DIFFS = ["ace", "elite", "hell"]; // page's per-difficulty toggle
const round1 = n => Math.round(n * 10) / 10;
const round2 = n => Math.round(n * 100) / 100;

// Tier exactly as the game/editor computes it: usage band floored by egg tier.
const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const usageBand = p => (p >= 2.25 ? 0 : p >= 1 ? 1 : p >= 0.5 ? 2 : p >= 0.25 ? 3 : 4);
const eggBand = e => (e === 3 ? 0 : e === 2 ? 1 : e === 1 ? 2 : 4);
const tierFor = (p, e) => TIERS[Math.min(usageBand(p), eggBand(e))];

const players = new Set(); // all distinct accounts (usagePct denominator)
let totalRuns = 0;
let totalWins = 0;
const L = new Map(); // lineId -> aggregate

function line(id) {
  let o = L.get(id);
  if (!o) {
    o = {
      runs: 0,
      wins: 0,
      waveSum: 0,
      waveCount: 0, // only classic/challenge waves (<= 200); endless excluded so it doesn't skew avg wave
      players: new Set(),
      diff: {}, // diff -> {runs, wins}
      mates: new Map(), // otherLineId -> co-occurrence count
    };
    L.set(id, o);
  }
  return o;
}

let unmappedLineHits = 0;
const unmappedIds = new Set();

for (const r of runs) {
  let starters;
  try {
    starters = JSON.parse(r.starters);
  } catch {
    continue;
  }
  if (!Array.isArray(starters) || starters.length === 0) {
    continue;
  }
  const uniq = [...new Set(starters.filter(x => typeof x === "number"))];
  if (uniq.length === 0) {
    continue;
  }
  const win = r.outcome === "victory";
  const diff = r.difficulty ?? "unknown";
  const wave = r.wave ?? 0;
  totalRuns++;
  if (win) {
    totalWins++;
  }
  players.add(r.user_id);
  for (const id of uniq) {
    if (!byId.has(id)) {
      unmappedLineHits++;
      unmappedIds.add(id);
      // Still allow it as a teammate-of-others? No - we can't display it. Skip.
      continue;
    }
    const o = line(id);
    o.runs++;
    // Avg wave only counts classic/challenge progress; endless runs (wave > 200)
    // would skew it massively (a single wave-9999 run), so they're excluded here.
    if (wave <= 200) {
      o.waveSum += wave;
      o.waveCount++;
    }
    o.players.add(r.user_id);
    if (win) {
      o.wins++;
    }
    const d = (o.diff[diff] ??= { runs: 0, wins: 0 });
    d.runs++;
    if (win) {
      d.wins++;
    }
    for (const other of uniq) {
      if (other !== id && byId.has(other)) {
        o.mates.set(other, (o.mates.get(other) ?? 0) + 1);
      }
    }
  }
}

const baselineWin = totalRuns > 0 ? (100 * totalWins) / totalRuns : 0;

const species = {};
let maxWin = 0;
for (const [id, o] of L) {
  const mon = byId.get(id);
  const winAll = o.runs > 0 ? (100 * o.wins) / o.runs : 0;
  if (o.runs >= 20) {
    maxWin = Math.max(maxWin, winAll);
  }
  const winPct = { all: round1(winAll) };
  for (const d of SHOWN_DIFFS) {
    const dd = o.diff[d];
    winPct[d] = dd && dd.runs > 0 ? round1((100 * dd.wins) / dd.runs) : 0;
  }
  const topTeammates = [...o.mates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([otherId, c]) => {
      const mate = byId.get(otherId);
      return { slug: mate.slug, name: mate.name, pct: round1((100 * c) / o.runs) };
    });
  const usagePctVal = round2((100 * o.players.size) / players.size);
  species[mon.slug] = {
    usagePct: usagePctVal,
    tier: tierFor(usagePctVal, mon.eggTier),
    pickPct: round1((100 * o.runs) / totalRuns),
    winPct,
    lift: round1(winAll - baselineWin),
    avgWave: o.waveCount > 0 ? Math.round(o.waveSum / o.waveCount) : 0,
    sample: o.runs,
    topAbilities: [],
    topMoves: [],
    topItems: [],
    topTeammates,
  };
}

// Color/scale hints so the Win column is legible for a hard roguelike where the
// absolute win rate is low (a few %). winMid ~ the average pick (amber), winMax ~
// the strongest well-sampled pick (full bar / green).
const meta = {
  winMid: round1(baselineWin),
  winMax: Math.max(round1(maxWin), round1(baselineWin * 2), 5),
};

const payload = {
  _sample: false,
  source: "runs",
  generatedAt: new Date().toISOString(),
  totalRuns,
  totalWins,
  players: players.size,
  baselineWin: round2(baselineWin),
  meta,
  species,
};

writeFileSync(new URL("species-stats.json", DIR), JSON.stringify(payload));
console.log(`runs=${totalRuns} wins=${totalWins} players=${players.size} baselineWin=${round2(baselineWin)}%`);
console.log(
  `species with data=${Object.keys(species).length}  unmapped line ids=${unmappedIds.size} (${unmappedLineHits} hits)`,
);
console.log(`win range: mid=${meta.winMid}% max(>=20 samples)=${meta.winMax}%`);
const top = Object.entries(species)
  .filter(([, s]) => s.sample >= 30)
  .sort((a, b) => b[1].lift - a[1].lift)
  .slice(0, 8)
  .map(([slug, s]) => `${slug}(win ${s.winPct.all}% lift ${s.lift} n=${s.sample})`);
console.log("top by lift (n>=30):", top.join(", "));
