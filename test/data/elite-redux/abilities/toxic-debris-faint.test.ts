/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — #222: Toxic Debris must lay Toxic Spikes even when the holder
// faints to the physical hit that triggers it. The ability is wired with
// `.bypassFaint()`, and `canApplyAbility` (pokemon.ts) honors that for fainted
// holders, while the move-effect phase reaches PostDefend effects regardless of
// the target fainting. This pins that behaviour end-to-end.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Toxic Debris — procs on the fatal hit", () => {
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
      .startingLevel(100)
      .moveset(MoveId.TACKLE) // physical → triggers Toxic Debris
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.TOXIC_DEBRIS)
      .enemyHasPassiveAbility(false)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(1); // frail → the physical hit KOs it
  });

  it("lays Toxic Spikes on the attacker's side even though the holder faints", async () => {
    await game.classicMode.startBattle([SpeciesId.RAMPARDOS]);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("BerryPhase");

    // Holder fainted from the hit...
    expect(enemy.isFainted()).toBe(true);
    // ...but Toxic Debris still laid Toxic Spikes on the player's (attacker's) side.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.PLAYER)).toBeDefined();
  });
});
