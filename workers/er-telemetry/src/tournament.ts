/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT domain — PURE state machine (Showdown Tournament P1). Zero
// Cloudflare deps (the worker-test pattern): the lifecycle of a tournament over
// plain records, wrapping the pure bracket engine. The worker (`index.ts`)
// persists the records to D1 and calls these functions; all decision logic is
// HERE so it is exhaustively unit-testable.
//
// LOCKED (design doc 2026-07-14): single elimination + byes; ASYNC self-scheduled
// rounds with a CONFIGURABLE per-round window (default 24h; 8h..48h); NO ante
// (prize-only); admin-gated creation (allowlist enforced at the worker route by
// token uid). The bracket ADVANCE is server-authoritative.
// =============================================================================

import { type Bracket, generateBracket, isComplete, type Participant } from "./tournament-bracket";

export type TournamentState = "registration" | "in_progress" | "complete" | "cancelled";

/** Round window bounds (design doc: 8h blitz .. 48h relaxed, default 24h). */
export const MIN_ROUND_WINDOW_MS = 8 * 60 * 60 * 1000;
export const MAX_ROUND_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_ROUND_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Field-size bounds. */
export const MIN_ENTRANTS = 2;
export const DEFAULT_MAX_ENTRANTS = 16;

/** Creation config (validated at create). */
export interface TournamentConfig {
  name: string;
  /** Per-round self-schedule window, clamped to [MIN,MAX]. */
  roundWindowMs?: number;
  /** Registration cap (>= MIN_ENTRANTS), default DEFAULT_MAX_ENTRANTS. */
  maxEntrants?: number;
}

/** The authoritative tournament row (plain data; persisted to D1 by the worker). */
export interface TournamentRecord {
  id: string;
  name: string;
  /** The organizer account (username of the admin who created it). */
  organizer: Participant;
  state: TournamentState;
  roundWindowMs: number;
  maxEntrants: number;
  createdAt: number;
  /** Set when registration closes and the bracket generates. */
  startedAt: number | null;
  /** null until registration closes; then the server-authoritative bracket. */
  bracket: Bracket | null;
  champion: Participant | null;
}

/**
 * The entrant's ghost-trainer APPEARANCE SUMMARY (P1.5 board). A tiny, presentation-only
 * blob carried in the registration payload and stored additively on the entrant row, so
 * the board can draw each slot's ghost-trainer icon + name + title. Untrusted (authored by
 * the registering client) — sanitized on receipt here AND re-sanitized client-side (the
 * ghost-profile rule). Mirrored client-side in tournament-types.ts (worker <-> client shape).
 */
export interface GhostIconSummary {
  /** Trainer atlas key (TrainerConfig.getSpriteKey), e.g. "veteran" / "ace_trainer_f". */
  spriteKey?: string;
  /** Authored display name (falls back to the username client-side when absent). */
  name?: string;
  /** Authored title prefix. */
  title?: string;
}

/** Field caps for the ghost summary (mirror er-ghost-profile's GHOST_NAME_MAX / GHOST_TITLE_MAX). */
const GHOST_ICON_NAME_MAX = 24;
const GHOST_ICON_TITLE_MAX = 32;
const GHOST_ICON_KEY_MAX = 40;

/** Strip control chars, trim, clamp to `max`; returns undefined when empty. */
function clampSummaryLine(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const cleaned = [...value]
    .filter(ch => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join("")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, max);
}

/**
 * Normalize an untrusted ghost-icon summary into a safe shape. The sprite KEY is clamped
 * to a strict `[a-z0-9_]` token (a trainer atlas basename can never be smuggled into an
 * arbitrary path); name/title are length-clamped + control-stripped. Returns null when
 * nothing meaningful survives.
 */
export function sanitizeGhostIcon(raw: unknown): GhostIconSummary | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  const out: GhostIconSummary = {};
  if (typeof r.spriteKey === "string") {
    const key = r.spriteKey
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, GHOST_ICON_KEY_MAX);
    if (key.length > 0) {
      out.spriteKey = key;
    }
  }
  const name = clampSummaryLine(r.name, GHOST_ICON_NAME_MAX);
  if (name) {
    out.name = name;
  }
  const title = clampSummaryLine(r.title, GHOST_ICON_TITLE_MAX);
  if (title) {
    out.title = title;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** One entrant row (plain data; persisted to D1). Seed assigned at bracket gen. */
export interface EntrantRecord {
  tournamentId: string;
  participant: Participant;
  /** Display name (usually === participant username; kept for future flexibility). */
  name: string;
  /** The saved team preset the entrant registered with (name only; team re-picked per match). */
  presetName: string;
  seed: number | null;
  registeredAt: number;
  /** P1.5: ghost-trainer appearance summary (additive; null for old registrations). */
  ghost?: GhostIconSummary | null;
  /** P1.5: epoch ms of this entrant's last presence ping (additive; null = never seen). */
  lastSeen?: number | null;
}

export type Ok<T> = { ok: true } & T;
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const nameOk = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 80;

/** Clamp a requested round window into the allowed band, defaulting when absent. */
export function clampRoundWindow(ms: number | undefined): number {
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    return DEFAULT_ROUND_WINDOW_MS;
  }
  return Math.min(MAX_ROUND_WINDOW_MS, Math.max(MIN_ROUND_WINDOW_MS, Math.floor(ms)));
}

