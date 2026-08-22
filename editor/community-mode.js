(() => {
  const params = new URLSearchParams(location.search);
  const enabled = window.ER_EDITOR_MODE === "community" || params.get("mode") === "community";
  const demo = enabled && params.has("demo");
  const API = "https://er-save-api.heraklines.workers.dev";
  const TOKEN_KEY = "er-community-editor-token";
  const USER_KEY = "er-community-editor-user";
  const DEMO_QUEUE_KEY = "er-community-editor-demo-suggestions";

  let token = demo ? "demo" : localStorage.getItem(TOKEN_KEY) || "";
  let username = demo ? "UmbraKai" : localStorage.getItem(USER_KEY) || "";
  let eligibility = demo ? { eligible: true, points: 7425, requiredPoints: 5965, totalPoints: 11930 } : null;

  const $ = selector => document.querySelector(selector);

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
  }

  async function refreshEligibility() {
    if (demo) {
      setAccess("Eligible: 7,425 / 5,965 Redux points", "eligible");
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
          ? `Eligible: ${Number(eligibility.points).toLocaleString()} / ${Number(eligibility.requiredPoints).toLocaleString()} Redux points`
          : `${Number(eligibility.points).toLocaleString()} / ${Number(eligibility.requiredPoints).toLocaleString()} Redux points required`,
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
      throw new Error("This account has not reached half of the Redux-only achievement points yet.");
    }
    const reason = await promptReason(summary);
    if (reason === null) {
      return null;
    }
    const payload = { ...draft, reason };
    if (demo) {
      return saveDemoDraft(payload);
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
    document.title = "Pokerogue Redux Community Editor";
    const heading = document.querySelector("header h1");
    if (heading) {
      heading.textContent = "ER Community Editor";
    }
    updateAccount();
    bindDialogs();
    void refreshEligibility();
  }

  window.communityEditorMode = {
    enabled,
    demo,
    init,
    submitDraft,
    username: () => username,
    demoQueueKey: DEMO_QUEUE_KEY,
  };
})();
