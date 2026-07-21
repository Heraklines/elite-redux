import { describe, expect, it } from "vitest";
// P3 — ADMIN OPS domain unit tests (design doc "P3 — ADMIN OPS + FORMATS"). Every
// transition + the three RED-PROOFS the spec calls out: kick-walkover advances the
// RIGHT player; waitlist promotion order (FIFO); reseed only at zero-played.
import {
  applyScheduledClose,
  clampMaxEntrants,
  classifyRegistration,
  closeRegistration,
  coerceBattleFormat,
  coerceSeriesFormat,
  computeRewardGrants,
  createTournament,
  type EntrantRecord,
  editTournament,
  kickEntrant,
  MAX_ENTRANTS,
  makeEntrant,
  registerEntrant,
  reseedTournament,
  sanitizeRewardPool,
  syncCompletion,
  type TournamentRecord,
} from "../../../../workers/er-telemetry/src/tournament";
import {
  applyKickWalkover,
  applyResultReport,
  computePlacements,
  findMatch,
  hasProgress,
  isKicked,
  matchesPlayedCount,
} from "../../../../workers/er-telemetry/src/tournament-bracket";

const noRank = () => null;

function fresh(overrides: Partial<Parameters<typeof createTournament>[2]> = {}): TournamentRecord {
  const res = createTournament("t1", "admin", { name: "Cup", ...overrides }, 1000);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.tournament;
}

/** Register n active entrants (registration order preserved). */
function withEntrants(t: TournamentRecord, n: number, prefix = "p"): EntrantRecord[] {
  const rows: EntrantRecord[] = [];
  for (let i = 0; i < n; i++) {
    const res = registerEntrant(t, rows, `${prefix}${i + 1}`, `preset${i + 1}`, 1000 + i);
    if (!res.ok) {
      throw new Error(res.error);
    }
    rows.push({ ...res.entrant, waitlisted: false });
  }
  return rows;
}

/** Close a fresh tournament into an in_progress bracket. */
function started(t: TournamentRecord, entrants: EntrantRecord[], now = 2000): TournamentRecord {
  const res = closeRegistration(t, entrants, noRank, now);
  if (!res.ok) {
    throw new Error(res.error);
  }
  // seeds are on res.seeded; mirror them onto the entrant rows (the route persists these)
  for (const s of res.seeded) {
    const row = entrants.find(e => e.participant === s.participant);
    if (row) {
      row.seed = s.seed;
    }
  }
  return res.tournament;
}

/** Settle a match by dual agreeing reports (creates real progress). */
function settle(t: TournamentRecord, matchId: string, winner: string): void {
  const b = t.bracket!;
  const m = findMatch(b, matchId)!;
  applyResultReport(b, matchId, m.a!, winner, 1);
  applyResultReport(b, matchId, m.b!, winner, 2);
}

// =============================================================================

describe("format + cap coercion", () => {
  it("clamps cap to [2, 64]", () => {
    expect(clampMaxEntrants(1)).toBe(2);
    expect(clampMaxEntrants(999)).toBe(MAX_ENTRANTS);
    expect(clampMaxEntrants(32)).toBe(32);
    expect(clampMaxEntrants(undefined)).toBe(16);
  });
  it("coerces battle/series format with defaults", () => {
    expect(coerceBattleFormat("doubles")).toBe("doubles");
    expect(coerceBattleFormat("nonsense")).toBe("singles");
    expect(coerceSeriesFormat("bo5")).toBe("bo5");
    expect(coerceSeriesFormat(42)).toBe("single");
  });
  it("createTournament stores formats + reward pool + closeAt", () => {
    const t = fresh({
      battleFormat: "triples",
      seriesFormat: "bo3",
      closeAt: 999,
      rewardPool: [{ place: "champion", mutations: [{ kind: "grantCurrency", amount: 100 }] }],
    });
    expect(t.battleFormat).toBe("triples");
    expect(t.seriesFormat).toBe("bo3");
    expect(t.closeAt).toBe(999);
    expect(t.rewardPool).toHaveLength(1);
    expect(t.rewardsGranted).toBe(false);
  });
});

describe("sanitizeRewardPool", () => {
  it("drops unknown places + malformed mutations, clamps negatives", () => {
    const pool = sanitizeRewardPool([
      { place: "champion", mutations: [{ kind: "grantCurrency", amount: -50 }] },
      { place: "bogus", mutations: [{ kind: "grantCurrency", amount: 10 }] },
      { place: "runnerUp", mutations: [{ kind: "nope" }, { kind: "grantCandy", speciesId: 25, candy: 5 }] },
      "garbage",
    ]);
    expect(pool).toEqual([
      { place: "champion", mutations: [{ kind: "grantCurrency", amount: 0 }] },
      { place: "runnerUp", mutations: [{ kind: "grantCandy", speciesId: 25, candy: 5 }] },
    ]);
  });
  it("returns [] for non-arrays", () => {
    expect(sanitizeRewardPool(null)).toEqual([]);
    expect(sanitizeRewardPool({})).toEqual([]);
  });
});

