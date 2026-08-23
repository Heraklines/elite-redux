"use strict";

const DATA_URL = "./data/leaderboards.json";
const MOBILE_QUERY = "(max-width: 900px)";
const BOARD_HINTS = {
  "achievement-points": "Points from unlocked achievements.",
  ribbons: "Victory ribbons across all starter species.",
  "shiny-lab-effects": "Shiny Lab species effects unlocked.",
  "black-market-runs": "Runs where the Black Market was used.",
  "ace-win-rate": "Ace win rate; minimum 50 completed runs.",
  "elite-win-rate": "Elite win rate; minimum 50 completed runs.",
  "hell-win-rate": "Hell win rate; minimum 50 completed runs.",
  "average-wave": "Mean finishing wave; minimum 20 completed runs.",
  "median-wave": "Middle finishing wave; minimum 20 completed runs.",
  "unique-winning-starters": "Distinct opening starter lines used in victories.",
  "challenge-combinations": "Distinct sets of challenge modifiers cleared.",
  "monotype-clears": "Victories with any monotype challenge.",
  "hell-monotype-clears": "Hell victories with any monotype challenge.",
  "no-repeat-streak": "Best win streak without reusing an opening starter; losses reset it.",
  "form-30-days": "Win rate in the last 30 days; minimum 50 runs.",
  "form-90-days": "Win rate in the last 90 days; minimum 50 runs.",
};

const els = {
  groups: document.getElementById("groups"),
  metrics: document.getElementById("metrics"),
  board: document.getElementById("board"),
  state: document.getElementById("state"),
  meta: document.getElementById("meta"),
  searchInput: document.getElementById("player-search"),
  searchPop: document.getElementById("search-results"),
};

function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const intFmt = new Intl.NumberFormat("en-US");
const pctFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const waveFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function formatValue(format, value) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  if (format === "percent") return `${pctFmt.format(value)}%`;
  if (format === "wave") return waveFmt.format(value);
  return intFmt.format(value);
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}

let data = null;
let groups = [];
const playerIndex = new Map();
let currentBoardId = null;
const media = window.matchMedia(MOBILE_QUERY);
const header = document.querySelector(".site-header");

function syncHeaderHeight() {
  document.documentElement.style.setProperty("--header-height", `${header.offsetHeight}px`);
}

new ResizeObserver(syncHeaderHeight).observe(header);

function firstBoardOf(groupName) {
  const g = groups.find(gr => gr.name === groupName);
  return g && g.boards.length ? g.boards[0].id : null;
}

function groupOf(boardId) {
  for (const g of groups) {
    if (g.boards.some(b => b.id === boardId)) return g.name;
  }
  return null;
}

function findBoard(boardId) {
  for (const g of groups) {
    const b = g.boards.find(x => x.id === boardId);
    if (b) return b;
  }
  return null;
}

function defaultBoardId() {
  const direct = findBoard("achievements");
  if (direct) return direct.id;
  return groups.length && groups[0].boards.length ? groups[0].boards[0].id : null;
}

