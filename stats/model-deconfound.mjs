/*
 * OFFLINE — de-confound the performance tier for player skill. Two variants vs plain M4:
 *   M4   = raw win + wave blend (skill-confounded).
 *   M4cap= M4 but usage>CAP can't be NU/PU (cheap proxy: popular mons aren't "weak").
 *   M5   = SKILL-ADJUSTED: each run scored as (run result - that player's OWN average),
 *          so a starter piloted by beginners is judged vs those beginners, not the field.
 *   node stats/model-deconfound.mjs
 */
import fs from "node:fs";

const dex = JSON.parse(fs.readFileSync("stats/data/dex.json", "utf8"));
const runsRaw = JSON.parse(fs.readFileSync("stats/data/_runs.json", "utf8"))[0].results;
const byId = new Map(dex.filter(m => typeof m.id === "number").map(m => [m.id, m]));
const CAP = 8; // usage% cap (excludes popular starters from the bottom tiers; keeps Sunkern/Magikarp/Feebas)

const runs = [];
for (const r of runsRaw) {
  let st;
  try {
    st = JSON.parse(r.starters);
  } catch {
    continue;
  }
  if (!Array.isArray(st) || st.length === 0) {
    continue;
  }
  const uniq = [...new Set(st.filter(x => typeof x === "number"))];
  if (uniq.length > 0) {
    runs.push({ uid: r.user_id, lines: uniq, win: r.outcome === "victory" ? 1 : 0, wave: r.wave ?? 0 });
  }
}
// pass 1: per-player baselines
const P = new Map();
for (const r of runs) {
  let p = P.get(r.uid);
  if (!p) {
    p = { n: 0, winSum: 0, waveSum: 0, waveN: 0 };
    P.set(r.uid, p);
  }
  p.n++;
  p.winSum += r.win;
  if (r.wave <= 200) {
    p.waveSum += r.wave;
    p.waveN++;
  }
}
for (const [, p] of P) {
  p.winRate = p.winSum / p.n;
  p.avgWave = p.waveN ? p.waveSum / p.waveN : 0;
}
const totalPlayers = P.size;
let gWin = 0;
let gN = 0;
let gWave = 0;
let gWaveN = 0;
for (const r of runs) {
  gWin += r.win;
  gN++;
  if (r.wave <= 200) {
    gWave += r.wave;
    gWaveN++;
  }
}
const baseWin = (100 * gWin) / gN;
const globalWave = gWave / gWaveN;
// pass 2: per-line aggregate (raw + skill-adjusted)
const Lm = new Map();
for (const r of runs) {
  const p = P.get(r.uid);
  for (const id of r.lines) {
    if (!byId.has(id)) {
      continue;
    }
    let o = Lm.get(id);
    if (!o) {
      o = { runs: 0, wins: 0, waveSum: 0, waveN: 0, players: new Set(), winLift: 0, waveLift: 0, waveLiftN: 0 };
      Lm.set(id, o);
    }
    o.runs++;
    o.wins += r.win;
    o.players.add(r.uid);
    o.winLift += r.win - p.winRate;
    if (r.wave <= 200) {
      o.waveSum += r.wave;
      o.waveN++;
      o.waveLift += r.wave - p.avgWave;
      o.waveLiftN++;
    }
  }
}
const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const ti = t => TIERS.indexOf(t);
const eggBand = e => (e === 3 ? 0 : e === 2 ? 1 : e === 1 ? 2 : 4);
const isCommon = e => eggBand(e) === 4;
const usageBand = p => (p >= 2.25 ? 0 : p >= 1 ? 1 : p >= 0.5 ? 2 : p >= 0.25 ? 3 : 4);
const K = 20;
const rows = [];
for (const [id, o] of Lm) {
  const m = byId.get(id);
  rows.push({
    id,
    name: m.name,
    egg: m.eggTier ?? 0,
    common: isCommon(m.eggTier ?? 0),
    usage: (100 * o.players.size) / totalPlayers,
    win: (100 * o.wins) / o.runs,
    wave: o.waveN ? o.waveSum / o.waveN : 0,
    n: o.runs,
    sWin: (((100 * o.wins) / o.runs) * o.runs + K * baseWin) / (o.runs + K),
    sWave: ((o.waveN ? o.waveSum / o.waveN : 0) * o.waveN + K * globalWave) / (o.waveN + K),
    winLift: (o.winLift / (o.runs + K)) * 100, // skill-adjusted, shrunk toward 0
    waveLift: o.waveLiftN ? o.waveLift / (o.waveLiftN + K) : 0,
  });
}
const com = rows.filter(r => r.common);
const rankOf = key => {
  const s = [...com].sort((a, b) => a[key] - b[key]);
  const map = new Map();
  s.forEach((r, i) => map.set(r, i / (s.length - 1 || 1)));
  return map;
};
const blend = (ka, kb) => {
  const ra = rankOf(ka);
  const rb = rankOf(kb);
  for (const r of com) {
    r._p = 0.5 * ra.get(r) + 0.5 * rb.get(r);
  }
};
const perfTier = p => (p >= 0.92 ? 0 : p >= 0.8 ? 1 : p >= 0.6 ? 2 : p >= 0.35 ? 3 : 4);

