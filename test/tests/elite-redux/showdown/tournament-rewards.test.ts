import { describe, expect, it } from "vitest";
// Pure reward-vocabulary + settlement-translation tests for the tournament worker (no CF deps).
// Proves: the new prize kinds sanitize; computeRewardGrants maps them to placements; and
// tournamentGrantSettlements translates them to CLIENT settlement mutations deterministically
// (random shinies resolve to a fixed species on every recompute — grants are deterministic once rolled).
import {
  DEFAULT_RANDOM_SHINY_POOL,
  sanitizeRewardPool,
  type TournamentRecord,
  tournamentGrantSettlements,
} from "../../../../workers/er-telemetry/src/tournament";
import { type Bracket, generateBracket, manualResolve } from "../../../../workers/er-telemetry/src/tournament-bracket";

// A genuine COMPLETE 4-player bracket built through the real domain: champion=alice, runnerUp=bob,
// semifinalists=[carol,dave]. Seeds 1..4 -> alice/bob/carol/dave; play every match to alice/bob then bob loses.
function completeBracket(): Bracket {
  let bracket = generateBracket(
    "cup",
    [
      { participant: "alice", seed: 1 },
      { participant: "bob", seed: 2 },
      { participant: "carol", seed: 3 },
      { participant: "dave", seed: 4 },
    ],
    86_400_000,
    0,
  );
  // Round 0: top seed of each match wins (alice beats her r0 opponent; bob beats his).
  for (const m of bracket.rounds[0]) {
    bracket = manualResolve(bracket, m.id, m.a as string).bracket;
  }
  // Final: alice beats bob -> champion alice, runnerUp bob, semifinalists carol+dave.
  const final = bracket.rounds[1][0];
  bracket = manualResolve(bracket, final.id, "alice").bracket;
  return bracket;
}

function tournament(rewardPool: TournamentRecord["rewardPool"]): TournamentRecord {
  return {
    id: "cup",
    name: "Cup",
    organizer: "admin",
    state: "complete",
    roundWindowMs: 86_400_000,
    maxEntrants: 4,
    createdAt: 0,
    startedAt: 0,
    champion: "alice",
    bracket: completeBracket(),
    battleFormat: "singles",
    seriesFormat: "single",
    rewardPool,
    closeAt: null,
    rewardsGranted: false,
  };
}

describe("tournament reward vocabulary — sanitize", () => {
  it("accepts the new prize kinds and clamps their fields", () => {
    const pool = sanitizeRewardPool([
      {
        place: "champion",
        mutations: [
          { kind: "grantShinyChosen", speciesId: 6, tier: 4 },
          { kind: "grantShinyRandom", tier: 9, unownedOnly: true, speciesPool: [1, 4, 7] },
          { kind: "grantLabEffect", speciesId: 25, category: "palette", effectIndex: 3 },
          { kind: "grantCandy", speciesId: 1, candy: 50 },
        ],
      },
    ]);
    expect(pool[0].mutations).toEqual([
      { kind: "grantShinyChosen", speciesId: 6, tier: 4 },
      { kind: "grantShinyRandom", tier: 4, unownedOnly: true, speciesPool: [1, 4, 7] }, // tier clamped 9->4
      { kind: "grantLabEffect", speciesId: 25, category: "palette", effectIndex: 3 },
      { kind: "grantCandy", speciesId: 1, candy: 50 },
    ]);
  });

  it("drops a lab effect with an unknown category and a shiny-chosen without species", () => {
    const pool = sanitizeRewardPool([
      {
        place: "champion",
        mutations: [
          { kind: "grantLabEffect", speciesId: 25, category: "bogus", effectIndex: 1 },
          { kind: "grantShinyChosen", tier: 1 },
        ],
      },
    ]);
    expect(pool[0].mutations).toEqual([]);
  });
});

