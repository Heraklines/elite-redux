/*
 * Elite Redux — Pokédex & Usage (public, read-only).
 * A competitive-stats dashboard: each starter-selectable species' tier badge,
 * run win/pick/usage stats, base stats, and build insights — to help players
 * pick a team. Reads:
 *   - ./data/dex.json            (generated; types/baseStats/abilities/eggTier/cost)
 *   - ./data/stats.sample.json   (SAMPLE placeholder metrics, deterministic)
 *   - er-assets/usage-tiers.json (REAL nightly tier/usage feed — preferred when present)
 * Vanilla JS, no framework, no build step (mirrors editor/app.js).
 *
 * 🔴 Swapping the SAMPLE feed for the REAL one is a ONE-LINE change: point
 *    STATS_URL at the cron-produced species-stats.json (same shape) — see README.
 */

// ---- Config (edit if URLs change) ------------------------------------------
const SPRITE_BASE = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/images/pokemon/elite-redux";
// GitHub raw (5-min cache) not jsDelivr (@main edge-cached ~12h per region) so the
// nightly feed is always fresh; the fetch below adds a per-day query buster too.
const USAGE_TIERS_URL = "https://raw.githubusercontent.com/Heraklines/er-assets/main/usage-tiers.json";
// REAL run-derived metrics (win / pick / usage / lift / avg wave / teammates),
// aggregated from the prod `runs` table by stats/gen-real-stats.mjs. Tiers are
// still overlaid live from the er-assets usage feed (USAGE_TIERS_URL).
const STATS_URL = "./data/species-stats.json";

// Optional login: filters the dex to the species your account owns. The login +
// save fetch hit the game's OWN save server; the save is AES-decrypted in the
// browser (same key as src/constants.ts). Only the owned-id list is kept locally.
const SAVE_API = "https://er-save-api.heraklines.workers.dev";
const SAVE_KEY = "x0i2O7WRiANTqPmZ"; // matches src/constants.ts saveKey
const OWNED_LS = "erStatsOwnedV1"; // localStorage: { username, ids:[...], at }

const TIERS = ["OU", "UU", "RU", "PU", "NU"];
const EGG_TIER_NAMES = ["Common", "Rare", "Epic", "Legendary"];
const DIFFS = [
  ["all", "All"],
  ["ace", "Ace"],
  ["elite", "Elite"],
  ["hell", "Hell"],
];

// Plain-language definitions shown as hover tooltips on the metric columns,
// card stats, and drawer tiles (so "lift" etc. mean something to everyone).
// Keyed by column key so the header, card, and drawer all reuse one source.
// No em dashes (player-facing text rule).
const TIPS = {
  name: "The Pokemon, its Pokedex number, and its types.",
  tier: "Competitive tier, Smogon style. The base tier comes from how often this Pokemon is picked, then win rate adjusts it: ones that over-perform for their usage get promoted and weak, rarely-picked ones get demoted. OU is the top, then UU, RU, PU, NU.",
  usage: "This Pokemon's share of every team slot across all recorded runs. This is what sets its tier.",
  pick: "How often players put this Pokemon on a team (the share of runs that include it).",
  win: "Win rate of the runs that included this Pokemon, for the difficulty selected at the top.",
  lift: "Win-rate difference from the average pick, in percentage POINTS (not a multiplier). The average run wins about 5%; a +40 here means runs with this Pokemon win about 40 points more (so roughly 45%). Tiny samples make this noisy - check the run count.",
  wave: "The average wave that runs using this Pokemon reach. A rough measure of how far it carries you.",
  bst: "Base stat total: the sum of the six base stats. A rough power ceiling, not a competitive ranking.",
};

// The 18 canonical Pokémon type colors (title-cased keys to match dex.json).
const TYPE_COLORS = {
  Normal: "#9fa19f",
  Fighting: "#ff8000",
  Flying: "#81b9ef",
  Poison: "#9141cb",
  Ground: "#915121",
  Rock: "#afa981",
  Bug: "#91a119",
  Ghost: "#704170",
  Steel: "#60a1b8",
  Fire: "#e62829",
  Water: "#2980ef",
  Grass: "#3fa129",
  Electric: "#fac000",
  Psychic: "#ef4179",
  Ice: "#3dcef3",
  Dragon: "#5060e1",
  Dark: "#624d4e",
  Fairy: "#ef70ef",
};

// Tier EXACTLY as the game/editor computes it (src/data/elite-redux/er-usage-tiers.ts
// + editor usageTierOf): the usage band, FLOORED by the species' egg tier so a
// Legendary/Epic line can never drop below OU/UU regardless of how low its usage is.
// Authoritative usage comes from the live usage-tiers feed - the same file the game reads.
function usageBandIndex(pct) {
  if (pct >= 2.25) {
    return 0; // OU
  }
  if (pct >= 1) {
    return 1; // UU
  }
  if (pct >= 0.5) {
    return 2; // RU
  }
  if (pct >= 0.25) {
    return 3; // PU
  }
  return 4; // NU
}
function eggBandIndex(eggTier) {
  // LEGENDARY -> OU floor, EPIC -> UU, RARE -> RU, COMMON/none -> no floor.
  if (eggTier === 3) {
    return 0;
  }
  if (eggTier === 2) {
    return 1;
  }
  if (eggTier === 1) {
    return 2;
  }
  return 4;
}
function tierFor(pct, eggTier) {
  return TIERS[Math.min(usageBandIndex(pct), eggBandIndex(eggTier))];
}

// M5cap PERFORMANCE tier (matches src/data/elite-redux/er-usage-tiers.ts + the game):
// common-egg lines are ranked by the skill-adjusted win + wave lift carried in the live
// feed, quantile-binned, then usage-capped; NU is then restricted to below-average
// raw win rates with enough evidence. Non-common lines (and an old-format feed
// lacking the lift signals) keep the legacy usage tier. Rebuilt from the feed each
// load, so the site's tiers track the worker's daily feed automatically.
const M5_CUTS = [0.35, 0.6, 0.8, 0.92];
const M5_USAGE_CAP = 8;
const M5_DEFAULT_BASE_WIN = 6.3;
const M5_NU_MIN_SAMPLE = 10; // fewer picks than this can't be NU (too little evidence -> PU)
const pctValue = (value, fallback = 0) => {
  const n = value ?? fallback;
  return n > 0 && n <= 1 ? n * 100 : n;
};
function computeM5capTiers() {
  const map = new Map(); // line id -> tier name
  // Produce tiers ONLY when the feed carries the M5cap perf signals (baseWinPct).
  // An old / CDN-stale feed returns an EMPTY map, so applyRealUsage keeps the bundled
  // (already-M5cap) tiers instead of clobbering them with the legacy usage band - a
  // stale feed must never make the displayed tiers worse than the shipped data.
  if (!usage.loaded || typeof usage.baseWinPct !== "number") {
    return map;
  }
  const lines = usage.lines;
  const baseWin = pctValue(usage.baseWinPct, M5_DEFAULT_BASE_WIN);
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
    const sorted = commonIds.slice().sort((a, b) => (lines[a][key] ?? 0) - (lines[b][key] ?? 0));
    const r = new Map();
    const d = Math.max(1, sorted.length - 1);
    sorted.forEach((id, i) => r.set(id, i / d));
    return r;
  };
  const rWin = rankBy("winLift");
  const rWave = rankBy("waveLift");
  for (const key of Object.keys(lines)) {
    const id = Number(key);
    const l = lines[id];
    if (isCommon(id)) {
      const perf = 0.5 * (rWin.get(id) ?? 0) + 0.5 * (rWave.get(id) ?? 0);
      let t = perf >= M5_CUTS[3] ? 0 : perf >= M5_CUTS[2] ? 1 : perf >= M5_CUTS[1] ? 2 : perf >= M5_CUTS[0] ? 3 : 4;
      if (t >= 3 && (l.usagePct ?? 0) > M5_USAGE_CAP) {
        t = 2; // popular line -> can't be PU/NU
      }
      if (t === 4 && (pctValue(l.win) > baseWin || (l.sample ?? M5_NU_MIN_SAMPLE) < M5_NU_MIN_SAMPLE)) {
        t = 3; // NU only for below-average raw winners with enough evidence.
      }
      map.set(id, TIERS[t]);
    } else {
      map.set(id, TIERS[Math.min(usageBandIndex(l.usagePct ?? 0), eggBandIndex(eggById.get(id) ?? 0))]);
    }
  }
  return map;
}

// ---- State -----------------------------------------------------------------
let DEX = []; // [{slug,name,id,dex,types,baseStats,bst,abilities,eggTier,cost}]
let STATS = {}; // slug → metrics (sample or real)
let STATS_IS_SAMPLE = true;
let RUN_COUNT = 0; // total real runs behind the feed (for the data pill)
// Win-rate color/scale band, overridden by the feed's meta. Full victories are
// rare in a hard roguelike, so the colour/bar scale to the real data: winMid ~
// the average pick (amber), winMax ~ the strongest well-sampled pick (green).
let winMid = 50;
let winMax = 100;
const usage = { loaded: false, lines: {} }; // real er-assets feed (by pokerogue id)
const bySlugKey = new Map(); // dex key → dex entry (for teammate sprite/jump)

let activeDiff = "all";
// Default to Lift desc — the page's job is "who's actually good?", and lift
// (win-rate vs an average pick) is the honest strength signal. Usage is just
// popularity; sorting by it leads with over-picked starters at negative lift.
let sortKey = "lift";
let sortDir = -1; // -1 desc, 1 asc