function boardByHash() {
  const m = /^#player\/(.+)$/.exec(location.hash);
  if (m) return { player: decodeURIComponent(m[1]) };
  const id = location.hash.replace(/^#\/?/, "");
  return id && findBoard(id) ? { board: id } : null;
}

function renderChrome() {
  const activeGroup = currentBoardId ? groupOf(currentBoardId) : null;
  const activeHint = BOARD_HINTS[currentBoardId] ?? "";

  if (media.matches) {
    const groupOptions = groups
      .map(g => `<option value="${esc(g.name)}"${g.name === activeGroup ? " selected" : ""}>${esc(g.name)}</option>`)
      .join("");
    const metricOptions =
      groups
        .find(g => g.name === activeGroup)
        ?.boards.map(
          b => `<option value="${esc(b.id)}"${b.id === currentBoardId ? " selected" : ""}${
            BOARD_HINTS[b.id] ? ` title="${esc(BOARD_HINTS[b.id])}"` : ""
          }>${esc(b.label)}</option>`,
        )
        .join("") ?? "";
    els.groups.innerHTML = `<label class="visually-hidden" for="group-select">Category</label>
      <select id="group-select">${groupOptions}</select>`;
    els.metrics.innerHTML = `<label class="visually-hidden" for="metric-select">Leaderboard metric</label>
      <select id="metric-select"${activeHint ? ` title="${esc(activeHint)}"` : ""}>${metricOptions}</select>`;
    return;
  }

  els.groups.innerHTML = groups
    .map(
      g => `<button type="button" class="group-tab${g.name === activeGroup ? " is-active" : ""}"
        data-group="${esc(g.name)}" aria-pressed="${g.name === activeGroup}">${esc(g.name)}
        <span class="group-count">${g.boards.length}</span></button>`,
    )
    .join("");

  const g = groups.find(gr => gr.name === activeGroup);
  els.metrics.innerHTML = g
    ? g.boards
        .map(
          b => `<button type="button" class="metric-pill${b.id === currentBoardId ? " is-active" : ""}"
          data-board="${esc(b.id)}" aria-pressed="${b.id === currentBoardId}"${
            BOARD_HINTS[b.id] ? ` title="${esc(BOARD_HINTS[b.id])}"` : ""
          }>${esc(b.label)}</button>`,
        )
        .join("")
    : "";
}

function setMeta() {
  const parts = [
    `Top ${intFmt.format(data.topLimit ?? 100)} per board`,
    `Nightly build ${formatDate(data.generatedAt)}`,
  ];
  const eligible = data.eligibility?.eligibleSaveCount;
  const total = data.eligibility?.totalSaveCount;
  if (typeof eligible === "number") {
    parts.push(
      `${intFmt.format(eligible)} eligible saves${typeof total === "number" ? ` of ${intFmt.format(total)}` : ""}`,
    );
  }
  els.meta.textContent = parts.join(" · ");
}

function noticesFor(board) {
  const notes = [`${intFmt.format(board.entries.length)} ranked players · top ${intFmt.format(data.topLimit ?? 100)}`];
  if (board.format === "percent" && data.eligibility?.winRateMinimumRuns != null) {
    notes.push(`minimum ${intFmt.format(data.eligibility.winRateMinimumRuns)} recorded runs`);
  }
  if (board.format === "wave" && data.eligibility?.waveMinimumRuns != null) {
    notes.push(`minimum ${intFmt.format(data.eligibility.waveMinimumRuns)} recorded runs`);
  }
  return notes;
}

function rowHtml(board, entry, showDetails) {
  const topClass = entry.rank <= 3 ? ` top-${entry.rank}` : "";
  const name = esc(entry.player);
  return `<tr class="${topClass.trim()}">
    <td class="col-rank"><span class="rank-badge" aria-label="Rank ${entry.rank}">${entry.rank}</span></td>
    <td class="col-player"><a href="#player/${encodeURIComponent(entry.player)}">${name}</a></td>
    <td class="col-value">${formatValue(board.format, entry.value)}</td>
    ${showDetails ? `<td class="col-detail">${entry.detail ? esc(entry.detail) : ""}</td>` : ""}
  </tr>`;
}

function renderBoard(boardId) {
  const board = findBoard(boardId);
  currentBoardId = boardId || defaultBoardId();
  renderChrome();
  closeSearch();

  if (!board) {
    els.state.hidden = false;
    els.state.textContent = "This leaderboard is not published.";
    els.board.hidden = true;
    return;
  }

  els.state.hidden = true;
  els.board.hidden = false;

  const notices = noticesFor(board)
    .map(n => `<p class="notice">${esc(n)}</p>`)
    .join("");
  const showDetails = board.entries.some(entry => Boolean(entry.detail));

  if (!board.entries.length) {
    els.board.innerHTML = `<div class="board-head">
        <h1 class="board-title">${esc(board.label)}</h1>
        <p class="board-desc">${esc(board.description)}</p>
        ${notices}
      </div>
      <p class="state">No ranked players on this leaderboard yet.</p>`;
    return;
  }

  els.board.innerHTML = `<div class="board-head">
      <h1 class="board-title">${esc(board.label)}</h1>
      <p class="board-desc">${esc(board.description)}</p>
      ${notices}
    </div>
    <div class="table-scroll">
    <table class="rank-table">
      <caption class="visually-hidden">${esc(board.label)} leaderboard, top ${intFmt.format(
        data.topLimit ?? 100,
      )}</caption>
      <thead><tr>
        <th scope="col" class="col-rank">Rank</th>
        <th scope="col">Player</th>
        <th scope="col" class="col-value">Result</th>
        ${showDetails ? '<th scope="col">Details</th>' : ""}
      </tr></thead>
      <tbody>${board.entries.map(e => rowHtml(board, e, showDetails)).join("")}</tbody>
    </table>
    </div>
    <ol class="rank-cards" aria-label="${esc(board.label)} standings">
      ${board.entries
        .map(
          e => `<li class="rank-card${e.rank <= 3 ? ` top-${e.rank}` : ""}">
        <span class="rank-badge" aria-label="Rank ${e.rank}">${e.rank}</span>
        <a class="rank-name" href="#player/${encodeURIComponent(e.player)}">${esc(e.player)}</a>
        <span class="rank-value">${formatValue(board.format, e.value)}</span>
        ${e.detail ? `<span class="rank-detail">${esc(e.detail)}</span>` : ""}
      </li>`,
        )
        .join("")}
    </ol>`;
}

function renderPlayer(playerName) {
  currentBoardId = null;
  renderChrome();
  closeSearch();

  const rec = playerIndex.get(playerName.toLowerCase());
  const displayName = rec ? rec.name : playerName;

  if (!rec) {
    els.state.hidden = true;
    els.board.hidden = false;
    els.board.innerHTML = `<a class="back-link" href="#${esc(defaultBoardId() ?? "")}">&larr; Back to leaderboards</a>
      <h1 class="board-title">${esc(displayName)}</h1>
      <p class="state">Player not found on the published leaderboards. Only the top
      ${intFmt.format(data.topLimit ?? 100)} entries of each board are published, so players outside
      that range do not appear here.</p>`;
    return;
  }

  els.state.hidden = true;
  els.board.hidden = false;

  const showDetails = rec.appearances.some(({ entry }) => Boolean(entry.detail));
  const rows = rec.appearances
    .map(({ board, entry }) => {
      const name = esc(entry.player);
      return `<tr class="${entry.rank <= 3 ? `top-${entry.rank}` : ""}">
      <td class="col-rank"><span class="rank-badge">${entry.rank}</span></td>
      <td><a href="#${esc(board.id)}">${esc(board.label)}</a></td>
      <td class="col-value">${formatValue(board.format, entry.value)}</td>
      ${showDetails ? `<td class="col-detail">${entry.detail ? esc(entry.detail) : ""}</td>` : ""}
    </tr>`;
    })
    .join("");
  const cards = rec.appearances
    .map(
      ({ board, entry }) => `<li class="rank-card${entry.rank <= 3 ? ` top-${entry.rank}` : ""}">
        <span class="rank-badge" aria-label="Rank ${entry.rank}">${entry.rank}</span>
        <a class="rank-name" href="#${esc(board.id)}">${esc(board.label)}</a>
        <span class="rank-value">${formatValue(board.format, entry.value)}</span>
        ${entry.detail ? `<span class="rank-detail">${esc(entry.detail)}</span>` : ""}
      </li>`,
    )
    .join("");

  els.board.innerHTML = `<a class="back-link" href="#${esc(
    rec.appearances[0].board.id,
  )}">&larr; Back to leaderboards</a>
    <div class="board-head">
      <h1 class="board-title">${esc(displayName)}</h1>
      <p class="board-desc">Appears on ${intFmt.format(rec.appearances.length)} published
      leaderboard${rec.appearances.length === 1 ? "" : "s"}.</p>
    </div>
    <div class="table-scroll">
    <table class="rank-table">
      <caption class="visually-hidden">Leaderboard appearances of ${esc(displayName)}</caption>
      <thead><tr>
        <th scope="col" class="col-rank">Rank</th>
        <th scope="col">Leaderboard</th>
        <th scope="col" class="col-value">Result</th>
        ${showDetails ? '<th scope="col">Details</th>' : ""}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    </div>
    <ol class="rank-cards" aria-label="Leaderboard appearances of ${esc(displayName)}">
      ${cards}
    </ol>`;
}

function navigate() {
  const route = boardByHash();
  if (route?.player != null) {
    renderPlayer(route.player);
    return;
  }
  const target = route?.board ?? defaultBoardId();
  if (!route?.board && target) {
    history.replaceState(null, "", `#${target}`);
  }
  renderBoard(target);
}

els.groups.addEventListener("click", ev => {
  const btn = ev.target.closest("[data-group]");
  if (!btn) return;
  const target = firstBoardOf(btn.dataset.group);
  if (target) location.hash = `#${target}`;
});

els.groups.addEventListener("change", ev => {
  if (ev.target.id !== "group-select") return;
  const target = firstBoardOf(ev.target.value);
  if (target) location.hash = `#${target}`;
});

els.metrics.addEventListener("click", ev => {
  const btn = ev.target.closest("[data-board]");
  if (btn) location.hash = `#${btn.dataset.board}`;
});

els.metrics.addEventListener("change", ev => {
  if (ev.target.id === "metric-select") location.hash = `#${ev.target.value}`;
});

window.addEventListener("hashchange", navigate);

media.addEventListener("change", () => {
  renderChrome();
});

let searchOpen = false;
let activeResult = -1;

function searchResults(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const [, rec] of playerIndex) {
    if (rec.name.toLowerCase().includes(q)) {
      const best = Math.min(...rec.appearances.map(a => a.entry.rank));
      out.push({ rec, best });
    }
  }
  out.sort((a, b) => a.best - b.best || a.rec.name.localeCompare(b.rec.name));
  return out.slice(0, 20);
}

