/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Lightweight in-memory console ring buffer (for the in-game bug reporter).
//
// Patches console.log / warn / error / debug on import so that recent output is
// retained in a bounded buffer. The original console methods are always still
// called, so normal logging is unaffected. Importing this module for its side
// effect (as early as possible in boot — see src/main.ts) is all that's needed.
//
// Kept deliberately tiny and dependency-free so it is safe to load before the
// rest of the app initialises.
// =============================================================================

/**
 * Maximum number of retained log lines (oldest are dropped first).
 *
 * Sized for CO-OP triage (#diagnostics): verbose co-op logging is ON by default (see
 * `coop-debug.ts` `COOP_DEBUG_DEFAULT`), so a live session emits many lines/second (per-transport
 * frame, per-battle-event, the 30s health line). At the old 250-line cap the INITIATING event of a
 * hang scrolled out of the buffer within seconds, so a "Report a bug" / "Send Logs" capture taken
 * once the player noticed the freeze no longer contained the cause. 2000 lines keeps roughly a
 * minute+ of that verbose stream so the trigger survives to triage. Cost is memory-only and small:
 * each entry is capped at {@linkcode MAX_LINE_CHARS} and lines are typically short, so the buffer is
 * well under a couple hundred KB even when full - it is never serialized except in a report.
 */
const LIMIT = 2000;

/** Max characters kept per line, to bound a single huge log entry. */
const MAX_LINE_CHARS = 2000;

export interface ConsoleLogEntry {
  level: "log" | "warn" | "error" | "debug";
  /** ms since epoch. */
  ts: number;
  message: string;
}

const buffer: ConsoleLogEntry[] = [];
let installed = false;

function stringifyArg(arg: unknown): string {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ""}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    // Circular / non-serialisable — fall back to a coarse string form.
    try {
      return String(arg);
    } catch {
      return "[unstringifiable]";
    }
  }
}

function record(level: ConsoleLogEntry["level"], args: unknown[]): void {
  let message = args.map(stringifyArg).join(" ");
  if (message.length > MAX_LINE_CHARS) {
    message = `${message.slice(0, MAX_LINE_CHARS)}…[truncated]`;
  }
  buffer.push({ level, ts: Date.now(), message });
  if (buffer.length > LIMIT) {
    buffer.splice(0, buffer.length - LIMIT);
  }
}

/** Patch the console methods to tee into the ring buffer. Idempotent. */
export function installConsoleRingBuffer(): void {
  if (installed || typeof console === "undefined") {
    return;
  }
  installed = true;
  for (const level of ["log", "warn", "error", "debug"] as const) {
    const original = console[level]?.bind(console);
    if (typeof original !== "function") {
      continue;
    }
    console[level] = (...args: unknown[]) => {
      try {
        record(level, args);
      } catch {
        // Never let logging instrumentation break the app.
      }
      original(...args);
    };
  }

  // Also capture uncaught errors / promise rejections — the most useful signal
  // for a bug report, and these don't always go through console.error.
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("error", e => {
      record("error", [`[uncaught] ${e.message}`, e.filename ? `@ ${e.filename}:${e.lineno}:${e.colno}` : ""]);
    });
    window.addEventListener("unhandledrejection", e => {
      record("error", ["[unhandledrejection]", stringifyArg((e as PromiseRejectionEvent).reason)]);
    });
  }
}

/** A shallow copy of the current buffered log entries (oldest → newest). */
export function getConsoleSnapshot(): ConsoleLogEntry[] {
  return buffer.slice();
}

/** The buffered logs rendered as plain text, one line per entry. */
export function formatConsoleSnapshot(): string {
  return getConsoleSnapshot()
    .map(e => {
      const t = new Date(e.ts).toISOString().slice(11, 23);
      return `[${t}] ${e.level.toUpperCase()}: ${e.message}`;
    })
    .join("\n");
}

// Install on import — this module is imported for its side effect early in boot.
installConsoleRingBuffer();
