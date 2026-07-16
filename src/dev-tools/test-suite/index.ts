/*
 * Elite Redux — in-game dev TEST SUITE.  *** TRACKED — ships to STAGING only ***
 *
 * This IS committed and built into the staging bundle so the test team can use
 * it; it NEVER activates in production (registry gate is false there).
 *
 * Loaded by src/dev-tools/registry.ts (only under `npm run start:dev` or
 * VITE_DEV_TOOLS=1). Provides:
 *
 *   1. A floating "Send Logs" button (top-right) — one press captures the
 *      console ring buffer + current game state and POSTs it to the dev server
 *      (POST /__devlog), which writes it to `dev-logs/latest.log`. Falls back to
 *      clipboard + file download if the endpoint is unavailable. Press it the
 *      moment anything interesting happens.
 *
 *   2. A "Dev Scenarios" main-menu entry — pick a pre-built situation and drop
 *      straight into a configured battle (skips starter-select). Add/adjust the
 *      situations in `scenarios.ts`.
 *
 *   3. A "Custom Trainers" entry (top of the Dev Scenarios list, under the
 *      Scenario Builder) — pick any staff-authored custom trainer from
 *      er-custom-trainers.json and drop straight into a forced battle against it,
 *      with the full resolved feature set (sprite + gender, aura, battle music,
 *      intro / victory / defeat lines, weighted-slot + slot-fill rolls, RLA / RLNA
 *      moves, shiny-lab looks, BST bypass). See the "How staff test custom
 *      trainers" note below.
 *
 * HOW STAFF TEST CUSTOM TRAINERS (the full loop):
 *   a. Author the trainer in the team-balancing editor and SAVE — that commits the
 *      entry into er-custom-trainers.json.
 *   b. A STAGING deploy bakes the updated JSON into the game bundle.
 *   c. In-game: Title -> Dev Scenarios -> Custom Trainers -> pick the trainer ->
 *      Fight with random ghost team. The picker randomizes an eligible wave, loads
 *      a real wave-compatible ghost roster, and restores stored challenges. Empty
 *      pools/ranges surface Retry/Back instead of a silent unrelated battle.
 *   d. Production only ships the trainer on the MANUAL prod patch (the dev tools,
 *      incl. this picker, are dead in prod builds).
 *
 * Edit freely — none of this ships to players.
 */

import {
  consumePendingDevBattleSetup,
  consumePendingDevCustomTrainerForce,
  consumePendingDevEnemyParty,
  consumePendingDevPartySetup,
  consumePendingDevShop,
  consumePendingDevStarterLevels,
  consumePendingDevStarters,
  type DevMenuCtx,
  registerDevMenu,
  setPendingDevBattleSetup,
  setPendingDevPartySetup,
  setPendingDevShop,
  setPendingDevStarterLevels,
  setPendingDevStarters,
} from "#app/dev-tools/registry";
import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { formatCoopControlPlane } from "#data/elite-redux/coop/coop-diagnostics";
import { DEVLOG_REPLAY_TRACE_MARKER } from "#data/elite-redux/er-bug-report";
import {
  type ErCustomTrainerResolved,
  getErCustomTrainers,
  setErCustomTrainerDevForce,
} from "#data/elite-redux/er-custom-trainers";
import { sampleGhostSnapshots } from "#data/elite-redux/er-ghost-teams";
import { getReplayTrace } from "#data/elite-redux/replay-recorder";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { formatConsoleSnapshot } from "#utils/console-ring-buffer";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { openScenarioBuilder } from "./builder";
import {
  openDevMenuOverlay,
  pickErCustomTrainerGhost,
  planErCustomTrainerLaunch,
  summarizeErCustomTrainer,
} from "./custom-trainer-picker";
import {
  buildErCustomTrainerDevScenario,
  buildErCustomTrainerTeamScenario,
  DEV_SCENARIOS,
  type DevScenario,
  resetDevOverrides,
} from "./scenarios";

/** er-editor-api Worker — the remote log sink (commits logs to the dev-logs branch). */
const REMOTE_LOG_URL = "https://er-editor-api.heraklines.workers.dev/devlog";

/** Share code of the active BUILDER scenario (embedded in Send Logs captures). */
let activeShareCode: string | null = null;

// ---------------------------------------------------------------------------
// 1. Floating "Send Logs" button
// ---------------------------------------------------------------------------

