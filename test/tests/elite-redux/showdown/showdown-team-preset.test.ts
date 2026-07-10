import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import {
  deletePreset,
  MAX_SHOWDOWN_TEAM_PRESETS,
  makeShowdownTeamPreset,
  normalizePresetName,
  renamePreset,
  SHOWDOWN_TEAM_PRESET_VERSION,
  type ShowdownTeamPreset,
  sanitizeShowdownTeamPresets,
  upsertPreset,
} from "#data/elite-redux/showdown/showdown-team-preset";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** Minimal-but-complete wire manifest for a fielded mon (matches `starterToManifest` shape). */
function mon(over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest {
  return {
    speciesId: 3,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [33, 34],
    item: "LEFTOVERS",
    rootSpeciesId: 1,
    erBlackShiny: false,
    baseCost: 4,
    ...over,
  };
}

describe("showdown team presets - pure CRUD helpers", () => {
  it("makeShowdownTeamPreset stamps version + normalizes name + deep-clones mons", () => {
    const mons = [mon()];
    const preset = makeShowdownTeamPreset("  Rain Team  ", mons);
    expect(preset.version).toBe(SHOWDOWN_TEAM_PRESET_VERSION);
    expect(preset.name).toBe("Rain Team");
    expect(preset.mons).toEqual(mons);
    expect(preset.mons).not.toBe(mons); // deep clone, not alias
    expect(preset.mons[0]).not.toBe(mons[0]);
  });

  it("normalizePresetName trims, caps length, and falls back for empty", () => {
    expect(normalizePresetName("   ")).toBe("Team");
    expect(normalizePresetName("x".repeat(50)).length).toBe(24);
  });

  it("upsert appends a new preset, replaces at a valid index", () => {
    const a = makeShowdownTeamPreset("A", [mon({ speciesId: 3 })]);
    const b = makeShowdownTeamPreset("B", [mon({ speciesId: 6 })]);
    let list: ShowdownTeamPreset[] = [];
    list = upsertPreset(list, a);
    list = upsertPreset(list, b);
    expect(list.map(p => p.name)).toEqual(["A", "B"]);

    const bEdited = makeShowdownTeamPreset("B2", [mon({ speciesId: 9 })]);
    const replaced = upsertPreset(list, bEdited, 1);
    expect(replaced.map(p => p.name)).toEqual(["A", "B2"]);
    // input array untouched (immutability)
    expect(list.map(p => p.name)).toEqual(["A", "B"]);
  });

  it("upsert caps the list at MAX_SHOWDOWN_TEAM_PRESETS (oldest dropped)", () => {
    let list: ShowdownTeamPreset[] = [];
    for (let i = 0; i < MAX_SHOWDOWN_TEAM_PRESETS + 5; i++) {
      list = upsertPreset(list, makeShowdownTeamPreset(`T${i}`, [mon()]));
    }
    expect(list.length).toBe(MAX_SHOWDOWN_TEAM_PRESETS);
    // the 5 oldest were evicted
    expect(list[0].name).toBe("T5");
  });

  it("rename + delete return new arrays and no-op on bad indices", () => {
    const list = [makeShowdownTeamPreset("A", [mon()]), makeShowdownTeamPreset("B", [mon()])];
    const renamed = renamePreset(list, 0, "Alpha");
    expect(renamed[0].name).toBe("Alpha");
    expect(list[0].name).toBe("A"); // immutable

    const badRename = renamePreset(list, 9, "nope");
    expect(badRename.map(p => p.name)).toEqual(["A", "B"]);

    const deleted = deletePreset(list, 0);
    expect(deleted.map(p => p.name)).toEqual(["B"]);
    const badDelete = deletePreset(list, -1);
    expect(badDelete.map(p => p.name)).toEqual(["A", "B"]);
  });
});

describe("showdown team presets - defensive load sanitizer", () => {
  it("drops non-array, keeps well-formed, drops malformed mons", () => {
    expect(sanitizeShowdownTeamPresets(null)).toEqual([]);
    expect(sanitizeShowdownTeamPresets("garbage")).toEqual([]);

    const good = makeShowdownTeamPreset("Good", [mon()]);
    const raw = [
      good,
      { name: "NoMons", mons: [] }, // empty team → dropped
      { name: "TooMany", mons: new Array(7).fill(mon()) }, // >6 → dropped
      { name: "BadMon", mons: [{ speciesId: "x" }] }, // malformed mon → dropped
      { mons: [mon()] }, // missing name → kept, name normalized
    ];
    const out = sanitizeShowdownTeamPresets(raw);
    expect(out.map(p => p.name)).toEqual(["Good", "Team"]);
  });

  it("preserves omit-when-absent optionals through sanitize (nature / erShinyLab)", () => {
    const plain = mon(); // no nature, no erShinyLab
    const decorated = mon({ speciesId: 6, nature: 3, erShinyLab: [1, 2, 3] });
    const out = sanitizeShowdownTeamPresets([makeShowdownTeamPreset("T", [plain, decorated])]);
    const [p0, p1] = out[0].mons;
    expect("nature" in p0).toBe(false);
    expect("erShinyLab" in p0).toBe(false);
    expect(p1.nature).toBe(3);
    expect(p1.erShinyLab).toEqual([1, 2, 3]);
  });
});

describe("showdown team presets - save serializer round-trip", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
  });

  it("persists presets through getSystemSaveData / initParsedSystem", () => {
    const gd = game.scene.gameData;
    gd.saveShowdownTeamPreset("Sun Team", [mon({ speciesId: 3, nature: 3 }), mon({ speciesId: 6 })]);
    gd.saveShowdownTeamPreset("Rain Team", [mon({ speciesId: 9, erShinyLab: [5, 6] })]);
    expect(gd.listShowdownTeamPresets().length).toBe(2);

    // Snapshot through a real JSON disk round-trip (what saveSystem writes / initParsedSystem reads).
    const saved = gd.getSystemSaveData();
    const savedPresets = JSON.parse(JSON.stringify(saved.showdownTeamPresets));

    // Mutate the live state so the load path is proven to restore it.
    gd.showdownTeamPresets = [];

    // biome-ignore lint/suspicious/noExplicitAny: testing private save-init path
    (gd as any).initParsedSystem({ ...saved, showdownTeamPresets: savedPresets });

    const restored = gd.listShowdownTeamPresets();
    expect(restored.length).toBe(2);
    expect(restored[0].name).toBe("Sun Team");
    expect(restored[0].mons[0].nature).toBe(3);
    expect("nature" in restored[0].mons[1]).toBe(false); // omit-when-absent survives the round-trip
    expect(restored[1].mons[0].erShinyLab).toEqual([5, 6]);
  });

  it("loads a pre-feature save (absent field) as an empty list", () => {
    const gd = game.scene.gameData;
    const saved = gd.getSystemSaveData();
    // biome-ignore lint/suspicious/noExplicitAny: simulating an older save without the new field
    delete (saved as any).showdownTeamPresets;
    // biome-ignore lint/suspicious/noExplicitAny: testing private save-init path
    (gd as any).initParsedSystem(saved);
    expect(gd.listShowdownTeamPresets()).toEqual([]);
  });

  it("saveShowdownTeamPreset with an index edits in place", () => {
    const gd = game.scene.gameData;
    gd.showdownTeamPresets = [];
    const i0 = gd.saveShowdownTeamPreset("First", [mon()]);
    gd.saveShowdownTeamPreset("Second", [mon({ speciesId: 6 })]);
    const editedIdx = gd.saveShowdownTeamPreset("First (edited)", [mon({ speciesId: 12 })], i0);
    expect(editedIdx).toBe(0);
    const list = gd.listShowdownTeamPresets();
    expect(list.map(p => p.name)).toEqual(["First (edited)", "Second"]);
    expect(list[0].mons[0].speciesId).toBe(12);
  });
});
