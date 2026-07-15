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
const TRAINER_SPRITE_BASE = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/images/trainer";
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

// Custom Trainers: live er-custom-trainers.json + edit state. In the LIVE file
// each team member's species (and fusion species) is a numeric pokerogue
// speciesId; for editing we swap to the species CONST (joined via spByConst /
// spById) so the picker matches every other tab, converting back on save.
let CTR_LIVE = {}; // key → entry (species by numeric id, as stored)
const ctr = { current: {}, baseline: {} }; // key → entry (species by CONST)
// Global custom-trainer spawn-density config (sibling er-custom-trainers-config.json):
// how OFTEN a custom-trainer encounter happens at all, independent of trainer count.
// { windowSize, windowChancePct }. Saved as its own whitelisted file.
const ctrConfig = {
  current: { windowSize: 10, windowChancePct: 25 },
  baseline: { windowSize: 10, windowChancePct: 25 },
};
let ctrSelected = null; // open trainer key, or null
// Per-member TRANSIENT UI state (NOT saved, NOT part of the dirty diff): which
// member fieldsets are expanded, and which authored set a member's dropdown
// currently points at (member index → set index; absent/-1 = "(custom)"). Both
// are keyed by team-slot index and reset when the open trainer changes.
const ctrOpenMembers = new Set(); // expanded team-slot indices
const ctrSetSel = new Map(); // team-slot index → selected set index
let ctrFocusIdx = 0; // team-slot index whose preview shows in the right panel

// Battle-music catalog (editor/data/bgm.json): [{ key, battle }]. Battle themes
// are listed first in the picker. One SHARED Audio element previews a track;
// picking/previewing another (or ■ stop) halts the previous playback.
let BGM_LIST = [];
const BGM_AUDIO_BASE = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/audio/bgm";
let bgmPreviewAudio = null; // the single shared HTMLAudioElement
let bgmPreviewKey = null; // the key currently playing, or null

// Live egg-move source (er-egg-moves.json, keyed by species CONST → move NAMEs),
// used by the per-member move-legality helper (levelup ∪ TM ∪ egg).
let EGG_MOVES_LIVE = {};
// Factory sets keyed by species CONST (from trainers.json factorySpecies): the
// per-species authored sets powering the "Use set" move-default dropdown.
const factoryByConst = new Map(); // CONST → [{moves:[names], abilitySlot}]
// Memoized legal-move sets per species CONST (levelup ∪ TM ∪ egg move NAMEs).
const legalMovesCache = new Map(); // CONST → Set<move NAME>

// Usage tiers (fetched at runtime; graceful "unranked" fallback when missing).
const usage = { loaded: false, lines: {} };

let activeTab = "eggmoves";

// Per-edit undo for EGG MOVES (the free-text inputs): each committed slot
// change pushes {const, before}. `committed` is the last settled snapshot.
const undoStack = [];
let committed = {};

// ---- Pokedex Editor (Learnsets / TMs / Abilities) --------------------------
// Rich catalogs (loaded from editor/data/*.json; keyed by numeric speciesId,
// which is SPECIES[i].id). Move/ability metadata powers the palettes + search.
let MOVES_RICH = []; // [{id, name, type, category, power, accuracy, pp}]
let ABILS_RICH = []; // [{id, name, description}]
// The Pokedex Editor's species universe = ALL registered species (evolutions +
// forms too), NOT just the starter pool in SPECIES, so any evolution is editable.
let POKEDEX_SPECIES = []; // [{const, name, slug, id, dex}]
let EVOS = {}; // speciesId → { to: number[], from: number[] }
const moveById = new Map(); // moveId → rich move
const abilById = new Map(); // abilityId → rich ability
// Custom Trainers: sprite-bearing trainer classes (from trainer-classes.json),
// with a NAME→entry lookup for the sprite preview. Falls back to the static
// TRAINER_CLASS_OPTIONS list if the generated file is missing.
let TRAINER_CLASSES = []; // [{name, sprite, genders}]
const trainerClassByName = new Map(); // TrainerType NAME → {name, sprite, genders}
// Shiny Lab effect registry (editor/data/shiny-effects.json): the per-category
// effect option lists for the per-mon shiny-effect picker. Each entry is
// {id, label, accent}; id→entry lookups power the picker + preview swatch.
let SHINY_EFFECTS = { palette: [], surface: [], around: [] };
const shinyEffectById = new Map(); // effect id → {id, label, accent, category}
// Ghost Trainer FX aura catalog (editor/data/trainer-fx.json): the per-trainer
// SPRITE effect picker options. Each entry is {id, label, accent}; the id is a
// ghost aura id (validated in-game via isKnownTrainerAuraId → trainer.erGhostAura).
let TRAINER_FX = [];
const trainerFxById = new Map(); // aura id → {id, label, accent}
// Cache of fetched TexturePacker atlas jsons (CDN url → parsed json | null on fail).
const trainerAtlasCache = new Map();
// In-flight atlas fetches (CDN url → Promise), so N cards/cells sharing a class
// fire ONE fetch, not N concurrent ones (caps concurrency on the trainer list).
const trainerAtlasInflight = new Map();
// Edit state keyed by species CONST (joined to data via SPECIES[i].id), so the
// committed override JSON is human-readable and consistent with the other tabs.
const learn = { current: {}, baseline: {} }; // const → [[level, moveId], ...]
const tms = { current: {}, baseline: {} }; // const → [moveId, ...]
const abil = { current: {}, baseline: {} }; // const → {ability1, ability2, hidden}
// Shared UI state across the three Pokedex tabs.
let pdSelected = null; // selected species const
const palSort = "name"; // move-palette sort: name | type | power
let palQuery = ""; // move-palette search text (preserved across re-renders)
let newMoveLevel = 1; // level assigned to moves added to a learnset
// Ability/innate slots: 3 ability slots + 3 ER "innate" (passive) slots.
const EMPTY_ABIL = { ability1: 0, ability2: 0, hidden: 0, innates: [0, 0, 0] };
/** Read one slot's ability id from an abilities entry (scalar field or innate index). */
function getAbilSlot(cur, slot) {
  return slot.startsWith("innate") ? (cur.innates || [])[Number(slot.slice(6))] || 0 : cur[slot] || 0;
}
/** Write one slot's ability id into an abilities entry (returns a new entry). */
function setAbilSlot(cur, slot, id) {
  const next = { ...cur, innates: (cur.innates || [0, 0, 0]).slice() };
  if (slot.startsWith("innate")) {
    next.innates[Number(slot.slice(6))] = id;
  } else {
    next[slot] = id;
  }
  return next;
}
const POKEDEX_TABS = new Set(["learnsets", "tms", "abilities"]);

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
  let lsN = 0;
  let tmN = 0;
  let abN = 0;
  for (const s of SPECIES) {
    if (!jsonEq(egg.current[s.const] || [], egg.baseline[s.const] || [])) {
      eggN++;
    }
    if (!jsonEq(sp.current[s.const], sp.baseline[s.const])) {
      spN++;
    }
  }
  // Learnsets / TMs / abilities span the FULL Pokedex universe (evolutions too).
  for (const s of POKEDEX_SPECIES) {
    if (!jsonEq(learn.current[s.const], learn.baseline[s.const])) {
      lsN++;
    }
    if (!jsonEq(tms.current[s.const], tms.baseline[s.const])) {
      tmN++;
    }
    if (!jsonEq(abil.current[s.const], abil.baseline[s.const])) {
      abN++;
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
  let ctrN = 0;
  for (const key of new Set([...Object.keys(ctr.current), ...Object.keys(ctr.baseline)])) {
    if (!jsonEq(ctr.current[key], ctr.baseline[key])) {
      ctrN++;
    }
  }
  // The global spawn-density config counts toward the Custom Trainers tab dot.
  if (!jsonEq(ctrConfig.current, ctrConfig.baseline)) {
    ctrN++;
  }
  return {
    eggN,
    spN,
    itemN,
    trN,
    balN,
    lsN,
    tmN,
    abN,
    ctrN,
    total: eggN + spN + itemN + trN + balN + lsN + tmN + abN + ctrN,
  };
}

function refreshChrome() {
  const { eggN, spN, itemN, trN, balN, lsN, tmN, abN, ctrN, total } = dirtyCounts();
  saveBtn.textContent = `Save ${total} change${total === 1 ? "" : "s"}`;
  saveBtn.disabled = total === 0;
  const dots = {
    eggmoves: eggN,
    species: spN,
    items: itemN,
    trainers: trN,
    customtrainers: ctrN,
    game: balN,
    learnsets: lsN,
    tms: tmN,
    abilities: abN,
  };
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
// ---- Pokedex Editor (Learnsets / TMs / Abilities) --------------------------
// const/id → species object, filled in init() (avoids O(n²) lookups in render).
const spByConst = new Map();
const spById = new Map();

/** The Pokedex tabs' species list: ALL species, filtered by the header search, sorted. */
function pokedexList() {
  const f = ($("#search").value || "").trim().toLowerCase();
  const list = f
    ? POKEDEX_SPECIES.filter(s => s.name.toLowerCase().includes(f) || s.const.toLowerCase().includes(f))
    : POKEDEX_SPECIES;
  const byDex = $("#sort").value === "dex";
  return [...list].sort((a, b) =>
    byDex ? (a.dex ?? 99999) - (b.dex ?? 99999) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name),
  );
}

const powStr = m => (m && m.power > 1 ? String(m.power) : "—");
const moveLabel = m => (m ? `${esc(m.name)} <small>${esc(m.type)} · ${esc(m.category)} · ${powStr(m)}</small>` : "—");

/** Is the selected species modified in the given pokedex domain? */
function pdDirty(c, tab) {
  if (tab === "learnsets") {
    return !jsonEq(learn.current[c], learn.baseline[c]);
  }
  if (tab === "tms") {
    return !jsonEq(tms.current[c], tms.baseline[c]);
  }
  return !jsonEq(abil.current[c], abil.baseline[c]);
}

/** Left species list (shared by all three pokedex tabs). */
function pdListHtml() {
  return pokedexList()
    .map(s => {
      const sprite = s.slug ? `${SPRITE_BASE}/${s.slug}/front.png` : "";
      const dirty = pdDirty(s.const, activeTab);
      return `<button type="button" class="pd-sp${s.const === pdSelected ? " sel" : ""}" data-pdpick="${s.const}">
        <img src="${sprite}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <span class="nm">${esc(s.name)} <small>#${s.dex ?? "—"}</small></span>
        ${dirty ? '<span class="pd-dot">●</span>' : ""}
      </button>`;
    })
    .join("");
}

/** The full move palette (all moves, current sort). Filtered live by filterPalette(). */
function paletteHtml() {
  const list = [...MOVES_RICH];
  if (palSort === "type") {
    list.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  } else if (palSort === "power") {
    list.sort((a, b) => (b.power || 0) - (a.power || 0) || a.name.localeCompare(b.name));
  } else {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }
  return list
    .map(
      m => `<button type="button" class="pal-move" draggable="true" data-moveid="${m.id}"
        data-hay="${esc(`${m.name} ${m.type} ${m.category}`.toLowerCase())}">
        <span class="mname">${esc(m.name)}</span>
        <span class="mmeta"><span class="tcol">${esc(m.type)}</span> · ${esc(m.category)} · Pwr ${powStr(m)} · Acc ${
          m.accuracy > 0 ? m.accuracy : "—"
        } · PP ${m.pp}</span>
      </button>`,
    )
    .join("");
}

const paletteControlsHtml = withLevel => `
  <input id="pal-search" type="search" placeholder="Filter moves…" autocomplete="off" value="${esc(palQuery)}" />
  <select id="pal-sort" title="Sort the move palette">
    <option value="name"${palSort === "name" ? " selected" : ""}>Name</option>
    <option value="type"${palSort === "type" ? " selected" : ""}>Type</option>
    <option value="power"${palSort === "power" ? " selected" : ""}>Power</option>
  </select>
  ${withLevel ? `<label style="text-transform:none">Add at Lv <input id="pd-newlevel" type="number" min="1" max="100" value="${newMoveLevel}" /></label>` : ""}`;

/** Hide palette entries that don't match the current query (no re-render → keeps focus). */
function filterPalette() {
  const q = palQuery.trim().toLowerCase();
  document.querySelectorAll("#pal .pal-move").forEach(el => {
    el.hidden = q !== "" && !el.dataset.hay.includes(q);
  });
}

/** One clickable evolution-relative chip (jumps to edit that species in the same tab). */
function evoChipHtml(id) {
  const rel = spById.get(id);
  if (!rel) {
    return "";
  }
  const sprite = rel.slug ? `${SPRITE_BASE}/${rel.slug}/front.png` : "";
  const dirty = pdDirty(rel.const, activeTab);
  return `<button type="button" class="evo-chip${dirty ? " dirty" : ""}" data-pdpick="${rel.const}" title="Edit ${esc(rel.name)}">
    <img src="${sprite}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />${esc(rel.name)}${dirty ? " ●" : ""}
  </button>`;
}

/** Collect the WHOLE evolutionary line around a species: all ancestors + all descendants. */
function collectEvoLine(id) {
  const ancestors = [];
  const seen = new Set([id]);
  let cur = id;
  for (let guard = 0; guard < 20; guard++) {
    const prevo = (EVOS[cur]?.from || []).find(p => !seen.has(p));
    if (prevo === undefined) {
      break;
    }
    ancestors.unshift(prevo);
    seen.add(prevo);
    cur = prevo;
  }
  const descendants = [];
  const queue = [...(EVOS[id]?.to || [])];
  while (queue.length > 0 && descendants.length < 30) {
    const n = queue.shift();
    if (seen.has(n)) {
      continue;
    }
    seen.add(n);
    descendants.push(n);
    queue.push(...(EVOS[n]?.to || []));
  }
  return { ancestors, descendants };
}

/** The evolution chain row: the full line (pre-evos → THIS → all evolutions), all clickable. */
function evoChainHtml(s) {
  const { ancestors, descendants } = collectEvoLine(s.id);
  if (ancestors.length === 0 && descendants.length === 0) {
    return "";
  }
  const arrow = '<span class="evo-arrow">→</span>';
  const from = ancestors.map(evoChipHtml).filter(Boolean).join(arrow);
  const to = descendants.map(evoChipHtml).filter(Boolean).join(" ");
  const here = `<span class="evo-here">${esc(s.name)}</span>`;
  return `<div class="evo-chain">
    ${from ? `${from}${arrow}` : ""}${here}${to ? `${arrow}${to}` : ""}
  </div>`;
}

function pdHeadHtml(s) {
  const sprite = s.slug ? `${SPRITE_BASE}/${s.slug}/front.png` : "";
  const dirty = pdDirty(s.const, activeTab);
  return `<div class="pd-head">
    <img src="${sprite}" alt="" onerror="this.style.visibility='hidden'" />
    <div>
      <div class="pd-title">${esc(s.name)} <small>#${s.dex ?? "—"} · ${esc(s.const)}</small></div>
    </div>
    ${dirty ? '<span class="badge edited">modified</span>' : ""}
    <button type="button" class="pd-revert" data-pdrevert="${s.const}"${dirty ? "" : " disabled"}>↺ Revert</button>
  </div>
  ${evoChainHtml(s)}`;
}

function renderLearnsets(root) {
  root.innerHTML = `<div class="pd"><aside class="pd-list">${pdListHtml()}</aside><section class="pd-main" id="pd-main"></section></div>`;
  const main = $("#pd-main");
  if (!pdSelected) {
    main.innerHTML = '<div class="empty">Select a species from the list to edit its level-up learnset.</div>';
    return;
  }
  const s = spByConst.get(pdSelected);
  const rows = (learn.current[pdSelected] || [])
    .map(([lvl, mv], idx) => ({ lvl, mv, idx }))
    .sort((a, b) => a.lvl - b.lvl || a.idx - b.idx);
  const rowsHtml = rows
    .map(
      r => `<div class="ls-row" data-idx="${r.idx}">
        <input class="ls-level" type="number" min="1" max="100" value="${r.lvl}" data-idx="${r.idx}" />
        <span class="ls-move">${r.lvl === 1 ? '<span class="ls-lv1">START</span> ' : ""}${moveLabel(moveById.get(r.mv))}</span>
        <button type="button" class="ls-del" data-idx="${r.idx}" title="Remove">✕</button>
      </div>`,
    )
    .join("");
  main.innerHTML = `${pdHeadHtml(s)}
    <div class="pd-cols">
      <div class="pd-col">
        <div class="pd-col-head">Learnable ${paletteControlsHtml(true)}</div>
        <div class="pal" id="pal">${paletteHtml()}</div>
      </div>
      <div class="pd-col">
        <div class="pd-col-head">Current learnset (${rows.length})</div>
        <div class="ls-list" data-drop="learn">${rowsHtml || '<div class="pd-empty">No level-up moves. Click or drag a move from the left to add one.</div>'}</div>
      </div>
    </div>`;
  filterPalette();
}

function renderTMs(root) {
  root.innerHTML = `<div class="pd"><aside class="pd-list">${pdListHtml()}</aside><section class="pd-main" id="pd-main"></section></div>`;
  const main = $("#pd-main");
  if (!pdSelected) {
    main.innerHTML = '<div class="empty">Select a species from the list to edit which TM/move it can learn.</div>';
    return;
  }
  const s = spByConst.get(pdSelected);
  const ids = (tms.current[pdSelected] || []).slice().sort((a, b) => {
    const ma = moveById.get(a);
    const mb = moveById.get(b);
    return (ma?.name || "").localeCompare(mb?.name || "");
  });
  const listHtml = ids
    .map(
      id => `<div class="tm-row" data-moveid="${id}">
        <span class="tm-move">${moveLabel(moveById.get(id))}</span>
        <button type="button" class="tm-del" data-moveid="${id}" title="Remove">✕</button>
      </div>`,
    )
    .join("");
  main.innerHTML = `${pdHeadHtml(s)}
    <div class="pd-cols">
      <div class="pd-col">
        <div class="pd-col-head">All moves ${paletteControlsHtml(false)}</div>
        <div class="pal" id="pal">${paletteHtml()}</div>
      </div>
      <div class="pd-col">
        <div class="pd-col-head">TM-learnable (${ids.length})</div>
        <div class="tm-list" data-drop="tm">${listHtml || '<div class="pd-empty">No TM moves. Click or drag a move from the left to add one.</div>'}</div>
      </div>
    </div>`;
  filterPalette();
}

const ABIL_SLOT_LABEL = {
  ability1: "Ability 1",
  ability2: "Ability 2",
  hidden: "Hidden Ability",
  innate0: "Innate 1",
  innate1: "Innate 2",
  innate2: "Innate 3",
};

function abilSlotHtml(cur, slot) {
  const a = abilById.get(getAbilSlot(cur, slot));
  const isInnate = slot.startsWith("innate");
  return `<div class="abil-slot${slot === "hidden" || isInnate ? " hidden-slot" : ""}">
    <label>${ABIL_SLOT_LABEL[slot]}</label>
    <div class="combo">
      <input class="abil-input" data-slot="${slot}" placeholder="Search name or description…" autocomplete="off" value="${esc(a ? a.name : "")}" />
      <div class="abil-drop" data-slot="${slot}"></div>
    </div>
    <div class="abil-cur">
      <div class="acur-name">${a ? esc(a.name) : "<span style='color:var(--muted)'>none</span>"}</div>
      <div class="acur-desc">${a ? esc(a.description) : ""}</div>
    </div>
  </div>`;
}

function renderAbilities(root) {
  root.innerHTML = `<div class="pd"><aside class="pd-list">${pdListHtml()}</aside><section class="pd-main" id="pd-main"></section></div>`;
  const main = $("#pd-main");
  if (!pdSelected) {
    main.innerHTML = '<div class="empty">Select a species from the list to edit its ability + innate slots.</div>';
    return;
  }
  const s = spByConst.get(pdSelected);
  const cur = abil.current[pdSelected] || EMPTY_ABIL;
  const abilities = ["ability1", "ability2", "hidden"].map(slot => abilSlotHtml(cur, slot)).join("");
  const innates = ["innate0", "innate1", "innate2"].map(slot => abilSlotHtml(cur, slot)).join("");
  main.innerHTML = `${pdHeadHtml(s)}
    <div class="abil-group-title">Abilities</div>
    <div class="abil-slots">${abilities}</div>
    <div class="abil-group-title">Innates (ER passives)</div>
    <div class="abil-slots">${innates}</div>`;
}

/** Fill an ability slot's dropdown with up to 60 matches (name OR description). */
function openAbilDrop(slot, query) {
  const drop = document.querySelector(`.abil-drop[data-slot="${slot}"]`);
  if (!drop) {
    return;
  }
  const q = query.trim().toLowerCase();
  const matches = (q === "" ? ABILS_RICH : ABILS_RICH.filter(a => a.hay.includes(q))).slice(0, 60);
  drop.innerHTML = matches
    .map(
      a => `<button type="button" class="abil-opt" data-slot="${slot}" data-abilid="${a.id}">
        <span class="aname">${esc(a.name)}</span><span class="adesc">${esc(a.description)}</span>
      </button>`,
    )
    .join("");
  drop.classList.add("open");
}

function closeAbilDrops() {
  document.querySelectorAll(".abil-drop.open").forEach(d => d.classList.remove("open"));
}

// =============================================================================
// Custom Trainers tab — staff-authored trainer teams that spawn in real runs.
// Mirrors the JSON schema in src/data/elite-redux/er-custom-trainers.ts. Team
// members store the species CONST while editing (joined via spByConst/spById),
// converted to numeric speciesId on save.
// =============================================================================

// Trainer-class sprite picker: a curated set of TrainerType enum NAMES known to
// ship a BW sprite (images/trainer/<name>.png in er-assets). Free text is also
// accepted; the game falls back to a default sprite for an unknown class.
const TRAINER_CLASS_OPTIONS = [
  "ACE_TRAINER",
  "BEAUTY",
  "BLACK_BELT",
  "BREEDER",
  "CLERK",
  "CYCLIST",
  "DEPOT_AGENT",
  "DOCTOR",
  "FISHERMAN",
  "GUITARIST",
  "HARLEQUIN",
  "HIKER",
  "HOOLIGANS",
  "HOOPSTER",
  "INFIELDER",
  "JANITOR",
  "LADY",
  "LASS",
  "LINEBACKER",
  "MAID",
  "MUSICIAN",
  "NURSE",
  "NURSERY_AIDE",
  "OFFICER",
  "PARASOL_LADY",
  "PILOT",
  "POKEFAN",
  "PRESCHOOLER",
  "PSYCHIC",
  "RANGER",
  "RICH_BOY",
  "ROUGHNECK",
  "SAILOR",
  "SCIENTIST",
  "SMASHER",
  "SNOW_WORKER",
  "STRIKER",
  "SCHOOL_KID",
  "SWIMMER",
  "TWINS",
  "VETERAN",
  "WAITER",
  "WORKER",
  "YOUNGSTER",
  "ROCKET_GRUNT",
  "MAGMA_GRUNT",
  "AQUA_GRUNT",
  "GALACTIC_GRUNT",
  "PLASMA_GRUNT",
  "FLARE_GRUNT",
  "BROCK",
  "MISTY",
  "BLUE",
  "RED",
  "CYNTHIA",
  "STEVEN",
  "WALLACE",
  "LANCE",
  "GIOVANNI",
  "SABRINA",
  "BLAINE",
  "ERIKA",
  "KOGA",
  "SURGE",
];

// Enemy-legal held-item pool: `modifierTypes` keys resolvable by
// resolveHeldItemKey (src/system/llm-director/held-item-resolver.ts). Curated to
// the per-Pokemon held items that make sense on an enemy team.
const HELD_ITEM_OPTIONS = [
  "LEFTOVERS",
  "SHELL_BELL",
  "FOCUS_BAND",
  "QUICK_CLAW",
  "KINGS_ROCK",
  "WIDE_LENS",
  "SCOPE_LENS",
  "GRIP_CLAW",
  "TOXIC_ORB",
  "FLAME_ORB",
  "BATON",
  "SOOTHE_BELL",
  "SOUL_DEW",
  "MYSTICAL_ROCK",
  "GOLDEN_PUNCH",
  "BERRY_POUCH",
  "SILK_SCARF",
  "EVIOLITE",
  "LUCKY_EGG",
  "GOLDEN_EGG",
  "REVIVER_SEED",
  "MULTI_LENS",
];

// Full held-item catalog (editor/data/held-items.json): the complete set of
// enemy-legal keys the game-side resolveHeldItemKey can field, grouped by
// category so the held-item picker can offer type boosters, berries and gems
// (not just the old curated 22). Loaded in init(); falls back to the curated
// HELD_ITEM_OPTIONS (as "utility") when the generated file is absent so the
// picker is never empty. The runtime resolver is the source of truth — keys
// stay free-form, this list is just ergonomics.
let HELD_ITEMS = HELD_ITEM_OPTIONS.map(key => ({ key, label: prettify(key), category: "utility" }));
const HELD_CATEGORY_ORDER = ["booster", "berry", "gem", "utility"];
const HELD_CATEGORY_LABEL = { booster: "type booster", berry: "berry", gem: "gem", utility: "utility" };

/** Held-item picker <option>s, sorted by category (boosters → berries → gems →
 *  utility) then label, each tagged with its category for at-a-glance grouping. */
function heldItemsDatalistHtml() {
  const catRank = k => {
    const i = HELD_CATEGORY_ORDER.indexOf(k);
    return i < 0 ? HELD_CATEGORY_ORDER.length : i;
  };
  const sorted = [...HELD_ITEMS].sort(
    (a, b) => catRank(a.category) - catRank(b.category) || (a.label || a.key).localeCompare(b.label || b.key),
  );
  return `<datalist id="helditems-list">${sorted
    .map(
      h =>
        `<option value="${esc(h.key)}">${esc(h.label || prettify(h.key))} · ${esc(HELD_CATEGORY_LABEL[h.category] || h.category || "item")}</option>`,
    )
    .join("")}</datalist>`;
}

// BST curve (defaults from er-balance-knobs: er.elite.bstCaps / er.hell.bstCaps,
// #418/#419). Pairs are [up-to-wave, cap]; past the last wave there is no cap.
const BST_CAPS = {
  elite: [
    [20, 420],
    [40, 480],
    [60, 540],
    [80, 580],
    [100, 600],
  ],
  hell: [
    [20, 460],
    [40, 520],
    [60, 580],
    [80, 620],
    [100, 660],
  ],
};
const DIFFICULTY_OPTIONS = ["youngster", "ace", "elite", "hell"];
const BATTLE_TYPE_OPTIONS = ["single", "double", "triple"];
// Challenge-exclusivity keys must match ErCustomTrainerChallenge in
// er-custom-trainers.ts (one key per Challenges enum member). Labels come from
// the in-game challenge display names (locales/en/challenges.json).
const CHALLENGE_OPTIONS = [
  "none",
  "inverse",
  "monocolor",
  "monogen",
  "doubles",
  "ghost",
  "monotype",
  "maxcost",
  "points",
  "freshstart",
  "flipstat",
  "limitedcatch",
  "limitedsupport",
  "hardcore",
  "passives",
  "usagetier",
  "triples",
];
// Challenge VALUE option lists (editor/data/challenge-values.json), keyed by the
// challenge key above. A challenge present here is "parameterizable": the editor
// shows a second dropdown of human options mapped to the game's numeric value
// encoding. Loaded in init(); empty until then (the value dropdown just hides).
let CHALLENGE_VALUES = {};
/** Whether a challenge key carries a VALUE parameter (has an option list). */
function ctrChallengeIsParameterizable(challenge) {
  return Array.isArray(CHALLENGE_VALUES[challenge]) && CHALLENGE_VALUES[challenge].length > 0;
}
/** Normalize an authored challengeValue: a positive integer, else null (unset). */
function normalizeCtrChallengeValue(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n >= 1 ? n : null;
}
const CHALLENGE_LABELS = {
  none: "None",
  inverse: "Inverse Battle",
  monocolor: "Mono Color",
  monogen: "Mono Gen",
  doubles: "Doubles Only",
  ghost: "Ghost Trainers",
  monotype: "Mono Type",
  maxcost: "Max Starter Cost",
  points: "Starter Points",
  freshstart: "Fresh Start",
  flipstat: "Flip Stat",
  limitedcatch: "Limited Catch",
  limitedsupport: "Limited Support",
  hardcore: "Hardcore",
  passives: "Active Passives",
  usagetier: "Usage Tier",
  triples: "Triples Only",
};

/** BST cap for a wave on a ladder (elite/hell); null = past the ladder (no cap). */
function bstCapFor(wave, ladderKey) {
  const ladder = BST_CAPS[ladderKey] || BST_CAPS.elite;
  for (const [upTo, cap] of ladder) {
    if (wave <= upTo) {
      return cap;
    }
  }
  return null;
}

/** Species base-stat total for a CONST (0 when unknown). */
function bstOfConst(speciesConst) {
  return spByConst.get(speciesConst)?.bst ?? 0;
}

/**
 * Normalize a spawnChance to an integer 1-100. Absent/invalid => 100 (mirrors
 * normalizeSpawnChance in er-custom-trainers.ts): 100 = guaranteed once per run.
 */
function normalizeCtrSpawnChance(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  const n = Math.floor(value);
  return n >= 1 && n <= 100 ? n : 100;
}

/** Normalize a slotChance to an integer 1-100 (absent/invalid => 100). Mirrors
 *  normalizeSlotChance in er-custom-trainers.ts (100 = slot always filled). */
function normalizeCtrSlotChance(value) {
  return normalizeCtrSpawnChance(value);
}

/**
 * Resolve a trainer pick WEIGHT with spawnChance back-compat migration (mirrors
 * resolveErCustomTrainerWeight in er-custom-trainers.ts): a present weight clamps
 * to an integer >= 1; else a legacy spawnChance migrates (clamped >= 1); else 100.
 */
function resolveCtrWeight(weight, spawnChance) {
  const clampAtLeastOne = v => {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return 1;
    }
    const n = Math.floor(v);
    return n >= 1 ? n : 1;
  };
  if (weight !== undefined && weight !== null) {
    return clampAtLeastOne(weight);
  }
  if (spawnChance !== undefined && spawnChance !== null) {
    return clampAtLeastOne(spawnChance);
  }
  return 100;
}

