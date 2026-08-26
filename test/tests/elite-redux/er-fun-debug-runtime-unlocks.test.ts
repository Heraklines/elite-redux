/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { DEFAULT_FUN_MODE_CONFIG, resetFunModeConfig, setFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import type { StarterMoveset } from "#types/save-data";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Fun Debug runtime starter unlocks", () => {
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
  });

  it.each([
    "youngster",
    "hell",
  ] as const)("fields selected egg moves and all three innates in %s Debug", async difficulty => {
    await game.runToTitle();
    game.scene.gameMode = getGameMode(GameModes.FUN);
    setFunModeConfig({ ...DEFAULT_FUN_MODE_CONFIG, difficulty, debugMode: true });

    const accountEntry = game.scene.gameData.getStarterDataEntry(SpeciesId.BULBASAUR);
    accountEntry.eggMoves = 0;
    accountEntry.passiveAttr = 0;

    const starter = generateStarters(game.scene, [SpeciesId.BULBASAUR])[0];
    const selectedEggMove = speciesEggMoves[SpeciesId.BULBASAUR][3];
    starter.abilityIndex = 2;
    starter.moveset = [selectedEggMove] as StarterMoveset;

    game.scene.phaseManager.pushNew("EncounterPhase", false);
    new SelectStarterPhase().initBattleFromCurrentPhase([starter]);
    await game.phaseInterceptor.to("CommandPhase");

    const pokemon = game.scene.getPlayerPokemon();
    expect(pokemon.isOnField()).toBe(true);
    expect(pokemon.getMoveset().map(move => move.getMove().id)).toContain(selectedEggMove);
    expect(pokemon.abilityIndex).toBe(2);
    expect(pokemon.getAbility().id).toBe(pokemon.species.getAbility(2));
    expect([0, 1, 2].map(slot => pokemon.canApplyAbility(true, slot))).toEqual([true, true, true]);
    expect(pokemon.customPokemonData.erRunUnlockedAbilitySlots).toEqual([1, 2, 3]);

    // Debug access must remain run-local and never purchase anything on the account.
    expect(accountEntry.eggMoves).toBe(0);
    expect(accountEntry.passiveAttr).toBe(0);
  }, 90_000);
});
