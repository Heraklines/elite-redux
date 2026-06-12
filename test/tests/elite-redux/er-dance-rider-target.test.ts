/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Two Step (#413, live report): using Quiver Dance (a STATUS dance whose
// target is the USER) made the scripted 50BP Revelation Dance follow-up
// SELF-HIT the dancer. The post-attack rider now retargets at a real foe
// whenever the triggering move's target resolves to the holder's own side.
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { AbilityId } from "#enums/ability-id";
import { AbilityId as Abilities } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const TWO_STEP_ER_ID = 517;

describe.skipIf(!RUN)("ER Two Step dance rider targets the FOE, not the dancer (#413)", () => {
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
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(Abilities.BALL_FETCH)
      .enemyMoveset(MoveId.HARDEN)
      .enemyLevel(100)
      .startingLevel(100)
      .ability(ER_ID_MAP.abilities[TWO_STEP_ER_ID] as AbilityId);
  });

  it("Quiver Dance triggers Revelation Dance INTO the enemy, never the dancer", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const playerHpBefore = player.hp;

    game.move.use(MoveId.QUIVER_DANCE);
    await game.toEndOfTurn();

    // The follow-up hit the ENEMY (the only damage source this turn - the
    // enemy's Harden is a self-buff, Quiver Dance a self-buff)...
    expect(enemy.getInverseHp()).toBeGreaterThan(0);
    // ...and the dancer never damaged itself.
    expect(player.hp).toBe(playerHpBefore);
  });
});
