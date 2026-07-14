/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Known-fatal fast-abort watchdog. A leg that has decided its outcome (a shared-session
 * terminal, a launch-snapshot abort, a game over, or a lobby start failure) otherwise
 * rides out generic 120s waits several times over, burning 10+ minutes past the verdict.
 * This watches the clients' own console evidence for terminal markers and rejects the
 * moment one appears, so the run entrypoint captures evidence and ends immediately.
 */

// Console markers that mean the co-op leg is over. Each is the game's own terminal log,
// so no game state is inspected - only the evidence stream the driver already records.
export const TERMINAL_MARKERS = [
  { name: "launch-snapshot-abort", pattern: /launchSnapshotAbort wave=\d+ reason=\S+/u },
  { name: "shared-session-terminal", pattern: /\[coop:runtime\] shared session terminal requested:/u },
  { name: "shared-session-stopped", pattern: /\[coop:runtime\] shared session stopped safely:/u },
  { name: "coop-fail-closed", pattern: /failing closed|fails closed/u },
  { name: "game-over", pattern: /Start Phase GameOverPhase/u },
  { name: "lobby-start-failed", pattern: /\[coop:lobby\] start failed:/u },
];

export class TerminalAbortError extends Error {
  constructor(marker, text, label) {
    super(`[terminal:${marker}] ${label}: ${text}`);
    this.name = "TerminalAbortError";
    this.marker = marker;
    this.terminalText = text;
    this.seat = label;
  }
}

/**
 * Poll the clients' evidence for a terminal marker. Returns `{ promise, stop }`; the
 * promise rejects with a {@link TerminalAbortError} on the first terminal marker and never
 * resolves otherwise. Scans only newly-appended events each tick (cursor per client).
 */
export function watchForTerminal(clients, { pollMs = 200 } = {}) {
  const cursors = new Map(clients.map(client => [client.label, 0]));
  let stopped = false;
  let timer = null;
  const promise = new Promise((_resolve, reject) => {
    const tick = () => {
      if (stopped) {
        return;
      }
      for (const client of clients) {
        const events = client.evidence.events;
        const from = cursors.get(client.label) ?? 0;
        for (let i = from; i < events.length; i++) {
          const text = events[i].text ?? "";
          if (text.length === 0) {
            continue;
          }
          for (const { name, pattern } of TERMINAL_MARKERS) {
            if (pattern.test(text)) {
              stopped = true;
              client.evidence.record("terminal-watchdog", { marker: name, text });
              reject(new TerminalAbortError(name, text, client.label));
              return;
            }
          }
        }
        cursors.set(client.label, events.length);
      }
      timer = setTimeout(tick, pollMs);
    };
    timer = setTimeout(tick, pollMs);
  });
  return {
    promise,
    stop: () => {
      stopped = true;
      if (timer != null) {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Run `journeyPromise` but reject fast if a terminal marker appears. The journey keeps
 * running until the caller closes the rig (which aborts its in-flight page work); its
 * eventual rejection is swallowed so it never becomes an unhandled rejection.
 */
export async function raceJourneyWithTerminal(clients, journeyPromise, options) {
  const watchdog = watchForTerminal(clients, options);
  journeyPromise.catch(() => {});
  try {
    await Promise.race([journeyPromise, watchdog.promise]);
  } finally {
    watchdog.stop();
  }
}
