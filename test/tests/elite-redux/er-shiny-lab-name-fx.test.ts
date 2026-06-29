/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Name FX / palette adoption: does the Pokemon NAME actually take the equipped
// Shiny Lab palette's colour? This is the headless ground-truth for the maintainer
// report "name fx and palette adoption still doesn't work" - it exercises the
// shared resolver (getErShinyLabNameStyleFor{Species,Pokemon}) that EVERY surface
// (Starter Select, Summary, Party, combat nameplate, the Lab preview) calls, and
// then drives the REAL Starter Select handler to assert the name text colour.
// ER_SCENARIO=1 gated.
// =============================================================================

import {
  ER_SHINY_LAB_DEFAULT_PARAMS,
  ER_SHINY_LAB_EFFECTS_BY_CATEGORY,
  encodeErShinyLabLoadout,
  encodeErShinyLabParams,
  setErShinyLabOwnedBit,
  unlockErShinyLabNameFx,
} from "#data/elite-redux/er-shiny-lab-effects";
import { SpeciesId } from "#enums/species-id";
import { getErShinyLabNameStyleForPokemon, getErShinyLabNameStyleForSpecies } from "#sprites/er-shiny-lab-sprite-fx";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const PALETTE = ER_SHINY_LAB_EFFECTS_BY_CATEGORY.palette.find(e => e.id === "duoneon")!;

/** Equip the duoneon palette + Name FX (unlocked + on) onto a species' starter save. */
function equipNameFx(game: GameManager, speciesId: SpeciesId): void {
  const starter = game.scene.gameData.getStarterDataEntry(speciesId);
  starter.erShinyLab = {};
  const save = starter.erShinyLab;
  setErShinyLabOwnedBit(save, "palette", PALETTE.index);
  save.l = encodeErShinyLabLoadout({ palette: PALETTE.id, surface: null, around: null });
  save.q = encodeErShinyLabParams({ ...ER_SHINY_LAB_DEFAULT_PARAMS, nameFx: true });
  unlockErShinyLabNameFx(save);
}

describe.skipIf(!RUN)("ER Shiny Lab Name FX / palette adoption", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("a REGULAR (tier-1) shiny with Name FX equipped adopts the palette colour", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    equipNameFx(game, SpeciesId.BULBASAUR);

    // The maintainer's case: equip a palette + turn Name FX on, on an ordinary shiny.
    // The name MUST adopt the palette's accent colour.
    const style = getErShinyLabNameStyleForSpecies(SpeciesId.BULBASAUR, true);
    expect(style).not.toBeNull();
    expect(style?.color.toLowerCase()).toBe(PALETTE.accent.toLowerCase());
  });

  it("Name FX OFF -> no colour (default name)", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const starter = game.scene.gameData.getStarterDataEntry(SpeciesId.BULBASAUR);
    starter.erShinyLab = {};
    setErShinyLabOwnedBit(starter.erShinyLab, "palette", PALETTE.index);
    starter.erShinyLab.l = encodeErShinyLabLoadout({ palette: PALETTE.id, surface: null, around: null });
    starter.erShinyLab.q = encodeErShinyLabParams({ ...ER_SHINY_LAB_DEFAULT_PARAMS, nameFx: false });
    unlockErShinyLabNameFx(starter.erShinyLab);

    expect(getErShinyLabNameStyleForSpecies(SpeciesId.BULBASAUR, true)).toBeNull();
  });

  it("a NON-shiny view -> no colour even with a loadout saved", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    equipNameFx(game, SpeciesId.BULBASAUR);
    expect(getErShinyLabNameStyleForSpecies(SpeciesId.BULBASAUR, false)).toBeNull();
  });

  it("a battle Pokemon with the look carried + Name FX on adopts the palette colour", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const mon = game.scene.getPlayerPokemon()!;
    mon.shiny = true;
    mon.variant = 0; // a plain (tier-1) shiny
    mon.customPokemonData.erShinyLab = [
      ...encodeErShinyLabLoadout({ palette: PALETTE.id, surface: null, around: null }),
      ...encodeErShinyLabParams({ ...ER_SHINY_LAB_DEFAULT_PARAMS, nameFx: true }),
    ];

    const style = getErShinyLabNameStyleForPokemon(mon);
    expect(style).not.toBeNull();
    expect(style?.color.toLowerCase()).toBe(PALETTE.accent.toLowerCase());
  });
});