describe("classifyRegistration", () => {
  it("under cap in registration -> entrant", () => {
    const t = fresh({ maxEntrants: 4 });
    const res = classifyRegistration(t, withEntrants(t, 2), [], "new", "team");
    expect(res).toEqual({ ok: true, kind: "entrant" });
  });
  it("at cap in registration -> waitlist (beyond cap)", () => {
    const t = fresh({ maxEntrants: 4 });
    const res = classifyRegistration(t, withEntrants(t, 4), [], "new", "team");
    expect(res).toEqual({ ok: true, kind: "waitlist" });
  });
  it("post-close but pre-play -> waitlist", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const t2 = started(t, rows);
    const res = classifyRegistration(t2, rows, [], "new", "team");
    expect(res).toEqual({ ok: true, kind: "waitlist" });
  });
  it("after a match is played -> rejected", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const t2 = started(t, rows);
    settle(t2, t2.bracket!.rounds[0][0].id, t2.bracket!.rounds[0][0].a!);
    const res = classifyRegistration(t2, rows, [], "new", "team");
    expect(res.ok).toBe(false);
  });
  it("rejects a dup across BOTH the field and the waitlist", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 2);
    const wl = [makeEntrant(t.id, "waiter", "team", 5000, true)];
    expect(classifyRegistration(t, rows, wl, "p1", "team").ok).toBe(false);
    expect(classifyRegistration(t, rows, wl, "waiter", "team").ok).toBe(false);
  });
  it("requires a preset", () => {
    const t = fresh();
    expect(classifyRegistration(t, [], [], "new", "").ok).toBe(false);
  });
});

describe("kickEntrant — registration (scenario 2/8)", () => {
  it("under cap, no waitlist -> frees the slot, stays in registration", () => {
    const t = fresh({ maxEntrants: 8 });
    const rows = withEntrants(t, 3);
    const res = kickEntrant(t, rows, [], "p2", 9000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.kind).toBe("registration");
      expect(res.removed).toBe("p2");
      expect(res.promoted).toBeNull();
      expect(res.keepEntrantRow).toBe(false);
    }
  });

  // RED-PROOF #2: waitlist promotion order (FIFO — the FIRST-registered waitlisted player).
  it("RED-PROOF: promotes the FIRST waitlisted entrant, never a later one", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const waitlist = [
      makeEntrant(t.id, "early", "team", 100, true),
      makeEntrant(t.id, "middle", "team", 200, true),
      makeEntrant(t.id, "late", "team", 300, true),
    ];
    const res = kickEntrant(t, rows, waitlist, "p1", 9000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.promoted).toBe("early");
      expect(res.promoted).not.toBe("middle");
      expect(res.promoted).not.toBe("late");
    }
  });

  it("kicking a WAITLISTED-only player just removes them (no field slot, no promotion)", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const waitlist = [makeEntrant(t.id, "waiter", "team", 100, true)];
    const res = kickEntrant(t, rows, waitlist, "waiter", 9000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.removed).toBe("waiter");
      expect(res.promoted).toBeNull();
    }
  });

  it("rejects kicking a non-entrant", () => {
    const t = fresh();
    expect(kickEntrant(t, withEntrants(t, 2), [], "ghost", 1).ok).toBe(false);
  });
});

describe("kickEntrant — reopen when auto-closed but nothing played (scenario 2 reopen clause)", () => {
  it("reverts to registration + drops the bracket, promotes the first waitlisted", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const t2 = started(t, rows); // in_progress, bracket generated, zero played
    const waitlist = [makeEntrant(t.id, "sub", "team", 100, true)];
    const res = kickEntrant(t2, rows, waitlist, "p1", 9000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.kind).toBe("reopen");
      expect(res.tournament.state).toBe("registration");
      expect(res.tournament.bracket).toBeNull();
      expect(res.promoted).toBe("sub");
    }
  });
});

