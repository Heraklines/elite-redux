/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — CHALLENGE notifications (Showdown Tournament P3 polish).
// A concrete notification TYPE + pull SOURCE wired into the shared, type-agnostic
// `notificationManager` (same framework as the ghost-battle inbox). It surfaces a
// title-screen alert when a tournament match becomes ACTIONABLE for you:
//   - "ready": your pairing is set (bracket generated / advanced) and undecided.
//   - "present": your opponent is currently in the tournament lobby, challenging you.
// Each notification carries a DEEP-LINK target ({tournamentId, round, slot}); the
// inbox opens the tournament BOARD on that match (A: FIGHT from there). Ids are
// STABLE per (tournament, match, kind) so the manager dedupes to once-per-state-
// change (no spam every poll tick). Never fires mid-battle: the source only runs
// during the inbox refresh, which is title/menu-scoped.
// =============================================================================

import { loggedInUser } from "#app/account";
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { getTournamentBracket, listTournaments } from "#data/elite-redux/showdown/tournament-client";
import {
  autoResolutionLabel,
  type BracketMatchView,
  type BracketView,
  isPresent,
  nextMatchFor,
  opponentOf,
  type TournamentView,
} from "#data/elite-redux/showdown/tournament-types";
import { type ErNotification, notificationManager } from "#system/notifications/notification-manager";
import { getCookie } from "#utils/cookies";

export const TOURNAMENT_NOTIF_TYPE = "tournament";

/** Deep-link target: open the tournament board on this match. */
export interface TournamentDeepLink {
  tournamentId: string;
  round: number;
  slot: number;
}

interface TournamentNotifData extends TournamentDeepLink {
  kind: "ready" | "present" | "advanced";
  tournamentName: string;
  opponent: string;
  matchId: string;
  /** For an "advanced" notif: how you advanced without playing (e.g. "Activity win", "Walkover"). */
  reason?: string;
}

/** The P2 auto-resolution kinds that advance a player WITHOUT them playing (drives the "advanced" notif). */
const AUTO_ADVANCE_RESOLUTIONS = new Set(["activity", "seed", "walkover", "series"]);

/**
 * The LATEST (highest-round) match `me` won via a P2/P3 auto-resolution (activity / seed / walkover) —
 * i.e. an advance WITHOUT playing. Returns null when the viewer's progress was all real results/byes.
 */
function latestAutoAdvance(bracket: BracketView, me: string): BracketMatchView | null {
  let best: BracketMatchView | null = null;
  for (const round of bracket.rounds) {
    for (const match of round) {
      if (
        match.winner === me
        && AUTO_ADVANCE_RESOLUTIONS.has(match.resolution)
        && (best === null || match.round > best.round)
      ) {
        best = match;
      }
    }
  }
  return best;
}

// --- deep-link opener singleton (registered by the title phase) --------------
type Opener = (target: TournamentDeepLink) => void;
let flowOpener: Opener | null = null;

/** The title phase registers how to open the tournament board (set null on teardown). */
export function setTournamentFlowOpener(fn: Opener | null): void {
  flowOpener = fn;
}

/** True if a deep-link opener is currently available (we are somewhere safe, e.g. title). */
export function canOpenTournamentDeepLink(): boolean {
  return flowOpener != null;
}

/** Open the tournament board on the notification's match. Returns false if not available. */
export function openTournamentDeepLink(target: TournamentDeepLink): boolean {
  if (flowOpener == null) {
    return false;
  }
  flowOpener(target);
  return true;
}

/** Extract a deep-link target from a tournament notification, or null. */
export function tournamentDeepLinkOf(n: ErNotification): TournamentDeepLink | null {
  if (n.type !== TOURNAMENT_NOTIF_TYPE) {
    return null;
  }
  const d = n.data as Partial<TournamentNotifData> | null;
  if (d == null || typeof d.tournamentId !== "string") {
    return null;
  }
  return { tournamentId: d.tournamentId, round: d.round ?? 0, slot: d.slot ?? 0 };
}

function makeNotif(
  t: TournamentView,
  match: BracketMatchView,
  opponent: string,
  kind: "ready" | "present" | "advanced",
  now: number,
  reason?: string,
): ErNotification {
  return {
    // Stable id => the manager dedupes to once per state change (not once per poll).
    id: `${TOURNAMENT_NOTIF_TYPE}:${t.id}:${match.id}:${kind}`,
    type: TOURNAMENT_NOTIF_TYPE,
    timestamp: now,
    read: false,
    data: {
      tournamentId: t.id,
      round: match.round,
      slot: match.slot,
      kind,
      tournamentName: t.name,
      opponent,
      matchId: match.id,
      ...(reason ? { reason } : {}),
    } satisfies TournamentNotifData,
  };
}

