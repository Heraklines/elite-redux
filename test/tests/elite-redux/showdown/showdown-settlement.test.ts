import { isCoopAccountWriteAllowed } from "#app/data/elite-redux/coop/coop-account-gate";
import {
  applySettlementMutations,
  type SettlementGameData,
  type ShowdownSettlementMutation,
  settlementCandyAmount,
} from "#app/data/elite-redux/showdown/showdown-settlement";
import { DexAttr } from "#enums/dex-attr";
import { RibbonData } from "#system/ribbons/ribbon-data";
import type { DexEntry } from "#types/dex-data";
import type { StarterDataEntry } from "#types/save-data";
import { describe, expect, it, vi } from "vitest";

function dexEntry(caughtAttr = 0n): DexEntry {
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

function starterEntry(over: Partial<StarterDataEntry> = {}): StarterDataEntry {
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

/** Build a stub gameData with the given root species pre-populated. */
function stubGameData(rootId: number, dex: DexEntry, starter: StarterDataEntry) {
  const dexData: Record<number, DexEntry> = { [rootId]: dex };
  const starterData: Record<number, StarterDataEntry> = { [rootId]: starter };
  const addStarterCandy = vi.fn((id: number, count: number) => {
    starterData[id] = starterData[id] ?? starterEntry();
    starterData[id].candyCount += count;
    return true;
  });
  const saveSystem = vi.fn(() => Promise.resolve(true));
  const gameData: SettlementGameData = {
    dexData,
    starterData,
    getRootStarterSpeciesId: (id: number) => id,
    getStarterDataEntry: (id: number) => (starterData[id] ??= starterEntry()),
    addStarterCandy,
    saveSystem,
  };
  return { gameData, dexData, starterData, addStarterCandy, saveSystem };
}

const BASE = DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;

describe("applySettlementMutations — removeUnlock bit surgery", () => {
  it("shiny variant-2 stake lost: clears SHINY + VARIANT_3, keeps the base unlock", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_3;
    const { gameData, dexData } = stubGameData(6, dexEntry(caught), starterEntry());
    const mut: ShowdownSettlementMutation = {
      kind: "removeUnlock",
      speciesId: 6,
      shiny: true,
      variant: 2,
      erBlackShiny: false,
      cost: 5,
    };
    applySettlementMutations([mut], gameData);
    // SHINY + VARIANT_3 gone; base bits intact.
    expect(dexData[6].caughtAttr & DexAttr.SHINY).toBe(0n);
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_3).toBe(0n);
    expect(dexData[6].caughtAttr & BASE).toBe(BASE);
  });

  it("species (non-shiny) stake lost: clears caughtAttr entirely + zeroes candy", () => {
    const { gameData, dexData, starterData } = stubGameData(1, dexEntry(BASE), starterEntry({ candyCount: 55 }));
    const mut: ShowdownSettlementMutation = {
      kind: "removeUnlock",
      speciesId: 1,
      shiny: false,
      variant: 0,
      erBlackShiny: false,
      cost: 8,
    };
    applySettlementMutations([mut], gameData);
    expect(dexData[1].caughtAttr).toBe(0n);
    expect(starterData[1].candyCount).toBe(0);
  });

  it("black-shiny stake lost: clears the erBlackShiny starter flag", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_3;
    const { gameData, starterData } = stubGameData(6, dexEntry(caught), starterEntry({ erBlackShiny: true }));
    applySettlementMutations(
      [{ kind: "removeUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: true, cost: 5 }],
      gameData,
    );
    expect(starterData[6].erBlackShiny).toBe(false);
  });
});

describe("applySettlementMutations — grantUnlock", () => {
  it("win grant on an UNOWNED species: sets the base caught bits", () => {
    const { gameData, dexData, addStarterCandy } = stubGameData(1, dexEntry(0n), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 1, shiny: false, variant: 0, erBlackShiny: false, cost: 5 }],
      gameData,
    );
    expect(dexData[1].caughtAttr & BASE).toBe(BASE);
    expect(addStarterCandy).not.toHaveBeenCalled();
  });

  it("win grant on an UNOWNED shiny variant-2: sets base + SHINY + VARIANT_3", () => {
    const { gameData, dexData } = stubGameData(6, dexEntry(0n), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: false, cost: 5 }],
      gameData,
    );
    expect(dexData[6].caughtAttr & DexAttr.SHINY).toBe(DexAttr.SHINY);
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_3).toBe(DexAttr.VARIANT_3);
    expect(dexData[6].caughtAttr & BASE).toBe(BASE);
  });

  it("win grant on an ALREADY-OWNED species: candy conversion, dex bits unchanged", () => {
    const { gameData, dexData, addStarterCandy } = stubGameData(1, dexEntry(BASE), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 1, shiny: false, variant: 0, erBlackShiny: false, cost: 8 }],
      gameData,
    );
    // cost 8 → max(10, 8*8) = 64 candy.
    expect(addStarterCandy).toHaveBeenCalledWith(1, 64);
    expect(dexData[1].caughtAttr).toBe(BASE); // unchanged
  });

  it("win grant on an ALREADY-OWNED shiny variant: candy conversion", () => {
    const owned = BASE | DexAttr.SHINY | DexAttr.VARIANT_3;
    const { gameData, addStarterCandy } = stubGameData(6, dexEntry(owned), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: false, cost: 5 }],
      gameData,
    );
    // shiny v2 → 40 + 2*20 = 80 candy.
    expect(addStarterCandy).toHaveBeenCalledWith(6, 80);
  });
});

describe("settlementCandyAmount formula", () => {
  it("scales black > shiny > cost", () => {
    expect(settlementCandyAmount({ shiny: false, variant: 0, erBlackShiny: false, cost: 1 })).toBe(10);
    expect(settlementCandyAmount({ shiny: false, variant: 0, erBlackShiny: false, cost: 9 })).toBe(72);
    expect(settlementCandyAmount({ shiny: true, variant: 0, erBlackShiny: false, cost: 5 })).toBe(40);
    expect(settlementCandyAmount({ shiny: true, variant: 2, erBlackShiny: false, cost: 5 })).toBe(80);
    expect(settlementCandyAmount({ shiny: true, variant: 2, erBlackShiny: true, cost: 5 })).toBe(100);
  });
});

describe("account-write gate", () => {
  it("applies mutations INSIDE an allowlisted account-write scope, closed afterward", () => {
    let allowedDuring = false;
    const { gameData } = stubGameData(1, dexEntry(BASE), starterEntry());
    gameData.addStarterCandy = () => {
      allowedDuring = isCoopAccountWriteAllowed();
      return true;
    };
    expect(isCoopAccountWriteAllowed()).toBe(false);
    applySettlementMutations([{ kind: "grantCandy", speciesId: 1, candy: 20 }], gameData);
    expect(allowedDuring).toBe(true);
    expect(isCoopAccountWriteAllowed()).toBe(false);
  });

  it("triggers a system-save push after applying", () => {
    const { gameData, saveSystem } = stubGameData(1, dexEntry(0n), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 1, shiny: false, variant: 0, erBlackShiny: false, cost: 5 }],
      gameData,
    );
    expect(saveSystem).toHaveBeenCalledWith(true);
  });
});
