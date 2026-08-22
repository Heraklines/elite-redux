const SAVE_API_URL = "https://er-save-api.heraklines.workers.dev";
const RAW_BASE = "https://raw.githubusercontent.com/Heraklines/elite-redux/feat/elite-redux-port/src/data/elite-redux";
const SPRITE_BASE = "https://cdn.jsdelivr.net/gh/Heraklines/er-assets@main/images/pokemon/elite-redux";
const TOKEN_KEY = "er-community-editor-token";
const USER_KEY = "er-community-editor-user";
const demo = new URLSearchParams(location.search).has("demo");
const DATA_BASE = ["127.0.0.1", "localhost"].includes(location.hostname) ? "../editor/data" : "data";

const state = {
  token: demo ? "demo" : localStorage.getItem(TOKEN_KEY) || "",
  username: demo ? "UmbraKai" : localStorage.getItem(USER_KEY) || "",
  eligible: demo,
  sourceRevision: "",
  tab: "pokemon",
  species: [],
  abilities: [],
  abilityById: new Map(),
  speciesAbilities: {},
  eggMoves: {},
  items: [],
  knobs: [],
  trainers: null,
  counts: new Map(),
  selected: null,
  baseline: null,
  current: null,
  mine: [],
};

const $ = selector => document.querySelector(selector);
const escapeHtml = value =>
  String(value ?? "").replace(
    /[&<>"']/g,
    ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch],
  );
const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token && state.token !== "demo") {
    headers.Authorization = state.token;
  }
  return fetch(`${SAVE_API_URL}${path}`, { ...options, headers });
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(path, { cache: "no-cache" });
    return response.ok ? await response.json() : fallback;
  } catch {
    return fallback;
  }
}

function setStatus(message, kind = "") {
  $("#status").textContent = message;
  $("#status").className = `status ${kind}`;
}

function updateAccount() {
  $("#username").textContent = state.username || "Guest";
  $("#avatar").textContent = state.username ? state.username[0].toUpperCase() : "?";
  $("#login-button").textContent = state.token ? "Log out" : "Log in";
}

async function refreshEligibility() {
  if (demo) {
    renderEligibility({
      eligible: true,
      points: 7425,
      requiredPoints: 5965,
      totalPoints: 11930,
      achievementCount: 96,
      totalAchievements: 164,
    });
    return;
  }
  if (!state.token) {
    state.eligible = false;
    renderEligibility(null);
    return;
  }
  try {
    const response = await api("/community/editor-suggestions/eligibility");
    if (response.status === 401) {
      logout();
    }
    const data = response.ok ? await response.json() : null;
    renderEligibility(data);
  } catch {
    renderEligibility(null, "Could not check eligibility");
  }
}

function renderEligibility(data, error = "") {
  state.eligible = !!data?.eligible;
  const label = $("#eligibility-label");
  const copy = $("#eligibility-copy");
  const bar = $("#eligibility-bar");
  if (data) {
    label.textContent = data.eligible ? "Eligible to suggest" : "More Redux progress required";
    label.style.color = data.eligible ? "var(--ok)" : "var(--warn)";
    copy.textContent = `${data.points.toLocaleString()} / ${data.requiredPoints.toLocaleString()} points · ${data.achievementCount}/${data.totalAchievements} Redux achievements`;
    bar.style.width = `${Math.min(100, (data.points / data.requiredPoints) * 100)}%`;
    bar.style.background = data.eligible ? "var(--ok)" : "var(--warn)";
  } else {
    label.textContent = error || (state.token ? "Eligibility unavailable" : "Log in to check access");
    label.style.color = "var(--muted)";
    copy.textContent = "Redux-only achievements determine suggestion access.";
    bar.style.width = "0";
  }
  updateSubmit();
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  state.token = "";
  state.username = "";
  state.eligible = false;
  updateAccount();
  renderEligibility(null);
}