/**
 * PURE derivation: the viewer's ACTIONABLE notifications for a single fetched tournament view.
 * Returns [] unless the viewer is an entrant of an in-progress tournament with a set, undecided
 * next pairing. Emits a "ready" notification for the pairing and, if the opponent is present in
 * the lobby right now, an additional "present" (challenging-you) notification. Stable ids =>
 * the manager dedupes to once per state change. Exported for unit tests.
 */
export function actionableTournamentNotifications(t: TournamentView, me: string, now: number): ErNotification[] {
  if (t.state !== "in_progress" || t.bracket == null) {
    return [];
  }
  if (!t.entrants.some(e => e.participant === me)) {
    return [];
  }
  const out: ErNotification[] = [];

  // (a/b) your NEXT pairing is set + undecided => ready to play (+ present if the opponent is in the lobby).
  const match = nextMatchFor(t.bracket, me);
  if (match != null && match.a != null && match.b != null && match.winner == null) {
    const opponent = opponentOf(match, me);
    if (opponent != null) {
      out.push(makeNotif(t, match, opponent, "ready", now));
      const oppEnt = t.entrants.find(e => e.participant === opponent);
      if (isPresent(oppEnt?.lastSeen, now)) {
        out.push(makeNotif(t, match, opponent, "present", now));
      }
    }
  }

  // (c) P2: you ADVANCED without playing (deadline activity/seed win, or an admin walkover) — inform you.
  const advance = latestAutoAdvance(t.bracket, me);
  if (advance != null) {
    const beaten = opponentOf(advance, me) ?? "your opponent";
    const reason = autoResolutionLabel(advance.resolution) ?? "Advanced";
    out.push(makeNotif(t, advance, beaten, "advanced", now, reason));
  }
  return out;
}

/**
 * Pull source: derive the viewer's ACTIONABLE tournament matches from the live worker state.
 * Best-effort + offline-safe (never throws). Reuses the board's own poll/presence infra
 * (listTournaments + getTournamentBracket); `since` is ignored because the derivation is over
 * the CURRENT bracket state and the manager dedupes by the stable ids.
 */
async function fetchTournamentNotifications(_since: number): Promise<ErNotification[]> {
  const me = loggedInUser?.username;
  const token = getCookie(SESSION_ID_COOKIE_NAME);
  if (!me || !token || typeof fetch !== "function") {
    return [];
  }
  const list = await listTournaments();
  if (!list.ok) {
    return [];
  }
  const now = Date.now();
  const out: ErNotification[] = [];
  for (const summary of list.data.tournaments) {
    // Cheap pre-filter (avoid a bracket fetch for tournaments that can't be actionable).
    if (summary.state !== "in_progress" || !summary.entrants.some(e => e.participant === me)) {
      continue;
    }
    const res = await getTournamentBracket(summary.id);
    if (!res.ok) {
      continue;
    }
    out.push(...actionableTournamentNotifications(res.data.tournament, me, now));
  }
  return out;
}

/**
 * Register the tournament notification TYPE + pull source on the shared manager. Idempotent
 * (safe to call on every title load, like {@linkcode initErNotifications}).
 */
export function initTournamentNotifications(): void {
  notificationManager.registerType({
    type: TOURNAMENT_NOTIF_TYPE,
    summary(n) {
      const d = n.data as TournamentNotifData;
      if (d.kind === "advanced") {
        return `${d.tournamentName}: you advanced without playing (${d.reason ?? "auto"})`;
      }
      if (d.kind === "present") {
        return `${d.opponent} is in the lobby - ${d.tournamentName}`;
      }
      return `${d.tournamentName}: your match vs ${d.opponent} is ready`;
    },
    detail(n) {
      const d = n.data as TournamentNotifData;
      if (d.kind === "advanced") {
        return {
          title: "Advanced without playing",
          body:
            `${d.reason ?? "You advanced"} — you moved on in the ${d.tournamentName} without a match `
            + `(${d.opponent} did not play the round).\n\nOpen the bracket to see your next fight.`,
          customView: TOURNAMENT_NOTIF_TYPE,
        };
      }
      const title = d.kind === "present" ? "Opponent is waiting" : "Tournament match ready";
      const body =
        d.kind === "present"
          ? `${d.opponent} is present in the ${d.tournamentName} lobby and ready to battle.\n\nOpen the bracket and FIGHT.`
          : `Your next ${d.tournamentName} match against ${d.opponent} is set.\n\nOpen the bracket to view it, then FIGHT when ready.`;
      // customView tells the inbox UI to offer the "A: Open bracket" deep-link prompt.
      return { title, body, customView: TOURNAMENT_NOTIF_TYPE };
    },
  });
  notificationManager.registerSource(TOURNAMENT_NOTIF_TYPE, fetchTournamentNotifications);
}