// Below this sample size the run-derived numbers are pure noise — the row is
// dimmed + marked so a 3-run 100% win-rate never reads as real.
const LOW_SAMPLE = 5;
let searchTerm = "";
let filterType = "";
let filterTier = "";
let filterEgg = "";
let minSample = 5; // hide species with fewer than this many runs (default 5+ for reliability)
let ownedOnly = false; // when logged in: show only species the account owns
let ownedSet = null; // Set<number> of owned root species ids, or null when logged out
let accountName = "";
let currentKey = null; // dex key of the mon shown in the drawer (re-highlight + URL hash)

const $ = sel => document.querySelector(sel);
const esc = s =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const dexKey = m => m.slug || `id-${m.id}`;

// ---- Column definitions ----------------------------------------------------
// key → {label, num, get(metrics, mon) → sortable number, cell(...) → html}.
const round1 = n => Math.round(n * 10) / 10;

function winColor(pct) {
  // 0 -> red, winMid (average pick) -> amber, winMax (top pick) -> green.
  let t;
  if (pct <= winMid) {
    t = winMid > 0 ? (pct / winMid) * 0.5 : 0;
  } else {
    t = 0.5 + (winMax > winMid ? Math.min(1, (pct - winMid) / (winMax - winMid)) * 0.5 : 0.5);
  }
  return `hsl(${t * 120}, 62%, 50%)`;
}

/** A right-aligned numeric value + a thin inline bar. */
function barCell(display, frac, kind, color) {
  const pct = Math.max(0, Math.min(100, frac * 100));
  return `<div class="barcell"><span class="v">${display}</span><span class="bar ${kind}"><i style="width:${pct.toFixed(0)}%${color ? `;background:${color}` : ""}"></i></span></div>`;
}

function liftCell(lift) {
  const cls = lift >= 0 ? "pos" : "neg";
  const sign = lift >= 0 ? "+" : "";
  return `<span class="lift ${cls}">${sign}${lift.toFixed(1)}%</span>`;
}

// Win% for the active difficulty.
const winOf = (m, diff) => (m ? (m.winPct?.[diff] ?? m.winPct?.all ?? 0) : 0);

const COLUMNS = [
  {
    key: "name",
    label: "Pokémon",
    num: false,
    // Sort the Pokémon column by Pokedex number (natural dex order).
    get: (_m, mon) => mon.dex ?? 99999,
    cell: (_m, mon) => {
      const chips = mon.types
        .filter(Boolean)
        .map(t => `<span class="tchip" style="background:${TYPE_COLORS[t] || "#777"}">${esc(t)}</span>`)
        .join("");
      return `<div class="cell-mon">${spriteImg(mon, "spr")}
        <div class="mon-name"><span class="nm">${esc(mon.name)} <small>#${mon.dex ?? "—"}</small></span>
        <span class="type-chips">${chips}</span></div></div>`;
    },
  },
  {
    key: "tier",
    label: "Tier",
    num: false,
    get: m => TIERS.indexOf(m?.tier ?? "NU"),
    cell: m => tierBadge(m),
  },
  {
    key: "usage",
    label: "Usage",
    num: true,
    get: m => m?.usagePct ?? 0,
    cell: m => barCell(`${(m?.usagePct ?? 0).toFixed(2)}%`, (m?.usagePct ?? 0) / 6, "accent"),
  },
  {
    key: "pick",
    label: "Pick",
    num: true,
    get: m => m?.pickPct ?? 0,
    cell: m => barCell(`${(m?.pickPct ?? 0).toFixed(1)}%`, (m?.pickPct ?? 0) / 40, "neutral"),
  },
  {
    key: "win",
    label: "Win",
    num: true,
    get: m => winOf(m, activeDiff),
    cell: m => {
      const w = winOf(m, activeDiff);
      return barCell(`${w.toFixed(1)}%`, w / winMax, "win", winColor(w));
    },
  },
  {
    key: "lift",
    label: "Lift",
    num: true,
    get: m => m?.lift ?? 0,
    cell: m => liftCell(m?.lift ?? 0),
  },
  {
    key: "wave",
    label: "Avg wave",
    num: true,
    get: m => m?.avgWave ?? 0,
    cell: m => barCell(String(m?.avgWave ?? 0), (m?.avgWave ?? 0) / 200, "neutral"),
  },
  {
    key: "bst",
    label: "BST",
    num: true,
    get: (_m, mon) => mon.bst,
    cell: (_m, mon) => `<span class="v">${mon.bst}</span>`,
  },
];

// ---- Sprites ----------------------------------------------------------------
function spriteUrl(mon) {
  return mon.slug ? `${SPRITE_BASE}/${mon.slug}/front.png` : "";
}
function spriteImg(mon, cls) {
  const url = spriteUrl(mon);
  if (!url) {
    return `<span class="${cls}"></span>`;
  }
  return `<img class="${cls}" src="${url}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />`;
}

// ---- Tier badge -------------------------------------------------------------
function tierBadge(m) {
  const tier = m?.tier ?? "NU";
  const real = m?.tierIsReal ? " real" : "";
  const src = m?.tierIsReal ? "Real, from the nightly usage feed." : "Sample placeholder.";
  const tip = `${TIPS.tier} ${src}`;
  return `<span class="tier tier-${tier}${real}" data-tip="${esc(tip)}" data-tip-title="Tier ${tier}">${tier}</span>`;
}

// ---- Filtering + sorting ----------------------------------------------------
// Search matches name, any type, or any ability so "fire", "levitate", or a
// partial species name all narrow the list.
function matchesQuery(mon, q) {
  if (mon.name.toLowerCase().includes(q)) {
    return true;
  }
  // A pure-number query matches the Pokedex number (e.g. "151" -> Mew).
  if (/^\d+$/.test(q) && String(mon.dex) === q) {
    return true;
  }
  if (mon.types.some(t => t && t.toLowerCase().includes(q))) {
    return true;
  }
  return (mon.abilities || []).some(a => String(a).toLowerCase().includes(q));
}

function visibleRows() {
  const q = searchTerm.trim().toLowerCase();
  let list = DEX.filter(mon => {
    if (q && !matchesQuery(mon, q)) {
      return false;
    }
    if (filterType && !mon.types.includes(filterType)) {
      return false;
    }
    if (filterTier && (STATS[dexKey(mon)]?.tier ?? "NU") !== filterTier) {
      return false;
    }
    if (filterEgg !== "" && String(mon.eggTier) !== filterEgg) {
      return false;
    }
    if (minSample > 0 && (STATS[dexKey(mon)]?.sample ?? 0) < minSample) {
      return false;
    }
    if (ownedOnly && ownedSet && !ownedSet.has(mon.id)) {
      return false;
    }
    return true;
  });
  const col = COLUMNS.find(c => c.key === sortKey) || COLUMNS[2];
  list = list.sort((a, b) => {
    const ma = STATS[dexKey(a)];
    const mb = STATS[dexKey(b)];
    const va = col.get(ma, a);
    const vb = col.get(mb, b);
    let cmp;
    if (typeof va === "string" || typeof vb === "string") {
      cmp = String(va).localeCompare(String(vb));
    } else {
      cmp = va - vb;
    }
    if (cmp === 0) {
      cmp = a.name.localeCompare(b.name);
      return cmp; // stable tiebreak, always ascending by name
    }
    return cmp * sortDir;
  });
  return list;
}

// ---- Render: header + chips -------------------------------------------------
function renderHead() {
  const arrow = sortDir === -1 ? "▼" : "▲";
  $("#head-row").innerHTML = COLUMNS.map(c => {
    const active = c.key === sortKey;
    const cls = c.num ? "num" : "";
    const winLabel = c.key === "win" ? `Win (${DIFFS.find(d => d[0] === activeDiff)[1]})` : c.label;
    const tip = TIPS[c.key] ? ` data-tip="${esc(TIPS[c.key])}" data-tip-title="${esc(winLabel)}"` : "";
    return `<th class="${cls}" data-sort="${c.key}"${tip}>${esc(winLabel)}${active ? `<span class="arr">${arrow}</span>` : ""}</th>`;
  }).join("");
}

function renderTypeChips() {
  const types = Object.keys(TYPE_COLORS);
  $("#type-chips").innerHTML = types
    .map(t => {
      const on = filterType === t;
      const style = on ? ` style="background:${TYPE_COLORS[t]};border-color:${TYPE_COLORS[t]};color:#fff"` : "";
      return `<button type="button" class="chip tchip${on ? " on" : ""}" data-typechip="${esc(t)}"${style}>${esc(t)}</button>`;
    })
    .join("");
}

function renderTierChips() {
  $("#tier-chips").innerHTML = TIERS.map(t => {
    const on = filterTier === t;
    const style = on ? ` style="background:var(--tier-${t});border-color:var(--tier-${t})"` : "";
    return `<button type="button" class="chip tierchip${on ? " on" : ""}" data-tierchip="${t}"${style}>${t}</button>`;
  }).join("");
}

// ---- Render: rows + cards ---------------------------------------------------
function renderRows() {
  const rows = visibleRows();
  const tbody = $("#rows");
  const cards = $("#cards");
  const empty = $("#empty");
  if (rows.length === 0) {
    tbody.innerHTML = "";
    cards.innerHTML = "";
    empty.hidden = false;
  } else {
    empty.hidden = true;
    tbody.innerHTML = rows
      .map(mon => {
        const m = STATS[dexKey(mon)];
        const tds = COLUMNS.map(c => `<td class="${c.num ? "num" : ""}">${c.cell(m, mon)}</td>`).join("");
        const low = (m?.sample ?? 0) < LOW_SAMPLE;
        const attrs = low ? ` class="low-sample" title="Thin data — only ${m?.sample ?? 0} run samples"` : "";
        return `<tr data-key="${esc(dexKey(mon))}"${attrs}>${tds}</tr>`;
      })
      .join("");
    cards.innerHTML = rows.map(mon => cardHtml(mon)).join("");
    // Keep the open mon highlighted across re-renders (search, sort, async feed).
    if (currentKey) {
      document.querySelector(`tr[data-key="${CSS.escape(currentKey)}"]`)?.classList.add("sel");
    }
  }
  $("#count").textContent = `${rows.length} of ${DEX.length} Pokémon`;
}

