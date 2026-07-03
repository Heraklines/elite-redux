/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op ACCOUNT WRITE GATE (#807 B, default-deny / capability pattern - the same
// philosophy as the M1 renderer phase gate, applied to gameData mutations).
//
// The mon-leak class kept resurfacing because MULTIPLE code paths could register
// species onto an account during a co-op session, and each newly-discovered path
// needed its own fix (the un-scoped share, the ME-terminal blob, the adopt
// credit). This gate inverts the model: during a co-op session, account CAUGHT
// registration is DENIED BY DEFAULT - only code that explicitly runs inside an
// allowlisted scope may write. A future feature that forgets this rule fails
// SAFE (blocked + loudly logged) instead of silently contaminating accounts.
//
// Scopes are re-entrant (a counter, not a flag) and synchronous-only by design:
// wrap the exact call, never a whole async flow.
// =============================================================================

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";

let allowDepth = 0;

/** Run `fn` inside an allowlisted account-write scope (re-entrant). */
export function coopAllowAccountWrite<T>(label: string, fn: () => T): T {
  allowDepth++;
  coopLog("account", `account-write scope OPEN (${label}) depth=${allowDepth}`);
  try {
    return fn();
  } finally {
    allowDepth--;
  }
}

/** Whether the caller is inside an allowlisted account-write scope. */
export function isCoopAccountWriteAllowed(): boolean {
  return allowDepth > 0;
}

/**
 * Chokepoint check for account CAUGHT registration during a co-op session.
 * Returns true when the write may proceed; false means BLOCKED (the caller
 * must no-op). Non-co-op sessions are always allowed.
 */
export function coopGateAccountWrite(isCoop: boolean, label: string): boolean {
  if (!isCoop || allowDepth > 0) {
    return true;
  }
  coopWarn(
    "account",
    `BLOCKED un-allowlisted account write (${label}) during co-op - default-deny gate (#807). `
      + "Wrap the legitimate call site in coopAllowAccountWrite().",
  );
  return false;
}
