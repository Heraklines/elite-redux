/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { buildErCombatDataDictionary } from "#data/elite-redux/ai/combat-data-dictionary";
import { ER_COMBAT_FEATURE_NAMES, ER_COMBAT_FEATURE_SCHEMA_VERSION } from "#data/elite-redux/ai/combat-features";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version: string };

describe("combat data dictionary export", () => {
  it("covers runtime ids and emits deterministic content", () => {
    const dictionary = buildErCombatDataDictionary(pkg.version);
    const serialized = `${JSON.stringify(dictionary, null, 2)}\n`;

    expect(Object.keys(dictionary.moves).length).toBeGreaterThan(900);
    expect(dictionary.features).toEqual({
      schemaVersion: ER_COMBAT_FEATURE_SCHEMA_VERSION,
      names: ER_COMBAT_FEATURE_NAMES,
    });
    expect(Object.keys(dictionary.abilities).length).toBeGreaterThan(900);
    expect(Object.keys(dictionary.speciesForms).length).toBeGreaterThan(1000);
    expect(Object.keys(dictionary.items).length).toBeGreaterThan(100);
    expect(dictionary.modifiers).toEqual(dictionary.items);
    expect(Object.keys(dictionary.relics).length).toBeGreaterThan(0);
    expect(dictionary.battlerTags.length).toBeGreaterThan(20);
    expect(dictionary.arenaTags.length).toBeGreaterThan(10);
    expect(dictionary.moves[891]?.name).toBeTruthy();
    expect(dictionary.moves[5001]?.name).toBeTruthy();
    expect(dictionary.abilities[5401]?.name).toBeTruthy();
    expect(dictionary.abilities[6003]?.name).toBeTruthy();
    expect(dictionary.abilities[6003]?.erDraftIds).toEqual([]);
    expect(dictionary.items.LEFTOVERS?.name).toBeTruthy();
    expect(dictionary.speciesForms["6:0"]?.name).toBeTruthy();
    expect(dictionary.mechanicNamespaces).toEqual(
      expect.arrayContaining([
        "ability-state",
        "deferred",
        "innate-slot-suppression",
        "item-restore",
        "move-prime",
        "relation",
      ]),
    );
    expect(serialized).toBe(`${JSON.stringify(buildErCombatDataDictionary(pkg.version), null, 2)}\n`);

    const output = process.env.ER_DATA_DICTIONARY_OUT;
    if (output) {
      const path = resolve(output);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, serialized, "utf8");
    }
  });
});