function cardHtml(mon) {
  const m = STATS[dexKey(mon)];
  const chips = mon.types
    .filter(Boolean)
    .map(t => `<span class="tchip" style="background:${TYPE_COLORS[t] || "#777"}">${esc(t)}</span>`)
    .join("");
  const w = winOf(m, activeDiff);
  const low = (m?.sample ?? 0) < LOW_SAMPLE ? " low-sample" : "";
  return `<div class="mcard${low}" data-key="${esc(dexKey(mon))}">
    <div class="top">${spriteImg(mon, "spr")}
      <div class="mon-name"><span class="nm">${esc(mon.name)} <small>#${mon.dex ?? "—"}</small></span>
      <span class="type-chips">${chips}</span></div>
      <span style="margin-left:auto">${tierBadge(m)}</span>
    </div>
    <div class="grid">
      <div class="stat"><span class="k">Usage</span><span class="vv">${(m?.usagePct ?? 0).toFixed(2)}%</span></div>
      <div class="stat"><span class="k">Win</span><span class="vv" style="color:${winColor(w)}">${w.toFixed(1)}%</span></div>
      <div class="stat"><span class="k">Lift</span><span class="vv">${liftCell(m?.lift ?? 0)}</span></div>
      <div class="stat"><span class="k">BST</span><span class="vv">${mon.bst}</span></div>
    </div>
  </div>`;
}

// ---- Detail drawer ----------------------------------------------------------
// Per-base-stat colors (HP, Atk, Def, SpA, SpD, Spe), and the max for the bar.
const STAT_LABELS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
const STAT_COLORS = ["#5fd07a", "#f08a4b", "#f5cb42", "#5b8cff", "#4bc7c0", "#ef6a9a"];
const STAT_MAX = 200;

function statBars(mon) {
  const rows = mon.baseStats
    .map((v, i) => {
      const frac = Math.max(0.02, Math.min(1, v / STAT_MAX));
      return `<div class="sbar"><span class="sk">${STAT_LABELS[i]}</span><span class="sv">${v}</span>
        <span class="strack"><i style="width:${(frac * 100).toFixed(0)}%;background:${STAT_COLORS[i]}"></i></span></div>`;
    })
    .join("");
  return `<div class="stat-bars">${rows}
    <div class="bst-line"><span class="sk" style="font-size:12px">Base stat total</span><span class="bst-n">${mon.bst}</span></div></div>`;
}

function diffBars(m) {
  return `<div class="diffbars">${["ace", "elite", "hell"]
    .map(d => {
      const w = m?.winPct?.[d] ?? 0;
      const on = activeDiff === d;
      return `<div class="dbar"><span class="dk${on ? " on" : ""}">${d[0].toUpperCase() + d.slice(1)}</span>
        <span class="dtrack"><i style="width:${Math.min(100, (w / winMax) * 100).toFixed(0)}%;background:${winColor(w)}"></i></span>
        <span class="dv">${w.toFixed(1)}%</span></div>`;
    })
    .join("")}</div>`;
}

function insightChips(list, fmt) {
  if (!list || list.length === 0) {
    return '<div class="ichip" style="color:var(--muted)">no data</div>';
  }
  return `<div class="ichips">${list
    .map(x => `<div class="ichip"><span>${esc(fmt(x))}</span><span class="ip">${(x.pct ?? 0).toFixed(1)}%</span></div>`)
    .join("")}</div>`;
}

function teammatesHtml(m) {
  if (!m?.topTeammates || m.topTeammates.length === 0) {
    return '<span style="color:var(--muted);font-size:12px">no data</span>';
  }
  return `<div class="mates">${m.topTeammates
    .map(t => {
      const mate = bySlugKey.get(t.slug) || { slug: t.slug, name: t.name, id: 0 };
      return `<div class="mate" data-key="${esc(t.slug)}">${spriteImg(mate, "")}
        <span class="mn" title="${esc(t.name)}">${esc(t.name)}</span><span class="mp">${(t.pct ?? 0).toFixed(0)}%</span></div>`;
    })
    .join("")}</div>`;
}

// ---- Per-Pokemon detail page (dedicated, route-driven) ---------------------
// A full-screen view opened by clicking a row. It lazy-loads the editor-derived
// dex-detail.json (learnsets, TMs, abilities + text, evolutions, a move index).
// The editor is the source of truth; this only READS its exported data. Move
// descriptions + egg moves are not exported by the editor, so the Moves tab
// shows stats only. Routes: #mon/<slug>[/<tab>], #move/<id>, #ability/<id>,
// #moves, #abilities.

let DETAIL = null; // dex-detail.json once loaded
let detailLoading = null;
const byId = new Map(); // species id -> grid dex entry
const slugToId = new Map(); // slug -> species id (grid + evolution-line members)
const extraById = new Map(); // species id -> {types, baseStats, bst} for NON-grid (evolved) forms (one-time game dump)
let moveToSpecies = null; // moveId -> [grid dex entries]
let abilityToSpecies = null; // abilityId -> [grid dex entries]
let statSorted = null; // {bst:[...], s:[[...]x6]} sorted asc, for percentiles
let view = null; // current view: {kind:'mon'|'move'|'ability'|'index', ...} or null
const navTo = h => {
  location.hash = h;
}; // navigation = set the hash; hashchange renders (gives native Back)

function buildIdIndex() {
  byId.clear();
  slugToId.clear();
  for (const m of DEX) {
    if (typeof m.id === "number") {
      byId.set(m.id, m);
      slugToId.set(dexKey(m), m.id);
    }
  }
}

function ensureDetail() {
  if (DETAIL) {
    return Promise.resolve(DETAIL);
  }
  if (!detailLoading) {
    // dex-detail.json: editor-derived learnsets / abilities / evolutions.
    // species-extra.json: types + base stats for EVERY species (incl. evolved
    // forms not in the starter grid), from the one-time read-only game dump — so
    // the detail page can show matchups + stat bars for evolved forms too. The
    // extra file is best-effort (older deploys may not ship it).
    detailLoading = Promise.all([
      fetch("./data/dex-detail.json").then(r => r.json()),
      fetch("./data/species-extra.json")
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([d, extra]) => {
        DETAIL = d;
        if (extra && extra.species) {
          for (const [id, e] of Object.entries(extra.species)) {
            extraById.set(Number(id), e);
          }
        }
        for (const [id, n] of Object.entries(d.names || {})) {
          if (n.slug && !slugToId.has(n.slug)) {
            slugToId.set(n.slug, Number(id));
          }
        }
        // Reverse indexes over the starter-selectable roster (what players use).
        moveToSpecies = new Map();
        abilityToSpecies = new Map();
        const add = (map, k, v) => {
          let a = map.get(k);
          if (!a) {
            a = [];
            map.set(k, a);
          }
          a.push(v);
        };
        for (const mon of DEX) {
          const sp = d.species[mon.id];
          if (!sp) {
            continue;
          }
          for (const mid of new Set([...sp.levelup.map(x => x[1]), ...sp.tm])) {
            add(moveToSpecies, mid, mon);
          }
          for (const ab of sp.abilities) {
            add(abilityToSpecies, ab.id, mon);
          }
        }
        return d;
      })
      .catch(() => {
        DETAIL = { species: {}, moves: {}, abilities: {}, names: {} };
        return DETAIL;
      });
  }
  return detailLoading;
}

// ---- Type chart (standard) + matchup helpers -------------------------------
const titleType = t => (t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : "");
const typeColor = t => TYPE_COLORS[titleType(t)] || "#777";
// attacker -> { defender: multiplier } for non-1 matchups only.
const TYPE_CHART = {
  Normal: { Rock: 0.5, Ghost: 0, Steel: 0.5 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: {
    Fire: 0.5,
    Water: 2,
    Grass: 0.5,
    Poison: 0.5,
    Ground: 2,
    Flying: 0.5,
    Bug: 0.5,
    Rock: 2,
    Dragon: 0.5,
    Steel: 0.5,
  },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: {
    Normal: 2,
    Ice: 2,
    Poison: 0.5,
    Flying: 0.5,
    Psychic: 0.5,
    Bug: 0.5,
    Rock: 2,
    Ghost: 0,
    Dark: 2,
    Steel: 2,
    Fairy: 0.5,
  },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug: {
    Fire: 0.5,
    Grass: 2,
    Fighting: 0.5,
    Poison: 0.5,
    Flying: 0.5,
    Psychic: 2,
    Ghost: 0.5,
    Dark: 2,
    Steel: 0.5,
    Fairy: 0.5,
  },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};
const defMult = (atk, defTypes) => {
  let mult = 1;
  const row = TYPE_CHART[atk] || {};
  for (const dt of defTypes) {
    if (titleType(dt) in row) {
      mult *= row[titleType(dt)];
    }
  }
  return mult;
};
const multLabel = m => (m === 0 ? "0" : m === 0.25 ? "¼×" : m === 0.5 ? "½×" : m === 0.25 ? "¼×" : `${m}×`);

function ensureStatSorted() {
  if (statSorted) {
    return;
  }
  statSorted = { bst: [], s: [[], [], [], [], [], []] };
  for (const m of DEX) {
    statSorted.bst.push(m.bst);
    m.baseStats.forEach((v, i) => statSorted.s[i].push(v));
  }
  statSorted.bst.sort((a, b) => a - b);
  statSorted.s.forEach(a => a.sort((x, y) => x - y));
}
// "top N%" of the roster for a value (higher value = better rank).
function topPct(sorted, v) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= v) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return Math.max(1, Math.round(100 * (1 - lo / sorted.length)));
}

