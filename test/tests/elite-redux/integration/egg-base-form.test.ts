/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #133 — Eggs must only ever hatch a BASE form.
//
// The ER egg pool already excludes evolved customs (init-elite-redux-egg-tiers
// skips any species with a prevolution). But stale eggs created before that
// fix can have an evolved species stored in the save (the user hatched an
// "Infernape Redux" with no abilities/passives). generatePlayerPokemon() now
// traverses any stored species to its root, so even a malformed egg hatches a
// proper base form with valid abilities.
// =============================================================================

import { speciesEggTiers } from "#balance/species-egg-tiers";
import { Egg } from "#data/egg";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

// ER ids for the Chimchar Redux line.
const CHIMCHAR_REDUX_ER = 2599;
const INFERNAPE_REDUX_ER = 2601;

describe("ER eggs only hatch base forms (#133)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
  });

  it("excludes evolved ER customs from the egg-tier pool", () => {
    const infernape = ER_ID_MAP.species[INFERNAPE_REDUX_ER] as number;
    expect(speciesEggTiers[infernape]).toBeUndefined();
  });

  it("hatches the base form (Chimchar Redux) even when a stale egg stores the evolved species", () => {
    const scene = game.scene;
    const infernape = ER_ID_MAP.species[INFERNAPE_REDUX_ER] as SpeciesId;
    const chimchar = ER_ID_MAP.species[CHIMCHAR_REDUX_ER] as number;

    const mon = new Egg({ scene, species: infernape }).generatePlayerPokemon();

    // Traversed up the evolution chain to the base form.
    expect(mon.species.speciesId).toBe(chimchar);
    // …and the hatched base form has real abilities + passives (the symptom the
    // user reported: "no abilities and no passives").
    expect(mon.species.ability1).toBeGreaterThan(0);
    expect(mon.species.getPassiveAbilities(0).some(a => a > 0)).toBe(true);
  });
});
