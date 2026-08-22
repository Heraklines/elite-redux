(() => {
  const API = "https://er-save-api.heraklines.workers.dev";
  const STAGED_KEY = "er-editor-staged-community-suggestions";
  const IGNORED_KEY = "er-editor-ignored-suggestion-authors";
  const DEMO_QUEUE_KEY = "er-community-editor-demo-suggestions";
  const demo = new URLSearchParams(location.search).has("suggestion-demo");
  const esc = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = value => JSON.parse(JSON.stringify(value));

  let items = [];
  let selectedId = "";
  let status = "open";
  let query = "";
  let loading = false;
  let error = "";
  let root = null;
  const ignored = new Set(JSON.parse(localStorage.getItem(IGNORED_KEY) || "[]"));
  let showIgnored = false;
  let staged = JSON.parse(localStorage.getItem(STAGED_KEY) || "[]");

  const demoItems = [
    {
      id: "sample-jumpluff",
      author: "UmbraKai",
      entityType: "pokemon",
      entityKey: "SPECIES_JUMPLUFF_MEGA",
      entityLabel: "Mega Jumpluff",
      status: "open",
      createdAt: Date.now() - 3600000,
      reason:
        "Mega Jumpluff has a narrow doubles role despite its cost. This gives it a second utility line without increasing its damage.",
      changes: { "species-abilities": { SPECIES_JUMPLUFF_MEGA: { ability2: 5184, innates: [34, 207, 5301] } } },
      baseline: { "species-abilities": { SPECIES_JUMPLUFF_MEGA: { ability2: 102, innates: [34, 207, 112] } } },
      sourceRevision: "b5cdeb50135e",
      authorSuggestionCount: 7,
      authorAppliedCount: 3,
      authorStats: {
        achievementPoints: 8425,
        sessionsWon: 31,
        ribbons: 184,
        shinySpecies: 126,
        highestDamage: 41872,
        uniqueRelics: 17,
      },
    },
    {
      id: "sample-candy",
      author: "BalanceNerd",
      entityType: "game",
      entityKey: "er.candy.multHell",
      entityLabel: "Hell candy multiplier",
      status: "open",
      createdAt: Date.now() - 7200000,
      reason:
        "Hell clears take longer but currently trail Elite for practical candy gain. A small increase would keep the risk/reward curve coherent.",
      changes: { "balance-tuning": { "er.candy.multHell": 1.25 } },
      baseline: { "balance-tuning": { "er.candy.multHell": 1 } },
      sourceRevision: "b5cdeb50135e",
      authorSuggestionCount: 12,
      authorAppliedCount: 8,
      authorStats: {
        achievementPoints: 10300,
        sessionsWon: 58,
        ribbons: 312,
        shinySpecies: 208,
        highestDamage: 93211,
        uniqueRelics: 24,
      },
    },
    {
      id: "sample-item",
      author: "Sable",
      entityType: "item",
      entityKey: "ER_LUCKY_HEART",
      entityLabel: "Lucky Heart",
      status: "approved",
      createdAt: Date.now() - 86400000,
      reason: "The current stack cap causes this to crowd out more interesting Rogue rewards after the first copy.",
      changes: { "item-tuning": { ER_LUCKY_HEART: { maxStack: 1 } } },
      baseline: { "item-tuning": { ER_LUCKY_HEART: { maxStack: 2 } } },
      sourceRevision: "b5cdeb50135e",
      authorSuggestionCount: 4,
      authorAppliedCount: 2,
      authorStats: {
        achievementPoints: 6950,
        sessionsWon: 19,
        ribbons: 117,
        shinySpecies: 88,
        highestDamage: 20340,
        uniqueRelics: 11,
      },
    },
  ];

  function localDemoItems() {
    try {
      const value = JSON.parse(localStorage.getItem(DEMO_QUEUE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function password() {
    return (document.querySelector("#password")?.value || "").trim();
  }
  function persistStaged() {
    localStorage.setItem(STAGED_KEY, JSON.stringify(staged));
  }
  function selected() {
    const visible = visibleItems();
    return visible.find(item => item.id === selectedId) || visible[0] || null;
  }

  function flatten(before, after, prefix = "") {
    const rows = [];
    for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
      const path = prefix ? `${prefix}.${key}` : key;
      const a = before?.[key];
      const b = after?.[key];
      if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
        rows.push(...flatten(a, b, path));
      } else if (!eq(a, b)) {
        rows.push({ path, before: a, after: b });
      }
    }
    return rows;
  }

  async function staffRequest(path, body) {
    if (demo) {
      return { ok: true };
    }
    const response = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: password(), ...body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  async function load() {
    if (!password() && !demo) {
      error = "Enter the editor password to load community suggestions.";
      items = [];
      draw();
      return;
    }
    loading = true;
    error = "";
    draw();
    try {
      if (demo) {
        items = [...localDemoItems(), ...demoItems].filter(item => status === "all" || item.status === status);
      } else {
        items = (await staffRequest("/community/editor-suggestions/staff/list", { status })).items || [];
      }
      if (!items.some(item => item.id === selectedId)) {
        selectedId = items[0]?.id || "";
      }
    } catch (cause) {
      error = cause.message;
      items = [];
    } finally {
      loading = false;
      draw();
    }
  }

  function visibleItems() {
    const needle = query.trim().toLowerCase();
    return items.filter(
      item =>
        (showIgnored || !ignored.has(item.author))
        && (!needle
          || `${item.entityLabel} ${item.entityKey} ${item.author} ${item.reason}`.toLowerCase().includes(needle)),
    );
  }

  function renderList() {
    const list = visibleItems();
    if (loading) {
      return `<div class="sug-empty">Loading suggestions…</div>`;
    }
    if (error) {
      return `<div class="sug-empty">${esc(error)}</div>`;
    }
    if (list.length === 0) {
      return `<div class="sug-empty">No suggestions match this view.</div>`;
    }
    return list
      .map(
        item =>
          `<button class="sug-card ${item.id === selected()?.id ? "active" : ""}" data-suggestion="${item.id}"><div class="sug-card-head"><strong>${esc(item.entityLabel)}</strong><span class="sug-status ${esc(item.status)}">${esc(item.status)}</span></div><small>${esc(item.author)} · ${new Date(item.createdAt).toLocaleDateString()}</small></button>`,
      )
      .join("");
  }

  function renderDetail(item) {
    if (!item) {
      return `<div class="sug-empty">Select a suggestion to review its diff.</div>`;
    }
    const diffs = flatten(item.baseline, item.changes);
    const isStaged = staged.some(entry => entry.id === item.id);
    return `<h2>${esc(item.entityLabel)}</h2><div class="sug-byline">${esc(item.entityType)} · ${esc(item.entityKey)} · proposed by <button class="link sug-show-author" type="button">${esc(item.author)}</button></div>
      <div class="sug-reason">${esc(item.reason || "No reasoning was provided.")}</div>
      <h3>Changes</h3>${diffs.map(diff => `<div class="sug-diff"><div class="sug-diff-path">${esc(diff.path)}</div><div class="sug-diff-values"><div class="sug-before">${esc(JSON.stringify(diff.before, null, 2))}</div><div class="sug-after">${esc(JSON.stringify(diff.after, null, 2))}</div></div></div>`).join("")}
      <div class="sug-actions">${item.status === "open" ? `<button class="approve" data-action="approve">Approve &amp; stage</button><button class="dismiss" data-action="dismiss">Dismiss</button>` : item.status === "approved" && !isStaged ? `<button class="approve" data-action="stage">Stage in current batch</button><button class="dismiss" data-action="dismiss">Dismiss</button>` : isStaged ? `<span class="badge">Staged in current batch</span>` : ""}</div>`;
  }

  function stat(label, value) {
    return `<div class="sug-stat"><b>${Number(value || 0).toLocaleString()}</b><small>${esc(label)}</small></div>`;
  }
  function renderInspector(item) {
    if (!item) {
      return `<h3>Reviewer tools</h3><p class="hint">Author stats appear here.</p>`;
    }
    const stats = item.authorStats || {};
    const isIgnored = ignored.has(item.author);
    return `<h3>Author</h3><button class="sug-author-button" type="button"><span class="sug-avatar">${esc(item.author?.[0]?.toUpperCase() || "?")}</span><span><strong>${esc(item.author)}</strong><small>${item.authorAppliedCount || 0} applied of ${item.authorSuggestionCount || 0} suggestions</small></span></button>
      <div class="sug-stats">${stat("Achievement points", stats.achievementPoints)}${stat("Runs won", stats.sessionsWon)}${stat("Ribbons", stats.ribbons)}${stat("Shiny species", stats.shinySpecies)}${stat("Highest damage", stats.highestDamage)}${stat("Unique relics", stats.uniqueRelics)}</div>
      <p class="hint">These aggregate game stats are visible only to authenticated editor staff.</p>
      <button class="sug-ignore" data-ignore="${esc(item.author)}">${isIgnored ? "Show" : "Ignore"} ${esc(item.author)} ${isIgnored ? "again" : "on this device"}</button>`;
  }

  function draw() {
    if (!root) {
      return;
    }
    const item = selected();
    root.innerHTML = `<div class="sug-shell"><section class="sug-list" aria-label="Suggestion queue"><div class="sug-toolbar"><div class="sug-toolbar-row"><select id="sug-status" aria-label="Suggestion status filter"><option value="open">Open</option><option value="approved">Approved</option><option value="dismissed">Dismissed</option><option value="applied">Applied</option><option value="all">All</option></select><button type="button" id="sug-refresh">Refresh</button></div><input id="sug-search" type="search" placeholder="Filter by Pokémon, field, or author" value="${esc(query)}"><button type="button" class="link sug-toggle-ignored" ${ignored.size > 0 ? "" : "disabled"}>${showIgnored ? "Hide ignored" : `Show ignored (${ignored.size})`}</button></div><div class="sug-rows">${renderList()}</div></section><section class="sug-detail" aria-label="Suggestion detail">${renderDetail(item)}</section><aside class="sug-inspector" aria-label="Reviewer tools">${renderInspector(item)}</aside></div>`;
    root.querySelector("#sug-status").value = status;
    bind();
  }

  function bind() {
    root.querySelectorAll("[data-suggestion]").forEach(button =>
      button.addEventListener("click", () => {
        selectedId = button.dataset.suggestion;
        draw();
      }),
    );
    root.querySelector("#sug-status")?.addEventListener("change", event => {
      status = event.target.value;
      void load();
    });
    root.querySelector("#sug-refresh")?.addEventListener("click", () => void load());
    root.querySelector(".sug-toggle-ignored")?.addEventListener("click", () => {
      showIgnored = !showIgnored;
      selectedId = "";
      draw();
    });
    root.querySelector("#sug-search")?.addEventListener("input", event => {
      query = event.target.value;
      draw();
      root.querySelector("#sug-search")?.focus();
    });
    root
      .querySelectorAll("[data-action]")
      .forEach(button => button.addEventListener("click", () => void review(button.dataset.action)));
    root.querySelector("[data-ignore]")?.addEventListener("click", event => {
      const author = event.currentTarget.dataset.ignore;
      if (ignored.has(author)) {
        ignored.delete(author);
      } else {
        ignored.add(author);
      }
      localStorage.setItem(IGNORED_KEY, JSON.stringify([...ignored]));
      selectedId = "";
      draw();
    });
  }

  function stage(item) {
    if (!staged.some(entry => entry.id === item.id)) {
      staged.push(clone(item));
    }
    persistStaged();
    window.refreshChrome?.();
  }

  async function review(action) {
    const item = selected();
    if (!item) {
      return;
    }
    try {
      if (action === "stage") {
        stage(item);
        draw();
        return;
      }
      await staffRequest("/community/editor-suggestions/staff/review", { id: item.id, action });
      if (action === "approve") {
        stage(item);
      }
      item.status = action === "approve" ? "approved" : "dismissed";
      draw();
    } catch (cause) {
      error = cause.message;
      draw();
    }
  }

  function mergeObject(target, source) {
    for (const [key, value] of Object.entries(source || {})) {
      target[key] =
        value
        && typeof value === "object"
        && !Array.isArray(value)
        && target[key]
        && typeof target[key] === "object"
        && !Array.isArray(target[key])
          ? mergeObject({ ...target[key] }, value)
          : clone(value);
    }
    return target;
  }

  const api = {
    render(container) {
      root = container;
      draw();
      if (items.length === 0 && !loading) {
        void load();
      }
    },
    stagedCount() {
      return staged.length;
    },
    mergeStagedDeltas(deltas) {
      for (const item of staged) {
        for (const [file, delta] of Object.entries(item.changes || {})) {
          deltas[file] = mergeObject(deltas[file] || {}, delta);
        }
      }
    },
    async markStagedApplied(editorPassword) {
      const applied = [];
      for (const item of staged) {
        try {
          if (!demo) {
            const response = await fetch(`${API}/community/editor-suggestions/staff/review`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password: editorPassword, id: item.id, action: "applied" }),
            });
            if (!response.ok) {
              continue;
            }
          }
          applied.push(item.id);
        } catch {
          /* Keep staged for a later retry. */
        }
      }
      staged = staged.filter(item => !applied.includes(item.id));
      persistStaged();
    },
  };

  window.communitySuggestions = api;
  window.addEventListener("storage", event => {
    if (demo && event.key === DEMO_QUEUE_KEY) {
      void load();
    }
  });
  if (!demo && document.querySelector("nav.tabs [data-tab='suggestions']")) {
    fetch(`${API}/community/editor-suggestions/counts`)
      .then(response => response.json())
      .then(data => {
        const count = (data.items || []).reduce((sum, item) => sum + Number(item.count || 0), 0);
        const badge = document.querySelector("#suggestion-nav-count");
        if (badge && count) {
          badge.textContent = `(${count})`;
        }
      })
      .catch(() => {});
  }
})();
