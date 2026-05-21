/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildIdMapForCategory,
  buildTrainerClassMap,
  loadEnumValues,
  normalizeName,
  regionalSpeciesAliases,
} from "./id-map.mjs";

const VENDOR_PATH = resolve(__dirname, "../../../vendor/elite-redux/v2.65beta.json");

describe("id-map transformer (pure)", () => {
  it("normalizeName produces canonical form", () => {
    expect(normalizeName("Wandering Spirit")).toBe("wanderingspirit");
    expect(normalizeName("WANDERING_SPIRIT")).toBe("wanderingspirit");
  });

  it("buildIdMapForCategory maps matched names to vanilla IDs", () => {
    const vanilla = new Map([
      ["overgrow", 65],
      ["stench", 1],
    ]);
    const entries = [
      { id: 100, name: "Overgrow" },
      { id: 101, name: "Stench" },
      { id: 102, name: "Scrapyard" },
    ];
    const r = buildIdMapForCategory(entries, vanilla, 5000);
    expect(r.map[100]).toBe(65);
    expect(r.map[101]).toBe(1);
    expect(r.map[102]).toBe(5000); // first custom
    expect(r.vanillaCount).toBe(2);
    expect(r.customCount).toBe(1);
  });

  it("buildIdMapForCategory assigns sequential custom IDs", () => {
    const vanilla = new Map<string, number>();
    const entries = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
      { id: 3, name: "C" },
    ];
    const r = buildIdMapForCategory(entries, vanilla, 10000);
    expect(r.map[1]).toBe(10000);
    expect(r.map[2]).toBe(10001);
    expect(r.map[3]).toBe(10002);
    expect(r.customCount).toBe(3);
  });

  it("maps sentinel id 0 (and -1) directly to 0 without consuming custom IDs", () => {
    const vanilla = new Map([["foo", 50]]);
    const entries = [
      { id: 0, name: "-------" },
      { id: -1, name: "NONE" },
      { id: 1, name: "Foo" },
      { id: 2, name: "Custom" },
    ];
    const r = buildIdMapForCategory(entries, vanilla, 1000);
    expect(r.map[0]).toBe(0);
    expect(r.map[-1]).toBe(0);
    expect(r.map[1]).toBe(50);
    expect(r.map[2]).toBe(1000); // first custom — NOT 1001, sentinels didn't consume slots
    expect(r.vanillaCount).toBe(3); // 2 sentinels + 1 name match
  });

  it("buildIdMapForCategory: interleaved vanilla/custom assigns customs sequentially without gaps", () => {
    const vanilla = new Map([
      ["foo", 100],
      ["baz", 200],
    ]);
    const entries = [
      { id: 1, name: "Foo" }, // vanilla → 100
      { id: 2, name: "Bar" }, // custom → 1000
      { id: 3, name: "Baz" }, // vanilla → 200
      { id: 4, name: "Qux" }, // custom → 1001 (NOT 1002)
    ];
    const r = buildIdMapForCategory(entries, vanilla, 1000);
    expect(r.map[1]).toBe(100);
    expect(r.map[2]).toBe(1000);
    expect(r.map[3]).toBe(200);
    expect(r.map[4]).toBe(1001);
    expect(r.vanillaCount).toBe(2);
    expect(r.customCount).toBe(2);
  });
});

