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

  // M2: a line that owns ANY shiny variant does NOT offer the bare non-shiny "lose the species" stake.
  it("does NOT offer a non-shiny stake when the line owns a shiny", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.DEFAULT_VARIANT;
    const gd: StakePoolGameData = { dexData: { [A]: entry(caught) }, starterData: { [A]: starter() } };
    const pool = buildShowdownStakePool(gd);
    expect(pool.filter(o => !o.shiny && !o.erBlackShiny)).toHaveLength(0);
    expect(pool.some(o => o.shiny)).toBe(true);
  });

  // C2: owning BOTH the black and regular variant-3, only the BLACK is stakeable for the top slot.
  it("suppresses the regular variant-3 stake when the black is owned (black only)", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_2 | DexAttr.VARIANT_3;
    const gd: StakePoolGameData = {
      dexData: { [A]: entry(caught) },
      starterData: { [A]: starter({ erBlackShiny: true }) },
    };
    const pool = buildShowdownStakePool(gd);
    // No REGULAR (non-black) variant-2 (VARIANT_3) offer.
    expect(pool.filter(o => o.shiny && !o.erBlackShiny && o.variant === 2)).toHaveLength(0);
    // The black IS offered; lower regular variants (v0/v1) still are.
    expect(pool.filter(o => o.erBlackShiny)).toHaveLength(1);
    expect(pool.filter(o => o.shiny && !o.erBlackShiny && o.variant === 1)).toHaveLength(1);
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
