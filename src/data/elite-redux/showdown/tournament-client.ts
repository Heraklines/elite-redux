/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — client for the er-telemetry worker's /tournament/* routes
// (Showdown Tournament P1). Reuses the exact base-URL + auth pattern the showdown
// telemetry sender uses (VITE_SERVER_URL_TELEMETRY ?? VITE_SERVER_URL, session
// cookie as the Authorization header). Every call is best-effort and returns a
// tagged result; a missing endpoint (local dev) yields { ok:false, error } and
// never throws, so callers degrade gracefully.
// =============================================================================

import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import type { GhostIconSummary, TournamentView } from "#data/elite-redux/showdown/tournament-types";
import { getCookie } from "#utils/cookies";

export type ClientResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** The telemetry worker base URL, or null when unconfigured (local dev). */
function tournamentBase(): string | null {
  const env = import.meta.env as { VITE_SERVER_URL_TELEMETRY?: string; VITE_SERVER_URL?: string };
  const url = env.VITE_SERVER_URL_TELEMETRY ?? env.VITE_SERVER_URL ?? "";
  return url ? url.replace(/\/$/, "") : null;
}

function authHeaders(): Record<string, string> {
  return { "Content-Type": "application/json", Authorization: getCookie(SESSION_ID_COOKIE_NAME) };
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<ClientResult<T>> {
  const base = tournamentBase();
  if (base == null) {
    return { ok: false, error: "tournaments are unavailable offline" };
  }
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: authHeaders(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string } & Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: json.error ?? `request failed (${res.status})` };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network error" };
  }
}

/** GET the tournament list (registration / in-progress / recently finished). */
export function listTournaments(): Promise<ClientResult<{ tournaments: TournamentView[] }>> {
  return request("GET", "/tournament/list");
}

/** GET the full tournament + bracket by id. */
export function getTournamentBracket(id: string): Promise<ClientResult<{ tournament: TournamentView }>> {
  return request("GET", `/tournament/bracket?id=${encodeURIComponent(id)}`);
}

/**
 * Register for a tournament with a saved team preset (a preset name is REQUIRED). The optional
 * ghost-icon summary (sprite key / name / title) is carried into the entrants table so the board
 * can draw the entrant's ghost-trainer identity (P1.5). The worker sanitizes it on receipt.
 */
export function registerForTournament(
  id: string,
  presetName: string,
  ghost?: GhostIconSummary,
): Promise<ClientResult<{ autoClosed?: boolean }>> {
  return request("POST", "/tournament/register", { id, presetName, ...(ghost ? { ghost } : {}) });
}

/** Withdraw from a tournament (before registration closes). */
export function withdrawFromTournament(id: string): Promise<ClientResult<unknown>> {
  return request("POST", "/tournament/withdraw", { id });
}

/**
 * Presence ping (P1.5): stamp the caller's last-seen on this tournament while they sit on the
 * board / in the tournament lobby, so an opponent's board shows "A: FIGHT" vs "last seen <ago>".
 * Best-effort and display-only (the P2 activity-win logic is out of scope).
 */
export function pingTournamentPresence(id: string): Promise<ClientResult<unknown>> {
  return request("POST", "/tournament/ping", { id });
}

/**
 * Report a finished authoritative tournament match result (winner is a username).
 * The worker enforces attestation: the reporter is the authenticated account and
 * must be one of the two paired players; a result settles only on agreeing dual
 * reports. Safe to call from both clients.
 */
export function reportTournamentResult(
  tournamentId: string,
  matchId: string,
  winner: string,
): Promise<ClientResult<{ resolution: string }>> {
  return request("POST", "/tournament/result", { tournamentId, matchId, winner });
}