for (const r of rows) {
  r.m0 = TIERS[Math.min(usageBand(r.usage), eggBand(r.egg))];
}
blend("sWin", "sWave");
for (const r of rows) {
  r.m4 = r.common ? TIERS[perfTier(r._p)] : r.m0;
}
for (const r of rows) {
  let t = r.m4;
  if (r.common && r.usage > CAP && ti(t) >= 3) {
    t = "RU";
  }
  r.m4cap = t;
}
blend("winLift", "waveLift");
for (const r of rows) {
  r.m5 = r.common ? TIERS[perfTier(r._p)] : r.m0;
}
for (const r of rows) {
  let t = r.m5;
  if (r.common && r.usage > CAP && ti(t) >= 3) {
    t = "RU";
  }
  if (r.common && t === "NU" && (r.win > baseWin || r.n < 10)) {
    t = "PU";
  }
  r.m5cap = t;
}

const count = key => {
  const c = { OU: 0, UU: 0, RU: 0, PU: 0, NU: 0 };
  for (const r of rows) {
    c[r[key]]++;
  }
  return c;
};
const nuStats = key => {
  const nu = rows.filter(r => r[key] === "NU");
  return `${nu.length}  (avgWin ${(nu.reduce((s, r) => s + r.win, 0) / nu.length).toFixed(1)}%  avgUse ${(nu.reduce((s, r) => s + r.usage, 0) / nu.length).toFixed(1)}%  avgWave ${Math.round(nu.reduce((s, r) => s + r.wave, 0) / nu.length)})`;
};
console.log(
  `runs=${runs.length} players=${totalPlayers} baseWin=${baseWin.toFixed(2)}% globalWave=${globalWave.toFixed(1)} | CAP=${CAP}% K=${K}`,
);
for (const k of ["m0", "m4", "m4cap", "m5", "m5cap"]) {
  console.log(`${k.padEnd(6)} tiers ${JSON.stringify(count(k))}   NU=${nuStats(k)}`);
}

const diff = (a, b) => rows.filter(r => r[a] !== r[b]).length;
console.log(
  `\nchanged vs current(m0):  M4=${diff("m0", "m4")}  M4cap=${diff("m0", "m4cap")}  M5=${diff("m0", "m5")}  M5cap=${diff("m0", "m5cap")}   |  M4->M5 moved: ${diff("m4", "m5")}`,
);

const spot = [
  "Fennekin",
  "Piplup",
  "Fuecoco",
  "Grookey",
  "Scorbunny",
  "Chespin",
  "Totodile",
  "Torchic",
  "Magikarp",
  "Sunkern",
  "Feebas",
];
console.log("\nSTARTER / confound spotlight (raw win vs skill-adjusted winLift):");
console.log("  name            usage   rawWin  winLift  rawWave waveLift  M0   M4   M4cap M5   M5cap");
for (const nm of spot) {
  const r = rows.find(r => r.name === nm);
  if (!r) {
    continue;
  }
  console.log(
    `  ${nm.padEnd(15)} ${r.usage.toFixed(1).padStart(5)}%  ${r.win.toFixed(1).padStart(5)}%  ${(r.winLift >= 0 ? "+" : "") + r.winLift.toFixed(1)}   ${String(Math.round(r.wave)).padStart(4)}    ${(r.waveLift >= 0 ? "+" : "") + r.waveLift.toFixed(1)}    ${r.m0.padEnd(4)} ${r.m4.padEnd(4)} ${r.m4cap.padEnd(5)} ${r.m5.padEnd(4)} ${r.m5cap}`,
  );
}
const m5nu = rows
  .filter(r => r.m5cap === "NU" && r.n >= 15)
  .sort((a, b) => a._p - b._p)
  .slice(0, 24);
console.log("\nM5cap (de-confounded + usage cap) NU sample (n>=15, weakest first):");
for (const r of m5nu) {
  console.log(
    `  ${r.name.padEnd(15)} use=${r.usage.toFixed(2)}% win=${r.win.toFixed(1)}% winLift=${(r.winLift >= 0 ? "+" : "") + r.winLift.toFixed(1)} waveLift=${(r.waveLift >= 0 ? "+" : "") + r.waveLift.toFixed(1)} n=${r.n}`,
  );
}
