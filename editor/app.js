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
// Factory SET overrides: const → [{moves: [names], abilitySlot}] (absent = shipped sets).
const trSets = { current: {}, baseline: {} };
const expandedFactory = new Set(); // species consts with an open set panel
// Add-a-Mon: live er-custom-mons.json + ability name list for autocomplete.
let MONS_LIVE = {};
let ABILITY_NAMES = [];

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
  for (const s of FACTORY_SPECIES) {
    if (!jsonEq(trSets.current[s.const], trSets.baseline[s.const])) {
      trN++;
    }
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
        const sets = effectiveSets(s);
        const edited = trSets.current[s.const] !== undefined;
        const setsDirty = !jsonEq(trSets.current[s.const], trSets.baseline[s.const]);
        const open = expandedFactory.has(s.const);
        return `<div class="factory-wrap">
        <div class="factory-item${dirty || setsDirty ? " dirty" : ""}${out ? " out" : ""}" data-facopen="${s.const}" role="button" title="Click to view/edit this species' sets" style="${open ? "border-radius:8px 8px 0 0;" : ""}">
          <img src="${sprite}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
          <span class="fname">${esc(s.name)}<small>${sets.length} set${sets.length === 1 ? "" : "s"}${edited ? " (edited)" : ""} ${open ? "▴" : "▾"}</small></span>
          <button type="button" class="toggle${out ? " out-b" : " in"}" data-facconst="${s.const}" title="Click to ${out ? "put back into" : "remove from"} the factory pool">${out ? "✗ EXCLUDED" : "✓ IN POOL"}</button>
        </div>
        ${open ? setPanelHtml(s, sets, edited) : ""}
        </div>`;
      })
      .join("")}</div>${visible.length === 0 ? '<div class="empty">No species match your search/filter.</div>' : ""}`;
}

// ---- Factory SET editor -------------------------------------------------------
/** The sets currently shown for a species: the override if present, else shipped. */
function effectiveSets(s) {
  return trSets.current[s.const] ?? s.setsDetail ?? [];
}

function setPanelHtml(s, sets, edited) {
  const rows = sets
    .map(
      (set, i) => `<div class="set-row" data-setconst="${s.const}" data-setidx="${i}">
        ${[0, 1, 2, 3]
          .map(slot => {
            const val = set.moves[slot] || "";
            const bad = val !== "" && !MOVE_SET.has(val);
            return `<input class="set-move" list="moves-list" data-setconst="${s.const}" data-setidx="${i}" data-slot="${slot}" value="${esc(val)}" placeholder="—" spellcheck="false" style="${bad ? `border-color:${ERR}` : ""}" />`;
          })
          .join("")}
        <select class="set-slot" data-setconst="${s.const}" data-setidx="${i}" title="Which of the species' abilities this set uses">
          ${[0, 1, 2].map(a => `<option value="${a}"${set.abilitySlot === a ? " selected" : ""}>Ability ${a + 1}</option>`).join("")}
        </select>
        <button type="button" class="set-del" data-setconst="${s.const}" data-setidx="${i}" title="Remove this set">✕</button>
      </div>`,
    )
    .join("");
  return `<div class="set-panel">
    ${rows || '<span class="dyn">No sets - this species cannot appear on factory teams.</span>'}
    <div class="set-actions">
      <button type="button" class="set-add" data-setconst="${s.const}">+ add set</button>
      ${edited ? `<span class="badge edited">edited</span><button type="button" class="set-reset" data-setconst="${s.const}" title="Back to the shipped sets">↺ shipped sets</button>` : '<span class="badge" title="These are the shipped Battle Factory sets">shipped</span>'}
    </div>
  </div>`;
}

/** Clone the shipped sets into the override slot the first time a species is edited. */
function ensureSetOverride(speciesConst) {
  if (trSets.current[speciesConst] === undefined) {
    const shipped = FACTORY_SPECIES.find(s => s.const === speciesConst)?.setsDetail ?? [];
    trSets.current[speciesConst] = JSON.parse(JSON.stringify(shipped)).map(set => ({
      moves: [...set.moves],
      abilitySlot: set.abilitySlot,
    }));
  }
  return trSets.current[speciesConst];
}

/** An override identical to the shipped sets is no override at all. */
function normalizeSetOverride(speciesConst) {
  const shipped = FACTORY_SPECIES.find(s => s.const === speciesConst)?.setsDetail ?? [];
  if (jsonEq(trSets.current[speciesConst], shipped) && trSets.baseline[speciesConst] === undefined) {
    delete trSets.current[speciesConst];
  }
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

// ---- Add a Mon tab -------------------------------------------------------------
// Form + sprite studio. Sprites: upload front/back (and optionally a tier-1
// shiny); tier-2/tier-3 shinies are GENERATED by hue-rotating tier 1 by +120°
// and +240° (the same scheme the ER pipeline uses). Saving uploads the sprite
// files + single-frame atlas JSONs to er-assets in one commit, then commits
// the mon's entry to er-custom-mons.json.

const MON_TYPES = [
  "NORMAL",
  "FIGHTING",
  "FLYING",
  "POISON",
  "GROUND",
  "ROCK",
  "BUG",
  "GHOST",
  "STEEL",
  "FIRE",
  "WATER",
  "GRASS",
  "ELECTRIC",
  "PSYCHIC",
  "ICE",
  "DRAGON",
  "DARK",
  "FAIRY",
];
const STAT_LABELS = ["HP", "Atk", "Def", "SpA", "SpD", "Spe"];
// Uploaded source images (Image objects) + whether anything new needs uploading.
const monSprites = { front: null, back: null, shinyFront: null, shinyBack: null };
let monSpritesDirty = false;

function monNextId() {
  let max = 60000;
  for (const m of Object.values(MONS_LIVE)) {
    if (Number.isInteger(m.id) && m.id > max) {
      max = m.id;
    }
  }
  return max + 1;
}

const slugify = name =>
  `editor-${(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
const constify = name =>
  `SPECIES_EDITOR_${(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;

function renderAddMon(root) {
  const monCards = Object.entries(MONS_LIVE)
    .map(
      ([c, m]) => `<button type="button" class="mon-edit" data-monconst="${c}">
        <img src="${SPRITE_BASE}/${esc(m.slug)}/front.png" style="width:40px;height:40px;image-rendering:pixelated" onerror="this.style.visibility='hidden'" />
        ${esc(m.name)} <small style="color:var(--muted)">#${m.id}</small>
      </button>`,
    )
    .join("");
  const typeOptions = sel =>
    `<option value=""${sel === "" ? " selected" : ""}>—</option>${MON_TYPES.map(t => `<option value="${t}"${sel === t ? " selected" : ""}>${t[0] + t.slice(1).toLowerCase()}</option>`).join("")}`;
  root.innerHTML = `
    <div class="section">
      <h2>Existing custom mons</h2>
      <p class="hint">Click one to load it into the form below (saving updates it). New mons get the next free id automatically.</p>
      <div class="mon-list">${monCards || '<span class="dyn">none yet</span>'}</div>
    </div>
    <div class="section">
      <h2>Mon editor</h2>
      <div class="mon-form">
        <fieldset><legend>Identity</legend>
          <label>Name <input type="text" id="mon-name" maxlength="30" style="width:160px" /></label>
          <label>Id <input type="number" id="mon-id" readonly style="width:80px;opacity:.6" value="${monNextId()}" /></label>
          <label>Sprite folder <input type="text" id="mon-slug" style="width:170px" spellcheck="false" /></label>
          <br /><label>Type 1 <select id="mon-type1">${typeOptions("NORMAL")}</select></label>
          <label>Type 2 <select id="mon-type2">${typeOptions("")}</select></label>
          <label>Catch rate <input type="number" id="mon-catch" min="1" max="255" value="45" /></label>
        </fieldset>
        <fieldset><legend>Base stats</legend>
          ${STAT_LABELS.map((s, i) => `<label>${s} <input type="number" class="mon-stat" data-stat="${i}" min="1" max="255" value="50" /></label>`).join("")}
          <span class="dyn" id="mon-bst"></span>
        </fieldset>
        <fieldset><legend>Abilities (up to 3 active + 3 innate, by name)</legend>
          ${[1, 2, 3].map(i => `<label>Active ${i} <input type="text" class="mon-ab" id="mon-ab${i}" list="abilities-list" style="width:150px" /></label>`).join("")}
          <br />${[1, 2, 3].map(i => `<label>Innate ${i} <input type="text" class="mon-ab" id="mon-in${i}" list="abilities-list" style="width:150px" /></label>`).join("")}
        </fieldset>
        <fieldset><legend>Starter & eggs</legend>
          <label>Egg tier <select id="mon-eggtier">${EGG_TIER_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join("")}</select></label>
          <label>Cost <input type="number" id="mon-cost" min="1" max="50" value="3" /></label>
          <br />${[1, 2, 3, 4].map(i => `<label>Egg move ${i} <input type="text" class="mon-egg" list="moves-list" style="width:150px" spellcheck="false" /></label>`).join("")}
        </fieldset>
        <fieldset class="full"><legend>Level-up moves (one per line: "level: MOVE_NAME")</legend>
          <textarea id="mon-levelmoves" rows="5" style="width:100%;background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:6px;font-family:ui-monospace,monospace;font-size:13px" spellcheck="false">1: TACKLE</textarea>
        </fieldset>
        <fieldset class="full"><legend>Sprites & shiny studio</legend>
          <p class="hint">Upload the normal front + back (64×64 ish PNG with transparency). Optionally upload a tier-1 shiny; otherwise it is generated with the hue slider. Tier 2/3 shinies are always generated (tier 1 hue +120° / +240°). The icon uses the front sprite.</p>
          <label>Front <input type="file" id="mon-file-front" accept="image/png" /></label>
          <label>Back <input type="file" id="mon-file-back" accept="image/png" /></label>
          <label>Shiny front (optional) <input type="file" id="mon-file-shinyf" accept="image/png" /></label>
          <label>Shiny back (optional) <input type="file" id="mon-file-shinyb" accept="image/png" /></label>
          <label>Shiny hue <input type="range" id="mon-hue" min="0" max="359" value="120" style="width:130px" /><span id="mon-hue-val">120°</span></label>
          <div class="sprite-slots" id="mon-previews"></div>
        </fieldset>
        <div class="full" style="display:flex;gap:10px;align-items:center">
          <button type="button" id="mon-save" class="primary">💾 Save mon (commits sprites + data)</button>
          <button type="button" id="mon-clear">New blank mon</button>
          <span class="dyn" id="mon-status"></span>
        </div>
      </div>
    </div>`;
  drawMonPreviews();
  refreshMonBst();
}

function refreshMonBst() {
  const el = $("#mon-bst");
  if (el) {
    const total = [...document.querySelectorAll(".mon-stat")].reduce((sum, i) => sum + (Number(i.value) || 0), 0);
    el.textContent = `BST ${total}`;
  }
}

/** The 8 battle sprites this mon ships, as {name, draw(ctx, img source)} rules. */
function monSpriteFiles() {
  const hue = Number($("#mon-hue")?.value ?? 120);
  const t1f = monSprites.shinyFront ? { src: "shinyFront", hue: 0 } : { src: "front", hue };
  const t1b = monSprites.shinyBack ? { src: "shinyBack", hue: 0 } : { src: "back", hue };
  return [
    { name: "front", src: "front", hue: 0 },
    { name: "back", src: "back", hue: 0 },
    { name: "shiny", ...t1f },
    { name: "shiny-back", ...t1b },
    { name: "shiny-2", src: t1f.src, hue: t1f.hue + 120 },
    { name: "shiny-back-2", src: t1b.src, hue: t1b.hue + 120 },
    { name: "shiny-3", src: t1f.src, hue: t1f.hue + 240 },
    { name: "shiny-back-3", src: t1b.src, hue: t1b.hue + 240 },
    { name: "icon", src: "front", hue: 0 },
  ];
}

function drawSprite(canvas, img, hue) {
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.filter = hue % 360 === 0 ? "none" : `hue-rotate(${hue % 360}deg)`;
  ctx.drawImage(img, 0, 0);
}

function drawMonPreviews() {
  const wrap = $("#mon-previews");
  if (!wrap) {
    return;
  }
  wrap.innerHTML = monSpriteFiles()
    .map(f => `<span class="sprite-slot"><canvas data-spritefile="${f.name}"></canvas>${f.name}.png</span>`)
    .join("");
  for (const f of monSpriteFiles()) {
    const img = monSprites[f.src];
    const canvas = wrap.querySelector(`canvas[data-spritefile="${f.name}"]`);
    if (img && canvas) {
      drawSprite(canvas, img, f.hue);
    }
  }
}

function monAtlasJson(name, w, h) {
  return JSON.stringify({
    textures: [
      {
        image: `${name}.png`,
        format: "RGBA8888",
        size: { w, h },
        scale: 1,
        frames: [
          {
            filename: "0001.png",
            rotated: false,
            trimmed: false,
            sourceSize: { w, h },
            spriteSourceSize: { x: 0, y: 0, w, h },
            frame: { x: 0, y: 0, w, h },
          },
        ],
      },
    ],
    meta: { app: "er-editor", version: "1.0" },
  });
}

function loadMonIntoForm(speciesConst) {
  const m = MONS_LIVE[speciesConst];
  if (!m) {
    return;
  }
  $("#mon-name").value = m.name;
  $("#mon-id").value = m.id;
  $("#mon-slug").value = m.slug;
  $("#mon-type1").value = m.types?.[0] ?? "NORMAL";
  $("#mon-type2").value = m.types?.[1] ?? "";
  $("#mon-catch").value = m.catchRate ?? 45;
  document.querySelectorAll(".mon-stat").forEach((inp, i) => {
    inp.value = m.baseStats?.[i] ?? 50;
  });
  [1, 2, 3].forEach(i => {
    $(`#mon-ab${i}`).value = m.abilities?.[i - 1] ?? "";
    $(`#mon-in${i}`).value = m.innates?.[i - 1] ?? "";
  });
  $("#mon-eggtier").value = m.eggTier ?? 0;
  $("#mon-cost").value = m.cost ?? 3;
  document.querySelectorAll(".mon-egg").forEach((inp, i) => {
    inp.value = m.eggMoves?.[i] ?? "";
  });
  $("#mon-levelmoves").value = (m.levelUpMoves ?? []).map(lm => `${lm.level}: ${lm.move}`).join("\n") || "1: TACKLE";
  // Pull the existing sprites into the studio so previews show (jsDelivr sends CORS).
  monSpritesDirty = false;
  for (const [key, file] of [
    ["front", "front"],
    ["back", "back"],
    ["shinyFront", "shiny"],
    ["shinyBack", "shiny-back"],
  ]) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      monSprites[key] = img;
      drawMonPreviews();
    };
    img.src = `${SPRITE_BASE}/${m.slug}/${file}.png`;
  }
  refreshMonBst();
  $("#mon-status").textContent = `Editing ${m.name} - saving updates it in place.`;
}

