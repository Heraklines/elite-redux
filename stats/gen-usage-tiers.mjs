/*
 * Seed/regenerate er-assets/usage-tiers.json in the EXACT format the worker cron
 * publishes (computeAndPublishUsageTiers in workers/er-save-api/src/index.ts), from a
 * fresh prod runs dump (stats/data/_runs.json). Lets the new M5cap data go live
 * immediately instead of waiting for the nightly cron. Output path is argv[2].
 *   node stats/gen-usage-tiers.mjs ../er-assets/usage-tiers.json
 */
import fs from "node:fs";

const OUT = process.argv[2] || "stats/data/usage-tiers.json";
const USAGE_TIER_CHALLENGE_ID = 12;
const K = 20;
const MIN_PLAYERS = Number(process.env.ER_USAGE_TIER_MIN_PLAYERS ?? 500);
const MIN_RUNS = Number(process.env.ER_USAGE_TIER_MIN_RUNS ?? 5000);
const runsRaw = JSON.parse(fs.readFileSync(new URL("data/_runs.json", import.meta.url), "utf8"))[0].results;

const runs = [];
for (const row of runsRaw) {
  let starters;
  let challenges = [];
  try {
    starters = JSON.parse(row.starters);
    challenges = row.challenges ? JSON.parse(row.challenges) : [];
  } catch {
    continue;
  }
  if (!Array.isArray(starters) || starters.length === 0) {
    continue;
  }
  const lines = [...new Set(starters.filter(x => typeof x === "number"))];
  if (lines.length === 0) {
    continue;
  }
  runs.push({
    uid: row.user_id,
    lines,
    inUsageTier: challenges.some(([cid, v]) => cid === USAGE_TIER_CHALLENGE_ID && v > 0),
    win: row.outcome === "victory" ? 1 : 0,
    wave: row.wave ?? 0,
  });
}
const players = new Map();
for (const r of runs) {
  let p = players.get(r.uid);
  if (!p) {
    p = { n: 0, winSum: 0, waveSum: 0, waveN: 0 };
    players.set(r.uid, p);
  }
  p.n++;
  p.winSum += r.win;
  if (r.wave <= 200) {
    p.waveSum += r.wave;
    p.waveN++;
  }
}
if (players.size < MIN_PLAYERS || runs.length < MIN_RUNS) {
  throw new Error(
    `Refusing to generate usage tiers from too-small sample: players=${players.size}/${MIN_PLAYERS}, runs=${runs.length}/${MIN_RUNS}`,
  );
}
let gWinSum = 0;
let gWaveSum = 0;
let gWaveN = 0;
for (const r of runs) {
  gWinSum += r.win;
  if (r.wave <= 200) {
    gWaveSum += r.wave;
    gWaveN++;
  }
}

const agg = new Map();
for (const r of runs) {
  const p = players.get(r.uid);
  const pWin = p.winSum / p.n;
  const pWave = p.waveN ? p.waveSum / p.waveN : 0;
  for (const line of r.lines) {
    let o = agg.get(line);
    if (!o) {
      o = { usagePlayers: new Set(), runs: 0, wins: 0, waveSum: 0, waveN: 0, winLift: 0, waveLift: 0, waveLiftN: 0 };
      agg.set(line, o);
    }
    if (!r.inUsageTier) {
      o.usagePlayers.add(r.uid);
    }
    o.runs++;
    o.wins += r.win;
    o.winLift += r.win - pWin;
    if (r.wave <= 200) {
      o.waveSum += r.wave;
      o.waveN++;
      o.waveLift += r.wave - pWave;
      o.waveLiftN++;
    }
  }
}
const r2 = n => Math.round(n * 100) / 100;
const lines = {};
for (const [line, o] of agg) {
  lines[line] = {
    usagePct: Math.round((100 * o.usagePlayers.size * 1000) / players.size) / 1000,
    win: Math.round((1000 * o.wins) / o.runs) / 10,
    wave: o.waveN ? Math.round(o.waveSum / o.waveN) : 0,
    winLift: r2((o.winLift / (o.runs + K)) * 100),
    waveLift: r2(o.waveLiftN ? o.waveLift / (o.waveLiftN + K) : 0),
    sample: o.runs,
  };
}
const payload = {
  generatedAt: new Date().toISOString(),
  windowDays: 30,
  players: players.size,
  runs: runs.length,
  source: {
    generatedBy: "stats/gen-usage-tiers.mjs",
    publisher: "prod-d1-dump",
  },
  baseWinPct: r2((100 * gWinSum) / runs.length),
  globalWave: gWaveN ? Math.round((10 * gWaveSum) / gWaveN) / 10 : 0,
  lines,
};
fs.writeFileSync(OUT, JSON.stringify(payload, null, 1));
console.log(
  `wrote ${OUT}: ${Object.keys(lines).length} lines, players=${payload.players} runs=${payload.runs} baseWinPct=${payload.baseWinPct}% globalWave=${payload.globalWave}`,
);
