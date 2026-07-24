/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — CHALLENGE notifications (Showdown Tournament P3 polish).
// A concrete notification TYPE + pull SOURCE wired into the shared, type-agnostic
// `notificationManager` (same framework as the ghost-battle inbox). It surfaces a
// clickable page-level alert when both exact bracket opponents are online.
// Each notification carries a DEEP-LINK target ({tournamentId, round, slot}); the
// inbox opens the tournament BOARD on that match (A: FIGHT from there). Ids are
// STABLE per (tournament, match, kind) so the manager dedupes to once-per-state-
// change (no spam every poll tick). A page-lifetime heartbeat keeps presence current
// during normal gameplay; clicking the alert saves the run and deep-links through title.
// =============================================================================

import { loggedInUser } from "#app/account";
import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import {
  dropOutOfTournament,
  getTournamentBracket,
  listTournaments,
  pingTournamentPresence,
  syncPendingTournamentResults,
} from "#data/elite-redux/showdown/tournament-client";
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
  /** Exact online-pair alerts enter the validated match lobby directly; other notices open the board. */
  autoJoin?: boolean;
}

interface TournamentNotifData extends TournamentDeepLink {
  kind: "match-online" | "advanced";
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
type GameplayOpener = (target: TournamentDeepLink) => boolean;
let flowOpener: Opener | null = null;
let gameplayOpener: GameplayOpener | null = null;
let pendingDeepLink: TournamentDeepLink | null = null;

/** The title phase registers how to open the tournament board (set null on teardown). */
export function setTournamentFlowOpener(fn: Opener | null): void {
  flowOpener = fn;
  if (fn != null && pendingDeepLink != null) {
    const target = pendingDeepLink;
    pendingDeepLink = null;
    queueMicrotask(() => {
      if (flowOpener === fn) {
        fn(target);
      }
    });
  }
}

/** Register the save-and-return bridge used when a match alert is clicked during a normal run. */
export function setTournamentGameplayOpener(fn: GameplayOpener | null): void {
  gameplayOpener = fn;
}

/** True if a deep-link opener is currently available (we are somewhere safe, e.g. title). */
export function canOpenTournamentDeepLink(): boolean {
  return flowOpener != null || gameplayOpener != null;
}

/** Open the tournament board on the notification's match. Returns false if not available. */
export function openTournamentDeepLink(target: TournamentDeepLink): boolean {
  if (flowOpener == null) {
    if (gameplayOpener == null || !gameplayOpener(target)) {
      return false;
    }
    pendingDeepLink = target;
    return true;
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
  return {
    tournamentId: d.tournamentId,
    round: d.round ?? 0,
    slot: d.slot ?? 0,
    ...(d.kind === "match-online" ? { autoJoin: true } : {}),
  };
}

function makeNotif(
  t: TournamentView,
  match: BracketMatchView,
  opponent: string,
  kind: "match-online" | "advanced",
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
 * next pairing. Entrants are always match-ready; the alert becomes actionable once both exact bracket
 * opponents have fresh online-presence heartbeats. Exported for unit tests.
 */
export function actionableTournamentNotifications(t: TournamentView, me: string, now: number): ErNotification[] {
  if (t.state !== "in_progress" || t.bracket == null) {
    return [];
  }
  if (!t.entrants.some(e => e.participant === me)) {
    return [];
  }
  const out: ErNotification[] = [];

  // Your next pairing is actionable when both exact opponents are currently online.
  const match = nextMatchFor(t.bracket, me);
  if (match != null && match.a != null && match.b != null && match.winner == null) {
    const opponent = opponentOf(match, me);
    if (opponent != null) {
      const ownEnt = t.entrants.find(e => e.participant === me);
      const oppEnt = t.entrants.find(e => e.participant === opponent);
      if (isPresent(ownEnt?.lastSeen, now) && isPresent(oppEnt?.lastSeen, now)) {
        out.push(makeNotif(t, match, opponent, "match-online", now));
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
  await syncPendingTournamentResults();
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
    // Entering a tournament means always ready. Heartbeat from title or normal gameplay so the exact
    // opponent can see when this client is genuinely available for the scheduled match.
    await pingTournamentPresence(summary.id);
    const res = await getTournamentBracket(summary.id);
    if (!res.ok) {
      continue;
    }
    out.push(...actionableTournamentNotifications(res.data.tournament, me, now));
  }
  return out;
}

const PRESENCE_POLL_MS = 20_000;
let presencePollTimer: ReturnType<typeof setInterval> | null = null;
let presencePollPending = false;
let activeToast: HTMLDivElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let toastCountdownTimer: ReturnType<typeof setInterval> | null = null;
const MATCH_ACCEPT_MS = 60_000;
const announcedOnlineMatches = new Set<string>();

function dismissTournamentToast(): void {
  if (toastTimer != null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  if (toastCountdownTimer != null) {
    clearInterval(toastCountdownTimer);
    toastCountdownTimer = null;
  }
  activeToast?.remove();
  activeToast = null;
}

export function showTournamentMatchToast(notification: ErNotification): boolean {
  if (typeof document === "undefined" || activeToast != null) {
    return false;
  }
  const data = notification.data as TournamentNotifData;
  const toast = document.createElement("div");
  toast.className = "er-tournament-match-toast";
  toast.setAttribute("role", "alert");

  const copy = document.createElement("div");
  copy.className = "er-tournament-match-toast-copy";
  const title = document.createElement("strong");
  title.textContent = "Tournament match ready";
  const body = document.createElement("span");
  body.textContent = `${data.opponent} is online in ${data.tournamentName}.`;
  copy.append(title, body);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "er-tournament-match-toast-open";
  const deadline = Date.now() + MATCH_ACCEPT_MS;
  const updateCountdown = () => {
    const seconds = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
    open.textContent = `Accept (${seconds}s)`;
  };
  updateCountdown();
  open.addEventListener("click", () => {
    const target = tournamentDeepLinkOf(notification);
    if (target != null && openTournamentDeepLink(target)) {
      dismissTournamentToast();
    }
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "er-tournament-match-toast-close";
  close.setAttribute("aria-label", "Forfeit tournament match");
  close.textContent = "X";
  const forfeit = (message: string, expired = false) => {
    open.disabled = true;
    close.disabled = true;
    body.textContent = message;
    dropOutOfTournament(data.tournamentId)
      .then(result => {
        if (result.ok) {
          dismissTournamentToast();
          return;
        }
        open.disabled = expired;
        close.disabled = false;
        body.textContent = `Could not forfeit: ${result.error}`;
      })
      .catch(() => {
        open.disabled = expired;
        close.disabled = false;
        body.textContent = "Could not reach the tournament server. Try again.";
      });
  };
  close.addEventListener("click", () => {
    const confirmed =
      typeof globalThis.confirm === "function" && globalThis.confirm("Are you sure you want to forfeit the match?");
    if (!confirmed) {
      return;
    }
    forfeit("Forfeiting this tournament match...");
  });

  toast.append(copy, open, close);
  document.body.append(toast);
  activeToast = toast;
  toastCountdownTimer = setInterval(updateCountdown, 1_000);
  toastTimer = setTimeout(() => {
    forfeit("Match acceptance expired. Forfeiting...", true);
  }, MATCH_ACCEPT_MS);
  return true;
}

/** Poll once, heartbeat active entrants, persist inbox items, and surface a live-match alert. */
export async function pollTournamentPresenceNotifications(): Promise<void> {
  if (presencePollPending || (typeof document !== "undefined" && document.visibilityState === "hidden")) {
    return;
  }
  presencePollPending = true;
  try {
    const notifications = await fetchTournamentNotifications(0);
    const onlineNow = new Set(
      notifications.filter(n => (n.data as TournamentNotifData).kind === "match-online").map(n => n.id),
    );
    for (const id of announcedOnlineMatches) {
      if (!onlineNow.has(id)) {
        announcedOnlineMatches.delete(id);
      }
    }
    for (const notification of notifications) {
      notificationManager.push(notification);
      if (
        (notification.data as TournamentNotifData).kind === "match-online"
        && !announcedOnlineMatches.has(notification.id)
        && showTournamentMatchToast(notification)
      ) {
        announcedOnlineMatches.add(notification.id);
      }
    }
  } finally {
    presencePollPending = false;
  }
}

/** Start the page-lifetime tournament heartbeat; idempotent across title-screen reloads. */
export function startTournamentPresenceNotifications(): void {
  if (presencePollTimer != null || import.meta.env.MODE === "test") {
    return;
  }
  void pollTournamentPresenceNotifications();
  presencePollTimer = setInterval(() => void pollTournamentPresenceNotifications(), PRESENCE_POLL_MS);
}

/** Test/logout cleanup for the page-lifetime heartbeat. */
export function stopTournamentPresenceNotifications(): void {
  if (presencePollTimer != null) {
    clearInterval(presencePollTimer);
    presencePollTimer = null;
  }
  dismissTournamentToast();
  announcedOnlineMatches.clear();
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
      return `${d.opponent} is online - ${d.tournamentName}`;
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
      const title = "Tournament match available";
      const body = `${d.opponent} is online for your ${d.tournamentName} match.\n\nOpen the bracket and join the match.`;
      // customView tells the inbox UI to offer the "A: Open bracket" deep-link prompt.
      return { title, body, customView: TOURNAMENT_NOTIF_TYPE };
    },
  });
  notificationManager.registerSource(TOURNAMENT_NOTIF_TYPE, fetchTournamentNotifications);
}