function captureStateHeader(): string {
  try {
    const s = globalScene;
    const party =
      s
        ?.getPlayerParty?.()
        ?.map(p => `${p?.species?.name ?? "?"}(L${p?.level ?? "?"} ${p?.hp ?? "?"}hp f${p?.formIndex ?? 0})`)
        .join(", ") ?? "";
    const enemy =
      s
        ?.getEnemyParty?.()
        ?.map(p => `${p?.species?.name ?? "?"}(L${p?.level ?? "?"})`)
        .join(", ") ?? "";
    // ER (#431): the build id makes stale-bundle reports identifiable at
    // triage - if a logged build differs from the latest deploy, the report
    // is from old code, not a live bug.
    const build = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "?";
    return [
      `url:      ${location.href}`,
      `build:    ${build}`,
      `mode:     ${s?.gameMode?.modeId ?? "?"}  wave:${s?.currentBattle?.waveIndex ?? "?"}`,
      `seed:     ${s?.seed ?? "?"}`,
      `party:    ${party}`,
      `enemy:    ${enemy}`,
    ].join("\n");
  } catch (err) {
    return `state capture failed: ${String(err)}`;
  }
}

/**
 * #diagnostics: capture the co-op control-plane block for a Send-Logs report, or `""` (solo / failure).
 * Guarded so a snapshot failure never breaks the log capture.
 */
function captureControlPlaneBlock(): string {
  try {
    const block = formatCoopControlPlane();
    return block ? `${block}\n\n` : "";
  } catch {
    return "";
  }
}

/**
 * #diagnostics: serialize the captured replay trace fenced by the SAME marker the in-game bug-report path
 * uses ({@linkcode DEVLOG_REPLAY_TRACE_MARKER}), so `scripts/replay-run.mjs` can EXTRACT + re-drive a
 * Send-Logs capture exactly like a bug-report capture. Guarded; `(none)` when nothing was recorded.
 */
function captureReplayTraceBlock(): string {
  let trace = "(none)";
  try {
    const t = getReplayTrace();
    if (t != null) {
      trace = JSON.stringify(t);
    }
  } catch {
    /* a serialize failure leaves "(none)" - the log still sends */
  }
  return `${DEVLOG_REPLAY_TRACE_MARKER}\n${trace}\n`;
}

function buildReport(comment?: string): string {
  const commentBlock = comment?.trim() ? `----- COMMENT -----\n${comment.trim()}\n\n` : "";
  const scenarioBlock = activeScenarioLabel ? `scenario: ${activeScenarioLabel}\n` : "";
  // Builder scenarios carry their share code so EVERY log is replayable:
  // paste the code into the Scenario Builder to rebuild the exact situation.
  const shareBlock = activeShareCode ? `share-code: ${activeShareCode}\n` : "";
  // #diagnostics: PARITY with the in-game "Report a bug" path - a Send-Logs capture must carry EVERYTHING
  // that path carries: the co-op control-plane snapshot AND the deterministic replay trace (previously
  // Send Logs attached only the state header + console, so a tester-filed co-op hang was NOT replayable).
  return (
    `${scenarioBlock}${shareBlock}${captureStateHeader()}\n\n${commentBlock}`
    + `${captureControlPlaneBlock()}----- CONSOLE -----\n${formatConsoleSnapshot()}\n\n${captureReplayTraceBlock()}`
  );
}

/**
 * Ship the FULL report to the remote log sink (er-editor-api → the repo's
 * `dev-logs` branch), so logs reach the maintainer's PC no matter where the
 * tester is playing. `scripts/pull-dev-logs.mjs` syncs them down locally.
 */
