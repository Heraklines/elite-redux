/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 escrow — PURE domain (Task D1). Zero Cloudflare deps: a match
// state machine over plain records, so it imports cleanly into a plain vitest
// (`test/tests/elite-redux/showdown/showdown-escrow.test.ts`) with no CF stub.
// The worker (`index.ts`) persists the records to D1 and calls these functions;
// all decision logic lives HERE so it is exhaustively unit-testable.
//
// TRUST MODEL (design doc "Settlement reality check"): saves are opaque encrypted
// blobs, so the server can NEVER edit a save. Settlement is a LEDGER: the server
// records the outcome + emits MUTATION records; honest clients fetch-and-apply
// them (D2) and re-upload. A hacked client can dodge its OWN local loss, but the
// ledger records it and it can never TAKE an unlock that was not awarded.
//
// DUAL ATTESTATION: both clients report the result. Two AGREEING reports settle;
// a CONFLICT voids (holds released, no transfer). A LONE report settles only when
// the battle actually started (`battlePhaseEntered`) AND the peer has been silent
// past an injected silence timer (the survivor's forfeit/timeout win). A lone
// report before the battle started never settles — the match voids instead.
//
// CONCURRENCY (M4): a stake HOLD is keyed by (uid, staked-unlock), NOT by player — so a
// player MAY have several live matches at once AS LONG AS each stakes a DIFFERENT unlock.
// Two matches trying to hold the SAME unlock for the same uid is what the conditional
// hold-claim rejects; distinct stakes are deliberately allowed to run concurrently.
//
// LAZY FINALIZATION (M1): there is no cron. A lone survivor's report settles only after
// the silence window, so `GET /showdown/pending` sweeps the caller's OPEN matches through
// {@linkcode finalizeExpiredLoneReport} before returning rows — an honest survivor's payout
// materializes the next time it polls, no background job required.
// =============================================================================

/**
 * A staked unlock. Structurally mirrors the client's `StakeOffer`
 * (`src/data/elite-redux/showdown/showdown-stakes.ts`) — the worker cannot import
 * client code, so the shape (and the tier rule below) is re-declared here.
 */
export interface StakeRecord {
  speciesId: number;
  shiny: boolean;
  /** 0 | 1 | 2 — DexAttr DEFAULT_VARIANT / VARIANT_2 / VARIANT_3. */
  variant: number;
  erBlackShiny: boolean;
  /** speciesStarterCosts value for the line (only meaningful when !shiny). */
  cost: number;
}

/** Which role won / is reporting. Mirrors the client `CoopRole`. */
export type MatchRole = "host" | "guest";

/** How a decisive match ended (mirrors the client `ShowdownResultReason`). */
export type ResultReason = "victory" | "forfeit" | "timeout";

/** The lifecycle of an escrow match. */
export type MatchState = "open" | "settled" | "void";

/** One player's attestation of the outcome, with the epoch-ms it first arrived. */
export interface ResultReport {
  winner: MatchRole;
  reason: ResultReason;
  /** Epoch ms of the FIRST report from this role (re-reports keep this fixed). */
  at: number;
}

/**
 * Account identity of a participant. The client has no numeric account id — only its
 * USERNAME (the token's `u`) — so escrow keys by that stable string, not a numeric uid.
 */
export type Participant = string;

/** The authoritative match ledger row (plain data; persisted to D1 by the worker). */
export interface ShowdownMatchRecord {
  id: string;
  hostUid: Participant;
  guestUid: Participant;
  hostStake: StakeRecord;
  guestStake: StakeRecord;
  state: MatchState;
  /** Set true once BOTH clients ping /showdown/battle-entered — gates lone-report settlement. */
  battlePhaseEntered: boolean;
  hostReport: ResultReport | null;
  guestReport: ResultReport | null;
  /** The winning role once settled (null until then / on void). */
  winner: MatchRole | null;
  createdAt: number;
  resolvedAt: number | null;
}

/**
 * A settlement mutation the server stores for ONE uid to fetch-and-apply (D2).
 * The server can't read saves, so the winner ALWAYS gets a `grantUnlock`; the
 * CLIENT decides at apply time whether that becomes a real unlock (unowned) or a
 * candy-conversion (already owned). `grantCandy` is part of the union for a
 * future server-driven candy path but is NOT emitted by `resolveSettlement`.
 */
