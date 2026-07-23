import { describe, expect, it } from "vitest";
import {
  COMMUNITY_MAX_ENTRANTS,
  cancelTournament,
  clampRoundWindow,
  closeRegistration,
  createCommunityTournament,
  createTournament,
  DEFAULT_MAX_ENTRANTS,
  DEFAULT_ROUND_WINDOW_MS,
  type EntrantRecord,
  MAX_ROUND_WINDOW_MS,
  MIN_ROUND_WINDOW_MS,
  registerEntrant,
  seedEntrants,
  syncCompletion,
  type TournamentRecord,
  withdrawEntrant,
} from "../../../../workers/er-telemetry/src/tournament";
import { applyResultReport, champion, findMatch } from "../../../../workers/er-telemetry/src/tournament-bracket";

const HOUR = 60 * 60 * 1000;
const noRank = () => null;

function fresh(overrides: Partial<{ roundWindowMs: number; maxEntrants: number }> = {}): TournamentRecord {
  const res = createTournament("t1", "admin", { name: "Spring Cup", ...overrides }, 1000);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.tournament;
}

/** Register `n` entrants into a fresh tournament, returning the entrant rows. */
function withEntrants(t: TournamentRecord, n: number): EntrantRecord[] {
  const rows: EntrantRecord[] = [];
  for (let i = 0; i < n; i++) {
    const res = registerEntrant(t, rows, `player${i + 1}`, `preset${i + 1}`, 1000 + i);
    if (!res.ok) {
      throw new Error(res.error);
    }
    rows.push(res.entrant);
  }
  return rows;
}

describe("clampRoundWindow", () => {
  it("defaults when absent/invalid", () => {
    expect(clampRoundWindow(undefined)).toBe(DEFAULT_ROUND_WINDOW_MS);
    expect(clampRoundWindow(Number.NaN)).toBe(DEFAULT_ROUND_WINDOW_MS);
  });
  it("clamps into the 8h..48h band", () => {
    expect(clampRoundWindow(1 * HOUR)).toBe(MIN_ROUND_WINDOW_MS);
    expect(clampRoundWindow(100 * HOUR)).toBe(MAX_ROUND_WINDOW_MS);
    expect(clampRoundWindow(12 * HOUR)).toBe(12 * HOUR);
  });
});

describe("createTournament", () => {
  it("creates in the registration state with defaults", () => {
    const t = fresh();
    expect(t.state).toBe("registration");
    expect(t.roundWindowMs).toBe(DEFAULT_ROUND_WINDOW_MS);
    expect(t.maxEntrants).toBe(DEFAULT_MAX_ENTRANTS);
    expect(t.bracket).toBeNull();
  });
  it("honors a configured (clamped) round window", () => {
    const t = fresh({ roundWindowMs: 8 * HOUR });
    expect(t.roundWindowMs).toBe(8 * HOUR);
  });
  it("rejects an empty name", () => {
    const res = createTournament("t", "admin", { name: "  " }, 1);
    expect(res.ok).toBe(false);
  });
});

describe("registerEntrant / withdrawEntrant", () => {
  it("registers under cap with a preset", () => {
    const t = fresh();
    const res = registerEntrant(t, [], "alice", "myteam", 1000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.entrant.participant).toBe("alice");
      expect(res.entrant.presetName).toBe("myteam");
      expect(res.entrant.seed).toBeNull();
    }
  });
  it("requires a preset name", () => {
    const t = fresh();
    const res = registerEntrant(t, [], "alice", "", 1000);
    expect(res.ok).toBe(false);
  });
  it("rejects a duplicate registration", () => {
    const t = fresh();
    const rows = withEntrants(t, 1);
    const res = registerEntrant(t, rows, "player1", "again", 1000);
    expect(res.ok).toBe(false);
  });
  it("rejects registration past the cap", () => {
    const t = fresh({ maxEntrants: 2 });
    const rows = withEntrants(t, 2);
    const res = registerEntrant(t, rows, "player3", "p3", 1000);
    expect(res.ok).toBe(false);
  });
  it("rejects registration after registration closes", () => {
    const t = fresh();
    const rows = withEntrants(t, 4);
    const closed = closeRegistration(t, rows, noRank, 2000);
    expect(closed.ok).toBe(true);
    if (closed.ok) {
      const res = registerEntrant(closed.tournament, rows, "late", "team", 3000);
      expect(res.ok).toBe(false);
    }
  });
  it("withdraws before close, rejects unknown / post-close", () => {
    const t = fresh();
    const rows = withEntrants(t, 3);
    expect(withdrawEntrant(t, rows, "player2").ok).toBe(true);
    expect(withdrawEntrant(t, rows, "ghost").ok).toBe(false);
  });
});

