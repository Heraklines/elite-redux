import { describe, expect, it } from "vitest";
// PURE worker-domain module imported by relative path (workers/ is outside the client
// tsconfig, but the module has ZERO Cloudflare deps so it imports cleanly — the SAME
// worker-test pattern as showdown-escrow.test.ts).
import {
  applyRankedResult,
  applyRankReport,
  diminishedGain,
  FLOOR_RANK,
  initialRankState,
  isFirstWeek,
  MAX_TIER,
  MIN_TIER,
  newRankMatch,
  type OpponentWinCount,
  RANK_TIER,
  type RankState,
  rankRoleOf,
  reconcileSeason,
  SEGMENTS_PER_RANK,
  seasonIdFromTime,
} from "../../../../workers/er-save-api/src/showdown-rank";

// --- time fixtures (UTC) ---------------------------------------------------------------
const MID_JULY = Date.UTC(2026, 6, 15); // 2026-07-15, day 15 (NOT first week)
const EARLY_JULY = Date.UTC(2026, 6, 3); // 2026-07-03, day 3 (FIRST WEEK)
const MID_AUGUST = Date.UTC(2026, 7, 15); // 2026-08-15 (next season)
const JULY = "2026-07";
const AUGUST = "2026-08";

/** A state at an arbitrary position in the CURRENT (July) season for direct math tests. */
function stateAt(tier: number, rank: number, segments: number, extra: Partial<RankState> = {}): RankState {
  return {
    seasonId: JULY,
    tier: tier as RankState["tier"],
    rank,
    segments,
    streak: 0,
    highestTierReached: tier as RankState["tier"],
    careerBestTier: tier as RankState["tier"],
    ...extra,
  };
}

const freshCounter = (seasonId = JULY): OpponentWinCount => ({ seasonId, wins: 0 });

const win = (state: RankState, counter: OpponentWinCount, now = MID_JULY) =>
  applyRankedResult(state, counter, { won: true, now });
const loss = (state: RankState, counter: OpponentWinCount, now = MID_JULY) =>
  applyRankedResult(state, counter, { won: false, now });

// =======================================================================================
describe("season helpers", () => {
  it("derives a YYYY-MM season id in UTC", () => {
    expect(seasonIdFromTime(MID_JULY)).toBe(JULY);
    expect(seasonIdFromTime(MID_AUGUST)).toBe(AUGUST);
    expect(seasonIdFromTime(Date.UTC(2026, 0, 1))).toBe("2026-01");
  });
  it("flags days 1-7 as the first week", () => {
    expect(isFirstWeek(EARLY_JULY)).toBe(true);
    expect(isFirstWeek(Date.UTC(2026, 6, 7))).toBe(true);
    expect(isFirstWeek(Date.UTC(2026, 6, 8))).toBe(false);
    expect(isFirstWeek(MID_JULY)).toBe(false);
  });
  it("initialRankState starts at the pokeball floor and carries career best", () => {
    const s = initialRankState(JULY, RANK_TIER.ultraball);
    expect(s).toMatchObject({
      seasonId: JULY,
      tier: MIN_TIER,
      rank: FLOOR_RANK,
      segments: 0,
      streak: 0,
      highestTierReached: MIN_TIER,
      careerBestTier: RANK_TIER.ultraball,
    });
  });
});

// =======================================================================================
describe("diminishedGain (anti-win-trading curve)", () => {
  it("gives full gain for the first 3 wins vs an opponent", () => {
    for (const k of [1, 2, 3]) {
      expect(diminishedGain(1, k)).toBe(1);
      expect(diminishedGain(2, k)).toBe(2);
    }
  });
  it("halves wins 4-6 (clean half for even, alternating 1/0 for odd base)", () => {
    // even base (+2) halves cleanly to +1 across the whole band
    expect(diminishedGain(2, 4)).toBe(1);
    expect(diminishedGain(2, 5)).toBe(1);
    expect(diminishedGain(2, 6)).toBe(1);
    // odd base (+1) alternates by k parity: k4->1, k5->0, k6->1 (min 0, averages ~half)
    expect(diminishedGain(1, 4)).toBe(1);
    expect(diminishedGain(1, 5)).toBe(0);
    expect(diminishedGain(1, 6)).toBe(1);
  });
  it("gives zero from win 7 onward", () => {
    for (const k of [7, 8, 20]) {
      expect(diminishedGain(1, k)).toBe(0);
      expect(diminishedGain(2, k)).toBe(0);
    }
  });
});

