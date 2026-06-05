/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug repro: "Battery Ram does no damage." The move is Battering Ram (ER 936 ->
// MoveId 5095), a 90-power Physical Dragon move that also breaks the target's
// screens. Its bespoke wiring passed `false` to RemoveScreensAttr (which expects
// a side-resolver FUNCTION), so calling `this.getTagSideFunc(user, target)` at
// PRE_APPLY threw a TypeError BEFORE damage was applied -> the hit dealt nothing.
// This verifies Battering Ram now deals real damage. Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erMove(id: number): Promise<number | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.moves[id];
}

describe.skipIf(!RUN_SCENARIOS)("ER Battering Ram deals damage (#267)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Battering Ram (936) damages the target (was 0 due to RemoveScreensAttr TypeError)", async () => {
    const move = await erMove(936);
    expect(move).toBeDefined();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.WOBBUFFET)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([move as number])
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false);
    await game.classicMode.startBattle([SpeciesId.RAYQUAZA]);

    const enemy = game.field.getEnemyPokemon();
    const before = enemy.hp;

    game.move.select(move as number);
    await game.toEndOfTurn();

    expect(enemy.hp).toBeLessThan(before);
  });
});
