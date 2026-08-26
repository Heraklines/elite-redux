/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { allAbilities } from "#data/data-lists";
import { initializeErEndlessContinuation, resetErEndlessContinuation } from "#data/elite-redux/er-endless-continuation";
import { DEFAULT_FUN_MODE_CONFIG, resetFunModeConfig, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { CustomPokemonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
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
    resetErEndlessContinuation();
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

  test("exposes and persistently replaces Fun Avalanche slots without changing the base slot contract", async () => {
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

    const player = game.scene.getPlayerPokemon()!;
    const slots = player.getRandomizableAbilitySlots();
    expect(slots.map(({ slot }) => slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(player.getAbilitySlots().map(({ slot }) => slot)).toEqual([0, 1, 2, 3]);

    const occupied = new Set(slots.map(({ ability }) => ability.id));
    const replacement = allAbilities.find(
      ability => ability != null && ability.id > AbilityId.NONE && !occupied.has(ability.id),
    )!;
    player.setAbilityOverrideForSlot(4, replacement.id);

    expect(player.getRandomizableAbilitySlots().find(({ slot }) => slot === 4)?.ability.id).toBe(replacement.id);
    const restored = new CustomPokemonData(JSON.parse(JSON.stringify(player.customPokemonData)));
    expect(restored.erAvalancheAbilityOverrides["fun:0"]).toBe(replacement.id);
  });

  test("exposes and persistently replaces asymmetric Endless Avalanche slots", async () => {
    await game.classicMode.startBattle(SpeciesId.GARCHOMP);
    initializeErEndlessContinuation(200, "randomizer-slots");
    game.scene.currentBattle.waveIndex = 220;

    const player = game.scene.getPlayerPokemon()!;
    const slots = player.getRandomizableAbilitySlots();
    expect(slots.some(({ slot }) => slot >= 4)).toBe(true);

    const occupied = new Set(slots.map(({ ability }) => ability.id));
    const replacement = allAbilities.find(
      ability => ability != null && ability.id > AbilityId.NONE && !occupied.has(ability.id),
    )!;
    player.setAbilityOverrideForSlot(4, replacement.id);

    expect(player.getRandomizableAbilitySlots().find(({ slot }) => slot === 4)?.ability.id).toBe(replacement.id);
    expect(player.customPokemonData.erAvalancheAbilityOverrides["endless:0"]).toBe(replacement.id);
  });
});