// =======================================================================================
describe("win progression — segments, ranks, tiers", () => {
  it("a single win adds one segment at the floor", () => {
    const r = win(stateAt(MIN_TIER, FLOOR_RANK, 0), freshCounter());
    expect(r.state).toMatchObject({ tier: MIN_TIER, rank: FLOOR_RANK, segments: 1, streak: 1 });
    expect(r.events.won).toBe(true);
  });

  it("segments overflow ranks up within a tier (4 -> 3)", () => {
    const r = win(stateAt(MIN_TIER, FLOOR_RANK, SEGMENTS_PER_RANK - 1), freshCounter());
    expect(r.state).toMatchObject({ tier: MIN_TIER, rank: 3, segments: 0 });
  });

  it("a win at the top rank promotes to the next tier's floor rank", () => {
    const r = win(stateAt(RANK_TIER.pokeball, 1, SEGMENTS_PER_RANK - 1), freshCounter());
    expect(r.state).toMatchObject({ tier: RANK_TIER.greatball, rank: FLOOR_RANK, segments: 0 });
    expect(r.events.tiersFirstReached).toEqual([RANK_TIER.greatball]);
  });

  it("the 4th+ consecutive win grants +2 segments (streak bonus)", () => {
    // Thread state through 4 wins vs DISTINCT opponents (fresh counter each) so the streak
    // bonus is isolated from the anti-win-trading diminishing.
    let s = stateAt(MIN_TIER, FLOOR_RANK, 0);
    for (let i = 0; i < 3; i++) {
      s = win(s, freshCounter()).state;
    }
    expect(s).toMatchObject({ rank: FLOOR_RANK, segments: 3, streak: 3 }); // +1,+1,+1
    const r = win(s, freshCounter());
    // prior streak 3 -> +2: seg 3+2=5 -> rank up to 3, segment 1
    expect(r.state).toMatchObject({ rank: 3, segments: 1, streak: 4 });
  });

  it("champion is a single rank and caps at the top segment (clamp, not banked)", () => {
    const r = win(stateAt(MAX_TIER, 1, SEGMENTS_PER_RANK - 1), freshCounter());
    expect(r.state).toMatchObject({ tier: MAX_TIER, rank: 1, segments: SEGMENTS_PER_RANK - 1 });
  });
});

// =======================================================================================
describe("first-week gate", () => {
  it("clamps progression at masterball rank 4 during days 1-7 (does not bank the overflow)", () => {
    const r = win(stateAt(RANK_TIER.masterball, FLOOR_RANK, SEGMENTS_PER_RANK - 1), freshCounter(), EARLY_JULY);
    expect(r.state).toMatchObject({ tier: RANK_TIER.masterball, rank: FLOOR_RANK, segments: SEGMENTS_PER_RANK - 1 });
  });
  it("lets the same win rank up past masterball rank 4 outside the first week", () => {
    const r = win(stateAt(RANK_TIER.masterball, FLOOR_RANK, SEGMENTS_PER_RANK - 1), freshCounter(), MID_JULY);
    expect(r.state).toMatchObject({ tier: RANK_TIER.masterball, rank: 3, segments: 0 });
  });
  it("does not gate tiers below masterball during the first week", () => {
    const r = win(stateAt(RANK_TIER.ultraball, 1, SEGMENTS_PER_RANK - 1), freshCounter(), EARLY_JULY);
    expect(r.state).toMatchObject({ tier: RANK_TIER.masterball, rank: FLOOR_RANK, segments: 0 });
  });
});