async function login(username, password) {
  const body = new URLSearchParams({ username, password });
  const response = await fetch(`${SAVE_API_URL}/account/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error((await response.text()) || "Login failed");
  }
  const data = await response.json();
  state.token = data.token;
  state.username = username;
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, username);
  updateAccount();
  await refreshEligibility();
}

function suggestionCount(type, key) {
  return state.counts.get(`${type}:${key}`) || 0;
}

function updateCounts() {
  for (const type of ["pokemon", "item", "trainer", "game"]) {
    let total = 0;
    for (const [key, count] of state.counts) {
      if (key.startsWith(`${type}:`)) {
        total += count;
      }
    }
    $(`#${type === "item" ? "item" : type}-count`).textContent = total;
  }
}

function selectEntity(entity) {
  state.selected = entity;
  if (state.tab === "pokemon") {
    const abilities = state.speciesAbilities[String(entity.id)] || {
      ability1: 0,
      ability2: 0,
      hidden: 0,
      innates: [0, 0, 0],
    };
    state.baseline = {
      ...(entity.isStarter ? { cost: entity.cost, eggTier: entity.eggTier } : {}),
      ability1: abilities.ability1 || 0,
      ability2: abilities.ability2 || 0,
      hidden: abilities.hidden || 0,
      innates: [...(abilities.innates || [0, 0, 0])],
      eggMoves: [...(state.eggMoves[entity.const] || [])],
    };
  } else if (state.tab === "items") {
    state.baseline = { tier: entity.tier, weight: entity.weight, maxStack: entity.maxStack ?? null };
  } else if (state.tab === "game") {
    state.baseline = { value: entity.value ?? entity.default };
  } else if (state.tab === "trainers") {
    state.baseline = clone(entity.values);
  }
  state.current = clone(state.baseline);
  render();
}

function abilityName(id) {
  return state.abilityById.get(Number(id))?.name || "None";
}
function abilityDescription(id) {
  return state.abilityById.get(Number(id))?.description || "No ability selected.";
}

function renderPokemon() {
  const mon = state.selected;
  $("#sprite").hidden = !mon.slug;
  if (mon.slug) {
    $("#sprite").src = `${SPRITE_BASE}/${mon.slug}/front.png`;
  }
  $("#entity-name").textContent = mon.name;
  $("#entity-meta").textContent =
    `No. ${mon.dex} · BST ${mon.bst || "—"} · ${mon.const.replace("SPECIES_", "").replaceAll("_", " ")}`;
  const slots = [
    ["ability1", "Choice ability 1", false],
    ["ability2", "Choice ability 2", false],
    ["hidden", "Hidden ability", false],
    ["innates.0", "Innate 1", true],
    ["innates.1", "Innate 2", true],
    ["innates.2", "Innate 3", true],
  ];
  const starterFields = mon.isStarter
    ? `
    <div class="section"><div class="section-title"><h3>Starter balance</h3><span>Values shown are current live values</span></div>
      <div class="field-grid">
        <div class="field ${state.current.cost === state.baseline.cost ? "" : "changed"}"><label>Starter cost</label><input data-field="cost" type="number" min="1" max="12" value="${state.current.cost}"></div>
        <div class="field ${state.current.eggTier === state.baseline.eggTier ? "" : "changed"}"><label>Egg tier</label><select data-field="eggTier">${["Common", "Rare", "Epic", "Legendary"].map((name, i) => `<option value="${i}" ${state.current.eggTier === i ? "selected" : ""}>${name}</option>`).join("")}</select></div>
      </div>
    </div>`
    : "";
  $("#editor").innerHTML = `
    ${starterFields}
    <div class="section"><div class="section-title"><h3>Abilities and innates</h3><span>Type a name or ID</span></div>
      <div class="ability-grid">${slots
        .map(([field, label, innate]) => {
          const value = field.startsWith("innates")
            ? state.current.innates[Number(field.at(-1))]
            : state.current[field];
          const base = field.startsWith("innates")
            ? state.baseline.innates[Number(field.at(-1))]
            : state.baseline[field];
          const description = abilityDescription(value);
          return `<div class="ability ${innate ? "innate" : ""} ${value === base ? "" : "changed"}"><label>${label}</label><input data-field="${field}" list="ability-list" value="${escapeHtml(abilityName(value))}"><small title="${escapeHtml(description)}">${escapeHtml(description)}</small></div>`;
        })
        .join("")}</div>
    </div>
    <div class="section"><div class="section-title"><h3>Egg moves</h3><span>Comma-separated move names</span></div>
      <div class="move-entry"><textarea data-field="eggMoves">${escapeHtml(state.current.eggMoves.join(", "))}</textarea></div><div class="hint">The final editor validation checks every move name before staff can commit it.</div>
    </div>
    <datalist id="ability-list">${state.abilities.map(a => `<option value="${escapeHtml(a.name)}">${a.id}</option>`).join("")}</datalist>`;
}