describe("regionalSpeciesAliases (pure)", () => {
  it("RAICHU_ALOLAN → ALOLA_RAICHU", () => {
    expect(regionalSpeciesAliases("RAICHU_ALOLAN")).toEqual([normalizeName("ALOLA_RAICHU")]);
  });

  it("GROWLITHE_HISUIAN → HISUI_GROWLITHE", () => {
    expect(regionalSpeciesAliases("GROWLITHE_HISUIAN")).toEqual([normalizeName("HISUI_GROWLITHE")]);
  });

  it("SLOWBRO_MEGA_GALARIAN → GALAR_SLOWBRO_MEGA (mega flag retained)", () => {
    expect(regionalSpeciesAliases("SLOWBRO_MEGA_GALARIAN")).toEqual([normalizeName("GALAR_SLOWBRO_MEGA")]);
  });

  it("TAUROS_PALDEAN_COMBAT → PALDEA_TAUROS_COMBAT (multi-token base after suffix)", () => {
    expect(regionalSpeciesAliases("TAUROS_PALDEAN_COMBAT")).toEqual([normalizeName("PALDEA_TAUROS_COMBAT")]);
  });

  it("VENUSAUR (no regional suffix) → empty", () => {
    expect(regionalSpeciesAliases("VENUSAUR")).toEqual([]);
  });

  it("buildIdMapForCategory consults aliasFn on miss", () => {
    const vanilla = new Map([
      ["alolaraichu", 2026],
      ["raichu", 26],
    ]);
    const entries = [
      { id: 1, name: "RAICHU" },
      { id: 2, name: "RAICHU_ALOLAN" },
    ];
    const r = buildIdMapForCategory(entries, vanilla, 5000, regionalSpeciesAliases);
    expect(r.map[1]).toBe(26); // direct match
    expect(r.map[2]).toBe(2026); // via regional alias
    expect(r.aliasHits).toBe(1);
    expect(r.vanillaCount).toBe(2);
    expect(r.customCount).toBe(0);
  });

  it("aliasFn miss falls through to custom assignment", () => {
    const vanilla = new Map<string, number>();
    const entries = [{ id: 1, name: "RAICHU_ALOLAN" }];
    const r = buildIdMapForCategory(entries, vanilla, 5000, regionalSpeciesAliases);
    expect(r.map[1]).toBe(5000);
    expect(r.aliasHits).toBe(0);
    expect(r.customCount).toBe(1);
  });
});

describe("buildTrainerClassMap (pure)", () => {
  it("alias takes precedence over normalized match", () => {
    const vanilla = new Map([
      ["acetrainer", 100],
      ["tuber", 50],
    ]);
    const aliases = { "Tuber M": "ACE_TRAINER" };
    const r = buildTrainerClassMap(["Tuber M"], vanilla, aliases);
    expect(r.map[0]).toBe(100); // alias wins (ACE_TRAINER=100), not normalized "tuber"=50
  });

  it("falls through to normalized match when alias absent", () => {
    const vanilla = new Map([["acetrainer", 100]]);
    const aliases = {};
    const r = buildTrainerClassMap(["Ace Trainer"], vanilla, aliases);
    expect(r.map[0]).toBe(100);
  });

  it("falls through to custom when neither alias nor normalized match", () => {
    const vanilla = new Map([["acetrainer", 100]]);
    const aliases = {};
    const r = buildTrainerClassMap(["Battle Girl"], vanilla, aliases);
    expect(r.map[0]).toBe(1000);
  });

  it("alias pointing to missing enum key falls through to normalized then custom", () => {
    const vanilla = new Map([["foo", 50]]);
    const aliases = { Bar: "MISSING_KEY" };
    const r = buildTrainerClassMap(["Bar"], vanilla, aliases);
    expect(r.map[0]).toBe(1000); // alias couldn't resolve, normalized "bar" not in vanilla, custom assigned
  });
});

describe.skipIf(!existsSync(VENDOR_PATH))("id-map transformer — full dump", () => {
  it("loadEnumValues parses pokerogue's species-id.ts", async () => {
    const m = await loadEnumValues("species-id.ts", 1000);
    expect(m.size).toBeGreaterThan(1000);
    expect(m.has("bulbasaur")).toBe(true);
  });

  it("loadEnumValues parses pokerogue's ability-id.ts", async () => {
    const m = await loadEnumValues("ability-id.ts", 200);
    expect(m.size).toBeGreaterThan(200);
    expect(m.has("overgrow")).toBe(true);
  });

  it("loadEnumValues parses pokerogue's move-id.ts", async () => {
    const m = await loadEnumValues("move-id.ts", 400);
    expect(m.size).toBeGreaterThan(400);
    expect(m.has("tackle")).toBe(true);
  });

  it("loadEnumValues parses pokerogue's trainer-type.ts", async () => {
    const m = await loadEnumValues("trainer-type.ts", 50);
    expect(m.size).toBeGreaterThan(50);
  });
});