/** Normalize a spawn WEIGHT to an integer >= 1 (absent/invalid => 100). */
function normalizeCtrWeight(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 100;
  }
  const n = Math.floor(value);
  return n >= 1 ? n : 1;
}

/** Normalize the spawn-density window size to an integer 1-100 (invalid => 10). */
function normalizeCtrWindowSize(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }
  const n = Math.floor(value);
  return n >= 1 && n <= 100 ? n : 10;
}

/** Normalize the spawn-density per-window chance to an integer 0-100 (invalid => 25). */
function normalizeCtrWindowChance(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 25;
  }
  const n = Math.floor(value);
  return n >= 0 && n <= 100 ? n : 25;
}

// --- Multi-staff save safety: per-trainer baseline hashing (mirrors the worker's
// custom-trainers-merge.ts EXACTLY, so a hash computed here matches the worker's).
// The editor sends hashCtrTrainerEntry(CTR_LIVE[key]) (the LOAD-time repo version,
// species by id) per modified trainer; the worker compares it against the CURRENT
// repo version to detect a teammate's concurrent edit (same-trainer conflict).

/** Deterministic, key-sorted JSON string (mirror of worker `stableStringify`). */
function ctrStableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(ctrStableStringify).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${ctrStableStringify(value[k])}`).join(",")}}`;
}