function renderItems() {
  const item = state.selected;
  $("#sprite").hidden = true;
  $("#entity-name").textContent = item.key.replaceAll("_", " ");
  $("#entity-meta").textContent = "Reward item tuning";
  $("#editor").innerHTML =
    `<div class="section"><div class="section-title"><h3>Reward distribution</h3><span>Current effective values</span></div><div class="field-grid">
    <div class="field"><label>Reward tier</label><select data-field="tier">${["COMMON", "GREAT", "ULTRA", "ROGUE", "MASTER"].map(v => `<option ${state.current.tier === v ? "selected" : ""}>${v}</option>`).join("")}</select></div>
    <div class="field"><label>Pool weight</label><input data-field="weight" type="number" min="0" value="${state.current.weight ?? ""}" placeholder="Default"></div>
  </div></div>`;
}

function renderGame() {
  const knob = state.selected;
  $("#sprite").hidden = true;
  $("#entity-name").textContent = knob.label;
  $("#entity-meta").textContent = knob.group;
  $("#editor").innerHTML =
    `<div class="section"><div class="section-title"><h3>Game rule</h3><span>${escapeHtml(knob.key)}</span></div><div class="field-grid"><div class="field"><label>Proposed value</label><input data-field="value" type="number" min="${knob.min ?? ""}" max="${knob.max ?? ""}" step="${knob.integer ? 1 : "any"}" value="${state.current.value}"></div><div class="field"><label>Current behavior</label><div>${escapeHtml(knob.help || "")}</div></div></div></div>`;
}

function renderTrainers() {
  $("#sprite").hidden = true;
  $("#entity-name").textContent = "Trainer cadence";
  $("#entity-meta").textContent = "Global Elite and Hell encounter defaults";
  $("#editor").innerHTML =
    `<div class="section"><div class="section-title"><h3>Trainer frequency</h3><span>Lower cadence means more frequent trainers</span></div><div class="field-grid">${["elite", "hell"].map(d => `<div class="field"><label>${d[0].toUpperCase() + d.slice(1)} cadence</label><input data-field="${d}" type="number" min="1" max="20" value="${state.current[d]}"></div>`).join("")}</div></div>`;
}

function renderMine() {
  $("#sprite").hidden = true;
  $("#entity-name").textContent = "My suggestions";
  $("#entity-meta").textContent = "Your submitted proposals and review status";
  $("#entity-marker").hidden = true;
  $("#editor").innerHTML =
    state.mine.length > 0
      ? `<div class="section"><div class="diff-list">${state.mine.map(item => `<div class="field"><div class="mine-head"><strong>${escapeHtml(item.entityLabel)}</strong><span class="count">${escapeHtml(item.status)}</span></div><p class="hint">${new Date(item.createdAt).toLocaleDateString()} · ${escapeHtml(item.reason || "No reasoning provided")}</p>${item.status === "open" ? `<button type="button" class="btn" data-withdraw="${item.id}">Withdraw</button>` : ""}</div>`).join("")}</div></div>`
      : `<div class="empty-diff">You have not submitted any suggestions yet.</div>`;
  $("#diff").className = "empty-diff";
  $("#diff").textContent = "Select another section to create a proposal.";
  $("#submit").disabled = true;
}

