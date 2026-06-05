/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — regression: GROWL is rebalanced into a Special Normal sound
// DAMAGING move that ALSO drops the target's Attack by 1 (effectChance 100 in
// ER's move data). Because the ATK drop is now a *secondary* effect on a
// damaging move, it is gated by `move.chance`. A bug crept in via the
// auto-extracted C-source correction `["MOVE_GROWL", { chance: 0 }]`, which set
// the move's chance to 0 → the ATK drop never fired ("Growl didn't lower my
// Attack"). This test pins the faithful behaviour: an unobstructed Growl drops
// the target's ATK exactly one stage.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Growl — damaging move retains the Attack drop", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .ability(AbilityId.BALL_FETCH) // neutral — does not protect stats
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH) // neutral — no Clear Body / Hyper Cutter / Soundproof
      .enemyHasPassiveAbility(false) // strip ER innates (Magikarp carries an innate Limber that blocks drops)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.GROWL)
      .enemyLevel(100); // high HP so the 60-BP Special Growl does not KO before we read the stage
  });

  it("lowers the target's ATK by exactly one stage", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getStatStage(Stat.ATK)).toBe(0);

    game.move.select(MoveId.GROWL);
    await game.phaseInterceptor.to("BerryPhase");

    expect(enemy.getStatStage(Stat.ATK)).toBe(-1);
  });
});
