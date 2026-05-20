/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildIdMapForCategory, loadEnumValues, normalizeName } from "./id-map.mjs";

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