function entityKey() {
  if (state.tab === "pokemon") {
    return state.selected.const;
  }
  if (state.tab === "items") {
    return state.selected.key;
  }
  if (state.tab === "game") {
    return state.selected.key;
  }
  return "TRAINER_FREQUENCY";
}

function renderMarker() {
  if (state.tab === "mine" || !state.selected) {
    return;
  }
  const count = suggestionCount(
    state.tab === "items" ? "item" : state.tab === "trainers" ? "trainer" : state.tab,
    entityKey(),
  );
  $("#entity-marker").hidden = count === 0;
  $("#entity-marker-copy").textContent = `${count} open suggestion${count === 1 ? "" : "s"}`;
}

function proposal() {
  if (!state.selected || !state.baseline || equal(state.current, state.baseline)) {
    return null;
  }
  const changes = {};
  const baseline = {};
  if (state.tab === "pokemon") {
    const species = {};
    const speciesBase = {};
    for (const field of ["cost", "eggTier"]) {
      if (field in state.baseline && state.current[field] !== state.baseline[field]) {
        species[field] = state.current[field];
        speciesBase[field] = state.baseline[field];
      }
    }
    if (Object.keys(species).length > 0) {
      changes["species-tuning"] = { [state.selected.const]: species };
      baseline["species-tuning"] = { [state.selected.const]: speciesBase };
    }
    const ability = {};
    const abilityBase = {};
    for (const field of ["ability1", "ability2", "hidden"]) {
      if (state.current[field] !== state.baseline[field]) {
        ability[field] = state.current[field];
        abilityBase[field] = state.baseline[field];
      }
    }
    if (!equal(state.current.innates, state.baseline.innates)) {
      ability.innates = state.current.innates;
      abilityBase.innates = state.baseline.innates;
    }
    if (Object.keys(ability).length > 0) {
      changes["species-abilities"] = { [state.selected.const]: ability };
      baseline["species-abilities"] = { [state.selected.const]: abilityBase };
    }
    if (!equal(state.current.eggMoves, state.baseline.eggMoves)) {
      changes["egg-moves"] = { [state.selected.const]: state.current.eggMoves };
      baseline["egg-moves"] = { [state.selected.const]: state.baseline.eggMoves };
    }
  } else if (state.tab === "items") {
    changes["item-tuning"] = { [state.selected.key]: state.current };
    baseline["item-tuning"] = { [state.selected.key]: state.baseline };
  } else if (state.tab === "game") {
    changes["balance-tuning"] = { [state.selected.key]: state.current.value };
    baseline["balance-tuning"] = { [state.selected.key]: state.baseline.value };
  } else if (state.tab === "trainers") {
    changes["trainer-tuning"] = {
      freq: { elite: { trainerCadence: state.current.elite }, hell: { trainerCadence: state.current.hell } },
    };
    baseline["trainer-tuning"] = {
      freq: { elite: { trainerCadence: state.baseline.elite }, hell: { trainerCadence: state.baseline.hell } },
    };
  }
  return {
    entityType: state.tab === "items" ? "item" : state.tab === "trainers" ? "trainer" : state.tab,
    entityKey: entityKey(),
    entityLabel:
      state.tab === "pokemon"
        ? state.selected.name
        : state.tab === "items"
          ? state.selected.key.replaceAll("_", " ")
          : state.tab === "game"
            ? state.selected.label
            : "Trainer cadence",
    reason: $("#reason").value.trim(),
    sourceRevision: state.sourceRevision,
    changes,
    baseline,
  };
}

