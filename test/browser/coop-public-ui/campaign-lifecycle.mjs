/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const DEFAULT_CAMPAIGN_TIMEOUT_MS = 45 * 60_000;
const DEFAULT_DIAGNOSTIC_TIMEOUT_MS = 20_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 60_000;

function positiveInteger(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadCampaignLifecyclePolicy() {
  return Object.freeze({
    campaignTimeoutMs: positiveInteger("COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS", DEFAULT_CAMPAIGN_TIMEOUT_MS),
    diagnosticTimeoutMs: positiveInteger("COOP_UI_DIAGNOSTIC_TIMEOUT_MS", DEFAULT_DIAGNOSTIC_TIMEOUT_MS),
    cleanupTimeoutMs: positiveInteger("COOP_UI_CLEANUP_TIMEOUT_MS", DEFAULT_CLEANUP_TIMEOUT_MS),
  });
}

export class CampaignLifecycleTimeoutError extends Error {
  constructor(operation, timeoutMs) {
    super(`[campaign-lifecycle] ${operation} exceeded immutable ${timeoutMs}ms deadline`);
    this.name = "CampaignLifecycleTimeoutError";
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Race one operation against an immutable wall-clock deadline. The losing operation's
 * rejection is consumed because Puppeteer work normally rejects only after the browser is
 * force-closed by the caller's cleanup path.
 */
export async function withinDeadline(operation, timeoutMs, label) {
  const promise = Promise.resolve(operation);
  promise.catch(() => {});
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new CampaignLifecycleTimeoutError(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Kill Chromium processes only after graceful close has failed or timed out. */
export function forceKillBrowsers(rig) {
  for (const browser of rig?.browsers ?? []) {
    try {
      browser.process()?.kill("SIGKILL");
    } catch {
      // The process may already have exited between connected/process checks.
    }
  }
}
