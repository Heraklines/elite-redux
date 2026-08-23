/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { EnemyPokemon } from "#field/pokemon";
import { EnemyFusionChanceModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("enemy fusion ownership during construction", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("checks the wild fusion roll only for wild enemies, never trainer or ghost members", async () => {
    const game = new GameManager(phaserGame);
    await game.runToTitle();
    const applyModifier = vi.spyOn(globalScene, "applyModifier").mockReturnValue(null);
    const species = getPokemonSpecies(SpeciesId.EEVEE);

    new EnemyPokemon(species, 20, TrainerSlot.TRAINER, false, false);
    expect(applyModifier.mock.calls.some(call => call[0] === EnemyFusionChanceModifier)).toBe(false);

    new EnemyPokemon(species, 20, TrainerSlot.NONE, false, false);
    expect(applyModifier.mock.calls.some(call => call[0] === EnemyFusionChanceModifier)).toBe(true);
  });
});
