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

import {
  applyKickWalkover,
  type Bracket,
  computePlacements,
  generateBracket,
  hasProgress,
  isComplete,
  type Participant,
} from "./tournament-bracket";

export type TournamentState = "registration" | "in_progress" | "complete" | "cancelled";

/** Round window bounds (design doc: 8h blitz .. 48h relaxed, default 24h). */
export const MIN_ROUND_WINDOW_MS = 8 * 60 * 60 * 1000;
export const MAX_ROUND_WINDOW_MS = 48 * 60 * 60 * 1000;
export const DEFAULT_ROUND_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Field-size bounds. P3: overall max 64 entries (paginated board for 32/64). */
export const MIN_ENTRANTS = 2;
export const DEFAULT_MAX_ENTRANTS = 16;
export const MAX_ENTRANTS = 64;

/** P3 COMMUNITY tier: a non-admin player may create a small, PRIZE-FREE tournament (cap clamped here). */
export const COMMUNITY_MAX_ENTRANTS = 16;
/** Anti-spam: at most this many ACTIVE (registration/in_progress) tournaments per community creator. */
export const COMMUNITY_ACTIVE_LIMIT = 1;

// =============================================================================
// P3 — battle / series FORMAT + REWARD POOL vocabulary. Stored on the tournament
// record; battle/series-format engine enforcement is a separate workstream (this
// layer is storage + list/bracket exposure only). The reward pool DEFINITION uses
// the settlement mutation vocabulary (mirrors the client's ShowdownSettlementMutation
// / the escrow worker's SettlementMutation — the worker cannot import client code, so
// the shape is re-declared); GRANTING at completion runs through the existing
// settlement pipeline (see computeRewardGrants + the /tournament/grant-rewards route).
// =============================================================================

/** Field width at match start (design doc). Singles ships now; doubles/triples are a later engine workstream. */
export type BattleFormat = "singles" | "doubles" | "triples";
export const BATTLE_FORMATS: readonly BattleFormat[] = ["singles", "doubles", "triples"];
export const DEFAULT_BATTLE_FORMAT: BattleFormat = "singles";

/** Series wrapper (design doc): single game, best-of-3, best-of-5. Worker-level; board shows the series score. */
export type SeriesFormat = "single" | "bo3" | "bo5";
export const SERIES_FORMATS: readonly SeriesFormat[] = ["single", "bo3", "bo5"];
export const DEFAULT_SERIES_FORMAT: SeriesFormat = "single";

/** A reward-pool place: podium buckets mapped onto real accounts at completion via computePlacements. */
export type RewardPlace = "champion" | "runnerUp" | "semifinalist";
export const REWARD_PLACES: readonly RewardPlace[] = ["champion", "runnerUp", "semifinalist"];

/** Shiny prize tier: 1/2/3 = the three shiny variants (DexAttr DEFAULT/VARIANT_2/VARIANT_3), 4 = ER black shiny. */
export type ShinyTier = 1 | 2 | 3 | 4;
/** Shiny-lab effect categories (append-only ordered id lists live in er-shiny-lab-effects.ts). */
export type LabEffectCategory = "palette" | "surface" | "around";
export const LAB_EFFECT_CATEGORIES: readonly LabEffectCategory[] = ["palette", "surface", "around"];

/**
 * A single settlement mutation in a reward definition. Re-declared from the client's
 * ShowdownSettlementMutation (the worker cannot import client code). A tournament never REMOVES an
 * unlock (prize-only, design doc). Prize kinds:
 *   - grantShinyChosen: a specific species at a chosen shiny tier (T1/T2/T3, or T4 = black shiny).
 *   - grantShinyRandom: a shiny at a chosen tier, species ROLLED at grant time (seeded, deterministic;
 *       the resolved species is recorded on the grant). `speciesPool` optionally constrains the roll;
 *       `unownedOnly` is advisory (the client converts an already-owned shiny grant to candy, exactly
 *       like a staked shiny the winner already owns).
 *   - grantLabEffect: a shiny-lab effect/look granted on a species (owned + auto-equipped if the mon
 *       has no current look), by category + 1-based effect index into that category's id list.
 *   - grantCandy: candy on a species (pooled at the evolution-line root by the client).
 *   - grantUnlock: a raw unlock (kept for back-compat / direct use).
 */
