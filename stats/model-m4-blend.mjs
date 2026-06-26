/*
 * OFFLINE — M4 performance tier with a win-rate + avg-wave BLEND, and a diff vs the
 * current live model (M0). Empirical-Bayes shrinkage (K phantom runs) so small samples
 * don't dominate; each signal rank-normalized among common-egg lines, blended 50/50.
 *   node stats/model-m4-blend.mjs
 */
import fs from "node:fs";

const dex = JSON.parse(fs.readFileSync("stats/data/dex.json", "utf8"));
const ss = JSON.parse(fs.readFileSync("stats/data/species-stats.json", "utf8"));
const bySlug = new Map(dex.map(m => [m.slug, m]));
const baseWin = ss.baselineWin;
const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const ti = t => TIERS.indexOf(t);
const eggBand = e => (e === 3 ? 0 : e === 2 ? 1 : e === 1 ? 2 : 4);
const isCommon = e => eggBand(e) === 4;
const usageBand = p => (p >= 2.25 ? 0 : p >= 1 ? 1 : p >= 0.5 ? 2 : p >= 0.25 ? 3 : 4);

const rows = Object.entries(ss.species).map(([slug, s]) => {
  const m = bySlug.get(slug) || {};
  return {
    slug,
    name: m.name || slug,
    egg: m.eggTier ?? 0,
    common: isCommon(m.eggTier ?? 0),
    usage: s.usagePct,
    win: s.winPct?.all ?? 0,
    wave: s.avgWave ?? 0,
    n: s.sample ?? 0,
  };
});

let wSum = 0;
let wN = 0;
for (const r of rows) {
  wSum += r.wave * r.n;
  wN += r.n;
}
const globalWave = wSum / wN;
const K = 20; // empirical-Bayes phantom runs (cron uses 25 for wave-lift)
for (const r of rows) {
  r.sWin = (r.win * r.n + K * baseWin) / (r.n + K);
  r.sWave = (r.wave * r.n + K * globalWave) / (r.n + K);
}
const com = rows.filter(r => r.common);
const rankOf = key => {
  const s = [...com].sort((a, b) => a[key] - b[key]);
  const map = new Map();
  s.forEach((r, i) => map.set(r, i / (s.length - 1 || 1)));
  return map;
};
const rW = rankOf("sWin");
const rV = rankOf("sWave");
for (const r of com) {
  r.perf = 0.5 * rW.get(r) + 0.5 * rV.get(r); // 50/50 win + wave
}
const perfTier = p => (p >= 0.92 ? 0 : p >= 0.8 ? 1 : p >= 0.6 ? 2 : p >= 0.35 ? 3 : 4);

for (const r of rows) {
  r.m0 = TIERS[Math.min(usageBand(r.usage), eggBand(r.egg))];
  r.m4 = r.common ? TIERS[perfTier(r.perf)] : r.m0; // non-common keep egg-floored tier
}

const count = key => {
  const c = { OU: 0, UU: 0, RU: 0, PU: 0, NU: 0 };
  for (const r of rows) {
    c[r[key]]++;
  }
  return c;
};
console.log(
  `dataset ${rows.length} lines | baseWin=${baseWin}%  globalWave=${globalWave.toFixed(1)}  K=${K}  (common-egg lines: ${com.length})`,
);
console.log("M0 (current) tiers:", JSON.stringify(count("m0")));
console.log("M4 (blend)   tiers:", JSON.stringify(count("m4")));

const changed = rows.filter(r => r.m0 !== r.m4);
const down = changed.filter(r => ti(r.m4) > ti(r.m0));
const up = changed.filter(r => ti(r.m4) < ti(r.m0));
console.log("\n=== DIFF M0 -> M4 ===");
console.log(
  `CHANGED TIER: ${changed.length} of ${rows.length} lines (${((100 * changed.length) / rows.length).toFixed(0)}%)`,
);
console.log(`  of common-egg lines (${com.length}): ${com.filter(r => r.m0 !== r.m4).length} changed`);
console.log(`  moved DOWN toward NU: ${down.length}   moved UP toward OU: ${up.length}`);
const dist = {};
for (const r of changed) {
  const d = ti(r.m4) - ti(r.m0);
  dist[d] = (dist[d] || 0) + 1;
}
console.log("  move sizes (tiers, + = toward NU):", JSON.stringify(dist));

const nu0 = rows.filter(r => r.m0 === "NU");
const nu4 = rows.filter(r => r.m4 === "NU");
const enteredNU = nu4.filter(r => r.m0 !== "NU");
const leftNU = nu0.filter(r => r.m4 !== "NU");
console.log(
  `\nNU SET: M0=${nu0.length}  ->  M4=${nu4.length}   (entered: ${enteredNU.length}, left: ${leftNU.length})`,
);
console.log("  M0 NU was: " + (nu0.map(r => r.name).join(", ") || "(none)"));
const newNuWell = enteredNU.filter(r => r.n >= 15).sort((a, b) => a.perf - b.perf);
console.log(
  `\nM4 NU avg: win=${(com.length > 0 ? nu4.reduce((s, r) => s + r.win, 0) / nu4.length : 0).toFixed(1)}%  wave=${Math.round(nu4.reduce((s, r) => s + r.wave, 0) / nu4.length)}  (baseline win ${baseWin}%, avg wave ${globalWave.toFixed(0)})`,
);
console.log("weakest 25 new NU (n>=15):");
for (const r of newNuWell.slice(0, 25)) {
  console.log(
    `    ${r.name.padEnd(15)} ${r.m0}->NU  win=${r.win.toFixed(1)}%  wave=${String(r.wave).padStart(3)}  use=${r.usage.toFixed(2)}%  n=${r.n}`,
  );
}