// ---- Small shared renderers ------------------------------------------------
function monLink(id) {
  const n = byId.get(id) || (DETAIL.names || {})[id];
  if (!n) {
    return `#${id}`;
  }
  const inGrid = byId.has(id);
  const spr = spriteImg({ slug: n.slug, name: n.name }, "minispr");
  return `<a class="monlink${inGrid ? "" : " ng"}" href="#mon/${encodeURIComponent(n.slug)}">${spr}<span>${esc(n.name)}</span></a>`;
}

function abilityCard(ab) {
  const a = (DETAIL.abilities || {})[ab.id];
  const name = a ? a.name : `Ability #${ab.id}`;
  const desc = a && a.desc ? a.desc : "No description exported by the editor.";
  const tag = { ability1: "Ability", ability2: "Ability", hidden: "Hidden", innate: "Innate" }[ab.slot] || "Ability";
  return `<a class="abcard" href="#ability/${ab.id}"><div class="ab-h"><span class="ab-name">${esc(name)}</span><span class="ab-tag t-${ab.slot}">${tag}</span></div><div class="ab-desc">${esc(desc)}</div></a>`;
}

function moveRow(mid, srcLabel, stabTypes) {
  const mv = (DETAIL.moves || {})[mid];
  if (!mv) {
    return "";
  }
  const cat = (mv.category || "").toLowerCase();
  const stab = stabTypes && stabTypes.includes(titleType(mv.type));
  const srcCell = srcLabel == null ? "" : `<td class="mv-src">${srcLabel}</td>`;
  return `<tr class="mvrow${stab ? " stab" : ""}" data-move="${mid}">
    ${srcCell}<td class="mv-n">${esc(mv.name)}${stab ? '<span class="stab-b" title="Same-type attack bonus">STAB</span>' : ""}</td>
    <td><span class="tchip" style="background:${typeColor(mv.type)}">${esc(titleType(mv.type))}</span></td>
    <td class="mv-cat ${cat}">${esc(titleType(mv.category) || "—")}</td>
    <td class="num">${mv.power || "—"}</td>
    <td class="num">${mv.accuracy ? `${mv.accuracy}%` : "—"}</td>
    <td class="num">${mv.pp || "—"}</td></tr>`;
}

// ---- Detail "deck" sections (no tabs; everything visible at once) ----------
const mvState = { q: "" }; // moves filter text (shared by the deck page)

function unifiedMoves(sp) {
  const out = [];
  const lv = new Map();
  for (const [level, mid] of sp.levelup) {
    if (!lv.has(mid) || level < lv.get(mid)) {
      lv.set(mid, level);
    }
  }
  for (const [mid, level] of lv) {
    out.push({ mid, src: "lv", level });
  }
  for (const mid of sp.tm) {
    if (!lv.has(mid)) {
      out.push({ mid, src: "tm", level: 9999 });
    }
  }
  return out;
}

// Ability chips, split into the selectable abilities (ability 1 / 2 / hidden)
// and the innates (passives). Name only; hover for the full ER description,
// click to open the ability page.
function abilitiesChips(sp) {
  if (sp.abilities.length === 0) {
    return '<div class="dt-empty">No ability data.</div>';
  }
  const chip = ab => {
    const a = (DETAIL.abilities || {})[ab.id];
    const name = a ? a.name : `#${ab.id}`;
    const desc = a && a.desc ? a.desc : "No description exported by the editor.";
    const badge = ab.slot === "hidden" ? '<span class="abtag h">Hidden</span>' : "";
    return `<a class="abchip slot-${ab.slot}" href="#ability/${ab.id}" data-tip="${esc(desc)}" data-tip-title="${esc(name)}">${esc(name)}${badge}</a>`;
  };
  const main = sp.abilities.filter(a => a.slot !== "innate");
  const innate = sp.abilities.filter(a => a.slot === "innate");
  const group = (label, arr) =>
    arr.length > 0
      ? `<div class="abgroup"><span class="abglabel">${label}</span><div class="abchips">${arr.map(chip).join("")}</div></div>`
      : "";
  return group("Abilities", main) + group("Innates", innate);
}

// Two side-by-side tables (level-up + TM/tutor), both filtered by mvState.q.
function movesTables(mon, sp) {
  const stab = mon ? mon.types.filter(Boolean).map(titleType) : [];
  const q = mvState.q.trim().toLowerCase();
  const ok = mid => {
    const mv = DETAIL.moves[mid];
    return mv && (!q || mv.name.toLowerCase().includes(q));
  };
  const lvSet = new Set(sp.levelup.map(x => x[1]));
  const lvRows = sp.levelup
    .filter(([, mid]) => ok(mid))
    .map(([lvl, mid]) => moveRow(mid, `Lv ${lvl}`, stab))
    .join("");
  const tmRows = sp.tm
    .filter(mid => !lvSet.has(mid) && ok(mid))
    .map(mid => moveRow(mid, null, stab))
    .join("");
  const head = withSrc =>
    `<thead><tr>${withSrc ? "<th>Lv</th>" : ""}<th>Move</th><th>Type</th><th>Cat</th><th class="num">Pw</th><th class="num">Ac</th><th class="num">PP</th></tr></thead>`;
  const lvCount = sp.levelup.length;
  const tmCount = sp.tm.filter(mid => !lvSet.has(mid)).length;
  return `<div class="mv2col">
    <div class="mvcol"><div class="mvcol-h">Level-up <span class="mvcol-n">${lvCount}</span></div>
      <div class="mvscroll"><table class="mvtable">${head(true)}<tbody>${lvRows || '<tr><td colspan="7" class="mv-empty">none</td></tr>'}</tbody></table></div></div>
    <div class="mvcol"><div class="mvcol-h">TM / Tutor <span class="mvcol-n">${tmCount}</span></div>
      <div class="mvscroll"><table class="mvtable">${head(false)}<tbody>${tmRows || '<tr><td colspan="6" class="mv-empty">none</td></tr>'}</tbody></table></div></div>
  </div>`;
}

function matchupsHtml(mon, sp) {
  const types = mon.types.filter(Boolean);
  const groups = { weak: [], resist: [], immune: [] };
  for (const atk of Object.keys(TYPE_COLORS)) {
    const mult = defMult(atk, types);
    if (mult === 0) {
      groups.immune.push([atk, mult]);
    } else if (mult > 1) {
      groups.weak.push([atk, mult]);
    } else if (mult < 1) {
      groups.resist.push([atk, mult]);
    }
  }
  groups.weak.sort((a, b) => b[1] - a[1]);
  groups.resist.sort((a, b) => a[1] - b[1]);
  // 3-letter type abbreviations + colour keep each row tight; full name on hover.
  const chip = ([t, m]) =>
    `<span class="mchip" style="background:${typeColor(t)}" data-tip="${esc(t)} ${multLabel(m)}">${esc(t.slice(0, 3).toUpperCase())} ${multLabel(m)}</span>`;
  const atkTypes = new Set();
  for (const x of unifiedMoves(sp)) {
    const mv = DETAIL.moves[x.mid];
    if (mv && mv.category !== "STATUS" && (mv.power || 0) > 0) {
      atkTypes.add(titleType(mv.type));
    }
  }
  const atkChips = [...atkTypes]
    .sort()
    .map(
      t =>
        `<span class="mchip" style="background:${typeColor(t)}" data-tip="${esc(t)}">${esc(t.slice(0, 3).toUpperCase())}</span>`,
    )
    .join("");
  const row = (label, chips) =>
    `<div class="mrow"><span class="mrl">${label}</span><span class="mchips">${chips || '<span class="mnone">—</span>'}</span></div>`;
  return (
    row("Weak", groups.weak.map(chip).join(""))
    + row("Resist", groups.resist.map(chip).join(""))
    + row("Immune", groups.immune.map(chip).join(""))
    + row("Hits", atkChips)
  );
}

// "top N%" for the upper half; flips to "bottom N%" for the lower half so a low
// stat reads "bottom 6%" instead of the silly-sounding "top 94%".
function rankLabel(topp) {
  return topp <= 50 ? `top ${topp}%` : `bottom ${Math.max(1, 100 - topp)}%`;
}

function overviewHints(mon) {
  ensureStatSorted();
  const off = mon.baseStats[1] >= mon.baseStats[3] ? "Physical" : "Special";
  const mixed = mon.baseStats[1] && mon.baseStats[3] && Math.abs(mon.baseStats[1] - mon.baseStats[3]) <= 10;
  return `<div class="hints">
    <span class="hint">BST <b>${rankLabel(topPct(statSorted.bst, mon.bst))}</b></span>
    <span class="hint">Speed <b>${rankLabel(topPct(statSorted.s[5], mon.baseStats[5]))}</b></span>
    <span class="hint">${off} attacker</span>
    ${mixed ? '<span class="hint">Mixed-capable</span>' : ""}
  </div>`;
}

