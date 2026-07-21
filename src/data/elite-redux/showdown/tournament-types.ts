/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — client-side SHARED SHAPE (Showdown Tournament P1). A
// byte-for-byte MIRROR of the worker's serialized bracket/tournament views
// (workers/er-telemetry/src/tournament-bracket.ts + tournament.ts). The worker
// cannot import client code and the client cannot import the worker build, so
// the shape is re-declared here (exactly as showdown-stakes mirrors the escrow
// StakeRecord). The client only RENDERS what the worker sends — the bracket
// ADVANCE is server-authoritative.
// =============================================================================

/** A participant is an account username. `null` in a slot = bye / TBD. */
export type TournamentParticipant = string;

export type TournamentState = "registration" | "in_progress" | "complete" | "cancelled";

export type MatchResolution = "pending" | "bye" | "reported" | "manual" | "walkover";

/** P3: field width at match start (mirror of the worker BattleFormat). */
export type BattleFormat = "singles" | "doubles" | "triples";
/** P3: series wrapper (mirror of the worker SeriesFormat). */
export type SeriesFormat = "single" | "bo3" | "bo5";
/** P3: reward-pool place (mirror of the worker RewardPlace). */
export type RewardPlace = "champion" | "runnerUp" | "semifinalist";

/** P3: a single reward settlement mutation (mirror of the worker TournamentRewardMutation). */
export type TournamentRewardMutation =
  | { kind: "grantUnlock"; speciesId: number; shiny: boolean; variant: number; erBlackShiny: boolean; cost: number }
  | { kind: "grantCandy"; speciesId: number; candy: number }
  | { kind: "grantItem"; itemId: string; count: number }
  | { kind: "grantCurrency"; amount: number };

/** P3: one place's reward definition (mirror of the worker RewardPoolEntry). */
export interface RewardPoolEntry {
  place: RewardPlace;
  mutations: TournamentRewardMutation[];
}

/** Short human label for a battle/series format (list/board chips). */
export function battleFormatLabel(f: BattleFormat | undefined): string {
  return f === "doubles" ? "Doubles" : f === "triples" ? "Triples" : "Singles";
}
export function seriesFormatLabel(f: SeriesFormat | undefined): string {
  return f === "bo3" ? "Best of 3" : f === "bo5" ? "Best of 5" : "Single game";
}

/** One bracket match (mirror of the worker BracketMatch). */
export interface BracketMatchView {
  id: string;
  round: number;
  slot: number;
  a: TournamentParticipant | null;
  b: TournamentParticipant | null;
  winner: TournamentParticipant | null;
  resolution: MatchResolution;
  deadline: number | null;
  disputed: boolean;
}

/** The bracket (mirror of the worker Bracket). */
export interface BracketView {
  size: number;
  rounds: BracketMatchView[][];
  /** P3: participants KICKED mid-tournament (rendered as kicked/eliminated on the board). */
  kicked?: TournamentParticipant[];
}

/** True if `participant` was kicked from this bracket (board renders them as kicked). */
export function isKickedParticipant(bracket: BracketView, participant: TournamentParticipant | null): boolean {
  return participant !== null && (bracket.kicked?.includes(participant) ?? false);
}

/**
 * The entrant's ghost-trainer APPEARANCE SUMMARY (P1.5 board) — mirror of the worker's
 * GhostIconSummary. Presentation-only: sprite key + authored name + title, drawn as each
 * slot's icon + the opponent card. Untrusted (peer-authored) — re-sanitized on receipt via
 * {@linkcode sanitizeGhostIconSummary} (the ghost-profile rule).
 */
export interface GhostIconSummary {
  /** Trainer atlas key (TrainerConfig.getSpriteKey), e.g. "veteran" / "ace_trainer_f". */
  spriteKey?: string;
  /** Authored display name (falls back to the username when absent). */
  name?: string;
  /** Authored title prefix. */
  title?: string;
}

/** One entrant summary in a tournament view. */
export interface EntrantView {
  participant: TournamentParticipant;
  name: string;
  seed: number | null;
  /** P1.5: ghost-trainer appearance summary (null for old registrations -> fallback icon). */
  ghost?: GhostIconSummary | null;
  /** P1.5: epoch ms of this entrant's last presence ping (null = never seen). */
  lastSeen?: number | null;
  /** P3: the saved team preset the entrant registered with (admin surface). */
  presetName?: string;
}

/** P3: a waitlisted (beyond-cap) entrant summary (admin surface). */
export interface WaitlistEntryView {
  participant: TournamentParticipant;
  name: string;
  ghost?: GhostIconSummary | null;
  lastSeen?: number | null;
  presetName?: string;
}