describe("kickEntrant — WALKOVER mid-tournament (scenario 3)", () => {
  // RED-PROOF #1: kick-walkover advances the RIGHT player (the kicked player's opponent).
  it("RED-PROOF: the kicked player's OPPONENT advances, no one else", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    let t2 = started(t, rows);
    // create progress by settling one round-0 match
    const b = t2.bracket!;
    const m0 = b.rounds[0][0];
    settle(t2, m0.id, m0.a!);
    t2 = syncCompletion({ ...t2, bracket: b });
    // kick a player in the OTHER round-0 match
    const m1 = b.rounds[0][1];
    const victim = m1.a!;
    const survivor = m1.b!;
    const res = kickEntrant(t2, rows, [], victim, 12345);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.kind).toBe("walkover");
      expect(res.keepEntrantRow).toBe(true);
      const nb = res.tournament.bracket!;
      const after = findMatch(nb, m1.id)!;
      // the SURVIVOR advanced — never the victim, never a third party
      expect(after.winner).toBe(survivor);
      expect(after.winner).not.toBe(victim);
      expect(after.resolution).toBe("walkover");
      // the parent (final) received the survivor, not the victim
      const final = nb.rounds[1][0];
      expect([final.a, final.b]).toContain(survivor);
      expect([final.a, final.b]).not.toContain(victim);
      expect(isKicked(nb, victim)).toBe(true);
    }
  });

  it("rejects kicking from a complete/cancelled tournament", () => {
    const t = { ...fresh(), state: "complete" as const };
    expect(kickEntrant(t, [], [], "x", 1).ok).toBe(false);
    const c = { ...fresh(), state: "cancelled" as const };
    expect(kickEntrant(c, [], [], "x", 1).ok).toBe(false);
  });
});

describe("applyKickWalkover — bracket engine (opponent-TBD cascade)", () => {
  it("a kicked player waiting for a not-yet-decided opponent stays pending until the feeder resolves", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const t2 = started(t, rows);
    const b = t2.bracket!;
    // advance p_a of m0 into the final, so they WAIT in the final (opponent TBD)
    const m0 = b.rounds[0][0];
    const advancer = m0.a!;
    settle(t2, m0.id, advancer);
    const final = b.rounds[1][0];
    expect([final.a, final.b]).toContain(advancer);
    // the final's other slot is TBD (m1 not played). Kick the advancer NOW.
    applyKickWalkover(b, advancer, 5);
    const finalAfter = b.rounds[1][0];
    expect(finalAfter.winner).toBeNull(); // still pending — opponent unknown
    expect(isKicked(b, advancer)).toBe(true);
    // now resolve m1; its winner feeds the final -> a subsequent walkover pass advances them
    const m1 = b.rounds[0][1];
    settle(t2, m1.id, m1.a!);
    applyKickWalkover(b, advancer, 6); // idempotent re-run settles the now-known pairing
    const finalDone = b.rounds[1][0];
    expect(finalDone.winner).toBe(m1.a);
    expect(finalDone.resolution).toBe("walkover");
  });
});

describe("editTournament (scenario 5)", () => {
  it("edits rewards/cap/window/name/format in registration", () => {
    const t = fresh({ maxEntrants: 8 });
    const res = editTournament(
      t,
      {
        name: "New Name",
        maxEntrants: 16,
        roundWindowMs: 12 * 3600_000,
        battleFormat: "doubles",
        seriesFormat: "bo5",
        rewardPool: [{ place: "champion", mutations: [{ kind: "grantCurrency", amount: 1 }] }],
      },
      3,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.tournament.name).toBe("New Name");
      expect(res.tournament.maxEntrants).toBe(16);
      expect(res.tournament.battleFormat).toBe("doubles");
      expect(res.tournament.seriesFormat).toBe("bo5");
      expect(res.tournament.rewardPool).toHaveLength(1);
    }
  });
  it("rejects lowering the cap below the current entrant count", () => {
    const t = fresh({ maxEntrants: 8 });
    expect(editTournament(t, { maxEntrants: 2 }, 5).ok).toBe(false);
  });
  it("rejects any edit once the bracket has generated (format locked)", () => {
    const t = fresh({ maxEntrants: 4 });
    const t2 = started(t, withEntrants(t, 4));
    expect(editTournament(t2, { seriesFormat: "bo3" }, 4).ok).toBe(false);
  });
});

