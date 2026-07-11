/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown ranked ladder — CLIENT network helper. Thin fetch wrappers around the
// er-save-api /showdown/rank routes, mirroring showdown-escrow-client.ts (session-cookie
// -> Bearer auth, VITE_SERVER_URL base, every call best-effort + non-throwing). The server
// is AUTHORITATIVE: the client posts the reported winner (dual attestation) and RENDERS the
// state the server returns — it never computes progression locally. A settled report's
// server-computed events are fanned out to the rewards hook registry (showdown-rank-events).
// =============================================================================

import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import {
  emitRankedMatchWin,
  emitRankedSeasonEnd,
  emitRankedTierFirstReached,
} from "#data/elite-redux/showdown/showdown-rank-events";
import {
  isShowdownRankState,
  type ShowdownRankState,
  type ShowdownRankTier,
} from "#data/elite-redux/showdown/showdown-rank-types";
import { getCookie } from "#utils/cookies";

/** The server-computed events for a settled ranked result (mirrors the worker `RankResultEvents`). */
export interface ShowdownRankEvents {
  won: boolean;
  tiersFirstReached: number[];
  seasonEndedFinalTier: number | null;
}

/** The ranked base URL, or null when cloud saves are not configured (local dev). */
function rankBase(): string | null {
  const url = (import.meta.env as { VITE_SERVER_URL?: string }).VITE_SERVER_URL ?? "";
  return url ? url.replace(/\/$/, "") : null;
}

/** Whether a ranked server is configured at all (the wager toggle is disabled when it isn't). */
export function isRankServerConfigured(): boolean {
  return rankBase() != null;
}

/**
 * Sticky per-session guard: once the ranked routes answer 404 (the `/showdown/rank*` endpoints are not
 * deployed on this worker yet), stop hitting them for the rest of the session. Without this the rank
 * chip re-fetches on EVERY Team Menu / wager open and the browser logs a fresh `GET .../showdown/rank
 * 404` each time - console spam for a feature that is simply awaiting a worker deploy. Casual play is
 * unaffected and the chip renders the neutral "Unranked" state (fetch resolves null). Cleared only by a
 * page reload (i.e. a fresh deploy that ships the route). NOTE: the FIRST 404 is still emitted by the
 * browser itself (unsuppressable for a real `fetch`); this collapses the repeat noise to that one line.
 */
let rankRouteMissing = false;

async function rankFetch(path: string, init: RequestInit): Promise<Response | null> {
  const base = rankBase();
  if (!base || rankRouteMissing) {
    return null;
  }
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: getCookie(SESSION_ID_COOKIE_NAME),
        ...(init.headers ?? {}),
      },
    });
    // 404 = the ranked routes aren't deployed on this worker. Latch it so we don't re-probe (and re-spam
    // the console) on every subsequent menu/wager open this session.
    if (res.status === 404) {
      rankRouteMissing = true;
    }
    return res;
  } catch {
    // offline / no endpoint — surface as null (ranked simply doesn't count; casual is unaffected).
    return null;
  }
}

/** Fan out a settled report's server-computed events to the rewards hook registry (defensive). */
function fanOutEvents(events: ShowdownRankEvents): void {
  for (const tier of events.tiersFirstReached) {
    emitRankedTierFirstReached(tier as ShowdownRankTier);
  }
  if (events.seasonEndedFinalTier != null) {
    emitRankedSeasonEnd(events.seasonEndedFinalTier as ShowdownRankTier);
  }
  if (events.won) {
    emitRankedMatchWin();
  }
}

/**
 * GET /showdown/rank — this player's own ranked state (lazily reconciling a season boundary
 * server-side). Fires the season-end hook once when the server reports a stale-season rollover.
 * Returns null on any failure (offline / unconfigured / unreachable) so the caller can hide/disable
 * ranked without blocking casual play.
 */
export async function fetchMyShowdownRank(): Promise<ShowdownRankState | null> {
  const res = await rankFetch("/showdown/rank", { method: "GET" });
  if (!res || !res.ok) {
    return null;
  }
  try {
    const body = (await res.json()) as { state?: unknown; seasonEndedFinalTier?: unknown };
    if (!isShowdownRankState(body.state)) {
      return null;
    }
    if (typeof body.seasonEndedFinalTier === "number") {
      emitRankedSeasonEnd(body.seasonEndedFinalTier as ShowdownRankTier);
    }
    return body.state;
  } catch {
    return null;
  }
}

/**
 * POST /showdown/rank/result — report the ranked outcome (dual attestation, mirrors the escrow
 * result report). Applies to BOTH players' rank rows server-side only when both agree; a conflict
 * voids with no rank change. On a settle, fans the server-computed events out to the rewards hooks.
 * Best-effort: any failure resolves to `pending` and the match simply doesn't count (casual is safe).
 */
export async function reportShowdownRankResult(args: {
  matchId: string;
  hostUid: string;
  guestUid: string;
  winner: "host" | "guest";
}): Promise<{ resolution: "settled" | "void" | "pending"; state: ShowdownRankState | null }> {
  const res = await rankFetch("/showdown/rank/result", { method: "POST", body: JSON.stringify(args) });
  if (!res || !res.ok) {
    return { resolution: "pending", state: null };
  }
  try {
    const body = (await res.json()) as { resolution?: unknown; state?: unknown; events?: unknown };
    const resolution = body.resolution === "settled" || body.resolution === "void" ? body.resolution : "pending";
    if (resolution === "settled" && body.events && typeof body.events === "object") {
      const ev = body.events as Partial<ShowdownRankEvents>;
      fanOutEvents({
        won: !!ev.won,
        tiersFirstReached: Array.isArray(ev.tiersFirstReached)
          ? ev.tiersFirstReached.filter((n): n is number => typeof n === "number")
          : [],
        seasonEndedFinalTier: typeof ev.seasonEndedFinalTier === "number" ? ev.seasonEndedFinalTier : null,
      });
    }
    return { resolution, state: isShowdownRankState(body.state) ? body.state : null };
  } catch {
    return { resolution: "pending", state: null };
  }
}