async function sendRemoteLog(report: string, comment: string): Promise<boolean> {
  try {
    const res = await fetch(REMOTE_LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        by: getTesterName(),
        scenario: activeScenarioLabel ?? "",
        comment,
        report,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function sendLogs(button: HTMLButtonElement, comment?: string): Promise<void> {
  const report = buildReport(comment);
  // Mirror a lightweight entry to the shared ledger so the team sees the log
  // (filed under the active scenario, or "no-scenario") even on the static
  // staging site that has no local /__devlog dev server.
  postEvent("LOG", activeScenarioLabel ?? "", comment ?? "");
  const original = button.textContent;
  let localOk = false;
  try {
    const res = await fetch("/__devlog", { method: "POST", body: report });
    localOk = res.ok;
  } catch {
    localOk = false;
  }
  // The remote sink works from ANYWHERE (staging, a tester's laptop, a phone).
  const remoteOk = await sendRemoteLog(report, comment ?? "");
  // Always also copy to clipboard + download as an offline fallback.
  try {
    await navigator.clipboard?.writeText(report);
  } catch {
    /* clipboard may be blocked; ignore */
  }
  if (!localOk && !remoteOk) {
    try {
      const blob = new Blob([report], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `er-log-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      /* download may fail in some contexts; ignore */
    }
  }
  button.textContent = remoteOk
    ? "Sent ✓ (remote + local)"
    : localOk
      ? "Sent ✓ (dev-logs/latest.log)"
      : "Copied ✓ (offline fallback)";
  setTimeout(() => {
    button.textContent = original;
  }, 1800);
}

function injectLogButton(): void {
  if (typeof document === "undefined" || document.getElementById("er-dev-log-btn")) {
    return;
  }
  const button = document.createElement("button");
  button.id = "er-dev-log-btn";
  button.textContent = "Send Logs";
  Object.assign(button.style, {
    position: "fixed",
    top: "6px",
    right: "6px",
    zIndex: "99999",
    padding: "6px 10px",
    font: "12px/1.2 monospace",
    color: "#fff",
    background: "#b3245c",
    border: "1px solid #fff",
    borderRadius: "6px",
    cursor: "pointer",
    opacity: "0.85",
  } satisfies Partial<CSSStyleDeclaration>);
  // A focused <button> is activated by Space/Enter. Those are exactly the keys the
  // player hammers in the biome market (and elsewhere) to confirm, so if this
  // button ever holds focus it re-fires the comment prompt on every keypress (the
  // reported "Send Logs triggers repeatedly"). Keep it OUT of the focus path:
  // never tab to it, never take focus on click, and drop focus immediately after.
  button.tabIndex = -1;
  button.addEventListener("mousedown", e => e.preventDefault());
  button.addEventListener("click", () => {
    button.blur();
    // Optional free-text comment captured into the report (Cancel = no comment,
    // still sends). A simple prompt is reliable and dev-only.
    const comment = window.prompt("Optional comment for this log (Cancel to skip):", "") ?? "";
    sendLogs(button, comment).catch(() => {});
  });
  document.body.appendChild(button);
}

// ---------------------------------------------------------------------------
// 2. "Dev Scenarios" main-menu entry + pass/fail tracking
// ---------------------------------------------------------------------------

/** The scenario currently loaded into the battle (for the banner + Pass/Fail). */
let activeScenarioLabel: string | null = null;

// --- Fast scenario iteration (dev-only Reset / Next / Pick) -------------------
// Testers re-run a scenario (to try different ME choices) or hop to another one
// constantly. Walking Title -> Dev Scenarios -> pick every time is far too slow,
// so the banner has Reset / Next / Pick buttons. They all use the SAME safe
// path: tear the run down to the title with the canonical globalScene.reset(true)
// (exactly what the pause menu's "Return to Title" does, so no mode-stack
// garbage), then run a staged action once the rebuilt title menu hands us a
// fresh launch ctx (see the dev-menu factory at the bottom).

/** A one-shot action to run with the fresh title ctx after a teardown. */
let pendingTitleAction: ((ctx: DevMenuCtx) => void) | null = null;

/**
 * Tear the current run down to the title (canonical reset, no page reload) and,
 * once the rebuilt title menu hands us a fresh launch ctx, run `action`. Used by
 * the dev banner's Reset / Next / Pick buttons. Dev-only.
 */
function teardownThen(action: (ctx: DevMenuCtx) => void): void {
  pendingTitleAction = action;
  scenarioBanner?.remove();
  scenarioBanner = null;
  try {
    // clearScene=true: fade out, free the UI, and re-boot into the title. The
    // dev-menu factory runs on the rebuilt title and fires pendingTitleAction.
    globalScene.reset(true);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
    console.error("[dev-tools] scenario teardown failed:", err);
    pendingTitleAction = null;
  }
}

/** The next not-yet-passed scenario after `after` (wraps; null if none remain). */
function nextUnpassedScenario(after: DevScenario | null): DevScenario | null {
  const passed = new Set(combinedPassed());
  const start = after ? DEV_SCENARIOS.findIndex(s => s.label === after.label) : -1;
  for (let step = 1; step <= DEV_SCENARIOS.length; step++) {
    const cand = DEV_SCENARIOS[(start + step) % DEV_SCENARIOS.length];
    if (cand && cand.label !== after?.label && !passed.has(cand.label)) {
      return cand;
    }
  }
  return null;
}

/**
 * Open the scenario picker cleanly after a teardown. The rebuilt title is showing
 * its OWN option-select (Continue / New Game / ... / Dev Scenarios) via
 * setMode(UiMode.TITLE). Opening the list as an overlay ON TOP of that leaves both
 * menus stacked on screen forever (the reported overlap). So switch the active
 * mode to MESSAGE first - which dismisses the title menu - exactly like the real
 * "Dev Scenarios" item does (its handler returns true to close the title select)
 * before deferring to openScenarioList.
 */
function openPickerClean(ctx: DevMenuCtx): void {
  openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openScenarioList(ctx));
}

// Passed scenarios are remembered in localStorage (ordered, most-recent LAST) so
// they DROP OUT of the picker list and survive reloads. "Undo last pass" in the
// menu pops only the most recent one (so you don't re-flood the whole list).
const PASSED_KEY = "er-dev-passed-scenarios";

function getPassed(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(PASSED_KEY) ?? "[]") as string[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function savePassed(labels: string[]): void {
  try {
    localStorage.setItem(PASSED_KEY, JSON.stringify(labels));
  } catch {
    /* storage may be blocked; ignore */
  }
}

/** Append a label as passed (most recent), ignoring duplicates. */
function addPassed(label: string): void {
  const arr = getPassed().filter(l => l !== label);
  arr.push(label);
  savePassed(arr);
}

// --- Shared cross-account/browser progress (staging save-API worker) ---------
// So the QA team doesn't re-run each other's scenarios: Pass/Fail/Send-Logs are
// mirrored to the save-API worker's /devtest endpoints, and the picker hides
// scenarios ANYONE has passed. Degrades gracefully to local-only localStorage
// when the endpoint is unset (local `pnpm start:dev`) or unreachable.
const SERVER_URL = (import.meta.env as { VITE_SERVER_URL?: string }).VITE_SERVER_URL ?? "";
const TESTLOG_BASE = SERVER_URL ? `${SERVER_URL.replace(/\/$/, "")}/devtest` : null;
const TESTER_KEY = "er-dev-tester-name";

/** Scenarios other testers (or this one, on another device) have passed. */
let remotePassed: string[] = [];

/** A free-text tester label, asked once and cached, so shared logs show who. */
function getTesterName(): string {
  try {
    let name = localStorage.getItem(TESTER_KEY);
    if (name === null) {
      name = window.prompt("Tester name for shared test logs (optional):", "") ?? "";
      localStorage.setItem(TESTER_KEY, name);
    }
    return name;
  } catch {
    return "";
  }
}

/** Pull the shared passed-set so the picker can hide team-passed scenarios. */
async function fetchRemoteProgress(): Promise<void> {
  if (!TESTLOG_BASE) {
    return;
  }
  try {
    const res = await fetch(`${TESTLOG_BASE}/progress`);
    if (!res.ok) {
      return;
    }
    const body = (await res.json()) as { passed?: unknown };
    if (Array.isArray(body.passed)) {
      remotePassed = body.passed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    /* offline / no endpoint — stay local-only */
  }
}

/** POST a shared test event (PASS/FAIL/LOG/UNPASS). Best-effort, never throws. */
function postEvent(kind: "PASS" | "FAIL" | "LOG" | "UNPASS", scenario: string, comment: string): void {
  if (!TESTLOG_BASE) {
    return;
  }
  try {
    const body = new URLSearchParams({ kind, scenario, comment, by: getTesterName() });
    fetch(`${TESTLOG_BASE}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Union of locally- and remotely-passed scenario labels. */
function combinedPassed(): string[] {
  return [...new Set([...getPassed(), ...remotePassed])];
}

/** Record a PASS/FAIL result to the dev server (dev-logs/session.log) + console. */
function postResult(kind: "PASS" | "FAIL", label: string, comment: string): void {
  const line = `TEST RESULT: ${kind} — ${label}${comment.trim() ? ` — ${comment.trim()}` : ""}`;
  // biome-ignore lint/suspicious/noConsole: dev-only status line
  console.log(`[dev-tools] ${line}`);
  try {
    fetch("/__devlog", { method: "POST", body: `${line}\n` }).catch(() => {});
  } catch {
    /* no dev server; the console line is still captured by Send Logs */
  }
  // Mirror to the shared (cross-account) ledger on the staging worker.
  postEvent(kind, label, comment);
}

/**
 * Persistent on-screen context panel (plain DOM, like the Send Logs button — so
 * it never touches the Phaser UI/mode stack). Shows the active scenario's bug +
 * what to do + what to expect, and stays visible DURING the battle, with
 * Pass / Fail / Hide buttons. Decoupling it from the game UI avoids the
 * overlay-nesting freeze.
 */
let scenarioBanner: HTMLDivElement | null = null;

function makeBannerButton(label: string, bg: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  Object.assign(b.style, {
    flex: "1",
    padding: "5px 6px",
    font: "11px/1.2 monospace",
    color: "#fff",
    background: bg,
    border: "1px solid #fff",
    borderRadius: "5px",
    cursor: "pointer",
  } satisfies Partial<CSSStyleDeclaration>);
  return b;
}

function showScenarioBanner(scenario: (typeof DEV_SCENARIOS)[number]): void {
  if (typeof document === "undefined") {
    return;
  }
  // Rebuild fresh each launch so the buttons bind to the current scenario.
  scenarioBanner?.remove();
  scenarioBanner = document.createElement("div");
  scenarioBanner.id = "er-dev-scenario-banner";
  Object.assign(scenarioBanner.style, {
    position: "fixed",
    top: "40px",
    left: "6px",
    zIndex: "99999",
    width: "320px",
    padding: "8px 10px",
    font: "12px/1.4 monospace",
    color: "#fff",
    background: "rgba(18,18,28,0.9)",
    border: "1px solid #b3245c",
    borderRadius: "6px",
  } satisfies Partial<CSSStyleDeclaration>);

  // Clickable header bar — always visible. Clicking it toggles the body, so the
  // panel COLLAPSES to this pill rather than disappearing (you can always
  // re-expand it).
  const header = document.createElement("div");
  Object.assign(header.style, { fontWeight: "bold", cursor: "pointer" } satisfies Partial<CSSStyleDeclaration>);

  const body = document.createElement("div");

  let collapsed = false;
  const renderHeader = () => {
    header.textContent = `🧪 ${scenario.label}  ${collapsed ? "▸ (show)" : "▾ (hide)"}`;
  };
  const setCollapsed = (v: boolean) => {
    collapsed = v;
    body.style.display = collapsed ? "none" : "block";
    renderHeader();
  };
  header.addEventListener("click", () => setCollapsed(!collapsed));
  scenarioBanner.appendChild(header);

  const text = document.createElement("div");
  text.style.whiteSpace = "pre-wrap";
  text.style.marginTop = "6px";
  text.textContent = scenario.description;
  body.appendChild(text);

  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "5px", marginTop: "8px" } satisfies Partial<CSSStyleDeclaration>);

  const passBtn = makeBannerButton("✓ Pass", "#1f7a3d");
  passBtn.addEventListener("click", () => {
    postResult("PASS", scenario.label, "");
    // "Passed = remove from list" — and dismiss the banner. Mirror into the
    // shared cache too so the picker hides it without waiting for a refetch.
    addPassed(scenario.label);
    if (!remotePassed.includes(scenario.label)) {
      remotePassed.push(scenario.label);
    }
    scenarioBanner?.remove();
    scenarioBanner = null;
    activeScenarioLabel = null;
  });

  const failBtn = makeBannerButton("✗ Fail", "#a32020");
  failBtn.addEventListener("click", () => {
    const why = window.prompt(`Why did "${scenario.label}" fail? (optional)`, "") ?? "";
    postResult("FAIL", scenario.label, why);
    failBtn.textContent = "✗ Logged";
  });

  const hideBtn = makeBannerButton("Collapse", "#444");
  hideBtn.addEventListener("click", () => setCollapsed(true));

  row.append(passBtn, failBtn, hideBtn);
  body.appendChild(row);

  // Second row: fast scenario iteration (dev-only). All three tear the run down
  // to the title and immediately do the next thing - no manual menu walking.
  // The share code is captured now so a Reset keeps the log replayable.
  const shareCode = activeShareCode;
  const navRow = document.createElement("div");
  Object.assign(navRow.style, { display: "flex", gap: "5px", marginTop: "5px" } satisfies Partial<CSSStyleDeclaration>);

  const resetBtn = makeBannerButton("↻ Reset", "#2b6cb0");
  resetBtn.title = "Re-run THIS scenario from the start";
  resetBtn.addEventListener("click", () =>
    teardownThen(ctx => {
      launchScenario(ctx, scenario);
      activeShareCode = shareCode; // launchScenario doesn't touch it; keep logs replayable
    }),
  );

  const nextBtn = makeBannerButton("⏭ Next", "#6b46c1");
  nextBtn.title = "Jump to the next not-yet-passed scenario";
  nextBtn.addEventListener("click", () =>
    teardownThen(ctx => {
      const nxt = nextUnpassedScenario(scenario);
      if (nxt) {
        activeShareCode = null;
        launchScenario(ctx, nxt);
      } else {
        openPickerClean(ctx); // all passed -> let the tester reset/pick
      }
    }),
  );

  const pickBtn = makeBannerButton("☰ Pick", "#444");
  pickBtn.title = "Open the scenario picker to choose any scenario";
  pickBtn.addEventListener("click", () => teardownThen(ctx => openPickerClean(ctx)));

  navRow.append(resetBtn, nextBtn, pickBtn);
  body.appendChild(navRow);

  scenarioBanner.appendChild(body);
  setCollapsed(false);
  document.body.appendChild(scenarioBanner);
}

/** Launch the chosen scenario (party + overrides + optional mid-combat + banner). */
function launchScenario(ctx: DevMenuCtx, scenario: DevScenario): boolean {
  try {
    const starters = scenario.setup();
    setPendingDevStarters(starters);
    if (scenario.startingLevels) {
      setPendingDevStarterLevels(scenario.startingLevels);
    }
    if (scenario.onPartyReady) {
      setPendingDevPartySetup(scenario.onPartyReady);
    }
    if (scenario.onBattleStart) {
      setPendingDevBattleSetup(scenario.onBattleStart);
    }
    if (scenario.shopItems && scenario.shopItems.length > 0) {
      // Guarantee these reward options in the first shop after the opening battle
      // ("start in the store, test a specific item").
      setPendingDevShop(scenario.shopItems);
    }
    activeScenarioLabel = scenario.label;
    showScenarioBanner(scenario);
    ctx.startRunWithMode(scenario.gameMode ?? GameModes.CLASSIC);
    scenario.postLaunch?.();
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
    console.error("[dev-tools] scenario launch failed:", err);
    globalScene.ui.playError?.();
    return false;
  }
  return true;
}

/** Max characters shown for a picker option label (keeps the auto-sized
 * OPTION_SELECT window comfortably within the screen width). */
const MAX_PICKER_LABEL = 30;

/** Truncate a long scenario label so the picker window stays on-screen. */
function clampLabel(label: string): string {
  return label.length > MAX_PICKER_LABEL ? `${label.slice(0, MAX_PICKER_LABEL - 1)}…` : label;
}

/**
 * The scenario picker — a SINGLE option-select (no nested overlay; nesting one
 * over another and then starting a run tangled the mode stack and froze the
 * battle). Already-PASSED scenarios are filtered out. Selecting an entry
 * launches it immediately; the banner carries the bug context into the battle.
 * Deferring the open via showText keeps the selecting keypress from bleeding
 * into the freshly-opened list.
 */
function openScenarioList(ctx: DevMenuCtx): void {
  // Hide scenarios passed by ANYONE on the team (local + shared remote set).
  const passedSet = new Set(combinedPassed());
  const remaining = DEV_SCENARIOS.filter(s => !passedSet.has(s.label));
  const localPassed = getPassed();

  const options = [
    {
      // The scenario BUILDER: compose any situation (party/enemy/run/items/
      // stages) in a form, launch it, and share it as a copy-paste code.
      label: "🧪 Scenario Builder",
      handler: () => {
        openScenarioBuilder({
          launch: scenario => launchScenario(ctx, scenario),
          setShareCode: code => {
            activeShareCode = code;
          },
          // Closing the form re-opens this picker so the game keeps a live UI
          // mode (otherwise: modeless softlock).
          closeMenu: () => openScenarioList(ctx),
        });
        return true;
      },
    },
    {
      // Battle-test a staff-authored CUSTOM TRAINER (er-custom-trainers.json):
      // pick one from the list and drop straight into a forced battle against it
      // with the full resolved feature set. Sits directly under the builder.
      label: "\u{1F464} Custom Trainers",
      handler: () => {
        // Opened from INSIDE this OPTION_SELECT: collapse to MESSAGE first, else
        // setOverlayMode(OPTION_SELECT) is a no-op and the list never shows (#937).
        openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openCustomTrainerList(ctx));
        return true;
      },
    },
    ...remaining.map(scenario => ({
      // Clamp the displayed label: the OPTION_SELECT window auto-sizes to its
      // WIDEST option, so one long label blew the picker off the screen edges.
      label: clampLabel(scenario.label),
      handler: () => {
        activeShareCode = null; // hand-written scenario: no share code
        return launchScenario(ctx, scenario);
      },
    })),
  ];
  if (localPassed.length > 0) {
    // Undo ONLY the most recently passed test (pop the last LOCAL one) so the
    // whole passed list isn't dumped back in at once. Also un-pass it on the
    // shared ledger so it reappears for the team too.
    const last = localPassed.at(-1) ?? "";
    options.push({
      label: `↺ Undo last pass: ${last}`,
      handler: () => {
        savePassed(localPassed.slice(0, -1));
        remotePassed = remotePassed.filter(l => l !== last);
        postEvent("UNPASS", last, "");
        openScenarioList(ctx);
        return true;
      },
    });
  }
  options.push({
    label: "Cancel",
    handler: () => {
      // The scenario list is opened with `setOverlayMode`, which pushes the
      // previous mode onto the UI mode CHAIN. `toTitleScreen()` alone rebuilds
      // the title but never unwinds that chain, so the stale overlay handler
      // keeps eating input -> "can't move / locked when going back". Reset the
      // chain first; the fresh TitlePhase then transitions cleanly from the
      // (cleared) OPTION_SELECT mode to TITLE.
      globalScene.ui.resetModeChain();
      globalScene.phaseManager.toTitleScreen();
      return true;
    },
  });
  const header =
    remaining.length > 0
      ? `Select a dev scenario (${remaining.length} left)`
      : "All scenarios passed! Reset to re-run.";
  // Keep the visible window short so the box fits the screen; the list scrolls
  // (up/down arrows) when there are more entries than this.
  globalScene.ui.showText(header, null, () =>
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options, maxOptions: 6 }),
  );
}

/** Max chars for a custom-trainer picker row (a touch wider than a scenario label
 * to fit the `Name #id: species` summary; still narrow enough to stay on-screen). */
const MAX_CUSTOM_TRAINER_LABEL = 44;

/** Truncate a long custom-trainer summary so the sub-list window stays on-screen. */
function clampCustomTrainerLabel(label: string): string {
  return label.length > MAX_CUSTOM_TRAINER_LABEL ? `${label.slice(0, MAX_CUSTOM_TRAINER_LABEL - 1)}…` : label;
}

/**
 * The CUSTOM TRAINERS sub-list (opened from the "Custom Trainers" entry at the top
 * of the picker, under the Scenario Builder). One row per RESOLVED authored
 * trainer (name, #id, first species). Picking one opens a small action menu
 * (Fight / Use as my team). Empty state shows a single "(no custom trainers
 * authored yet)" line. Same single-OPTION_SELECT + scroll behavior as the list.
 */
function openCustomTrainerList(ctx: DevMenuCtx): void {
  const trainers = getErCustomTrainers();
  const options: { label: string; handler: () => boolean }[] = [];
  if (trainers.length === 0) {
    options.push({
      label: "(no custom trainers authored yet)",
      handler: () => {
        // A no-op selection just re-opens this list; the tester can then go Back.
        openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openCustomTrainerList(ctx));
        return true;
      },
    });
  } else {
    for (const trainer of trainers) {
      const summary = summarizeErCustomTrainer(trainer, id => getPokemonSpecies(id)?.name ?? `#${id}`);
      options.push({
        label: clampCustomTrainerLabel(summary),
        handler: () => {
          // Nested OPTION_SELECT -> collapse to MESSAGE first (see openDevMenuOverlay).
          openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openCustomTrainerActions(ctx, trainer));
          return true;
        },
      });
    }
  }
  options.push({
    // Back to the main scenario picker (keeps a live UI mode - no modeless softlock).
    label: "Back",
    handler: () => {
      openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openScenarioList(ctx));
      return true;
    },
  });
  const header =
    trainers.length > 0 ? `Select a custom trainer (${trainers.length})` : "No custom trainers authored yet";
  globalScene.ui.showText(header, null, () =>
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options, maxOptions: 6 }),
  );
}