export type TournamentRewardMutation =
  | { kind: "grantShinyChosen"; speciesId: number; tier: ShinyTier }
  | {
      kind: "grantShinyRandom";
      tier: ShinyTier;
      unownedOnly: boolean;
      speciesPool: number[];
      /** Set by the worker at grant time (seeded roll); once present the grant is fixed/deterministic. */
      resolvedSpeciesId?: number;
    }
  | { kind: "grantLabEffect"; speciesId: number; category: LabEffectCategory; effectIndex: number }
  | { kind: "grantUnlock"; speciesId: number; shiny: boolean; variant: number; erBlackShiny: boolean; cost: number }
  | { kind: "grantCandy"; speciesId: number; candy: number };

/** One place's reward: the mutations granted to whoever finishes in that place. */
export interface RewardPoolEntry {
  place: RewardPlace;
  mutations: TournamentRewardMutation[];
}

/** The full reward pool (per-place mutation lists). Empty = no prizes. */
export type RewardPool = RewardPoolEntry[];

/** Creation config (validated at create). */
export interface TournamentConfig {
  name: string;
  /** Per-round self-schedule window, clamped to [MIN,MAX]. */
  roundWindowMs?: number;
  /** Registration cap, clamped to [MIN_ENTRANTS, MAX_ENTRANTS]; default DEFAULT_MAX_ENTRANTS. */
  maxEntrants?: number;
  /** P3: field width at match start (storage + exposure only for now). */
  battleFormat?: BattleFormat;
  /** P3: series wrapper (single / best-of-3 / best-of-5). */
  seriesFormat?: SeriesFormat;
  /** P3: per-place reward definitions (settlement mutation vocabulary). */
  rewardPool?: RewardPool;
  /** P3: optional scheduled registration close (epoch ms); enforced LAZILY on reads. null = none. */
  closeAt?: number | null;
}

/** Coerce an arbitrary value to a valid BattleFormat, defaulting. */
export function coerceBattleFormat(v: unknown): BattleFormat {
  return BATTLE_FORMATS.includes(v as BattleFormat) ? (v as BattleFormat) : DEFAULT_BATTLE_FORMAT;
}

/** Coerce an arbitrary value to a valid SeriesFormat, defaulting. */
export function coerceSeriesFormat(v: unknown): SeriesFormat {
  return SERIES_FORMATS.includes(v as SeriesFormat) ? (v as SeriesFormat) : DEFAULT_SERIES_FORMAT;
}

/**
 * Game wins needed to CLINCH a series match: single -> 1, best-of-3 -> 2, best-of-5 -> 3
 * (a strict majority of the max games). Fed into {@linkcode applySeriesGameReport} so the pure
 * bracket engine stays agnostic of the format vocabulary.
 */
export function winsNeededForSeries(seriesFormat: SeriesFormat): number {
  switch (seriesFormat) {
    case "bo5":
      return 3;
    case "bo3":
      return 2;
    default:
      return 1;
  }
}

/** Total games in a series (single -> 1, bo3 -> 3, bo5 -> 5). Board/label helper. */
export function seriesGameCount(seriesFormat: SeriesFormat): number {
  return seriesFormat === "bo5" ? 5 : seriesFormat === "bo3" ? 3 : 1;
}

/** Clamp a requested entrant cap into [MIN_ENTRANTS, MAX_ENTRANTS], defaulting when absent/invalid. */
export function clampMaxEntrants(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return DEFAULT_MAX_ENTRANTS;
  }
  return Math.min(MAX_ENTRANTS, Math.max(MIN_ENTRANTS, Math.floor(v)));
}

