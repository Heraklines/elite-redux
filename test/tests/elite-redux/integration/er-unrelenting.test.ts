/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Unrelenting 994 — "All attacking moves can hit 2-5 times."
//
// Previously wired as MaxMultiHitAbAttr (Skill Link), which only forces an
// ALREADY-multi-hit move to its max and does nothing to a single-hit move. The
// fix adds AllAttacksMultiHitAbAttr: an eligible single-hit damaging move is
// turned into a 2-5-hit move (same distribution as MultiHitType.TWO_TO_FIVE).
//
// Verifies a normally single-hit move (Tackle) lands 2-5 times for an
// Unrelenting holder, and exactly once for a holder without it.
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

describe.skipIf(!RUN)("ER Unrelenting (994)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("a single-hit move (Tackle) lands 2-5 times for an Unrelenting holder", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[994] as AbilityId) // Unrelenting
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.SNORLAX) // bulky — survives a multi-hit Tackle
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);

    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.TACKLE);
    await game.move.forceHit();
    await game.toEndOfTurn();

    expect(player.turnData.hitCount).toBeGreaterThanOrEqual(2);
    expect(player.turnData.hitCount).toBeLessThanOrEqual(5);
  });

  it("without Unrelenting, Tackle hits exactly once (no regression)", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);

    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.TACKLE);
    await game.move.forceHit();
    await game.toEndOfTurn();

    expect(player.turnData.hitCount).toBe(1);
  });
});
