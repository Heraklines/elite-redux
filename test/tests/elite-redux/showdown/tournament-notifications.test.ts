/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENT — CHALLENGE notification derivation + deep-link (P3 polish).
// PURE unit coverage of the notification source's actionable logic + the dedupe
// rule + the deep-link opener singleton (no network / no GameManager).
// =============================================================================

import {
  actionableTournamentNotifications,
  canOpenTournamentDeepLink,
  openTournamentDeepLink,
  setTournamentFlowOpener,
  TOURNAMENT_NOTIF_TYPE,
  type TournamentDeepLink,
  tournamentDeepLinkOf,
} from "#data/elite-redux/showdown/tournament-notifications";
import type { TournamentView } from "#data/elite-redux/showdown/tournament-types";
import { type ErNotification, notificationManager } from "#system/notifications/notification-manager";
import { afterEach, describe, expect, it } from "vitest";

const NOW = 1_700_000_000_000;

/** A 2-round (4-player) tournament view with Carla paired vs AshK in the semifinal, undecided. */
function view(overrides: Partial<TournamentView> = {}): TournamentView {
  const entrants = [
    { participant: "Carla", name: "Carla", seed: 1, ghost: { name: "Sky Warden" }, lastSeen: null as number | null },
    { participant: "AshK", name: "AshK", seed: 2, ghost: { name: "Emberfist" }, lastSeen: null as number | null },
    { participant: "MistyW", name: "MistyW", seed: 3, ghost: { name: "Tidecaller" }, lastSeen: null as number | null },
    { participant: "BrockH", name: "BrockH", seed: 4, ghost: { name: "Stoneheart" }, lastSeen: null as number | null },
  ];
  return {
    id: "cup",
    name: "Sample Cup",
    organizer: "maintainer",
    state: "in_progress",
    roundWindowMs: 24 * 3_600_000,
    maxEntrants: 4,
    createdAt: NOW,
    startedAt: NOW,
    champion: null,
    entrantCount: 4,
    entrants,
    bracket: {
      size: 4,
      rounds: [
        [
          {
            id: "r0m0",
            round: 0,
            slot: 0,
            a: "Carla",
            b: "AshK",
            winner: null,
            resolution: "pending",
            deadline: null,
            disputed: false,
          },
          {
            id: "r0m1",
            round: 0,
            slot: 1,
            a: "MistyW",
            b: "BrockH",
            winner: null,
            resolution: "pending",
            deadline: null,
            disputed: false,
          },
        ],
        [
          {
            id: "r1m0",
            round: 1,
            slot: 0,
            a: null,
            b: null,
            winner: null,
            resolution: "pending",
            deadline: null,
            disputed: false,
          },
        ],
      ],
    },
    ...overrides,
  };
}

describe("tournament challenge notifications - derivation", () => {
  afterEach(() => {
    notificationManager.clear();
    setTournamentFlowOpener(null);
  });

  it("emits a READY notification when the pairing is set + undecided", () => {
    const out = actionableTournamentNotifications(view(), "Carla", NOW);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe(TOURNAMENT_NOTIF_TYPE);
    expect((out[0].data as any).kind).toBe("ready");
    expect((out[0].data as any).opponent).toBe("AshK");
    // deep-link points at Carla's live match (round 0, slot 0).
    const link = tournamentDeepLinkOf(out[0]);
    expect(link).toEqual({ tournamentId: "cup", round: 0, slot: 0 });
  });

  it("ADDS a PRESENT notification when the opponent is in the lobby now", () => {
    const t = view();
    t.entrants[1].lastSeen = NOW - 10_000; // AshK pinged 10s ago -> present
    const out = actionableTournamentNotifications(t, "Carla", NOW);
    expect(out.map(n => (n.data as any).kind).sort()).toEqual(["present", "ready"]);
  });

  it("red-proof: nothing for a non-entrant / registration / decided / bye", () => {
    // not an entrant
    expect(actionableTournamentNotifications(view(), "Nobody", NOW)).toHaveLength(0);
    // still open for registration (not in progress)
    expect(actionableTournamentNotifications(view({ state: "registration" }), "Carla", NOW)).toHaveLength(0);
    // the match is already decided
    const decided = view();
    decided.bracket!.rounds[0][0].winner = "Carla";
    expect(actionableTournamentNotifications(decided, "Carla", NOW)).toHaveLength(0);
    // a bye (opponent slot empty)
    const bye = view();
    bye.bracket!.rounds[0][0].b = null;
    expect(actionableTournamentNotifications(bye, "Carla", NOW)).toHaveLength(0);
  });

  it("does not surface an opponent's presence stale beyond the freshness window", () => {
    const t = view();
    t.entrants[1].lastSeen = NOW - 10 * 60_000; // 10 min ago -> stale
    const out = actionableTournamentNotifications(t, "Carla", NOW);
    expect(out.map(n => (n.data as any).kind)).toEqual(["ready"]);
  });

  it("DEDUPES to once per state change (stable ids across polls)", () => {
    const first = actionableTournamentNotifications(view(), "Carla", NOW);
    const second = actionableTournamentNotifications(view(), "Carla", NOW + 60_000);
    // ids are identical across the two polls
    expect(second[0].id).toBe(first[0].id);
    // pushing both polls into the manager yields ONE stored notification.
    for (const n of [...first, ...second]) {
      notificationManager.push(n);
    }
    const stored = notificationManager.list().filter(n => n.type === TOURNAMENT_NOTIF_TYPE);
    expect(stored).toHaveLength(1);
  });
});

describe("tournament challenge notifications - deep-link", () => {
  afterEach(() => setTournamentFlowOpener(null));

  it("tournamentDeepLinkOf ignores non-tournament notifications", () => {
    const other: ErNotification = { id: "x", type: "system", timestamp: NOW, read: false, data: {} };
    expect(tournamentDeepLinkOf(other)).toBeNull();
  });

  it("the opener singleton routes a target through the registered flow", () => {
    expect(canOpenTournamentDeepLink()).toBe(false);
    // with no opener, the deep-link is a no-op that reports failure (safe mid-battle etc.)
    expect(openTournamentDeepLink({ tournamentId: "cup", round: 0, slot: 0 })).toBe(false);

    let got: TournamentDeepLink | null = null;
    setTournamentFlowOpener(target => {
      got = target;
    });
    expect(canOpenTournamentDeepLink()).toBe(true);
    expect(openTournamentDeepLink({ tournamentId: "cup", round: 1, slot: 0 })).toBe(true);
    expect(got).toEqual({ tournamentId: "cup", round: 1, slot: 0 });
  });
});