function closeSearch() {
  searchOpen = false;
  activeResult = -1;
  els.searchPop.hidden = true;
  els.searchInput.setAttribute("aria-expanded", "false");
  els.searchInput.removeAttribute("aria-activedescendant");
}

function openSearch(query) {
  const q = query.trim();
  if (q.length < 2) {
    closeSearch();
    return;
  }
  const matches = searchResults(q);
  searchOpen = true;
  activeResult = -1;
  els.searchPop.hidden = false;
  els.searchInput.setAttribute("aria-expanded", "true");

  if (!matches.length) {
    els.searchPop.innerHTML = `<p class="search-none" role="option" aria-disabled="true">No player
      matching &ldquo;${esc(q)}&rdquo; appears in any published top ${intFmt.format(data.topLimit ?? 100)}.</p>`;
    return;
  }

  els.searchPop.innerHTML = matches
    .map(
      ({ rec }, i) => `<button type="button" role="option" id="sr-${i}"
      class="search-result" data-player="${esc(rec.name)}" aria-selected="false">
      <span class="sr-name">${esc(rec.name)}</span>
      <span class="sr-meta">${intFmt.format(rec.appearances.length)} board${
        rec.appearances.length === 1 ? "" : "s"
      } &middot; best #${Math.min(...rec.appearances.map(a => a.entry.rank))}</span>
    </button>`,
    )
    .join("");
}