export type SettlementMutation =
  | {
      uid: Participant;
      kind: "removeUnlock";
      speciesId: number;
      shiny: boolean;
      variant: number;
      erBlackShiny: boolean;
      cost: number;
    }
  | {
      uid: Participant;
      kind: "grantUnlock";
      speciesId: number;
      shiny: boolean;
      variant: number;
      erBlackShiny: boolean;
      cost: number;
    }
  | { uid: Participant; kind: "grantCandy"; speciesId: number; candy: number }
  // Tournament reward path: grant a shiny-lab effect/look on a species (er-telemetry pushes these).
  | { uid: Participant; kind: "grantShinyLabLook"; speciesId: number; savedLook: number[] };

/** The result of registering a match: the fresh record, or a validation error. */
export type RegisterResult = { ok: true; match: ShowdownMatchRecord } | { ok: false; error: string };

/** How far a report advanced the match. */
export type ReportResolution = "pending" | "settled" | "void";

export interface ApplyReportResult {
  match: ShowdownMatchRecord;
  resolution: ReportResolution;
}

const SHINY_TIER_BASE = 100;
const BLACK_SHINY_TIER = SHINY_TIER_BASE + 10;

/**
 * PURE tier valuation — a byte-for-byte mirror of the client's `stakeTier`
 * (`showdown-stakes.ts`). Shinies rank strictly above every non-shiny; ER black
 * shiny tops all. Two stakes may be wagered only when their tiers are EQUAL.
 */
export function stakeTier(offer: StakeRecord): number {
  if (offer.erBlackShiny) {
    return BLACK_SHINY_TIER;
  }
  if (offer.shiny) {
    return SHINY_TIER_BASE + offer.variant;
  }
  return offer.cost;
}

/** PURE: two stakes are wagerable iff their tiers are equal. */
export function stakesMatch(a: StakeRecord, b: StakeRecord): boolean {
  return stakeTier(a) === stakeTier(b);
}

/** Guard: a well-formed stake record (untrusted JSON off the wire). */
export function isStakeRecord(v: unknown): v is StakeRecord {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const s = v as Record<string, unknown>;
  return (
    typeof s.speciesId === "number"
    && Number.isInteger(s.speciesId)
    && typeof s.shiny === "boolean"
    && typeof s.variant === "number"
    && Number.isInteger(s.variant)
    && typeof s.erBlackShiny === "boolean"
    && typeof s.cost === "number"
    && Number.isFinite(s.cost)
  );
}

/**
 * Register a new escrow match. Validates the stakes are same-tier (server-side —
 * a client can't be trusted to enforce it) and the two players are distinct.
 * Returns a fresh `open` record; the worker holds both stakes + inserts the row.
 */
export function registerMatch(
  id: string,
  hostUid: Participant,
  guestUid: Participant,
  hostStake: StakeRecord,
  guestStake: StakeRecord,
  now: number,
): RegisterResult {
  if (!id) {
    return { ok: false, error: "missing match id" };
  }
  if (hostUid === guestUid) {
    return { ok: false, error: "host and guest must be different players" };
  }
  if (!isStakeRecord(hostStake) || !isStakeRecord(guestStake)) {
    return { ok: false, error: "malformed stake" };
  }
  if (!stakesMatch(hostStake, guestStake)) {
    return { ok: false, error: "stakes are not the same tier" };
  }
  return {
    ok: true,
    match: {
      id,
      hostUid,
      guestUid,
      hostStake,
      guestStake,
      state: "open",
      battlePhaseEntered: false,
      hostReport: null,
      guestReport: null,
      winner: null,
      createdAt: now,
      resolvedAt: null,
    },
  };
}

/** Mark that the battle phase was entered (both clients pinged). Idempotent. */
export function recordBattlePhaseEntered(match: ShowdownMatchRecord): ShowdownMatchRecord {
  if (match.battlePhaseEntered || match.state !== "open") {
    return match;
  }
  return { ...match, battlePhaseEntered: true };
}

/** The role of `uid` in this match, or null if it isn't a participant. */
export function roleOf(match: ShowdownMatchRecord, uid: Participant): MatchRole | null {
  if (uid === match.hostUid) {
    return "host";
  }
  if (uid === match.guestUid) {
    return "guest";
  }
  return null;
}

function otherRole(role: MatchRole): MatchRole {
  return role === "host" ? "guest" : "host";
}

function settle(match: ShowdownMatchRecord, winner: MatchRole, now: number): ShowdownMatchRecord {
  return { ...match, state: "settled", winner, resolvedAt: now };
}

