/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 escrow — CLIENT network helper (Task D1/D2 wiring). Thin fetch wrappers
// around the er-save-api /showdown/* routes, mirroring the auth (session cookie -> Bearer)
// and base-URL (VITE_SERVER_URL) conventions the rest of the client already uses
// (`api-base.ts` + the devtest progress fetch).
//
// EVERY call is best-effort and returns a discriminated result — a failure NEVER throws
// into the battle/result flow. When the endpoint is unset (local dev) or unreachable, the
// call resolves to an error result and the caller falls back to the FRIENDLY path (the
// friendly match never touches the server), keeping showdown fully playable offline.
// =============================================================================

import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import {
  applySettlementMutations,
  type SettlementGameData,
  type ShowdownSettlementMutation,
} from "#data/elite-redux/showdown/showdown-settlement";
import type { StakeOffer } from "#data/elite-redux/showdown/showdown-stakes";
import { getCookie } from "#utils/cookies";

/** A pending settlement row for THIS player: the DB row id + the mutation to apply. */
export interface ShowdownPendingItem {
  id: number;
  matchId: string;
  mutation: ShowdownSettlementMutation;
}

/** The escrow base URL, or null when cloud saves are not configured (local dev). */
function escrowBase(): string | null {
  const url = (import.meta.env as { VITE_SERVER_URL?: string }).VITE_SERVER_URL ?? "";
  return url ? url.replace(/\/$/, "") : null;
}

async function escrowFetch(path: string, init: RequestInit): Promise<Response | null> {
  const base = escrowBase();
  if (!base) {
    return null;
  }
  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: getCookie(SESSION_ID_COOKIE_NAME),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    // offline / no endpoint — surface as a null (the caller falls back to friendly).
    return null;
  }
}

/**
 * POST /showdown/match — register the escrow hold. `hostUid`/`guestUid` are the two
 * players' account USERNAMES (the escrow's participant identity; the client has no numeric
 * account id). Resolves the server matchId or an error on any failure.
 */
export async function registerShowdownMatch(args: {
  matchId: string;
  hostUid: string;
  guestUid: string;
  hostStake: StakeOffer;
  guestStake: StakeOffer;
}): Promise<{ ok: true; matchId: string } | { ok: false; error: string }> {
  const res = await escrowFetch("/showdown/match", { method: "POST", body: JSON.stringify(args) });
  if (!res) {
    return { ok: false, error: "escrow unreachable" };
  }
  if (!res.ok) {
    return { ok: false, error: `escrow rejected (${res.status})` };
  }
  try {
    const body = (await res.json()) as { matchId?: unknown; ok?: unknown; state?: unknown };
    // M3: a TERMINAL existing row (settled/void) comes back ok:false with its state — treat a stale
    // matchId as a failure so the caller re-registers fresh or falls back to Friendly.
    if (body.ok === false) {
      return { ok: false, error: `escrow match not open (${String(body.state ?? "terminal")})` };
    }
    if (typeof body.matchId === "string") {
      return { ok: true, matchId: body.matchId };
    }
  } catch {
    /* fallthrough */
  }
  return { ok: false, error: "escrow bad response" };
}

/** POST /showdown/battle-entered — both clients ping at battle start (sets the lone-report gate). Best-effort. */
export async function reportShowdownBattleEntered(matchId: string): Promise<void> {
  await escrowFetch("/showdown/battle-entered", { method: "POST", body: JSON.stringify({ matchId }) });
}

/**
 * POST /showdown/void — release both stake holds for a VOIDED staked match (I4). Best-effort +
 * fire-and-forget; a failure only means the holds linger until the server's own resolution. Idempotent.
 */
export async function reportShowdownVoid(matchId: string): Promise<void> {
  await escrowFetch("/showdown/void", { method: "POST", body: JSON.stringify({ matchId }) });
}

