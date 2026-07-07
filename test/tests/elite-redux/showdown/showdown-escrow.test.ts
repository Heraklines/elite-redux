import { describe, expect, it } from "vitest";
// PURE worker-domain module imported by relative path (workers/ is outside the client
// tsconfig, but the module has ZERO Cloudflare deps so it imports cleanly — this is the
// worker-test pattern per the plan doc's Task D1).
import {
  applyResultReport,
  recordBattlePhaseEntered,
  registerMatch,
  resolveSettlement,
  roleOf,
  type ShowdownMatchRecord,
  type StakeRecord,
  stakesMatch,
  stakeTier,
  voidMatch,
} from "../../../../workers/er-save-api/src/showdown-escrow";

const nonShiny = (cost: number): StakeRecord => ({
  speciesId: 1,
  shiny: false,
  variant: 0,
  erBlackShiny: false,
  cost,
});
const shiny = (variant: 0 | 1 | 2): StakeRecord => ({
  speciesId: 25,
  shiny: true,
  variant,
  erBlackShiny: false,
  cost: 5,
});
const black = (): StakeRecord => ({ speciesId: 6, shiny: true, variant: 2, erBlackShiny: true, cost: 8 });

const SILENCE = 60_000;

/** Register a fresh same-tier match (cost-8 both sides) at t=1000. */
function freshMatch(): ShowdownMatchRecord {
  const res = registerMatch("m1", "alice", "bob", nonShiny(8), nonShiny(8), 1000);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.match;
}

describe("stakeTier / stakesMatch (worker mirror)", () => {
  it("mirrors the client tier rule", () => {
    expect(stakeTier(nonShiny(8))).toBe(8);
    expect(stakeTier(shiny(0))).toBe(100);
    expect(stakeTier(shiny(2))).toBe(102);
    expect(stakeTier(black())).toBe(110);
    expect(stakeTier(nonShiny(10))).toBeLessThan(stakeTier(shiny(0)));
  });
  it("matches same-tier only", () => {
    expect(stakesMatch(nonShiny(8), nonShiny(8))).toBe(true);
    expect(stakesMatch(nonShiny(8), nonShiny(9))).toBe(false);
    expect(stakesMatch(shiny(1), { ...shiny(1), cost: 99 })).toBe(true);
    expect(stakesMatch(shiny(1), shiny(2))).toBe(false);
  });
});

describe("registerMatch", () => {
  it("registers a same-tier match in the open state", () => {
    const m = freshMatch();
    expect(m.state).toBe("open");
    expect(m.battlePhaseEntered).toBe(false);
    expect(m.hostReport).toBeNull();
    expect(m.guestReport).toBeNull();
    expect(m.winner).toBeNull();
  });
  it("rejects mismatched-tier stakes", () => {
    const res = registerMatch("m1", "alice", "bob", nonShiny(8), shiny(0), 1000);
    expect(res.ok).toBe(false);
  });
  it("rejects same-uid host/guest", () => {
    const res = registerMatch("m1", "alice", "alice", nonShiny(8), nonShiny(8), 1000);
    expect(res.ok).toBe(false);
  });
  it("rejects malformed stakes", () => {
    const res = registerMatch("m1", "alice", "bob", {} as StakeRecord, nonShiny(8), 1000);
    expect(res.ok).toBe(false);
  });
});

describe("roleOf", () => {
  it("maps uids to roles", () => {
    const m = freshMatch();
    expect(roleOf(m, "alice")).toBe("host");
    expect(roleOf(m, "bob")).toBe("guest");
    expect(roleOf(m, "nobody")).toBeNull();
  });
});

describe("applyResultReport — dual attestation", () => {
  it("two agreeing reports settle with that winner", () => {
    let m = recordBattlePhaseEntered(freshMatch());
    const a = applyResultReport(m, "alice", "host", "victory", 2000, SILENCE);
    expect(a.resolution).toBe("pending");
    m = a.match;
    const b = applyResultReport(m, "bob", "host", "victory", 2001, SILENCE);
    expect(b.resolution).toBe("settled");
    expect(b.match.winner).toBe("host");
    expect(b.match.state).toBe("settled");
  });

  it("conflicting reports void the match (holds released)", () => {
    let m = recordBattlePhaseEntered(freshMatch());
    m = applyResultReport(m, "alice", "host", "victory", 2000, SILENCE).match;
    const b = applyResultReport(m, "bob", "guest", "victory", 2001, SILENCE);
    expect(b.resolution).toBe("void");
    expect(b.match.state).toBe("void");
    expect(b.match.winner).toBeNull();
  });

  it("rejects a non-participant report (unchanged, pending)", () => {
    const m = recordBattlePhaseEntered(freshMatch());
    const r = applyResultReport(m, "stranger", "host", "victory", 2000, SILENCE);
    expect(r.resolution).toBe("pending");
    expect(r.match.hostReport).toBeNull();
    expect(r.match.guestReport).toBeNull();
  });
});

