/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER requested field ability resolution", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.TACKLE])
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.SNORLAX);
  });

  it("resolves opposing lunar-named abilities without recursive source scans", async () => {
    const moonSpirit = ErAbilityId.MOON_SPIRIT as unknown as AbilityId;
    game.override.ability(moonSpirit).enemyAbility(moonSpirit);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(game.field.getPlayerPokemon().hasAbility(moonSpirit)).toBe(true);
    expect(game.field.getEnemyPokemon().hasAbility(moonSpirit)).toBe(true);
  });

  it("lets Aura Break suppress opposing Battle Aura", async () => {
    game.override.ability(ErAbilityId.BATTLE_AURA as unknown as AbilityId).enemyAbility(AbilityId.AURA_BREAK);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(enemy.getCritStage(player, allMoves[MoveId.TACKLE])).toBe(0);
  });
});