/**
 * The per-trainer action menu: FIGHT the trainer (forced battle against it) or USE
 * AS MY TEAM (drop into a normal battle with the authored party as YOUR team - a
 * fast way into a fight without hand-picking starters).
 */
function openCustomTrainerActions(ctx: DevMenuCtx, trainer: ErCustomTrainerResolved): void {
  const range = trainer.endless ? `${trainer.minWave}+` : `${trainer.minWave}-${trainer.maxWave}`;
  const options = [
    {
      label: "⚔ Fight with random ghost team",
      handler: () => {
        openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => launchCustomTrainer(ctx, trainer));
        return true;
      },
    },
    {
      label: "👥 Use as my team",
      handler: () => {
        activeShareCode = null;
        return launchScenario(ctx, buildErCustomTrainerTeamScenario(trainer));
      },
    },
    {
      label: "Back",
      handler: () => {
        openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openCustomTrainerList(ctx));
        return true;
      },
    },
  ];
  const heading = `${trainer.name} #${trainer.id} | waves ${range} | ${trainer.difficulties.join(", ")}`;
  globalScene.ui.showText(heading, null, () => globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options }));
}

/** Only the newest in-flight ghost lookup may change the menu or launch a run. */
let customTrainerLoadToken = 0;
const CUSTOM_TRAINER_GHOST_TIMEOUT_MS = 12_000;