/**
 * Apply one player's result report (dual attestation). Rules:
 *  - already resolved (settled/void) → idempotent no-op.
 *  - reporter isn't a participant → unchanged, `pending` (worker rejects the call).
 *  - FIRST report from a role is canonical; a re-report from the same role keeps
 *    the first-seen `winner`/`reason`/`at` (prevents a flip-flop attack) but can
 *    still trigger lone settlement once the silence timer has elapsed.
 *  - BOTH reports present: agree → settled (that winner); conflict → void.
 *  - ONE report present: settles ONLY when `battlePhaseEntered` AND
 *    `now - report.at >= silenceTimeoutMs` (the survivor's lone forfeit/timeout
 *    win). Otherwise `pending` — the peer still has time to attest.
 */
export function applyResultReport(
  match: ShowdownMatchRecord,
  reporterUid: Participant,
  winner: MatchRole,
  reason: ResultReason,
  now: number,
  silenceTimeoutMs: number,
): ApplyReportResult {
  if (match.state === "settled" || match.state === "void") {
    return { match, resolution: match.state };
  }
  const role = roleOf(match, reporterUid);
  if (role === null) {
    return { match, resolution: "pending" };
  }

  // Record the report (first from this role is canonical; re-reports don't overwrite).
  let next = { ...match };
  const existing = role === "host" ? next.hostReport : next.guestReport;
  const report: ResultReport = existing ?? { winner, reason, at: now };
  if (role === "host") {
    next.hostReport = report;
  } else {
    next.guestReport = report;
  }

  // Both attested: agree → settle; conflict → void.
  if (next.hostReport && next.guestReport) {
    if (next.hostReport.winner === next.guestReport.winner) {
      next = settle(next, next.hostReport.winner, now);
      return { match: next, resolution: "settled" };
    }
    next = { ...next, state: "void", winner: null, resolvedAt: now };
    return { match: next, resolution: "void" };
  }

  // Lone report: settle only after the battle started AND the silence timer elapsed.
  if (next.battlePhaseEntered && now - report.at >= silenceTimeoutMs) {
    next = settle(next, report.winner, now);
    return { match: next, resolution: "settled" };
  }
  return { match: next, resolution: "pending" };
}

/**
 * M1 (lazy finalization): settle an OPEN match that has a single lone report, once the battle was
 * entered AND the silence window has elapsed. Called by `GET /showdown/pending` over the caller's
 * open matches (no cron). A no-op (returns `pending`) for a match that isn't a settle-able lone
 * report yet; idempotent for an already-resolved match.
 */
export function finalizeExpiredLoneReport(
  match: ShowdownMatchRecord,
  now: number,
  silenceTimeoutMs: number,
): ApplyReportResult {
  if (match.state === "settled" || match.state === "void") {
    return { match, resolution: match.state };
  }
  if (!match.battlePhaseEntered) {
    return { match, resolution: "pending" };
  }
  const reports = [match.hostReport, match.guestReport].filter((r): r is ResultReport => r !== null);
  if (reports.length !== 1) {
    return { match, resolution: "pending" }; // no report, or both present (applyResultReport handles that)
  }
  const report = reports[0];
  if (now - report.at >= silenceTimeoutMs) {
    return { match: settle(match, report.winner, now), resolution: "settled" };
  }
  return { match, resolution: "pending" };
}

/** Void a match (conflict, illegal team, early disconnect). Idempotent; holds released by the worker. */
export function voidMatch(match: ShowdownMatchRecord, now: number): ShowdownMatchRecord {
  if (match.state !== "open") {
    return match;
  }
  return { ...match, state: "void", winner: null, resolvedAt: now };
}

/**
 * The settlement mutations for a SETTLED match (empty for open/void). The LOSER
 * loses the staked unlock they anted; the WINNER gains it (or, client-side, a
 * candy conversion when already owned). Both mutations reference the LOSER's
 * stake — the winner keeps their own ante and takes the loser's.
 */
export function resolveSettlement(match: ShowdownMatchRecord): SettlementMutation[] {
  if (match.state !== "settled" || match.winner === null) {
    return [];
  }
  const winner = match.winner;
  const loser = otherRole(winner);
  const winnerUid = winner === "host" ? match.hostUid : match.guestUid;
  const loserUid = loser === "host" ? match.hostUid : match.guestUid;
  const loserStake = loser === "host" ? match.hostStake : match.guestStake;
  return [
    {
      uid: loserUid,
      kind: "removeUnlock",
      speciesId: loserStake.speciesId,
      shiny: loserStake.shiny,
      variant: loserStake.variant,
      erBlackShiny: loserStake.erBlackShiny,
      cost: loserStake.cost,
    },
    {
      uid: winnerUid,
      kind: "grantUnlock",
      speciesId: loserStake.speciesId,
      shiny: loserStake.shiny,
      variant: loserStake.variant,
      erBlackShiny: loserStake.erBlackShiny,
      cost: loserStake.cost,
    },
  ];
}