/**
 * POST /showdown/result — report the outcome (dual attestation). Returns the settlement
 * mutations to apply when THIS report settled the match, else an empty array (pending/void).
 */
export async function reportShowdownResult(
  matchId: string,
  winner: "host" | "guest",
  reason: "victory" | "forfeit" | "timeout",
): Promise<{ resolution: "settled" | "void" | "pending"; mutations: ShowdownSettlementMutation[] }> {
  const res = await escrowFetch("/showdown/result", {
    method: "POST",
    body: JSON.stringify({ matchId, winner, reason }),
  });
  if (!res || !res.ok) {
    return { resolution: "pending", mutations: [] };
  }
  try {
    const body = (await res.json()) as { resolution?: unknown };
    const resolution = body.resolution === "settled" || body.resolution === "void" ? body.resolution : "pending";
    // The settle response does NOT carry this uid's mutations directly (they land in the
    // pending queue); the caller fetches + applies them via fetchShowdownPending so the
    // login-time and result-time apply paths share one implementation.
    return { resolution, mutations: [] };
  } catch {
    return { resolution: "pending", mutations: [] };
  }
}

/** GET /showdown/pending — the unapplied settlement mutations for this player. Empty on any failure. */
export async function fetchShowdownPending(): Promise<ShowdownPendingItem[]> {
  const res = await escrowFetch("/showdown/pending", { method: "GET" });
  if (!res || !res.ok) {
    return [];
  }
  try {
    const body = (await res.json()) as { items?: unknown };
    if (!Array.isArray(body.items)) {
      return [];
    }
    return body.items.filter(
      (x): x is ShowdownPendingItem =>
        !!x && typeof x === "object" && typeof (x as ShowdownPendingItem).id === "number",
    );
  } catch {
    return [];
  }
}

/** POST /showdown/pending/ack — mark the given settlement rows applied. Best-effort. */
export async function ackShowdownPending(ids: number[]): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await escrowFetch("/showdown/pending/ack", { method: "POST", body: JSON.stringify({ ids }) });
}

/**
 * Fetch → apply → persist → ack any unapplied settlements for this player. Called at login/session
 * start (self-apply anything a match settled while this device was offline) AND right after a staked
 * match reports its result. Best-effort; returns the count applied (0 on any failure).
 *
 * Correctness ordering (reviewer I2/I3): fetch → filter out ids already in the persisted ledger →
 * apply the fresh ones (which appends their ids to the ledger, inside the account-write batch) →
 * AWAIT `saveSystem(true)` → ack ONLY on save success. If the save fails we do NOT ack: the ledger
 * (already persisted-or-not is retried) plus the server never re-serving an acked row keep re-apply
 * safe, and the next login re-fetches and re-attempts the save+ack without re-mutating (ledger skip).
 */
export async function syncShowdownPendingSettlements(gameData: SettlementGameData): Promise<number> {
  const items = await fetchShowdownPending();
  if (items.length === 0) {
    return 0;
  }
  const ledger = new Set(Array.isArray(gameData.showdownAppliedSettlements) ? gameData.showdownAppliedSettlements : []);
  const fresh = items.filter(i => !ledger.has(i.id));
  if (fresh.length === 0) {
    // Everything was already applied locally but the ack never landed (save/ack failed before).
    // Re-ack (server-idempotent) so the rows finally clear; no mutation is re-run.
    await ackShowdownPending(items.map(i => i.id));
    return 0;
  }
  const freshIds = fresh.map(i => i.id);
  const applied = applySettlementMutations(
    fresh.map(i => i.mutation),
    gameData,
    freshIds,
  );
  if (applied === 0) {
    return 0;
  }
  // I3: persist BEFORE acking. Ack (all fetched ids, incl. any already-in-ledger) ONLY on save success.
  const saved = (await gameData.saveSystem?.(true)) ?? false;
  if (saved) {
    await ackShowdownPending(items.map(i => i.id));
  }
  return applied;
}