describe("applyResultReport — lone report rules", () => {
  it("does NOT settle a lone report before the silence timer elapses", () => {
    const m = recordBattlePhaseEntered(freshMatch());
    const r = applyResultReport(m, "alice", "host", "timeout", 2000, SILENCE);
    expect(r.resolution).toBe("pending");
  });

  it("settles a lone report once battle-entered AND silence elapsed (re-report)", () => {
    let m = recordBattlePhaseEntered(freshMatch());
    // First report at t=2000: pending (timer not elapsed).
    m = applyResultReport(m, "alice", "host", "timeout", 2000, SILENCE).match;
    // Survivor re-reports after silence (t = 2000 + 60_000): the report `at` stays 2000.
    const r = applyResultReport(m, "alice", "host", "timeout", 2000 + SILENCE, SILENCE);
    expect(r.resolution).toBe("settled");
    expect(r.match.winner).toBe("host");
  });

  it("never settles a lone report when the battle was NOT entered (pre-battle abandon)", () => {
    let m = freshMatch(); // battlePhaseEntered stays false
    m = applyResultReport(m, "alice", "host", "timeout", 2000, SILENCE).match;
    const r = applyResultReport(m, "alice", "host", "timeout", 2000 + SILENCE * 10, SILENCE);
    expect(r.resolution).toBe("pending");
    expect(r.match.state).toBe("open");
  });

  it("a re-report cannot flip the canonical winner", () => {
    let m = recordBattlePhaseEntered(freshMatch());
    m = applyResultReport(m, "alice", "host", "victory", 2000, SILENCE).match;
    // Same role tries to report the OTHER winner: ignored, first report stands.
    m = applyResultReport(m, "alice", "guest", "victory", 2500, SILENCE).match;
    expect(m.hostReport?.winner).toBe("host");
  });
});

describe("settlement idempotency + void", () => {
  it("a settled match is idempotent under further reports", () => {
    let m = recordBattlePhaseEntered(freshMatch());
    m = applyResultReport(m, "alice", "guest", "victory", 2000, SILENCE).match;
    m = applyResultReport(m, "bob", "guest", "victory", 2001, SILENCE).match;
    expect(m.state).toBe("settled");
    const again = applyResultReport(m, "alice", "host", "victory", 3000, SILENCE);
    expect(again.resolution).toBe("settled");
    expect(again.match.winner).toBe("guest");
  });

  it("voidMatch releases an open match and is idempotent", () => {
    const m = voidMatch(freshMatch(), 2000);
    expect(m.state).toBe("void");
    expect(voidMatch(m, 3000).state).toBe("void");
    expect(voidMatch(m, 3000).resolvedAt).toBe(2000);
  });
});

describe("resolveSettlement — mutation records", () => {
  it("emits loser removeUnlock + winner grantUnlock of the loser's stake", () => {
    // host stakes a cost-8 species #1; guest wins → host loses its stake.
    const reg = registerMatch("m2", "alice", "bob", nonShiny(8), nonShiny(8), 1000);
    if (!reg.ok) {
      throw new Error(reg.error);
    }
    let m = recordBattlePhaseEntered(reg.match);
    m = applyResultReport(m, "alice", "guest", "victory", 2000, SILENCE).match;
    m = applyResultReport(m, "bob", "guest", "victory", 2001, SILENCE).match;
    const muts = resolveSettlement(m);
    expect(muts).toHaveLength(2);
    // host (uid 10) loses its own stake (species 1); guest (uid 20) gains it.
    expect(muts).toContainEqual({
      uid: "alice",
      kind: "removeUnlock",
      speciesId: 1,
      shiny: false,
      variant: 0,
      erBlackShiny: false,
      cost: 8,
    });
    expect(muts).toContainEqual({
      uid: "bob",
      kind: "grantUnlock",
      speciesId: 1,
      shiny: false,
      variant: 0,
      erBlackShiny: false,
      cost: 8,
    });
  });

  it("returns no mutations for an unsettled or void match", () => {
    expect(resolveSettlement(freshMatch())).toEqual([]);
    expect(resolveSettlement(voidMatch(freshMatch(), 2000))).toEqual([]);
  });

  it("transfers a shiny stake with its variant bits", () => {
    const reg = registerMatch("m3", "alice", "bob", shiny(2), shiny(2), 1000);
    if (!reg.ok) {
      throw new Error(reg.error);
    }
    let m = recordBattlePhaseEntered(reg.match);
    m = applyResultReport(m, "alice", "host", "victory", 2000, SILENCE).match;
    m = applyResultReport(m, "bob", "host", "victory", 2001, SILENCE).match;
    const muts = resolveSettlement(m);
    // guest (uid 20) loses its shiny variant-2 stake; host (uid 10) gains it.
    expect(muts).toContainEqual({
      uid: "bob",
      kind: "removeUnlock",
      speciesId: 25,
      shiny: true,
      variant: 2,
      erBlackShiny: false,
      cost: 5,
    });
    expect(muts).toContainEqual({
      uid: "alice",
      kind: "grantUnlock",
      speciesId: 25,
      shiny: true,
      variant: 2,
      erBlackShiny: false,
      cost: 5,
    });
  });
});
