/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #414 - "Mega Urshifu at wave 13 on Ace". The Weird Dream mystery encounter
// (party transformations) and the GTS encounter (trade offers) draw "any
// species in a BST window" from allSpecies. On ER that list also contains the
// standalone mega/primal/battle-form CUSTOM species records ("Urshifu Mega"
// BST 660, legendary=false), which sailed past vanilla's by-SpeciesId
// legendary bans - a wave-13 Weird Dream turned a party mon into a permanent
// Mega. These tests pin the ban predicate both encounters now apply.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { isErBattleFormCustomSpecies, isErGenericPoolBanned } from "#data/elite-redux/er-generic-pool-bans";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER generic-pool bans (Weird Dream / GTS, #414)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  afterEach(() => {
    setErDifficulty("ace");
  });

  const byName = (name: string) => allSpecies.find(sp => sp.speciesId >= 10000 && sp.name === name);

  it("every standalone mega/primal/origin custom record is banned on EVERY difficulty", () => {
    setErDifficulty("hell");
    let checked = 0;
    for (const entry of ER_MEGA_FORMS) {
      const pk = ER_ID_MAP.species[entry.targetErId];
      if (pk === undefined || pk < 10000) {
        continue; // mega lives on a vanilla id (real vanilla mega form) - not a standalone record
      }
      const sp = allSpecies.find(s => s.speciesId === pk);
      if (!sp) {
        continue;
      }
      checked++;
      expect(isErGenericPoolBanned(sp.speciesId, sp.name), `${sp.name} (${sp.speciesId}) must be pool-banned`).toBe(
        true,
      );
    }
    // Sanity: the sweep actually covered the standalone mega records.
    expect(checked).toBeGreaterThan(100);
  });

  it("Urshifu Mega (the #414 report) is banned even on Hell; vanilla species are untouched", () => {
    setErDifficulty("hell");
    const urshifuMega = byName("Urshifu Mega")!;
    expect(urshifuMega).toBeDefined();
    expect(isErBattleFormCustomSpecies(urshifuMega.speciesId, urshifuMega.name)).toBe(true);
    expect(isErGenericPoolBanned(urshifuMega.speciesId, urshifuMega.name)).toBe(true);
    // The predicate never bans vanilla ids - vanilla pools stay vanilla-ruled.
    expect(isErGenericPoolBanned(SpeciesId.SNORLAX, "Snorlax")).toBe(false);
    expect(isErGenericPoolBanned(SpeciesId.URSHIFU, "Urshifu")).toBe(false);
  });

  it("normal customs are allowed on Elite/Hell but banned on the pure-vanilla difficulties (#345)", () => {
    const weedleRedux = byName("Weedle Redux")!;
    expect(weedleRedux).toBeDefined();
    expect(isErBattleFormCustomSpecies(weedleRedux.speciesId, weedleRedux.name)).toBe(false);

    setErDifficulty("hell");
    expect(isErGenericPoolBanned(weedleRedux.speciesId, weedleRedux.name)).toBe(false);
    setErDifficulty("elite");
    expect(isErGenericPoolBanned(weedleRedux.speciesId, weedleRedux.name)).toBe(false);
    setErDifficulty("ace");
    expect(isErGenericPoolBanned(weedleRedux.speciesId, weedleRedux.name)).toBe(true);
    setErDifficulty("youngster");
    expect(isErGenericPoolBanned(weedleRedux.speciesId, weedleRedux.name)).toBe(true);
  });
});
