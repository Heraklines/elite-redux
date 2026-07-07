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
    showdownAppliedSettlements: [],
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

  it("black-shiny stake lost: clears the erBlackShiny flag + VARIANT_3 + SHINY, keeps base", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_3;
    const { gameData, dexData, starterData } = stubGameData(6, dexEntry(caught), starterEntry({ erBlackShiny: true }));
    applySettlementMutations(
      [{ kind: "removeUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: true, cost: 5 }],
      gameData,
    );
    expect(starterData[6].erBlackShiny).toBe(false);
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_3).toBe(0n);
    expect(dexData[6].caughtAttr & DexAttr.SHINY).toBe(0n);
    expect(dexData[6].caughtAttr & BASE).toBe(BASE);
  });

  // C1: multi-variant owner staking ONE variant keeps the other variant AND the species-global SHINY.
  it("multi-variant shiny owner loses one variant: the other variant + SHINY survive", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_2 | DexAttr.VARIANT_3;
    const { gameData, dexData } = stubGameData(6, dexEntry(caught), starterEntry());
    // Stake the variant-2 (VARIANT_3) shiny; the variant-1 (VARIANT_2) shiny is separately owned.
    applySettlementMutations(
      [{ kind: "removeUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: false, cost: 5 }],
      gameData,
    );
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_3).toBe(0n); // only the staked variant cleared
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_2).toBe(DexAttr.VARIANT_2); // other variant survives
    expect(dexData[6].caughtAttr & DexAttr.SHINY).toBe(DexAttr.SHINY); // SHINY survives (variant remains)
  });

  // C2 both directions on a stub owning BOTH the black and regular variant-3 (indistinguishable bits).
  it("black+regular-v3 owner: losing the BLACK clears the flag + VARIANT_3", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_3;
    const { gameData, dexData, starterData } = stubGameData(6, dexEntry(caught), starterEntry({ erBlackShiny: true }));
    applySettlementMutations(
      [{ kind: "removeUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: true, cost: 5 }],
      gameData,
    );
    expect(starterData[6].erBlackShiny).toBe(false);
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_3).toBe(0n);
  });

  it("black+regular-v3 owner: losing the REGULAR v3 leaves VARIANT_3 + the black intact (flag-only)", () => {
    const caught = BASE | DexAttr.SHINY | DexAttr.VARIANT_3;
    const { gameData, dexData, starterData } = stubGameData(6, dexEntry(caught), starterEntry({ erBlackShiny: true }));
    // A regular variant-2 (VARIANT_3) remove while the black is owned: the black still needs VARIANT_3.
    applySettlementMutations(
      [{ kind: "removeUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: false, cost: 5 }],
      gameData,
    );
    expect(dexData[6].caughtAttr & DexAttr.VARIANT_3).toBe(DexAttr.VARIANT_3); // black still needs it
    expect(starterData[6].erBlackShiny).toBe(true); // the black survives
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

  // I1: a BLACK grant to a winner who owns the regular variant-3 (VARIANT_3 bit set) but NOT the black
  // flag must GRANT the black (set the flag + bits), never candy — the check keys on erBlackShiny.
  it("black grant to a regular-v3 owner: sets the black flag, not candy", () => {
    const owned = BASE | DexAttr.SHINY | DexAttr.VARIANT_3; // regular v3, but erBlackShiny=false
    const { gameData, starterData, addStarterCandy } = stubGameData(6, dexEntry(owned), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 6, shiny: true, variant: 2, erBlackShiny: true, cost: 5 }],
      gameData,
    );
    expect(starterData[6].erBlackShiny).toBe(true);
    expect(addStarterCandy).not.toHaveBeenCalled();
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

  it("does NOT save itself (the sync orchestration owns the save→ack ordering)", () => {
    const { gameData, saveSystem } = stubGameData(1, dexEntry(0n), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 1, shiny: false, variant: 0, erBlackShiny: false, cost: 5 }],
      gameData,
    );
    expect(saveSystem).not.toHaveBeenCalled();
  });
});

describe("applied-settlement ledger (I2)", () => {
  it("appends applied row ids to the ledger in the same batch", () => {
    const { gameData } = stubGameData(1, dexEntry(0n), starterEntry());
    applySettlementMutations(
      [{ kind: "grantUnlock", speciesId: 1, shiny: false, variant: 0, erBlackShiny: false, cost: 5 }],
      gameData,
      [42, 43],
    );
    expect(gameData.showdownAppliedSettlements).toEqual([42, 43]);
  });

  it("dedupes and caps the ledger to the newest 200 ids (FIFO)", () => {
    const { gameData } = stubGameData(1, dexEntry(0n), starterEntry());
    gameData.showdownAppliedSettlements = Array.from({ length: 200 }, (_, i) => i); // 0..199
    applySettlementMutations(
      [{ kind: "grantCandy", speciesId: 1, candy: 5 }],
      gameData,
      [199, 200], // 199 is a dup; 200 is new
    );
    expect(gameData.showdownAppliedSettlements).toHaveLength(200);
    expect(gameData.showdownAppliedSettlements.at(-1)).toBe(200);
    expect(gameData.showdownAppliedSettlements.at(0)).toBe(1); // 0 evicted (FIFO)
  });
});
