import { erMegaTargetToBaseSpeciesId } from "#app/data/elite-redux/er-generic-pool-bans";
import { ER_ID_MAP } from "#app/data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#app/data/elite-redux/er-mega-forms";
import {
  buildUnlockSnapshot,
  type ShowdownUnlockGameData,
  starterToManifest,
} from "#app/data/elite-redux/showdown/showdown-manifest";
import { MEGA_STONE_ITEM } from "#app/data/elite-redux/showdown/showdown-team";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { pokemonSpeciesLevelMoves } from "#balance/pokemon-level-moves";
import { DexAttr } from "#enums/dex-attr";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import type { Starter } from "#types/save-data";
import { describe, expect, it } from "vitest";

const baseStarter = (over: Partial<Starter> = {}): Starter => ({
  speciesId: SpeciesId.CHARMANDER,
  shiny: false,
  variant: 0,
  formIndex: 0,
  abilityIndex: 0,
  passive: false,
  nature: Nature.HARDY,
  moveset: [1, 2, 3, 4],
  pokerus: false,
  ivs: [31, 31, 31, 31, 31, 31],
  ...over,
});

const emptyGameData: ShowdownUnlockGameData = { dexData: {}, starterData: {} };

describe("starterToManifest", () => {
  it("fields the base species/form when no stage was picked", () => {
    const m = starterToManifest(baseStarter(), emptyGameData);
    expect(m.speciesId).toBe(SpeciesId.CHARMANDER);
    expect(m.formIndex).toBe(0);
    expect(m.rootSpeciesId).toBe(SpeciesId.CHARMANDER);
    expect(m.level).toBe(100);
  });

  it("fields the chosen stage/form but keeps root = grid pick", () => {
    const m = starterToManifest(
      baseStarter({ showdownSpeciesId: SpeciesId.CHARIZARD, showdownFormIndex: 2 }),
      emptyGameData,
    );
    expect(m.speciesId).toBe(SpeciesId.CHARIZARD);
    expect(m.formIndex).toBe(2);
    expect(m.rootSpeciesId).toBe(SpeciesId.CHARMANDER);
  });

  it("carries the chosen held item, defaulting to a pool item when unset", () => {
    expect(starterToManifest(baseStarter({ showdownItem: "SHELL_BELL" }), emptyGameData).item).toBe("SHELL_BELL");
    expect(starterToManifest(baseStarter({ showdownItem: MEGA_STONE_ITEM }), emptyGameData).item).toBe(MEGA_STONE_ITEM);
    // Unset -> a legal default (never an empty string, which the validator rejects).
    expect(starterToManifest(baseStarter({ showdownItem: undefined }), emptyGameData).item).not.toBe("");
  });

  it("always sets level 100 and copies the collection attributes", () => {
    const m = starterToManifest(
      baseStarter({ shiny: true, variant: 2, abilityIndex: 2, nature: Nature.MODEST, moveset: [10, 20] }),
      emptyGameData,
    );
    expect(m.level).toBe(100);
    expect(m.shiny).toBe(true);
    expect(m.variant).toBe(2);
    expect(m.abilityIndex).toBe(2);
    expect(m.nature).toBe(Nature.MODEST);
    expect(m.moveset).toEqual([10, 20]);
    expect(m.ivs).toEqual([31, 31, 31, 31, 31, 31]);
  });

  it("carries the per-mon Shiny Lab look on a SHINY pick, dropping it otherwise (Task C7)", () => {
    // A 14-number encoded SavedLook tuple (the carried #785 look, stamped at build).
    const look = [1, 2, 3, 200, 150, 100, 96, 0, 0, 0, 0, 0, 128, 128];
    // Shiny + carried look -> the look round-trips onto the manifest (a COPY, not the same ref).
    const shinyM = starterToManifest(
      baseStarter({ shiny: true, erShinyLab: look as Starter["erShinyLab"] }),
      emptyGameData,
    );
    expect(shinyM.erShinyLab).toEqual(look);
    expect(shinyM.erShinyLab).not.toBe(look);
    // Non-shiny drops the look entirely (mirrors serializeShinyLabLook's shiny gate).
    const dullM = starterToManifest(
      baseStarter({ shiny: false, erShinyLab: look as Starter["erShinyLab"] }),
      emptyGameData,
    );
    expect(dullM.erShinyLab).toBeUndefined();
    // A shiny with NO carried look carries none.
    expect(starterToManifest(baseStarter({ shiny: true }), emptyGameData).erShinyLab).toBeUndefined();
  });

  it("populates erBlackShiny + baseCost from the starter and the raw cost table (Task B6)", () => {
    // CHARMANDER's raw speciesStarterCosts base value is 3; default erBlackShiny is false.
    const base = starterToManifest(baseStarter(), emptyGameData);
    expect(base.erBlackShiny).toBe(false);
    expect(base.baseCost).toBe(3);
    // A black-shiny pick carries the flag through.
    expect(starterToManifest(baseStarter({ erBlackShiny: true }), emptyGameData).erBlackShiny).toBe(true);
  });

  it("uses baseCost from the LINE ROOT (grid pick), not the fielded stage", () => {
    // The grid pick (root) is CHARMANDER (cost 3); fielding an evolved CHARIZARD stage
    // must NOT change baseCost — it stays the root's raw cost.
    const m = starterToManifest(
      baseStarter({ showdownSpeciesId: SpeciesId.CHARIZARD, showdownFormIndex: 0 }),
      emptyGameData,
    );
    expect(m.rootSpeciesId).toBe(SpeciesId.CHARMANDER);
    expect(m.baseCost).toBe(3);
  });

  it("falls back to baseCost 4 for a species absent from the cost table (?? 4)", () => {
    // CHARIZARD is not a starter-cost key (only roots are), so the ?? 4 fallback applies.
    const m = starterToManifest(baseStarter({ speciesId: SpeciesId.CHARIZARD }), emptyGameData);
    expect(m.baseCost).toBe(4);
  });

  it("copies arrays (no shared references with the starter)", () => {
    const starter = baseStarter();
    const m = starterToManifest(starter, emptyGameData);
    m.ivs[0] = 0;
    m.moveset.push(999);
    expect(starter.ivs[0]).toBe(31);
    expect(starter.moveset).toEqual([1, 2, 3, 4]);
  });
});

