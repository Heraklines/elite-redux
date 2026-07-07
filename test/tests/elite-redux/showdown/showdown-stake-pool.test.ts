import { buildShowdownStakePool, type StakePoolGameData } from "#app/data/elite-redux/showdown/showdown-stake-pool";
import { stakeTier } from "#app/data/elite-redux/showdown/showdown-stakes";
import { speciesStarterCosts } from "#balance/starters";
import { DexAttr } from "#enums/dex-attr";
import { RibbonData } from "#system/ribbons/ribbon-data";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";
import { describe, expect, it } from "vitest";

const BASE = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

function entry(caughtAttr: bigint): DexEntry {
  return {
    seenAttr: caughtAttr,
    caughtAttr,
    natureAttr: 0,
    seenCount: 0,
    caughtCount: 0,
    hatchedCount: 0,
    ivs: [0, 0, 0, 0, 0, 0],
    ribbons: new RibbonData(0),
  };
}
function starter(over: Partial<StarterDataEntry> = {}): StarterDataEntry {
  return {
    moveset: null,
    eggMoves: 0,
    candyCount: 0,
    friendship: 0,
    abilityAttr: 0,
    passiveAttr: 0,
    valueReduction: 0,
    classicWinCount: 0,
    ...over,
  };
}

// Two real starter roots to key the stub against.
const rootIds = Object.keys(speciesStarterCosts).map(Number);
const A = rootIds[0];
const B = rootIds[1];

describe("buildShowdownStakePool", () => {
  it("skips uncaught lines", () => {
    const gd: StakePoolGameData = { dexData: { [A]: entry(0n) }, starterData: {} };
    expect(buildShowdownStakePool(gd)).toEqual([]);
  });

  it("emits a non-shiny stake for a caught line", () => {
    const gd: StakePoolGameData = { dexData: { [A]: entry(BASE) }, starterData: { [A]: starter() } };
    const pool = buildShowdownStakePool(gd);
    expect(pool).toContainEqual({
      speciesId: A,
      shiny: false,
      variant: 0,
      erBlackShiny: false,
      cost: expect.any(Number),
    });
    expect(pool.filter(o => o.shiny)).toHaveLength(0);
  });

  it("emits one shiny stake per owned variant", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_2 | DexAttr.VARIANT_3;
    const gd: StakePoolGameData = { dexData: { [A]: entry(caught) }, starterData: { [A]: starter() } };
    const pool = buildShowdownStakePool(gd);
    const shinies = pool
      .filter(o => o.shiny && !o.erBlackShiny)
      .map(o => o.variant)
      .sort();
    expect(shinies).toEqual([0, 1, 2]); // default + variant2 + variant3 all owned
  });

  it("emits a black-shiny stake at the top tier", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_3;
    const gd: StakePoolGameData = {
      dexData: { [A]: entry(caught) },
      starterData: { [A]: starter({ erBlackShiny: true }) },
    };
    const pool = buildShowdownStakePool(gd);
    const black = pool.find(o => o.erBlackShiny);
    expect(black).toBeDefined();
    // The black shiny is the highest-tier offer in the pool.
    expect(stakeTier(pool[0])).toBe(stakeTier(black!));
  });

  it("sorts highest tier first across lines", () => {
    const gd: StakePoolGameData = {
      dexData: {
        [A]: entry(BASE), // non-shiny only
        [B]: entry(BASE | DexAttr.SHINY | DexAttr.DEFAULT_VARIANT), // shiny v0
      },
      starterData: { [A]: starter(), [B]: starter() },
    };
    const pool = buildShowdownStakePool(gd);
    // A shiny (tier 100+) must sort before any non-shiny (tier = cost <= 10).
    expect(pool[0].shiny).toBe(true);
    for (let i = 1; i < pool.length; i++) {
      expect(stakeTier(pool[i - 1])).toBeGreaterThanOrEqual(stakeTier(pool[i]));
    }
  });
});
