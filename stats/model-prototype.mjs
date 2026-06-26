/*
 * OFFLINE prototype — recompute the Usage-Tier bins under several candidate models
 * against the fresh prod snapshot. NOT wired into the live worker; pure analysis.
 *   node stats/model-prototype.mjs
 */
import fs from "node:fs";

const dex = JSON.parse(fs.readFileSync("stats/data/dex.json", "utf8"));
const ss = JSON.parse(fs.readFileSync("stats/data/species-stats.json", "utf8"));
const bySlug = new Map(dex.map(m => [m.slug, m]));
const base = ss.baselineWin; // overall win %

const rows = Object.entries(ss.species).map(([slug, s]) => {
  const m = bySlug.get(slug) || {};
  return {
    slug,
    name: m.name || slug,
    bst: m.bst ?? 0,
    egg: m.eggTier ?? 0,
    usage: s.usagePct,
    win: s.winPct?.all ?? 0,
    lift: s.lift ?? 0,
    avgWave: s.avgWave ?? 0,
    n: s.sample ?? 0,
  };
});
const N = rows.length;
const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const eggBand = e => (e === 3 ? 0 : e === 2 ? 1 : e === 1 ? 2 : 4); // common(0)->NU-ok
const isCommonEgg = r => eggBand(r.egg) === 4;
const f1 = x => (x > 0 ? "+" : "") + x.toFixed(1);
const cut = (vals, frac) => {
  const s = [...vals].sort((a, b) => a - b);
  return s[Math.max(0, Math.floor(frac * (s.length - 1)))];
};
const avg = a => (a.length > 0 ? a.reduce((x, y) => x + y, 0) / a.length : 0);

const summary = [];
function report(name, tierOf) {
  const counts = { OU: 0, UU: 0, RU: 0, PU: 0, NU: 0 };
  const nu = [];
  for (const r of rows) {
    const t = tierOf(r);
    counts[t]++;
    if (t === "NU") {
      nu.push(r);
    }
  }
  const wellNu = nu.filter(r => r.n >= 10);
  const bombs = nu.filter(r => r.win >= 2 * base && r.n >= 20).sort((a, b) => b.win - a.win);
  console.log(`\n========== ${name} ==========`);
  console.log("  tier sizes:  " + TIERS.map(t => `${t}=${counts[t]}`).join("   "));
  console.log(
    `  NU total=${nu.length}  (well-sampled n>=10: ${wellNu.length})  hidden bombs (win>=2x base, n>=20): ${bombs.length}`,
  );
  console.log(
    `  NU profile:  avg win=${avg(nu.map(r => r.win)).toFixed(1)}%  avg wave=${Math.round(avg(nu.map(r => r.avgWave)))}  avg BST=${Math.round(avg(nu.map(r => r.bst)))}`,
  );
  if (bombs.length > 0) {
    console.log(
      "  >> BOMBS in NU: "
        + bombs
          .slice(0, 12)
          .map(r => `${r.name}(win${r.win.toFixed(0)}%,wave${r.avgWave})`)
          .join("  "),
    );
  }
  const show = wellNu.sort((a, b) => a.usage - b.usage).slice(0, 30);
  console.log(`  NU members (n>=10, by usage asc, first ${show.length} of ${wellNu.length}):`);
  for (const r of show) {
    console.log(
      `    ${r.name.padEnd(15)} use=${r.usage.toFixed(2)}%  win=${r.win.toFixed(1)}%  lift=${f1(r.lift)}  wave=${String(r.avgWave).padStart(3)}  bst=${r.bst}  n=${r.n}`,
    );
  }
  summary.push({
    name,
    nu: nu.length,
    wellNu: wellNu.length,
    bombs: bombs.length,
    nuWin: +avg(nu.map(r => r.win)).toFixed(1),
  });
}

console.log(`dataset: ${N} lines with data | players=${ss.players} runs=${ss.totalRuns} baselineWin=${base}%`);

// M0 — current live model: usage band floored by egg band.
const usageBand = p => (p >= 2.25 ? 0 : p >= 1 ? 1 : p >= 0.5 ? 2 : p >= 0.25 ? 3 : 4);
report("M0  CURRENT (NU = usage<0.25% AND common-egg)", r => TIERS[Math.min(usageBand(r.usage), eggBand(r.egg))]);

// M1 — just raise the cutoff: double all usage gates -> NU<0.5%.
const usageBand2 = p => (p >= 4.5 ? 0 : p >= 2 ? 1 : p >= 1 ? 2 : p >= 0.5 ? 3 : 4);
report(
  "M1  RAISE % (double gates -> NU = usage<0.5% AND common-egg)",
  r => TIERS[Math.min(usageBand2(r.usage), eggBand(r.egg))],
);

// M2 — QUANTILE usage among COMMON-EGG lines: NU = bottom 35% usage of the eligible pool.
const commons = rows.filter(isCommonEgg).map(r => r.usage);
const qNU = cut(commons, 0.35);
const qPU = cut(commons, 0.6);
const qRU = cut(commons, 0.8);
const qUU = cut(commons, 0.92);
const quantBand = p => (p >= qUU ? 0 : p >= qRU ? 1 : p >= qPU ? 2 : p >= qNU ? 3 : 4);
console.log(`\n[M2 quantile cuts on common-egg usage: NU<${qNU}%  PU<${qPU}%  RU<${qRU}%  UU<${qUU}%]`);
report("M2  QUANTILE usage (NU = bottom 35% usage among common-egg)", r =>
  isCommonEgg(r) ? TIERS[quantBand(r.usage)] : TIERS[Math.min(usageBand(r.usage), eggBand(r.egg))],
);

// M3 — HYBRID: M2 quantile, but promote "bombs" out of NU (win-rate guardrail).
report("M3  HYBRID (M2 quantile, but win>=1.6x baseline & n>=15 -> bumped to PU)", r => {
  if (!isCommonEgg(r)) {
    return TIERS[Math.min(usageBand(r.usage), eggBand(r.egg))];
  }
  let b = quantBand(r.usage);
  if (b === 4 && r.win >= 1.6 * base && r.n >= 15) {
    b = 3; // bomb -> PU
  }
  return TIERS[b];
});

// M4 — PERFORMANCE-primary: tier by win rate (weakest = NU), common-egg only, ignore usage.
const winsC = rows.filter(isCommonEgg).map(r => r.win);
const wNU = cut(winsC, 0.35);
const wPU = cut(winsC, 0.6);
const wRU = cut(winsC, 0.8);
const wUU = cut(winsC, 0.92);
console.log(`\n[M4 win-rate cuts on common-egg: NU<=${wNU}%  PU<=${wPU}%  RU<=${wRU}%  UU<=${wUU}%]`);
report("M4  PERFORMANCE-first (NU = weakest 35% by win-rate among common-egg)", r => {
  if (!isCommonEgg(r)) {
    return TIERS[Math.min(usageBand(r.usage), eggBand(r.egg))];
  }
  const w = r.win;
  const b = w > wUU ? 0 : w > wRU ? 1 : w > wPU ? 2 : w > wNU ? 3 : 4;
  return TIERS[b];
});

console.log("\n\n================ SUMMARY ================");
console.log("model".padEnd(52) + "NU   NU(n>=10)  bombs  NU-avgWin");
for (const s of summary) {
  console.log(
    s.name.slice(0, 50).padEnd(52)
      + String(s.nu).padEnd(5)
      + String(s.wellNu).padEnd(11)
      + String(s.bombs).padEnd(7)
      + s.nuWin
      + "%",
  );
}