describe("buildUnlockSnapshot", () => {
  const gameData = (over: Partial<ShowdownUnlockGameData>): ShowdownUnlockGameData => ({
    dexData: {},
    starterData: {},
    ...over,
  });

  describe("isRootUnlocked", () => {
    it("is true only when the line has any caught bits", () => {
      const snap = buildUnlockSnapshot(
        gameData({ dexData: { [SpeciesId.CHARMANDER]: { caughtAttr: DexAttr.NON_SHINY, natureAttr: 0 } } }),
      );
      expect(snap.isRootUnlocked(SpeciesId.CHARMANDER)).toBe(true);
      expect(snap.isRootUnlocked(SpeciesId.SQUIRTLE)).toBe(false);
    });
  });

  describe("isShinyUnlocked", () => {
    it("requires the SHINY bit and the specific variant bit", () => {
      const caughtAttr = DexAttr.SHINY | DexAttr.DEFAULT_VARIANT | DexAttr.VARIANT_2;
      const snap = buildUnlockSnapshot(
        gameData({ dexData: { [SpeciesId.CHARMANDER]: { caughtAttr, natureAttr: 0 } } }),
      );
      expect(snap.isShinyUnlocked(SpeciesId.CHARMANDER, 0)).toBe(true); // DEFAULT_VARIANT
      expect(snap.isShinyUnlocked(SpeciesId.CHARMANDER, 1)).toBe(true); // VARIANT_2
      expect(snap.isShinyUnlocked(SpeciesId.CHARMANDER, 2)).toBe(false); // VARIANT_3 not caught
    });

    it("is false without the SHINY bit even if a variant bit is present", () => {
      const snap = buildUnlockSnapshot(
        gameData({
          dexData: {
            [SpeciesId.CHARMANDER]: { caughtAttr: DexAttr.NON_SHINY | DexAttr.DEFAULT_VARIANT, natureAttr: 0 },
          },
        }),
      );
      expect(snap.isShinyUnlocked(SpeciesId.CHARMANDER, 0)).toBe(false);
    });
  });

  describe("isAbilityUnlocked", () => {
    it("maps ability index 0/1/2 to the ABILITY_1/2/HIDDEN bits", () => {
      // ABILITY_1 (1) + ABILITY_HIDDEN (4) unlocked, ABILITY_2 (2) locked.
      const snap = buildUnlockSnapshot(
        gameData({ starterData: { [SpeciesId.CHARMANDER]: { abilityAttr: 5, eggMoves: 0 } } }),
      );
      expect(snap.isAbilityUnlocked(SpeciesId.CHARMANDER, 0)).toBe(true);
      expect(snap.isAbilityUnlocked(SpeciesId.CHARMANDER, 1)).toBe(false);
      expect(snap.isAbilityUnlocked(SpeciesId.CHARMANDER, 2)).toBe(true);
    });
  });

  describe("isNatureUnlocked", () => {
    it("reads nature n from bit (n + 1)", () => {
      const natureAttr = (1 << (Nature.HARDY + 1)) | (1 << (Nature.MODEST + 1));
      const snap = buildUnlockSnapshot(
        gameData({ dexData: { [SpeciesId.CHARMANDER]: { caughtAttr: 0n, natureAttr } } }),
      );
      expect(snap.isNatureUnlocked(SpeciesId.CHARMANDER, Nature.HARDY)).toBe(true);
      expect(snap.isNatureUnlocked(SpeciesId.CHARMANDER, Nature.MODEST)).toBe(true);
      expect(snap.isNatureUnlocked(SpeciesId.CHARMANDER, Nature.ADAMANT)).toBe(false);
    });
  });

  describe("isMoveLegal", () => {
    it("accepts an early (level 1-5) level-up move of the root", () => {
      const early = (pokemonSpeciesLevelMoves[SpeciesId.CHARMANDER] ?? []).find(([lvl]) => lvl > 0 && lvl <= 5);
      expect(early, "Charmander should have a level 1-5 move").toBeDefined();
      const snap = buildUnlockSnapshot(emptyGameData);
      expect(snap.isMoveLegal(SpeciesId.CHARMANDER, SpeciesId.CHARIZARD, early![1])).toBe(true);
    });

    it("rejects a move that is neither an early level-up move nor an unlocked egg move", () => {
      const snap = buildUnlockSnapshot(emptyGameData);
      expect(snap.isMoveLegal(SpeciesId.CHARMANDER, SpeciesId.CHARIZARD, 999999)).toBe(false);
    });

    it("accepts an egg move only once its slot bit is unlocked", () => {
      const eggMoves = speciesEggMoves[SpeciesId.CHARMANDER];
      expect(eggMoves, "Charmander should have egg moves").toBeDefined();
      const locked = buildUnlockSnapshot(
        gameData({ starterData: { [SpeciesId.CHARMANDER]: { abilityAttr: 0, eggMoves: 0 } } }),
      );
      const unlocked = buildUnlockSnapshot(
        gameData({ starterData: { [SpeciesId.CHARMANDER]: { abilityAttr: 0, eggMoves: 0b0001 } } }),
      );
      // The first egg move is illegal while its slot is locked, legal once unlocked -
      // unless it happens to double as an early level-up move (then it is always legal).
      const isAlsoLevelMove = (pokemonSpeciesLevelMoves[SpeciesId.CHARMANDER] ?? []).some(
        ([lvl, mv]) => lvl > 0 && lvl <= 5 && mv === eggMoves[0],
      );
      expect(locked.isMoveLegal(SpeciesId.CHARMANDER, SpeciesId.CHARMANDER, eggMoves[0])).toBe(isAlsoLevelMove);
      expect(unlocked.isMoveLegal(SpeciesId.CHARMANDER, SpeciesId.CHARMANDER, eggMoves[0])).toBe(true);
    });
  });

  describe("isSpeciesInLine", () => {
    const snap = buildUnlockSnapshot(emptyGameData);

    it("accepts the root itself", () => {
      expect(snap.isSpeciesInLine(SpeciesId.CHARMANDER, SpeciesId.CHARMANDER)).toBe(true);
    });

    it("accepts an evolved stage via the prevolution chain", () => {
      expect(snap.isSpeciesInLine(SpeciesId.CHARMANDER, SpeciesId.CHARMELEON)).toBe(true);
      expect(snap.isSpeciesInLine(SpeciesId.CHARMANDER, SpeciesId.CHARIZARD)).toBe(true);
    });

    it("rejects a species from another line", () => {
      expect(snap.isSpeciesInLine(SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE)).toBe(false);
      expect(snap.isSpeciesInLine(SpeciesId.CHARMANDER, SpeciesId.BLASTOISE)).toBe(false);
    });

    it("accepts an ER custom mega-form species as in-line for its base root (anti-spoof)", () => {
      // Pick a REAL mega form whose target resolves to a base via erMegaTargetToBaseSpeciesId:
      // the mega form is a standalone custom species (id >= 10000), so isSpeciesInLine must
      // resolve it back to its base before walking the line, or a legit mega pick is rejected.
      const megaTargetPokeId = ER_MEGA_FORMS.map(entry => ER_ID_MAP.species[entry.targetErId]).find(
        pkId => pkId !== undefined && erMegaTargetToBaseSpeciesId(pkId) !== undefined,
      );
      expect(megaTargetPokeId, "at least one ER mega target must resolve to a base").toBeDefined();
      const baseRoot = erMegaTargetToBaseSpeciesId(megaTargetPokeId!)!;
      // The mega-target custom species id is accepted as in-line for its base root...
      expect(snap.isSpeciesInLine(baseRoot, megaTargetPokeId!)).toBe(true);
      // ...but NOT for an unrelated root (the mega must not spoof into another line).
      const otherRoot = baseRoot === SpeciesId.MEW ? SpeciesId.MEWTWO : SpeciesId.MEW;
      expect(snap.isSpeciesInLine(otherRoot, megaTargetPokeId!)).toBe(false);
    });
  });
});
