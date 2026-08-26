/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { SingleTypeChallenge } from "#data/challenge";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { checkStarterValidForChallenge } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER challenge starter soft-validity", () => {
  let game: GameManager;

  beforeAll(() => {
    game = new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
  });

  it("does not offer Skarmory in mono-Fire solely through an unrelated Redux record", () => {
    const challenge = new SingleTypeChallenge();
    challenge.value = PokemonType.FIRE + 1;
    game.scene.gameMode.challenges = [challenge];

    expect(
      checkStarterValidForChallenge(
        getPokemonSpecies(SpeciesId.SKARMORY),
        { shiny: false, female: false, variant: 0, formIndex: 0 },
        true,
      ),
    ).toBe(false);
  });

  it("falls back to the base form when restored form state does not belong to the species", () => {
    const species = getPokemonSpecies(SpeciesId.SKARMORY);
    const restored = {
      species,
      formIndex: 999,
      summonData: { speciesForm: null, illusion: null },
    };

    expect(Pokemon.prototype.getSpeciesForm.call(restored)).toBe(species.forms[0]);
  });
});
