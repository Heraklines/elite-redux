/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown Team Menu - FOLDERS (P3): the pure grouping/collapse row model + the additive,
// migration-safe folder field on the account preset (round-trip through the sanitizer, and the
// omit-when-absent discipline that keeps a folderless preset byte-identical to before).
// PURE - no engine boot.
// =============================================================================

import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import {
  buildTeamMenuRows,
  hasAnyFolder,
  listFolders,
  normalizeFolderName,
} from "#data/elite-redux/showdown/showdown-team-folders";
import {
  makeShowdownTeamPreset,
  type ShowdownTeamPreset,
  sanitizeShowdownTeamPresets,
  setPresetFolder,
} from "#data/elite-redux/showdown/showdown-team-preset";
import { describe, expect, it } from "vitest";

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

const preset = (name: string, folder?: string): ShowdownTeamPreset => makeShowdownTeamPreset(name, [mon()], folder);

describe("showdown team folders - buildTeamMenuRows grouping", () => {
  it("no folders => flat rows (presets then create), IDENTICAL to the pre-folders model", () => {
    const presets = [preset("A"), preset("B"), preset("C")];
    const rows = buildTeamMenuRows(presets, new Set());
    expect(rows.map(r => r.kind)).toEqual(["preset", "preset", "preset", "create"]);
    expect(rows.slice(0, 3).map(r => r.presetIndex)).toEqual([0, 1, 2]);
  });

  it("ungrouped presets come first (headerless), then a header per folder in first-appearance order", () => {
    const presets = [preset("Loose"), preset("Rain 1", "Rain"), preset("Sun 1", "Sun"), preset("Rain 2", "Rain")];
    const rows = buildTeamMenuRows(presets, new Set());
    expect(rows.map(r => r.kind)).toEqual([
      "preset", // Loose (ungrouped, no header)
      "header", // Rain
      "preset", // Rain 1
      "preset", // Rain 2
      "header", // Sun
      "preset", // Sun 1
      "create",
    ]);
    const rainHeader = rows.find(r => r.kind === "header" && r.folder === "Rain");
    expect(rainHeader?.count).toBe(2);
    expect(rows.find(r => r.kind === "header" && r.folder === "Sun")?.count).toBe(1);
  });

  it("a collapsed folder hides its preset rows but keeps the header", () => {
    const presets = [preset("Rain 1", "Rain"), preset("Rain 2", "Rain"), preset("Sun 1", "Sun")];
    const rows = buildTeamMenuRows(presets, new Set(["Rain"]));
    expect(rows.map(r => r.kind)).toEqual(["header", "header", "preset", "create"]);
    const rain = rows.find(r => r.folder === "Rain");
    expect(rain?.collapsed).toBe(true);
    expect(rain?.count).toBe(2); // count still reflects the hidden members
  });

  it("preset rows carry the ORIGINAL flat index even when reordered under folders", () => {
    const presets = [preset("Sun 1", "Sun"), preset("Loose"), preset("Sun 2", "Sun")];
    const rows = buildTeamMenuRows(presets, new Set());
    // Loose (index 1) is ungrouped -> first; then Sun header + Sun 1 (index 0) + Sun 2 (index 2).
    const presetRows = rows.filter(r => r.kind === "preset");
    expect(presetRows.map(r => r.presetIndex)).toEqual([1, 0, 2]);
  });

  it("hasAnyFolder + listFolders reflect the folder set", () => {
    expect(hasAnyFolder([preset("A"), preset("B")])).toBe(false);
    expect(hasAnyFolder([preset("A"), preset("B", "Rain")])).toBe(true);
    expect(listFolders([preset("A", "Rain"), preset("B", "Sun"), preset("C", "Rain")])).toEqual(["Rain", "Sun"]);
  });

  it("normalizeFolderName trims + clamps; empty stays empty (ungrouped)", () => {
    expect(normalizeFolderName("  Rain  ")).toBe("Rain");
    expect(normalizeFolderName("   ")).toBe("");
    expect(normalizeFolderName("x".repeat(50)).length).toBe(24);
  });
});

describe("showdown team folders - preset folder field (additive/migration-safe)", () => {
  it("makeShowdownTeamPreset OMITS folder when absent, sets it when given", () => {
    expect("folder" in makeShowdownTeamPreset("A", [mon()])).toBe(false);
    expect(makeShowdownTeamPreset("A", [mon()], "Rain").folder).toBe("Rain");
    // Empty/whitespace folder stays omitted.
    expect("folder" in makeShowdownTeamPreset("A", [mon()], "   ")).toBe(false);
  });

  it("setPresetFolder assigns, then clears (removing the key) with an empty name", () => {
    let list = [makeShowdownTeamPreset("A", [mon()])];
    list = setPresetFolder(list, 0, "Rain");
    expect(list[0].folder).toBe("Rain");
    list = setPresetFolder(list, 0, "");
    expect("folder" in list[0]).toBe(false);
  });

  it("setPresetFolder returns a NEW array and no-ops on a bad index", () => {
    const list = [makeShowdownTeamPreset("A", [mon()])];
    const next = setPresetFolder(list, 5, "Rain");
    expect(next).not.toBe(list);
    expect(next).toEqual(list);
  });

  it("the folder round-trips through the save sanitizer; a corrupt folder drops to ungrouped", () => {
    const saved = [
      makeShowdownTeamPreset("A", [mon()], "Rain"),
      { ...makeShowdownTeamPreset("B", [mon()]), folder: 123 as unknown as string },
    ];
    const loaded = sanitizeShowdownTeamPresets(JSON.parse(JSON.stringify(saved)));
    expect(loaded[0].folder).toBe("Rain");
    expect("folder" in loaded[1]).toBe(false); // corrupt (numeric) folder is dropped, preset survives
  });
});