function runTiles(m) {
  const w = winOf(m, activeDiff);
  const diffLabel = DIFFS.find(d => d[0] === activeDiff)[1];
  return `<div class="runline">
      <span class="rk" data-tip="${esc(TIPS.win)}" data-tip-title="Win (${esc(diffLabel)})">Win <b style="color:${winColor(w)}">${w.toFixed(1)}%</b> <i>${esc(diffLabel)}</i></span>
      <span class="rk" data-tip="${esc(TIPS.pick)}" data-tip-title="Pick rate">Pick <b>${(m?.pickPct ?? 0).toFixed(1)}%</b></span>
      <span class="rk" data-tip="${esc(TIPS.lift)}" data-tip-title="Lift">Lift <b>${liftCell(m?.lift ?? 0)}</b></span>
      <span class="rk" data-tip="${esc(TIPS.wave)}" data-tip-title="Avg wave reached">Avg wave <b>${m?.avgWave ?? "—"}</b></span>
    </div>
    <div class="diff-wrap">${diffBars(m)}</div>
    <div class="mates-wrap"><div class="ititle">Common teammates</div>${teammatesHtml(m)}</div>`;
}

function tabEvolution(id, sp) {
  const fam = new Set([id]);
  (sp.evoFrom || []).forEach(x => fam.add(x));
  (sp.evoTo || []).forEach(x => fam.add(x));
  // walk one more step out for full lines (pre-pre and post-post)
  for (const x of [...fam]) {
    const s = DETAIL.species[x];
    if (s) {
      (s.evoFrom || []).forEach(y => fam.add(y));
      (s.evoTo || []).forEach(y => fam.add(y));
    }
  }
  const stage = x => {
    const s = DETAIL.species[x] || {};
    const froms = (s.evoFrom || []).filter(f => fam.has(f));
    return froms.length > 0 ? 1 + Math.max(...froms.map(stage), 0) : 0;
  };
  const ordered = [...fam].sort((a, b) => stage(a) - stage(b) || a - b);
  if (ordered.length <= 1) {
    return '<div class="dt-empty">This Pokemon does not evolve.</div>';
  }
  const cur = id;
  return `<div class="evoline">${ordered
    .map(x => `<div class="evonode${x === cur ? " cur" : ""}">${monLink(x)}</div>`)
    .join('<span class="evoarrow">→</span>')}</div>
    <div class="mv-note">Arrows show the line order. The highlighted entry is the current Pokemon. Click any member to open it.</div>`;
}

function tabForms(mon) {
  const sibs = DEX.filter(x => x.dex === mon.dex && dexKey(x) !== dexKey(mon));
  if (sibs.length === 0) {
    return '<div class="dt-empty">No alternate forms in the dex.</div>';
  }
  return `<div class="formgrid">${sibs
    .map(s => {
      const dBst = s.bst - mon.bst;
      const chips = s.types
        .filter(Boolean)
        .map(t => `<span class="tchip" style="background:${typeColor(t)}">${esc(titleType(t))}</span>`)
        .join("");
      return `<a class="formcard" href="#mon/${encodeURIComponent(dexKey(s))}">
        ${spriteImg(s, "")}
        <div class="fc-name">${esc(s.name)}</div>
        <div class="fc-types">${chips}</div>
        <div class="fc-bst">BST ${s.bst} <span class="fc-d ${dBst >= 0 ? "pos" : "neg"}">${dBst >= 0 ? "+" : ""}${dBst}</span></div>
      </a>`;
    })
    .join("")}</div>`;
}

// Hide one surface without touching the URL (used when switching surfaces).
function hideDrawer() {
  $("#drawer")?.classList.remove("open");
  $("#drawer")?.setAttribute("aria-hidden", "true");
  $("#scrim")?.classList.remove("open");
  document.querySelectorAll("tr.sel").forEach(r => r.classList.remove("sel"));
}
function hideDetail() {
  const el = $("#detail");
  if (el) {
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = "";
  }
  view = null;
}

// Full "deck" page: every section laid out at once (no tabs), using the width.
function renderDetail(slug) {
  const id = slugToId.get(slug);
  const el = $("#detail");
  if (id == null || !el) {
    return;
  }
  hideDrawer(); // the page replaces the quick drawer
  const mon = byId.get(id) || null; // grid entry (full data) or null (evolution-only)
  const sp = DETAIL.species[id] || { abilities: [], levelup: [], tm: [], evoFrom: [], evoTo: [] };
  const nm = mon || (DETAIL.names || {})[id] || { name: slug, slug };
  const m = mon ? STATS[dexKey(mon)] : null;
  // A type/stat-bearing object: the grid entry when starter-selectable, else the
  // evolved form's types + base stats from the one-time game dump. Lets evolved
  // forms render base-stat bars, type matchups and STAB just like starters.
  const extra = mon ? null : extraById.get(id);
  const statMon =
    mon
    || (extra
      ? {
          slug: nm.slug,
          name: nm.name,
          dex: nm.dex ?? null,
          types: extra.types,
          baseStats: extra.baseStats,
          bst: extra.bst,
        }
      : null);
  view = { kind: "mon", id, slug, mon, statMon, sp };
  const typeChips = statMon
    ? statMon.types
        .filter(Boolean)
        .map(t => `<span class="tchip" style="background:${typeColor(t)}">${esc(titleType(t))}</span>`)
        .join("")
    : "";
  const sub = mon
    ? `#${mon.dex ?? "—"} · ${EGG_TIER_NAMES[mon.eggTier] ?? "Not in egg pool"} · Cost ${mon.cost}`
    : "Evolution / form (not starter-selectable)";
  const card = (title, inner) => `<section class="card"><h3 class="card-h">${title}</h3>${inner}</section>`;
  // Left rail: all the compact at-a-glance info. Right: the big move list. Evolved
  // forms show everything except run performance (only starters are tracked).
  const noteCard = mon
    ? ""
    : statMon
      ? '<section class="card"><div class="dt-note">This is an evolution / form, not a starter-selectable Pokemon, so it has no recorded run performance. Its base stats, type matchups, abilities and learnset are shown.</div></section>'
      : '<section class="card"><div class="dt-note">This is an evolution / form, not a starter-selectable Pokemon, so base stats, type matchups, run data and forms are not in the dataset. Its abilities and learnset are shown below.</div></section>';
  const statsCard = statMon ? card("Base stats", statBars(statMon) + overviewHints(statMon)) : "";
  const abilCard = card("Abilities", abilitiesChips(sp));
  const matchCard = statMon ? card("Type matchups", matchupsHtml(statMon, sp)) : "";
  const runCard =
    mon && !STATS_IS_SAMPLE
      ? card(`Run performance${m?.sample ? ` · ${m.sample.toLocaleString()} runs` : ""}`, runTiles(m))
      : "";
  const evoCard = card("Evolution", tabEvolution(id, sp));
  const hasForms = mon && DEX.some(x => x.dex === mon.dex && dexKey(x) !== dexKey(mon));
  const formsCard = hasForms ? card("Forms", tabForms(mon)) : "";
  const movesCard = `<section class="card moves-card">
      <div class="moves-h"><h3 class="card-h">Moves</h3>
        <input id="mv-q" class="mv-search" type="search" placeholder="Filter…" value="${esc(mvState.q)}" autocomplete="off" /></div>
      <div id="mv-tables">${movesTables(statMon, sp)}</div>
      <div class="mv-note">Level-up + TM/tutor from the editor. Egg moves and move descriptions are not exported.</div>
    </section>`;
  el.innerHTML = `
    <div class="dt-top">
      <button class="dt-back" data-close>← Back</button>
      <div class="dt-id">
        ${spriteImg({ slug: nm.slug, name: nm.name }, "dt-spr")}
        <div class="dt-meta">
          <div class="dt-name">${esc(nm.name)}</div>
          <div class="dt-sub">${esc(sub)}</div>
          <div class="dt-row">${mon ? tierBadge(m) : ""} ${typeChips}</div>
        </div>
      </div>
    </div>
    <div class="sheet">
      <div class="rail">${noteCard}${statsCard}${abilCard}${matchCard}${runCard}${evoCard}${formsCard}</div>
      ${movesCard}
    </div>`;
  el.hidden = false;
  el.setAttribute("aria-hidden", "false");
  el.scrollTop = 0;
  document.body.classList.add("detail-open");
}

// ---- Move + ability cross-link pages + indexes -----------------------------
function learnersOf(mid) {
  const list = moveToSpecies.get(Number(mid)) || [];
  return list
    .map(mon => {
      const sp = DETAIL.species[mon.id];
      const lv = sp.levelup.find(x => x[1] === Number(mid));
      const how = lv ? `Lv ${lv[0]}` : "TM";
      return { mon, how };
    })
    .sort((a, b) => (a.mon.dex ?? 0) - (b.mon.dex ?? 0));
}