function flattenDiff(before, after, prefix = "") {
  const rows = [];
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const path = prefix ? `${prefix}.${key}` : key;
    const a = before?.[key];
    const b = after?.[key];
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      rows.push(...flattenDiff(a, b, path));
    } else if (!equal(a, b)) {
      rows.push({ path, before: a, after: b });
    }
  }
  return rows;
}

function renderDiff() {
  const draft = proposal();
  const box = $("#diff");
  const rows = draft ? flattenDiff(draft.baseline, draft.changes) : [];
  if (rows.length > 0) {
    box.className = "diff-list";
    box.innerHTML = rows
      .map(
        row =>
          `<div class="diff"><b>${escapeHtml(row.path)}</b><div class="diff-values"><span class="from" title="Current">${escapeHtml(JSON.stringify(row.before))}</span><span class="to" title="Proposed">${escapeHtml(JSON.stringify(row.after))}</span></div></div>`,
      )
      .join("");
  } else {
    box.className = "empty-diff";
    box.textContent = "Change a value to build a proposal.";
  }
  updateSubmit();
}

function updateSubmit() {
  const hasDiff = !!state.baseline && !!state.current && !equal(state.baseline, state.current);
  $("#submit").disabled = !hasDiff || !state.eligible || !state.token || state.tab === "mine";
}

function render() {
  if (state.tab === "mine") {
    return renderMine();
  }
  if (!state.selected) {
    return;
  }
  if (state.tab === "pokemon") {
    renderPokemon();
  } else if (state.tab === "items") {
    renderItems();
  } else if (state.tab === "game") {
    renderGame();
  } else {
    renderTrainers();
  }
  renderMarker();
  renderDiff();
}

function searchEntities(query) {
  const q = query.trim().toLowerCase();
  const source =
    state.tab === "pokemon"
      ? state.species
      : state.tab === "items"
        ? state.items
        : state.tab === "game"
          ? state.knobs
          : [];
  return source.filter(item =>
    `${item.name || item.label || item.key} ${item.const || item.key || ""}`.toLowerCase().includes(q),
  );
}

function onEditorInput(event) {
  const field = event.target.dataset.field;
  if (!field || !state.current) {
    return;
  }
  let value = event.target.value;
  if (field === "eggMoves") {
    value = value
      .split(",")
      .map(move => move.trim().toUpperCase().replaceAll(" ", "_"))
      .filter(Boolean);
  } else if (field.startsWith("innates") || ["ability1", "ability2", "hidden"].includes(field)) {
    const found = state.abilities.find(
      a => a.name.toLowerCase() === value.trim().toLowerCase() || String(a.id) === value.trim(),
    );
    if (!found) {
      return;
    }
    value = found.id;
  } else if (["cost", "eggTier", "weight", "value", "elite", "hell"].includes(field)) {
    value = event.target.value === "" ? null : Number(event.target.value);
  }
  if (field.startsWith("innates")) {
    state.current.innates[Number(field.at(-1))] = value;
  } else {
    state.current[field] = value;
  }
  render();
}