// =======================================================================================
describe("loss progression + tier floor", () => {
  it("a loss subtracts one segment and resets the streak", () => {
    const r = loss(stateAt(RANK_TIER.greatball, 2, 2, { streak: 5 }), freshCounter());
    expect(r.state).toMatchObject({ tier: RANK_TIER.greatball, rank: 2, segments: 1, streak: 0 });
  });
  it("a loss at segment 0 ranks down within the tier (3 -> 4)", () => {
    const r = loss(stateAt(RANK_TIER.greatball, 3, 0), freshCounter());
    expect(r.state).toMatchObject({ tier: RANK_TIER.greatball, rank: FLOOR_RANK, segments: SEGMENTS_PER_RANK - 1 });
  });
  it("TIER FLOOR: a loss at rank 4 segment 0 is absorbed (never demotes the tier)", () => {
    const r = loss(stateAt(RANK_TIER.greatball, FLOOR_RANK, 0), freshCounter());
    expect(r.state).toMatchObject({ tier: RANK_TIER.greatball, rank: FLOOR_RANK, segments: 0 });
  });
  it("the pokeball floor absorbs losses (no negative rank/tier)", () => {
    const r = loss(stateAt(MIN_TIER, FLOOR_RANK, 0), freshCounter());
    expect(r.state).toMatchObject({ tier: MIN_TIER, rank: FLOOR_RANK, segments: 0 });
  });
});

// =======================================================================================
describe("anti-win-trading vs the SAME opponent (integration)", () => {
  it("wins 7+ vs the same opponent grant zero segments (streak/counter still advance)", () => {
    const s = stateAt(RANK_TIER.greatball, 3, 1, { streak: 10 });
    const counter: OpponentWinCount = { seasonId: JULY, wins: 6 };
    const r = win(s, counter);
    expect(r.state.segments).toBe(1); // no movement — gain was 0
    expect(r.opponentWins.wins).toBe(7);
    expect(r.state.streak).toBe(11);
  });
  it("losses never touch the opponent counter and are always full", () => {
    const counter: OpponentWinCount = { seasonId: JULY, wins: 5 };
    const r = loss(stateAt(RANK_TIER.greatball, 2, 2), counter);
    expect(r.opponentWins.wins).toBe(5); // untouched
    expect(r.state.segments).toBe(1); // full -1
  });
  it("full segments for the first three wins vs one opponent", () => {
    let s = stateAt(MIN_TIER, FLOOR_RANK, 0);
    let counter = freshCounter();
    for (let i = 0; i < 3; i++) {
      const r = win(s, counter);
      s = r.state;
      counter = r.opponentWins;
    }
    // 3 full wins from seg 0 -> seg 3 (streak-bonus doesn't kick in until the 4th win)
    expect(s).toMatchObject({ rank: FLOOR_RANK, segments: 3 });
    expect(counter.wins).toBe(3);
  });
});