describe("seedEntrants", () => {
  it("seeds ranked entrants above unranked, higher rank = lower seed", () => {
    const rows = withEntrants(fresh(), 4); // player1..player4 in reg order
    const ranks: Record<string, number | null> = { player1: 10, player2: null, player3: 50, player4: 20 };
    const seeded = seedEntrants(rows, p => ranks[p] ?? null);
    // ranked desc: player3(50), player4(20), player1(10); then unranked player2
    expect(seeded).toEqual([
      { participant: "player3", seed: 1 },
      { participant: "player4", seed: 2 },
      { participant: "player1", seed: 3 },
      { participant: "player2", seed: 4 },
    ]);
  });
  it("falls back to registration order when all unranked", () => {
    const rows = withEntrants(fresh(), 3);
    const seeded = seedEntrants(rows, noRank);
    expect(seeded.map(s => s.participant)).toEqual(["player1", "player2", "player3"]);
  });
});

describe("closeRegistration", () => {
  it("generates a bracket and flips to in_progress", () => {
    const t = fresh();
    const rows = withEntrants(t, 8);
    const res = closeRegistration(t, rows, noRank, 5000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tournament.state).toBe("in_progress");
      expect(res.tournament.startedAt).toBe(5000);
      expect(res.tournament.bracket?.size).toBe(8);
      expect(res.seeded.length).toBe(8);
    }
  });
  it("rejects when fewer than 2 entrants", () => {
    const t = fresh();
    const rows = withEntrants(t, 1);
    const res = closeRegistration(t, rows, noRank, 5000);
    expect(res.ok).toBe(false);
  });
});

describe("cancelTournament", () => {
  it("cancels an open tournament", () => {
    const t = fresh();
    const res = cancelTournament(t);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tournament.state).toBe("cancelled");
    }
  });
  it("cannot cancel a completed tournament", () => {
    const t = { ...fresh(), state: "complete" as const };
    expect(cancelTournament(t).ok).toBe(false);
  });
});

describe("syncCompletion — end to end", () => {
  it("marks complete and records champion when the final settles", () => {
    const t = fresh();
    const rows = withEntrants(t, 4);
    const closed = closeRegistration(t, rows, noRank, 5000);
    expect(closed.ok).toBe(true);
    if (!closed.ok) {
      return;
    }
    let tour = closed.tournament;
    const b = tour.bracket!;
    const settle = (id: string, w: string) => {
      const m = findMatch(b, id)!;
      applyResultReport(b, m.id, m.a!, w, 1);
      applyResultReport(b, m.id, m.b!, w, 2);
      tour = syncCompletion({ ...tour, bracket: b });
    };
    settle("t1-r0-m0", "player1");
    settle("t1-r0-m1", "player2");
    expect(tour.state).toBe("in_progress");
    settle("t1-r1-m0", "player1");
    expect(tour.state).toBe("complete");
    expect(tour.champion).toBe("player1");
    expect(champion(b)).toBe("player1");
  });
});

describe("createCommunityTournament (P3 community tier)", () => {
  it("clamps the cap to the community max and FORCES the reward pool empty", () => {
    const res = createCommunityTournament(
      "com",
      "bob",
      {
        name: "Bob's Bash",
        maxEntrants: 64,
        rewardPool: [{ place: "champion", mutations: [{ kind: "grantCandy", speciesId: 1, candy: 99 }] }],
      },
      0,
      1000,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.tournament.community).toBe(true);
    expect(res.tournament.maxEntrants).toBe(COMMUNITY_MAX_ENTRANTS);
    expect(res.tournament.rewardPool).toEqual([]);
    expect(res.tournament.organizer).toBe("bob");
  });

  it("anti-spam red-proof: refuses when the creator already has an active tournament", () => {
    const res = createCommunityTournament("com2", "bob", { name: "Second" }, 1, 1000);
    expect(res.ok).toBe(false);
    if (res.ok) {
      return;
    }
    expect(res.error).toMatch(/already have an active tournament/i);
  });

  it("still validates the name (empty name rejected)", () => {
    const res = createCommunityTournament("com3", "bob", { name: "   " }, 0, 1000);
    expect(res.ok).toBe(false);
  });
});
