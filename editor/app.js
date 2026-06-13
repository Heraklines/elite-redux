/*
 * Elite Redux — team balancing editor SPA.
 * Reads live data from public GitHub raw; commits edits via the er-editor-api
 * Worker (delta-only saves, merge-committed server-side so concurrent editors
 * don't clobber each other). Tabs: Egg Moves | Species | Items | Trainers.
 */

// ---- Config (edit if URLs change) ------------------------------------------
const WORKER_URL = "https://er-editor-api.heraklines.workers.dev"; // er-editor-api Worker
const REPO = "Heraklines/elite-redux";
const BRANCH = "feat/elite-redux-port";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/src/data/elite-redux`;
const SPRITE_BASE = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/images/pokemon/elite-redux";
const USAGE_TIERS_URL = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/usage-tiers.json";

const EGG_TIER_NAMES = ["Common", "Rare", "Epic", "Legendary"];
const ITEM_TIERS = ["COMMON", "GREAT", "ULTRA", "ROGUE", "MASTER"];
// ER community held items (the only ones with an editable stack cap) → base cap.
const ER_MAX_STACK_BASE = {
  ER_CHILI_SAMPLE: 1,
  ER_COPPER_ROD: 1,
  ER_RUSTY_CLAW: 1,
  ER_SPIKED_KNUCKLES: 1,
  ER_LOADED_DICE: 3,
  ER_LUCKY_HEART: 2,
  ER_OMNI_GEM: 1,
  ER_POWER_HERB: 1,
};

// ---- State -----------------------------------------------------------------
let SPECIES = []; // [{const, name, slug, id, dex, eggTier, cost}]
let MOVES = [];
const MOVE_SET = new Set();
let ITEMS = []; // [{key, tier, weight, maxWeight}]
let TRAINER_DEFAULTS = { elite: {}, hell: {} };
let FACTORY_SPECIES = []; // [{const, name, sets}]
let KNOBS = []; // balance-knob registry rows (editor/data/balance-knobs.json)

// Per-domain current/baseline (baseline = last saved; dirty = current != baseline).
const egg = { current: {}, baseline: {} }; // const → [moves]
const sp = { current: {}, baseline: {} }; // const → {eggTier, cost}
const item = { current: {}, baseline: {} }; // key → {tier, weight, maxStack} ("" = no override)
const tr = { current: null, baseline: null }; // {freq: {elite:{...}, hell:{...}}, excluded: [...]}
// Balance knobs: key → override value in JSON form (absent = no override).
// Maps store ONLY the overridden entries ({entryKey: number}).
const bal = { current: {}, baseline: {} };

// Usage tiers (fetched at runtime; graceful "unranked" fallback when missing).
const usage = { loaded: false, lines: {} };

let activeTab = "eggmoves";

// Per-edit undo for EGG MOVES (the free-text inputs): each committed slot
// change pushes {const, before}. `committed` is the last settled snapshot.
const undoStack = [];
let committed = {};

const $ = sel => document.querySelector(sel);
const statusEl = $("#status");
const saveBtn = $("#save");
const deployBtn = $("#deploy");
const undoBtn = $("#undo");
const ERR = "#c0392b";

const prettify = name =>
  name
    .toLowerCase()
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

function setStatus(msg, color) {
  statusEl.textContent = msg;
  statusEl.style.color = color || "var(--muted)";
}

// ---- Usage tiers -------------------------------------------------------------
// Band thresholds mirror src/data/elite-redux/er-usage-tiers.ts: a line is OU
// when its usage fails the UU gate (>= 2.25%), and so on down. The species'
// EGG tier also gates the floor (Legendary lines can never drop below OU etc.),
// matching the in-game challenge legality.
const BANDS = ["OU", "UU", "RU", "PU", "NU"];

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
  // LEGENDARY → OU floor, EPIC → UU, RARE → RU, COMMON/none → no floor.
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

/** Effective tier badge for a species, or null when usage data is unavailable. */
function usageTierOf(s) {
  if (!usage.loaded) {
    return null;
  }
  const pct = usage.lines[s.id]?.usagePct ?? 0;
  const effective = Math.min(usageBandIndex(pct), eggBandIndex(currentEggTierOf(s)));
  return BANDS[effective];
}

function usagePctOf(s) {
  return usage.lines[s.id]?.usagePct ?? 0;
}

function currentEggTierOf(s) {
  const cur = sp.current[s.const];
  return cur && cur.eggTier !== null && cur.eggTier !== "" ? Number(cur.eggTier) : s.eggTier;
}

function tierBadge(s) {
  const tier = usageTierOf(s);
  return tier === null
    ? '<span class="badge">unranked</span>'
    : `<span class="badge tier-${tier}" title="usage ${usagePctOf(s).toFixed(2)}%">${tier}</span>`;
}

// ---- Dirty tracking ----------------------------------------------------------
const jsonEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function dirtyCounts() {
  let eggN = 0;
  let spN = 0;
  let itemN = 0;
  let trN = 0;
  for (const s of SPECIES) {
    if (!jsonEq(egg.current[s.const] || [], egg.baseline[s.const] || [])) {
      eggN++;
    }
    if (!jsonEq(sp.current[s.const], sp.baseline[s.const])) {
      spN++;
    }
  }
  for (const it of ITEMS) {
    if (!jsonEq(item.current[it.key], item.baseline[it.key])) {
      itemN++;
    }
  }
  if (tr.current && !jsonEq(tr.current.freq, tr.baseline.freq)) {
    trN++;
  }
  if (tr.current && !jsonEq(tr.current.excluded, tr.baseline.excluded)) {
    trN++;
  }
  let balN = 0;
  for (const knob of KNOBS) {
    if (!jsonEq(bal.current[knob.key], bal.baseline[knob.key])) {
      balN++;
    }
  }
  return { eggN, spN, itemN, trN, balN, total: eggN + spN + itemN + trN + balN };
}

function refreshChrome() {
  const { eggN, spN, itemN, trN, balN, total } = dirtyCounts();
  saveBtn.textContent = `Save ${total} change${total === 1 ? "" : "s"}`;
  saveBtn.disabled = total === 0;
  const dots = { eggmoves: eggN, species: spN, items: itemN, trainers: trN, game: balN };
  document.querySelectorAll("nav.tabs button").forEach(b => {
    const n = dots[b.dataset.tab];
    const label = b.textContent.replace(/\s*●$/, "");
    b.innerHTML = n > 0 ? `${esc(label)}<span class="dot">●</span>` : esc(label);
  });
  undoBtn.textContent = undoStack.length > 0 ? `↶ Undo (${undoStack.length})` : "↶ Undo";
  undoBtn.disabled = undoStack.length === 0 || activeTab !== "eggmoves";
}

// ---- Sorting / filtering -----------------------------------------------------
function sortedSpecies() {
  const mode = $("#sort").value;
  const list = [...SPECIES];
  if (mode === "dex") {
    list.sort((a, b) => (a.dex ?? 99999) - (b.dex ?? 99999) || a.name.localeCompare(b.name));
  } else if (mode === "usage") {
    list.sort((a, b) => {
      const ta = usageTierOf(a);
      const tb = usageTierOf(b);
      if (ta === null || tb === null) {
        return a.name.localeCompare(b.name);
      }
      return BANDS.indexOf(ta) - BANDS.indexOf(tb) || usagePctOf(b) - usagePctOf(a) || a.name.localeCompare(b.name);
    });
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  const f = ($("#search").value || "").trim().toLowerCase();
  return f ? list.filter(s => s.name.toLowerCase().includes(f) || s.const.toLowerCase().includes(f)) : list;
}

// ---- Egg Moves tab -----------------------------------------------------------
function slotsHtml(speciesConst) {
  const moves = egg.current[speciesConst] || [];
  let html = "";
  for (let i = 0; i < 4; i++) {
    const val = moves[i] || "";
    html += `<input class="slot" list="moves-list" data-const="${speciesConst}" data-slot="${i}" value="${esc(val)}" placeholder="—" spellcheck="false" />`;
  }
  return html;
}

function renderEggMoves(root) {
  const visible = sortedSpecies();
  root.innerHTML = `<div id="grid">${visible
    .map(s => {
      const sprite = s.slug ? `${SPRITE_BASE}/${s.slug}/front.png` : "";
      const dirty = !jsonEq(egg.current[s.const] || [], egg.baseline[s.const] || []);
      return `<div class="card${dirty ? " dirty" : ""}" data-card="${s.const}">
        <img src="${sprite}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="body">
          <div class="name">${esc(s.name)} <small>#${s.dex ?? "—"}</small><span class="badges">${tierBadge(s)}</span></div>
          <div class="slots">${slotsHtml(s.const)}</div>
        </div>
      </div>`;
    })
    .join("")}</div>${visible.length === 0 ? '<div class="empty">No species match your search.</div>' : ""}`;
}

function refreshEggCard(speciesConst) {
  const card = document.querySelector(`.card[data-card="${CSS.escape(speciesConst)}"]`);
  if (!card) {
    return;
  }
  const moves = egg.current[speciesConst] || [];
  card.querySelectorAll(".slot").forEach((inp, i) => {
    inp.value = moves[i] || "";
    inp.style.borderColor = inp.value === "" || MOVE_SET.has(inp.value) ? "" : ERR;
  });
  card.classList.toggle("dirty", !jsonEq(egg.current[speciesConst] || [], egg.baseline[speciesConst] || []));
}

function pushUndoIfChanged(speciesConst) {
  const now = JSON.stringify(egg.current[speciesConst] || []);
  const was = JSON.stringify(committed[speciesConst] || []);
  if (now !== was) {
    undoStack.push({ const: speciesConst, before: (committed[speciesConst] || []).slice() });
    committed[speciesConst] = (egg.current[speciesConst] || []).slice();
    refreshChrome();
  }
}

function undo() {
  const last = undoStack.pop();
  if (!last) {
    return;
  }
  egg.current[last.const] = last.before.slice();
  committed[last.const] = last.before.slice();
  refreshEggCard(last.const);
  refreshChrome();
  setStatus(`Reverted ${last.const.replace(/^SPECIES_/, "")} (one step back).`);
}

// ---- Species tab (egg tier + starter cost) ------------------------------------
function renderSpecies(root) {
  const visible = sortedSpecies();
  root.innerHTML = `<div id="grid">${visible
    .map(s => {
      const cur = sp.current[s.const];
      const sprite = s.slug ? `${SPRITE_BASE}/${s.slug}/front.png` : "";
      const dirty = !jsonEq(cur, sp.baseline[s.const]);
      const tierSelect =
        s.eggTier === null
          ? '<span class="dyn" title="This species is not in the egg pool (battle-only or banned), so it has no egg rarity.">not in egg pool</span>'
          : `<select class="sp-tier" data-const="${s.const}">${EGG_TIER_NAMES.map(
              (n, i) => `<option value="${i}"${Number(cur.eggTier) === i ? " selected" : ""}>${n}</option>`,
            ).join("")}</select>`;
      return `<div class="card${dirty ? " dirty" : ""}" data-card="${s.const}">
        <img src="${sprite}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="body">
          <div class="name">${esc(s.name)} <small>#${s.dex ?? "—"}</small><span class="badges">${tierBadge(s)}</span></div>
          <div class="fields">
            <label>Egg tier ${tierSelect}</label>
            <label>Cost <input type="number" class="sp-cost" data-const="${s.const}" min="1" max="50" step="1" value="${esc(cur.cost)}" /></label>
          </div>
        </div>
      </div>`;
    })
    .join("")}</div>${visible.length === 0 ? '<div class="empty">No species match your search.</div>' : ""}`;
}

// ---- Items tab -----------------------------------------------------------------
function renderItems(root) {
  const f = ($("#search").value || "").trim().toLowerCase();
  const visible = ITEMS.filter(it => !f || it.key.toLowerCase().includes(f));
  root.innerHTML = `<div id="grid" class="wide">${visible
    .map(it => {
      const cur = item.current[it.key];
      const dirty = !jsonEq(cur, item.baseline[it.key]);
      const dynamic = it.weight === null;
      const stackable = Object.hasOwn(ER_MAX_STACK_BASE, it.key);
      return `<div class="card${dirty ? " dirty" : ""}" data-card="${it.key}">
        <div class="body">
          <div class="name">${prettify(it.key)} <small>${it.key}</small>${dynamic ? ' <span class="dyn" title="This item’s weight is computed dynamically (party-dependent). Entering a number replaces it with a constant; clearing the box restores the dynamic weight.">dynamic weight</span>' : ""}</div>
          <div class="fields">
            <label>Tier <select class="it-tier" data-key="${it.key}">${ITEM_TIERS.map(
              t => `<option value="${t}"${cur.tier === t ? " selected" : ""}>${t}</option>`,
            ).join("")}</select></label>
            <label>Weight <input type="number" class="it-weight" data-key="${it.key}" min="0" max="1000" step="1" value="${esc(cur.weight)}" placeholder="${dynamic ? "dyn" : ""}" /></label>
            ${stackable ? `<label>Max stack <input type="number" class="it-stack" data-key="${it.key}" min="1" max="99" step="1" value="${esc(cur.maxStack)}" /></label>` : ""}
          </div>
        </div>
      </div>`;
    })
    .join("")}</div>${visible.length === 0 ? '<div class="empty">No items match your search.</div>' : ""}`;
}

// ---- Trainers tab ---------------------------------------------------------------
let factoryFilter = "all"; // all | excluded

// One knob cell: the input always shows the EFFECTIVE value (default prefilled).
// Typing a different number creates an override ("overridden" badge + a reset
// button); typing the default back (or clicking reset) removes the override.
function knobCell(diff, knob, help) {
  const cur = tr.current.freq[diff];
  const def = TRAINER_DEFAULTS[diff]?.[knob];
  const overridden = cur[knob] !== "";
  const shown = overridden ? cur[knob] : def;
  const min = knob === "trainerCadence" ? 1 : 0;
  const max = knob === "trainerCadence" ? 50 : 100;
  return `<td><div class="knob-cell">
    <input type="number" class="tr-knob" data-diff="${diff}" data-knob="${knob}" min="${min}" max="${max}" step="1"
      value="${esc(shown)}" title="${help} Default: ${def}." />
    ${
      overridden
        ? `<span class="badge override">overridden</span><button type="button" class="tr-reset" data-diff="${diff}" data-knob="${knob}" title="Back to the default (${def})">↺ ${def}</button>`
        : '<span class="badge" title="Using the game default">default</span>'
    }
  </div></td>`;
}

function renderTrainers(root) {
  const f = ($("#search").value || "").trim().toLowerCase();
  const cur = tr.current;
  const excluded = new Set(cur.excluded);
  let visible = FACTORY_SPECIES.filter(
    s => !f || s.name.toLowerCase().includes(f) || s.const.toLowerCase().includes(f),
  );
  if (factoryFilter === "excluded") {
    visible = visible.filter(s => excluded.has(s.const));
  }
  root.innerHTML = `
    <div class="section">
      <h2>Battle frequency <small style="font-weight:400;color:var(--muted)">(Elite and Hell only)</small></h2>
      <p class="hint">The number in each box is what the game uses. Type a new number to change it; the ↺ button puts it back to the default. Ace and Youngster always play normal PokeRogue pacing.</p>
      <table class="knob-table">
        <thead><tr>
          <th></th>
          <th>Trainer battle every … waves <span class="qm" title="Forces a regular trainer battle every Nth eligible wave. LOWER number = MORE trainer fights. Boss, rival and scripted waves are never affected.">?</span></th>
          <th>Battle Factory team chance % <span class="qm" title="Chance that an eligible trainer wave fields a competitive Battle Factory team instead of its normal roster.">?</span></th>
        </tr></thead>
        <tbody>
          <tr><th>Elite</th>${knobCell("elite", "trainerCadence", "Forces a trainer battle every Nth eligible wave on Elite. Lower = more fights.")}${knobCell("elite", "factoryTeamPct", "Chance an eligible Elite trainer wave uses a Battle Factory team.")}</tr>
          <tr><th>Hell</th>${knobCell("hell", "trainerCadence", "Forces a trainer battle every Nth eligible wave on Hell. Lower = more fights.")}${knobCell("hell", "factoryTeamPct", "Chance an eligible Hell trainer wave uses a Battle Factory team.")}</tr>
        </tbody>
      </table>
    </div>
    <div class="section" style="margin-bottom:0">
      <h2>Battle Factory species</h2>
      <p class="hint">Click a card to toggle it. <b style="color:var(--ok)">✓ IN POOL</b> = its sets can appear on factory teams. <b style="color:#e0556a">✗ EXCLUDED</b> = all its sets are removed from the pool. Use the search box above to find a species.</p>
      <div class="chips">
        <button type="button" class="chip${factoryFilter === "all" ? " on" : ""}" data-facfilter="all">All (${FACTORY_SPECIES.length})</button>
        <button type="button" class="chip${factoryFilter === "excluded" ? " on" : ""}" data-facfilter="excluded">Excluded (${cur.excluded.length})</button>
      </div>
    </div>
    <div class="factory-list">${visible
      .map(s => {
        const out = excluded.has(s.const);
        const dirty = out !== tr.baseline.excluded.includes(s.const);
        const sprite = s.slug ? `${SPRITE_BASE}/${s.slug}/front.png` : "";
        return `<button type="button" class="factory-item${dirty ? " dirty" : ""}${out ? " out" : ""}" data-facconst="${s.const}" title="Click to ${out ? "put back into" : "remove from"} the factory pool">
          <img src="${sprite}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <span class="fname">${esc(s.name)}<small>${s.sets} set${s.sets === 1 ? "" : "s"}</small></span>
          <span class="state">${out ? "✗ EXCLUDED" : "✓ IN POOL"}</span>
        </button>`;
      })
      .join("")}</div>${visible.length === 0 ? '<div class="empty">No species match your search/filter.</div>' : ""}`;
}

// ---- Game tab (balance knobs) -----------------------------------------------
// Each knob row shows the EFFECTIVE value (override or default) with the same
// default/overridden badge + reset treatment as the Trainers tab. Arrays are
// comma-separated, pair ladders are "a:b, a:b", maps get one sub-row per entry.

const fmtArr = a => a.join(", ");
const fmtPairs = p => p.map(x => `${x[0]}:${x[1]}`).join(", ");

function parseKnobText(knob, text) {
  const t = (text || "").trim();
  if (t === "") {
    return { error: "empty" };
  }
  const nums = v => (/^-?\d+(\.\d+)?$/.test(v) ? Number(v) : Number.NaN);
  if (knob.kind === "pairs") {
    const pairs = t.split(",").map(part => part.split(":").map(s => nums(s.trim())));
    if (pairs.some(p => p.length !== 2 || p.some(Number.isNaN))) {
      return { error: "use a:b pairs separated by commas" };
    }
    return { value: pairs };
  }
  const arr = t.split(",").map(s => nums(s.trim()));
  if (arr.some(Number.isNaN)) {
    return { error: "use numbers separated by commas" };
  }
  return { value: arr };
}

function knobValueError(knob, value) {
  const okNum = v =>
    typeof v === "number"
    && Number.isFinite(v)
    && v >= knob.min
    && v <= knob.max
    && (!knob.integer || Number.isInteger(v));
  const ordered = (vals, ordering) => {
    for (let i = 1; i < vals.length; i++) {
      if (ordering === "asc" ? vals[i] < vals[i - 1] : vals[i] > vals[i - 1]) {
        return false;
      }
    }
    return true;
  };
  const range = `${knob.min}-${knob.max}${knob.integer ? " (whole numbers)" : ""}`;
  if (knob.kind === "scalar") {
    return okNum(value) ? null : `must be ${range}`;
  }
  if (knob.kind === "array") {
    if (!Array.isArray(value) || (knob.length > 0 && value.length !== knob.length)) {
      return `needs exactly ${knob.length} values`;
    }
    if (!value.every(okNum)) {
      return `every value must be ${range}`;
    }
    if (knob.ordering && !ordered(value, knob.ordering)) {
      return knob.ordering === "asc" ? "values must not decrease" : "values must decrease";
    }
    return null;
  }
  if (knob.kind === "pairs") {
    if (!Array.isArray(value) || value.length === 0 || (knob.length > 0 && value.length > knob.length)) {
      return `needs 1-${knob.length} pairs`;
    }
    if (!value.every(p => Array.isArray(p) && p.length === 2 && p.every(okNum))) {
      return `every number must be ${range}`;
    }
    if (
      !ordered(
        value.map(p => p[0]),
        "asc",
      )
      || !ordered(
        value.map(p => p[1]),
        "asc",
      )
    ) {
      return "both columns must increase";
    }
    return null;
  }
  return null;
}

/** Effective value of a map entry (override or registry default). */
function mapEntryValue(knob, entryKey) {
  const o = bal.current[knob.key];
  return o && typeof o[entryKey] === "number" ? o[entryKey] : knob.default[entryKey];
}

function knobRowHtml(knob) {
  const cur = bal.current[knob.key];
  const overridden = cur !== undefined && (knob.kind !== "map" || Object.keys(cur).length > 0);
  const dirty = !jsonEq(bal.current[knob.key], bal.baseline[knob.key]);
  const badge = overridden
    ? `<span class="badge override">overridden</span><button type="button" class="bal-reset" data-balkey="${knob.key}" title="Back to the default">↺ default</button>`
    : '<span class="badge" title="Using the game default">default</span>';
  const warn = knob.advanced
    ? '<span class="warn-badge" title="Advanced knob - a careless value here reshapes whole runs. The game ignores out-of-range values, but double-check what you type.">⚠ advanced</span>'
    : "";
  let control = "";
  if (knob.kind === "scalar") {
    const shown = overridden ? cur : knob.default;
    control = `<input type="number" class="bal-num" data-balkey="${knob.key}" min="${knob.min}" max="${knob.max}" step="${knob.integer ? 1 : "any"}" value="${esc(shown)}" title="${esc(knob.help)} Default: ${knob.default}." />`;
  } else if (knob.kind === "array" || knob.kind === "pairs") {
    const fmt = knob.kind === "pairs" ? fmtPairs : fmtArr;
    const shown = overridden ? fmt(cur) : fmt(knob.default);
    control = `<input type="text" class="bal-text" data-balkey="${knob.key}" value="${esc(shown)}" spellcheck="false" title="${esc(knob.help)} Default: ${fmt(knob.default)}." />`;
  } else {
    control = `<div class="map-rows">${Object.keys(knob.default)
      .map(entryKey => {
        const entryOverridden = cur && typeof cur[entryKey] === "number";
        return `<div class="map-row"><span class="mkey">${esc(entryKey)}</span>
          <input type="number" class="bal-map" data-balkey="${knob.key}" data-entry="${esc(entryKey)}" min="${knob.min}" max="${knob.max}" step="${knob.integer ? 1 : "any"}" value="${esc(mapEntryValue(knob, entryKey))}" title="${esc(knob.help)} Default: ${knob.default[entryKey]}." />
          ${entryOverridden ? `<button type="button" class="bal-map-reset" data-balkey="${knob.key}" data-entry="${esc(entryKey)}" title="Back to the default (${knob.default[entryKey]})">↺ ${knob.default[entryKey]}</button>` : ""}</div>`;
      })
      .join("")}</div>`;
  }
  return `<div class="knob-row2${dirty ? " dirty" : ""}">
    <span class="klabel">${esc(knob.label)} ${warn}<small>${esc(knob.help)}</small></span>
    ${control}
    <span class="knob-cell">${badge}</span>
  </div>`;
}

function renderGame(root) {
  const f = ($("#search").value || "").trim().toLowerCase();
  const groups = [];
  for (const knob of KNOBS) {
    if (
      f
      && !knob.label.toLowerCase().includes(f)
      && !knob.key.toLowerCase().includes(f)
      && !knob.group.toLowerCase().includes(f)
    ) {
      continue;
    }
    let g = groups.find(x => x.name === knob.group);
    if (!g) {
      g = { name: knob.group, rows: [] };
      groups.push(g);
    }
    g.rows.push(knobRowHtml(knob));
  }
  root.innerHTML = `${groups
    .map(
      g => `<div class="section">
      <h2>${esc(g.name)}</h2>
      ${g.rows.join("")}
    </div>`,
    )
    .join("")}${groups.length === 0 ? '<div class="empty">No knobs match your search.</div>' : ""}
    <p class="hint" style="margin:0 16px 16px;color:var(--muted);font-size:12px">Every value here is validated twice: the editor refuses obviously bad input, and the game itself ignores any out-of-range override and keeps its default - a bad save cannot break a build.</p>`;
}

// ---- Render dispatch --------------------------------------------------------------
function render() {
  const root = $("#content");
  if (activeTab === "eggmoves") {
    renderEggMoves(root);
  } else if (activeTab === "species") {
    renderSpecies(root);
  } else if (activeTab === "items") {
    renderItems(root);
  } else if (activeTab === "trainers") {
    renderTrainers(root);
  } else {
    renderGame(root);
  }
  refreshChrome();
}

// ---- Input handlers -----------------------------------------------------------------
function onInput(e) {
  const el = e.target;
  if (el.classList.contains("slot")) {
    const speciesConst = el.dataset.const;
    const value = el.value.trim().toUpperCase();
    el.value = value;
    const arr = (egg.current[speciesConst] || []).slice();
    arr[Number(el.dataset.slot)] = value;
    egg.current[speciesConst] = arr;
    el.style.borderColor = value === "" || MOVE_SET.has(value) ? "" : ERR;
    el.closest(".card").classList.toggle("dirty", !jsonEq(egg.current[speciesConst], egg.baseline[speciesConst] || []));
  } else if (el.classList.contains("sp-tier") || el.classList.contains("sp-cost")) {
    const c = el.dataset.const;
    const cur = { ...sp.current[c] };
    if (el.classList.contains("sp-tier")) {
      cur.eggTier = Number(el.value);
    } else {
      cur.cost = el.value === "" ? "" : Number(el.value);
      const bad = cur.cost === "" || !(cur.cost >= 1 && cur.cost <= 50);
      el.style.borderColor = bad ? ERR : "";
    }
    sp.current[c] = cur;
    el.closest(".card").classList.toggle("dirty", !jsonEq(sp.current[c], sp.baseline[c]));
  } else if (
    el.classList.contains("it-tier")
    || el.classList.contains("it-weight")
    || el.classList.contains("it-stack")
  ) {
    const k = el.dataset.key;
    const cur = { ...item.current[k] };
    if (el.classList.contains("it-tier")) {
      cur.tier = el.value;
    } else if (el.classList.contains("it-weight")) {
      cur.weight = el.value === "" ? "" : Number(el.value);
      el.style.borderColor = cur.weight === "" || (cur.weight >= 0 && cur.weight <= 1000) ? "" : ERR;
    } else {
      cur.maxStack = el.value === "" ? "" : Number(el.value);
      el.style.borderColor =
        cur.maxStack === "" || (Number.isInteger(cur.maxStack) && cur.maxStack >= 1 && cur.maxStack <= 99) ? "" : ERR;
    }
    item.current[k] = cur;
    el.closest(".card").classList.toggle("dirty", !jsonEq(item.current[k], item.baseline[k]));
  } else if (el.classList.contains("tr-knob")) {
    // The box shows the EFFECTIVE value; typing the default back removes the override.
    const def = TRAINER_DEFAULTS[el.dataset.diff]?.[el.dataset.knob];
    const v = el.value === "" ? "" : Number(el.value);
    tr.current.freq[el.dataset.diff][el.dataset.knob] = v === def ? "" : v;
    const max = el.dataset.knob === "trainerCadence" ? 50 : 100;
    const min = el.dataset.knob === "trainerCadence" ? 1 : 0;
    el.style.borderColor = v === "" || (v >= min && v <= max) ? "" : ERR;
  } else if (
    el.classList.contains("bal-num")
    || el.classList.contains("bal-text")
    || el.classList.contains("bal-map")
  ) {
    const knob = KNOBS.find(k => k.key === el.dataset.balkey);
    if (!knob) {
      return;
    }
    if (el.classList.contains("bal-num")) {
      const v = el.value === "" ? Number.NaN : Number(el.value);
      if (v === knob.default) {
        delete bal.current[knob.key];
        el.style.borderColor = "";
      } else {
        bal.current[knob.key] = v;
        el.style.borderColor = knobValueError(knob, v) ? ERR : "";
      }
    } else if (el.classList.contains("bal-map")) {
      const entry = el.dataset.entry;
      const v = el.value === "" ? Number.NaN : Number(el.value);
      const cur = { ...(bal.current[knob.key] || {}) };
      if (v === knob.default[entry]) {
        delete cur[entry];
      } else {
        cur[entry] = v;
      }
      if (Object.keys(cur).length === 0) {
        delete bal.current[knob.key];
      } else {
        bal.current[knob.key] = cur;
      }
      const bad = !(
        typeof v === "number"
        && Number.isFinite(v)
        && v >= knob.min
        && v <= knob.max
        && (!knob.integer || Number.isInteger(v))
      );
      el.style.borderColor = v === knob.default[entry] || !bad ? "" : ERR;
    } else {
      const parsed = parseKnobText(knob, el.value);
      if (parsed.error) {
        bal.current[knob.key] = { __invalid: el.value };
        el.style.borderColor = ERR;
      } else if (jsonEq(parsed.value, knob.default)) {
        delete bal.current[knob.key];
        el.style.borderColor = "";
      } else {
        bal.current[knob.key] = parsed.value;
        el.style.borderColor = knobValueError(knob, parsed.value) ? ERR : "";
      }
    }
    el.closest(".knob-row2")?.classList.toggle("dirty", !jsonEq(bal.current[knob.key], bal.baseline[knob.key]));
  } else {
    return;
  }
  refreshChrome();
}

// Click targets on the Trainers tab (toggle cards, knob resets, filter chips).
function onClick(e) {
  const fac = e.target.closest(".factory-item");
  if (fac) {
    const c = fac.dataset.facconst;
    const set = new Set(tr.current.excluded);
    if (set.has(c)) {
      set.delete(c);
    } else {
      set.add(c);
    }
    tr.current.excluded = [...set].sort();
    render();
    return;
  }
  const reset = e.target.closest(".tr-reset");
  if (reset) {
    tr.current.freq[reset.dataset.diff][reset.dataset.knob] = "";
    render();
    return;
  }
  const chip = e.target.closest(".chip");
  if (chip) {
    factoryFilter = chip.dataset.facfilter;
    render();
    return;
  }
  const balReset = e.target.closest(".bal-reset");
  if (balReset) {
    delete bal.current[balReset.dataset.balkey];
    render();
    return;
  }
  const balMapReset = e.target.closest(".bal-map-reset");
  if (balMapReset) {
    const cur = { ...(bal.current[balMapReset.dataset.balkey] || {}) };
    delete cur[balMapReset.dataset.entry];
    if (Object.keys(cur).length === 0) {
      delete bal.current[balMapReset.dataset.balkey];
    } else {
      bal.current[balMapReset.dataset.balkey] = cur;
    }
    render();
  }
}

// ---- Delta building -----------------------------------------------------------------
function buildDeltas() {
  const bad = [];
  const deltas = {}; // file → delta object

  // Egg moves: only changed species, 1-4 valid move names.
  const eggDelta = {};
  for (const s of SPECIES) {
    if (jsonEq(egg.current[s.const] || [], egg.baseline[s.const] || [])) {
      continue;
    }
    const moves = (egg.current[s.const] || []).map(m => (m || "").trim().toUpperCase()).filter(Boolean);
    if (moves.length === 0) {
      bad.push(`${s.name}: needs at least 1 egg move`);
      continue;
    }
    for (const m of moves) {
      if (!MOVE_SET.has(m)) {
        bad.push(`${s.name}: unknown move "${m}"`);
      }
    }
    eggDelta[s.const] = moves;
  }
  if (Object.keys(eggDelta).length > 0) {
    deltas["egg-moves"] = eggDelta;
  }

  // Species tuning: changed fields only.
  const spDelta = {};
  for (const s of SPECIES) {
    const cur = sp.current[s.const];
    const base = sp.baseline[s.const];
    if (jsonEq(cur, base)) {
      continue;
    }
    const entry = {};
    if (cur.eggTier !== base.eggTier && s.eggTier !== null) {
      entry.eggTier = Number(cur.eggTier);
    }
    if (cur.cost !== base.cost) {
      if (!(typeof cur.cost === "number" && cur.cost >= 1 && cur.cost <= 50)) {
        bad.push(`${s.name}: cost must be 1-50`);
        continue;
      }
      entry.cost = cur.cost;
    }
    if (Object.keys(entry).length > 0) {
      spDelta[s.const] = entry;
    }
  }
  if (Object.keys(spDelta).length > 0) {
    deltas["species-tuning"] = spDelta;
  }

  // Item tuning: changed fields; clearing an override sends null (delete).
  const itemDelta = {};
  for (const it of ITEMS) {
    const cur = item.current[it.key];
    const base = item.baseline[it.key];
    if (jsonEq(cur, base)) {
      continue;
    }
    const entry = {};
    if (cur.tier !== base.tier) {
      entry.tier = cur.tier;
    }
    if (cur.weight !== base.weight) {
      if (cur.weight === "") {
        if (it.weight === null) {
          entry.weight = null; // back to the dynamic weight
        } else {
          bad.push(`${prettify(it.key)}: weight must be 0-1000`);
          continue;
        }
      } else if (typeof cur.weight === "number" && cur.weight >= 0 && cur.weight <= 1000) {
        entry.weight = cur.weight;
      } else {
        bad.push(`${prettify(it.key)}: weight must be 0-1000`);
        continue;
      }
    }
    if (cur.maxStack !== base.maxStack && cur.maxStack !== undefined) {
      if (Number.isInteger(cur.maxStack) && cur.maxStack >= 1 && cur.maxStack <= 99) {
        entry.maxStack = cur.maxStack;
      } else {
        bad.push(`${prettify(it.key)}: max stack must be 1-99`);
        continue;
      }
    }
    if (Object.keys(entry).length > 0) {
      itemDelta[it.key] = entry;
    }
  }
  if (Object.keys(itemDelta).length > 0) {
    deltas["item-tuning"] = itemDelta;
  }

  // Trainer tuning: changed knobs ("" clears the override → null) + exclusions.
  if (tr.current) {
    const trDelta = {};
    const freq = {};
    for (const diff of ["elite", "hell"]) {
      const knobs = {};
      for (const knob of ["trainerCadence", "factoryTeamPct"]) {
        const cur = tr.current.freq[diff][knob];
        const base = tr.baseline.freq[diff][knob];
        if (cur === base) {
          continue;
        }
        if (cur === "") {
          knobs[knob] = null;
        } else {
          const max = knob === "trainerCadence" ? 50 : 100;
          const min = knob === "trainerCadence" ? 1 : 0;
          if (typeof cur === "number" && cur >= min && cur <= max) {
            knobs[knob] = cur;
          } else {
            bad.push(`${diff} ${knob}: must be ${min}-${max}`);
          }
        }
      }
      if (Object.keys(knobs).length > 0) {
        freq[diff] = knobs;
      }
    }
    if (Object.keys(freq).length > 0) {
      trDelta.frequency = freq;
    }
    if (!jsonEq(tr.current.excluded, tr.baseline.excluded)) {
      trDelta.sets = { factoryExcludeSpecies: tr.current.excluded };
    }
    if (Object.keys(trDelta).length > 0) {
      deltas["trainer-tuning"] = trDelta;
    }
  }

  // Balance knobs: changed keys only; a removed override sends null (delete).
  const balDelta = {};
  for (const knob of KNOBS) {
    const cur = bal.current[knob.key];
    const base = bal.baseline[knob.key];
    if (jsonEq(cur, base)) {
      continue;
    }
    if (cur === undefined) {
      balDelta[knob.key] = null;
      continue;
    }
    if (cur && cur.__invalid !== undefined) {
      bad.push(`${knob.label}: could not read the value`);
      continue;
    }
    if (knob.kind === "map") {
      const err = Object.values(cur).some(
        v =>
          !(
            typeof v === "number"
            && Number.isFinite(v)
            && v >= knob.min
            && v <= knob.max
            && (!knob.integer || Number.isInteger(v))
          ),
      );
      if (err) {
        bad.push(`${knob.label}: every value must be ${knob.min}-${knob.max}`);
        continue;
      }
      // Per-entry delta: overridden entries + null for entries the baseline had.
      const entryDelta = { ...cur };
      for (const entryKey of Object.keys(base || {})) {
        if (entryDelta[entryKey] === undefined) {
          entryDelta[entryKey] = null;
        }
      }
      balDelta[knob.key] = entryDelta;
      continue;
    }
    const err = knobValueError(knob, cur);
    if (err) {
      bad.push(`${knob.label}: ${err}`);
      continue;
    }
    balDelta[knob.key] = cur;
  }
  if (Object.keys(balDelta).length > 0) {
    deltas["balance-tuning"] = balDelta;
  }

  return { deltas, bad };
}

// ---- Save / deploy --------------------------------------------------------------------
async function commit({ deploy }) {
  // Trim: pasted / autofilled passwords often carry a stray space that would 401.
  const password = ($("#password")?.value || "").trim();
  if (!password) {
    setStatus("Enter the editor password first.", ERR);
    return;
  }
  const { deltas, bad } = buildDeltas();
  if (bad.length > 0) {
    setStatus(`Fix ${bad.length} issue(s): ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}`, ERR);
    return;
  }
  const files = Object.keys(deltas);
  if (!deploy && files.length === 0) {
    setStatus("No changes to save.");
    return;
  }
  saveBtn.disabled = true;
  deployBtn.disabled = true;

  try {
    // Deploy-only: nothing changed, just rebuild + ship the current branch.
    if (deploy && files.length === 0) {
      setStatus("Triggering staging deploy…");
      const res = await fetch(`${WORKER_URL}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      setStatus(
        !res.ok || !data.ok
          ? `Deploy failed: ${data.error || res.status}`
          : "Deploy triggered ✓ — staging rebuilds in a few minutes.",
        !res.ok || !data.ok ? ERR : "var(--ok)",
      );
      return;
    }

    const author = $("#author").value;
    let lastSha = "";
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Only the LAST save triggers the (single) deploy.
      const wantDeploy = deploy && i === files.length - 1;
      setStatus(`Saving ${file} (${i + 1}/${files.length})…`);
      const res = await fetch(`${WORKER_URL}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, file, delta: deltas[file], author, deploy: wantDeploy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setStatus(`Save of ${file} failed: ${data.error || res.status} (earlier files saved fine)`, ERR);
        return;
      }
      lastSha = data.commit ? data.commit.slice(0, 7) : "";
      if (wantDeploy && !data.deployed) {
        setStatus(`Saved ✓ ${lastSha} but deploy failed: ${data.deployError || "unknown"}`, ERR);
        return;
      }
      markSaved(file);
    }
    render();
    setStatus(
      deploy
        ? `Saved ✓ ${lastSha} — deploy triggered, live in a few minutes.`
        : `Saved ✓ ${lastSha} — click "Commit & Deploy" to apply it to staging.`,
      "var(--ok)",
    );
  } catch (err) {
    setStatus(`Error: ${err}`, ERR);
  } finally {
    refreshChrome();
    deployBtn.disabled = false;
  }
}

function markSaved(file) {
  if (file === "egg-moves") {
    egg.baseline = JSON.parse(JSON.stringify(egg.current));
    committed = JSON.parse(JSON.stringify(egg.current));
    undoStack.length = 0;
  } else if (file === "species-tuning") {
    sp.baseline = JSON.parse(JSON.stringify(sp.current));
  } else if (file === "item-tuning") {
    item.baseline = JSON.parse(JSON.stringify(item.current));
  } else if (file === "trainer-tuning") {
    tr.baseline = JSON.parse(JSON.stringify(tr.current));
  } else if (file === "balance-tuning") {
    bal.baseline = JSON.parse(JSON.stringify(bal.current));
  }
}

// ---- Init ------------------------------------------------------------------------------
const fetchJson = (url, fallback) =>
  fetch(url)
    .then(r => (r.ok ? r.json() : fallback))
    .catch(() => fallback);

async function init() {
  try {
    const bust = `?t=${Date.now()}`;
    const [species, moves, items, trainers, knobs, eggLive, spLive, itemLive, trLive, balLive] = await Promise.all([
      fetch("./data/species.json").then(r => r.json()),
      fetch("./data/moves.json").then(r => r.json()),
      fetchJson("./data/items.json", []),
      fetchJson("./data/trainers.json", { frequencyDefaults: { elite: {}, hell: {} }, factorySpecies: [] }),
      fetchJson("./data/balance-knobs.json", []),
      // Live override files (resilient: missing on the branch → start empty).
      fetchJson(`${RAW_BASE}/er-egg-moves.json${bust}`, {}),
      fetchJson(`${RAW_BASE}/er-species-tuning.json${bust}`, {}),
      fetchJson(`${RAW_BASE}/er-item-tuning.json${bust}`, {}),
      fetchJson(`${RAW_BASE}/er-trainer-tuning.json${bust}`, {}),
      fetchJson(`${RAW_BASE}/er-balance-tuning.json${bust}`, {}),
    ]);
    SPECIES = species;
    MOVES = moves;
    ITEMS = items;
    TRAINER_DEFAULTS = trainers.frequencyDefaults;
    FACTORY_SPECIES = trainers.factorySpecies;
    KNOBS = knobs;

    // Seed balance-knob overrides from the live tuning file (only keys that
    // are still in the registry; map overrides keep just their own entries).
    for (const knob of KNOBS) {
      if (balLive[knob.key] !== undefined && balLive[knob.key] !== null) {
        bal.current[knob.key] = balLive[knob.key];
      }
    }
    bal.baseline = JSON.parse(JSON.stringify(bal.current));
    for (const m of MOVES) {
      MOVE_SET.add(m);
    }

    // Seed egg moves from the live file (pad to 4 slots for editing).
    for (const s of SPECIES) {
      egg.current[s.const] = (eggLive[s.const] || []).slice(0, 4);
    }
    egg.baseline = JSON.parse(JSON.stringify(egg.current));
    committed = JSON.parse(JSON.stringify(egg.current));

    // Seed species tuning: snapshot values overlaid with any live override.
    for (const s of SPECIES) {
      const o = spLive[s.const] || {};
      sp.current[s.const] = {
        eggTier: s.eggTier === null ? null : typeof o.eggTier === "number" ? o.eggTier : s.eggTier,
        cost: typeof o.cost === "number" ? o.cost : s.cost,
      };
    }
    sp.baseline = JSON.parse(JSON.stringify(sp.current));

    // Seed item tuning the same way ("" = no weight override on a dynamic item).
    for (const it of ITEMS) {
      const o = itemLive[it.key] || {};
      item.current[it.key] = {
        tier: typeof o.tier === "string" ? o.tier : it.tier,
        weight: typeof o.weight === "number" ? o.weight : (it.weight ?? ""),
        ...(Object.hasOwn(ER_MAX_STACK_BASE, it.key)
          ? { maxStack: typeof o.maxStack === "number" ? o.maxStack : ER_MAX_STACK_BASE[it.key] }
          : {}),
      };
    }
    item.baseline = JSON.parse(JSON.stringify(item.current));

    // Seed trainer tuning ("" = no override, default applies).
    const freqOf = diff => ({
      trainerCadence:
        typeof trLive.frequency?.[diff]?.trainerCadence === "number" ? trLive.frequency[diff].trainerCadence : "",
      factoryTeamPct:
        typeof trLive.frequency?.[diff]?.factoryTeamPct === "number" ? trLive.frequency[diff].factoryTeamPct : "",
    });
    tr.current = {
      freq: { elite: freqOf("elite"), hell: freqOf("hell") },
      excluded: [...(trLive.sets?.factoryExcludeSpecies || [])].sort(),
    };
    tr.baseline = JSON.parse(JSON.stringify(tr.current));

    // One shared datalist for all move inputs (light + searchable).
    const dl = document.createElement("datalist");
    dl.id = "moves-list";
    dl.innerHTML = MOVES.map(m => `<option value="${m}">${prettify(m)}</option>`).join("");
    document.body.appendChild(dl);

    render();
    setStatus(`${SPECIES.length} species, ${ITEMS.length} items loaded.`);

    // Usage tiers: same nightly CDN JSON the game uses; "unranked" fallback.
    fetchJson(USAGE_TIERS_URL, null).then(data => {
      if (data && typeof data === "object" && data.lines) {
        usage.lines = data.lines;
        usage.loaded = true;
        if (activeTab === "eggmoves" || activeTab === "species") {
          render();
        }
      }
    });

    const content = $("#content");
    content.addEventListener("input", onInput);
    content.addEventListener("click", onClick);
    // `change` fires once per completed edit (blur / pick from list) → one undo step,
    // and on the Trainers tab it refreshes the default/overridden badges.
    content.addEventListener("change", e => {
      if (e.target.classList.contains("slot")) {
        pushUndoIfChanged(e.target.dataset.const);
      } else if (
        e.target.classList.contains("tr-knob")
        || e.target.classList.contains("bal-num")
        || e.target.classList.contains("bal-text")
        || e.target.classList.contains("bal-map")
      ) {
        render();
      }
    });
    $("#search").addEventListener("input", render);
    $("#sort").addEventListener("change", render);
    document.querySelectorAll("nav.tabs button").forEach(b =>
      b.addEventListener("click", () => {
        activeTab = b.dataset.tab;
        document.querySelectorAll("nav.tabs button").forEach(x => x.classList.toggle("active", x === b));
        render();
      }),
    );
    saveBtn.addEventListener("click", () => commit({ deploy: false }));
    deployBtn.addEventListener("click", () => commit({ deploy: true }));
    undoBtn.addEventListener("click", undo);
  } catch (err) {
    setStatus(`Failed to load data: ${err}`, ERR);
  }
}

init();
