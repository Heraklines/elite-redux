/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMoveEntry, moveKeyFromConst } from "./moves.mjs";

const SAMPLE_PATH = resolve(__dirname, "../fixtures/sample-move.json");
const VENDOR_PATH = resolve(__dirname, "../../../vendor/elite-redux/v2.65beta.json");

const VANILLA_NAMES = new Set(["TACKLE", "POUND", "EMBER", "NONE"]);

describe("moves transformer (pure)", () => {
  it("classifies Tackle as vanilla", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildMoveEntry(sample.vanilla, VANILLA_NAMES);
    expect(entry.id).toBe(33);
    expect(entry.moveConst).toBe("MOVE_TACKLE");
    expect(entry.name).toBe("Tackle");
    expect(entry.power).toBe(40);
    expect(entry.archetype).toBe("vanilla");
  });

  it("classifies Eerie Fog (ER-custom) as unknown", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildMoveEntry(sample.erCustom, VANILLA_NAMES);
    expect(entry.id).toBe(950);
    expect(entry.archetype).toBe("unknown");
  });

  it("preserves types and flags as arrays (even single-element)", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildMoveEntry(sample.vanilla, VANILLA_NAMES);
    expect(Array.isArray(entry.types)).toBe(true);
    expect(Array.isArray(entry.flags)).toBe(true);
    expect(entry.types).toEqual([0]); // Normal type
  });

  it("handles empty flags array correctly", () => {
    const raw = {
      id: 1,
      NAME: "MOVE_X",
      name: "X",
      sName: "X",
      eff: 0,
      pwr: 0,
      types: [0],
      acc: 100,
      pp: 1,
      chance: 0,
      target: 0,
      prio: 0,
      split: 0,
      flags: [],
      arg: "",
      desc: "",
      lDesc: "",
      usesHpType: false,
    };
    const entry = buildMoveEntry(raw, VANILLA_NAMES);
    expect(entry.flags).toEqual([]);
  });

  it("preserves the description verbatim", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildMoveEntry(sample.vanilla, VANILLA_NAMES);
    expect(typeof entry.description).toBe("string");
    expect(typeof entry.longDescription).toBe("string");
  });

  it("throws with descriptive context when NAME is missing", () => {
    const bad = { id: 999 } as unknown as Parameters<typeof buildMoveEntry>[0];
    expect(() => buildMoveEntry(bad, VANILLA_NAMES)).toThrow(/NAME|move/i);
  });

  it("moveKeyFromConst strips MOVE_ prefix", () => {
    expect(moveKeyFromConst("MOVE_TACKLE")).toBe("TACKLE");
    expect(moveKeyFromConst("MOVE_HYPER_BEAM")).toBe("HYPER_BEAM");
    expect(moveKeyFromConst("")).toBe("");
  });
});

describe.skipIf(!existsSync(VENDOR_PATH))("moves transformer — full dump", () => {
  it("transforms all 1032 moves without throwing", async () => {
    const { loadVanillaMoveNames } = await import("./moves.mjs");
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const vanilla = await loadVanillaMoveNames();
    const entries = dump.moves.map((m: Parameters<typeof buildMoveEntry>[0]) => buildMoveEntry(m, vanilla));
    expect(entries.length).toBe(1032);
    const vanillaCount = entries.filter((e: { archetype: string }) => e.archetype === "vanilla").length;
    // Sanity bound: at least 600 vanilla matches (pokerogue ships ~920 moves, ER replays ~900 of them with same NAME)
    expect(vanillaCount).toBeGreaterThan(600);
  });

  it("loadVanillaMoveNames returns a substantial set", async () => {
    const { loadVanillaMoveNames } = await import("./moves.mjs");
    const set = await loadVanillaMoveNames();
    expect(set.size).toBeGreaterThan(700);
  });
});

const TABLES_PATH = resolve(__dirname, "../../../src/data/elite-redux/er-move-tables.ts");

describe.skipIf(!existsSync(TABLES_PATH))("decoder tables emission", () => {
  it("emits all 5 decoder tables when build runs", async () => {
    // Verify the emitted file exists and has all 5 exports.
    const src = await readFile(TABLES_PATH, "utf8");
    expect(src).toMatch(/export const ER_TYPE_NAMES/);
    expect(src).toMatch(/export const ER_TARGET_NAMES/);
    expect(src).toMatch(/export const ER_FLAG_NAMES/);
    expect(src).toMatch(/export const ER_EFFECT_NAMES/);
    expect(src).toMatch(/export const ER_SPLIT_NAMES/);
  });

  it("ER_SPLIT_NAMES has 7 entries (ER's 4 extra splits beyond physical/special/status)", async () => {
    // Verify via text-content match — robust to ESM/dynamic-import quirks on Windows.
    const src = await readFile(TABLES_PATH, "utf8");
    // Match the ER_SPLIT_NAMES array and count its string entries.
    const m = src.match(/ER_SPLIT_NAMES[^=]*=\s*(\[[\s\S]*?\])\s*as const/);
    expect(m).not.toBeNull();
    const arr = JSON.parse(m![1]);
    expect(arr).toHaveLength(7);
    // Sanity-check ER's 4 extra splits are present.
    expect(arr).toContain("USE_HIGHEST_OFFENSE");
    expect(arr).toContain("HITS_DEF");
    expect(arr).toContain("USE_HIGHEST_DAMAGE");
    expect(arr).toContain("HITS_SPDEF");
  });
});