function openMove(mid) {
  ensureDetail().then(() => {
    const el = $("#detail");
    const mv = (DETAIL.moves || {})[mid];
    if (!el || !mv) {
      return;
    }
    hideDrawer();
    view = { kind: "move", id: Number(mid) };
    const learners = learnersOf(mid);
    const rows = learners
      .map(
        l =>
          `<tr data-key="${esc(dexKey(l.mon))}" class="lrow"><td>${monLink(l.mon.id)}</td><td class="num">#${l.mon.dex ?? "—"}</td><td>${l.how}</td></tr>`,
      )
      .join("");
    el.innerHTML = `
      <div class="dt-top">
        <button class="dt-back" data-close>← Back</button>
        <div class="dt-id"><div class="dt-meta">
          <div class="dt-name">${esc(mv.name)}</div>
          <div class="dt-row"><span class="tchip" style="background:${typeColor(mv.type)}">${esc(titleType(mv.type))}</span>
            <span class="mv-cat ${(mv.category || "").toLowerCase()}">${esc(titleType(mv.category) || "—")}</span>
            <span class="kv">Pow ${mv.power || "—"}</span><span class="kv">Acc ${mv.accuracy ? `${mv.accuracy}%` : "—"}</span><span class="kv">PP ${mv.pp || "—"}</span></div>
        </div></div>
      </div>
      <div class="dt-content">
        <div class="btitle">Starter-selectable Pokemon that learn ${esc(mv.name)} · ${learners.length}</div>
        <table class="ltable"><thead><tr><th>Pokemon</th><th class="num">Dex</th><th>How</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="mv-empty">None in the roster.</td></tr>'}</tbody></table>
      </div>`;
    el.hidden = false;
    el.setAttribute("aria-hidden", "false");
    el.scrollTop = 0;
    document.body.classList.add("detail-open");
  });
}

