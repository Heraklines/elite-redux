/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Giant Shuriken 958 — "Water Shuriken hits once with 100BP and +1 crit."
//
// Water Shuriken normally hits 2–5 times at 15BP. The ability boosts power
// 6.67× (15 → ~100BP) and adds +1 crit stage — but the headline "hits once" was
// never enforced, so the boosted move would multi-hit at 100BP each. The fix
// forces a single hit move-side (WaterShurikenMultiHitTypeAttr → MultiHitType.ONE
// when the user has Giant Shuriken).
//
// Verifies the holder's Water Shuriken connects exactly once.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Giant Shuriken (958)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Water Shuriken from a Giant Shuriken holder hits exactly once", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[958] as AbilityId) // Giant Shuriken
      .moveset([MoveId.WATER_SHURIKEN])
      .enemySpecies(SpeciesId.SNORLAX) // bulky Normal — survives a single 100BP hit
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.GRENINJA]);

    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.WATER_SHURIKEN);
    await game.move.forceHit();
    await game.toEndOfTurn();

    expect(player.turnData.hitCount).toBe(1);
  });
});