/**
 * Normalize an untrusted reward-pool payload into a safe RewardPool (drops unknown places / kinds
 * / malformed entries). Non-negative-clamps numeric amounts. Returns [] when nothing survives.
 */
export function sanitizeRewardPool(raw: unknown): RewardPool {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: RewardPool = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const e = entry as Record<string, unknown>;
    if (!REWARD_PLACES.includes(e.place as RewardPlace)) {
      continue;
    }
    const muts: TournamentRewardMutation[] = [];
    if (Array.isArray(e.mutations)) {
      for (const m of e.mutations) {
        const sm = sanitizeRewardMutation(m);
        if (sm) {
          muts.push(sm);
        }
      }
    }
    out.push({ place: e.place as RewardPlace, mutations: muts });
  }
  return out;
}

function nonNegInt(v: unknown, fallback = 0): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.max(0, n);
}

/** Clamp an arbitrary value into a valid ShinyTier (1..4), defaulting to T1. */
function coerceShinyTier(v: unknown): ShinyTier {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 1;
  return (Math.min(4, Math.max(1, n)) as ShinyTier) ?? 1;
}

function sanitizeRewardMutation(raw: unknown): TournamentRewardMutation | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const m = raw as Record<string, unknown>;
  switch (m.kind) {
    case "grantShinyChosen":
      if (typeof m.speciesId !== "number") {
        return null;
      }
      return { kind: "grantShinyChosen", speciesId: Math.floor(m.speciesId), tier: coerceShinyTier(m.tier) };
    case "grantShinyRandom": {
      const pool = Array.isArray(m.speciesPool)
        ? m.speciesPool.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).map(x => Math.floor(x))
        : [];
      const out: TournamentRewardMutation = {
        kind: "grantShinyRandom",
        tier: coerceShinyTier(m.tier),
        unownedOnly: Boolean(m.unownedOnly),
        speciesPool: pool.slice(0, 2000),
      };
      if (typeof m.resolvedSpeciesId === "number" && Number.isFinite(m.resolvedSpeciesId)) {
        out.resolvedSpeciesId = Math.floor(m.resolvedSpeciesId);
      }
      return out;
    }
    case "grantLabEffect":
      if (typeof m.speciesId !== "number" || !LAB_EFFECT_CATEGORIES.includes(m.category as LabEffectCategory)) {
        return null;
      }
      return {
        kind: "grantLabEffect",
        speciesId: Math.floor(m.speciesId),
        category: m.category as LabEffectCategory,
        effectIndex: nonNegInt(m.effectIndex),
      };
    case "grantUnlock":
      if (typeof m.speciesId !== "number") {
        return null;
      }
      return {
        kind: "grantUnlock",
        speciesId: Math.floor(m.speciesId),
        shiny: Boolean(m.shiny),
        variant: nonNegInt(m.variant),
        erBlackShiny: Boolean(m.erBlackShiny),
        cost: nonNegInt(m.cost),
      };
    case "grantCandy":
      if (typeof m.speciesId !== "number") {
        return null;
      }
      return { kind: "grantCandy", speciesId: Math.floor(m.speciesId), candy: nonNegInt(m.candy) };
    default:
      return null;
  }
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
  /** P3: field width at match start (storage + exposure; engine enforcement separate). */
  battleFormat: BattleFormat;
  /** P3: series wrapper (single / bo3 / bo5). LOCKED once the bracket generates. */
  seriesFormat: SeriesFormat;
  /** P3: per-place reward definitions (settlement mutation vocabulary). */
  rewardPool: RewardPool;
  /** P3: optional scheduled registration close (epoch ms), enforced lazily on reads. null = none. */
  closeAt: number | null;
  /** P3: set once the reward pool has been granted at completion (stub-grant marker; prevents double-grant). */
  rewardsGranted: boolean;
  /** P3: true when a NON-admin player created this via the community route (prize-free, cap-capped). */
  community: boolean;
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
  /** P3: true when this entrant is on the WAITLIST (beyond cap); promoted into the field on a kick. */
  waitlisted?: boolean;
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
  const maxEntrants = clampMaxEntrants(config.maxEntrants);
  const closeAt =
    typeof config.closeAt === "number" && Number.isFinite(config.closeAt) ? Math.floor(config.closeAt) : null;
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
      battleFormat: coerceBattleFormat(config.battleFormat),
      seriesFormat: coerceSeriesFormat(config.seriesFormat),
      rewardPool: sanitizeRewardPool(config.rewardPool),
      closeAt,
      rewardsGranted: false,
      community: false,
    },
  };
}

