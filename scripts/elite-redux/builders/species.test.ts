/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSpeciesEntry } from "./species.mjs";

const SAMPLE_PATH = resolve(__dirname, "../fixtures/sample-species.json");
const RICH_PATH = resolve(__dirname, "../fixtures/sample-species-rich.json");

describe("species transformer", () => {
  it("maps Bulbasaur from the smoke fixture", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildSpeciesEntry(sample.bulbasaur);
    expect(entry.id).toBe(1);
    expect(entry.speciesConst).toBe("SPECIES_BULBASAUR");
    expect(entry.name).toBe("Bulbasaur");
    expect(entry.baseStats).toEqual([47, 49, 49, 65, 65, 45]);
    expect(entry.types[0]).toBe(8); // Grass
    expect(entry.types[1]).toBe(10); // Poison
    expect(entry.abilities).toEqual([268, 257, 34]);
    expect(entry.innates).toEqual([65, 47, 344]);
  });

  it("collapses mono-type to [type, null]", () => {
    // Synthetic input — Tackle-using mon with one type
    const raw = {
      id: 999,
      NAME: "SPECIES_TEST",
      name: "Test",
      stats: {
        base: [50, 50, 50, 50, 50, 50],
        types: [0],
        catchR: 0,
        exp: 0,
        EVY: [0, 0, 0, 0, 0, 0],
        gender: 0,
        eggC: 0,
        fren: 0,
        grow: 0,
        eggG: [],
        abis: [],
        inns: [],
        col: 0,
        noFlip: false,
        flags: "",
      },
      evolutions: [],
      eggMoves: [],
      levelUpMoves: [],
      TMHMMoves: [],
      tutor: [],
      forms: [],
      SEnc: [],
      dex: { id: 0, desc: "", hw: [0, 0] },
    };
    const entry = buildSpeciesEntry(raw);
    expect(entry.types).toEqual([0, null]);
  });

  it("pads abilities and innates to length 3 with 0", () => {
    const raw = {
      id: 1,
      NAME: "SPECIES_X",
      name: "X",
      stats: {
        base: [1, 1, 1, 1, 1, 1],
        types: [0],
        catchR: 0,
        exp: 0,
        EVY: [0, 0, 0, 0, 0, 0],
        gender: 0,
        eggC: 0,
        fren: 0,
        grow: 0,
        eggG: [],
        abis: [42],
        inns: [],
        col: 0,
        noFlip: false,
        flags: "",
      },
      evolutions: [],
      eggMoves: [],
      levelUpMoves: [],
      TMHMMoves: [],
      tutor: [],
      forms: [],
      SEnc: [],
      dex: { id: 0, desc: "", hw: [0, 0] },
    };
    const entry = buildSpeciesEntry(raw);
    expect(entry.abilities).toEqual([42, 0, 0]);
    expect(entry.innates).toEqual([0, 0, 0]);
  });

  it("renames evolution keys (kd/rs/in -> kind/requirement/into)", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildSpeciesEntry(sample.bulbasaur);
    expect(entry.evolutions).toEqual([{ kind: 0, requirement: "16", into: 2 }]);
  });

  it("renames levelUpMoves lv -> level", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildSpeciesEntry(sample.bulbasaur);
    expect(entry.levelUpMoves.length).toBeGreaterThan(0);
    expect(entry.levelUpMoves[0]).toHaveProperty("level");
    expect(entry.levelUpMoves[0]).not.toHaveProperty("lv");
  });

  it("maps Venusaur (rich fixture) including 2-branch mega evolution", async () => {
    const rich = JSON.parse(await readFile(RICH_PATH, "utf8"));
    const entry = buildSpeciesEntry(rich.venusaur);
    expect(entry.speciesConst).toBe("SPECIES_VENUSAUR");
    // Venusaur has Mega evolutions — at least 1 evolution entry
    expect(entry.evolutions.length).toBeGreaterThan(0);
  });

  it("collapses [type, type] duplicate to [type, null]", () => {
    const raw = {
      id: 1,
      NAME: "X",
      name: "X",
      stats: {
        base: [1, 1, 1, 1, 1, 1],
        types: [3, 3],
        catchR: 0,
        exp: 0,
        EVY: [0, 0, 0, 0, 0, 0],
        gender: 0,
        eggC: 0,
        fren: 0,
        grow: 0,
        eggG: [],
        abis: [],
        inns: [],
        col: 0,
        noFlip: false,
        flags: "",
      },
      evolutions: [],
      eggMoves: [],
      levelUpMoves: [],
      TMHMMoves: [],
      tutor: [],
      forms: [],
      SEnc: [],
      dex: { id: 0, desc: "", hw: [0, 0] },
    };
    const entry = buildSpeciesEntry(raw);
    expect(entry.types).toEqual([3, null]);
  });

  it("throws on a species with stats.base length != 6", () => {
    const raw = {
      id: 1,
      NAME: "X",
      name: "X",
      stats: {
        base: [1, 1, 1],
        types: [0],
        catchR: 0,
        exp: 0,
        EVY: [0, 0, 0, 0, 0, 0],
        gender: 0,
        eggC: 0,
        fren: 0,
        grow: 0,
        eggG: [],
        abis: [],
        inns: [],
        col: 0,
        noFlip: false,
        flags: "",
      },
      evolutions: [],
      eggMoves: [],
      levelUpMoves: [],
      TMHMMoves: [],
      tutor: [],
      forms: [],
      SEnc: [],
      dex: { id: 0, desc: "", hw: [0, 0] },
    };
    expect(() => buildSpeciesEntry(raw)).toThrow(/base.*length/i);
  });
});