function openAbility(aid) {
  ensureDetail().then(() => {
    const el = $("#detail");
    const a = (DETAIL.abilities || {})[aid];
    if (!el) {
      return;
    }
    hideDrawer();
    view = { kind: "ability", id: Number(aid) };
    const holders = (abilityToSpecies.get(Number(aid)) || []).slice().sort((x, y) => (x.dex ?? 0) - (y.dex ?? 0));
    const rows = holders
      .map(mon => {
        const sp = DETAIL.species[mon.id];
        const slot = sp.abilities.find(x => x.id === Number(aid))?.slot;
        const tag = { ability1: "Ability", ability2: "Ability", hidden: "Hidden", innate: "Innate" }[slot] || "";
        return `<tr class="lrow"><td>${monLink(mon.id)}</td><td class="num">#${mon.dex ?? "—"}</td><td>${tag}</td></tr>`;
      })
      .join("");
    el.innerHTML = `
      <div class="dt-top">
        <button class="dt-back" data-close>← Back</button>
        <div class="dt-id"><div class="dt-meta">
          <div class="dt-name">${esc(a ? a.name : `Ability #${aid}`)}</div>
          <div class="dt-sub">${esc(a && a.desc ? a.desc : "No description exported by the editor.")}</div>
        </div></div>
      </div>
      <div class="dt-content">
        <div class="btitle">Starter-selectable Pokemon with this ability · ${holders.length}</div>
        <table class="ltable"><thead><tr><th>Pokemon</th><th class="num">Dex</th><th>Slot</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="mv-empty">None in the roster.</td></tr>'}</tbody></table>
      </div>`;
    el.hidden = false;
    el.setAttribute("aria-hidden", "false");
    el.scrollTop = 0;
    document.body.classList.add("detail-open");
  });
}

const indexState = { kind: "moves", q: "" };
function openIndex(kind) {
  ensureDetail().then(() => {
    indexState.kind = kind === "abilities" ? "abilities" : "moves";
    view = { kind: "index" };
    renderIndex();
  });
}
function renderIndex() {
  const el = $("#detail");
  if (!el) {
    return;
  }
  hideDrawer();
  const q = indexState.q.trim().toLowerCase();
  let rows = "";
  if (indexState.kind === "moves") {
    const items = Object.entries(DETAIL.moves)
      .filter(
        ([id, mv]) => (moveToSpecies.get(Number(id)) || []).length > 0 && (!q || mv.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    rows = items
      .map(
        ([id, mv]) =>
          `<tr class="lrow" data-move="${id}"><td class="mv-n">${esc(mv.name)}</td><td><span class="tchip" style="background:${typeColor(mv.type)}">${esc(titleType(mv.type))}</span></td><td class="mv-cat ${(mv.category || "").toLowerCase()}">${esc(titleType(mv.category) || "—")}</td><td class="num">${mv.power || "—"}</td><td class="num">${(moveToSpecies.get(Number(id)) || []).length}</td></tr>`,
      )
      .join("");
  } else {
    const items = Object.entries(DETAIL.abilities)
      .filter(
        ([id, a]) => (abilityToSpecies.get(Number(id)) || []).length > 0 && (!q || a.name.toLowerCase().includes(q)),
      )
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    rows = items
      .map(
        ([id, a]) =>
          `<tr class="lrow" data-ability="${id}"><td class="mv-n">${esc(a.name)}</td><td class="ab-d">${esc((a.desc || "").slice(0, 110))}${(a.desc || "").length > 110 ? "…" : ""}</td><td class="num">${(abilityToSpecies.get(Number(id)) || []).length}</td></tr>`,
      )
      .join("");
  }
  const head =
    indexState.kind === "moves"
      ? "<tr><th>Move</th><th>Type</th><th>Cat</th><th class='num'>Pow</th><th class='num'>#Mons</th></tr>"
      : "<tr><th>Ability</th><th>Effect</th><th class='num'>#Mons</th></tr>";
  el.innerHTML = `
    <div class="dt-top">
      <button class="dt-back" data-close>← Back</button>
      <div class="dt-tabs">
        <button class="dt-tab${indexState.kind === "moves" ? " on" : ""}" data-index="moves">Moves</button>
        <button class="dt-tab${indexState.kind === "abilities" ? " on" : ""}" data-index="abilities">Abilities</button>
      </div>
      <input id="idx-q" class="mv-search" type="search" placeholder="Filter…" value="${esc(indexState.q)}" autocomplete="off" />
    </div>
    <div class="dt-content"><table class="ltable idxtable"><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
  el.hidden = false;
  el.setAttribute("aria-hidden", "false");
  document.body.classList.add("detail-open");
}

function closeDetail() {
  const el = $("#detail");
  if (el) {
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = "";
  }
  document.body.classList.remove("detail-open");
  view = null;
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

// Render the view that matches the URL hash (deep-link, paste, Back/Forward).
//   #<slug>            -> quick side drawer
//   #mon/<slug>        -> full "deck" page
//   #move/<id>, #ability/<id>, #moves, #abilities -> dedicated pages
function syncFromHash() {
  const raw = (location.hash || "").slice(1);
  if (!raw) {
    closeDrawer();
    closeDetail();
    return;
  }
  const [kind, arg] = raw.split("/").map(decodeURIComponent);
  if (kind === "mon" && arg) {
    openDetail(arg);
  } else if (kind === "move" && arg) {
    openMove(arg);
  } else if (kind === "ability" && arg) {
    openAbility(arg);
  } else if (kind === "moves") {
    openIndex("moves");
  } else if (kind === "abilities") {
    openIndex("abilities");
  } else if (bySlugKey.has(raw)) {
    openDrawer(raw); // quick side panel
  } else {
    closeDrawer();
    closeDetail();
  }
}

function openDetail(slug) {
  ensureDetail().then(() => renderDetail(slug));
}

// ---- Quick side drawer (row click) -----------------------------------------
// A fast side panel: stats, run performance, teammates, plus the abilities
// (lazy-loaded) and a button to the full deck page. Reuses the drawer styles.
function openDrawer(key) {
  const mon = bySlugKey.get(key);
  if (!mon) {
    return;
  }
  hideDetail();
  document.body.classList.remove("detail-open");
  const m = STATS[dexKey(mon)];
  const chips = mon.types
    .filter(Boolean)
    .map(t => `<span class="tchip" style="background:${typeColor(t)}">${esc(titleType(t))}</span>`)
    .join("");
  const runBlock = STATS_IS_SAMPLE
    ? ""
    : `<div class="block"><div class="btitle">Run performance${m?.sample ? ` · ${m.sample.toLocaleString()} runs` : ""}</div>${runTiles(m)}</div>`;
  const drawer = $("#drawer");
  drawer.innerHTML = `
    <button class="close" id="drawer-close" title="Close (Esc)">×</button>
    <div class="dhead">
      ${spriteImg(mon, "bigspr")}
      <div class="meta">
        <div class="dtitle">${esc(mon.name)}<small>#${mon.dex ?? "—"} · ${EGG_TIER_NAMES[mon.eggTier] ?? "Not in egg pool"} · Cost ${mon.cost}</small></div>
        <div class="row">${tierBadge(m)} ${chips}</div>
      </div>
    </div>
    <div class="dbody">
      <a class="full-btn" href="#mon/${encodeURIComponent(key)}">View full details: learnset · moves · matchups →</a>
      <div class="block"><div class="btitle">Base stats</div>${statBars(mon)}${overviewHints(mon)}</div>
      <div class="block" id="drawer-abilities"><div class="btitle">Abilities</div><div class="ab-loading">Loading…</div></div>
      ${runBlock}
    </div>`;
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  $("#scrim").classList.add("open");
  currentKey = key;
  document.querySelectorAll("tr.sel").forEach(r => r.classList.remove("sel"));
  document.querySelector(`tr[data-key="${CSS.escape(key)}"]`)?.classList.add("sel");
  const want = `#${encodeURIComponent(key)}`;
  if (location.hash !== want) {
    history.replaceState(null, "", want);
  }
  // Abilities come from the editor-derived detail (lazy); fill once ready.
  ensureDetail().then(() => {
    if (currentKey !== key) {
      return;
    }
    const box = $("#drawer-abilities");
    const sp = DETAIL.species[mon.id];
    if (box) {
      box.innerHTML = `<div class="btitle">Abilities</div>${sp ? abilitiesChips(sp) : '<div class="ab-loading">No data.</div>'}`;
    }
  });
}

function closeDrawer() {
  $("#drawer")?.classList.remove("open");
  $("#drawer")?.setAttribute("aria-hidden", "true");
  $("#scrim")?.classList.remove("open");
  currentKey = null;
  document.querySelectorAll("tr.sel").forEach(r => r.classList.remove("sel"));
  if (location.hash) {
    history.replaceState(null, "", location.pathname + location.search);
  }
}

// ---- Merge real usage feed over the sample ---------------------------------
// Where the real er-assets feed has a line for a species' pokerogue id, prefer
// its real usagePct (→ tier) and lift over the sample. Mark those as real.
function applyRealUsage() {
  if (!usage.loaded) {
    return;
  }
  // Tier comes from the live feed via the M5cap PERFORMANCE model (the same one the
  // game computes), so it AUTO-UPDATES every night with the cron. Usage is the feed's
  // usagePct; absent from the feed = 0% usage (off-meta) -> NU via the egg-floored
  // fallback. Win / pick / lift / wave / teammates stay run-derived.
  const m5 = computeM5capTiers();
  for (const mon of DEX) {
    const line = usage.lines[mon.id];
    const pct = line && typeof line.usagePct === "number" ? line.usagePct : 0;
    const m = (STATS[dexKey(mon)] ??= {});
    m.usagePct = pct;
    const fed = m5.get(mon.id);
    if (fed) {
      m.tier = fed; // live M5cap from a fresh feed
    } else if (m.tier == null) {
      m.tier = tierFor(pct, mon.eggTier); // not in the bundled data nor the feed -> derive
    }
    // else: a stale / empty feed -> KEEP the bundled (already-M5cap) tier, never legacy.
    m.tierIsReal = true;
  }
}

function refreshSamplePill() {
  const pill = $("#sample-pill");
  if (!STATS_IS_SAMPLE) {
    pill.classList.add("real");
    pill.textContent = "Live run data";
    pill.title = `Win / pick / usage / lift / wave / teammates from ${RUN_COUNT.toLocaleString()} real runs. Tiers from the nightly usage feed.`;
    return;
  }
  const anyReal = DEX.some(mon => STATS[dexKey(mon)]?.tierIsReal);
  if (anyReal) {
    pill.classList.add("real");
    pill.textContent = "Live tiers + sample stats";
    pill.title = "Tiers/usage are REAL (nightly feed); win/pick are still sample placeholders.";
  } else {
    pill.classList.remove("real");
    pill.textContent = "Sample data";
    pill.title = "All numbers are deterministic sample placeholders (no real feed loaded).";
  }
}

// ---- Optional account login (filter to owned species) ---------------------
// Auth + save fetch go to the game's own save server; the AES save is decrypted
// in the browser. We persist only the owned-id list locally, never the password
// or token, so the filter survives a refresh without re-login.

function syncAccountUi() {
  const btn = $("#account-btn");
  const wrap = $("#owned-wrap");
  if (!btn || !wrap) {
    return;
  }
  if (ownedSet) {
    btn.textContent = `${accountName} ✕`;
    btn.classList.add("in");
    btn.title = "Log out";
    wrap.hidden = false;
  } else {
    btn.textContent = "Log in";
    btn.classList.remove("in");
    btn.title = "Log in to filter by what you own";
    wrap.hidden = true;
    ownedOnly = false;
    const cb = $("#owned-only");
    if (cb) {
      cb.checked = false;
    }
  }
}

function setOwned(username, ids) {
  accountName = username;
  ownedSet = new Set(ids);
  try {
    localStorage.setItem(OWNED_LS, JSON.stringify({ username, ids, at: Date.now() }));
  } catch {
    /* private mode / storage full: filter still works for this session */
  }
  syncAccountUi();
}

function clearOwned() {
  accountName = "";
  ownedSet = null;
  ownedOnly = false;
  try {
    localStorage.removeItem(OWNED_LS);
  } catch {
    /* ignore */
  }
  syncAccountUi();
  renderRows();
}

function restoreOwned() {
  try {
    const raw = localStorage.getItem(OWNED_LS);
    if (!raw) {
      return;
    }
    const o = JSON.parse(raw);
    if (o && o.username && Array.isArray(o.ids)) {
      accountName = o.username;
      ownedSet = new Set(o.ids.map(Number));
    }
  } catch {
    /* corrupt entry: ignore, user can log in again */
  }
}

// Owned root-species ids from a system save: dexData keys whose caughtAttr is
// non-zero. Keyed by species id, matching dex.json `id`. The cloud save uses
// full keys (caughtAttr), but we also accept the short-key form ($ca, used by
// .prsv exports) defensively. caughtAttr is a bigint serialized as a number or,
// when large, a decimal string, so compare via String().
function ownedIdsFromSave(saveJson) {
  const dex = saveJson && saveJson.dexData ? saveJson.dexData : {};
  const ids = [];
  for (const key of Object.keys(dex)) {
    const e = dex[key];
    if (!e) {
      continue;
    }
    const caught = e.caughtAttr ?? e.$ca;
    const s = caught == null ? "" : String(caught);
    if (s !== "" && s !== "0") {
      ids.push(Number(key));
    }
  }
  return ids;
}

async function doLogin(username, password) {
  const loginRes = await fetch(`${SAVE_API}/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!loginRes.ok) {
    throw new Error(loginRes.status === 401 ? "Invalid username or password." : `Login failed (${loginRes.status}).`);
  }
  const { token } = await loginRes.json();
  if (!token) {
    throw new Error("Login failed (no token returned).");
  }
  const saveRes = await fetch(`${SAVE_API}/savedata/system/get`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (saveRes.status === 404) {
    throw new Error("No cloud save found for this account yet.");
  }
  if (!saveRes.ok) {
    throw new Error(`Could not load your save (${saveRes.status}).`);
  }
  const raw = (await saveRes.text()).trim();
  // The cloud system save is stored as plain JSON (the client uploads it
  // unencrypted; only the localStorage copy is AES'd). Parse JSON directly, and
  // fall back to AES-decrypt with the in-game save key for any encrypted blob.
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    try {
      json = JSON.parse(CryptoJS.AES.decrypt(raw, SAVE_KEY).toString(CryptoJS.enc.Utf8));
    } catch {
      throw new Error("Could not read your save.");
    }
  }
  const ids = ownedIdsFromSave(json);
  if (ids.length === 0) {
    throw new Error("Your save has no caught Pokemon yet.");
  }
  setOwned(username, ids);
}

function openLogin() {
  $("#login-scrim").hidden = false;
  $("#login-modal").hidden = false;
  $("#login-err").hidden = true;
  $("#login-user").focus();
}

function closeLogin() {
  $("#login-scrim").hidden = true;
  $("#login-modal").hidden = true;
}

// ---- Init ------------------------------------------------------------------
const fetchJson = (url, fallback) =>
  fetch(url)
    .then(r => (r.ok ? r.json() : fallback))
    .catch(() => fallback);

let searchTimer = null;

// Measure the sticky header + filter bar so the table's column header pins
// directly beneath them with no dead gap. Heights vary with viewport width and
// chip wrapping, so the offsets are computed rather than hard-coded.
function syncSticky() {
  const head = document.querySelector("header");
  const filters = document.querySelector(".filters");
  const hh = head ? Math.round(head.getBoundingClientRect().height) : 56;
  const fh = filters ? Math.round(filters.getBoundingClientRect().height) : 0;
  const root = document.documentElement.style;
  root.setProperty("--head-h", `${hh}px`);
  root.setProperty("--thead-top", `${hh + fh}px`);
}

// Hover tooltips: any element with data-tip shows a styled floating bubble
// (data-tip-title is an optional bold heading). One delegated listener; the
// bubble is fixed-position, clamps to the viewport, and flips above if there
// is not enough room below. pointer-events:none so it never blocks clicks.
function initTooltips() {
  const tip = document.createElement("div");
  tip.id = "tooltip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let active = null;
  const place = el => {
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    let top = r.bottom + 8;
    if (top + tr.height > window.innerHeight - 8) {
      top = r.top - tr.height - 8;
    }
    tip.style.left = `${Math.round(left)}px`;
    tip.style.top = `${Math.round(top)}px`;
  };
  const show = el => {
    const text = el.getAttribute("data-tip");
    if (!text) {
      return;
    }
    const title = el.getAttribute("data-tip-title");
    tip.innerHTML = (title ? `<div class="tip-title">${esc(title)}</div>` : "") + `<div>${esc(text)}</div>`;
    active = el;
    place(el);
    tip.classList.add("show");
  };
  const hide = () => {
    tip.classList.remove("show");
    active = null;
  };
  document.addEventListener("mouseover", e => {
    const el = e.target.closest?.("[data-tip]");
    if (el && el !== active) {
      show(el);
    }
  });
  document.addEventListener("mouseout", e => {
    if (active && !(e.relatedTarget && active.contains(e.relatedTarget))) {
      const el = e.target.closest?.("[data-tip]");
      if (el === active) {
        hide();
      }
    }
  });
  // The bubble is anchored to a moving element, so drop it on scroll/resize.
  window.addEventListener("scroll", hide, { passive: true });
  window.addEventListener("resize", hide);
}

function renderAll() {
  renderHead();
  renderRows();
}

async function init() {
  try {
    restoreOwned(); // re-hydrate a prior login's owned-id list (if any)
    const [dex, stats] = await Promise.all([
      fetch("./data/dex.json").then(r => r.json()),
      fetchJson(STATS_URL, { species: {} }),
    ]);
    DEX = Array.isArray(dex) ? dex : [];
    // stats.sample.json wraps the per-slug map under `species`; tolerate a bare map too.
    STATS = stats && stats.species ? stats.species : stats || {};
    STATS_IS_SAMPLE = !stats || stats._sample !== false; // sample unless a real feed says otherwise
    RUN_COUNT = stats && typeof stats.totalRuns === "number" ? stats.totalRuns : 0;
    if (stats && stats.meta) {
      if (typeof stats.meta.winMid === "number") {
        winMid = stats.meta.winMid;
      }
      if (typeof stats.meta.winMax === "number") {
        winMax = stats.meta.winMax;
      }
    }
    for (const mon of DEX) {
      bySlugKey.set(dexKey(mon), mon);
    }
    buildIdIndex(); // species id + slug maps for the detail page

    // Populate the type filter dropdown from the canonical set.
    const typeSel = $("#filter-type");
    typeSel.innerHTML =
      '<option value="">All types</option>'
      + Object.keys(TYPE_COLORS)
        .map(t => `<option value="${esc(t)}">${esc(t)}</option>`)
        .join("");

    renderTypeChips();
    renderTierChips();
    renderAll();
    refreshSamplePill();
    $("#count").textContent = `${DEX.length} Pokémon`;

    // Real usage tiers: the SAME nightly er-assets feed the game uses. Prefer
    // its real tier/usage where present; silent fallback to sample on failure.
    fetchJson(`${USAGE_TIERS_URL}?d=${new Date().toISOString().slice(0, 10)}`, null).then(data => {
      if (data && typeof data === "object" && data.lines) {
        usage.lines = data.lines;
        usage.baseWinPct = data.baseWinPct;
        usage.loaded = true;
        applyRealUsage();
        renderRows();
        refreshSamplePill();
      }
    });

    wireEvents();
    syncAccountUi(); // reflect a restored login (reveal the Owned-only toggle)
    initTooltips();
    syncSticky();
    // Re-measure after first paint (fonts/sprites can change header height).
    requestAnimationFrame(syncSticky);
    // Open a deep-linked mon if the URL carries one.
    syncFromHash();
  } catch (err) {
    $("#count").textContent = "Failed to load data.";
    $("#empty").hidden = false;
    $("#empty").textContent = `Failed to load data: ${err}`;
    // eslint-disable-next-line no-console
    console.error("stats init failed", err);
  }
}

function wireEvents() {
  // Debounced search.
  $("#search").addEventListener("input", e => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => {
      searchTerm = v;
      renderRows();
    }, 140);
  });

  $("#filter-type").addEventListener("change", e => {
    filterType = e.target.value;
    renderTypeChips();
    renderRows();
  });
  $("#filter-tier").addEventListener("change", e => {
    filterTier = e.target.value;
    renderTierChips();
    renderRows();
  });
  $("#filter-egg").addEventListener("change", e => {
    filterEgg = e.target.value;
    renderRows();
  });
  $("#filter-samples")?.addEventListener("change", e => {
    minSample = Number(e.target.value) || 0;
    renderRows();
  });

  // Optional login: the button toggles between opening the login modal and
  // logging out; the checkbox filters the grid to owned species.
  $("#account-btn")?.addEventListener("click", () => {
    if (ownedSet) {
      clearOwned();
    } else {
      openLogin();
    }
  });
  $("#owned-only")?.addEventListener("change", e => {
    ownedOnly = e.target.checked;
    renderRows();
  });
  $("#login-close")?.addEventListener("click", closeLogin);
  $("#login-scrim")?.addEventListener("click", closeLogin);
  $("#login-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const user = $("#login-user").value.trim();
    const pass = $("#login-pass").value;
    const err = $("#login-err");
    const submit = $("#login-submit");
    err.hidden = true;
    if (!user || !pass) {
      err.textContent = "Enter your username and password.";
      err.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = "Logging in…";
    try {
      await doLogin(user, pass);
      closeLogin();
      $("#owned-only").checked = true;
      ownedOnly = true;
      renderRows();
    } catch (ex) {
      err.textContent = ex && ex.message ? ex.message : "Login failed.";
      err.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = "Log in";
      $("#login-pass").value = "";
    }
  });

  // Difficulty segmented toggle → switches the win column + drawer.
  $("#diffseg").addEventListener("click", e => {
    const btn = e.target.closest("button[data-diff]");
    if (!btn) {
      return;
    }
    activeDiff = btn.dataset.diff;
    document.querySelectorAll("#diffseg button").forEach(b => b.classList.toggle("on", b === btn));
    renderAll();
    // If a mon detail is open, refresh it for the new difficulty.
    if (view && view.kind === "mon") {
      renderDetail(view.slug);
    }
  });

  // Filter chips (type + tier) toggle.
  $("#type-chips").addEventListener("click", e => {
    const c = e.target.closest("[data-typechip]");
    if (!c) {
      return;
    }
    filterType = filterType === c.dataset.typechip ? "" : c.dataset.typechip;
    $("#filter-type").value = filterType;
    renderTypeChips();
    renderRows();
  });
  $("#tier-chips").addEventListener("click", e => {
    const c = e.target.closest("[data-tierchip]");
    if (!c) {
      return;
    }
    filterTier = filterTier === c.dataset.tierchip ? "" : c.dataset.tierchip;
    $("#filter-tier").value = filterTier;
    renderTierChips();
    renderRows();
  });

  // Sortable headers.
  $("#head-row").addEventListener("click", e => {
    const th = e.target.closest("th[data-sort]");
    if (!th) {
      return;
    }
    const key = th.dataset.sort;
    if (key === sortKey) {
      sortDir = -sortDir;
    } else {
      sortKey = key;
      sortDir = key === "name" ? 1 : -1; // names default A→Z, numbers high→low
    }
    renderAll();
  });

  // Row / card click → open the dedicated detail page (the hash drives the view).
  // Row / card click -> quick side drawer (#slug). Full page is one click away.
  $("#rows").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-key]");
    if (tr) {
      navTo(`#${encodeURIComponent(tr.dataset.key)}`);
    }
  });
  $("#cards").addEventListener("click", e => {
    const card = e.target.closest(".mcard[data-key]");
    if (card) {
      navTo(`#${encodeURIComponent(card.dataset.key)}`);
    }
  });

  // Quick drawer: close button + teammate jump (the Full-details link and the
  // ability cards are anchors that navigate via their href).
  $("#drawer").addEventListener("click", e => {
    if (e.target.closest("#drawer-close")) {
      closeDrawer();
      return;
    }
    const mate = e.target.closest(".mate[data-key]");
    if (mate) {
      navTo(`#${encodeURIComponent(mate.dataset.key)}`);
    }
  });
  // Click the dimmed backdrop to close the drawer.
  $("#scrim").addEventListener("click", closeDrawer);

  // Full deck page: delegated interactions. Anchor links (mon / form / ability
  // cards) navigate via their href -> hashchange; the rest are handled here.
  const detail = $("#detail");
  detail.addEventListener("click", e => {
    if (e.target.closest("[data-close]")) {
      closeDetail();
      return;
    }
    const idx = e.target.closest("[data-index]");
    if (idx) {
      navTo(`#${idx.dataset.index}`);
      return;
    }
    const mv = e.target.closest("[data-move]");
    if (mv) {
      navTo(`#move/${mv.dataset.move}`);
      return;
    }
    const ab = e.target.closest("[data-ability]");
    if (ab) {
      navTo(`#ability/${ab.dataset.ability}`);
      return;
    }
    const mate = e.target.closest(".mate[data-key]");
    if (mate) {
      navTo(`#mon/${encodeURIComponent(mate.dataset.key)}`);
    }
  });
  // Live move filter on the deck page (re-render only the tables, keep focus).
  detail.addEventListener("input", e => {
    if (e.target.id === "mv-q" && view && view.kind === "mon") {
      mvState.q = e.target.value;
      const box = $("#mv-tables");
      if (box) {
        box.innerHTML = movesTables(view.statMon, view.sp);
      }
    } else if (e.target.id === "idx-q") {
      indexState.q = e.target.value;
      renderIndex();
      const q = $("#idx-q");
      if (q) {
        q.focus();
        q.setSelectionRange(q.value.length, q.value.length);
      }
    }
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      // Esc closes the login modal first, then the detail page, then clears search.
      if (!$("#login-modal").hidden) {
        closeLogin();
      } else if (view) {
        closeDetail();
      } else if ($("#drawer").classList.contains("open")) {
        closeDrawer();
      } else if ($("#search").value) {
        $("#search").value = "";
        searchTerm = "";
        renderRows();
      } else {
        $("#search").blur();
      }
      return;
    }
    // "/" jumps to the search box (unless already typing in a form field).
    const tag = (e.target.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || tag === "select";
    if (e.key === "/" && !typing) {
      e.preventDefault();
      const s = $("#search");
      s.focus();
      s.select();
    }
  });

  // Re-measure the sticky offsets as the layout reflows (chip wrap, zoom).
  let stickyRaf = 0;
  const reSync = () => {
    cancelAnimationFrame(stickyRaf);
    stickyRaf = requestAnimationFrame(syncSticky);
  };
  window.addEventListener("resize", reSync);
  // The header / filter bar can change height without a window resize (web font
  // loading, the count text, chips wrapping). Observe them so the column header
  // never pins at a stale offset and overlaps rows.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(reSync);
    const h = document.querySelector("header");
    const f = document.querySelector(".filters");
    if (h) {
      ro.observe(h);
    }
    if (f) {
      ro.observe(f);
    }
  }
  if (document.fonts?.ready) {
    document.fonts.ready.then(syncSticky);
  }
  // Deep-link: open/close the drawer to match the URL hash (paste, Back/Forward).
  window.addEventListener("hashchange", syncFromHash);
}

init();