describe("tournamentGrantSettlements — translation to client settlement mutations", () => {
  it("chosen shiny maps tier -> (variant, erBlackShiny); T4 = black", () => {
    const t1 = tournamentGrantSettlements(
      tournament([{ place: "champion", mutations: [{ kind: "grantShinyChosen", speciesId: 6, tier: 1 }] }]),
    );
    expect(t1).toEqual([
      {
        uid: "alice",
        mutation: { kind: "grantUnlock", speciesId: 6, shiny: true, variant: 0, erBlackShiny: false, cost: 0 },
      },
    ]);
    const t4 = tournamentGrantSettlements(
      tournament([{ place: "champion", mutations: [{ kind: "grantShinyChosen", speciesId: 6, tier: 4 }] }]),
    );
    expect(t4[0].mutation).toEqual({
      kind: "grantUnlock",
      speciesId: 6,
      shiny: true,
      variant: 2,
      erBlackShiny: true,
      cost: 0,
    });
    const t3 = tournamentGrantSettlements(
      tournament([{ place: "champion", mutations: [{ kind: "grantShinyChosen", speciesId: 6, tier: 3 }] }]),
    );
    expect(t3[0].mutation).toMatchObject({ variant: 2, erBlackShiny: false });
  });

  it("candy passes through; lab effect becomes a saved-look; currency/item are NOT delivered", () => {
    const out = tournamentGrantSettlements(
      tournament([
        {
          place: "champion",
          mutations: [
            { kind: "grantCandy", speciesId: 1, candy: 30 },
            { kind: "grantLabEffect", speciesId: 25, category: "surface", effectIndex: 2 },
            { kind: "grantCurrency", amount: 5000 },
            { kind: "grantItem", itemId: "MASTER_BALL", count: 1 },
          ],
        },
      ]),
    );
    expect(out).toEqual([
      { uid: "alice", mutation: { kind: "grantCandy", speciesId: 1, candy: 30 } },
      {
        uid: "alice",
        // surface effect index 2 -> slot 1 of the 3-slot loadout, default param bytes appended.
        mutation: {
          kind: "grantShinyLabLook",
          speciesId: 25,
          savedLook: [0, 2, 0, 255, 255, 255, 96, 0, 0, 0, 0, 0, 70, 85],
        },
      },
    ]);
  });

  it("random shiny resolves deterministically (same species on every recompute) from the pool", () => {
    const t = tournament([
      { place: "champion", mutations: [{ kind: "grantShinyRandom", tier: 2, unownedOnly: false, speciesPool: [] }] },
    ]);
    const a = tournamentGrantSettlements(t);
    const b = tournamentGrantSettlements(t);
    expect(a).toEqual(b); // deterministic
    const mut = a[0].mutation as { kind: string; speciesId: number; variant: number };
    expect(mut.kind).toBe("grantUnlock");
    expect(mut.variant).toBe(1); // tier 2 -> variant 1
    expect(DEFAULT_RANDOM_SHINY_POOL).toContain(mut.speciesId); // rolled from the default pool
  });

  it("random shiny honors an explicit species pool and different places roll independently", () => {
    const t = tournament([
      { place: "champion", mutations: [{ kind: "grantShinyRandom", tier: 1, unownedOnly: false, speciesPool: [151] }] },
      {
        place: "semifinalist",
        mutations: [{ kind: "grantShinyRandom", tier: 1, unownedOnly: false, speciesPool: [251] }],
      },
    ]);
    const out = tournamentGrantSettlements(t);
    const champ = out.find(s => s.uid === "alice");
    expect((champ?.mutation as { speciesId: number }).speciesId).toBe(151); // single-species pool is forced
    // both semifinalists (carol, dave) get their own grant from the 251 pool
    const semis = out.filter(s => s.uid === "carol" || s.uid === "dave");
    expect(semis).toHaveLength(2);
    for (const s of semis) {
      expect((s.mutation as { speciesId: number }).speciesId).toBe(251);
    }
  });
});
