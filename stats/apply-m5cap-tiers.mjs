/*
 * Re-tier stats/data/species-stats.json with the SAME M5cap policy the game uses,
 * from the SAME signals (usage-tiers.json the cron publishes). Keeps the stats site
 * (er-stats.pages.dev) in lockstep with the in-game Usage Tier challenge.
 *   node stats/gen-usage-tiers.mjs stats/data/usage-tiers.json   # produce signals
 *   node stats/apply-m5cap-tiers.mjs                              # re-tier the site data
 */
import fs from "node:fs";

const D = new URL("data/", import.meta.url);
const ut = JSON.parse(fs.readFileSync(new URL("usage-tiers.json", D), "utf8"));
const dex = JSON.parse(fs.readFileSync(new URL("dex.json", D), "utf8"));
const ss = JSON.parse(fs.readFileSync(new URL("species-stats.json", D), "utf8"));

const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const eggBand = e => (e === 3 ? 0 : e === 2 ? 1 : e === 1 ? 2 : 4);
const isCommon = e => eggBand(e) === 4;
const usageBand = p => (p >= 2.25 ? 0 : p >= 1 ? 1 : p >= 0.5 ? 2 : p >= 0.25 ? 3 : 4);
const CUTS = [0.35, 0.6, 0.8, 0.92];
const CAP = 8;
const NU_MIN_SAMPLE = 10;
const DEFAULT_BASE_WIN = 6.3;
const pct = (value, fallback = 0) => {
  const n = value ?? fallback;
  return n > 0 && n <= 1 ? n * 100 : n;
};
const baseWin = pct(ut.baseWinPct, DEFAULT_BASE_WIN);

const byId = new Map(dex.filter(m => typeof m.id === "number").map(m => [m.id, m]));
const rows = [];
for (const [idStr, l] of Object.entries(ut.lines)) {
  const id = +idStr;
  const m = byId.get(id);
  if (!m) {
    continue;
  }
  rows.push({
    id,
    egg: m.eggTier ?? 0,
    common: isCommon(m.eggTier ?? 0),
    usage: l.usagePct ?? 0,
    win: l.win ?? 0,
    sample: l.sample ?? NU_MIN_SAMPLE,
    winLift: l.winLift ?? 0,
    waveLift: l.waveLift ?? 0,
  });
}
const com = rows.filter(r => r.common);
const rank = key => {
  const s = [...com].sort((a, b) => a[key] - b[key]);
  const map = new Map();
  const d = Math.max(1, s.length - 1);
  s.forEach((r, i) => map.set(r.id, i / d));
  return map;
};
const rW = rank("winLift");
const rV = rank("waveLift");
const tierById = new Map();
for (const r of rows) {
  let t;
  if (r.common) {
    const perf = 0.5 * (rW.get(r.id) ?? 0) + 0.5 * (rV.get(r.id) ?? 0);
    t = perf >= CUTS[3] ? 0 : perf >= CUTS[2] ? 1 : perf >= CUTS[1] ? 2 : perf >= CUTS[0] ? 3 : 4;
    if (t >= 3 && r.usage > CAP) {
      t = 2; // usage cap
    }
    if (t === 4 && (pct(r.win) > baseWin || r.sample < NU_MIN_SAMPLE)) {
      t = 3; // NU only for below-average raw winners with enough evidence.
    }
  } else {
    t = Math.min(usageBand(r.usage), eggBand(r.egg)); // legacy usage tier
  }
  tierById.set(r.id, TIERS[t]);
}

const slugToId = new Map(dex.filter(m => typeof m.id === "number").map(m => [m.slug, m.id]));
let changed = 0;
for (const [slug, s] of Object.entries(ss.species)) {
  const id = slugToId.get(slug);
  if (id != null && tierById.has(id)) {
    const nt = tierById.get(id);
    if (s.tier !== nt) {
      s.tier = nt;
      changed++;
    }
  }
}
ss.tierModel = "m5cap"; // marker so the page/header can note the model
fs.writeFileSync(new URL("species-stats.json", D), JSON.stringify(ss));
const counts = TIERS.map(t => `${t}=${[...tierById.values()].filter(x => x === t).length}`).join(" ");
console.log(`re-tiered ${changed} species to M5cap | line tiers: ${counts}`);
