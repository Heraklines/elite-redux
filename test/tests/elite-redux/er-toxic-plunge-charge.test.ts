/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Toxic Plunge (988): "Dives into a pool of poison then strikes on the next
// turn. 20% chance to poison." A two-turn Dive-style charge move. The classifier
// only wired the 20% poison (chance-status-on-hit), so it built as a plain
// AttackMove and hit INSTANTLY like a poison jab — no charge. It's now built as
// a charging move (ErCustomChargingAttackMove) that hides underwater on the
// charge turn and strikes next turn, keeping the poison rider.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const TOXIC_PLUNGE = ER_ID_MAP.moves[988] as MoveId;

describe.skipIf(!RUN)("ER Toxic Plunge — two-turn charge move", () => {
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
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([TOXIC_PLUNGE])
      .startingLevel(100)
      .enemyLevel(100);
  });

  it("is registered as a charging move that keeps its poison rider", () => {
    const move = allMoves[TOXIC_PLUNGE];
    expect(move, "Toxic Plunge must be registered").toBeDefined();
    expect(move.isChargingMove(), "Toxic Plunge must be a two-turn charge move").toBe(true);
    // The 20% poison from the classifier must survive on the strike.
    expect(move.hasAttr("StatusEffectAttr"), "Toxic Plunge keeps its poison chance").toBe(true);
  });

  it("does not deal damage on the charge turn (it charges instead of jabbing)", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    const enemyHp0 = enemy.hp;

    game.move.use(TOXIC_PLUNGE);
    await game.toEndOfTurn();

    // Turn 1 is the dive (charge) — the enemy takes no damage yet.
    expect(enemy.hp, "no damage on the charge turn").toBe(enemyHp0);
  });
});
