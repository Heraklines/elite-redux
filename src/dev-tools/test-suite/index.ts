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
 * Edit freely — none of this ships to players.
 */

import {
  type DevMenuCtx,
  registerDevMenu,
  setPendingDevBattleSetup,
  setPendingDevStarters,
} from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { formatConsoleSnapshot } from "#utils/console-ring-buffer";
import { DEV_SCENARIOS } from "./scenarios";

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
    return [
      `url:      ${location.href}`,
      `mode:     ${s?.gameMode?.modeId ?? "?"}  wave:${s?.currentBattle?.waveIndex ?? "?"}`,
      `seed:     ${s?.seed ?? "?"}`,
      `party:    ${party}`,
      `enemy:    ${enemy}`,
    ].join("\n");
  } catch (err) {
    return `state capture failed: ${String(err)}`;
  }
}

function buildReport(comment?: string): string {
  const commentBlock = comment?.trim() ? `----- COMMENT -----\n${comment.trim()}\n\n` : "";
  const scenarioBlock = activeScenarioLabel ? `scenario: ${activeScenarioLabel}\n` : "";
  return `${scenarioBlock}${captureStateHeader()}\n\n${commentBlock}----- CONSOLE -----\n${formatConsoleSnapshot()}\n`;
}

async function sendLogs(button: HTMLButtonElement, comment?: string): Promise<void> {
  const report = buildReport(comment);
  // Mirror a lightweight entry to the shared ledger so the team sees the log
  // (filed under the active scenario, or "no-scenario") even on the static
  // staging site that has no local /__devlog dev server.
  postEvent("LOG", activeScenarioLabel ?? "", comment ?? "");
  const original = button.textContent;
  let ok = false;
  try {
    const res = await fetch("/__devlog", { method: "POST", body: report });
    ok = res.ok;
  } catch {
    ok = false;
  }
  // Always also copy to clipboard + download as an offline fallback.
  try {
    await navigator.clipboard?.writeText(report);
  } catch {
    /* clipboard may be blocked; ignore */
  }
  if (!ok) {
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
  button.textContent = ok ? "Sent ✓ (dev-logs/latest.log)" : "Copied ✓ (no dev server)";
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
  button.addEventListener("click", () => {
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
  scenarioBanner.appendChild(body);
  setCollapsed(false);
  document.body.appendChild(scenarioBanner);
}

/** Launch the chosen scenario (party + overrides + optional mid-combat + banner). */
function launchScenario(ctx: DevMenuCtx, scenario: (typeof DEV_SCENARIOS)[number]): boolean {
  try {
    const starters = scenario.setup();
    setPendingDevStarters(starters);
    if (scenario.onBattleStart) {
      setPendingDevBattleSetup(scenario.onBattleStart);
    }
    activeScenarioLabel = scenario.label;
    showScenarioBanner(scenario);
    ctx.startRunWithMode(GameModes.CLASSIC);
  } catch (err) {
    // biome-ignore lint/suspicious/noConsole: dev-only diagnostic
    console.error("[dev-tools] scenario launch failed:", err);
    globalScene.ui.playError?.();
    return false;
  }
  return true;
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

  const options = remaining.map(scenario => ({
    label: scenario.label,
    handler: () => launchScenario(ctx, scenario),
  }));
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
      // Back to a fresh title screen (mirrors the New Game submenu's cancel).
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

// ---------------------------------------------------------------------------
// Boot: register everything on import.
// ---------------------------------------------------------------------------

injectLogButton();

// Pull the team's shared passed-set early so the picker hides already-done
// scenarios as soon as the player opens the Dev Scenarios menu. Best-effort.
fetchRemoteProgress().catch(() => {});

registerDevMenu(ctx => ({
  label: "\u{1F6E0} Dev Scenarios",
  handler: () => {
    // No keepOpen — mirror the New Game item: return true to close the title
    // menu, and the deferred showText callback opens the scenario list.
    openScenarioList(ctx);
    return true;
  },
}));

// biome-ignore lint/suspicious/noConsole: dev-only status line
console.log(`[dev-tools] loaded — ${DEV_SCENARIOS.length} scenarios + Send Logs button`);
