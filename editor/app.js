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

// Per-edit undo: each committed slot change pushes {const, before}. `committed`
// is the last settled snapshot we diff against to detect a discrete change.
const undoStack = [];
let committed = {};

const $ = sel => document.querySelector(sel);
const statusEl = $("#status");
const saveBtn = $("#save");
const deployBtn = $("#deploy");
const undoBtn = $("#undo");

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

function refreshUndoButton() {
  undoBtn.textContent = undoStack.length > 0 ? `↶ Undo (${undoStack.length})` : "↶ Undo";
  undoBtn.disabled = undoStack.length === 0;
}

// Update a single visible card's inputs + dirty state in place (no full re-render).
function refreshCard(speciesConst) {
  const card = document.querySelector(`.card[data-card="${CSS.escape(speciesConst)}"]`);
  if (!card) {
    return;
  }
  const moves = current[speciesConst] || [];
  card.querySelectorAll(".slot").forEach((inp, i) => {
    inp.value = moves[i] || "";
    inp.style.borderColor = inp.value === "" || MOVE_SET.has(inp.value) ? "" : "#c0392b";
  });
  const dirty = JSON.stringify(current[speciesConst] || []) !== JSON.stringify(baseline[speciesConst] || []);
  card.classList.toggle("dirty", dirty);
}

// Record an undo step when a species' moves settle to a new value (fires on the
// input's `change` event, i.e. once per completed edit — not per keystroke).
function pushUndoIfChanged(speciesConst) {
  const now = JSON.stringify(current[speciesConst] || []);
  const was = JSON.stringify(committed[speciesConst] || []);
  if (now !== was) {
    undoStack.push({ const: speciesConst, before: (committed[speciesConst] || []).slice() });
    committed[speciesConst] = (current[speciesConst] || []).slice();
    refreshUndoButton();
  }
}

// Step back one change.
function undo() {
  const last = undoStack.pop();
  if (!last) {
    return;
  }
  current[last.const] = last.before.slice();
  committed[last.const] = last.before.slice();
  refreshCard(last.const);
  refreshSaveButton();
  refreshUndoButton();
  setStatus(`Reverted ${last.const.replace(/^SPECIES_/, "")} (one step back).`);
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
  // Send ONLY changed species (a delta). The Worker merges them into the live
  // file, so concurrent editors don't clobber each other's untouched species.
  const out = {};
  const bad = [];
  for (const s of SPECIES) {
    const changed = JSON.stringify(current[s.const] || []) !== JSON.stringify(baseline[s.const] || []);
    if (!changed) {
      continue;
    }
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

const ERR = "#c0392b";

// Commit the dirty species (and optionally trigger a staging rebuild+deploy).
// deploy=false → just commit. deploy=true → commit (if any changes) then deploy,
// or deploy-only when there's nothing to commit.
async function commit({ deploy }) {
  // Trim: pasted / autofilled passwords often carry a stray space that would 401.
  const password = ($("#password")?.value || "").trim();
  if (!password) {
    setStatus("Enter the editor password first.", ERR);
    return;
  }
  const { out, bad } = buildPayload();
  if (bad.length > 0) {
    setStatus(`Fix ${bad.length} issue(s): ${bad.slice(0, 3).join("; ")}${bad.length > 3 ? "…" : ""}`, ERR);
    return;
  }
  const hasChanges = Object.keys(out).length > 0;
  if (!deploy && !hasChanges) {
    setStatus("No changes to save.");
    return;
  }
  saveBtn.disabled = true;
  deployBtn.disabled = true;

  try {
    // Deploy-only: nothing changed, just rebuild + ship the current branch.
    if (deploy && !hasChanges) {
      setStatus("Triggering staging deploy…");
      const res = await fetch(`${WORKER_URL}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setStatus(`Deploy failed: ${data.error || res.status}`, ERR);
      } else {
        setStatus("Deploy triggered ✓ — staging rebuilds in a few minutes.", "var(--ok)");
      }
      return;
    }

    setStatus(deploy ? "Saving + deploying…" : "Saving → committing to GitHub…");
    const res = await fetch(`${WORKER_URL}/egg-moves`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, author: $("#author").value, eggMoves: out, deploy }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      setStatus(`Save failed: ${data.error || res.status}`, ERR);
      return;
    }
    baseline = JSON.parse(JSON.stringify(current));
    committed = JSON.parse(JSON.stringify(current));
    undoStack.length = 0;
    refreshUndoButton();
    renderGrid($("#search").value);
    const sha = data.commit ? data.commit.slice(0, 7) : "";
    if (deploy) {
      setStatus(
        data.deployed
          ? `Saved ✓ ${sha} — deploy triggered, live in a few minutes.`
          : `Saved ✓ ${sha} but deploy failed: ${data.deployError || "unknown"}`,
        data.deployed ? "var(--ok)" : ERR,
      );
    } else {
      setStatus(`Saved ✓ ${sha} — click "Commit & Deploy" to apply it to staging.`, "var(--ok)");
    }
  } catch (err) {
    setStatus(`Error: ${err}`, ERR);
  } finally {
    refreshSaveButton();
    deployBtn.disabled = false;
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
    committed = JSON.parse(JSON.stringify(current));

    // One shared datalist for all move inputs (light + searchable).
    const dl = document.createElement("datalist");
    dl.id = "moves-list";
    dl.innerHTML = MOVES.map(m => `<option value="${m}">${prettify(m)}</option>`).join("");
    document.body.appendChild(dl);

    renderGrid("");
    refreshSaveButton();
    refreshUndoButton();
    setStatus(`${SPECIES.length} species loaded.`);

    $("#grid").addEventListener("input", onSlotInput);
    // `change` fires once per completed edit (blur / pick from list) → one undo step.
    $("#grid").addEventListener("change", e => {
      if (e.target.classList.contains("slot")) {
        pushUndoIfChanged(e.target.dataset.const);
      }
    });
    $("#search").addEventListener("input", e => renderGrid(e.target.value));
    saveBtn.addEventListener("click", () => commit({ deploy: false }));
    deployBtn.addEventListener("click", () => commit({ deploy: true }));
    undoBtn.addEventListener("click", undo);
  } catch (err) {
    setStatus(`Failed to load data: ${err}`, "#c0392b");
  }
}

init();
