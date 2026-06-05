/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Aerodynamics (282): "When targeted by a Flying-type move, absorbs the
// attack (no damage) and raises the holder's Speed by one stage." A Motor-Drive
// shape (TypeImmunityStatStageChange). Player report: it "doesn't always show it
// is working — no prompt, no speed boost, just didn't let my move work". This
// reproduces a Flying hit into the holder and checks BOTH the damage negation
// and the +1 Speed actually land.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const AERODYNAMICS = ER_ID_MAP.abilities[282] as AbilityId;

describe.skipIf(!RUN)("ER Aerodynamics — absorb Flying + raise Speed", () => {
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
      .ability(AERODYNAMICS) // on the player (the absorber)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.GUST) // single-target Flying damaging move
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("a Flying move deals no damage and raises the holder's Speed by 1", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();
    expect(player.getStatStage(Stat.SPD)).toBe(0);

    game.move.use(MoveId.SPLASH); // player does nothing; enemy Gusts it
    await game.toEndOfTurn();

    expect(player.hp, "Flying move absorbed (no damage)").toBe(maxHp);
    expect(player.getStatStage(Stat.SPD), "Speed raised by Aerodynamics").toBe(1);
  });
});
