/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — auto-reload on new version.
//
// The service worker is disabled (see index.html), so players who leave the tab
// open never pick up a new deploy until they manually refresh — which is exactly
// why fixes to Ace/Elite/Hell etc. appeared "missing" for people running stale
// bundles. This poller closes that gap WITHOUT touching saves:
//
//   - The running bundle knows its own build id (`__BUILD_ID__`, baked in by
//     build-id-plugin).
//   - It periodically fetches the tiny `/version.json` (~40 bytes, served by
//     Cloudflare Pages — static, unlimited on the free tier; NO Worker, so no
//     quota cost) with `cache: "no-store"`.
//   - When the served build id differs, a newer deploy is live -> reload.
//
// Reloading is data-safe: all progress lives in localStorage and the active run
// is autosaved, so the run resumes exactly where it was after the reload. The
// reload simply re-fetches the (no-cache) index.html, which points at the new
// hashed bundles.
//
// To avoid yanking the canvas out from under someone mid-battle, the reload is
// scheduled politely: if the tab is hidden we reload immediately (zero
// disruption); otherwise we show a small banner and reload after a short grace
// period, or as soon as the player switches away — whichever comes first.
// =============================================================================

import { IS_TEST, isApp, isBeta, isDev } from "#constants/app-constants";
import { getErBuildIdentity } from "#utils/build-identity";

/** How often to poll for a newer build while the tab is open. */
const POLL_INTERVAL_MS = 5 * 60 * 1000;
/** Grace period before an automatic reload once a new build is detected. */
const RELOAD_GRACE_MS = 20 * 1000;

let started = false;
/** Set once a newer build has been detected, so we act on it only once. */
let updateHandled = false;

/** The build id this running bundle was compiled from. */
function runningBuildId(): string | undefined {
  // `__BUILD_ID__` is a compile-time define; guard in case it's ever absent.
  return typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : undefined;
}

/** Fetch the deployed build id from the static sidecar, or undefined on failure. */
async function fetchDeployedBuildId(): Promise<string | undefined> {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) {
      return;
    }
    const data: unknown = await res.json();
    const build = (data as { build?: unknown } | null)?.build;
    return typeof build === "string" ? build : undefined;
  } catch {
    // Offline / transient network error — try again on the next tick.
    return;
  }
}

/** Reload the page so the new (no-cache) index.html + hashed bundles load. */
function doReload(): void {
  window.location.reload();
}

/** A minimal, dependency-free DOM banner announcing the pending reload. */
function showUpdateBanner(onReloadNow: () => void): void {
  if (document.getElementById("er-update-banner")) {
    return;
  }
  const banner = document.createElement("div");
  banner.id = "er-update-banner";
  banner.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:16px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "background:#1b1b2f",
    "color:#fff",
    "border:1px solid #4f86ff",
    "border-radius:8px",
    "padding:10px 14px",
    "font:14px/1.3 sans-serif",
    "box-shadow:0 4px 16px rgba(0,0,0,0.5)",
    "display:flex",
    "gap:12px",
    "align-items:center",
    "max-width:90vw",
  ].join(";");

  const text = document.createElement("span");
  text.textContent = "A new version of Elite Redux is available — updating…";
  const button = document.createElement("button");
  button.textContent = "Update now";
  button.style.cssText = [
    "background:#4f86ff",
    "color:#fff",
    "border:0",
    "border-radius:6px",
    "padding:6px 10px",
    "cursor:pointer",
    "font:600 13px sans-serif",
  ].join(";");
  button.addEventListener("click", onReloadNow);

  banner.appendChild(text);
  banner.appendChild(button);
  document.body.appendChild(banner);
}

/** Act on a detected new build, once: reload at a non-disruptive moment. */
function handleUpdateAvailable(): void {
  if (updateHandled) {
    return;
  }
  updateHandled = true;

  // Tab is in the background: reload right now — the player won't even notice.
  if (document.hidden) {
    doReload();
    return;
  }

  // Visible: show a banner, then reload after a short grace period, OR as soon
  // as the player switches tabs (whichever comes first).
  showUpdateBanner(doReload);
  const timer = window.setTimeout(doReload, RELOAD_GRACE_MS);
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.hidden) {
        window.clearTimeout(timer);
        doReload();
      }
    },
    { once: true },
  );
}

/** Poll once: compare deployed build to the running build. */
async function checkOnce(): Promise<void> {
  if (updateHandled) {
    return;
  }
  const running = runningBuildId();
  if (!running) {
    return; // Unknown running build — can't compare safely.
  }
  const deployed = await fetchDeployedBuildId();
  if (deployed && deployed !== running) {
    handleUpdateAvailable();
  }
}

/**
 * Start polling for new deploys. No-op in dev/test/app builds (the sidecar
 * `version.json` only exists for the deployed web build) and idempotent.
 */
export function startUpdateChecker(): void {
  if (started || isDev || IS_TEST || isApp) {
    return;
  }
  // Run on beta + production web builds. (isBeta is referenced so the intent —
  // "deployed web builds only" — is explicit and tree-shaking-stable.)
  void isBeta;
  started = true;

  // ER (#431): announce the running build in the console so every captured
  // log (incl. the in-game Send Logs ring buffer) carries the build id -
  // stale-bundle reports become identifiable at a glance.
  // biome-ignore lint/suspicious/noConsole: intentional diagnostic breadcrumb
  console.log(`[ER] build ${JSON.stringify(getErBuildIdentity())}`);

  window.setInterval(() => void checkOnce(), POLL_INTERVAL_MS);
  // Also check the moment the player returns to the tab — that's both the most
  // likely time a new build shipped while they were away and the least
  // disruptive moment to swap.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      void checkOnce();
    }
  });
  // And once shortly after boot, so a long-idle open tab catches up quickly.
  window.setTimeout(() => void checkOnce(), 15 * 1000);
}