/** Stable FNV-1a (32-bit) hex hash of a trainer entry (mirror of worker `hashTrainerEntry`). */
function hashCtrTrainerEntry(entry) {
  const s = ctrStableStringify(entry);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Per-trainer load-time baseline hashes for a custom-trainers delta: for each
 * MODIFIED trainer (a non-null delta entry whose key existed in the loaded file
 * CTR_LIVE), map key -> hash of the LOADED repo entry. New trainers (absent from
 * CTR_LIVE) and deletions (null) get no baseline, so the worker treats them as a
 * new-id allocation / delete respectively. This drives the worker's same-trainer
 * conflict guard.
 */
function ctrBuildBaselines(delta) {
  const baselines = {};
  for (const [key, value] of Object.entries(delta || {})) {
    if (value !== null && CTR_LIVE && Object.hasOwn(CTR_LIVE, key)) {
      baselines[key] = hashCtrTrainerEntry(CTR_LIVE[key]);
    }
  }
  return baselines;
}

/** Clamp a variant weight to an integer >= 1 (invalid => 1). */
function clampCtrWeight(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  const n = Math.floor(value);
  return n >= 1 ? n : 1;
}

// The two literal move tokens (resolved to a seeded legal move in-game); they are
// EXEMPT from the move-legality/unknown-move gates and offered at the top of the
// per-member move datalist.
const CTR_MOVE_TOKENS = new Set(["RLA", "RLNA"]);
const CTR_MOVE_TOKEN_LABEL = {
  RLA: "RLA — random legal attacking move",
  RLNA: "RLNA — random legal non-attacking move",
};
function ctrIsMoveToken(v) {
  return CTR_MOVE_TOKENS.has((v || "").trim().toUpperCase());
}

/** A move DISPLAY name (e.g. "Ice Beam") -> the enum KEY the editor/game compare in
 *  ("ICE_BEAM"). Mirror of gen-editor-data's moveNameToEnumKey (and the game's own
 *  init-elite-redux-custom-moves.ts): uppercase, non-alnum runs -> a single "_",
 *  trimmed. This is the ONE normalization for both the legal-move pool (moves-rich
 *  ships DISPLAY names) and every typed move input (so "ice beam" -> "ICE_BEAM"). */
function moveNameToEnumKey(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** The member-FIELD keys that make up ONE weighted possibility (excludes slot meta:
 *  slotChance / weighted / variants / cur). */
const CTR_MEMBER_FIELDS = [
  "species",
  "formIndex",
  "level",
  "moves",
  "abilitySlot",
  "fusion",
  "heldItems",
  "shiny",
  "sanityOff",
];

/** Coerce a raw/edit shiny value into the editor shape { palette, surface, around, name }
 *  (strings; empty = none). Accepts null/undefined and the saved JSON shape alike. */
function ctrNormShiny(s) {
  const o = s && typeof s === "object" ? s : {};
  const str = v => (typeof v === "string" ? v : "");
  return { palette: str(o.palette), surface: str(o.surface), around: str(o.around), name: str(o.name) };
}

/** True when a shiny edit value carries at least one effect (empties = renders normally). */
function ctrShinyActive(s) {
  return !!(s && (s.palette || s.surface || s.around));
}

/** A fresh blank set of member fields (one possibility), species by CONST. */
function blankCtrMemberFields() {
  return {
    species: "",
    formIndex: 0,
    level: null,
    moves: ["", "", "", ""],
    abilitySlot: 0,
    fusion: null,
    heldItems: [],
    // Shiny Lab visual effect the mon fields with (empty = none).
    shiny: ctrNormShiny(null),
    // Editor metadata: when true, this member's moves are NOT legality-checked.
    // Persisted only when true; absent in saved JSON = enforced.
    sanityOff: false,
  };
}

/** Deep-copy one possibility's fields (for snapshotting into/out of `variants`). */
function ctrCopyMemberFields(src) {
  return {
    species: src.species || "",
    formIndex: src.formIndex || 0,
    level: typeof src.level === "number" ? src.level : null,
    moves: [...(src.moves || []), "", "", "", ""].slice(0, 4),
    abilitySlot: [0, 1, 2].includes(src.abilitySlot) ? src.abilitySlot : 0,
    fusion: src.fusion ? { ...src.fusion } : null,
    heldItems: (src.heldItems || []).map(h => ({ item: h.item || "", count: Number.isInteger(h.count) ? h.count : 1 })),
    shiny: ctrNormShiny(src.shiny),
    sanityOff: src.sanityOff === true,
  };
}

/**
 * A fresh blank team SLOT (species by CONST). A slot is a member-fields object
 * (the CURRENT possibility, edited live by the field handlers) PLUS slot metadata:
 *   slotChance : 1-100 fill chance (slots 2-6; slot 1 ignores it)
 *   weighted   : editor flag — save as a variants array vs a flat member
 *   variants   : [{ ...memberFields, weight }] (length >= 1; variants[cur] mirrors
 *                the live top-level fields, synced at discrete events)
 *   cur        : index of the currently-shown/edited possibility
 */
function blankCtrMember() {
  const fields = blankCtrMemberFields();
  return {
    ...fields,
    slotChance: 100,
    weighted: false,
    cur: 0,
    variants: [{ ...ctrCopyMemberFields(fields), weight: 1 }],
  };
}

/** Ensure a slot has valid weighted-variant metadata (repairs a legacy/edited slot). */
function ctrEnsureSlot(m) {
  if (typeof m.slotChance !== "number") {
    m.slotChance = 100;
  }
  if (!Array.isArray(m.variants) || m.variants.length === 0) {
    m.variants = [{ ...ctrCopyMemberFields(m), weight: 1 }];
  }
  if (!Number.isInteger(m.cur) || m.cur < 0 || m.cur >= m.variants.length) {
    m.cur = 0;
  }
  if (typeof m.weighted !== "boolean") {
    m.weighted = m.variants.length > 1;
  }
  for (const v of m.variants) {
    v.weight = clampCtrWeight(v.weight);
  }
}

/** Write the live top-level member fields back into the current possibility (variants[cur]). */
function ctrSyncCurrentVariant(m) {
  ctrEnsureSlot(m);
  const weight = clampCtrWeight(m.variants[m.cur].weight);
  m.variants[m.cur] = { ...ctrCopyMemberFields(m), weight };
}

/** Load possibility `idx` onto the live top-level member fields (weight stays on the variant). */
function ctrLoadVariant(m, idx) {
  const v = m.variants[idx];
  for (const k of CTR_MEMBER_FIELDS) {
    m[k] = ctrCopyMemberFields(v)[k];
  }
  m.cur = idx;
}

/** The total weight across a slot's possibilities (each clamped to >= 1). */
function ctrTotalWeight(m) {
  return (m.variants || []).reduce((s, v) => s + clampCtrWeight(v.weight), 0) || 1;
}

/** Human "30/100 = 30%" pick-odds string for the CURRENT possibility. */
function ctrSlotOdds(m) {
  const w = clampCtrWeight(m.variants[m.cur].weight);
  const total = ctrTotalWeight(m);
  return `${w}/${total} = ${Math.round((w / total) * 100)}%`;
}

/** A fresh blank trainer, with the next free id in the 70000-79999 band. */
function blankCtrTrainer() {
  let max = 70000;
  for (const t of Object.values(ctr.current)) {
    if (t && Number.isInteger(t.id) && t.id > max) {
      max = t.id;
    }
  }
  for (const t of Object.values(CTR_LIVE)) {
    if (t && Number.isInteger(t.id) && t.id > max) {
      max = t.id;
    }
  }
  return {
    id: max + 1,
    name: "",
    trainerClass: "ACE_TRAINER",
    gender: "m",
    battleType: "single",
    difficulties: ["ace", "elite", "hell"],
    minWave: 20,
    maxWave: 80,
    endless: false,
    weight: 100,
    challenge: "none",
    challengeValue: null,
    battleBgm: "",
    introDialogue: "",
    victoryDialogue: "",
    defeatDialogue: "",
    trainerEffect: "",
    team: [blankCtrMember()],
  };
}

/** Convert a LIVE entry (species by id) to an edit entry (species by CONST). */
function ctrLiveToEdit(entry) {
  return {
    id: entry.id,
    name: entry.name ?? "",
    trainerClass: entry.trainerClass ?? "ACE_TRAINER",
    gender: entry.gender === "f" ? "f" : "m",
    battleType: entry.battleType ?? "single",
    difficulties: Array.isArray(entry.difficulties) ? entry.difficulties.slice() : ["ace", "elite", "hell"],
    minWave: Number.isInteger(entry.minWave) ? entry.minWave : 20,
    maxWave: Number.isInteger(entry.maxWave) ? entry.maxWave : 80,
    endless: entry.endless === true,
    // Pick weight (spawnChance -> weight migration): a saved entry with a legacy
    // spawnChance and no weight migrates to weight = spawnChance (clamped >= 1);
    // absent both => 100. New saves always write `weight`.
    weight: resolveCtrWeight(entry.weight, entry.spawnChance),
    challenge: entry.challenge ?? "none",
    // Optional challenge VALUE (mono-type/gen/color/... parameter); positive int or null.
    challengeValue: normalizeCtrChallengeValue(entry.challengeValue),
    // Trimmed bgm key; anything not [a-z0-9_] (or absent) normalizes to "" (none).
    battleBgm: normalizeCtrBattleBgm(entry.battleBgm),
    introDialogue: typeof entry.introDialogue === "string" ? entry.introDialogue.slice(0, 200) : "",
    victoryDialogue: typeof entry.victoryDialogue === "string" ? entry.victoryDialogue.slice(0, 200) : "",
    defeatDialogue: typeof entry.defeatDialogue === "string" ? entry.defeatDialogue.slice(0, 200) : "",
    // Known aura id kept; anything else (or absent) normalizes to "" (no effect).
    trainerEffect: normalizeCtrTrainerEffect(entry.trainerEffect),
    team: (Array.isArray(entry.team) ? entry.team : []).map(ctrLiveSlotToEdit),
  };
}

/** Map ONE live member's fields (species by id) to edit fields (species by CONST). */
function ctrLiveMemberFieldsToEdit(m) {
  const idToConst = id => spById.get(id)?.const ?? "";
  return {
    species: idToConst(m.species),
    formIndex: Number.isInteger(m.formIndex) ? m.formIndex : 0,
    level: typeof m.level === "number" ? m.level : null,
    moves: [...(m.moves || []), "", "", "", ""].slice(0, 4),
    abilitySlot: [0, 1, 2].includes(m.abilitySlot) ? m.abilitySlot : 0,
    fusion:
      m.fusion && Number.isInteger(m.fusion.species)
        ? {
            species: idToConst(m.fusion.species),
            formIndex: Number.isInteger(m.fusion.formIndex) ? m.fusion.formIndex : 0,
            abilitySlot: [0, 1, 2].includes(m.fusion.abilitySlot) ? m.fusion.abilitySlot : 0,
          }
        : null,
    heldItems: (Array.isArray(m.heldItems) ? m.heldItems : []).map(h => ({
      item: h.item || "",
      count: Number.isInteger(h.count) ? h.count : 1,
    })),
    shiny: ctrNormShiny(m.shiny),
    sanityOff: m.sanityOff === true,
  };
}

/** Map ONE live team slot (flat member OR `{ variants, slotChance }`) to an edit slot. */
function ctrLiveSlotToEdit(entry) {
  // Weighted slot: several possibilities + an optional fill chance.
  if (entry && Array.isArray(entry.variants)) {
    const variants = entry.variants.map(v => ({ ...ctrLiveMemberFieldsToEdit(v), weight: clampCtrWeight(v.weight) }));
    if (variants.length === 0) {
      variants.push({ ...blankCtrMemberFields(), weight: 1 });
    }
    const slot = {
      ...ctrCopyMemberFields(variants[0]), // current = variant 0
      slotChance: normalizeCtrSlotChance(entry.slotChance),
      weighted: variants.length > 1,
      cur: 0,
      variants,
    };
    return slot;
  }
  // Flat member: one possibility (weight 1), optional slotChance on the member.
  const fields = ctrLiveMemberFieldsToEdit(entry || {});
  return {
    ...fields,
    slotChance: normalizeCtrSlotChance(entry ? entry.slotChance : undefined),
    weighted: false,
    cur: 0,
    variants: [{ ...ctrCopyMemberFields(fields), weight: 1 }],
  };
}

/** Normalize a bgm key for editing: trim + [a-z0-9_] + 64 cap; else "" (none). */
function normalizeCtrBattleBgm(value) {
  if (typeof value !== "string") {
    return "";
  }
  const key = value.trim();
  return key.length > 0 && key.length <= 64 && /^[a-z0-9_]+$/.test(key) ? key : "";
}

/** A known Ghost-FX aura id (validated against the loaded catalog), else "" (no effect). */
function normalizeCtrTrainerEffect(value) {
  return typeof value === "string" && trainerFxById.has(value) ? value : "";
}

/** Compute BST warnings + the Ace/custom informational note for a trainer (never blocks). */
function ctrWarnings(t) {
  const warnings = [];
  const notes = [];
  const diffs = t.difficulties.length > 0 ? t.difficulties : ["ace"];
  // Ace convention (#345): ER customs / fusions marked Ace are informational.
  if (t.difficulties.includes("ace")) {
    const hasCustomOrFusion = t.team.some(m => (spByConst.get(m.species)?.id ?? 0) >= 10000 || m.fusion);
    if (hasCustomOrFusion) {
      notes.push("Ace is a pure-vanilla region by convention (#345); this team includes an ER custom or a fusion.");
    }
  }
  for (const diff of diffs) {
    // Ace/Youngster have no in-game BST ladder; use the Elite curve as the
    // region reference so staff still get a warning (maintainer directive).
    const ladderKey = diff === "hell" ? "hell" : "elite";
    // Strictest at the earliest floor the trainer can appear.
    const cap = bstCapFor(t.minWave, ladderKey);
    if (cap === null) {
      continue;
    }
    t.team.forEach((m, i) => {
      if (!m.species) {
        return;
      }
      const base = bstOfConst(m.species);
      const bst = m.fusion ? Math.ceil((base + bstOfConst(m.fusion.species)) / 2) : base;
      if (bst > cap) {
        warnings.push(
          `${diff}: slot ${i + 1} (${spByConst.get(m.species)?.name || m.species}) BST ${bst} exceeds the ~${cap} cap around wave ${t.minWave}.`,
        );
      }
    });
  }
  return { warnings, notes };
}

/** Label for one ability slot (0/1/2) of a species CONST: "0 · Pressure".
 *  Falls back to the bare slot number when the species/ability doesn't resolve. */
function ctrAbilLabel(speciesConst, slot) {
  const ab = speciesConst ? abil.current[speciesConst] : null;
  if (!ab) {
    return String(slot);
  }
  const id = slot === 0 ? ab.ability1 : slot === 1 ? ab.ability2 : ab.hidden;
  const name = id ? abilById.get(id)?.name : null;
  return name ? `${slot} · ${name}` : String(slot);
}

/** The three <option>s for an ability-slot picker, labelled with real names. */
function ctrAbilOptions(speciesConst, selected) {
  return [0, 1, 2]
    .map(s => `<option value="${s}"${selected === s ? " selected" : ""}>${esc(ctrAbilLabel(speciesConst, s))}</option>`)
    .join("");
}

/** The authored factory sets for a species CONST (empty when the species has none). */
function factorySetsFor(speciesConst) {
  return speciesConst ? factoryByConst.get(speciesConst) || [] : [];
}

/** A short "MOVE_A / MOVE_B / …" summary of a set's moves (for the option tooltip). */
function setMovesSummary(set) {
  return (set.moves || []).filter(Boolean).map(prettify).join(" / ");
}

/**
 * Every species CONST in a fielded species' pre-evolution line (self + every
 * pre-evo down to the root), mirroring the game's collectShowdownFreeMoves walk,
 * which inherits each pre-evolution's learnset. Uses the editor evolution graph
 * (EVOS, keyed by numeric species id: { to:[], from:[] }). Falls back to just the
 * species itself when there is no evo data (e.g. the jsdom smoke harness).
 */
function ctrPreEvoLineConsts(speciesConst) {
  const consts = new Set([speciesConst]);
  const startId = spByConst.get(speciesConst)?.id;
  if (startId === undefined) {
    return consts;
  }
  const visited = new Set();
  const stack = [startId];
  while (stack.length > 0) {
    const id = stack.pop();
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    const c = spById.get(id)?.const;
    if (c) {
      consts.add(c);
    }
    const from = EVOS[id]?.from;
    if (Array.isArray(from)) {
      for (const pid of from) {
        stack.push(pid);
      }
    }
  }
  return consts;
}

/**
 * Legal move enum-KEYs for a species CONST = levelup ∪ TM ∪ egg moves, ACROSS the
 * whole pre-evolution line (matching the game's RLA/RLNA free-move pool), from the
 * data the editor already loaded (learnsets / tm-learnsets / er-egg-moves). The
 * numeric move ids resolve to DISPLAY names via moves-rich; moveNameToEnumKey maps
 * those to the enum-key space the inputs + MOVE_SET use. Memoized.
 * An empty set means "no data for this species" (treated as: enforce nothing so a
 * data gap never blocks a save — the illegal check below skips an empty pool).
 */
function legalMovesFor(speciesConst) {
  if (!speciesConst) {
    return new Set();
  }
  const cached = legalMovesCache.get(speciesConst);
  if (cached) {
    return cached;
  }
  const out = new Set();
  // learnsets/tm-learnsets ship numeric move ids; moves-rich maps id -> DISPLAY
  // name, so derive the enum KEY (the space the move inputs + MOVE_SET compare in).
  // Union across the pre-evolution line so an evolved mon keeps its base's moves.
  for (const c of ctrPreEvoLineConsts(speciesConst)) {
    for (const [, moveId] of learn.current[c] || []) {
      const nm = moveById.get(moveId)?.name;
      if (nm) {
        out.add(moveNameToEnumKey(nm));
      }
    }
    for (const moveId of tms.current[c] || []) {
      const nm = moveById.get(moveId)?.name;
      if (nm) {
        out.add(moveNameToEnumKey(nm));
      }
    }
    // Egg moves already ship as enum NAMES (er-egg-moves strips the MoveId. prefix);
    // normalize through the same transform so a stray-spaced entry still lands right.
    // The line union folds the root's egg moves into an evolved form (as the game does).
    const eggNames = (egg.current[c] ?? EGG_MOVES_LIVE[c] ?? []).filter(Boolean);
    for (const nm of eggNames) {
      out.add(moveNameToEnumKey(nm));
    }
  }
  legalMovesCache.set(speciesConst, out);
  return out;
}

/** True when enforcement is ON for this member AND `move` is not in its legal pool.
 *  The RLA/RLNA tokens are ALWAYS legal (resolved to a legal move at install). */
function ctrMoveIllegal(m, move) {
  if (m.sanityOff || !move || ctrIsMoveToken(move)) {
    return false;
  }
  const legal = legalMovesFor(m.species);
  // An empty pool = no legality data for this species; don't flag (never blocks).
  return legal.size > 0 && !legal.has(move);
}

/** Every illegal move on an enforced member (names), for the error line + save gate.
 *  RLA/RLNA tokens are exempt (never counted illegal). */
function ctrIllegalMoves(m) {
  if (m.sanityOff) {
    return [];
  }
  const legal = legalMovesFor(m.species);
  if (legal.size === 0) {
    return [];
  }
  return (m.moves || [])
    .map(x => (x || "").trim().toUpperCase())
    .filter(mv => mv && !ctrIsMoveToken(mv) && !legal.has(mv));
}

// ---- Battle-music preview (one shared Audio element) ------------------------
/** Stop any in-flight preview and clear the "now playing" marker. */
function bgmStop() {
  if (bgmPreviewAudio) {
    bgmPreviewAudio.pause();
    bgmPreviewAudio.currentTime = 0;
  }
  bgmPreviewKey = null;
  const btn = document.getElementById("ctr-bgm-play");
  if (btn) {
    btn.textContent = "▶";
  }
}

/** Preview a bgm key through the single shared Audio element (toggles on repeat). */
function bgmPlay(key) {
  if (!key) {
    return;
  }
  // Clicking the same track again while it plays stops it (toggle).
  if (bgmPreviewKey === key && bgmPreviewAudio && !bgmPreviewAudio.paused) {
    bgmStop();
    return;
  }
  if (!bgmPreviewAudio) {
    bgmPreviewAudio = new Audio();
    bgmPreviewAudio.addEventListener("ended", bgmStop);
  }
  bgmPreviewAudio.pause();
  bgmPreviewAudio.src = `${BGM_AUDIO_BASE}/${key}.mp3`;
  bgmPreviewKey = key;
  bgmPreviewAudio.currentTime = 0;
  bgmPreviewAudio.play().catch(() => {
    /* autoplay/network failure: leave the marker cleared */
    bgmStop();
  });
  const btn = document.getElementById("ctr-bgm-play");
  if (btn) {
    btn.textContent = "⏸";
  }
}

/** The <option>s for the battle-music picker: "(default)" + battle themes + rest. */
function ctrBgmOptions(selected) {
  const opt = b => `<option value="${esc(b.key)}"${selected === b.key ? " selected" : ""}>${esc(b.key)}</option>`;
  const battle = BGM_LIST.filter(b => b.battle);
  const other = BGM_LIST.filter(b => !b.battle);
  let html = `<option value=""${selected ? "" : " selected"}>(default)</option>`;
  if (battle.length > 0) {
    html += `<optgroup label="Battle themes">${battle.map(opt).join("")}</optgroup>`;
  }
  if (other.length > 0) {
    html += `<optgroup label="Other tracks">${other.map(opt).join("")}</optgroup>`;
  }
  // A saved key that is no longer in the catalog still shows as selected.
  if (selected && !BGM_LIST.some(b => b.key === selected)) {
    html += `<option value="${esc(selected)}" selected>${esc(selected)} (missing)</option>`;
  }
  return html;
}

/** <option> list for the per-trainer SPRITE effect (aura) picker: a leading "(none)"
 *  entry then every ghost-FX aura, with a saved-but-unknown id kept as selected. */
function ctrEffectOptions(selected) {
  let html = `<option value=""${selected ? "" : " selected"}>(none)</option>`;
  html += TRAINER_FX.map(
    e => `<option value="${esc(e.id)}"${selected === e.id ? " selected" : ""}>${esc(e.label)}</option>`,
  ).join("");
  if (selected && !trainerFxById.has(selected)) {
    html += `<option value="${esc(selected)}" selected>${esc(selected)} (unknown)</option>`;
  }
  return html;
}

/** A small swatch chip for the currently-selected trainer sprite effect (preview column). */
function ctrEffectSwatchHtml(effectId) {
  const e = effectId ? trainerFxById.get(effectId) : null;
  if (!e) {
    return '<span class="dyn">no effect</span>';
  }
  return `<span class="ctr-shiny-swatch"><span class="ctr-shiny-chip"><span class="ctr-shiny-dot" style="background:${esc(e.accent || "#ffd27a")}"></span>${esc(e.label)}</span></span>`;
}

/** The always-visible header controls for a slot: slot-fill probability (slots
 *  2-6) + the "Weighted slot?" toggle and, when weighted, the possibility stepper,
 *  weight editor, pick-odds and +/✕ possibility buttons (mockup header row). */
function ctrSlotControlsHtml(m, i) {
  const slotProb =
    i > 0
      ? `<label class="ctr-slotprob" title="Chance this slot is FILLED this run (slots 2-6). 100 = always; a failed roll omits the slot and the party shrinks.">Slot&nbsp;Probability <input type="number" class="ctr-slotchance" data-idx="${i}" value="${normalizeCtrSlotChance(m.slotChance)}" min="1" max="100" style="width:56px" /></label>`
      : "";
  const weightedToggle = `<label class="ctr-weighted-lbl" title="Weighted slot: several Pokémon possibilities, ONE picked per run by weight. Unchecking keeps ONLY the currently-shown possibility."><input type="checkbox" class="ctr-weighted" data-idx="${i}"${m.weighted ? " checked" : ""} /> Weighted slot?</label>`;
  let weightedCtrls = "";
  if (m.weighted) {
    const n = m.variants.length;
    const curWeight = clampCtrWeight(m.variants[m.cur].weight);
    weightedCtrls = `<span class="ctr-var-ctrls">Pokémon
      <button type="button" class="ctr-var-prev" data-idx="${i}" title="Previous possibility">◂</button>
      <span class="ctr-var-n"><b>${m.cur + 1}</b>/${n}</span>
      <button type="button" class="ctr-var-next" data-idx="${i}" title="Next possibility">▸</button>
      weight <input type="number" class="ctr-var-weight" data-idx="${i}" value="${curWeight}" min="1" max="999" style="width:52px" />
      <span class="ctr-var-odds" title="Pick odds for this possibility this run">${esc(ctrSlotOdds(m))}</span>
      <button type="button" class="ctr-var-add" data-idx="${i}" title="Add a possibility">＋ possibility</button>
      ${n > 1 ? `<button type="button" class="ctr-var-del" data-idx="${i}" title="Remove this possibility">✕ possibility</button>` : ""}
    </span>`;
  }
  return `<div class="ctr-slot-ctrls">${slotProb}${weightedToggle}${weightedCtrls}</div>`;
}

/** The <option>s for one shiny-effect category select: "(none)" + the registry. */
function ctrShinyOptions(category, selected) {
  const list = SHINY_EFFECTS[category] || [];
  let html = `<option value=""${selected ? "" : " selected"}>(none)</option>`;
  for (const e of list) {
    html += `<option value="${esc(e.id)}"${selected === e.id ? " selected" : ""}>${esc(e.label)}</option>`;
  }
  // A saved id no longer in the registry still shows selected (never silently drop).
  if (selected && !list.some(e => e.id === selected)) {
    html += `<option value="${esc(selected)}" selected>${esc(selected)} (missing)</option>`;
  }
  return html;
}

/** A rough color-chip approximation of a shiny look (the REAL effect renders in-game). */
function ctrShinySwatchHtml(s) {
  const chips = [];
  for (const cat of ["palette", "surface", "around"]) {
    const id = s[cat];
    if (!id) {
      continue;
    }
    const e = shinyEffectById.get(id);
    const accent = e ? e.accent : "#888";
    const label = e ? e.label : id;
    chips.push(
      `<span class="ctr-shiny-chip" title="${esc(cat)}"><span class="ctr-shiny-dot" style="background:${esc(accent)}"></span>${esc(label)}</span>`,
    );
  }
  return chips.length > 0
    ? `<span class="ctr-shiny-swatch">${chips.join("")}</span>`
    : '<span class="dyn">no effect (renders normally)</span>';
}

/** Per-member Shiny Lab effect picker: a palette/surface/aura select + name prefix
 *  + an honest color-swatch approximation. Empty selects = the mon renders normally. */
function ctrShinyPickerHtml(m, i) {
  const s = ctrNormShiny(m.shiny);
  return `<div class="ctr-shiny" data-idx="${i}">
    <span class="ctr-shiny-lbl" title="Shiny Lab visual effect this Pokémon fields with in battle. The swatch is a rough approximation; the animated effect renders in-game.">Shiny effect:</span>
    <label>Palette <select class="ctr-shiny-sel" data-idx="${i}" data-cat="palette">${ctrShinyOptions("palette", s.palette)}</select></label>
    <label>Surface <select class="ctr-shiny-sel" data-idx="${i}" data-cat="surface">${ctrShinyOptions("surface", s.surface)}</select></label>
    <label>Aura <select class="ctr-shiny-sel" data-idx="${i}" data-cat="around">${ctrShinyOptions("around", s.around)}</select></label>
    <label>Name <input class="ctr-shiny-name" data-idx="${i}" maxlength="16" value="${esc(s.name || "")}" placeholder="name prefix" spellcheck="false" style="width:120px" /></label>
    ${ctrShinySwatchHtml(s)}
  </div>`;
}

/** Verbatim port of getFusedSpeciesName (src/utils/pokemon-utils.ts): the NAME the
 *  game generates for a fusion of two species display names. Kept byte-for-byte so
 *  the editor preview matches the in-game fused name exactly. */
function ctrFusedName(speciesAName, speciesBName) {
  const fragAPattern = /([a-z]{2}.*?[aeiou(?:y$)\-']+)(.*?)$/i;
  const fragBPattern = /([a-z]{2}.*?[aeiou(?:y$)\-'])(.*?)$/i;
  const [speciesAPrefixMatch, speciesBPrefixMatch] = [speciesAName, speciesBName].map(n => /^(?:[^ ]+) /.exec(n));
  const [speciesAPrefix, speciesBPrefix] = [speciesAPrefixMatch, speciesBPrefixMatch].map(m => (m ? m[0] : ""));
  if (speciesAPrefix) {
    speciesAName = speciesAName.slice(speciesAPrefix.length);
  }
  if (speciesBPrefix) {
    speciesBName = speciesBName.slice(speciesBPrefix.length);
  }
  const [speciesASuffixMatch, speciesBSuffixMatch] = [speciesAName, speciesBName].map(n => / (?:[^ ]+)$/.exec(n));
  const [speciesASuffix, speciesBSuffix] = [speciesASuffixMatch, speciesBSuffixMatch].map(m => (m ? m[0] : ""));
  if (speciesASuffix) {
    speciesAName = speciesAName.slice(0, -speciesASuffix.length);
  }
  if (speciesBSuffix) {
    speciesBName = speciesBName.slice(0, -speciesBSuffix.length);
  }
  const splitNameA = speciesAName.split(/ /g);
  const splitNameB = speciesBName.split(/ /g);
  const fragAMatch = fragAPattern.exec(speciesAName);
  const fragBMatch = fragBPattern.exec(speciesBName);
  let fragA;
  let fragB;
  fragA = splitNameA.length === 1 ? (fragAMatch ? fragAMatch[1] : speciesAName) : splitNameA.at(-1);
  if (splitNameB.length === 1) {
    if (fragBMatch) {
      const lastCharA = fragA.slice(fragA.length - 1);
      const prevCharB = fragBMatch[1].slice(fragBMatch.length - 1);
      fragB = (/[-']/.test(prevCharB) ? prevCharB : "") + fragBMatch[2] || prevCharB;
      if (lastCharA === fragB[0]) {
        if (/[aiu]/.test(lastCharA)) {
          fragB = fragB.slice(1);
        } else {
          const newCharMatch = new RegExp(`[^${lastCharA}]`).exec(fragB);
          if (newCharMatch?.index !== undefined && newCharMatch.index > 0) {
            fragB = fragB.slice(newCharMatch.index);
          }
        }
      }
    } else {
      fragB = speciesBName;
    }
  } else {
    fragB = splitNameB.at(-1);
  }
  if (splitNameA.length > 1) {
    fragA = `${splitNameA.slice(0, splitNameA.length - 1).join(" ")} ${fragA}`;
  }
  fragB = `${fragB.slice(0, 1).toLowerCase()}${fragB.slice(1)}`;
  if (fragA === "Rapi") {
    fragA = "Rapid";
    if (fragB === "ng") {
      fragB = speciesBName.slice(speciesBName.length - 3);
    }
  }
  return `${speciesAPrefix || speciesBPrefix}${fragA}${fragB}${speciesBSuffix || speciesASuffix}`;
}

/** A species CONST's front-sprite CDN url (same slug path the game/editor mon
 *  previews use), or "" when the species/slug can't be resolved. */
function ctrSpeciesSpriteUrl(speciesConst) {
  const s = speciesConst ? spByConst.get(speciesConst) : null;
  return s && s.slug ? `${SPRITE_BASE}/${s.slug}/front.png` : "";
}

/** Fusion preview: the two base + fusion battle sprites side by side + the fused
 *  NAME the game would generate. Approximation label: in-game blends palettes too.
 *  Returns "" when the member has no (complete) fusion configured. */
function ctrFusionPreviewHtml(m) {
  const fus = m && m.fusion;
  if (!fus || !m.species || !fus.species) {
    return "";
  }
  const base = spByConst.get(m.species);
  const other = spByConst.get(fus.species);
  if (!base || !other) {
    return "";
  }
  const fused = ctrFusedName(base.name || m.species, other.name || fus.species);
  const img = url =>
    url
      ? `<img src="${esc(url)}" style="width:56px;height:56px;image-rendering:pixelated" onerror="this.style.visibility='hidden'" />`
      : '<span class="dyn">?</span>';
  return `<div class="ctr-fusion-preview">
    <div class="ctr-fusion-sprites">${img(ctrSpeciesSpriteUrl(m.species))}<span class="ctr-fusion-plus">+</span>${img(ctrSpeciesSpriteUrl(fus.species))}</div>
    <div class="ctr-fusion-name">Fused name: <b>${esc(fused)}</b></div>
    <div class="hint">Approximation: in-game fusion also blends palettes.</div>
  </div>`;
}

function ctrMemberHtml(m, i) {
  ctrEnsureSlot(m); // repair weighted-variant metadata on a legacy/edited slot
  const open = ctrOpenMembers.has(i);
  const scale = m.level === null;
  const sets = factorySetsFor(m.species);
  const selSet = ctrSetSel.has(i) ? ctrSetSel.get(i) : -1;
  const spName = m.species ? spByConst.get(m.species)?.name || m.species : "(empty)";
  // Collapsed summary: slot, species, level, set name if any (task #9). A weighted
  // slot tags the current possibility (e.g. "· 2/3").
  const setTag = selSet >= 0 && sets[selSet] ? ` · Set ${selSet + 1}` : "";
  const varTag = m.weighted && m.variants.length > 1 ? ` · ${m.cur + 1}/${m.variants.length}` : "";
  const summary = `<span class="ctr-mem-sum" data-idx="${i}" role="button" title="Click to ${open ? "collapse" : "expand"}">
    <span class="ctr-mem-caret">${open ? "▾" : "▸"}</span> Slot ${i + 1}: <b>${esc(spName)}</b>
    <small>${scale ? "wave-scaled" : `Lv ${m.level}`}${setTag}${varTag}${m.sanityOff ? " · sanity off" : ""}</small></span>`;
  const slotCtrls = ctrSlotControlsHtml(m, i);
  if (!open) {
    return `<fieldset class="ctr-member">
      <legend>${summary} <button type="button" class="ctr-mem-del" data-idx="${i}" title="Remove this member">✕</button></legend>
      ${slotCtrls}
    </fieldset>`;
  }
  // Move-legality: enforce unless sanity is off. A per-member datalist always
  // offers the RLA/RLNA tokens FIRST, then the legal pool when we HAVE data (else
  // the full move set so a data gap never traps the user; matches the save gate).
  const enforce = !m.sanityOff;
  const legal = enforce ? legalMovesFor(m.species) : null;
  const useLegalList = enforce && legal && legal.size > 0;
  const poolNames = useLegalList ? [...legal].sort() : [...MOVE_SET].sort();
  const tokenOpts = ["RLA", "RLNA"]
    .map(tk => `<option value="${tk}">${esc(CTR_MOVE_TOKEN_LABEL[tk])}</option>`)
    .join("");
  const listId = `ctr-moves-${i}`;
  const legalDatalist = `<datalist id="${listId}">${tokenOpts}${poolNames
    .map(mv => `<option value="${mv}">${prettify(mv)}</option>`)
    .join("")}</datalist>`;
  const moveInputs = [0, 1, 2, 3]
    .map(s => {
      const bad = ctrMoveIllegal(m, (m.moves[s] || "").trim().toUpperCase());
      return `<input class="ctr-move" list="${listId}" data-idx="${i}" data-slot="${s}" value="${esc(m.moves[s] || "")}" placeholder="move ${s + 1}" spellcheck="false" style="width:130px${bad ? `;border-color:${ERR}` : ""}" />`;
    })
    .join(" ");
  const illegal = ctrIllegalMoves(m);
  const errLine =
    illegal.length > 0
      ? `<div class="ctr-move-err">✗ illegal move${illegal.length > 1 ? "s" : ""} for ${esc(spName)}: ${illegal
          .map(esc)
          .join(", ")} — not in its level-up/TM/egg pool. Fix it, or tick “Move sanity off”.</div>`
      : "";
  const setDropdown =
    sets.length === 0
      ? `<select class="ctr-set" data-idx="${i}" disabled title="This species has no authored factory sets"><option>(no sets)</option></select>`
      : `<select class="ctr-set" data-idx="${i}" title="Fill the 4 moves + ability from an authored set">
          <option value="-1"${selSet === -1 ? " selected" : ""}>(custom)</option>
          ${sets
            .map(
              (set, si) =>
                `<option value="${si}"${selSet === si ? " selected" : ""} title="${esc(setMovesSummary(set))}">Set ${si + 1} · ${esc(setMovesSummary(set))}</option>`,
            )
            .join("")}
        </select>`;
  const heldRows = m.heldItems
    .map(
      (h, hi) =>
        `<span class="ctr-held-row"><input class="ctr-held-item" list="helditems-list" data-idx="${i}" data-heldidx="${hi}" value="${esc(h.item || "")}" placeholder="held item" spellcheck="false" style="width:150px" />
        <input type="number" class="ctr-held-count" data-idx="${i}" data-heldidx="${hi}" value="${h.count || 1}" min="1" max="99" style="width:52px" />
        <button type="button" class="ctr-held-del" data-idx="${i}" data-heldidx="${hi}">✕</button></span>`,
    )
    .join("");
  const fus = m.fusion;
  return `<fieldset class="ctr-member open">
    <legend>${summary} <button type="button" class="ctr-mem-del" data-idx="${i}" title="Remove this member">✕</button></legend>
    ${slotCtrls}
    <label>Species <input class="ctr-species" list="species-list" data-idx="${i}" value="${esc(m.species || "")}" placeholder="SPECIES_…" spellcheck="false" style="width:170px" /></label>
    <label>Form <input type="number" class="ctr-form" data-idx="${i}" value="${m.formIndex || 0}" min="0" max="60" style="width:56px" /></label>
    <label>Ability slot <select class="ctr-abil" data-idx="${i}">${ctrAbilOptions(m.species, m.abilitySlot)}</select></label>
    <label title="Uncheck to set an explicit level">Wave-scale level <input type="checkbox" class="ctr-scale" data-idx="${i}"${scale ? " checked" : ""} /></label>
    <label>Level <input type="number" class="ctr-level" data-idx="${i}" value="${scale ? "" : m.level}" min="1" max="200" ${scale ? "disabled" : ""} style="width:64px" /></label>
    <div class="ctr-moves-head">
      <label>Use set <span>${setDropdown}</span></label>
      <label title="Skip move-legality checks for this member (saved as sanityOff)"><input type="checkbox" class="ctr-sanity" data-idx="${i}"${m.sanityOff ? " checked" : ""} /> Move sanity off</label>
    </div>
    <div class="ctr-moves">${moveInputs}${legalDatalist}</div>
    <div class="hint ctr-move-hint">Tokens: type <b>RLA</b> (random legal attacking) or <b>RLNA</b> (random legal non-attacking) as a move — resolved to a seeded random legal move of this species in-game (exempt from the legality check).</div>
    ${errLine}
    <div class="ctr-fusion">
      <label>Fusion <input type="checkbox" class="ctr-fusion-on" data-idx="${i}"${fus ? " checked" : ""} /></label>
      ${
        fus
          ? `<input class="ctr-fusion-species" list="species-list" data-idx="${i}" value="${esc(fus.species || "")}" placeholder="fusion SPECIES_…" spellcheck="false" style="width:170px" />
          <label>Form <input type="number" class="ctr-fusion-form" data-idx="${i}" value="${fus.formIndex || 0}" min="0" max="60" style="width:56px" /></label>
          <label>Ability slot <select class="ctr-fusion-abil" data-idx="${i}">${ctrAbilOptions(fus.species, fus.abilitySlot)}</select></label>`
          : ""
      }
    </div>
    <div class="ctr-held">Held items: ${heldRows}<button type="button" class="ctr-held-add" data-idx="${i}">＋ item</button></div>
    ${ctrShinyPickerHtml(m, i)}
  </fieldset>`;
}

/** First frame + sheet size from a TexturePacker atlas json, or null. */
function firstAtlasFrame(atlas) {
  const tx = atlas && Array.isArray(atlas.textures) ? atlas.textures[0] : null;
  const fr = tx && Array.isArray(tx.frames) ? tx.frames[0] : null;
  if (!tx || !fr || !fr.frame || tx.size === 0) {
    return null;
  }
  return { crop: fr.frame, sheet: tx.size };
}

/** Fetch (and cache) a trainer atlas json, sharing ONE in-flight request per url. */
function fetchTrainerAtlas(url) {
  if (trainerAtlasCache.has(url)) {
    return Promise.resolve(trainerAtlasCache.get(url));
  }
  if (trainerAtlasInflight.has(url)) {
    return trainerAtlasInflight.get(url);
  }
  const p = fetch(url)
    .then(r => (r.ok ? r.json() : null))
    .catch(() => null)
    .then(atlas => {
      trainerAtlasCache.set(url, atlas);
      trainerAtlasInflight.delete(url);
      return atlas;
    });
  trainerAtlasInflight.set(url, p);
  return p;
}

/** Crop one trainer sprite's first frame into `el` via CSS background. Scaled 2x by
 *  default; pass `{ targetH }` to fit a specific pixel height (e.g. the list card). */
function renderTrainerFrame(file, el, opts) {
  const url = `${TRAINER_SPRITE_BASE}/${file}.json`;
  const paint = atlas => {
    if (!el.isConnected) {
      return;
    }
    const info = atlas ? firstAtlasFrame(atlas) : null;
    if (!info) {
      el.textContent = "?";
      el.title = "sprite atlas unavailable";
      return;
    }
    const { crop, sheet } = info;
    const scale = opts && opts.targetH ? opts.targetH / crop.h : 2;
    el.style.width = `${crop.w * scale}px`;
    el.style.height = `${crop.h * scale}px`;
    el.style.backgroundImage = `url("${TRAINER_SPRITE_BASE}/${file}.png")`;
    el.style.backgroundSize = `${sheet.w * scale}px ${sheet.h * scale}px`;
    el.style.backgroundPosition = `-${crop.x * scale}px -${crop.y * scale}px`;
    el.style.backgroundRepeat = "no-repeat";
    el.style.imageRendering = "pixelated";
  };
  if (trainerAtlasCache.has(url)) {
    paint(trainerAtlasCache.get(url));
    return;
  }
  fetchTrainerAtlas(url).then(paint);
}

/** True when the CURRENT trainer's class ships both `_m`/`_f` sprites (hasGenders). */
function ctrClassHasGenders() {
  const t = ctrCur();
  const entry = t ? trainerClassByName.get((t.trainerClass || "").trim().toUpperCase()) : null;
  return !!(entry && entry.genders);
}

/** M/F radio for gendered classes (which sprite the trainer fields). Hidden for
 *  single-sprite classes (gender has no effect there). */
function ctrGenderPickerHtml(t) {
  if (!ctrClassHasGenders()) {
    return "";
  }
  const g = t.gender === "f" ? "f" : "m";
  return `<span class="ctr-gender" title="Which gendered sprite this trainer fields (classes with an M and F sprite).">Sprite gender:
    <label><input type="radio" name="ctr-gender" class="ctr-gender-radio" value="m"${g === "m" ? " checked" : ""} /> M</label>
    <label><input type="radio" name="ctr-gender" class="ctr-gender-radio" value="f"${g === "f" ? " checked" : ""} /> F</label></span>`;
}

/** Refresh the trainer-class sprite preview from the current #ctr-class value. For
 *  a gendered class, show ONLY the selected variant; for an unknown class, nothing;
 *  a single-sprite class shows its one sprite. */
function updateCtrSpritePreview() {
  const box = document.getElementById("ctr-sprite-preview");
  if (!box) {
    return;
  }
  const input = document.getElementById("ctr-class");
  const name = input ? input.value.trim().toUpperCase() : "";
  const entry = trainerClassByName.get(name);
  box.innerHTML = "";
  if (!entry) {
    box.innerHTML = '<span class="dyn">no sprite for this class</span>';
    return;
  }
  const t = ctrCur();
  // Gendered class: field ONLY the selected variant (default "m"); single-sprite
  // class: its lone sprite (gender has no meaning).
  const files = entry.genders ? [`${entry.sprite}_${t && t.gender === "f" ? "f" : "m"}`] : [entry.sprite];
  for (const f of files) {
    const frame = document.createElement("div");
    frame.className = "ctr-sprite-frame";
    box.appendChild(frame);
    renderTrainerFrame(f, frame);
  }
}

// ---- Trainer-class Browse modal (visual sprite picker, task #6) -------------
let trainerClassModalEl = null;

/** Tear down the class-browse modal (and its IntersectionObserver). */
function closeTrainerClassModal() {
  if (trainerClassModalEl) {
    if (trainerClassModalEl._io) {
      trainerClassModalEl._io.disconnect();
    }
    trainerClassModalEl.remove();
    trainerClassModalEl = null;
  }
}

/**
 * Open an in-page modal grid of EVERY sprite-bearing trainer class
 * (trainer-classes.json). Each cell shows the lazy CDN atlas-crop sprite (reusing
 * renderTrainerFrame + the shared trainerAtlasCache) + the prettified name. Cells
 * paint their sprite ONLY when scrolled into view (IntersectionObserver), so
 * opening the modal doesn't fire 249 fetches at once. A text filter narrows the
 * grid. Clicking a cell fills #ctr-class, closes, and refreshes the inline preview.
 */
function openTrainerClassModal() {
  closeTrainerClassModal();
  const overlay = document.createElement("div");
  overlay.className = "ctr-modal-overlay";
  overlay.innerHTML = `
    <div class="ctr-modal" role="dialog" aria-label="Browse trainer classes">
      <div class="ctr-modal-head">
        <b>Browse trainer classes</b>
        <input type="search" class="ctr-modal-filter" placeholder="Filter by name…" autocomplete="off" spellcheck="false" />
        <button type="button" class="ctr-modal-close" title="Close">✕</button>
      </div>
      <div class="ctr-modal-grid"></div>
    </div>`;
  document.body.appendChild(overlay);
  trainerClassModalEl = overlay;

  const grid = overlay.querySelector(".ctr-modal-grid");
  const io = new IntersectionObserver(
    entries => {
      for (const ent of entries) {
        if (ent.isIntersecting) {
          const cell = ent.target;
          const frame = cell.querySelector(".ctr-sprite-frame");
          if (frame && !frame.dataset.painted) {
            frame.dataset.painted = "1";
            renderTrainerFrame(cell.dataset.file, frame);
          }
          io.unobserve(cell);
        }
      }
    },
    { root: grid, rootMargin: "120px" },
  );
  overlay._io = io;

  for (const c of TRAINER_CLASSES) {
    const file = c.genders ? `${c.sprite}_m` : c.sprite;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "ctr-modal-cell";
    cell.dataset.tcname = c.name;
    cell.dataset.file = file;
    cell.dataset.hay = `${c.name} ${prettify(c.name)}`.toLowerCase();
    cell.innerHTML = `<div class="ctr-sprite-frame"></div><span class="ctr-cell-name">${esc(prettify(c.name))}</span>`;
    grid.appendChild(cell);
    io.observe(cell);
  }

  const filter = overlay.querySelector(".ctr-modal-filter");
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    for (const cell of grid.children) {
      const show = q === "" || cell.dataset.hay.includes(q);
      cell.style.display = show ? "" : "none";
      // Paint a newly-revealed cell that scrolled past the observer while hidden.
      if (show) {
        const frame = cell.querySelector(".ctr-sprite-frame");
        if (frame && !frame.dataset.painted) {
          io.observe(cell);
        }
      }
    }
  });

  grid.addEventListener("click", e => {
    const cell = e.target.closest(".ctr-modal-cell");
    if (!cell) {
      return;
    }
    const t = ctrCur();
    if (t) {
      t.trainerClass = cell.dataset.tcname;
    }
    const input = document.getElementById("ctr-class");
    if (input) {
      input.value = cell.dataset.tcname;
    }
    closeTrainerClassModal();
    // Re-render so the gender picker (in)appears for the newly-chosen class.
    render();
  });

  overlay.querySelector(".ctr-modal-close").addEventListener("click", closeTrainerClassModal);
  overlay.addEventListener("click", e => {
    if (e.target === overlay) {
      closeTrainerClassModal();
    }
  });
  filter.focus();
}

/** The sticky RIGHT-column preview panel: the trainer sprite (selected gender
 *  variant), the currently-focused member's species sprite + shiny swatch + fusion
 *  preview, and the battle-music now-playing indicator. Pure markup; the trainer
 *  sprite frame is painted after mount by updateCtrSpritePreview (reads #ctr-class). */
function ctrPreviewPanelHtml(t) {
  const team = Array.isArray(t.team) ? t.team : [];
  const idx = Math.max(0, Math.min(ctrFocusIdx, team.length - 1));
  const m = team[idx] || null;
  const spName = m && m.species ? spByConst.get(m.species)?.name || m.species : "(empty)";
  const spriteUrl = m ? ctrSpeciesSpriteUrl(m.species) : "";
  const memberSprite = spriteUrl
    ? `<img src="${esc(spriteUrl)}" style="width:64px;height:64px;image-rendering:pixelated" onerror="this.style.visibility='hidden'" />`
    : '<span class="dyn">no sprite</span>';
  const shiny = m ? ctrNormShiny(m.shiny) : ctrNormShiny(null);
  const fusionPreview = m ? ctrFusionPreviewHtml(m) : "";
  // Battle-music now-playing indicator: the chosen track + a live "playing" tag.
  const bgmKey = t.battleBgm || "";
  const playing = bgmPreviewKey && bgmPreviewAudio && !bgmPreviewAudio.paused ? bgmPreviewKey : "";
  const bgmLine = bgmKey
    ? `♪ <b>${esc(bgmKey)}</b>${playing === bgmKey ? ' <span class="ctr-bgm-live">▶ playing</span>' : ""}`
    : '<span class="dyn">default class theme</span>';
  return `<aside class="ctr-preview-panel">
    <div class="ctr-preview-sec">
      <div class="ctr-preview-h">Trainer sprite</div>
      <div id="ctr-sprite-preview" class="ctr-sprite-preview"></div>
      <div class="ctr-preview-effect">Effect: ${ctrEffectSwatchHtml(t.trainerEffect || "")}</div>
    </div>
    <div class="ctr-preview-sec">
      <div class="ctr-preview-h">Slot ${idx + 1}: ${esc(spName)}</div>
      <div class="ctr-preview-mon">${memberSprite}</div>
      <div class="ctr-preview-shiny">${ctrShinySwatchHtml(shiny)}</div>
      ${fusionPreview}
    </div>
    <div class="ctr-preview-sec">
      <div class="ctr-preview-h">Battle music</div>
      <div class="ctr-preview-bgm">${bgmLine}</div>
    </div>
  </aside>`;
}

/** The trainer-sprite atlas file for a list card (selected gender variant), or ""
 *  when the class ships no sprite (unknown class -> neutral placeholder box). */
function ctrCardSpriteFile(t) {
  const entry = trainerClassByName.get((t.trainerClass || "").trim().toUpperCase());
  if (!entry) {
    return "";
  }
  return entry.genders ? `${entry.sprite}_${t.gender === "f" ? "f" : "m"}` : entry.sprite;
}

/** One small team-member icon for a list card: the downscaled front sprite (same
 *  slug resolution the fusion preview uses). Weighted slot -> the FIRST possibility.
 *  Empty/unresolvable species -> an empty neutral box (never a broken image). */
function ctrCardMonIcon(m) {
  const sp = (Array.isArray(m.variants) && m.variants[0] && m.variants[0].species) || m.species || "";
  const url = ctrSpeciesSpriteUrl(sp);
  const img = url ? `<img src="${esc(url)}" alt="" loading="lazy" onerror="this.style.display='none'" />` : "";
  return `<span class="ctr-card-mon" title="${esc(sp || "empty slot")}">${img}</span>`;
}

function renderCustomTrainers(root) {
  const keys = Object.keys(ctr.current)
    .filter(k => ctr.current[k])
    .sort();
  const list = keys
    .map(k => {
      const t = ctr.current[k];
      const dirty = !jsonEq(ctr.current[k], ctr.baseline[k]);
      const spriteFile = ctrCardSpriteFile(t);
      const monIcons = (Array.isArray(t.team) ? t.team : []).map(ctrCardMonIcon).join("");
      return `<button type="button" class="ctr-open${k === ctrSelected ? " on" : ""}${dirty ? " dirty" : ""}" data-ctropen="${esc(k)}">
        <span class="ctr-card-head">${esc(t.name || k)} <small>#${t.id}</small></span>
        <span class="ctr-card-body">
          <span class="ctr-card-sprite"${spriteFile ? ` data-ctrsprite="${esc(spriteFile)}"` : ""}></span>
          <span class="ctr-card-team">${monIcons}</span>
        </span>
      </button>`;
    })
    .join("");
  let form = '<p class="hint">Pick a trainer to edit, or add a new one.</p>';
  let panel = "";
  if (ctrSelected && ctr.current[ctrSelected]) {
    const t = ctr.current[ctrSelected];
    panel = ctrPreviewPanelHtml(t);
    const { warnings, notes } = ctrWarnings(t);
    const diffChecks = DIFFICULTY_OPTIONS.map(
      d =>
        `<label><input type="checkbox" class="ctr-diff" data-diff="${d}"${t.difficulties.includes(d) ? " checked" : ""} /> ${d[0].toUpperCase() + d.slice(1)}</label>`,
    ).join(" ");
    const battleSel = BATTLE_TYPE_OPTIONS.map(
      b =>
        `<option value="${b}"${t.battleType === b ? " selected" : ""}>${b === "triple" ? "Triple (pending #902 → double)" : b[0].toUpperCase() + b.slice(1)}</option>`,
    ).join("");
    const challSel = CHALLENGE_OPTIONS.map(
      c => `<option value="${c}"${t.challenge === c ? " selected" : ""}>${CHALLENGE_LABELS[c]}</option>`,
    ).join("");
    // Value dropdown: shown only for a value-bearing challenge (mono-type/gen/
    // color/...). "(any value)" leaves challengeValue unset (any value qualifies).
    const challValueSel = ctrChallengeIsParameterizable(t.challenge)
      ? `<label class="ctr-challvalue-lbl" title="Restrict this trainer to ONE specific value of the chosen challenge (e.g. a specific mono-type). '(any value)' matches any value of that challenge.">Value
          <select id="ctr-challenge-value">
            <option value=""${t.challengeValue == null ? " selected" : ""}>(any value)</option>
            ${CHALLENGE_VALUES[t.challenge]
              .map(
                o =>
                  `<option value="${o.value}"${t.challengeValue === o.value ? " selected" : ""}>${esc(o.label)}</option>`,
              )
              .join("")}
          </select>
        </label>`
      : "";
    const bgmSel = ctrBgmOptions(t.battleBgm || "");
    form = `<div class="ctr-form">
      <fieldset class="ctr-sec"><legend>Identity</legend>
        <label>Name <input type="text" id="ctr-name" maxlength="24" value="${esc(t.name || "")}" style="width:200px" /></label>
        <label>Id <input type="text" id="ctr-id" value="${t.id}" readonly tabindex="-1" style="width:80px;opacity:.6" /></label>
        <label>Sprite / class <input type="text" id="ctr-class" list="trainerclass-list" value="${esc(t.trainerClass || "")}" style="width:170px" spellcheck="false" /></label>
        <button type="button" id="ctr-browse-class" title="Browse trainer classes by sprite">Browse…</button>
        ${ctrGenderPickerHtml(t)}
        <div class="ctr-bgm-row">
          <label title="Music that plays for THIS trainer's battle only (er-assets audio/bgm). '(default)' keeps the trainer class's normal theme.">Battle music
            <select id="ctr-bgm">${bgmSel}</select>
          </label>
          <button type="button" id="ctr-bgm-play" title="Preview the selected track">▶</button>
          <button type="button" id="ctr-bgm-stop" title="Stop preview">■</button>
        </div>
        <div class="ctr-intro-row">
          <label title="Line shown when this trainer's battle starts (up to 200 chars). Players can turn these off with the 'Skip custom trainer intros' setting.">Intro blurb
            <input type="text" id="ctr-intro" maxlength="200" value="${esc(t.introDialogue || "")}" placeholder="Shown at battle start (optional)" style="width:320px" />
          </label>
          <label title="Line this trainer says when it BEATS the player (the trainer wins and the player's run ends). Up to 200 chars. Uses the same dialogue routine ghost trainers use.">Line when the trainer WINS
            <input type="text" id="ctr-defeat" maxlength="200" value="${esc(t.defeatDialogue || "")}" placeholder="Trainer's taunt when it beats you (optional)" style="width:280px" />
          </label>
          <label title="Line this trainer says when it is DEFEATED (the player wins the battle). Up to 200 chars. Uses the same dialogue routine ghost trainers use.">Line when the trainer is DEFEATED
            <input type="text" id="ctr-victory" maxlength="200" value="${esc(t.victoryDialogue || "")}" placeholder="Trainer's line when you beat it (optional)" style="width:280px" />
          </label>
        </div>
        <p class="hint" style="margin:2px 0 0">Heads-up: "wins/defeated" is from the TRAINER's point of view. The DEFEATED line plays when you beat the trainer; the WINS line plays when the trainer beats you.</p>
        <div class="ctr-effect-row">
          <label title="A visual aura rendered around this trainer's sprite in battle, reusing the Ghost Trainer FX aura effects. '(none)' is the plain sprite.">Sprite effect
            <select id="ctr-effect">${ctrEffectOptions(t.trainerEffect || "")}</select>
          </label>
          ${ctrEffectSwatchHtml(t.trainerEffect || "")}
        </div>
      </fieldset>
      <fieldset class="ctr-sec"><legend>Spawn gates</legend>
        <div>Difficulties: ${diffChecks}</div>
        <label>Min wave <input type="number" id="ctr-minwave" value="${t.minWave}" min="1" max="5000" style="width:72px" /></label>
        <label>Max wave <input type="number" id="ctr-maxwave" value="${t.maxWave}" min="1" max="5000" ${t.endless ? "disabled" : ""} style="width:72px" /></label>
        <label title="Any floor >= min wave (endless)"><input type="checkbox" id="ctr-endless"${t.endless ? " checked" : ""} /> Endless (any floor ≥ min)</label>
        <label title="Relative odds this trainer is the one fielded when a spawn window fires (weight / total weight among eligible trainers). Higher = more likely. Default 100.">Weight <input type="number" id="ctr-weight" value="${normalizeCtrWeight(t.weight)}" min="1" step="1" style="width:72px" /></label>
        <br /><label>Battle type <select id="ctr-battletype">${battleSel}</select></label>
        <label>Challenge exclusivity <select id="ctr-challenge">${challSel}</select></label>
        ${challValueSel}
        <p class="hint" style="margin:6px 0 0">Spawning is capped GLOBALLY by the Spawn density panel above (how often ANY custom trainer appears). When a window fires, ONE trainer is picked by weight among the eligible not-yet-used trainers, then it appears once at a wave in its range, sliding forward past boss/fixed/mystery waves. No repeats per run.</p>
      </fieldset>
      <fieldset class="full ctr-sec"><legend>Team (1-6)</legend>
        ${t.team.map((m, i) => ctrMemberHtml(m, i)).join("")}
        ${t.team.length < 6 ? '<button type="button" id="ctr-add-member">＋ Add member</button>' : ""}
      </fieldset>
      ${warnings.length > 0 ? `<div class="ctr-warn">⚠ ${warnings.map(esc).join("<br>⚠ ")}</div>` : ""}
      ${notes.length > 0 ? `<div class="ctr-note">ℹ ${notes.map(esc).join("<br>ℹ ")}</div>` : ""}
      <div class="full" style="display:flex;gap:10px;align-items:center;margin-top:8px">
        <button type="button" id="ctr-delete" style="color:var(--err,#c0392b)">🗑 Delete trainer</button>
        <span class="dyn">Changes save with the global “Save”/“Commit & Deploy” buttons.</span>
      </div>
    </div>`;
  }
  const cfg = ctrConfig.current;
  const cfgDirty = !jsonEq(ctrConfig.current, ctrConfig.baseline);
  root.innerHTML = `
    <div class="section">
      <h2>Custom Trainers</h2>
      <p class="hint">Staff-authored trainers that spawn in real runs, gated by difficulty, floor range and challenge mode. The team is fielded EXACTLY as authored (the #419 BST cap is bypassed).</p>
      <fieldset class="ctr-density${cfgDirty ? " dirty" : ""}"><legend>Spawn density${cfgDirty ? " ●" : ""}</legend>
        <p class="hint" style="margin:0 0 6px">How OFTEN a custom trainer appears at all, INDEPENDENT of how many you author. The run is diced into windows of this many waves; each window has this percent chance to field ONE custom trainer.</p>
        <label title="Percent chance (0-100) that a given window fields a custom trainer at all. 0 disables custom trainers entirely.">Chance % per window <input type="number" id="ctr-density-chance" value="${normalizeCtrWindowChance(cfg.windowChancePct)}" min="0" max="100" step="1" style="width:72px" /></label>
        <label title="How many waves make up one spawn window (1-100). Default 10 = at most one custom trainer per 10 waves.">Window size (waves) <input type="number" id="ctr-density-window" value="${normalizeCtrWindowSize(cfg.windowSize)}" min="1" max="100" step="1" style="width:72px" /></label>
      </fieldset>
      <div class="mon-list">${list || '<span class="dyn">none yet</span>'}<button type="button" id="ctr-new" class="primary">＋ New trainer</button></div>
    </div>
    <div class="section">
      <div class="ctr-layout">
        <div class="ctr-layout-main">${form}</div>
        ${panel}
      </div>
    </div>
    ${heldItemsDatalistHtml()}`;
  // The sprite preview reads the live CDN atlas, so paint it after the DOM exists.
  updateCtrSpritePreview();
  // Paint each list card's trainer sprite (lazy CDN atlas crop, ~44px tall). The
  // per-url in-flight cache means many cards sharing a class fire ONE fetch.
  for (const el of root.querySelectorAll("[data-ctrsprite]")) {
    renderTrainerFrame(el.dataset.ctrsprite, el, { targetH: 44 });
  }
}

// ---- Custom Trainers: input + click handling -------------------------------
function ctrCur() {
  return ctrSelected ? ctr.current[ctrSelected] : null;
}

function onCustomTrainerInput(el) {
  // Global spawn-density inputs live ABOVE the trainer list, so they must be
  // handled with NO trainer selected (before the ctrCur guard below).
  if (el.id === "ctr-density-chance") {
    ctrConfig.current.windowChancePct = normalizeCtrWindowChance(Number(el.value));
    return true;
  }
  if (el.id === "ctr-density-window") {
    ctrConfig.current.windowSize = normalizeCtrWindowSize(Number(el.value));
    return true;
  }
  const t = ctrCur();
  if (!t) {
    return false;
  }
  const idx = el.dataset.idx === undefined ? -1 : Number(el.dataset.idx);
  const m = idx >= 0 ? t.team[idx] : null;
  if (idx >= 0) {
    ctrFocusIdx = idx; // this member's preview shows in the right panel
  }
  if (el.id === "ctr-name") {
    t.name = el.value;
  } else if (el.id === "ctr-intro") {
    t.introDialogue = el.value;
  } else if (el.id === "ctr-victory") {
    t.victoryDialogue = el.value;
  } else if (el.id === "ctr-defeat") {
    t.defeatDialogue = el.value;
  } else if (el.id === "ctr-class") {
    t.trainerClass = el.value.trim().toUpperCase();
    el.value = t.trainerClass;
    // Live preview without a full re-render (keeps the input cursor).
    updateCtrSpritePreview();
  } else if (el.id === "ctr-minwave") {
    t.minWave = Number(el.value) || 1;
  } else if (el.id === "ctr-maxwave") {
    t.maxWave = Number(el.value) || 1;
  } else if (el.id === "ctr-weight") {
    // Pick weight (integer >= 1); a blank/invalid entry normalizes back to 100.
    t.weight = normalizeCtrWeight(Number(el.value));
  } else if (el.classList.contains("ctr-slotchance") && m) {
    // Slot-fill chance (slots 2-6); clamp 1-100, blank/invalid -> 100.
    m.slotChance = normalizeCtrSlotChance(Number(el.value));
  } else if (el.classList.contains("ctr-var-weight") && m) {
    // Current possibility's weight (integer >= 1); odds refresh on blur (render).
    ctrEnsureSlot(m);
    m.variants[m.cur].weight = clampCtrWeight(Number(el.value));
  } else if (el.classList.contains("ctr-species") && m) {
    m.species = el.value.trim().toUpperCase();
    el.value = m.species;
    el.style.borderColor = m.species === "" || spByConst.has(m.species) ? "" : ERR;
  } else if (el.classList.contains("ctr-form") && m) {
    m.formIndex = Number(el.value) || 0;
  } else if (el.classList.contains("ctr-level") && m) {
    m.level = el.value === "" ? null : Number(el.value);
  } else if (el.classList.contains("ctr-move") && m) {
    // Normalize to the enum KEY on EVERY edit (regardless of the sanity toggle):
    // uppercase + spaces/punctuation -> "_", so a typed "ice beam" becomes
    // "ICE_BEAM" BEFORE the legality check (a two-word move was always flagged).
    const v = moveNameToEnumKey(el.value);
    el.value = v;
    m.moves[Number(el.dataset.slot)] = v;
    // A manual move edit flips the member's "Use set" dropdown back to (custom).
    ctrSetSel.set(idx, -1);
    // Red border for an unknown move name OR (enforcing) an illegal move. The
    // RLA/RLNA tokens are always valid (resolved to a legal move in-game). The
    // error line + dropdown refresh on blur (onCustomTrainerChange -> render).
    const bad = v !== "" && !ctrIsMoveToken(v) && (!MOVE_SET.has(v) || ctrMoveIllegal(m, v));
    el.style.borderColor = bad ? ERR : "";
  } else if (el.classList.contains("ctr-held-item") && m) {
    const h = m.heldItems[Number(el.dataset.heldidx)];
    if (h) {
      h.item = el.value.trim().toUpperCase();
      el.value = h.item;
    }
  } else if (el.classList.contains("ctr-held-count") && m) {
    const h = m.heldItems[Number(el.dataset.heldidx)];
    if (h) {
      h.count = Number(el.value) || 1;
    }
  } else if (el.classList.contains("ctr-shiny-name") && m) {
    m.shiny = ctrNormShiny(m.shiny);
    m.shiny.name = el.value;
  } else if (el.classList.contains("ctr-fusion-species") && m && m.fusion) {
    m.fusion.species = el.value.trim().toUpperCase();
    el.value = m.fusion.species;
    el.style.borderColor = m.fusion.species === "" || spByConst.has(m.fusion.species) ? "" : ERR;
  } else if (el.classList.contains("ctr-fusion-form") && m && m.fusion) {
    m.fusion.formIndex = Number(el.value) || 0;
  } else {
    return false;
  }
  refreshChrome();
  return true;
}

function onCustomTrainerChange(el) {
  // Global spawn-density inputs (above the list) blur/normalize with no trainer.
  if (el.id === "ctr-density-chance") {
    ctrConfig.current.windowChancePct = normalizeCtrWindowChance(Number(el.value));
    render();
    return true;
  }
  if (el.id === "ctr-density-window") {
    ctrConfig.current.windowSize = normalizeCtrWindowSize(Number(el.value));
    render();
    return true;
  }
  const t = ctrCur();
  if (!t) {
    return false;
  }
  const idx = el.dataset.idx === undefined ? -1 : Number(el.dataset.idx);
  const m = idx >= 0 ? t.team[idx] : null;
  if (idx >= 0) {
    ctrFocusIdx = idx; // this member's preview shows in the right panel
  }
  if (el.id === "ctr-battletype") {
    t.battleType = el.value;
  } else if (el.id === "ctr-class") {
    // Blur: a class change can flip whether the gender picker applies, so re-render.
    t.trainerClass = el.value.trim().toUpperCase();
    render();
    return true;
  } else if (el.classList.contains("ctr-gender-radio")) {
    t.gender = el.value === "f" ? "f" : "m";
    updateCtrSpritePreview();
    refreshChrome();
    return true;
  } else if (el.id === "ctr-challenge") {
    t.challenge = el.value;
    // A challengeValue only applies to a value-bearing challenge; drop it when the
    // new kind can't carry one (or is "none"). Re-render so the value dropdown
    // appears/disappears for the new kind.
    if (!ctrChallengeIsParameterizable(t.challenge)) {
      t.challengeValue = null;
    }
    render();
    return true;
  } else if (el.id === "ctr-challenge-value") {
    // "(any value)" -> null (unset); otherwise the chosen numeric value.
    t.challengeValue = el.value === "" ? null : normalizeCtrChallengeValue(el.value);
    refreshChrome();
    return true;
  } else if (el.id === "ctr-effect") {
    // Pick a trainer sprite effect (aura); re-render so the preview swatch updates.
    t.trainerEffect = normalizeCtrTrainerEffect(el.value);
    render();
    return true;
  } else if (el.id === "ctr-bgm") {
    // Picking a track stops any current preview (a new pick supersedes it).
    t.battleBgm = normalizeCtrBattleBgm(el.value);
    bgmStop();
    refreshChrome();
    return true;
  } else if (el.id === "ctr-endless") {
    t.endless = el.checked;
    render();
    return true;
  } else if (el.classList.contains("ctr-weighted") && m) {
    // Toggle a weighted slot. Turning OFF with >1 possibilities keeps ONLY the
    // currently-shown possibility (the others are dropped — the tooltip warns).
    ctrSyncCurrentVariant(m);
    if (el.checked) {
      m.weighted = true;
    } else {
      m.weighted = false;
      const keep = m.variants[m.cur];
      m.variants = [keep];
      m.cur = 0;
      ctrLoadVariant(m, 0);
    }
    ctrSetSel.set(idx, -1);
    render();
    return true;
  } else if (el.classList.contains("ctr-slotchance") && m) {
    // Blur: normalize + re-render (the border/label reflect the clamped value).
    m.slotChance = normalizeCtrSlotChance(Number(el.value));
    render();
    return true;
  } else if (el.classList.contains("ctr-var-weight") && m) {
    // Blur: normalize the weight + re-render so the pick-odds update.
    ctrEnsureSlot(m);
    m.variants[m.cur].weight = clampCtrWeight(Number(el.value));
    render();
    return true;
  } else if (el.classList.contains("ctr-set") && m) {
    // Apply an authored set: fill the 4 moves + abilitySlot, mark the dropdown.
    const si = Number(el.value);
    ctrSetSel.set(idx, si);
    const set = si >= 0 ? factorySetsFor(m.species)[si] : null;
    if (set) {
      m.moves = [...(set.moves || []), "", "", "", ""].slice(0, 4);
      m.abilitySlot = [0, 1, 2].includes(set.abilitySlot) ? set.abilitySlot : 0;
    }
    render();
    return true;
  } else if (el.classList.contains("ctr-shiny-sel") && m) {
    // Pick a shiny effect for one category; re-render so the swatch updates.
    m.shiny = ctrNormShiny(m.shiny);
    m.shiny[el.dataset.cat] = el.value;
    render();
    return true;
  } else if (el.classList.contains("ctr-sanity") && m) {
    m.sanityOff = el.checked;
    render();
    return true;
  } else if (el.classList.contains("ctr-move") && m) {
    // Blur after a manual move edit: re-render so the error line + set dropdown
    // reflect the change (the live red border already updated on input).
    render();
    return true;
  } else if (el.classList.contains("ctr-diff")) {
    const set = new Set(t.difficulties);
    if (el.checked) {
      set.add(el.dataset.diff);
    } else {
      set.delete(el.dataset.diff);
    }
    t.difficulties = DIFFICULTY_OPTIONS.filter(d => set.has(d));
    render();
    return true;
  } else if ((el.classList.contains("ctr-species") || el.classList.contains("ctr-fusion-species")) && m) {
    // Species changed (pick/blur): the authored-set list + legal pool differ, so
    // reset this member's set selection to (custom) and re-render (also refreshes
    // the ability-slot labels for the new species).
    if (el.classList.contains("ctr-species")) {
      ctrSetSel.set(idx, -1);
    }
    render();
    return true;
  } else if (el.classList.contains("ctr-abil") && m) {
    m.abilitySlot = Number(el.value);
    // A manual ability pick flips the "Use set" dropdown back to (custom).
    ctrSetSel.set(idx, -1);
  } else if (el.classList.contains("ctr-fusion-abil") && m && m.fusion) {
    m.fusion.abilitySlot = Number(el.value);
  } else if (el.classList.contains("ctr-scale") && m) {
    m.level = el.checked ? null : 50;
    render();
    return true;
  } else if (el.classList.contains("ctr-fusion-on") && m) {
    m.fusion = el.checked ? { species: "", formIndex: 0, abilitySlot: 0 } : null;
    render();
    return true;
  } else {
    return false;
  }
  render();
  return true;
}

/** Reset the per-member transient UI state (collapse + set selection + panel focus). */
function ctrResetMemberUiState() {
  ctrOpenMembers.clear();
  ctrSetSel.clear();
  ctrFocusIdx = 0;
}

function onCustomTrainerClick(e) {
  const open = e.target.closest("[data-ctropen]");
  if (open) {
    ctrSelected = open.dataset.ctropen;
    ctrResetMemberUiState();
    bgmStop();
    render();
    return true;
  }
  if (e.target.closest("#ctr-new")) {
    const t = blankCtrTrainer();
    let key = `TRAINER_${t.id}`;
    while (ctr.current[key]) {
      key += "_2";
    }
    ctr.current[key] = t;
    ctrSelected = key;
    ctrResetMemberUiState();
    ctrOpenMembers.add(0); // the fresh member starts expanded
    bgmStop();
    render();
    return true;
  }
  const t = ctrCur();
  if (!t) {
    return false;
  }
  // Collapse/expand a team member (task #9). Ignore clicks on the delete button.
  const memSum = e.target.closest(".ctr-mem-sum");
  if (memSum) {
    const mi = Number(memSum.dataset.idx);
    ctrFocusIdx = mi; // focus this member's preview in the right panel
    if (ctrOpenMembers.has(mi)) {
      ctrOpenMembers.delete(mi);
    } else {
      ctrOpenMembers.add(mi);
    }
    render();
    return true;
  }
  if (e.target.closest("#ctr-browse-class")) {
    openTrainerClassModal();
    return true;
  }
  if (e.target.closest("#ctr-bgm-play")) {
    const sel = document.getElementById("ctr-bgm");
    bgmPlay(sel ? sel.value : t.battleBgm);
    return true;
  }
  if (e.target.closest("#ctr-bgm-stop")) {
    bgmStop();
    return true;
  }
  if (e.target.closest("#ctr-add-member")) {
    if (t.team.length < 6) {
      t.team.push(blankCtrMember());
      ctrOpenMembers.add(t.team.length - 1); // new member starts expanded
      ctrFocusIdx = t.team.length - 1; // focus the new member in the preview panel
    }
    render();
    return true;
  }
  const memDel = e.target.closest(".ctr-mem-del");
  if (memDel) {
    if (t.team.length > 1) {
      t.team.splice(Number(memDel.dataset.idx), 1);
      // Team indices shifted; drop the (now-stale) per-index UI state.
      ctrResetMemberUiState();
    }
    render();
    return true;
  }
  // Weighted-slot possibility stepper (◂ ▸): CYCLE the shown possibility (never
  // creates one — N stays fixed). Sync the live fields into the current
  // possibility first, then load the target possibility onto the form.
  const varStep = e.target.closest(".ctr-var-prev, .ctr-var-next");
  if (varStep) {
    const mi = Number(varStep.dataset.idx);
    const m = t.team[mi];
    if (m) {
      ctrSyncCurrentVariant(m);
      const n = m.variants.length;
      const delta = varStep.classList.contains("ctr-var-next") ? 1 : -1;
      ctrLoadVariant(m, (m.cur + delta + n) % n);
      ctrSetSel.set(mi, -1);
    }
    render();
    return true;
  }
  // + possibility: sync current, append a fresh blank possibility (weight 1),
  // switch to it. Explicit — cycling past the end never creates one.
  const varAdd = e.target.closest(".ctr-var-add");
  if (varAdd) {
    const mi = Number(varAdd.dataset.idx);
    const m = t.team[mi];
    if (m) {
      ctrSyncCurrentVariant(m);
      m.weighted = true;
      m.variants.push({ ...blankCtrMemberFields(), weight: 1 });
      ctrLoadVariant(m, m.variants.length - 1);
      ctrSetSel.set(mi, -1);
    }
    render();
    return true;
  }
  // ✕ possibility: drop the current possibility (N >= 1 always kept), show the
  // previous one. At N==1 the button isn't rendered.
  const varDel = e.target.closest(".ctr-var-del");
  if (varDel) {
    const mi = Number(varDel.dataset.idx);
    const m = t.team[mi];
    if (m && m.variants.length > 1) {
      m.variants.splice(m.cur, 1);
      ctrLoadVariant(m, Math.max(0, m.cur - 1));
      ctrSetSel.set(mi, -1);
    }
    render();
    return true;
  }
  const heldAdd = e.target.closest(".ctr-held-add");
  if (heldAdd) {
    t.team[Number(heldAdd.dataset.idx)].heldItems.push({ item: "", count: 1 });
    render();
    return true;
  }
  const heldDel = e.target.closest(".ctr-held-del");
  if (heldDel) {
    t.team[Number(heldDel.dataset.idx)].heldItems.splice(Number(heldDel.dataset.heldidx), 1);
    render();
    return true;
  }
  if (e.target.closest("#ctr-delete")) {
    // A trainer that exists in the live file is marked for deletion (delta
    // sends null); a never-saved trainer is just dropped locally.
    if (ctr.baseline[ctrSelected] === undefined) {
      delete ctr.current[ctrSelected];
    } else {
      ctr.current[ctrSelected] = null;
    }
    ctrSelected = null;
    render();
    return true;
  }
  return false;
}

function render() {
  const root = $("#content");
  if (activeTab === "eggmoves") {
    renderEggMoves(root);
  } else if (activeTab === "species") {
    renderSpecies(root);
  } else if (activeTab === "learnsets") {
    renderLearnsets(root);
  } else if (activeTab === "tms") {
    renderTMs(root);
  } else if (activeTab === "abilities") {
    renderAbilities(root);
  } else if (activeTab === "items") {
    renderItems(root);
  } else if (activeTab === "trainers") {
    renderTrainers(root);
  } else if (activeTab === "customtrainers") {
    renderCustomTrainers(root);
  } else if (activeTab === "addmon") {
    renderAddMon(root);
  } else {
    renderGame(root);
  }
  refreshChrome();
}

// Live-input targets for the Pokedex tabs. These deliberately do NOT re-render
// (which would steal focus): they mutate state + tweak the DOM in place.
function onPokedexInput(el) {
  if (el.id === "pal-search") {
    palQuery = el.value;
    filterPalette();
    return true;
  }
  if (el.id === "pd-newlevel") {
    const v = Number(el.value);
    newMoveLevel = Number.isInteger(v) && v >= 1 && v <= 100 ? v : newMoveLevel;
    return true;
  }
  if (el.classList.contains("ls-level")) {
    const arr = (learn.current[pdSelected] || []).slice();
    const idx = Number(el.dataset.idx);
    const v = Number(el.value);
    if (arr[idx] && Number.isInteger(v) && v >= 1 && v <= 100) {
      arr[idx] = [v, arr[idx][1]];
      learn.current[pdSelected] = arr;
      el.style.borderColor = "";
    } else {
      el.style.borderColor = ERR;
    }
    refreshChrome();
    return true;
  }
  if (el.classList.contains("abil-input")) {
    openAbilDrop(el.dataset.slot, el.value);
    return true;
  }
  return false;
}

// ---- Input handlers -----------------------------------------------------------------
function onInput(e) {
  const el = e.target;
  if (POKEDEX_TABS.has(activeTab) && onPokedexInput(el)) {
    return;
  }
  if (activeTab === "customtrainers" && onCustomTrainerInput(el)) {
    return;
  }
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

// Add a move id to the selected species' learnset / TM list (shared by click + drop).
function pdAddMove(moveId) {
  if (!pdSelected || !moveById.has(moveId)) {
    return;
  }
  if (activeTab === "learnsets") {
    const arr = (learn.current[pdSelected] || []).slice();
    if (!arr.some(([lvl, mv]) => lvl === newMoveLevel && mv === moveId)) {
      arr.push([newMoveLevel, moveId]);
      learn.current[pdSelected] = arr;
    }
  } else if (activeTab === "tms") {
    const arr = (tms.current[pdSelected] || []).slice();
    if (!arr.includes(moveId)) {
      arr.push(moveId);
      tms.current[pdSelected] = arr;
    }
  }
  render();
}

// Click targets for the Pokedex tabs (species pick, palette add, row delete, revert, ability pick).
function onPokedexClick(e) {
  const pick = e.target.closest("[data-pdpick]");
  if (pick) {
    pdSelected = pick.dataset.pdpick;
    render();
    return true;
  }
  const revert = e.target.closest("[data-pdrevert]");
  if (revert) {
    const c = revert.dataset.pdrevert;
    const store = activeTab === "learnsets" ? learn : activeTab === "tms" ? tms : abil;
    store.current[c] = JSON.parse(JSON.stringify(store.baseline[c]));
    render();
    return true;
  }
  const opt = e.target.closest(".abil-opt");
  if (opt) {
    abil.current[pdSelected] = setAbilSlot(
      abil.current[pdSelected] || EMPTY_ABIL,
      opt.dataset.slot,
      Number(opt.dataset.abilid),
    );
    closeAbilDrops();
    render();
    return true;
  }
  const lsDel = e.target.closest(".ls-del");
  if (lsDel) {
    const arr = (learn.current[pdSelected] || []).slice();
    arr.splice(Number(lsDel.dataset.idx), 1);
    learn.current[pdSelected] = arr;
    render();
    return true;
  }
  const tmDel = e.target.closest(".tm-del");
  if (tmDel) {
    tms.current[pdSelected] = (tms.current[pdSelected] || []).filter(id => id !== Number(tmDel.dataset.moveid));
    render();
    return true;
  }
  const pal = e.target.closest(".pal-move");
  if (pal) {
    pdAddMove(Number(pal.dataset.moveid));
    return true;
  }
  return false;
}

// Click targets on the Trainers tab (toggle cards, knob resets, filter chips).
function onClick(e) {
  if (POKEDEX_TABS.has(activeTab) && onPokedexClick(e)) {
    return;
  }
  if (activeTab === "customtrainers" && onCustomTrainerClick(e)) {
    return;
  }
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

  // Learnsets: changed species → full [[level, moveId], ...] (replaces the
  // level-up learnset). A species reverted to baseline is simply not emitted.
  const lsDelta = {};
  for (const s of POKEDEX_SPECIES) {
    if (jsonEq(learn.current[s.const], learn.baseline[s.const])) {
      continue;
    }
    const pairs = (learn.current[s.const] || []).map(([lvl, mv]) => [Number(lvl), Number(mv)]);
    let ok = true;
    for (const [lvl, mv] of pairs) {
      if (!(Number.isInteger(lvl) && lvl >= 1 && lvl <= 100)) {
        bad.push(`${s.name}: learnset level must be 1-100`);
        ok = false;
      } else if (!moveById.has(mv)) {
        bad.push(`${s.name}: unknown learnset move id ${mv}`);
        ok = false;
      }
    }
    if (ok) {
      lsDelta[s.const] = pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    }
  }
  if (Object.keys(lsDelta).length > 0) {
    deltas.learnsets = lsDelta;
  }

  // TM learnsets: changed species → full [moveId, ...] (replaces TM compatibility).
  const tmDelta = {};
  for (const s of POKEDEX_SPECIES) {
    if (jsonEq(tms.current[s.const], tms.baseline[s.const])) {
      continue;
    }
    const ids = [...new Set((tms.current[s.const] || []).map(Number))];
    if (ids.every(id => moveById.has(id))) {
      tmDelta[s.const] = ids.sort((a, b) => a - b);
    } else {
      bad.push(`${s.name}: unknown TM move id`);
    }
  }
  if (Object.keys(tmDelta).length > 0) {
    deltas["tm-learnsets"] = tmDelta;
  }

  // Abilities: changed species → ONLY the slots that actually changed (innates
  // emitted as the full triple when that triple changed). Field-granular - like
  // species tuning above - so a save NEVER re-writes a slot the user did not
  // touch. The old whole-entry delta let a stale tab/reload carry a stale slot
  // value back over a concurrently-saved change (the Kingambit 101->5191->101
  // ability flip: a save meant for one slot silently reverted another). The
  // worker deep-merges per slot and the game loader applies each slot
  // independently, so a partial entry is safe; non-zero ids are still validated.
  const abDelta = {};
  for (const s of POKEDEX_SPECIES) {
    if (jsonEq(abil.current[s.const], abil.baseline[s.const])) {
      continue;
    }
    const cur = abil.current[s.const] || {};
    const base = abil.baseline[s.const] || {};
    const entry = {};
    const ids = [];
    for (const slot of ["ability1", "ability2", "hidden"]) {
      const curVal = Number(cur[slot]) || 0;
      if (curVal !== (Number(base[slot]) || 0)) {
        entry[slot] = curVal;
        ids.push(curVal);
      }
    }
    const curInn = (cur.innates || [0, 0, 0]).map(id => Number(id) || 0);
    const baseInn = (base.innates || [0, 0, 0]).map(id => Number(id) || 0);
    if (!jsonEq(curInn, baseInn)) {
      entry.innates = [curInn[0] || 0, curInn[1] || 0, curInn[2] || 0];
      ids.push(...entry.innates);
    }
    if (Object.keys(entry).length === 0) {
      continue; // reference differs but no slot-level change
    }
    if (ids.every(id => id === 0 || abilById.has(id))) {
      abDelta[s.const] = entry;
    } else {
      bad.push(`${s.name}: unknown ability id`);
    }
  }
  if (Object.keys(abDelta).length > 0) {
    deltas["species-abilities"] = abDelta;
  }

  // Custom trainers: changed keys only. Edit entries store species by CONST;
  // convert to numeric speciesId. A key set to null (deleted) sends null.
  const ctrDelta = {};
  for (const key of Object.keys(ctr.current)) {
    if (jsonEq(ctr.current[key], ctr.baseline[key])) {
      continue;
    }
    const t = ctr.current[key];
    if (t === null) {
      ctrDelta[key] = null; // delete
      continue;
    }
    if (!t.name || t.name.trim() === "") {
      bad.push(`${key}: trainer needs a name`);
      continue;
    }
    if (!t.trainerClass) {
      bad.push(`${key}: trainer needs a sprite/class`);
      continue;
    }
    if (!Array.isArray(t.team) || t.team.length === 0 || t.team.length > 6) {
      bad.push(`${t.name}: team must have 1-6 members`);
      continue;
    }
    let memberBad = false;
    // Validate + serialize ONE possibility's member fields (species by CONST -> id,
    // move NAMEs incl. RLA/RLNA tokens, fusion, held items, sanityOff). Pushes any
    // problems into `bad` and flips `memberBad`. Reused for a flat member AND for
    // each weighted variant.
    const buildPossibility = m => {
      const id = spByConst.get(m.species)?.id;
      if (typeof id !== "number") {
        bad.push(`${t.name}: unknown species "${m.species}"`);
        memberBad = true;
        return null;
      }
      const moves = (m.moves || []).map(x => (x || "").trim().toUpperCase()).filter(Boolean);
      for (const mv of moves) {
        // RLA/RLNA tokens are legal move NAMEs (resolved in-game); not "unknown".
        if (!ctrIsMoveToken(mv) && !MOVE_SET.has(mv)) {
          bad.push(`${t.name}: unknown move "${mv}"`);
          memberBad = true;
        }
      }
      // Move-legality gate: a member with sanity ENFORCED (sanityOff not set)
      // must not carry an illegal move. Members with sanity off (and the RLA/RLNA
      // tokens) are exempt. Never silently strip — surface a clear error.
      if (!m.sanityOff) {
        for (const mv of ctrIllegalMoves(m)) {
          bad.push(
            `${t.name}: illegal move "${mv}" for ${m.species} (not in level-up/TM/egg pool; tick "Move sanity off" to allow it)`,
          );
          memberBad = true;
        }
      }
      const out = { species: id, abilitySlot: m.abilitySlot || 0 };
      if (m.formIndex) {
        out.formIndex = m.formIndex;
      }
      out.level = typeof m.level === "number" ? m.level : null;
      if (moves.length > 0) {
        out.moves = moves;
      }
      if (m.fusion && m.fusion.species) {
        const fid = spByConst.get(m.fusion.species)?.id;
        if (typeof fid === "number") {
          out.fusion = { species: fid, formIndex: m.fusion.formIndex || 0, abilitySlot: m.fusion.abilitySlot || 0 };
        } else {
          bad.push(`${t.name}: unknown fusion species "${m.fusion.species}"`);
          memberBad = true;
        }
      }
      const held = (m.heldItems || [])
        .filter(h => h && h.item)
        .map(h => ({ item: h.item.trim().toUpperCase(), count: h.count || 1 }));
      if (held.length > 0) {
        out.heldItems = held;
      }
      // Shiny Lab look: serialize only the non-empty categories (+ trimmed name)
      // when at least one effect is picked; otherwise omit (renders normally).
      const shiny = ctrNormShiny(m.shiny);
      if (ctrShinyActive(shiny)) {
        const sh = {};
        for (const cat of ["palette", "surface", "around"]) {
          if (shiny[cat]) {
            sh[cat] = shiny[cat];
          }
        }
        const nm = (shiny.name || "").trim();
        if (nm) {
          sh.name = nm;
        }
        out.shiny = sh;
      }
      // Editor metadata: persist sanityOff ONLY when the check is turned off.
      if (m.sanityOff) {
        out.sanityOff = true;
      }
      return out;
    };
    const team = t.team.map((slot, i) => {
      ctrEnsureSlot(slot);
      ctrSyncCurrentVariant(slot); // fold the live edits into the current possibility
      // slotChance applies to slots 2-6 only (slot 1 always fills); serialize it
      // only when it differs from the 100 default (keeps flat members byte-clean).
      const sc = i > 0 ? normalizeCtrSlotChance(slot.slotChance) : 100;
      const withSlotChance = obj => (i > 0 && sc !== 100 ? { ...obj, slotChance: sc } : obj);
      // Weighted form (variants array) only when there is MORE than one possibility;
      // a single possibility always saves as a flat member (back-compat).
      if (slot.weighted && slot.variants.length > 1) {
        const variants = slot.variants.map(v => {
          const out = buildPossibility(v);
          return out ? { ...out, weight: clampCtrWeight(v.weight) } : null;
        });
        return withSlotChance({ variants });
      }
      return withSlotChance(buildPossibility(slot));
    });
    if (memberBad) {
      continue;
    }
    // Serialize gender ONLY when the class has gendered sprites AND "f" is picked
    // (default "m" is omitted so unaffected entries stay byte-clean).
    const classEntry = trainerClassByName.get(t.trainerClass);
    const genderF = classEntry && classEntry.genders && t.gender === "f";
    ctrDelta[key] = {
      id: t.id,
      name: t.name.trim(),
      trainerClass: t.trainerClass,
      ...(genderF ? { gender: "f" } : {}),
      battleType: t.battleType || "single",
      difficulties: t.difficulties.length > 0 ? t.difficulties : ["ace", "elite", "hell"],
      minWave: t.minWave,
      maxWave: t.maxWave,
      endless: t.endless === true,
      // Always write `weight` (never the legacy spawnChance): the game migrates
      // any old spawnChance on load, but new saves are weight-only.
      weight: normalizeCtrWeight(t.weight),
      challenge: t.challenge || "none",
      // challengeValue: serialize ONLY for a value-bearing challenge with a value
      // set (not "(any value)"). Omitted otherwise (byte-clean; any-value default).
      ...(ctrChallengeIsParameterizable(t.challenge) && normalizeCtrChallengeValue(t.challengeValue) !== null
        ? { challengeValue: normalizeCtrChallengeValue(t.challengeValue) }
        : {}),
      ...(normalizeCtrBattleBgm(t.battleBgm) ? { battleBgm: normalizeCtrBattleBgm(t.battleBgm) } : {}),
      // Intro blurb: trimmed + 200-char cap; omit when empty (byte-clean default).
      ...((t.introDialogue || "").trim() ? { introDialogue: (t.introDialogue || "").trim().slice(0, 200) } : {}),
      // Victory / defeat lines: same trim + 200-char cap; omit when empty.
      ...((t.victoryDialogue || "").trim() ? { victoryDialogue: (t.victoryDialogue || "").trim().slice(0, 200) } : {}),
      ...((t.defeatDialogue || "").trim() ? { defeatDialogue: (t.defeatDialogue || "").trim().slice(0, 200) } : {}),
      // Trainer sprite effect (aura): serialize only a known aura id; omit otherwise.
      ...(normalizeCtrTrainerEffect(t.trainerEffect)
        ? { trainerEffect: normalizeCtrTrainerEffect(t.trainerEffect) }
        : {}),
      team,
    };
  }
  if (Object.keys(ctrDelta).length > 0) {
    deltas["custom-trainers"] = ctrDelta;
  }

  // Global spawn-density config (its own whitelisted file). Emitted whole (only
  // two normalized fields) when it differs from the loaded baseline.
  const cfgOut = {
    windowSize: normalizeCtrWindowSize(ctrConfig.current.windowSize),
    windowChancePct: normalizeCtrWindowChance(ctrConfig.current.windowChancePct),
  };
  if (!jsonEq(cfgOut, ctrConfig.baseline)) {
    deltas["custom-trainers-config"] = cfgOut;
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
    let ctrConflicts = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // Only the LAST save triggers the (single) deploy.
      const wantDeploy = deploy && i === files.length - 1;
      setStatus(`Saving ${file} (${i + 1}/${files.length})…`);
      // Custom trainers carry per-trainer baseline hashes so the worker can detect
      // a teammate's concurrent edit (same-trainer conflict) and server-assign ids.
      const body = { password, file, delta: deltas[file], author, deploy: wantDeploy };
      if (file === "custom-trainers") {
        body.baselines = ctrBuildBaselines(deltas[file]);
      }
      const res = await fetch(`${WORKER_URL}/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      if (file === "custom-trainers") {
        // Adopt server-assigned ids + keep any conflicted trainers dirty.
        markCustomTrainersSaved(deltas[file], data);
        ctrConflicts = Array.isArray(data.conflicts) ? data.conflicts : [];
      } else {
        markSaved(file);
      }
    }
    render();
    if (ctrConflicts.length > 0) {
      // Partial success: the non-conflicting rest saved, but these trainers were
      // edited by someone else since load and stay DIRTY (reload to see theirs).
      const detail = ctrConflicts
        .slice(0, 3)
        .map(c => c.error || c.key)
        .join("; ");
      setStatus(
        `Saved ✓ ${lastSha}, but ${ctrConflicts.length} trainer(s) were rejected as conflicts and kept dirty: ${detail}${ctrConflicts.length > 3 ? "…" : ""}`,
        ERR,
      );
    } else {
      setStatus(
        deploy
          ? `Saved ✓ ${lastSha} — deploy triggered, live in a few minutes.`
          : `Saved ✓ ${lastSha} — click "Commit & Deploy" to apply it to staging.`,
        "var(--ok)",
      );
    }
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
  } else if (file === "learnsets") {
    learn.baseline = JSON.parse(JSON.stringify(learn.current));
  } else if (file === "tm-learnsets") {
    tms.baseline = JSON.parse(JSON.stringify(tms.current));
  } else if (file === "species-abilities") {
    abil.baseline = JSON.parse(JSON.stringify(abil.current));
  } else if (file === "custom-trainers-config") {
    ctrConfig.baseline = JSON.parse(JSON.stringify(ctrConfig.current));
  }
}

/**
 * Adopt the worker's custom-trainers save response (Batch A multi-staff safety):
 *   - apply `idRemap` (server-assigned real ids) to the local edit state so the UI
 *     reflects the real id without a reload,
 *   - apply `keyRemap` (a NEW trainer whose provisional key collided with a
 *     teammate's was re-keyed to TRAINER_<realId> instead of rejected): rename the
 *     local entry's key so it stays in sync with the committed repo state,
 *   - for every SAVED (non-conflicted) trainer, advance its baseline AND the
 *     load-time CTR_LIVE snapshot (so the next save's baseline hash matches the
 *     new repo state), dropping deleted (null) keys,
 *   - leave every CONFLICTED trainer untouched: it stays DIRTY so the author can
 *     reload the teammate's version (or re-save after reconciling).
 */
function markCustomTrainersSaved(delta, data) {
  const idRemap = data && data.idRemap && typeof data.idRemap === "object" ? data.idRemap : {};
  const keyRemap = data && data.keyRemap && typeof data.keyRemap === "object" ? data.keyRemap : {};
  const conflicted = new Set((Array.isArray(data && data.conflicts) ? data.conflicts : []).map(c => c.key));

  // Apply server-assigned ids to the live edit state (keyed by the ORIGINAL key,
  // which is still the local key at this point - re-keying happens next).
  for (const [key, realId] of Object.entries(idRemap)) {
    if (ctr.current[key] && typeof realId === "number") {
      ctr.current[key].id = realId;
    }
  }

  // Re-key any collided NEW trainer: rename origKey -> newKey in the live edit
  // state + keep the selection pointed at it. The baseline / CTR_LIVE snapshots are
  // (re)written under the NEW key by the delta loop below.
  for (const [origKey, newKey] of Object.entries(keyRemap)) {
    if (typeof newKey !== "string" || origKey === newKey) {
      continue;
    }
    if (ctr.current[origKey]) {
      ctr.current[newKey] = ctr.current[origKey];
      delete ctr.current[origKey];
    }
    delete ctr.baseline[origKey];
    delete CTR_LIVE[origKey];
    if (ctrSelected === origKey) {
      ctrSelected = newKey;
    }
  }

  for (const [key, value] of Object.entries(delta || {})) {
    if (conflicted.has(key)) {
      continue; // rejected by the worker -> keep the local edit DIRTY
    }
    if (value === null) {
      // Deletion committed.
      delete ctr.current[key];
      delete ctr.baseline[key];
      delete CTR_LIVE[key];
      if (ctrSelected === key) {
        ctrSelected = null;
      }
      continue;
    }
    // Saved (created/modified): the committed repo entry is the delta with the
    // final (possibly remapped) id, under the (possibly remapped) key. Advance
    // CTR_LIVE (raw, species by id) so a later save hashes the NEW repo state, and
    // snapshot the baseline as clean.
    const targetKey = typeof keyRemap[key] === "string" ? keyRemap[key] : key;
    const finalId = typeof idRemap[key] === "number" ? idRemap[key] : value.id;
    CTR_LIVE[targetKey] = { ...value, id: finalId };
    if (ctr.current[targetKey]) {
      ctr.baseline[targetKey] = JSON.parse(JSON.stringify(ctr.current[targetKey]));
    }
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
    const [
      species,
      moves,
      items,
      trainers,
      knobs,
      abilities,
      eggLive,
      spLive,
      itemLive,
      trLive,
      balLive,
      monsLive,
      movesRich,
      abilsRich,
      lsData,
      tmData,
      abData,
      lsLive,
      tmLive,
      abLive,
      allSpeciesData,
      evosData,
      ctrLive,
      ctrConfigLive,
      trainerClassesData,
      bgmData,
      shinyEffectsData,
      trainerFxData,
      heldItemsData,
      challengeValuesData,
    ] = await Promise.all([
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
      // Pokedex editor: rich catalogs + per-species baseline data (keyed by speciesId).
      fetchJson("./data/moves-rich.json", []),
      fetchJson("./data/abilities-rich.json", []),
      fetchJson("./data/learnsets.json", {}),
      fetchJson("./data/tm-learnsets.json", {}),
      fetchJson("./data/species-abilities.json", {}),
      // Live Pokedex override files (resilient: missing → start from baseline).
      fetchJson(`${RAW_BASE}/er-learnsets.json${bust}`, {}),
      fetchJson(`${RAW_BASE}/er-tm-learnsets.json${bust}`, {}),
      fetchJson(`${RAW_BASE}/er-species-abilities.json${bust}`, {}),
      // Pokedex editor: the FULL species universe (evolutions/forms) + evo graph.
      fetchJson("./data/all-species.json", []),
      fetchJson("./data/evolutions.json", {}),
      // Live custom-trainers override file (resilient: missing on the branch → empty).
      fetchJson(`${RAW_BASE}/er-custom-trainers.json${bust}`, {}),
      // Live custom-trainer spawn-density config (resilient: missing → defaults).
      fetchJson(`${RAW_BASE}/er-custom-trainers-config.json${bust}`, {}),
      // Trainer-class sprite catalog (generated). Fallback → static list below.
      fetchJson("./data/trainer-classes.json", []),
      // Battle-music catalog (generated). Fallback → empty (picker offers "(default)").
      fetchJson("./data/bgm.json", []),
      // Shiny Lab effect registry (generated). Fallback → empty (picker offers "(none)").
      fetchJson("./data/shiny-effects.json", { palette: [], surface: [], around: [] }),
      // Ghost Trainer FX aura catalog (generated). Fallback → empty (picker offers "(none)").
      fetchJson("./data/trainer-fx.json", []),
      // Held-item catalog (generated). Fallback → the curated HELD_ITEM_OPTIONS below.
      fetchJson("./data/held-items.json", []),
      // Challenge VALUE option lists (generated). Fallback → {} (value dropdown hides).
      fetchJson("./data/challenge-values.json", {}),
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

    // Pokedex editor: build rich catalogs + lookups, then seed learn/tm/ability
    // edit state from the baseline data, overlaid with any live override.
    MOVES_RICH = movesRich;
    ABILS_RICH = abilsRich.map(a => ({ ...a, hay: `${a.name} ${a.description}`.toLowerCase() }));
    // Pokedex universe = ALL species (evolutions/forms); fall back to the starter
    // list if the fuller dump isn't present yet. EVOS powers the chain navigator.
    POKEDEX_SPECIES = Array.isArray(allSpeciesData) && allSpeciesData.length > 0 ? allSpeciesData : SPECIES;
    EVOS = evosData && typeof evosData === "object" ? evosData : {};
    for (const m of MOVES_RICH) {
      moveById.set(m.id, m);
    }
    for (const a of ABILS_RICH) {
      abilById.set(a.id, a);
    }
    for (const s of POKEDEX_SPECIES) {
      spByConst.set(s.const, s);
      spById.set(s.id, s);
      const base = (lsData[s.id] || []).map(([lvl, mv]) => [lvl, mv]);
      learn.current[s.const] = Array.isArray(lsLive[s.const]) ? lsLive[s.const].map(([lvl, mv]) => [lvl, mv]) : base;
      const tmBase = (tmData[s.id] || []).slice();
      tms.current[s.const] = Array.isArray(tmLive[s.const]) ? tmLive[s.const].slice() : tmBase;
      const abBase = abData[s.id] || EMPTY_ABIL;
      // A live override may be PARTIAL (saves now carry only changed slots), so
      // merge it OVER the shipped base - each absent slot falls back to the
      // shipped value, mirroring what the game's override loader does. Seeding a
      // missing slot to 0 here would make the editor show (and a later save
      // re-write) NONE for an ability the user never touched.
      const o = abLive[s.const] && typeof abLive[s.const] === "object" ? abLive[s.const] : {};
      const oi = Array.isArray(o.innates) ? o.innates : abBase.innates || [0, 0, 0];
      abil.current[s.const] = {
        ability1: o.ability1 ?? abBase.ability1 ?? 0,
        ability2: o.ability2 ?? abBase.ability2 ?? 0,
        hidden: o.hidden ?? abBase.hidden ?? 0,
        innates: [oi[0] || 0, oi[1] || 0, oi[2] || 0],
      };
    }
    learn.baseline = JSON.parse(JSON.stringify(learn.current));
    tms.baseline = JSON.parse(JSON.stringify(tms.current));
    abil.baseline = JSON.parse(JSON.stringify(abil.current));

    // Trainer-class sprite catalog (generated). Fall back to the static curated
    // list (no sprite metadata → no preview) when the generated file is absent.
    TRAINER_CLASSES =
      Array.isArray(trainerClassesData) && trainerClassesData.length > 0
        ? trainerClassesData
        : TRAINER_CLASS_OPTIONS.map(name => ({ name, sprite: name.toLowerCase(), genders: false }));
    trainerClassByName.clear();
    for (const c of TRAINER_CLASSES) {
      trainerClassByName.set(c.name, c);
    }

    // Battle-music catalog: battle_* themes first, then everything else (each
    // group alpha-sorted) so the picker surfaces battle tracks up top.
    BGM_LIST = (Array.isArray(bgmData) ? bgmData : [])
      .filter(b => b && typeof b.key === "string")
      .map(b => ({ key: b.key, battle: b.battle === true }))
      .sort((a, b) => (a.battle === b.battle ? a.key.localeCompare(b.key) : a.battle ? -1 : 1));

    // Shiny Lab effect registry: build the per-category lists + an id→entry index
    // (with its category) for the per-mon shiny picker and the preview swatch.
    const sd = shinyEffectsData && typeof shinyEffectsData === "object" ? shinyEffectsData : {};
    SHINY_EFFECTS = {
      palette: Array.isArray(sd.palette) ? sd.palette : [],
      surface: Array.isArray(sd.surface) ? sd.surface : [],
      around: Array.isArray(sd.around) ? sd.around : [],
    };
    shinyEffectById.clear();
    for (const category of ["palette", "surface", "around"]) {
      for (const e of SHINY_EFFECTS[category]) {
        if (e && typeof e.id === "string") {
          shinyEffectById.set(e.id, { ...e, category });
        }
      }
    }

    // Ghost Trainer FX aura catalog: the per-trainer sprite-effect picker options.
    TRAINER_FX = Array.isArray(trainerFxData) ? trainerFxData.filter(e => e && typeof e.id === "string") : [];
    trainerFxById.clear();
    for (const e of TRAINER_FX) {
      trainerFxById.set(e.id, e);
    }

    // Held-item catalog: the full grouped picker (booster/berry/gem/utility). Fall
    // back to the curated HELD_ITEM_OPTIONS (as "utility") when the generated file
    // is absent or malformed, so the picker is never empty.
    if (Array.isArray(heldItemsData) && heldItemsData.length > 0) {
      HELD_ITEMS = heldItemsData
        .filter(h => h && typeof h.key === "string" && h.key.length > 0)
        .map(h => ({
          key: h.key,
          label: typeof h.label === "string" && h.label ? h.label : prettify(h.key),
          category: typeof h.category === "string" && h.category ? h.category : "utility",
        }));
    }

    // Challenge VALUE option lists: the per-kind human options for the value
    // dropdown. Keep only well-formed {value:number,label:string} arrays.
    if (challengeValuesData && typeof challengeValuesData === "object") {
      CHALLENGE_VALUES = {};
      for (const [kind, opts] of Object.entries(challengeValuesData)) {
        if (Array.isArray(opts)) {
          CHALLENGE_VALUES[kind] = opts.filter(o => o && typeof o.value === "number" && typeof o.label === "string");
        }
      }
    }

    // Egg-move source + factory-set index for the per-member legality/set helpers.
    EGG_MOVES_LIVE = eggLive && typeof eggLive === "object" ? eggLive : {};
    factoryByConst.clear();
    legalMovesCache.clear();
    for (const s of FACTORY_SPECIES) {
      if (s && s.const) {
        factoryByConst.set(s.const, Array.isArray(s.setsDetail) ? s.setsDetail : []);
      }
    }

    // Seed custom trainers from the live file (species id → CONST for editing).
    // Requires spById to be populated (the POKEDEX_SPECIES loop above).
    CTR_LIVE = ctrLive && typeof ctrLive === "object" ? ctrLive : {};
    for (const [key, entry] of Object.entries(CTR_LIVE)) {
      if (entry && typeof entry === "object") {
        ctr.current[key] = ctrLiveToEdit(entry);
      }
    }
    ctr.baseline = JSON.parse(JSON.stringify(ctr.current));

    // Seed the global spawn-density config (normalized; missing file => defaults).
    const cfgLive = ctrConfigLive && typeof ctrConfigLive === "object" ? ctrConfigLive : {};
    ctrConfig.current = {
      windowSize: normalizeCtrWindowSize(cfgLive.windowSize),
      windowChancePct: normalizeCtrWindowChance(cfgLive.windowChancePct),
    };
    ctrConfig.baseline = JSON.parse(JSON.stringify(ctrConfig.current));

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
    // Custom Trainers: species picker (full universe), trainer-class + held-item pickers.
    const sdl = document.createElement("datalist");
    sdl.id = "species-list";
    sdl.innerHTML = POKEDEX_SPECIES.map(s => `<option value="${s.const}">${esc(s.name)}</option>`).join("");
    document.body.appendChild(sdl);
    const tcdl = document.createElement("datalist");
    tcdl.id = "trainerclass-list";
    tcdl.innerHTML = TRAINER_CLASSES.map(t => `<option value="${t.name}">${prettify(t.name)}</option>`).join("");
    document.body.appendChild(tcdl);
    // NB: the held-item datalist (#helditems-list) is rendered INSIDE the Custom
    // Trainers section (heldItemsDatalistHtml) so it reflects the full grouped
    // HELD_ITEMS catalog loaded above — no global body-level datalist here.

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
      if (activeTab === "customtrainers" && onCustomTrainerChange(e.target)) {
        return;
      }
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
        || e.target.classList.contains("ls-level")
      ) {
        // .ls-level: re-render to re-sort rows by their new level (on blur/commit).
        render();
      }
    });

    // ---- Pokedex tabs: ability combobox open/close + move drag-and-drop -----
    content.addEventListener("focusin", e => {
      if (e.target.classList && e.target.classList.contains("abil-input")) {
        openAbilDrop(e.target.dataset.slot, e.target.value);
      }
    });
    content.addEventListener("focusout", e => {
      // Delay so a click on an option registers before the dropdown closes.
      if (e.target.classList && e.target.classList.contains("abil-input")) {
        setTimeout(closeAbilDrops, 150);
      }
    });
    let dragMoveId = null;
    content.addEventListener("dragstart", e => {
      const pal = e.target.closest?.(".pal-move");
      if (pal) {
        dragMoveId = Number(pal.dataset.moveid);
        e.dataTransfer.effectAllowed = "copy";
      }
    });
    content.addEventListener("dragover", e => {
      const zone = e.target.closest?.("[data-drop]");
      if (zone && dragMoveId !== null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        zone.classList.add("drag");
      }
    });
    content.addEventListener("dragleave", e => {
      const zone = e.target.closest?.("[data-drop]");
      if (zone) {
        zone.classList.remove("drag");
      }
    });
    content.addEventListener("drop", e => {
      const zone = e.target.closest?.("[data-drop]");
      if (zone && dragMoveId !== null) {
        e.preventDefault();
        zone.classList.remove("drag");
        pdAddMove(dragMoveId);
        dragMoveId = null;
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
