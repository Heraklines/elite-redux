/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Bug (c): In a double battle, when a player picks a move in the fight menu,
// the type-effectiveness indicator must update for BOTH active foes, not just
// the one the move is super-effective against. Previously the second foe's
// indicator stayed hidden until the first foe fainted.

import { globalScene } from "#app/global-scene";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import type { EnemyBattleInfo } from "#ui/battle-info/enemy-battle-info";
import type { FightUiHandler } from "#ui/handlers/fight-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER double-battle type-effectiveness indicator", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .startingLevel(100)
      .enemyLevel(100)
      // Two enemies so getOpponents() returns a pair during command selection.
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.THUNDERBOLT, MoveId.TACKLE]);
  });

  it("updates effectiveness for BOTH active foes when re-entering the fight menu", async () => {
    // Pikachu (Electric) vs two Magikarp (Water/Flying): Thunderbolt is 4x on
    // each foe; the indicator must appear on BOTH enemy info boxes.
    await game.classicMode.startBattle(SpeciesId.PIKACHU, SpeciesId.RAICHU);

    globalScene.typeHints = true;

    const enemyField = globalScene.getEnemyField() as EnemyPokemon[];
    expect(enemyField.length).toBe(2);

    const effVisible = (): boolean[] =>
      enemyField.map(e => (e.getBattleInfo() as EnemyBattleInfo).isEffectivenessVisible());

    // 1) Open FIGHT for player Pokémon 1 and highlight Thunderbolt.
    const commandPhase = globalScene.phaseManager.getCurrentPhase() as CommandPhase;
    await game.scene.ui.setMode(UiMode.FIGHT, commandPhase.getFieldIndex(), Command.FIGHT);
    const fightHandler = game.scene.ui.getHandler() as FightUiHandler;
    fightHandler.setCursor(0);
    expect(effVisible()).toEqual([true, true]);

    // 2) Simulate leaving the fight menu (clear() hides both foes' indicators),
    //    as happens when control passes to the next player Pokémon / command menu.
    fightHandler.clear();
    expect(effVisible()).toEqual([false, false]);

    // 3) Re-show the fight menu via show() WITHOUT manually re-highlighting a move
    //    (mirrors gameplay: re-entering FIGHT after a target-select cancel or for
    //    the next Pokémon does not move the cursor). show() alone must restore the
    //    effectiveness indicators for BOTH active foes — this is the bug: the loop
    //    only ran on a cursor change, so the second foe stayed hidden until the
    //    first fainted.
    fightHandler.show([commandPhase.getFieldIndex(), Command.FIGHT]);

    // After re-showing, BOTH foes' indicators must be visible again.
    expect(effVisible()).toEqual([true, true]);
  });
});