// =======================================================================================
describe("seasons — reset + career best", () => {
  it("the first ranked action of a new season hard-resets to the pokeball floor", () => {
    const stale = stateAt(RANK_TIER.masterball, 2, 3, {
      seasonId: JULY,
      streak: 4,
      highestTierReached: RANK_TIER.masterball,
      careerBestTier: RANK_TIER.masterball,
    });
    const r = win(stale, { seasonId: JULY, wins: 3 }, MID_AUGUST);
    // reset to pokeball floor THEN apply the win (+1 segment)
    expect(r.state).toMatchObject({
      seasonId: AUGUST,
      tier: MIN_TIER,
      rank: FLOOR_RANK,
      segments: 1,
      careerBestTier: RANK_TIER.masterball, // persists
      highestTierReached: MIN_TIER, // seasonal, reset
    });
    // the prior season's final tier is surfaced for the season-end hook
    expect(r.events.seasonEndedFinalTier).toBe(RANK_TIER.masterball);
    // the opponent counter is season-scoped and resets too (k=1 -> full gain, counted)
    expect(r.opponentWins).toEqual({ seasonId: AUGUST, wins: 1 });
  });

  it("re-reaching a tier already in career best does NOT fire a first-reached event", () => {
    const s = stateAt(RANK_TIER.pokeball, 1, SEGMENTS_PER_RANK - 1, { careerBestTier: RANK_TIER.ultraball });
    const r = win(s, freshCounter());
    expect(r.state.tier).toBe(RANK_TIER.greatball);
    expect(r.events.tiersFirstReached).toEqual([]); // greatball <= career best ultraball
  });

  it("reconcileSeason folds a stale state forward and reports the prior final tier", () => {
    const stale = stateAt(RANK_TIER.greatball, 2, 1, { seasonId: JULY, careerBestTier: RANK_TIER.ultraball });
    const r = reconcileSeason(stale, MID_AUGUST);
    expect(r.state).toMatchObject({ seasonId: AUGUST, tier: MIN_TIER, careerBestTier: RANK_TIER.ultraball });
    expect(r.seasonEndedFinalTier).toBe(RANK_TIER.greatball);
  });

  it("reconcileSeason is a no-op within the same season", () => {
    const s = stateAt(RANK_TIER.greatball, 2, 1);
    const r = reconcileSeason(s, MID_JULY);
    expect(r.state).toBe(s);
    expect(r.seasonEndedFinalTier).toBeNull();
  });
});

// =======================================================================================
describe("dual-attestation reconciliation (mirrors the escrow pattern)", () => {
  const fresh = () => newRankMatch("r1", "alice", "bob", 1000);

  it("maps uids to roles", () => {
    const m = fresh();
    expect(rankRoleOf(m, "alice")).toBe("host");
    expect(rankRoleOf(m, "bob")).toBe("guest");
    expect(rankRoleOf(m, "eve")).toBeNull();
  });

  it("two agreeing reports settle with that winner", () => {
    let m = fresh();
    const a = applyRankReport(m, "alice", "host", 2000);
    expect(a.resolution).toBe("pending");
    m = a.match;
    const b = applyRankReport(m, "bob", "host", 2001);
    expect(b.resolution).toBe("settled");
    expect(b.match.winner).toBe("host");
    expect(b.match.state).toBe("settled");
  });

  it("conflicting reports void the match (no rank change)", () => {
    let m = fresh();
    m = applyRankReport(m, "alice", "host", 2000).match;
    const b = applyRankReport(m, "bob", "guest", 2001);
    expect(b.resolution).toBe("void");
    expect(b.match.winner).toBeNull();
    expect(b.match.state).toBe("void");
  });

  it("a lone report never settles (a single client cannot self-promote)", () => {
    const r = applyRankReport(fresh(), "alice", "host", 5_000_000);
    expect(r.resolution).toBe("pending");
    expect(r.match.state).toBe("open");
  });

  it("a re-report cannot flip the canonical winner", () => {
    let m = fresh();
    m = applyRankReport(m, "alice", "host", 2000).match;
    m = applyRankReport(m, "alice", "guest", 2500).match;
    expect(m.hostReport?.winner).toBe("host");
  });

  it("rejects a non-participant report and is idempotent once resolved", () => {
    let m = fresh();
    const stranger = applyRankReport(m, "eve", "host", 2000);
    expect(stranger.resolution).toBe("pending");
    expect(stranger.match.hostReport).toBeNull();
    m = applyRankReport(m, "alice", "guest", 2000).match;
    m = applyRankReport(m, "bob", "guest", 2001).match;
    expect(m.state).toBe("settled");
    const again = applyRankReport(m, "alice", "host", 3000);
    expect(again.resolution).toBe("settled");
    expect(again.match.winner).toBe("guest");
  });
});
