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
};

const noMegas = () => false;

const rules = (violations: ReturnType<typeof validateShowdownTeam>) => violations.map(v => v.rule);

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
});
