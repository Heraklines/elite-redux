/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Egg } from "#data/egg";
import { setErBalanceTuningForTesting } from "#data/elite-redux/er-balance-tuning";
import {
  applyErBlackShinyKit,
  isErBlackShiny,
  playerHasErBlackShiny,
} from "#data/elite-redux/er-black-shinies";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { VariantTier } from "#enums/variant-tier";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Black Shiny egg acquisition", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    game = new GameManager(phaserGame);
  });

  beforeEach(async () => {
    await game.importData("./test/utils/saves/everything.prsv");
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });

  afterEach(() => {
    setErBalanceTuningForTesting();
  });

  it("does not let an active Black Shiny suppress an eligible egg unlock roll", () => {
    const active = game.scene.getPlayerPokemon()!;
    applyErBlackShinyKit(active);
    expect(playerHasErBlackShiny()).toBe(true);

    // Make the eligible epic/red -> Black upgrade deterministic. The regression
    // was the party guard returning before this roll could happen at all.
    setErBalanceTuningForTesting({ "er.shiny.blackShinyDenominator": 1 });

    const hatched = new Egg({
      scene: game.scene,
      id: 123_456_789,
      tier: EggTier.COMMON,
      sourceType: EggSourceType.SAME_SPECIES_EGG,
      species: SpeciesId.GIBLE,
      isShiny: true,
      variantTier: VariantTier.EPIC,
      eggMoveIndex: 0,
    }).generatePlayerPokemon();

    expect(hatched.shiny).toBe(true);
    expect(hatched.variant).toBe(VariantTier.EPIC);
    expect(isErBlackShiny(hatched)).toBe(true);
  });
});
