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
import { buildAbilityEntry } from "./abilities.mjs";

const SAMPLE_PATH = resolve(__dirname, "../fixtures/sample-ability.json");
const VENDOR_PATH = resolve(__dirname, "../../../vendor/elite-redux/v2.65beta.json");

// Mock vanilla names — what we'd load from src/enums/ability-id.ts.
// Real pokerogue has hundreds; this is the subset relevant to the smoke tests.
const VANILLA_NAMES = new Set(["overgrow", "stench", "intimidate", "noability"]);

describe("abilities transformer (pure)", () => {
  it("classifies Overgrow as vanilla", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildAbilityEntry(sample.vanilla, VANILLA_NAMES);
    expect(entry.id).toBe(65);
    expect(entry.name).toBe("Overgrow");
    expect(entry.archetype).toBe("vanilla");
  });

  it("classifies Scrapyard (ER-custom) as unknown", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildAbilityEntry(sample.erCustom, VANILLA_NAMES);
    expect(entry.id).toBe(400);
    expect(entry.name).toBe("Scrapyard");
    expect(entry.archetype).toBe("unknown");
  });

  it("handles the empty placeholder (id 0, name '-------') without crashing", () => {
    const placeholder = { id: 0, name: "-------", desc: "Empty ability slot." };
    const entry = buildAbilityEntry(placeholder, VANILLA_NAMES);
    expect(entry.id).toBe(0);
    expect(entry.archetype).toBe("unknown");
  });

  it("preserves the raw description verbatim", async () => {
    const sample = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
    const entry = buildAbilityEntry(sample.vanilla, VANILLA_NAMES);
    expect(entry.description).toMatch(/Grass-type/);
  });

  it("throws with descriptive context when name is missing", () => {
    const bad = { id: 999, desc: "x" } as unknown as Parameters<typeof buildAbilityEntry>[0];
    expect(() => buildAbilityEntry(bad, VANILLA_NAMES)).toThrow(/name/i);
  });

  it("uses normalized comparison (case-insensitive, underscore-insensitive)", () => {
    // Pokerogue enum: AbilityId.WANDERING_SPIRIT → normalized "wanderingspirit"
    // ER might have: "Wandering Spirit" or "Wandering_Spirit" or "WANDERING SPIRIT"
    const vanilla = new Set(["wanderingspirit"]);
    const a1 = buildAbilityEntry({ id: 1, name: "Wandering Spirit", desc: "" }, vanilla);
    const a2 = buildAbilityEntry({ id: 2, name: "wandering_spirit", desc: "" }, vanilla);
    const a3 = buildAbilityEntry({ id: 3, name: "WANDERING SPIRIT", desc: "" }, vanilla);
    expect(a1.archetype).toBe("vanilla");
    expect(a2.archetype).toBe("vanilla");
    expect(a3.archetype).toBe("vanilla");
  });
});

describe.skipIf(!existsSync(VENDOR_PATH))("abilities transformer — full dump", () => {
  it("transforms all 1034 abilities without throwing", async () => {
    const { loadVanillaAbilityNames } = await import("./abilities.mjs");
    const dump = JSON.parse(await readFile(VENDOR_PATH, "utf8"));
    const vanilla = await loadVanillaAbilityNames();
    const entries = dump.abilities.map((a: Parameters<typeof buildAbilityEntry>[0]) => buildAbilityEntry(a, vanilla));
    expect(entries.length).toBe(1034);
    const vanillaCount = entries.filter((e: { archetype: string }) => e.archetype === "vanilla").length;
    const unknownCount = entries.filter((e: { archetype: string }) => e.archetype === "unknown").length;
    expect(vanillaCount + unknownCount).toBe(1034);
    // Sanity bound: at least 100 vanilla matches (pokerogue has ~300 vanilla abilities and a meaningful subset will name-match)
    expect(vanillaCount).toBeGreaterThan(100);
  });
});
