(() => {
  const params = new URLSearchParams(location.search);
  const enabled = window.ER_EDITOR_MODE === "community" || params.get("mode") === "community";
  const demo = enabled && params.has("demo");
  const API = "https://er-save-api.heraklines.workers.dev";
  const TOKEN_KEY = "er-community-editor-token";
  const USER_KEY = "er-community-editor-user";
  const DEMO_QUEUE_KEY = "er-community-editor-demo-suggestions";
  const STATUS_META = {
    open: { label: "Pending", className: "pending" },
    approved: { label: "Approved", className: "approved" },
    applied: { label: "Applied", className: "applied" },
    dismissed: { label: "Rejected", className: "rejected" },
    withdrawn: { label: "Withdrawn", className: "withdrawn" },
  };

  let token = demo ? "demo" : localStorage.getItem(TOKEN_KEY) || "";
  let username = demo ? "UmbraKai" : localStorage.getItem(USER_KEY) || "";
  let eligibility = demo
    ? { eligible: true, achievementCount: 96, requiredAchievements: 82, totalAchievements: 164 }
    : null;
  let mineRoot = null;
  let mineItems = [];
  let mineLoaded = false;
  let mineLoading = false;
  let mineError = "";
  let mineFilter = "all";

  const $ = selector => document.querySelector(selector);
  const esc = value =>
    String(value ?? "").replace(
      /[&<>"']/g,
      char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );

  function demoMineItems() {
    try {
      const queue = JSON.parse(localStorage.getItem(DEMO_QUEUE_KEY) || "[]");
      return Array.isArray(queue) ? queue.filter(item => item.author === username) : [];
    } catch {
      return [];
    }
  }

  function mineCount(status) {
    return mineItems.filter(item => status === "all" || item.status === status).length;
  }

  function updateMineBadge() {
    const badge = $("#suggestion-nav-count");
    if (!badge || !enabled) {
      return;
    }
    const count = mineItems.length;
    badge.className = count ? "suggestion-count" : "";
    badge.textContent = count ? String(count) : "";
  }

  async function refreshMine(force = false) {
    if (mineLoading || (mineLoaded && !force)) {
      return;
    }
    if (!token) {
      mineItems = [];
      mineLoaded = true;
      mineError = "";
      updateMineBadge();
      drawMine();
      return;
    }
    mineLoading = true;
    mineError = "";
    drawMine();
    try {
      if (demo) {
        mineItems = demoMineItems();
      } else {
        const response = await fetch(`${API}/community/editor-suggestions/mine`, {
          headers: { Authorization: token },
        });
        if (response.status === 401) {
          logout();
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Could not load suggestions (${response.status})`);
        }
        mineItems = Array.isArray(data.items) ? data.items : [];
      }
      mineItems.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
      mineLoaded = true;
      updateMineBadge();
    } catch (error) {
      mineError = error.message;
    } finally {
      mineLoading = false;
      drawMine();
    }
  }

  function formatDate(value) {
    const date = new Date(Number(value || 0));
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
  }

  function describe(item) {
    return window.communitySuggestions?.describe?.(item) || [];
  }

  function diffHtml(item) {
    const groups = describe(item);
    const count = groups.reduce((sum, group) => sum + group.rows.length, 0);
    if (!count) {
      return `<div class="mine-suggestion-empty-diff">The proposed data is attached to this suggestion.</div>`;
    }
    return `<details class="mine-suggestion-diff"><summary>View ${count} proposed change${count === 1 ? "" : "s"}</summary>${groups.map(group => `<section><h4>${esc(group.tabLabel)}</h4>${group.rows.map(row => `<div class="mine-diff-row"><span>${esc(row.label)}</span><del>${esc(row.before)}</del><span aria-hidden="true">-&gt;</span><ins>${esc(row.after)}</ins></div>`).join("")}</section>`).join("")}</details>`;
  }

  function suggestionCard(item) {
    const meta = STATUS_META[item.status] || { label: item.status || "Unknown", className: "unknown" };
    const reviewed = item.reviewedAt ? `<span>Reviewed ${esc(formatDate(item.reviewedAt))}</span>` : "";
    const applied = item.appliedAt ? `<span>Applied ${esc(formatDate(item.appliedAt))}</span>` : "";
    const withdraw =
      item.status === "open"
        ? `<button type="button" class="mine-withdraw" data-mine-withdraw="${esc(item.id)}">Withdraw</button>`
        : "";
    return `<article class="mine-suggestion-card"><header><div><h3>${esc(item.entityLabel || item.entityKey || "Suggestion")}</h3><span class="mine-suggestion-date">Submitted ${esc(formatDate(item.createdAt))}</span></div><span class="mine-status ${esc(meta.className)}">${esc(meta.label)}</span></header>${item.reason ? `<p class="mine-reason">${esc(item.reason)}</p>` : `<p class="mine-reason muted">No reasoning supplied.</p>`}${diffHtml(item)}<footer>${reviewed}${applied}<span class="grow"></span>${withdraw}</footer></article>`;
  }

  function drawMine() {
    if (!mineRoot?.isConnected) {
      return;
    }
    if (!token) {
      mineRoot.innerHTML = `<section class="mine-suggestions-empty"><h2>My Suggestions</h2><p>Log in with your game account to see every suggestion you have submitted and its review status.</p><button type="button" class="primary" id="mine-login">Log in</button></section>`;
      mineRoot.querySelector("#mine-login")?.addEventListener("click", () => $("#community-login-dialog").showModal());
      return;
    }
    const filters = ["all", "open", "approved", "applied", "dismissed", "withdrawn"];
    const visible = mineItems.filter(item => mineFilter === "all" || item.status === mineFilter);
    const accountCopy = demo
      ? `Demo suggestions saved for ${esc(username)} in this browser.`
      : `Only suggestions submitted by the logged-in account ${esc(username)} are shown here.`;
    mineRoot.innerHTML = `<div class="mine-suggestions"><div class="mine-suggestions-head"><div><h2>My Suggestions</h2><p>${accountCopy}</p></div><button type="button" id="mine-refresh">Refresh</button></div><div class="mine-filters">${filters
      .map(filter => {
        const meta = filter === "all" ? { label: "All" } : STATUS_META[filter];
        return `<button type="button" data-mine-filter="${filter}" class="${mineFilter === filter ? "active" : ""}">${esc(meta.label)} <span>${mineCount(filter)}</span></button>`;
      })
      .join(
        "",
      )}</div>${mineLoading ? `<div class="mine-loading">Loading suggestions...</div>` : mineError ? `<div class="mine-error">${esc(mineError)}</div>` : visible.length > 0 ? `<div class="mine-suggestion-list">${visible.map(suggestionCard).join("")}</div>` : `<div class="mine-suggestions-empty"><h3>No ${mineFilter === "all" ? "" : (STATUS_META[mineFilter]?.label || mineFilter).toLowerCase() + " "}suggestions</h3><p>Your submitted suggestions will appear here.</p></div>`}</div>`;
    mineRoot.querySelector("#mine-refresh")?.addEventListener("click", () => void refreshMine(true));
    mineRoot.querySelectorAll("[data-mine-filter]").forEach(button =>
      button.addEventListener("click", () => {
        mineFilter = button.dataset.mineFilter;
        drawMine();
      }),
    );
    mineRoot
      .querySelectorAll("[data-mine-withdraw]")
      .forEach(button => button.addEventListener("click", () => void withdrawMine(button.dataset.mineWithdraw)));
  }

  async function withdrawMine(id) {
    const item = mineItems.find(entry => entry.id === id);
    if (!item || item.status !== "open") {
      return;
    }
    try {
      if (demo) {
        const queue = JSON.parse(localStorage.getItem(DEMO_QUEUE_KEY) || "[]");
        const queued = queue.find(entry => entry.id === id);
        if (queued) {
          queued.status = "withdrawn";
        }
        localStorage.setItem(DEMO_QUEUE_KEY, JSON.stringify(queue));
      } else {
        const response = await fetch(`${API}/community/editor-suggestions/withdraw`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: token },
          body: JSON.stringify({ id }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || `Could not withdraw suggestion (${response.status})`);
        }
      }
      item.status = "withdrawn";
      drawMine();
    } catch (error) {
      mineError = error.message;
      drawMine();
    }
  }

  function setAccess(message, state = "") {
    const element = $("#community-access");
    if (!element) {
      return;
    }
    element.textContent = message;
    element.dataset.state = state;
  }

  function updateAccount() {
    const button = $("#community-login");
    if (!button) {
      return;
    }
    button.textContent = token ? username : "Log in";
    button.title = token ? `Logged in as ${username}. Click to log out.` : "Log in with your game account";
  }

  function logout() {
    token = "";
    username = "";
    eligibility = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    updateAccount();
    setAccess("Log in to make suggestions");
    mineItems = [];
    mineLoaded = true;
    updateMineBadge();
    drawMine();
  }

  async function refreshEligibility() {
    if (demo) {
      setAccess("Eligible: 96 Redux achievements (82 required)", "eligible");
      return;
    }
    if (!token) {
      setAccess("Log in to make suggestions");
      return;
    }
    setAccess("Checking Redux achievements...");
    try {
      const response = await fetch(`${API}/community/editor-suggestions/eligibility`, {
        headers: { Authorization: token },
      });
      if (response.status === 401) {
        logout();
        return;
      }
      eligibility = response.ok ? await response.json() : null;
      if (!eligibility) {
        setAccess("Eligibility unavailable", "error");
        return;
      }
      setAccess(
        eligibility.eligible
          ? `Eligible: ${Number(eligibility.achievementCount).toLocaleString()} Redux achievements (${Number(eligibility.requiredAchievements).toLocaleString()} required)`
          : `${Number(eligibility.achievementCount).toLocaleString()} / ${Number(eligibility.requiredAchievements).toLocaleString()} Redux achievements required`,
        eligibility.eligible ? "eligible" : "locked",
      );
    } catch {
      setAccess("Eligibility unavailable", "error");
    }
  }

  async function login(user, password) {
    const body = new URLSearchParams({ username: user, password });
    const response = await fetch(`${API}/account/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) {
      throw new Error((await response.text()) || "Login failed");
    }
    const data = await response.json();
    token = data.token;
    username = user;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, username);
    updateAccount();
    await refreshEligibility();
    mineLoaded = false;
    await refreshMine(true);
  }

  function promptReason(summary) {
    const dialog = $("#community-reason-dialog");
    const copy = $("#community-reason-summary");
    const input = $("#community-reason");
    copy.textContent = summary;
    input.value = "";
    dialog.showModal();
    input.focus();
    return new Promise(resolve => {
      const finish = value => {
        dialog.removeEventListener("close", onClose);
        resolve(value);
      };
      const onClose = () => finish(dialog.returnValue === "submit" ? input.value.trim() : null);
      dialog.addEventListener("close", onClose, { once: true });
    });
  }

  function saveDemoDraft(draft) {
    const queue = JSON.parse(localStorage.getItem(DEMO_QUEUE_KEY) || "[]");
    const item = {
      ...draft,
      id: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      author: username || "Demo player",
      status: "open",
      createdAt: Date.now(),
      authorSuggestionCount: queue.filter(entry => entry.author === username).length + 1,
      authorAppliedCount: 0,
      authorStats: {
        achievementPoints: 7425,
        sessionsWon: 31,
        ribbons: 184,
        shinySpecies: 126,
        highestDamage: 41872,
        uniqueRelics: 17,
      },
    };
    queue.unshift(item);
    localStorage.setItem(DEMO_QUEUE_KEY, JSON.stringify(queue.slice(0, 30)));
    window.dispatchEvent(new CustomEvent("community-demo-suggestion", { detail: item }));
    return item;
  }

  async function submitDraft(draft, summary) {
    if (!token) {
      $("#community-login-dialog").showModal();
      throw new Error("Log in before submitting this suggestion.");
    }
    if (!eligibility?.eligible) {
      throw new Error("This account has not unlocked half of the Redux-only achievements yet.");
    }
    const reason = await promptReason(summary);
    if (reason === null) {
      return null;
    }
    const payload = { ...draft, reason };
    if (demo) {
      const saved = saveDemoDraft(payload);
      mineLoaded = false;
      void refreshMine(true);
      return saved;
    }
    const response = await fetch(`${API}/community/editor-suggestions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.errors?.join("; ") || `Submission failed (${response.status})`);
    }
    mineLoaded = false;
    void refreshMine(true);
    return data;
  }

  function bindDialogs() {
    $("#community-login")?.addEventListener("click", () => {
      if (token) {
        logout();
      } else {
        $("#community-login-dialog").showModal();
      }
    });
    $("#community-login-form")?.addEventListener("submit", async event => {
      event.preventDefault();
      const status = $("#community-login-status");
      status.textContent = "Logging in...";
      try {
        await login($("#community-username").value.trim(), $("#community-password").value);
        status.textContent = "";
        $("#community-login-dialog").close();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    $("#community-login-cancel")?.addEventListener("click", () => $("#community-login-dialog").close());
    $("#community-reason-cancel")?.addEventListener("click", () => $("#community-reason-dialog").close("cancel"));
  }

  function init() {
    if (!enabled) {
      return;
    }
    document.body.classList.add("community-mode");
    document.title = "PKRM Community Editor";
    const heading = document.querySelector("header h1");
    if (heading) {
      heading.textContent = "PKRM Community Editor";
    }
    const suggestionTab = document.querySelector('nav.tabs [data-tab="suggestions"]');
    if (suggestionTab) {
      suggestionTab.innerHTML = `My Suggestions <span id="suggestion-nav-count"></span>`;
    }
    updateAccount();
    bindDialogs();
    void refreshEligibility();
    void refreshMine();
  }

  window.communityEditorMode = {
    enabled,
    demo,
    init,
    submitDraft,
    renderSuggestions(root) {
      mineRoot = root;
      drawMine();
      void refreshMine();
    },
    username: () => username,
    demoQueueKey: DEMO_QUEUE_KEY,
  };
})();