els.searchInput.addEventListener("input", () => openSearch(els.searchInput.value));

els.searchInput.addEventListener("keydown", ev => {
  if (!searchOpen) {
    if (ev.key === "Enter") {
      const first = searchResults(els.searchInput.value)[0];
      if (first) {
        ev.preventDefault();
        els.searchInput.value = first.rec.name;
        location.hash = `#player/${encodeURIComponent(first.rec.name)}`;
      }
    }
    return;
  }
  const options = [...els.searchPop.querySelectorAll(".search-result")];
  if (ev.key === "Escape") {
    closeSearch();
    return;
  }
  if (!options.length) {
    if (ev.key === "Enter") {
      ev.preventDefault();
      location.hash = `#player/${encodeURIComponent(els.searchInput.value.trim())}`;
    }
    return;
  }
  if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
    ev.preventDefault();
    activeResult =
      ev.key === "ArrowDown"
        ? (activeResult + 1) % options.length
        : (activeResult - 1 + options.length) % options.length;
    options.forEach((o, i) => o.setAttribute("aria-selected", String(i === activeResult)));
    els.searchInput.setAttribute("aria-activedescendant", options[activeResult].id);
    options[activeResult].scrollIntoView({ block: "nearest" });
    return;
  }
  if (ev.key === "Enter") {
    ev.preventDefault();
    const picked =
      activeResult >= 0
        ? options[activeResult].dataset.player
        : (searchResults(els.searchInput.value)[0]?.rec.name ?? els.searchInput.value.trim());
    els.searchInput.value = picked;
    location.hash = `#player/${encodeURIComponent(picked)}`;
  }
});

els.searchPop.addEventListener("click", ev => {
  const btn = ev.target.closest(".search-result");
  if (!btn) return;
  els.searchInput.value = btn.dataset.player;
  location.hash = `#player/${encodeURIComponent(btn.dataset.player)}`;
});

els.searchPop.addEventListener("mousedown", ev => ev.preventDefault());

els.searchInput.addEventListener("blur", () => closeSearch());

async function boot() {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    if (!data || !Array.isArray(data.boards)) throw new Error("Unexpected data shape");

    const byGroup = new Map();
    for (const board of data.boards) {
      if (!board || !Array.isArray(board.entries)) continue;
      const g = board.group || "Other";
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(board);
      for (const entry of board.entries) {
        if (!entry || typeof entry.player !== "string") continue;
        const key = entry.player.toLowerCase();
        if (!playerIndex.has(key)) {
          playerIndex.set(key, { name: entry.player, appearances: [] });
        }
        playerIndex.get(key).appearances.push({ board, entry });
      }
    }
    groups = [...byGroup.entries()].map(([name, boards]) => ({ name, boards }));

    setMeta();
    syncHeaderHeight();
    navigate();
  } catch (err) {
    els.state.hidden = false;
    els.state.textContent = "The leaderboards could not be loaded. Please try again later.";
  }
}

boot();