/** Field caps (mirror er-ghost-profile GHOST_NAME_MAX / GHOST_TITLE_MAX). */
const GHOST_ICON_NAME_MAX = 24;
const GHOST_ICON_TITLE_MAX = 32;
const GHOST_ICON_KEY_MAX = 40;

/**
 * Re-sanitize an untrusted ghost-icon summary on RECEIPT (the ghost-profile rule): the sprite
 * KEY is clamped to a strict `[a-z0-9_]` trainer-atlas token (no arbitrary path), name/title
 * are control-stripped + length-clamped. Returns null when nothing meaningful survives.
 */
export function sanitizeGhostIconSummary(raw: unknown): GhostIconSummary | null {
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
  const clamp = (v: unknown, max: number): string | undefined => {
    if (typeof v !== "string") {
      return;
    }
    const cleaned = [...v]
      .filter(ch => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
      .join("")
      .trim();
    return cleaned.length === 0 ? undefined : cleaned.slice(0, max);
  };
  const name = clamp(r.name, GHOST_ICON_NAME_MAX);
  if (name) {
    out.name = name;
  }
  const title = clamp(r.title, GHOST_ICON_TITLE_MAX);
  if (title) {
    out.title = title;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Presence freshness window: an entrant pinged within this is considered "present" (A: FIGHT). */
export const PRESENCE_FRESH_MS = 90_000;

/** True if the entrant's last ping is fresh enough to count as present in the lobby now. */
export function isPresent(lastSeen: number | null | undefined, now: number): boolean {
  return typeof lastSeen === "number" && now - lastSeen <= PRESENCE_FRESH_MS;
}

/** Format a last-seen timestamp as a short "just now" / "Xm ago" / "Xh ago" / "Xd ago" string. */
export function formatLastSeen(lastSeen: number | null | undefined, now: number): string {
  if (typeof lastSeen !== "number") {
    return "not seen yet";
  }
  const ms = Math.max(0, now - lastSeen);
  if (ms < 60_000) {
    return "just now";
  }
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/** The full tournament view (list is the same minus `bracket`). */
export interface TournamentView {
  id: string;
  name: string;
  organizer: TournamentParticipant;
  state: TournamentState;
  roundWindowMs: number;
  maxEntrants: number;
  createdAt: number;
  startedAt: number | null;
  champion: TournamentParticipant | null;
  entrantCount: number;
  entrants: EntrantView[];
  /** P3: field width at match start (storage/exposure; engine enforcement separate). */
  battleFormat?: BattleFormat;
  /** P3: series wrapper (single / bo3 / bo5). */
  seriesFormat?: SeriesFormat;
  /** P3: per-place reward definitions (settlement mutation vocabulary). */
  rewardPool?: RewardPoolEntry[];
  /** P3: optional scheduled registration close (epoch ms). null = none. */
  closeAt?: number | null;
  /** P3: true once the reward pool has been granted at completion. */
  rewardsGranted?: boolean;
  /** P3: entrants queued beyond cap (admin surface). */
  waitlist?: WaitlistEntryView[];
  /** Present on the bracket endpoint; omitted (undefined) in the list endpoint. */
  bracket?: BracketView | null;
}

/** Find a participant's NEXT playable/undecided match (their current front), or null. */
export function nextMatchFor(bracket: BracketView, participant: TournamentParticipant): BracketMatchView | null {
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (match.winner === null && (match.a === participant || match.b === participant)) {
        return match;
      }
    }
  }
  return null;
}

/** The opponent of `participant` in a match, or null (bye/TBD/not in match). */
export function opponentOf(match: BracketMatchView, participant: TournamentParticipant): TournamentParticipant | null {
  if (match.a === participant) {
    return match.b;
  }
  if (match.b === participant) {
    return match.a;
  }
  return null;
}

/** True once the bracket final is decided. */
export function isBracketComplete(bracket: BracketView): boolean {
  const last = bracket.rounds.at(-1);
  return last !== undefined && last[0].winner !== null;
}

/** A short human label for a round given the total round count (Final / Semifinal / Round N). */
export function roundLabel(roundIndex: number, totalRounds: number): string {
  const fromEnd = totalRounds - 1 - roundIndex;
  if (fromEnd === 0) {
    return "Final";
  }
  if (fromEnd === 1) {
    return "Semifinal";
  }
  if (fromEnd === 2) {
    return "Quarterfinal";
  }
  return `Round ${roundIndex + 1}`;
}

/** Format a deadline as a short "Xh Ym left" / "past due" countdown against `now`. */
export function formatDeadline(deadline: number | null, now: number): string {
  if (deadline === null) {
    return "";
  }
  const ms = deadline - now;
  if (ms <= 0) {
    return "past due";
  }
  const hours = Math.floor(ms / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h left`;
  }
  if (hours > 0) {
    return `${hours}h ${mins}m left`;
  }
  return `${mins}m left`;
}
