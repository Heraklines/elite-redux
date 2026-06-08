/*
 * Elite Redux — egg-move editor SPA.
 * Reads live data from public GitHub raw; commits edits via the er-editor-api Worker.
 */

// ---- Config (edit if URLs change) ------------------------------------------
const WORKER_URL = "https://er-editor-api.heraklines.workers.dev"; // er-editor-api Worker
const REPO = "Heraklines/elite-redux";
const BRANCH = "feat/elite-redux-port";
const EGG_MOVES_RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/src/data/elite-redux/er-egg-moves.json`;
const SPRITE_BASE = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/images/pokemon/elite-redux";

// ---- State -----------------------------------------------------------------
let SPECIES = []; // [{const, name, slug}]
let MOVES = []; // ["MOVE_NAME", ...]
const MOVE_SET = new Set();
const current = {}; // speciesConst -> [moves]
let baseline = {}; // speciesConst -> [moves] (last-saved snapshot for dirty tracking)

const $ = sel => document.querySelector(sel);
const statusEl = $("#status");
const saveBtn = $("#save");

const prettify = name =>
  name
    .toLowerCase()
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

function setStatus(msg, color) {
  statusEl.textContent = msg;
  statusEl.style.color = color || "var(--muted)";
}

function dirtyCount() {
  let n = 0;
  for (const s of SPECIES) {
    if (JSON.stringify(current[s.const] || []) !== JSON.stringify(baseline[s.const] || [])) {
      n++;
    }
  }
  return n;
}

function refreshSaveButton() {
  const n = dirtyCount();
  saveBtn.textContent = `Save ${n} change${n === 1 ? "" : "s"}`;
  saveBtn.disabled = n === 0;
}

function slotsHtml(speciesConst) {
  const moves = current[speciesConst] || [];
  let html = "";
  for (let i = 0; i < 4; i++) {
    const val = moves[i] || "";
    html += `<input class="slot" list="moves-list" data-const="${speciesConst}" data-slot="${i}" value="${val}" placeholder="—" spellcheck="false" />`;
  }
  return html;
}

function renderGrid(filter) {
  const grid = $("#grid");
  const f = (filter || "").trim().toLowerCase();
  const visible = SPECIES.filter(s => !f || s.name.toLowerCase().includes(f) || s.const.toLowerCase().includes(f));
  $("#empty").hidden = visible.length > 0;
  grid.innerHTML = visible
    .map(s => {
      const sprite = s.slug ? `${SPRITE_BASE}/${s.slug}/front.png` : "";
      const dirty = JSON.stringify(current[s.const] || []) !== JSON.stringify(baseline[s.const] || []);
      return `<div class="card${dirty ? " dirty" : ""}" data-card="${s.const}">
        <img src="${sprite}" alt="" loading="lazy" onerror="this.style.visibility='hidden'" />
        <div class="body">
          <div class="name">${s.name} <small>${s.const}</small></div>
          <div class="slots">${slotsHtml(s.const)}</div>
        </div>
      </div>`;
    })
    .join("");
}

function onSlotInput(e) {
  const el = e.target;
  if (!el.classList.contains("slot")) {
    return;
  }
  const speciesConst = el.dataset.const;
  const slot = Number(el.dataset.slot);
  const value = el.value.trim().toUpperCase();
  el.value = value;
  const arr = (current[speciesConst] || []).slice();
  arr[slot] = value;
  current[speciesConst] = arr;
  // Visual validity hint.
  el.style.borderColor = value === "" || MOVE_SET.has(value) ? "" : "#c0392b";
  // Update card dirty state + save count.
  const card = el.closest(".card");
  const dirty = JSON.stringify(current[speciesConst]) !== JSON.stringify(baseline[speciesConst] || []);
  card.classList.toggle("dirty", dirty);
  refreshSaveButton();
}

function buildPayload() {
  // Compact each species to its non-empty moves; validate names.
  const out = {};
  const bad = [];
  for (const s of SPECIES) {
    const moves = (current[s.const] || []).map(m => (m || "").trim().toUpperCase()).filter(Boolean);
    if (moves.length === 0) {
      bad.push(`${s.name}: needs at least 1 move`);
      continue;
    }
    for (const m of moves) {
      if (!MOVE_SET.has(m)) {
        bad.push(`${s.name}: unknown move "${m}"`);
      }
    }
    out[s.const] = moves;
  }
  return { out, bad };
}

async function save() {
  const password = $("#password").value;
  if (!password) {
    setStatus("Enter the editor password first.", "#c0392b");
    return;
  }
  const { out, bad } = buildPayload();
  if (bad.length > 0) {
    setStatus(`Fix ${bad.length} issue(s): ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}`, "#c0392b");
    return;
  }
  saveBtn.disabled = true;
  setStatus("Saving → committing to GitHub…");
  try {
    const res = await fetch(`${WORKER_URL}/egg-moves`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, author: $("#author").value, eggMoves: out }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setStatus(`Save failed: ${data.error || res.status}`, "#c0392b");
      refreshSaveButton();
      return;
    }
    baseline = JSON.parse(JSON.stringify(current));
    renderGrid($("#search").value);
    refreshSaveButton();
    setStatus(`Saved ✓ commit ${data.commit ? data.commit.slice(0, 7) : ""} — deploy to apply.`, "var(--ok)");
  } catch (err) {
    setStatus(`Save error: ${err}`, "#c0392b");
    refreshSaveButton();
  }
}

async function init() {
  try {
    const [species, moves, egg] = await Promise.all([
      fetch("./data/species.json").then(r => r.json()),
      fetch("./data/moves.json").then(r => r.json()),
      // Resilient: if the JSON isn't on the branch yet (first deploy), start empty.
      fetch(`${EGG_MOVES_RAW}?t=${Date.now()}`)
        .then(r => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ]);
    SPECIES = species;
    MOVES = moves;
    for (const m of MOVES) {
      MOVE_SET.add(m);
    }
    // Seed current state from the live egg-moves (pad to 4 slots for editing).
    for (const s of SPECIES) {
      const arr = (egg[s.const] || []).slice(0, 4);
      current[s.const] = arr;
    }
    baseline = JSON.parse(JSON.stringify(current));

    // One shared datalist for all move inputs (light + searchable).
    const dl = document.createElement("datalist");
    dl.id = "moves-list";
    dl.innerHTML = MOVES.map(m => `<option value="${m}">${prettify(m)}</option>`).join("");
    document.body.appendChild(dl);

    renderGrid("");
    refreshSaveButton();
    setStatus(`${SPECIES.length} species loaded.`);

    $("#grid").addEventListener("input", onSlotInput);
    $("#search").addEventListener("input", e => renderGrid(e.target.value));
    saveBtn.addEventListener("click", save);
  } catch (err) {
    setStatus(`Failed to load data: ${err}`, "#c0392b");
  }
}

init();
