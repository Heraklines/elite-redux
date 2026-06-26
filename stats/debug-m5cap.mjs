// Reproduce the deployed app.js computeM5capTiers + applyRealUsage EXACTLY, to see
// what tier each DEX mon ends up with (and why the site shows ~3 NU).
import fs from "node:fs";

const D = new URL("data/", import.meta.url);
const ut = JSON.parse(fs.readFileSync(new URL("usage-tiers.json", D), "utf8"));
const DEX = JSON.parse(fs.readFileSync(new URL("dex.json", D), "utf8"));
const usage = { lines: ut.lines, baseWinPct: ut.baseWinPct, loaded: true };
const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const usageBandIndex = pct => (pct >= 2.25 ? 0 : pct >= 1 ? 1 : pct >= 0.5 ? 2 : pct >= 0.25 ? 3 : 4);
const eggBandIndex = e => (e === 3 ? 0 : e === 2 ? 1 : e === 1 ? 2 : 4);
const tierFor = (pct, eggTier) => TIERS[Math.min(usageBandIndex(pct), eggBandIndex(eggTier))];
const M5_CUTS = [0.35, 0.6, 0.8, 0.92];
const M5_USAGE_CAP = 8;
const M5_WIN_FLOOR_MULT = 2;
function computeM5capTiers() {
  const map = new Map();
  const lines = usage.lines;
  const baseWin = typeof usage.baseWinPct === "number" ? usage.baseWinPct : 6.3;
  const hasPerf = typeof usage.baseWinPct === "number";
  const eggById = new Map();
  for (const mon of DEX) {
    eggById.set(mon.id, mon.eggTier ?? 0);
  }
  const isCommon = id => {
    const e = eggById.get(id) ?? 0;
    return !(e === 1 || e === 2 || e === 3);
  };
  const commonIds = Object.keys(lines).map(Number).filter(isCommon);
  const rankBy = key => {
    const s = commonIds.slice().sort((a, b) => (lines[a][key] ?? 0) - (lines[b][key] ?? 0));
    const r = new Map();
    const d = Math.max(1, s.length - 1);
    s.forEach((id, i) => r.set(id, i / d));
    return r;
  };
  const rWin = hasPerf ? rankBy("winLift") : null;
  const rWave = hasPerf ? rankBy("waveLift") : null;
  for (const key of Object.keys(lines)) {
    const id = Number(key);
    const l = lines[id];
    if (isCommon(id) && hasPerf) {
      const perf = 0.5 * (rWin.get(id) ?? 0) + 0.5 * (rWave.get(id) ?? 0);
      let t = perf >= M5_CUTS[3] ? 0 : perf >= M5_CUTS[2] ? 1 : perf >= M5_CUTS[1] ? 2 : perf >= M5_CUTS[0] ? 3 : 4;
      if (t >= 3 && (l.usagePct ?? 0) > M5_USAGE_CAP) {
        t = 2;
      }
      if (t === 4 && (l.win ?? 0) >= M5_WIN_FLOOR_MULT * baseWin) {
        t = 3;
      }
      map.set(id, TIERS[t]);
    } else {
      map.set(id, TIERS[Math.min(usageBandIndex(l.usagePct ?? 0), eggBandIndex(eggById.get(id) ?? 0))]);
    }
  }
  return map;
}
const m5 = computeM5capTiers();
console.log("hasPerf:", typeof usage.baseWinPct === "number", "| baseWinPct:", usage.baseWinPct);
console.log("m5 map size:", m5.size, "| NU in line-map:", [...m5.values()].filter(t => t === "NU").length);
const counts = { OU: 0, UU: 0, RU: 0, PU: 0, NU: 0 };
const nu = [];
let matched = 0;
for (const mon of DEX) {
  const line = usage.lines[mon.id];
  const pct = line && typeof line.usagePct === "number" ? line.usagePct : 0;
  if (m5.has(mon.id)) {
    matched++;
  }
  const tier = m5.get(mon.id) ?? tierFor(pct, mon.eggTier);
  counts[tier]++;
  if (tier === "NU") {
    nu.push(mon.slug);
  }
}
console.log("DEX tier counts:", JSON.stringify(counts));
console.log("DEX mons matched in m5 map:", matched, "of", DEX.length);
console.log(
  "typeof first DEX id:",
  typeof DEX[0].id,
  "| typeof first line key (Number):",
  typeof Number(Object.keys(ut.lines)[0]),
);
console.log("NU mons (first 25):", nu.slice(0, 25).join(", "));
