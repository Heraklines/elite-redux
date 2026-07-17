/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — boot diagnostics for iOS/mobile stability triage (#ios-stability).
//
// Two things a crash report needs but our captures did not have:
//   1. A DEVICE fingerprint (userAgent / platform / screen + devicePixelRatio /
//      navigator.deviceMemory) — iOS crashes happen before any in-game logging and
//      our logs never recorded which device it was.
//   2. A boot-MILESTONE breadcrumb trail (boot-start / loading-complete /
//      title-shown), PERSISTED to localStorage, so that when a page dies during
//      boot (the iOS jetsam / WebGL-context class) and the player RELOADS, the next
//      report can say "lastSession: crashed after <milestone>". Without persistence
//      a crash-before-title leaves nothing to triage.
//
// Everything is feature-detected and try/caught: this must never itself break boot,
// and must degrade cleanly in private-mode (localStorage throws), headless (no
// window/navigator), or quota-exceeded conditions.
// =============================================================================

/** localStorage key holding the CURRENT session's milestone trail (read back next boot). */
const STORAGE_KEY = "er-boot-milestones";

/** Ordered boot checkpoints. A session that never records `title-shown` died during boot. */
export type BootMilestone = "boot-start" | "loading-complete" | "title-shown";

interface MilestoneRecord {
  /** Which checkpoint. */
  name: BootMilestone;
  /** Wall-clock time (ms since epoch) the checkpoint was reached. */
  at: number;
  /** ms since `boot-start` of THIS session (monotonic; the useful number for triage). */
  sinceStartMs: number;
}

interface StoredSession {
  startedAt: number;
  milestones: MilestoneRecord[];
}

/** `navigator.deviceMemory` is an experimental field absent from lib.dom — widen without `any`. */
interface NavigatorWithMemory extends Navigator {
  deviceMemory?: number;
}

/** A device fingerprint captured at report time. All fields degrade to a safe default. */
export interface DeviceInfo {
  userAgent: string;
  platform: string;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
  /** GB of RAM per `navigator.deviceMemory`, or `null` when the browser does not expose it (Safari). */
  deviceMemory: number | null;
  language: string;
}

let bootStartPerf = 0;
let current: StoredSession | null = null;
/** Verdict about the PREVIOUS session, computed once at init from the persisted trail. */
let previousVerdict = "";
let initialized = false;

function safePerfNow(): number {
  try {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  } catch {
    return Date.now();
  }
}

function safeGetItem(): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  } catch {
    // localStorage getter itself throws in some privacy modes.
    return null;
  }
}

function safeSetItem(value: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, value);
    }
  } catch {
    // Private-mode throw / quota exceeded — diagnostics are best-effort, never fatal.
  }
}

/** Read the PREVIOUS session's persisted trail and derive its verdict, BEFORE we overwrite it. */
function readPreviousSession(): void {
  const raw = safeGetItem();
  if (!raw) {
    previousVerdict = "";
    return;
  }
  try {
    const prev = JSON.parse(raw) as StoredSession;
    const milestones = Array.isArray(prev?.milestones) ? prev.milestones : [];
    if (milestones.some(m => m?.name === "title-shown")) {
      previousVerdict = "ok (reached title)";
    } else if (milestones.length > 0) {
      previousVerdict = `crashed after ${milestones[milestones.length - 1]?.name ?? "boot-start"}`;
    } else {
      previousVerdict = "crashed before boot-start";
    }
  } catch {
    previousVerdict = "";
  }
}

/**
 * Initialize boot diagnostics: capture the previous session's verdict, then start a fresh trail
 * with `boot-start`. Idempotent. Call as early as possible in boot (main.ts).
 */
export function initBootDiagnostics(): void {
  if (initialized) {
    return;
  }
  initialized = true;
  try {
    readPreviousSession(); // capture last session BEFORE overwriting the key
    bootStartPerf = safePerfNow();
    current = { startedAt: Date.now(), milestones: [] };
    markBootMilestone("boot-start");
  } catch {
    // never let diagnostics break boot
  }
}

/**
 * Record a boot checkpoint (once each) and persist the running trail so a crash-then-reload can
 * report where the previous session died. Never throws.
 */
export function markBootMilestone(name: BootMilestone): void {
  try {
    if (!initialized) {
      initBootDiagnostics(); // defensive: a mark before init bootstraps the session
    }
    if (!current || current.milestones.some(m => m.name === name)) {
      return;
    }
    current.milestones.push({
      name,
      at: Date.now(),
      sinceStartMs: Math.round(safePerfNow() - bootStartPerf),
    });
    safeSetItem(JSON.stringify(current));
  } catch {
    // best-effort; a diagnostics failure must not affect gameplay
  }
}

/** Capture a device fingerprint for a report. Guards every field. */
export function captureDeviceInfo(): DeviceInfo {
  const nav: NavigatorWithMemory | undefined = typeof navigator !== "undefined" ? navigator : undefined;
  const scr = typeof screen !== "undefined" ? screen : undefined;
  const dpr =
    typeof window !== "undefined" && typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1;
  return {
    userAgent: nav?.userAgent ?? "",
    platform: nav?.platform ?? "",
    screenWidth: scr?.width ?? 0,
    screenHeight: scr?.height ?? 0,
    devicePixelRatio: dpr,
    deviceMemory: typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null,
    language: nav?.language ?? "",
  };
}

/** The current session's milestone trail (defensive copy). */
export function getBootMilestones(): MilestoneRecord[] {
  return current ? [...current.milestones] : [];
}

/** The previous session's verdict ("ok…", "crashed after …", or "" when unknown / first load). */
export function getLastSessionVerdict(): string {
  return previousVerdict;
}

/**
 * Render the device + boot-milestone block for a Send-Logs / bug-report header. Multi-line, no
 * trailing newline. Always returns a string (falls back to "?" fields), so callers can inline it.
 */
export function formatBootDiagnostics(): string {
  const d = captureDeviceInfo();
  const mem = d.deviceMemory != null ? `${d.deviceMemory} GB` : "?";
  const trail = current && current.milestones.length > 0
    ? current.milestones.map(m => `${m.name}@${m.sinceStartMs}ms`).join(" -> ")
    : "(none)";
  const last = previousVerdict || "n/a (first load / storage blocked)";
  return [
    `platform: ${d.platform || "?"}`,
    `screen:   ${d.screenWidth}x${d.screenHeight} @${d.devicePixelRatio}x  devmem:${mem}`,
    `boot:     ${trail}`,
    `lastSess: ${last}`,
  ].join("\n");
}