function monSetStatus(msg, color) {
  const el = $("#mon-status");
  if (el) {
    el.textContent = msg;
    el.style.color = color || "var(--muted)";
  }
}

async function saveMon() {
  const password = ($("#password")?.value || "").trim();
  if (!password) {
    monSetStatus("Enter the editor password (top right) first.", ERR);
    return;
  }
  const name = ($("#mon-name").value || "").trim();
  if (!name) {
    monSetStatus("Give the mon a name.", ERR);
    return;
  }
  const speciesConst = constify(name);
  const isUpdate = MONS_LIVE[speciesConst] !== undefined;
  const slug = ($("#mon-slug").value || "").trim() || slugify(name);
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    monSetStatus("Sprite folder must be lowercase letters, digits and hyphens.", ERR);
    return;
  }
  if (!isUpdate && (!monSprites.front || !monSprites.back)) {
    monSetStatus("Upload a front AND a back sprite first.", ERR);
    return;
  }
  const stats = [...document.querySelectorAll(".mon-stat")].map(i => Number(i.value));
  if (stats.some(v => !Number.isInteger(v) || v < 1 || v > 255)) {
    monSetStatus("Every base stat must be a whole number 1-255.", ERR);
    return;
  }
  const levelMoves = [];
  for (const line of $("#mon-levelmoves").value.split("\n")) {
    const m = line.trim().match(/^(\d+)\s*[:-]\s*([A-Za-z0-9_ ]+)$/);
    if (!m) {
      if (line.trim() !== "") {
        monSetStatus(`Could not read level-up move line: "${line.trim()}" (use "7: EMBER")`, ERR);
        return;
      }
      continue;
    }
    const move = m[2].trim().toUpperCase().replace(/\s+/g, "_");
    if (!MOVE_SET.has(move)) {
      monSetStatus(`Unknown move "${move}" in level-up moves.`, ERR);
      return;
    }
    levelMoves.push({ level: Number(m[1]), move });
  }
  const eggMoves = [...document.querySelectorAll(".mon-egg")].map(i => i.value.trim().toUpperCase()).filter(Boolean);
  for (const m of eggMoves) {
    if (!MOVE_SET.has(m)) {
      monSetStatus(`Unknown egg move "${m}".`, ERR);
      return;
    }
  }

  const entry = {
    id: isUpdate ? MONS_LIVE[speciesConst].id : Number($("#mon-id").value) || monNextId(),
    name,
    slug,
    types: [$("#mon-type1").value || "NORMAL", $("#mon-type2").value || null],
    baseStats: stats,
    abilities: [1, 2, 3].map(i => $(`#mon-ab${i}`).value.trim()),
    innates: [1, 2, 3].map(i => $(`#mon-in${i}`).value.trim()),
    catchRate: Number($("#mon-catch").value) || 45,
    eggTier: Number($("#mon-eggtier").value) || 0,
    cost: Number($("#mon-cost").value) || 3,
    levelUpMoves: levelMoves,
    eggMoves,
  };

  try {
    // 1) Sprites (only when new files are in the studio).
    if (monSpritesDirty || !isUpdate) {
      monSetStatus("Rendering + uploading sprites…");
      const files = [];
      for (const f of monSpriteFiles()) {
        const img = monSprites[f.src];
        if (!img) {
          continue;
        }
        const canvas = document.createElement("canvas");
        drawSprite(canvas, img, f.hue);
        files.push({ name: `${f.name}.png`, contentBase64: canvas.toDataURL("image/png").split(",")[1] });
        files.push({
          name: `${f.name}.json`,
          contentBase64: btoa(monAtlasJson(f.name, canvas.width, canvas.height)),
        });
      }
      const upRes = await fetch(`${WORKER_URL}/upload-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, slug, files, author: $("#author").value }),
      });
      const upData = await upRes.json().catch(() => ({}));
      if (!upRes.ok || !upData.ok) {
        monSetStatus(`Sprite upload failed: ${upData.error || upRes.status}`, ERR);
        return;
      }
    }
    // 2) The mon entry itself.
    monSetStatus("Saving mon data…");
    const res = await fetch(`${WORKER_URL}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password,
        file: "custom-mons",
        delta: { [speciesConst]: entry },
        author: $("#author").value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      monSetStatus(`Save failed: ${data.error || res.status}`, ERR);
      return;
    }
    MONS_LIVE[speciesConst] = entry;
    monSpritesDirty = false;
    monSetStatus(`Saved ✓ ${name} (#${entry.id}). It joins the game on the next deploy.`, "var(--ok)");
    setStatus(`Custom mon ${name} saved ✓ - use "Commit & Deploy" when you want it live on staging.`, "var(--ok)");
  } catch (err) {
    monSetStatus(`Error: ${err}`, ERR);
  }
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
  } else if (activeTab === "addmon") {
    renderAddMon(root);
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
  } else if (el.id === "mon-name") {
    const slugEl = $("#mon-slug");
    if (slugEl && (slugEl.value === "" || slugEl.value === slugify(el.dataset.prev || ""))) {
      slugEl.value = slugify(el.value);
    }
    el.dataset.prev = el.value;
    return; // no global dirty tracking - the mon form has its own save button
  } else if (el.classList.contains("mon-stat")) {
    refreshMonBst();
    return;
  } else if (el.id === "mon-hue") {
    const hueLabel = $("#mon-hue-val");
    if (hueLabel) {
      hueLabel.textContent = `${el.value}°`;
    }
    monSpritesDirty = true;
    drawMonPreviews();
    return;
  } else if (el.classList.contains("set-move") || el.classList.contains("set-slot")) {
    const sets = ensureSetOverride(el.dataset.setconst);
    const set = sets[Number(el.dataset.setidx)];
    if (!set) {
      return;
    }
    if (el.classList.contains("set-move")) {
      const value = el.value.trim().toUpperCase();
      el.value = value;
      set.moves[Number(el.dataset.slot)] = value;
      el.style.borderColor = value === "" || MOVE_SET.has(value) ? "" : ERR;
    } else {
      set.abilitySlot = Number(el.value);
    }
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
  const facToggle = e.target.closest(".toggle[data-facconst]");
  if (facToggle) {
    const c = facToggle.dataset.facconst;
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
  const setDel = e.target.closest(".set-del");
  if (setDel) {
    ensureSetOverride(setDel.dataset.setconst).splice(Number(setDel.dataset.setidx), 1);
    normalizeSetOverride(setDel.dataset.setconst);
    render();
    return;
  }
  const setAdd = e.target.closest(".set-add");
  if (setAdd) {
    ensureSetOverride(setAdd.dataset.setconst).push({ moves: ["", "", "", ""], abilitySlot: 0 });
    render();
    return;
  }
  const setReset = e.target.closest(".set-reset");
  if (setReset) {
    delete trSets.current[setReset.dataset.setconst];
    render();
    return;
  }
  const facOpen = e.target.closest("[data-facopen]");
  if (facOpen) {
    const c = facOpen.dataset.facopen;
    if (expandedFactory.has(c)) {
      expandedFactory.delete(c);
    } else {
      expandedFactory.add(c);
    }
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
    return;
  }
  // Add-a-Mon buttons.
  const monEdit = e.target.closest(".mon-edit");
  if (monEdit) {
    loadMonIntoForm(monEdit.dataset.monconst);
    return;
  }
  if (e.target.closest("#mon-save")) {
    saveMon();
    return;
  }
  if (e.target.closest("#mon-clear")) {
    monSprites.front = null;
    monSprites.back = null;
    monSprites.shinyFront = null;
    monSprites.shinyBack = null;
    monSpritesDirty = false;
    render();
  }
}

/** Read an uploaded PNG into an Image for the sprite studio. */
function readMonSpriteFile(input, key) {
  const file = input.files?.[0];
  if (!file) {
    return;
  }
  const img = new Image();
  img.onload = () => {
    monSprites[key] = img;
    monSpritesDirty = true;
    drawMonPreviews();
  };
  img.src = URL.createObjectURL(file);
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
    // Factory set overrides: changed species only; reverting to shipped sends null.
    const setOverrides = {};
    const allSetConsts = new Set([...Object.keys(trSets.current), ...Object.keys(trSets.baseline)]);
    for (const c of allSetConsts) {
      const cur = trSets.current[c];
      if (jsonEq(cur, trSets.baseline[c])) {
        continue;
      }
      if (cur === undefined) {
        setOverrides[c] = null;
        continue;
      }
      const cleaned = [];
      let setBad = false;
      for (const set of cur) {
        const moves = set.moves.map(m => (m || "").trim().toUpperCase()).filter(Boolean);
        if (moves.length === 0) {
          bad.push(`${c.replace(/^SPECIES_/, "")}: a factory set needs at least 1 move`);
          setBad = true;
          break;
        }
        for (const m of moves) {
          if (!MOVE_SET.has(m)) {
            bad.push(`${c.replace(/^SPECIES_/, "")}: unknown move "${m}"`);
            setBad = true;
          }
        }
        cleaned.push({ moves, abilitySlot: set.abilitySlot });
      }
      if (!setBad) {
        setOverrides[c] = cleaned;
      }
    }
    if (Object.keys(setOverrides).length > 0) {
      trDelta.sets = { ...(trDelta.sets || {}), factorySetOverrides: setOverrides };
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
    trSets.baseline = JSON.parse(JSON.stringify(trSets.current));
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
    const [species, moves, items, trainers, knobs, abilities, eggLive, spLive, itemLive, trLive, balLive, monsLive] =
      await Promise.all([
        fetch("./data/species.json").then(r => r.json()),
        fetch("./data/moves.json").then(r => r.json()),
        fetchJson("./data/items.json", []),
        fetchJson("./data/trainers.json", { frequencyDefaults: { elite: {}, hell: {} }, factorySpecies: [] }),
        fetchJson("./data/balance-knobs.json", []),
        fetchJson("./data/abilities.json", []),
        // Live override files (resilient: missing on the branch → start empty).
        fetchJson(`${RAW_BASE}/er-egg-moves.json${bust}`, {}),
        fetchJson(`${RAW_BASE}/er-species-tuning.json${bust}`, {}),
        fetchJson(`${RAW_BASE}/er-item-tuning.json${bust}`, {}),
        fetchJson(`${RAW_BASE}/er-trainer-tuning.json${bust}`, {}),
        fetchJson(`${RAW_BASE}/er-balance-tuning.json${bust}`, {}),
        fetchJson(`${RAW_BASE}/er-custom-mons.json${bust}`, {}),
      ]);
    SPECIES = species;
    MOVES = moves;
    ITEMS = items;
    TRAINER_DEFAULTS = trainers.frequencyDefaults;
    FACTORY_SPECIES = trainers.factorySpecies;
    KNOBS = knobs;
    ABILITY_NAMES = abilities;
    MONS_LIVE = monsLive;

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
    // Live factory-set overrides (only entries whose species we can show).
    for (const [c, sets] of Object.entries(trLive.sets?.factorySetOverrides || {})) {
      if (Array.isArray(sets)) {
        trSets.current[c] = sets.map(set => ({
          moves: [...(set.moves || []), "", "", "", ""].slice(0, 4),
          abilitySlot: set.abilitySlot ?? 0,
        }));
      }
    }
    trSets.baseline = JSON.parse(JSON.stringify(trSets.current));

    // One shared datalist for all move inputs (light + searchable).
    const dl = document.createElement("datalist");
    dl.id = "moves-list";
    dl.innerHTML = MOVES.map(m => `<option value="${m}">${prettify(m)}</option>`).join("");
    document.body.appendChild(dl);
    // Ability names for the Add-a-Mon autocomplete.
    const adl = document.createElement("datalist");
    adl.id = "abilities-list";
    adl.innerHTML = ABILITY_NAMES.map(a => `<option value="${esc(a)}"></option>`).join("");
    document.body.appendChild(adl);

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
      } else if (e.target.id === "mon-file-front") {
        readMonSpriteFile(e.target, "front");
      } else if (e.target.id === "mon-file-back") {
        readMonSpriteFile(e.target, "back");
      } else if (e.target.id === "mon-file-shinyf") {
        readMonSpriteFile(e.target, "shinyFront");
      } else if (e.target.id === "mon-file-shinyb") {
        readMonSpriteFile(e.target, "shinyBack");
      } else if (e.target.classList.contains("set-move") || e.target.classList.contains("set-slot")) {
        normalizeSetOverride(e.target.dataset.setconst);
        render();
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
