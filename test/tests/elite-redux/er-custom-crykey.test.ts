/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER custom species (id >= 10000) must not crash in getCryKey(). The base
// implementation does `speciesId %= 2000` + `getPokemonSpecies(...).forms`,
// which is undefined for custom ids and threw "Cannot read properties of
// undefined (reading 'forms')" on enemy entry — freezing the battle (Phantowl,
// #260). ErCustomSpecies overrides getCryKey to return a safe well-formed key.

import { allSpecies } from "#data/data-lists";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER custom species getCryKey never crashes", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("every ER custom returns a well-formed cry key without throwing", () => {
    const customs = allSpecies.filter(s => s.speciesId >= 10000);
    expect(customs.length).toBeGreaterThan(0);

    let phantowlChecked = false;
    for (const s of customs) {
      // Must not throw (the bug threw here).
      const key = s.getCryKey(s.formIndex);
      expect(typeof key).toBe("string");
      expect(key.startsWith("cry/")).toBe(true);
      if ((s.name ?? "").toLowerCase().includes("phantowl")) {
        console.log(`[crykey] ${s.name} (#${s.speciesId}) → ${key}`);
        phantowlChecked = true;
      }
    }
    expect(phantowlChecked).toBe(true);
  });
});