async function submitSuggestion() {
  const draft = proposal();
  if (!draft) {
    return;
  }
  if (demo) {
    setStatus("Demo suggestion submitted to the review queue.", "ok");
    state.baseline = clone(state.current);
    render();
    return;
  }
  $("#submit").disabled = true;
  setStatus("Submitting…");
  try {
    const response = await api("/community/editor-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    setStatus("Suggestion submitted for staff review.", "ok");
    state.baseline = clone(state.current);
    await loadMine();
    render();
  } catch (error) {
    setStatus(error.message, "error");
    updateSubmit();
  }
}

async function loadMine() {
  if (!state.token || demo) {
    state.mine = demo
      ? [
          {
            id: "demo-1",
            entityLabel: "Mega Jumpluff",
            status: "open",
            reason: "Its current ability package is too narrow for doubles.",
            createdAt: Date.now() - 86400000,
          },
        ]
      : [];
    return;
  }
  try {
    const response = await api("/community/editor-suggestions/mine");
    state.mine = response.ok ? (await response.json()).items : [];
  } catch {
    state.mine = [];
  }
}

async function init() {
  const [allSpecies, starterSpecies, abilities, speciesAbilities, eggMoves, items, knobs, trainers, counts, version] =
    await Promise.all([
      loadJson(`${DATA_BASE}/all-species.json`, []),
      loadJson(`${DATA_BASE}/species.json`, []),
      loadJson(`${DATA_BASE}/abilities-rich.json`, []),
      loadJson(`${DATA_BASE}/species-abilities.json`, {}),
      loadJson(`${RAW_BASE}/er-egg-moves.json`, {}),
      loadJson(`${DATA_BASE}/items.json`, []),
      loadJson(`${DATA_BASE}/balance-knobs.json`, []),
      loadJson(`${DATA_BASE}/trainers.json`, {
        frequencyDefaults: { elite: { trainerCadence: 4 }, hell: { trainerCadence: 2 } },
      }),
      demo
        ? Promise.resolve({ items: [] })
        : loadJson(`${SAVE_API_URL}/community/editor-suggestions/counts`, { items: [] }),
      demo ? Promise.resolve({ sourceSha: "demo" }) : loadJson("version.json", { sourceSha: "" }),
    ]);
  const starterById = new Map(starterSpecies.map(species => [species.id, species]));
  const species = allSpecies.map(species => ({
    ...species,
    ...(starterById.get(species.id) || {}),
    isStarter: starterById.has(species.id),
  }));
  Object.assign(state, {
    species,
    abilities,
    speciesAbilities,
    eggMoves,
    items,
    knobs,
    trainers,
    sourceRevision: version.sourceSha || "",
  });
  state.abilityById = new Map(abilities.map(ability => [ability.id, ability]));
  state.counts = new Map((counts.items || []).map(item => [`${item.entityType}:${item.entityKey}`, item.count]));
  updateCounts();
  updateAccount();
  await refreshEligibility();
  await loadMine();
  selectEntity(species[0]);
}

document.addEventListener("click", async event => {
  const tab = event.target.closest("[data-tab]")?.dataset.tab;
  if (tab) {
    state.tab = tab;
    document.querySelectorAll("[data-tab]").forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("#search").value = "";
    if (tab === "pokemon") {
      selectEntity(state.species[0]);
    } else if (tab === "items") {
      selectEntity(state.items[0]);
    } else if (tab === "game") {
      selectEntity(state.knobs.find(knob => knob.kind === "scalar") || state.knobs[0]);
    } else if (tab === "trainers") {
      selectEntity({
        key: "TRAINER_FREQUENCY",
        values: {
          elite: state.trainers.frequencyDefaults.elite.trainerCadence,
          hell: state.trainers.frequencyDefaults.hell.trainerCadence,
        },
      });
    } else {
      renderMine();
    }
  }
  const withdraw = event.target.closest("[data-withdraw]")?.dataset.withdraw;
  if (withdraw && !demo) {
    await api("/community/editor-suggestions/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: withdraw }),
    });
    await loadMine();
    renderMine();
  }
});

$("#editor").addEventListener("change", onEditorInput);
$("#reason").addEventListener("input", () => {
  $("#reason-count").textContent = $("#reason").value.length;
});
$("#submit").addEventListener("click", submitSuggestion);
$("#login-button").addEventListener("click", () => {
  if (state.token) {
    logout();
  } else {
    $("#login-dialog").showModal();
  }
});
$("#login-cancel").addEventListener("click", () => $("#login-dialog").close());
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  $("#login-status").textContent = "Logging in…";
  try {
    await login($("#login-user").value, $("#login-pass").value);
    $("#login-dialog").close();
    $("#login-status").textContent = "";
  } catch (error) {
    $("#login-status").textContent = error.message;
  }
});
$("#search").addEventListener("input", event => {
  const matches = searchEntities(event.target.value);
  if (matches.length > 0) {
    selectEntity(matches[0]);
  }
});

void init();
