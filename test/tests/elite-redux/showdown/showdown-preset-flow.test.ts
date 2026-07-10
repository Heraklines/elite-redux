/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Team Menu - Phase C/D flow: the manifest<->starter round-trip (hash parity),
// the offline build orchestrator (create round-trips into systemData; edit updates in
// place; cancel returns without saving), the menu preset-validation views, and the
// pre-pairing pending-preset slot.
//
// RED-PROOF (the load-bearing flow assertion): `starterToManifest(manifestToStarter(m))`
// is BYTE-IDENTICAL to `m`. Both clients hash the wire manifest at the ready gate, so a
// reconstruct that added a spurious `nature`/`erShinyLab` (or dropped a field) would void
// every real match exactly like the erShinyLab:undefined class. Break the roundtrip and this
// test goes red at that assertion.
// =============================================================================

import {
  consumePendingShowdownPresetStarters,
  setPendingShowdownPresetStarters,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { manifestToStarter, starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { buildTeamMenuPresetViews, runShowdownPresetBuild } from "#data/elite-redux/showdown/showdown-team-menu-flow";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import type { Starter } from "#types/save-data";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A legal-ish Bulbasaur manifest (Tackle is a base-line level move; everything.prsv owns the line). */
function bulbasaur(over: Partial<ShowdownMonManifest> = {}): ShowdownMonManifest {
  return {
    speciesId: SpeciesId.BULBASAUR,
    formIndex: 0,
    level: 100,
    shiny: false,
    variant: 0,
    abilityIndex: 0,
    ivs: [31, 31, 31, 31, 31, 31],
    moveset: [MoveId.TACKLE],
    item: "LEFTOVERS",
    rootSpeciesId: SpeciesId.BULBASAUR,
    erBlackShiny: false,
    baseCost: 3,
    ...over,
  };
}

describe.runIf(RUN)("showdown preset flow - manifest<->starter round-trip (hash parity)", () => {
  const roundtrip = (m: ShowdownMonManifest) =>
    starterToManifest(manifestToStarter(m), { dexData: {}, starterData: {} });
  // Recomputed baseCost reads the real table; normalize it out (every OTHER field must be byte-identical).
  const norm = (x: ShowdownMonManifest) => ({ ...x, baseCost: 0 });

  it("is byte-identical for production (nature-bearing) manifests", () => {
    // Real manifests ALWAYS carry a nature (starterToManifest populates it), so the reconstruct is a
    // byte-identical round-trip - the property both clients rely on to hash the same wire shape.
    const cases: ShowdownMonManifest[] = [
      bulbasaur({ nature: 0 }),
      bulbasaur({ speciesId: SpeciesId.VENUSAUR, nature: 5, moveset: [MoveId.TACKLE, MoveId.GROWL] }),
      bulbasaur({ shiny: true, variant: 1, nature: 3, erShinyLab: [1, 2, 3, 4] }),
      bulbasaur({ item: "MEGA_STONE", nature: 2 }),
    ];
    for (const m of cases) {
      expect(norm(roundtrip(m))).toEqual(norm(m));
    }
  });

  it("NEVER conjures erShinyLab on a shiny without a carried look (the void red-proof)", () => {
    // A shiny mon with no Shiny Lab look must round-trip WITHOUT an erShinyLab key - a spurious one
    // would poison the team hash exactly like the erShinyLab:undefined anti-tamper void.
    const m = bulbasaur({ shiny: true, variant: 0, nature: 1 });
    const rt = roundtrip(m);
    expect("erShinyLab" in rt).toBe(false);
    expect(norm(rt)).toEqual(norm(m));
    // ...and a carried look survives verbatim.
    const withLook = bulbasaur({ shiny: true, variant: 2, nature: 1, erShinyLab: [9, 8, 7] });
    expect(roundtrip(withLook).erShinyLab).toEqual([9, 8, 7]);
  });

  it("is deterministic - both clients reconstruct the same wire shape", () => {
    const m = bulbasaur({ speciesId: SpeciesId.VENUSAUR, nature: 5, shiny: true, variant: 1, erShinyLab: [1, 2] });
    expect(roundtrip(m)).toEqual(roundtrip(m));
  });
});

describe.runIf(RUN)("showdown preset flow - build orchestrator + views + pending slot", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
    game.scene.gameData.showdownTeamPresets = [];
  });

  it("CREATE round-trips a built team into systemData", () => {
    const gd = game.scene.gameData;
    const starters: Starter[] = [
      manifestToStarter(bulbasaur()),
      manifestToStarter(bulbasaur({ speciesId: SpeciesId.IVYSAUR })),
    ];
    runShowdownPresetBuild(undefined, "Team", {
      openStarterSelect: onLockIn => onLockIn(starters),
      promptName: (_def, onName) => onName("Grass Core"),
      toManifest: s => starterToManifest(s, gd),
      save: (name, mons, index) => gd.saveShowdownTeamPreset(name, mons, index),
      onSettled: () => {},
    });
    const saved = gd.getSystemSaveData().showdownTeamPresets;
    expect(saved?.length).toBe(1);
    expect(saved?.[0].name).toBe("Grass Core");
    expect(saved?.[0].mons.length).toBe(2);
  });

  it("EDIT updates the preset in place (same index, new content)", () => {
    const gd = game.scene.gameData;
    gd.saveShowdownTeamPreset("Old A", [bulbasaur()]);
    gd.saveShowdownTeamPreset("Keep B", [
      bulbasaur({ speciesId: SpeciesId.CHARMANDER, rootSpeciesId: SpeciesId.CHARMANDER }),
    ]);
    runShowdownPresetBuild(0, "Old A", {
      openStarterSelect: onLockIn => onLockIn([manifestToStarter(bulbasaur({ speciesId: SpeciesId.VENUSAUR }))]),
      promptName: (_def, onName) => onName("New A"),
      toManifest: s => starterToManifest(s, gd),
      save: (name, mons, index) => gd.saveShowdownTeamPreset(name, mons, index),
      onSettled: () => {},
    });
    const list = gd.listShowdownTeamPresets();
    expect(list.map(p => p.name)).toEqual(["New A", "Keep B"]); // index 0 replaced, index 1 untouched
    expect(list[0].mons[0].speciesId).toBe(SpeciesId.VENUSAUR);
  });

  it("EDIT pre-seeds the grid with the preset's reconstructed mons, then saves the modified team in place", () => {
    const gd = game.scene.gameData;
    // A rich preset: a FIELDED evolution (Venusaur off the Bulbasaur line), a non-default nature, a
    // shiny+variant, and a real moveset - every facet the edit-seed must carry into the grid pre-show.
    const preset: ShowdownMonManifest[] = [
      bulbasaur({
        speciesId: SpeciesId.VENUSAUR,
        formIndex: 0,
        rootSpeciesId: SpeciesId.BULBASAUR,
        nature: 5,
        shiny: true,
        variant: 1,
        moveset: [MoveId.TACKLE, MoveId.GROWL],
      }),
      bulbasaur({ speciesId: SpeciesId.CHARMANDER, rootSpeciesId: SpeciesId.CHARMANDER, nature: 2 }),
    ];
    gd.saveShowdownTeamPreset("Grass+Fire", preset);
    // Title-phase reconstructs the seed exactly this way (manifestToStarter over the preset's mons).
    const seedStarters = preset.map(manifestToStarter);

    let seenSeed: Starter[] | null = null;
    runShowdownPresetBuild(
      0,
      "Grass+Fire",
      {
        // The grid handler receives `seed` as its show arg (args[2].seedStarters) - capture it and assert it
        // reconstructs the preset. RED-PROOF: revert the seeding (drop the 4th arg / pass []) and `seenSeed`
        // is EMPTY, so the length + per-field assertions below fail naming the empty party.
        openStarterSelect: (onLockIn, _onCancel, seed) => {
          seenSeed = seed;
          // A modified confirm: the player swaps in a different final team; edit must save it in place.
          onLockIn([
            manifestToStarter(bulbasaur({ speciesId: SpeciesId.IVYSAUR, rootSpeciesId: SpeciesId.BULBASAUR })),
          ]);
        },
        promptName: (_def, onName) => onName("Grass+Fire v2"),
        toManifest: s => starterToManifest(s, gd),
        save: (name, mons, index) => gd.saveShowdownTeamPreset(name, mons, index),
        onSettled: () => {},
      },
      seedStarters,
    );

    // The seeded party pre-show matches the preset's manifests (species/form/shiny/nature/moves).
    expect(seenSeed).not.toBeNull();
    expect(seenSeed!).toHaveLength(preset.length);
    seenSeed!.forEach((s, i) => {
      const m = preset[i];
      expect(s.speciesId).toBe(m.rootSpeciesId); // grid pick is the line ROOT
      expect(s.showdownSpeciesId).toBe(m.speciesId); // fielded stage
      expect(s.showdownFormIndex).toBe(m.formIndex);
      expect(s.shiny).toBe(m.shiny);
      expect(s.variant).toBe(m.variant);
      expect(s.nature).toBe(m.nature);
      expect(s.moveset).toEqual(m.moveset);
    });
    // ...and the reconstruction round-trips byte-identical to the stored manifests (baseCost normalized).
    const norm = (x: ShowdownMonManifest) => ({ ...x, baseCost: 0 });
    expect(seenSeed!.map(s => norm(starterToManifest(s, gd)))).toEqual(preset.map(norm));

    // The modified confirm saved IN PLACE at index 0; index 1 untouched, no new slot appended.
    const list = gd.listShowdownTeamPresets();
    expect(list.map(p => p.name)).toEqual(["Grass+Fire v2"]);
    expect(list[0].mons.map(m => m.speciesId)).toEqual([SpeciesId.IVYSAUR]);
  });

  it("CANCEL from the offline build (create + edit) returns to the Team Menu without saving", () => {
    const gd = game.scene.gameData;
    gd.saveShowdownTeamPreset("Keep", [bulbasaur()]);

    // EDIT-cancel: the player backs out of the grid (onCancel fired). It must settle WITHOUT saving,
    // restore the borrowed gameMode (modeled by `borrowed`), reopen the menu (`settled`), and never leak
    // a pending lobby-preset stash. This is the fix: previously cancel exited to the title, not the menu.
    let borrowed = true; // title-phase borrows SHOWDOWN for the build; onSettled restores it
    let settled = 0;
    const editSave = vi.fn();
    runShowdownPresetBuild(
      0,
      "Keep",
      {
        openStarterSelect: (_onLockIn, onCancel) => onCancel(),
        promptName: (_d, on) => on("won't happen"),
        toManifest: s => starterToManifest(s, gd),
        save: editSave,
        onSettled: () => {
          borrowed = false; // gameMode restored on the cancel path (clean, no next-launch self-heal)
          settled++; // reopened the Team Menu
        },
      },
      [manifestToStarter(bulbasaur())],
    );
    expect(editSave).not.toHaveBeenCalled();
    expect(settled).toBe(1);
    expect(borrowed).toBe(false);
    expect(gd.listShowdownTeamPresets().map(p => p.name)).toEqual(["Keep"]); // preset unchanged
    expect(consumePendingShowdownPresetStarters()).toBeNull(); // offline build never touched the lobby stash

    // CREATE-cancel: same terminal (settle, no save) with no editIndex.
    let createSettled = 0;
    const createSave = vi.fn();
    runShowdownPresetBuild(undefined, "Team", {
      openStarterSelect: (_onLockIn, onCancel) => onCancel(),
      promptName: (_d, on) => on("won't happen"),
      toManifest: s => starterToManifest(s, gd),
      save: createSave,
      onSettled: () => {
        createSettled++;
      },
    });
    expect(createSave).not.toHaveBeenCalled();
    expect(createSettled).toBe(1);
    expect(gd.listShowdownTeamPresets().map(p => p.name)).toEqual(["Keep"]); // still just the one preset
    expect(consumePendingShowdownPresetStarters()).toBeNull();
  });

  it("CANCEL (no lock-in) returns without saving", () => {
    const gd = game.scene.gameData;
    const save = vi.fn();
    runShowdownPresetBuild(undefined, "Team", {
      openStarterSelect: () => {}, // never confirms (user backed out of starter-select)
      promptName: (_def, onName) => onName("won't happen"),
      toManifest: s => starterToManifest(s, gd),
      save,
      onSettled: () => {},
    });
    expect(save).not.toHaveBeenCalled();
    expect(gd.listShowdownTeamPresets().length).toBe(0);
  });

  it("CANCEL at the NAME prompt returns without saving", () => {
    const gd = game.scene.gameData;
    const save = vi.fn();
    runShowdownPresetBuild(undefined, "Team", {
      openStarterSelect: onLockIn => onLockIn([manifestToStarter(bulbasaur())]),
      promptName: (_def, onName) => onName(null), // cancelled name modal
      toManifest: s => starterToManifest(s, gd),
      save,
      onSettled: () => {},
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("buildTeamMenuPresetViews flags an invalid preset with a reason, keeps a valid one clean", () => {
    const gd = game.scene.gameData;
    gd.saveShowdownTeamPreset("Legal", [bulbasaur()]);
    gd.saveShowdownTeamPreset("Overcost", [bulbasaur({ baseCost: 10 })]); // cost-cap violation
    const views = buildTeamMenuPresetViews(gd);
    expect(views.length).toBe(2);
    expect(views[0].name).toBe("Legal");
    expect(views[0].invalidReason).toBeNull();
    expect(views[1].invalidReason).not.toBeNull();
    expect(views[1].invalidReason?.toLowerCase()).toContain("cost");
  });

  it("the pending preset slot is single-use (consume clears it)", () => {
    const starters = [manifestToStarter(bulbasaur())];
    setPendingShowdownPresetStarters(starters);
    expect(consumePendingShowdownPresetStarters()).toBe(starters);
    expect(consumePendingShowdownPresetStarters()).toBeNull(); // cleared after one read
  });
});
