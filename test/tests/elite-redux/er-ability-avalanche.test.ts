/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { DEFAULT_FUN_MODE_CONFIG, resetFunModeConfig, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";

describe("Fun Mode Ability Avalanche", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  afterEach(() => {
    resetFunModeConfig();
    resetErDifficulty();
  });

  test("appends four runtime ability slots after the base four for both sides at wave 120", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setErDifficulty("youngster");
    setFunModeConfig({
      ...DEFAULT_FUN_MODE_CONFIG,
      randomizePokemon: false,
      randomizeTypes: false,
      randomizeAbilities: false,
      randomizeLevelUpMoves: false,
      abilityAvalanche: true,
    });
    game.scene.currentBattle.waveIndex = 120;

    const assertAvalanche = (pokemon: Pokemon) => {
      const passives = pokemon.getPassiveAbilities();
      expect(passives.slice(3)).toHaveLength(4);
      expect(
        new Set([pokemon.getAbility().id, ...passives.flatMap(ability => (ability ? [ability.id] : []))]).size,
      ).toBe(1 + passives.filter(Boolean).length);
      expect(passives.slice(3).every(Boolean)).toBe(true);
    };

    const player = game.scene.getPlayerPokemon()!;
    assertAvalanche(player);
    expect([0, 1, 2].map(slot => player.canApplyAbility(true, slot))).toEqual([true, false, false]);
    player.level = 24;
    expect([0, 1, 2].map(slot => player.canApplyAbility(true, slot))).toEqual([true, true, true]);
    assertAvalanche(game.scene.getEnemyPokemon()!);
  });
});
