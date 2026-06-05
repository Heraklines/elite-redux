/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The starter-select "Redux" generation tab collects Elite Redux's
// new-evolution custom species — ER customs (speciesId >= 10000) whose name
// contains "Redux". This guards the criterion the tab's predicate uses: that it
// matches a real, non-empty population and excludes vanilla species. (The grid
// itself already filters out megas / evolved forms, so the tab shows base
// Redux species.)

import { allSpecies } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

// Mirror of starter-select-ui-handler's isReduxFormSpecies criterion.
const isReduxFormSpecies = (name: string, id: number) => id >= 10000 && /redux/i.test(name);

describe("ER Redux generation tab criterion", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  it("matches a non-empty set of ER custom Redux species", () => {
    const redux = allSpecies.filter(s => isReduxFormSpecies(s.name ?? "", s.speciesId));
    console.log(
      `[redux-tab] ${redux.length} Redux custom species, e.g. ${redux
        .slice(0, 5)
        .map(s => s.name)
        .join(", ")}`,
    );
    expect(redux.length).toBeGreaterThan(20);
    // Every match is a real ER custom (id >= 10000) with "Redux" in the name.
    for (const s of redux) {
      expect(s.speciesId).toBeGreaterThanOrEqual(10000);
      expect(/redux/i.test(s.name)).toBe(true);
    }
  });

  it("does not match vanilla species", () => {
    const pikachu = allSpecies.find(s => s.speciesId === SpeciesId.PIKACHU)!;
    expect(isReduxFormSpecies(pikachu.name, pikachu.speciesId)).toBe(false);
    // A gen-9 vanilla mon (so it isn't excluded merely by gen) is also unmatched.
    const sprigatito = allSpecies.find(s => s.speciesId === SpeciesId.SPRIGATITO);
    if (sprigatito) {
      expect(isReduxFormSpecies(sprigatito.name, sprigatito.speciesId)).toBe(false);
    }
  });
});
