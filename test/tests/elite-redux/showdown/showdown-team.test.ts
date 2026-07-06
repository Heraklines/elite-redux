import { SHOWDOWN_ITEM_POOL, type ShowdownItemKey } from "#app/data/elite-redux/showdown/showdown-item-pool";
import {
  MEGA_STONE_ITEM,
  type ShowdownMonManifest,
  type UnlockSnapshot,
  validateShowdownTeam,
} from "#app/data/elite-redux/showdown/showdown-team";
import { describe, expect, it } from "vitest";

const mon = (over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest => ({
  speciesId: 6,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [1, 2, 3, 4],
  item: "LEFTOVERS",
  rootSpeciesId: 4,
  erBlackShiny: false,
  baseCost: 4,
  ...over,
});

const team = (n = 6, over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest[] =>
  Array.from({ length: n }, (_, i) => mon({ speciesId: 100 + i, rootSpeciesId: 100 + i, ...over }));

const allUnlocked: UnlockSnapshot = {
  isRootUnlocked: () => true,
  isShinyUnlocked: () => true,
  isAbilityUnlocked: () => true,
  isNatureUnlocked: () => true,
  isMoveLegal: () => true,
  isSpeciesInLine: () => true,
};

const noMegas = () => false;

const rules = (violations: ReturnType<typeof validateShowdownTeam>) => violations.map(v => v.rule);

// Deliberately type-violating input: validateShowdownTeam runs on untrusted JSON,
// so we probe its runtime guards with shapes the compile-time type forbids.
const hostile = (over: Record<string, unknown>): ShowdownMonManifest =>
  ({ ...mon(), ...over }) as unknown as ShowdownMonManifest;

describe("validateShowdownTeam", () => {
  it("accepts a fully legal team", () => {
    expect(validateShowdownTeam(team(), allUnlocked, noMegas)).toEqual([]);
  });

  it("flags a 5-member team (teamSize)", () => {
    const v = validateShowdownTeam(team(5), allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "teamSize" }));
  });

  it("flags a 7-member team (teamSize)", () => {
    const v = validateShowdownTeam(team(7), allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "teamSize" }));
  });

  it("flags a level-99 mon (level)", () => {
    const t = team();
    t[2].level = 99;
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "level", slot: 2 }));
  });

  it("flags an item not in the pool (item)", () => {
    const t = team();
    t[0].item = "MASTER_BALL";
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "item", slot: 0 }));
  });

  it("flags an empty item string (item)", () => {
    const t = team();
    t[1].item = "";
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "item", slot: 1 }));
  });

  it("accepts the mega-stone sentinel as an item for a mega mon", () => {
    const t = team();
    t[0].item = MEGA_STONE_ITEM;
    const isMega = (speciesId: number) => speciesId === t[0].speciesId;
    const v = validateShowdownTeam(t, allUnlocked, isMega);
    expect(rules(v)).not.toContain("item");
    expect(rules(v)).not.toContain("megaItem");
    expect(rules(v)).not.toContain("megaLimit");
  });

  it("flags two mega mons (megaLimit)", () => {
    const t = team();
    t[0].item = MEGA_STONE_ITEM;
    t[1].item = MEGA_STONE_ITEM;
    const isMega = (speciesId: number) => speciesId === t[0].speciesId || speciesId === t[1].speciesId;
    const v = validateShowdownTeam(t, allUnlocked, isMega);
    expect(v).toContainEqual(expect.objectContaining({ rule: "megaLimit" }));
  });

  it("flags a mega mon without the sentinel item (megaItem)", () => {
    const t = team();
    // mega form but carries a normal item
    const isMega = (speciesId: number) => speciesId === t[0].speciesId;
    const v = validateShowdownTeam(t, allUnlocked, isMega);
    expect(v).toContainEqual(expect.objectContaining({ rule: "megaItem", slot: 0 }));
  });

  it("flags a non-mega mon carrying the sentinel item (megaItem)", () => {
    const t = team();
    t[0].item = MEGA_STONE_ITEM;
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "megaItem", slot: 0 }));
  });

  it("flags a locked root species (collection)", () => {
    const t = team();
    const unlocks: UnlockSnapshot = { ...allUnlocked, isRootUnlocked: root => root !== t[3].rootSpeciesId };
    const v = validateShowdownTeam(t, unlocks, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "collection", slot: 3 }));
  });

  it("flags a shiny claimed but variant not unlocked (collection)", () => {
    const t = team(6, { shiny: true, variant: 2 });
    const unlocks: UnlockSnapshot = { ...allUnlocked, isShinyUnlocked: () => false };
    const v = validateShowdownTeam(t, unlocks, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "collection", slot: 0 }));
  });

  it("flags a locked ability (collection)", () => {
    const t = team();
    const unlocks: UnlockSnapshot = { ...allUnlocked, isAbilityUnlocked: () => false };
    const v = validateShowdownTeam(t, unlocks, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "collection" }));
  });

  it("flags a locked nature (collection)", () => {
    const t = team();
    const unlocks: UnlockSnapshot = { ...allUnlocked, isNatureUnlocked: () => false };
    const v = validateShowdownTeam(t, unlocks, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "collection" }));
  });

  it("flags an illegal move (moves)", () => {
    const t = team();
    const unlocks: UnlockSnapshot = { ...allUnlocked, isMoveLegal: (_root, _sp, moveId) => moveId !== 3 };
    const v = validateShowdownTeam(t, unlocks, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "moves", slot: 0 }));
  });

  it("flags a duplicate move in one moveset (moves)", () => {
    const t = team();
    t[0].moveset = [7, 7, 8, 9];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "moves", slot: 0 }));
  });

  it("flags an empty moveset (moves)", () => {
    const t = team();
    t[0].moveset = [];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "moves", slot: 0 }));
  });

  it("flags a 5-move moveset (moves)", () => {
    const t = team();
    t[0].moveset = [1, 2, 3, 4, 5];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "moves", slot: 0 }));
  });

  it("flags an IV array with 7 entries (ivs)", () => {
    const t = team();
    t[0].ivs = [31, 31, 31, 31, 31, 31, 31];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "ivs", slot: 0 }));
  });

  it("flags an IV value of 32 (ivs)", () => {
    const t = team();
    t[0].ivs = [32, 31, 31, 31, 31, 31];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "ivs", slot: 0 }));
  });

  it("flags a negative IV value (ivs)", () => {
    const t = team();
    t[0].ivs = [-1, 31, 31, 31, 31, 31];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "ivs", slot: 0 }));
  });

  it("flags a non-integer IV value (ivs)", () => {
    const t = team();
    t[0].ivs = [15.5, 31, 31, 31, 31, 31];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "ivs", slot: 0 }));
  });

  it("flags duplicate species (duplicate)", () => {
    const t = team();
    t[1].speciesId = t[0].speciesId;
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "duplicate" }));
  });

  it("returns ALL violations, not just the first", () => {
    const t = team(5); // teamSize violation
    t[0].level = 99; // level violation
    t[1].item = "NOT_A_REAL_ITEM"; // item violation
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    const found = rules(v);
    expect(found).toContain("teamSize");
    expect(found).toContain("level");
    expect(found).toContain("item");
  });

  it("accepts a 1-move moveset (MIN_MOVES lower boundary)", () => {
    const t = team();
    t[0].moveset = [42];
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(rules(v)).not.toContain("moves");
  });

  it("flags a NaN level (level)", () => {
    const t = team();
    t[0].level = Number.NaN;
    const v = validateShowdownTeam(t, allUnlocked, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "level", slot: 0 }));
  });

  it("flags a species not in the claimed starter line (collection)", () => {
    const t = team();
    const unlocks: UnlockSnapshot = { ...allUnlocked, isSpeciesInLine: (_root, sp) => sp !== t[2].speciesId };
    const v = validateShowdownTeam(t, unlocks, noMegas);
    expect(v).toContainEqual(expect.objectContaining({ rule: "collection", slot: 2 }));
  });

  describe("field legality (Task B6): black shiny + cost brackets", () => {
    it("rejects a black-shiny mon with its slot (blackShiny)", () => {
      const t = team();
      t[3].erBlackShiny = true;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(v).toContainEqual(expect.objectContaining({ rule: "blackShiny", slot: 3 }));
    });

    it("rejects a base-cost-10 mon (costCap)", () => {
      const t = team();
      t[0].baseCost = 10;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(v).toContainEqual(expect.objectContaining({ rule: "costCap", slot: 0 }));
    });

    it("rejects a base-cost-12 mon (costCap)", () => {
      const t = team();
      t[2].baseCost = 12;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(v).toContainEqual(expect.objectContaining({ rule: "costCap", slot: 2 }));
    });

    it("accepts a lone base-cost-9 mon among cost-7s (highCostLimit lower boundary)", () => {
      const t = team(6, { baseCost: 7 });
      t[0].baseCost = 9;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(rules(v)).not.toContain("highCostLimit");
      expect(rules(v)).not.toContain("costCap");
    });

    it("accepts exactly one base-cost-8 mon (highCostLimit boundary)", () => {
      const t = team(6, { baseCost: 7 });
      t[4].baseCost = 8;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(rules(v)).not.toContain("highCostLimit");
    });

    it("rejects two base-cost-8 mons (highCostLimit)", () => {
      const t = team(6, { baseCost: 7 });
      t[0].baseCost = 8;
      t[1].baseCost = 8;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(v).toContainEqual(expect.objectContaining({ rule: "highCostLimit" }));
    });

    it("rejects a cost-8 plus a cost-9 (mixed high-cost bracket, highCostLimit)", () => {
      const t = team(6, { baseCost: 7 });
      t[0].baseCost = 8;
      t[5].baseCost = 9;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(v).toContainEqual(expect.objectContaining({ rule: "highCostLimit" }));
    });

    it("does not count a banned cost-10 mon toward the high-cost limit", () => {
      // One legal high-cost (9) + one cost-10 (banned separately). The cost-10 must NOT
      // push highCostCount to 2 — only costCap should fire, not highCostLimit.
      const t = team(6, { baseCost: 7 });
      t[0].baseCost = 9;
      t[1].baseCost = 10;
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      expect(rules(v)).toContain("costCap");
      expect(rules(v)).not.toContain("highCostLimit");
    });
  });

  describe("hostile / malformed input (must reject, never throw)", () => {
    it("rejects a non-array team (malformed)", () => {
      const v = validateShowdownTeam(null as unknown as ShowdownMonManifest[], allUnlocked, noMegas);
      expect(v).toContainEqual(expect.objectContaining({ rule: "malformed" }));
    });

    it("rejects a null ivs without throwing (malformed)", () => {
      const t = team();
      t[3] = hostile({ ivs: null });
      let v: ReturnType<typeof validateShowdownTeam> = [];
      expect(() => {
        v = validateShowdownTeam(t, allUnlocked, noMegas);
      }).not.toThrow();
      expect(v).toContainEqual(expect.objectContaining({ rule: "malformed", slot: 3 }));
    });

    it("rejects a non-array moveset without throwing (malformed)", () => {
      const t = team();
      t[1] = hostile({ moveset: "abc" });
      let v: ReturnType<typeof validateShowdownTeam> = [];
      expect(() => {
        v = validateShowdownTeam(t, allUnlocked, noMegas);
      }).not.toThrow();
      expect(v).toContainEqual(expect.objectContaining({ rule: "malformed", slot: 1 }));
    });

    it("rejects a non-string item without throwing (malformed)", () => {
      const t = team();
      t[0] = hostile({ item: 5 });
      let v: ReturnType<typeof validateShowdownTeam> = [];
      expect(() => {
        v = validateShowdownTeam(t, allUnlocked, noMegas);
      }).not.toThrow();
      expect(v).toContainEqual(expect.objectContaining({ rule: "malformed", slot: 0 }));
    });

    it("rejects a non-boolean erBlackShiny without throwing (malformed)", () => {
      const t = team();
      t[2] = hostile({ erBlackShiny: 1 });
      let v: ReturnType<typeof validateShowdownTeam> = [];
      expect(() => {
        v = validateShowdownTeam(t, allUnlocked, noMegas);
      }).not.toThrow();
      expect(v).toContainEqual(expect.objectContaining({ rule: "malformed", slot: 2 }));
    });

    it("rejects a non-number baseCost without throwing (malformed)", () => {
      const t = team();
      t[4] = hostile({ baseCost: "8" });
      let v: ReturnType<typeof validateShowdownTeam> = [];
      expect(() => {
        v = validateShowdownTeam(t, allUnlocked, noMegas);
      }).not.toThrow();
      expect(v).toContainEqual(expect.objectContaining({ rule: "malformed", slot: 4 }));
    });

    it("skips other per-mon checks for a malformed slot but keeps team-wide checks", () => {
      const t = team(5); // teamSize violation (team-wide)
      t[0] = hostile({ ivs: null }); // malformed slot 0
      const v = validateShowdownTeam(t, allUnlocked, noMegas);
      const found = rules(v);
      expect(found).toContain("malformed");
      expect(found).toContain("teamSize");
      // no ivs/level/item violation emitted for the malformed slot
      expect(v.filter(x => x.slot === 0 && x.rule !== "malformed")).toEqual([]);
    });
  });
});

describe("MEGA_STONE_ITEM sentinel", () => {
  it("never collides with a real item-pool key", () => {
    expect(SHOWDOWN_ITEM_POOL.includes(MEGA_STONE_ITEM as ShowdownItemKey)).toBe(false);
  });
});