describe("reseedTournament (scenario 7)", () => {
  // RED-PROOF #3: reseed ONLY at zero-played.
  it("RED-PROOF: reseeds while zero played, REJECTS after a match is played", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const t2 = started(t, rows);
    // zero played -> ok
    const ok = reseedTournament(t2, rows, noRank, 3000);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.tournament.bracket).not.toBeNull();
      expect(hasProgress(ok.tournament.bracket!)).toBe(false);
    }
    // play a match -> reseed rejected
    settle(t2, t2.bracket!.rounds[0][0].id, t2.bracket!.rounds[0][0].a!);
    const t3 = syncCompletion(t2);
    expect(reseedTournament(t3, rows, noRank, 4000).ok).toBe(false);
  });
  it("rejects reseeding a tournament that has not started", () => {
    const t = fresh({ maxEntrants: 4 });
    expect(reseedTournament(t, withEntrants(t, 4), noRank, 1).ok).toBe(false);
  });
  it("reseeds off the ACTIVE field only (waitlist excluded)", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const t2 = started(t, rows);
    const withWait = [...rows, makeEntrant(t.id, "waiter", "team", 9, true)];
    const res = reseedTournament(t2, withWait, noRank, 3000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.seeded.map(s => s.participant)).not.toContain("waiter");
      expect(res.seeded).toHaveLength(4);
    }
  });
});

describe("applyScheduledClose (scenario 1, lazy — no cron)", () => {
  it("fires once closeAt passed with enough entrants", () => {
    const t = fresh({ maxEntrants: 8, closeAt: 5000 });
    const rows = withEntrants(t, 4);
    const before = applyScheduledClose(t, rows, noRank, 4999);
    expect(before.closed).toBe(false);
    const after = applyScheduledClose(t, rows, noRank, 5001);
    expect(after.closed).toBe(true);
    expect(after.tournament.state).toBe("in_progress");
    expect(after.seeded).toHaveLength(4);
  });
  it("does not fire below MIN_ENTRANTS even past closeAt", () => {
    const t = fresh({ maxEntrants: 8, closeAt: 5000 });
    const res = applyScheduledClose(t, withEntrants(t, 1), noRank, 6000);
    expect(res.closed).toBe(false);
  });
  it("no-op when closeAt is unset", () => {
    const t = fresh({ maxEntrants: 8 });
    expect(applyScheduledClose(t, withEntrants(t, 4), noRank, 9e12).closed).toBe(false);
  });
});

describe("computeRewardGrants + placements (scenario 10)", () => {
  function playOut(): TournamentRecord {
    const t = fresh({
      maxEntrants: 4,
      rewardPool: [
        { place: "champion", mutations: [{ kind: "grantCurrency", amount: 100 }] },
        { place: "runnerUp", mutations: [{ kind: "grantCurrency", amount: 50 }] },
        { place: "semifinalist", mutations: [{ kind: "grantCandy", speciesId: 1, candy: 10 }] },
      ],
    });
    const rows = withEntrants(t, 4);
    let t2 = started(t, rows);
    const b = t2.bracket!;
    // round 0
    const [m0, m1] = [b.rounds[0][0], b.rounds[0][1]];
    settle(t2, m0.id, m0.a!);
    settle(t2, m1.id, m1.a!);
    t2 = syncCompletion({ ...t2, bracket: b });
    // final
    const final = b.rounds[1][0];
    const champ = final.a!;
    settle(t2, final.id, champ);
    return syncCompletion({ ...t2, bracket: b });
  }

  it("maps champion/runnerUp/semifinalists onto real accounts", () => {
    const done = playOut();
    expect(done.state).toBe("complete");
    const placements = computePlacements(done.bracket!);
    const grants = computeRewardGrants(done);
    const champGrant = grants.find(g => g.place === "champion");
    const runnerGrant = grants.find(g => g.place === "runnerUp");
    const semis = grants.filter(g => g.place === "semifinalist");
    expect(champGrant?.participant).toBe(placements.champion);
    expect(runnerGrant?.participant).toBe(placements.runnerUp);
    expect(semis).toHaveLength(2);
    expect(semis.map(s => s.participant).sort()).toEqual(placements.semifinalists.slice().sort());
  });

  it("returns [] when the tournament is not complete", () => {
    const t = fresh({
      maxEntrants: 4,
      rewardPool: [{ place: "champion", mutations: [{ kind: "grantCurrency", amount: 1 }] }],
    });
    const t2 = started(t, withEntrants(t, 4));
    expect(computeRewardGrants(t2)).toEqual([]);
  });
});

describe("bracket progress helpers", () => {
  it("matchesPlayedCount / hasProgress ignore byes, count reported/manual/walkover", () => {
    const t = fresh({ maxEntrants: 4 });
    const rows = withEntrants(t, 4);
    const t2 = started(t, rows);
    const b = t2.bracket!;
    expect(matchesPlayedCount(b)).toBe(0);
    expect(hasProgress(b)).toBe(false);
    settle(t2, b.rounds[0][0].id, b.rounds[0][0].a!);
    expect(matchesPlayedCount(b)).toBe(1);
    expect(hasProgress(b)).toBe(true);
  });
});