async function sampleCustomTrainerGhosts(
  difficulty: Parameters<typeof sampleGhostSnapshots>[0],
  wave: number,
): Promise<Awaited<ReturnType<typeof sampleGhostSnapshots>>> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      sampleGhostSnapshots(difficulty, 20, wave),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("ghost lookup timed out")), CUSTOM_TRAINER_GHOST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/** Loading menu with a real Cancel path; avoids a modeless wait-screen softlock. */
function showCustomTrainerLoading(
  ctx: DevMenuCtx,
  trainer: ErCustomTrainerResolved,
  wave: number,
  token: number,
): void {
  globalScene.ui.showText(`Finding a real ghost team for wave ${wave}...`, null, () =>
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, {
      options: [
        {
          label: "Cancel",
          handler: () => {
            if (customTrainerLoadToken === token) {
              customTrainerLoadToken++;
            }
            openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openCustomTrainerActions(ctx, trainer));
            return true;
          },
        },
      ],
    }),
  );
}

/** Recoverable lookup/build error with both retry and backward navigation. */
function showCustomTrainerLaunchError(ctx: DevMenuCtx, trainer: ErCustomTrainerResolved, message: string): void {
  globalScene.ui.showText(`Can't launch ${trainer.name}: ${message}`, null, () =>
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, {
      options: [
        {
          label: "Retry (reroll wave + team)",
          handler: () => {
            openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => launchCustomTrainer(ctx, trainer));
            return true;
          },
        },
        {
          label: "Back",
          handler: () => {
            openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => openCustomTrainerActions(ctx, trainer));
            return true;
          },
        },
      ],
    }),
  );
}

