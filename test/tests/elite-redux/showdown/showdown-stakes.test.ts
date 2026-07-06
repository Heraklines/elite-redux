import { type StakeOffer, stakesMatch, stakeTier } from "#app/data/elite-redux/showdown/showdown-stakes";
import { describe, expect, it } from "vitest";

const nonShiny = (cost: number): StakeOffer => ({
  speciesId: 1,
  shiny: false,
  variant: 0,
  erBlackShiny: false,
  cost,
});
const shiny = (variant: 0 | 1 | 2, cost = 5): StakeOffer => ({
  speciesId: 1,
  shiny: true,
  variant,
  erBlackShiny: false,
  cost,
});

describe("stakeTier", () => {
  it("ranks non-shinies by starter cost, below every shiny", () => {
    expect(stakeTier(nonShiny(1))).toBeLessThan(stakeTier(nonShiny(10)));
    expect(stakeTier(nonShiny(10))).toBeLessThan(stakeTier(shiny(0, 1)));
  });
  it("ranks shiny variants as sub-tiers", () => {
    expect(stakeTier(shiny(0))).toBeLessThan(stakeTier(shiny(1)));
    expect(stakeTier(shiny(1))).toBeLessThan(stakeTier(shiny(2)));
  });
  it("ranks ER black shiny above variant 3", () => {
    expect(stakeTier(shiny(2))).toBeLessThan(stakeTier({ ...shiny(2), erBlackShiny: true }));
  });
});

describe("stakesMatch", () => {
  it("matches same-tier offers only", () => {
    expect(stakesMatch(nonShiny(8), nonShiny(8))).toBe(true);
    expect(stakesMatch(nonShiny(10), shiny(0))).toBe(false);
    expect(stakesMatch(shiny(1), shiny(1, 10))).toBe(true);
    expect(stakesMatch(shiny(1), shiny(2))).toBe(false);
  });
});
