/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Partner Eevee has no permanent level evolution", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("blocks level-23 choices only for the partner form", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const eeveeSpecies = getPokemonSpecies(SpeciesId.EEVEE);
    const partnerFormIndex = eeveeSpecies.forms.findIndex(form => form.formKey === "partner");
    expect(partnerFormIndex).toBeGreaterThanOrEqual(0);

    const partnerEevee = game.scene.addPlayerPokemon(eeveeSpecies, 100);
    partnerEevee.formIndex = partnerFormIndex;
    expect(partnerEevee.getFormKey()).toBe("partner");
    expect(partnerEevee.getValidEvolutions()).toHaveLength(0);
    expect(partnerEevee.getEvolution()).toBeNull();

    const regularEevee = game.scene.addPlayerPokemon(eeveeSpecies, 23);
    regularEevee.formIndex = 0;
    const regularChoices = regularEevee.getValidEvolutions();
    expect(regularChoices.length).toBeGreaterThan(0);
    expect(regularChoices.some(evolution => evolution.speciesId === SpeciesId.ESPEON)).toBe(true);

    const partnerEdges = (pokemonEvolutions[SpeciesId.EEVEE] ?? []).filter(
      evolution => evolution.preFormKey === "partner",
    );
    expect(partnerEdges).toHaveLength(0);
  });
});