/**
 * P3 COMMUNITY CREATE (maintainer-approved subset): a NON-admin player creates a small, PRIZE-FREE
 * tournament in-game. Enforced here (PURE): the entrant cap is clamped to COMMUNITY_MAX_ENTRANTS, the
 * reward pool is FORCED empty (prize tournaments stay admin/editor-gated), and the creator may hold at
 * most COMMUNITY_ACTIVE_LIMIT active (registration/in_progress) tournaments at once (anti-spam).
 * `activeByCreator` is the creator's current active-tournament count (the route supplies it).
 */
export function createCommunityTournament(
  id: string,
  creator: Participant,
  config: TournamentConfig,
  activeByCreator: number,
  now: number,
): Result<{ tournament: TournamentRecord }> {
  if (activeByCreator >= COMMUNITY_ACTIVE_LIMIT) {
    return { ok: false, error: "you already have an active tournament — cancel it before creating another" };
  }
  const cappedMax = Math.min(COMMUNITY_MAX_ENTRANTS, clampMaxEntrants(config.maxEntrants));
  const res = createTournament(
    id,
    creator,
    // community tournaments are PRIZE-FREE and capped; a scheduled close is still allowed.
    { ...config, maxEntrants: cappedMax, rewardPool: [] },
    now,
  );
  if (!res.ok) {
    return res;
  }
  return { ok: true, tournament: { ...res.tournament, community: true } };
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

// =============================================================================
// P3 — ADMIN OPS: waitlist, kick (registration refill / reopen / walkover), edit,
// reseed, scheduled close, reward grants. All PURE (the route persists the result).
// =============================================================================

/** Where a registration attempt lands: an active field slot, the waitlist, or rejected. */
export type RegistrationOutcome =
  | { ok: true; kind: "entrant" }
  | { ok: true; kind: "waitlist" }
  | { ok: false; error: string };

/**
 * Decide whether a would-be registrant becomes an active ENTRANT, joins the WAITLIST (beyond
 * cap), or is rejected — the PURE decision behind the register route (design doc scenario 8).
 *  - open registration under cap  -> entrant.
 *  - registration full, OR the field auto-/admin-closed but NO match has been played yet
 *    (the pre-play window) -> waitlist (auto-promoted on a later kick).
 *  - a tournament that is underway (a match played), complete, or cancelled -> rejected.
 * `entrants` is the ACTIVE field; `waitlist` the queued rows. Both are checked for a dup.
 */
export function classifyRegistration(
  tournament: TournamentRecord,
  entrants: EntrantRecord[],
  waitlist: EntrantRecord[],
  participant: Participant,
  presetName: string,
): RegistrationOutcome {
  if (!participant) {
    return { ok: false, error: "missing participant" };
  }
  if (entrants.some(e => e.participant === participant) || waitlist.some(e => e.participant === participant)) {
    return { ok: false, error: "already registered" };
  }
  if (!nameOk(presetName)) {
    return { ok: false, error: "a saved team preset is required to register" };
  }
  if (tournament.state === "registration") {
    return entrants.length < tournament.maxEntrants ? { ok: true, kind: "entrant" } : { ok: true, kind: "waitlist" };
  }
  // Post-close but pre-play: the field is generated but nothing has been played — queue on the
  // waitlist so a kick can promote. Once a match is played (or complete/cancelled), no new joins.
  if (tournament.state === "in_progress" && tournament.bracket !== null && !hasProgress(tournament.bracket)) {
    return { ok: true, kind: "waitlist" };
  }
  return { ok: false, error: "registration is closed" };
}

/** Build a fresh entrant row (active or waitlisted). */
export function makeEntrant(
  tournamentId: string,
  participant: Participant,
  presetName: string,
  now: number,
  waitlisted: boolean,
): EntrantRecord {
  return {
    tournamentId,
    participant,
    name: participant,
    presetName,
    seed: null,
    registeredAt: now,
    waitlisted,
  };
}

/** The outcome of an admin KICK (design doc scenarios 2, 3, 8). */
export type KickResult =
  | {
      ok: true;
      /** "registration" (still open) / "reopen" (was closed at cap, now reopened) / "walkover" (mid-tournament). */
      kind: "registration" | "reopen" | "walkover";
      /** The tournament AFTER the kick (state/bracket possibly changed; seeds cleared on reopen). */
      tournament: TournamentRecord;
      /** The participant removed from the FIELD (kept as a kicked entrant row on a walkover). */
      removed: Participant;
      /** True on a walkover: the removed player stays an entrant row, flagged kicked on the bracket. */
      keepEntrantRow: boolean;
      /** A waitlisted participant promoted into the freed slot, or null. */
      promoted: Participant | null;
    }
  | { ok: false; error: string };

/**
 * Admin KICK of an entrant. Behavior depends on state (design doc):
 *  - REGISTRATION: remove the entrant; if the waitlist is non-empty, promote its FIRST member into
 *    the freed slot (scenario 8). Registration stays open (scenario 2).
 *  - IN-PROGRESS, no match played yet (auto-closed at cap): REOPEN — drop the bracket, revert to
 *    registration, remove the entrant, promote the first waitlisted member (scenario 2's reopen clause).
 *  - IN-PROGRESS, a match already played: WALKOVER — the kicked player's opponent auto-advances; the
 *    kicked player's row is kept and flagged on the bracket so the board shows them kicked (scenario 3).
 *  - COMPLETE / CANCELLED: rejected.
 * `waitlist` MUST be ordered by registration time (first = next to promote).
 */
export function kickEntrant(
  tournament: TournamentRecord,
  entrants: EntrantRecord[],
  waitlist: EntrantRecord[],
  target: Participant,
  now: number,
): KickResult {
  const isEntrant = entrants.some(e => e.participant === target);
  const isWaitlisted = waitlist.some(e => e.participant === target);
  if (!isEntrant && !isWaitlisted) {
    return { ok: false, error: "not an entrant" };
  }
  if (tournament.state === "complete" || tournament.state === "cancelled") {
    return { ok: false, error: "tournament already ended" };
  }

  // Kicking a WAITLISTED player is just a waitlist removal (no field slot freed, no promotion).
  if (!isEntrant && isWaitlisted) {
    return { ok: true, kind: "registration", tournament, removed: target, keepEntrantRow: false, promoted: null };
  }

  const promoted = waitlist[0]?.participant ?? null;

  if (tournament.state === "registration") {
    return { ok: true, kind: "registration", tournament, removed: target, keepEntrantRow: false, promoted };
  }

  // state === "in_progress" with a bracket.
  const bracket = tournament.bracket;
  if (bracket === null) {
    return { ok: false, error: "tournament has no bracket" };
  }
  if (!hasProgress(bracket)) {
    // Auto-closed at cap but nothing played yet -> reopen registration (undo the generation).
    const reopened: TournamentRecord = { ...tournament, state: "registration", startedAt: null, bracket: null };
    return { ok: true, kind: "reopen", tournament: reopened, removed: target, keepEntrantRow: false, promoted };
  }
  // A match has been played -> WALKOVER (opponent advances). Keep the kicked entrant row.
  const nextBracket = applyKickWalkover(bracket, target, now);
  const synced = syncCompletion({ ...tournament, bracket: nextBracket });
  return { ok: true, kind: "walkover", tournament: synced, removed: target, keepEntrantRow: true, promoted: null };
}

/** An in-registration EDIT patch (design doc scenario 5). Only editable fields; format LOCKED post-generate. */
export interface TournamentEditPatch {
  name?: string;
  roundWindowMs?: number;
  maxEntrants?: number;
  closeAt?: number | null;
  rewardPool?: RewardPool;
  /** Editable only WHILE in registration (format locks once the bracket generates). */
  battleFormat?: BattleFormat;
  seriesFormat?: SeriesFormat;
}

/**
 * Edit a tournament's config WHILE IN REGISTRATION (design doc scenario 5): rewards, cap, window,
 * close-time, name, and (still-unlocked) battle/series format. Rejected once the bracket generates
 * (format + structure locked). A lowered cap may not drop below the current entrant count.
 */
export function editTournament(
  tournament: TournamentRecord,
  patch: TournamentEditPatch,
  entrantCount: number,
): Result<{ tournament: TournamentRecord }> {
  if (tournament.state !== "registration") {
    return { ok: false, error: "can only edit during registration" };
  }
  const next: TournamentRecord = { ...tournament };
  if (patch.name !== undefined) {
    if (!nameOk(patch.name)) {
      return { ok: false, error: "invalid tournament name" };
    }
    next.name = patch.name.trim();
  }
  if (patch.roundWindowMs !== undefined) {
    next.roundWindowMs = clampRoundWindow(patch.roundWindowMs);
  }
  if (patch.maxEntrants !== undefined) {
    const capped = clampMaxEntrants(patch.maxEntrants);
    if (capped < entrantCount) {
      return { ok: false, error: "cap cannot be below the current entrant count" };
    }
    next.maxEntrants = capped;
  }
  if (patch.closeAt !== undefined) {
    next.closeAt =
      typeof patch.closeAt === "number" && Number.isFinite(patch.closeAt) ? Math.floor(patch.closeAt) : null;
  }
  if (patch.rewardPool !== undefined) {
    next.rewardPool = sanitizeRewardPool(patch.rewardPool);
  }
  if (patch.battleFormat !== undefined) {
    next.battleFormat = coerceBattleFormat(patch.battleFormat);
  }
  if (patch.seriesFormat !== undefined) {
    next.seriesFormat = coerceSeriesFormat(patch.seriesFormat);
  }
  return { ok: true, tournament: next };
}

/**
 * RE-SEED / regenerate the bracket while NO match has been played (design doc scenario 7). Valid
 * only when the tournament is in_progress with a generated bracket that has zero progress (only
 * byes may have auto-resolved). Re-runs seeding + generation off the CURRENT active field.
 */
export function reseedTournament(
  tournament: TournamentRecord,
  entrants: EntrantRecord[],
  rankOf: (participant: Participant) => number | null,
  now: number,
): Result<{ tournament: TournamentRecord; seeded: { participant: Participant; seed: number }[] }> {
  if (tournament.state !== "in_progress" || tournament.bracket === null) {
    return { ok: false, error: "can only reseed a started tournament" };
  }
  if (hasProgress(tournament.bracket)) {
    return { ok: false, error: "cannot reseed after a match has been played" };
  }
  const active = entrants.filter(e => !e.waitlisted);
  if (active.length < MIN_ENTRANTS) {
    return { ok: false, error: "not enough entrants to reseed" };
  }
  const seeded = seedEntrants(active, rankOf);
  const bracket = generateBracket(tournament.id, seeded, tournament.roundWindowMs, now);
  return { ok: true, tournament: { ...tournament, startedAt: now, bracket }, seeded };
}

/**
 * LAZY scheduled-registration-close (design doc scenario 1 / "no cron"): if a closeAt is set and
 * has passed while the tournament is still in registration with enough entrants, close + generate
 * NOW (called at the top of every read/register handler). Returns the (possibly) closed tournament
 * plus the assigned seeds when it fired. `entrants` is the ACTIVE field (waitlist excluded).
 */
export function applyScheduledClose(
  tournament: TournamentRecord,
  entrants: EntrantRecord[],
  rankOf: (participant: Participant) => number | null,
  now: number,
): { tournament: TournamentRecord; closed: boolean; seeded: { participant: Participant; seed: number }[] } {
  if (
    tournament.state !== "registration"
    || tournament.closeAt === null
    || now < tournament.closeAt
    || entrants.length < MIN_ENTRANTS
  ) {
    return { tournament, closed: false, seeded: [] };
  }
  const res = closeRegistration(tournament, entrants, rankOf, now);
  if (!res.ok) {
    return { tournament, closed: false, seeded: [] };
  }
  return { tournament: res.tournament, closed: true, seeded: res.seeded };
}

/** A concrete per-account grant computed from the reward pool + final placements. */
export interface RewardGrant {
  participant: Participant;
  place: RewardPlace;
  mutations: TournamentRewardMutation[];
}

/**
 * Map the reward pool onto real accounts using the final placements (design doc scenario 10).
 * champion -> the champion; runnerUp -> the final loser; semifinalist -> EACH semifinal loser.
 * Returns one RewardGrant per (place, account) with mutations. Empty when the tournament is not
 * complete or the pool is empty. PURE — the actual APPLICATION runs through the settlement pipeline.
 */
export function computeRewardGrants(tournament: TournamentRecord): RewardGrant[] {
  if (tournament.bracket === null || !isComplete(tournament.bracket) || tournament.rewardPool.length === 0) {
    return [];
  }
  const placements = computePlacements(tournament.bracket);
  const grants: RewardGrant[] = [];
  for (const entry of tournament.rewardPool) {
    if (entry.mutations.length === 0) {
      continue;
    }
    if (entry.place === "champion" && placements.champion) {
      grants.push({ participant: placements.champion, place: "champion", mutations: entry.mutations });
    } else if (entry.place === "runnerUp" && placements.runnerUp) {
      grants.push({ participant: placements.runnerUp, place: "runnerUp", mutations: entry.mutations });
    } else if (entry.place === "semifinalist") {
      for (const semi of placements.semifinalists) {
        grants.push({ participant: semi, place: "semifinalist", mutations: entry.mutations });
      }
    }
  }
  return grants;
}

// #region reward -> settlement translation (delivery)

/**
 * A client-applicable settlement mutation (mirrors ShowdownSettlementMutation in
 * src/data/elite-redux/showdown/showdown-settlement.ts — the worker cannot import client code).
 * Only the account-mutating kinds are deliverable through the settlement pipeline.
 */
export type TournamentSettlementMutation =
  | { kind: "grantUnlock"; speciesId: number; shiny: boolean; variant: number; erBlackShiny: boolean; cost: number }
  | { kind: "grantCandy"; speciesId: number; candy: number }
  | { kind: "grantShinyLabLook"; speciesId: number; savedLook: number[] };

/** One winner's deliverable mutation, keyed by account username (the settlement store's uid column). */
export interface TournamentGrantSettlement {
  uid: Participant;
  mutation: TournamentSettlementMutation;
}

/** Result of pushing grants into the settlement store (server-to-server). */
export interface GrantDeliveryResult {
  ok: boolean;
  delivered: number;
  error?: string;
}

/**
 * Default seeded-roll pool for a random-shiny reward when the organizer supplies none: the
 * three starter species of every generation (recognizable, always-valid shiny grants).
 */
export const DEFAULT_RANDOM_SHINY_POOL: readonly number[] = [
  1, 4, 7, 25, 152, 155, 158, 252, 255, 258, 387, 390, 393, 495, 498, 501, 650, 653, 656, 722, 725, 728, 810, 813, 816,
];

/** Deterministic 32-bit FNV-1a hash of a string (seeds the random-shiny roll — stable across recomputes). */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Map a shiny tier to the (variant, erBlackShiny) unlock encoding used by the settlement apply. */
function tierToUnlock(tier: ShinyTier): { variant: number; erBlackShiny: boolean } {
  // T1->variant 0, T2->variant 1, T3->variant 2, T4->black (variant 2 + erBlackShiny).
  return tier === 4 ? { variant: 2, erBlackShiny: true } : { variant: tier - 1, erBlackShiny: false };
}

/** Default shiny-lab render params (all-ones) as the 11 trailing bytes of a saved-look array. */
const LAB_DEFAULT_PARAM_BYTES: readonly number[] = [255, 255, 255, 96, 0, 0, 0, 0, 0, 70, 85];

/** Build the 14-element shiny-lab saved-look for a single effect in one category (rest = none/default). */
function buildLabSavedLook(category: LabEffectCategory, effectIndex: number): number[] {
  const loadout = [0, 0, 0];
  const slot = category === "palette" ? 0 : category === "surface" ? 1 : 2;
  loadout[slot] = Math.max(0, Math.floor(effectIndex));
  return [...loadout, ...LAB_DEFAULT_PARAM_BYTES];
}

/** Resolve a random-shiny mutation's species deterministically (seeded by tournament/participant/index). */
function rollRandomShinySpecies(
  mut: Extract<TournamentRewardMutation, { kind: "grantShinyRandom" }>,
  seed: string,
): number {
  if (typeof mut.resolvedSpeciesId === "number") {
    return mut.resolvedSpeciesId;
  }
  const pool = mut.speciesPool.length > 0 ? mut.speciesPool : DEFAULT_RANDOM_SHINY_POOL;
  return pool[fnv1a(seed) % pool.length];
}

/**
 * Translate ONE reward mutation into zero or more client settlement mutations for a given winner.
 * `seed` seeds the random-shiny roll (deterministic per participant+place+index). Currency/item
 * kinds have no account-mutation representation and are intentionally dropped here (they remain in
 * the reward pool / computeRewardGrants for the record, but are not settlement-delivered — P3).
 */
function translateRewardMutation(mut: TournamentRewardMutation, seed: string): TournamentSettlementMutation[] {
  switch (mut.kind) {
    case "grantShinyChosen": {
      const { variant, erBlackShiny } = tierToUnlock(mut.tier);
      return [{ kind: "grantUnlock", speciesId: mut.speciesId, shiny: true, variant, erBlackShiny, cost: 0 }];
    }
    case "grantShinyRandom": {
      const speciesId = rollRandomShinySpecies(mut, seed);
      const { variant, erBlackShiny } = tierToUnlock(mut.tier);
      return [{ kind: "grantUnlock", speciesId, shiny: true, variant, erBlackShiny, cost: 0 }];
    }
    case "grantLabEffect":
      return [
        {
          kind: "grantShinyLabLook",
          speciesId: mut.speciesId,
          savedLook: buildLabSavedLook(mut.category, mut.effectIndex),
        },
      ];
    case "grantUnlock":
      return [
        {
          kind: "grantUnlock",
          speciesId: mut.speciesId,
          shiny: mut.shiny,
          variant: mut.variant,
          erBlackShiny: mut.erBlackShiny,
          cost: mut.cost,
        },
      ];
    case "grantCandy":
      return [{ kind: "grantCandy", speciesId: mut.speciesId, candy: mut.candy }];
  }
}

/**
 * Materialize a completed tournament's reward pool into the deliverable per-winner settlement
 * mutations (the payload pushed into the settlement store for the login sweep to apply). Random
 * shinies are resolved deterministically (seeded per participant+place+index) so repeated calls
 * produce byte-identical output. PURE — delivery/idempotency is the caller's concern.
 */
export function tournamentGrantSettlements(tournament: TournamentRecord): TournamentGrantSettlement[] {
  const out: TournamentGrantSettlement[] = [];
  for (const grant of computeRewardGrants(tournament)) {
    grant.mutations.forEach((mut, idx) => {
      const seed = `${tournament.id}:${grant.participant}:${grant.place}:${idx}`;
      for (const settlement of translateRewardMutation(mut, seed)) {
        out.push({ uid: grant.participant, mutation: settlement });
      }
    });
  }
  return out;
}

// #endregion
