/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro: "during rival fights sprites are sometimes shifted entirely to the
// right." Root cause: in a DOUBLE battle, when one foe faints and nothing
// switches into its slot, the lone surviving foe kept its double-slot offset
// (+32 RIGHT / -32 LEFT). FaintPhase recenters the PLAYER's lone survivor but the
// ENEMY branch never did. The fix mirrors that recenter for the enemy side.
//
// This drives a real double battle, KOs the LEFT foe (so the RIGHT foe is the lone
// survivor - the +32 case the maintainer reported), and asserts the survivor is
// recentered (field-position offset 0). ER_SCENARIO=1 gated.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER double-battle lone-survivor recenter (rival +32 sprite shift)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      // HARDEN is self-target: the foes never damage the player and never KO each
      // other, so the ONLY faint is the one the player's lead inflicts.
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE, MoveId.HARDEN]);
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("centers the lone surviving foe when its double partner faints with no reserve", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX);
    const [leftFoe, rightFoe] = game.scene.getEnemyField();

    // Sanity: a double battle starts with the two foes split to LEFT(-32)/RIGHT(+32).
    expect(rightFoe.getFieldPositionOffset()[0]).toBe(32);
    expect(leftFoe.getFieldPositionOffset()[0]).toBe(-32);

    // Make the LEFT foe a one-hit KO; the RIGHT foe stays at full HP so it is the
    // lone survivor (the +32 case).
    leftFoe.hp = 1;

    // Lead KOs the LEFT foe (BattlerIndex.ENEMY); the second mon just buffs itself.
    game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
    game.move.select(MoveId.HARDEN, 1);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(leftFoe.isFainted()).toBe(true);
    // The fix: the surviving RIGHT foe is recentered instead of stuck at +32.
    expect(rightFoe.getFieldPositionOffset()[0]).toBe(0);
  });
});
