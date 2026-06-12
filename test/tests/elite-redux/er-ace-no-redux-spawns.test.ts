/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #421 - "high BST mons and megas show up in modes they aren't meant to":
// the wild redux-form roll (1-in-8 per eligible spawn) ran on EVERY
// difficulty, so Ace/Youngster (pure vanilla, #345) rolled ER redux forms
// (custom abilities/innates/kits/types, sometimes stats) in the wild. The
// roll is now gated to Elite/Hell. Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allSpecies } from "#data/data-lists";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER wild redux-form spawns are Elite/Hell only (#421)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  afterEach(() => {
    setErDifficulty("ace");
  });

  const reduxSpecies = () => {
    // Any vanilla species carrying an injected "redux" form works; Snorlax has one.
    const sp = getPokemonSpecies(SpeciesId.SNORLAX);
    expect(sp.forms.some(f => f.formKey === "redux")).toBe(true);
    return sp;
  };

  const rollForms = (n: number): Set<number> => {
    const seen = new Set<number>();
    const sp = reduxSpecies();
    for (let i = 0; i < n; i++) {
      seen.add(globalScene.getSpeciesFormIndex(sp));
    }
    return seen;
  };

  it("Ace and Youngster never roll the redux form (pure vanilla, #345)", () => {
    const reduxIdx = reduxSpecies().forms.findIndex(f => f.formKey === "redux");
    setErDifficulty("ace");
    expect(rollForms(200).has(reduxIdx)).toBe(false);
    setErDifficulty("youngster");
    expect(rollForms(200).has(reduxIdx)).toBe(false);
  });

  it("Elite/Hell still roll the redux form (1-in-8)", () => {
    const reduxIdx = reduxSpecies().forms.findIndex(f => f.formKey === "redux");
    setErDifficulty("elite");
    expect(rollForms(200).has(reduxIdx)).toBe(true);
    setErDifficulty("hell");
    expect(rollForms(200).has(reduxIdx)).toBe(true);
  });

  it("sanity: redux forms are real ER customs (plenty exist; some change BST too)", () => {
    // Redux forms are ER content - custom abilities/innates, kits and types,
    // and in some lines different stat totals - which is why they must not
    // spawn in the pure-vanilla modes regardless of raw BST.
    let withRedux = 0;
    let differingBst = 0;
    for (const sp of allSpecies) {
      if (sp.speciesId >= 10000) {
        continue;
      }
      const reduxIdx = sp.forms.findIndex(f => f.formKey === "redux");
      if (reduxIdx <= 0) {
        continue;
      }
      withRedux++;
      if (sp.forms[reduxIdx].getBaseStatTotal() !== sp.forms[0].getBaseStatTotal()) {
        differingBst++;
      }
    }
    expect(withRedux).toBeGreaterThan(20);
    expect(differingBst).toBeGreaterThan(0);
  });
});