/** Create a tournament in the `registration` state. Organizer is a verified admin (route-gated). */
export function createTournament(
  id: string,
  organizer: Participant,
  config: TournamentConfig,
  now: number,
): Result<{ tournament: TournamentRecord }> {
  if (!id) {
    return { ok: false, error: "missing tournament id" };
  }
  if (!nameOk(config.name)) {
    return { ok: false, error: "invalid tournament name" };
  }
  const maxEntrants =
    typeof config.maxEntrants === "number" && Number.isFinite(config.maxEntrants)
      ? Math.max(MIN_ENTRANTS, Math.floor(config.maxEntrants))
      : DEFAULT_MAX_ENTRANTS;
  return {
    ok: true,
    tournament: {
      id,
      name: config.name.trim(),
      organizer,
      state: "registration",
      roundWindowMs: clampRoundWindow(config.roundWindowMs),
      maxEntrants,
      createdAt: now,
      startedAt: null,
      bracket: null,
      champion: null,
    },
  };
}

/**
 * Register an entrant. No dup; under cap; registration open; preset required.
 *
 * Guard ORDER matters for the auto-close-at-cap flow (P1.5): the CAP check runs
 * BEFORE the state check so that once the field fills and the worker auto-closes
 * registration (state -> in_progress), a later would-be entrant gets the exact
 * "tournament is full" message rather than a generic "registration is closed".
 * An admin who closes registration EARLY (under cap) still yields "registration is
 * closed" (cap not reached, so the state guard fires).
 */
export function registerEntrant(
  tournament: TournamentRecord,
  entrants: EntrantRecord[],
  participant: Participant,
  presetName: string,
  now: number,
): Result<{ entrant: EntrantRecord }> {
  if (!participant) {
    return { ok: false, error: "missing participant" };
  }
  if (entrants.some(e => e.participant === participant)) {
    return { ok: false, error: "already registered" };
  }
  if (entrants.length >= tournament.maxEntrants) {
    return { ok: false, error: "tournament is full" };
  }
  if (tournament.state !== "registration") {
    return { ok: false, error: "registration is closed" };
  }
  if (!nameOk(presetName)) {
    return { ok: false, error: "a saved team preset is required to register" };
  }
  return {
    ok: true,
    entrant: {
      tournamentId: tournament.id,
      participant,
      name: participant,
      presetName,
      seed: null,
      registeredAt: now,
    },
  };
}

/** Withdraw before registration closes. */
export function withdrawEntrant(
  tournament: TournamentRecord,
  entrants: EntrantRecord[],
  participant: Participant,
): Result<{ removed: Participant }> {
  if (tournament.state !== "registration") {
    return { ok: false, error: "registration is closed" };
  }
  if (!entrants.some(e => e.participant === participant)) {
    return { ok: false, error: "not registered" };
  }
  return { ok: true, removed: participant };
}

/**
 * Seed the field. Higher ladder rank -> lower seed number (better). Entrants with
 * no rank are seeded AFTER ranked ones, in stable registration order. Returns a
 * new array of [participant, seed] with seeds 1..N assigned.
 */
export function seedEntrants(
  entrants: EntrantRecord[],
  rankOf: (participant: Participant) => number | null,
): { participant: Participant; seed: number }[] {
  const decorated = entrants.map((e, idx) => ({
    participant: e.participant,
    rank: rankOf(e.participant),
    idx,
  }));
  decorated.sort((x, y) => {
    const xr = x.rank;
    const yr = y.rank;
    if (xr !== null && yr !== null) {
      if (xr !== yr) {
        return yr - xr; // higher rank value = better = lower seed
      }
      return x.idx - y.idx;
    }
    if (xr !== null) {
      return -1; // ranked before unranked
    }
    if (yr !== null) {
      return 1;
    }
    return x.idx - y.idx; // both unranked: registration order
  });
  return decorated.map((d, i) => ({ participant: d.participant, seed: i + 1 }));
}

/**
 * Close registration: seed the field, generate the bracket, flip to `in_progress`.
 * Needs at least MIN_ENTRANTS. `rankOf` supplies ladder rank for seeding (null =
 * unranked / random-ish by registration order).
 */
export function closeRegistration(
  tournament: TournamentRecord,
  entrants: EntrantRecord[],
  rankOf: (participant: Participant) => number | null,
  now: number,
): Result<{ tournament: TournamentRecord; seeded: { participant: Participant; seed: number }[] }> {
  if (tournament.state !== "registration") {
    return { ok: false, error: "registration is not open" };
  }
  if (entrants.length < MIN_ENTRANTS) {
    return { ok: false, error: "not enough entrants to start" };
  }
  const seeded = seedEntrants(entrants, rankOf);
  const bracket = generateBracket(tournament.id, seeded, tournament.roundWindowMs, now);
  return {
    ok: true,
    tournament: { ...tournament, state: "in_progress", startedAt: now, bracket },
    seeded,
  };
}

/** Cancel a tournament (organizer). Terminal from any non-terminal state. */
export function cancelTournament(tournament: TournamentRecord): Result<{ tournament: TournamentRecord }> {
  if (tournament.state === "complete" || tournament.state === "cancelled") {
    return { ok: false, error: "tournament already ended" };
  }
  return { ok: true, tournament: { ...tournament, state: "cancelled" } };
}

/**
 * After a bracket mutation (result / manual resolve), recompute completion:
 * flip to `complete` + record champion once the final is decided.
 */
export function syncCompletion(tournament: TournamentRecord): TournamentRecord {
  if (tournament.bracket === null || tournament.state !== "in_progress") {
    return tournament;
  }
  if (isComplete(tournament.bracket)) {
    return { ...tournament, state: "complete", champion: tournament.bracket.rounds.at(-1)?.[0].winner ?? null };
  }
  return tournament;
}