/**
 * Prepare and launch a forced battle against `trainer`: random eligible wave,
 * real wave-compatible ghost party, and stored challenge settings when present.
 */
function launchCustomTrainer(ctx: DevMenuCtx, trainer: ErCustomTrainerResolved): void {
  const mode = getGameMode(GameModes.CLASSIC);
  const plan = planErCustomTrainerLaunch(trainer, wave => mode.isFixedBattle(wave));
  if (!plan.ok) {
    showCustomTrainerLaunchError(ctx, trainer, plan.reason);
    return;
  }
  const token = ++customTrainerLoadToken;
  showCustomTrainerLoading(ctx, trainer, plan.plan.wave, token);
  sampleCustomTrainerGhosts(plan.plan.difficulty, plan.plan.wave)
    .then(snapshots => {
      if (customTrainerLoadToken !== token) {
        return;
      }
      const picked = pickErCustomTrainerGhost(snapshots, plan.plan.wave, plan.plan.difficulty);
      if (!picked) {
        throw new Error(`no legal ghost run reached wave ${plan.plan.wave} within the +40 fairness window`);
      }
      const built = buildErCustomTrainerDevScenario(trainer, {
        plan: plan.plan,
        ghost: picked.ghost,
        candidateCount: picked.candidateCount,
      });
      if ("error" in built) {
        throw new Error(built.error);
      }
      activeShareCode = null;
      if (!launchScenario(ctx, built.scenario)) {
        throw new Error("the prepared run failed to start; retry to rebuild it");
      }
    })
    .catch(error => {
      if (customTrainerLoadToken !== token) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      openDevMenuOverlay(globalScene.ui, UiMode.MESSAGE, () => showCustomTrainerLaunchError(ctx, trainer, message));
    });
}

