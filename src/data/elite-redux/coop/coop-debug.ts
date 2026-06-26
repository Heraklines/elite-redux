/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Co-op debug logging (#633). A SINGLE, gated logger for ALL co-op logic so live desyncs are
 * traceable in the field - two real clients have no shared debugger, so verbose, categorized
 * logging is our only window into what each side is doing.
 *
 * TURN IT ALL OFF FOR A PROD SHIP: set {@linkcode COOP_DEBUG_DEFAULT} to `false` below. That is the
 * ONE place - flip it and every coopLog / coopWarn across the co-op code goes silent (so heavy
 * logging can never ride into a release).
 *
 * RUNTIME OVERRIDE (no rebuild - for toggling on staging or a tester's console):
 *  - URL param:      ?coopdebug=1  (force on)  /  ?coopdebug=0  (force off)
 *  - localStorage:   coopDebug = "1" | "0"
 *  - browser console: coopDebug(true) / coopDebug(false)   (a global helper is installed)
 * Precedence: URL param > localStorage > COOP_DEBUG_DEFAULT.
 *
 * CHEAPNESS: every entry point early-returns on the flag BEFORE doing any formatting, so a disabled
 * logger is a single boolean check. In genuinely hot paths (per transport message, per battle event)
 * guard the CALL SITE with `if (isCoopDebug())` so the argument strings are not built either.
 */

/** The ONE master switch. Set to `false` before a production release to silence all co-op logging. */
const COOP_DEBUG_DEFAULT = true;

declare global {
  // eslint-disable-next-line no-var
  var coopDebug: ((on: boolean) => void) | undefined;
}

function readInitialEnabled(): boolean {
  try {
    const loc = (globalThis as { location?: { search?: string } }).location;
    if (loc?.search) {
      const q = new URLSearchParams(loc.search).get("coopdebug");
      if (q === "1" || q === "true") {
        return true;
      }
      if (q === "0" || q === "false") {
        return false;
      }
    }
    const ls = (globalThis as { localStorage?: Storage }).localStorage?.getItem("coopDebug");
    if (ls === "1") {
      return true;
    }
    if (ls === "0") {
      return false;
    }
  } catch {
    // headless / SSR / no DOM: fall through to the compile default.
  }
  return COOP_DEBUG_DEFAULT;
}

let enabled = readInitialEnabled();

/** Whether verbose co-op debug logging is currently on. Guard hot call sites with this. */
export function isCoopDebug(): boolean {
  return enabled;
}

/** Toggle co-op debug logging at runtime; persists to localStorage so it survives a reload. */
export function setCoopDebug(on: boolean): void {
  enabled = on;
  try {
    (globalThis as { localStorage?: Storage }).localStorage?.setItem("coopDebug", on ? "1" : "0");
  } catch {
    // no DOM storage: in-memory toggle only.
  }
  // This one line is intentionally NOT gated so the operator always sees the toggle take effect.
  console.log(`[coop] debug logging ${on ? "ENABLED" : "DISABLED"}`);
}

function format(category: string, msg: string): string {
  return `[coop:${category}] ${msg}`;
}

/** Gated LOG-level co-op trace. `category` groups a subsystem (e.g. "interaction", "relay", "me"). */
export function coopLog(category: string, msg: string, data?: unknown): void {
  if (!enabled) {
    return;
  }
  if (data === undefined) {
    console.log(format(category, msg));
  } else {
    console.log(format(category, msg), data);
  }
}

/** Gated WARN-level co-op trace (divergence / unexpected-but-handled). Same single switch. */
export function coopWarn(category: string, msg: string, data?: unknown): void {
  if (!enabled) {
    return;
  }
  if (data === undefined) {
    console.warn(format(category, msg));
  } else {
    console.warn(format(category, msg), data);
  }
}

// Install a console helper so a tester can flip logging live: `coopDebug(true)` / `coopDebug(false)`.
try {
  globalThis.coopDebug = setCoopDebug;
} catch {
  // no global object to attach to (extremely defensive): ignore.
}
