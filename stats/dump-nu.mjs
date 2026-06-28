/* Dump the FULL M5cap NU list (de-confounded performance + usage cap) for review. */
import fs from "node:fs";

const dex = JSON.parse(fs.readFileSync(new URL("data/dex.json", import.meta.url), "utf8"));
const runsRaw = JSON.parse(fs.readFileSync(new URL("data/_runs.json", import.meta.url), "utf8"))[0].results;
const byId = new Map(dex.filter(m => typeof m.id === "number").map(m => [m.id, m]));
const CAP = 8;
const K = 20;

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
  const u = [...new Set(st.filter(x => typeof x === "number"))];
  if (u.length > 0) {
    runs.push({ uid: r.user_id, lines: u, win: r.outcome === "victory" ? 1 : 0, wave: r.wave ?? 0 });
  }
}
const P = new Map();
for (const r of runs) {
  let p = P.get(r.uid);
  if (!p) {
    p = { n: 0, w: 0, wv: 0, wn: 0 };
    P.set(r.uid, p);
  }
  p.n++;
  p.w += r.win;
  if (r.wave <= 200) {
    p.wv += r.wave;
    p.wn++;
  }
}
for (const [, p] of P) {
  p.winRate = p.w / p.n;
  p.avgWave = p.wn ? p.wv / p.wn : 0;
}
const tot = P.size;
const L = new Map();
for (const r of runs) {
  const p = P.get(r.uid);
  for (const id of r.lines) {
    if (!byId.has(id)) {
      continue;
    }
    let o = L.get(id);
    if (!o) {
      o = { runs: 0, wins: 0, wvSum: 0, wvN: 0, players: new Set(), wl: 0, vl: 0, vln: 0 };
      L.set(id, o);
    }
    o.runs++;
    o.wins += r.win;
    o.players.add(r.uid);
    o.wl += r.win - p.winRate;
    if (r.wave <= 200) {
      o.wvSum += r.wave;
      o.wvN++;
      o.vl += r.wave - p.avgWave;
      o.vln++;
    }
  }
}
const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const isCommon = e => !(e === 1 || e === 2 || e === 3);
const rows = [];
for (const [id, o] of L) {
  const m = byId.get(id);
  rows.push({
    id,
    name: m.name,
    bst: m.bst,
    types: m.types,
    common: isCommon(m.eggTier ?? 0),
    usage: (100 * o.players.size) / tot,
    win: (100 * o.wins) / o.runs,
    wave: o.wvN ? o.wvSum / o.wvN : 0,
    n: o.runs,
    winLift: (o.wl / (o.runs + K)) * 100,
    waveLift: o.vln ? o.vl / (o.vln + K) : 0,
  });
}
const com = rows.filter(r => r.common);
const rank = key => {
  const s = [...com].sort((a, b) => a[key] - b[key]);
  const m = new Map();
  s.forEach((r, i) => m.set(r.id, i / (s.length - 1 || 1)));
  return m;
};
const rW = rank("winLift");
const rV = rank("waveLift");
for (const r of com) {
  r._p = 0.5 * rW.get(r.id) + 0.5 * rV.get(r.id);
}
const perfTier = p => (p >= 0.92 ? 0 : p >= 0.8 ? 1 : p >= 0.6 ? 2 : p >= 0.35 ? 3 : 4);
const NU_MIN_SAMPLE = 10;
const baseWin = runs.length ? (100 * runs.reduce((s, r) => s + r.win, 0)) / runs.length : 6.3;
for (const r of com) {
  let t = perfTier(r._p);
  if (t >= 3 && r.usage > CAP) {
    t = 2; // usage cap
  }
  if (t === 4 && (r.win > baseWin || r.n < NU_MIN_SAMPLE)) {
    t = 3; // NU only for below-average raw winners with enough evidence.
  }
  r.tier = TIERS[t];
}

const nu = com.filter(r => r.tier === "NU").sort((a, b) => b.bst - a.bst);
console.log(`M5cap NU = ${nu.length} lines (common-egg only), sorted by BST desc. baseline win ${baseWin.toFixed(1)}%, avg wave 41.\n`);
console.log("  " + "name".padEnd(16) + "BST  type             use%  win%  winLift waveLift wave  n");
for (const r of nu) {
  const ty = (r.types || []).filter(Boolean).join("/");
  console.log(
    "  "
      + r.name.padEnd(16)
      + String(r.bst).padEnd(5)
      + ty.padEnd(17)
      + r.usage.toFixed(1).padStart(4)
      + r.win.toFixed(1).padStart(6)
      + ((r.winLift >= 0 ? "+" : "") + r.winLift.toFixed(1)).padStart(8)
      + ((r.waveLift >= 0 ? "+" : "") + r.waveLift.toFixed(1)).padStart(9)
      + String(Math.round(r.wave)).padStart(6)
      + String(r.n).padStart(4),
  );
}