// ---------------------------------------------------------------------------
// Boot: register everything on import.
// ---------------------------------------------------------------------------

injectLogButton();

// Pull the team's shared passed-set early so the picker hides already-done
// scenarios as soon as the player opens the Dev Scenarios menu. Best-effort.
fetchRemoteProgress().catch(() => {});

registerDevMenu(ctx => {
  // This factory runs every time the TITLE menu is built - i.e. whenever the
  // player is back at the title screen, the previous scenario (if any) is over.
  // Scrub ALL scenario state here so a NORMAL run started from the title is
  // clean: without this, the last scenario's Overrides (pinned enemy species/
  // level, starting wave, movesets) leaked into real runs, which looked like
  // "new game dropped me into the old scenario save at Lv50".
  resetDevOverrides();
  consumePendingDevStarters();
  consumePendingDevStarterLevels();
  consumePendingDevPartySetup();
  consumePendingDevBattleSetup();
  consumePendingDevShop();
  consumePendingDevEnemyParty();
  consumePendingDevCustomTrainerForce();
  scenarioBanner?.remove();
  scenarioBanner = null;
  activeScenarioLabel = null;
  activeShareCode = null;
  // Invalidate any ghost lookup whose loading menu was abandoned by a title reset.
  customTrainerLoadToken++;
  // Clear any armed custom-trainer dev force so a picked-but-not-fought trainer (or
  // one whose battle is over) never leaks into a NORMAL run started from the title.
  // A fought forced trainer already self-clears on install; this covers backing out.
  setErCustomTrainerDevForce(null);
  // Fast-iteration handoff: if the banner's Reset / Next / Pick button tore the
  // run down (teardownThen), run the staged action now that we have a FRESH
  // title launch ctx. Deferred so the title menu is fully built first; this is
  // the same ctx the user would get by manually opening Dev Scenarios.
  if (pendingTitleAction) {
    const action = pendingTitleAction;
    pendingTitleAction = null;
    setTimeout(() => {
      try {
        action(ctx);
      } catch (err) {
        // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
        console.error("[dev-tools] staged scenario relaunch failed:", err);
      }
    }, 0);
  }
  return {
    label: "\u{1F6E0} Dev Scenarios",
    handler: () => {
      // No keepOpen — mirror the New Game item: return true to close the title
      // menu, and the deferred showText callback opens the scenario list.
      // REFRESH the shared passed-set first (one tiny GET per menu open) so a
      // teammate's passes hide scenarios WITHOUT requiring a page reload; offline
      // or fetch failure just opens with the cached/local state.
      fetchRemoteProgress()
        .catch(() => {})
        .finally(() => openScenarioList(ctx));
      return true;
    },
  };
});

// biome-ignore lint/suspicious/noConsole: dev-only status line
console.log(`[dev-tools] loaded — ${DEV_SCENARIOS.length} scenarios + Send Logs button`);
