/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// No Turning Back 668 — "When HP drops to half or below for the first time,
// all stats increase by one stage and the user becomes unable to switch out or
// flee." Verifies: on the HP-crossing hit the holder gains +1 to every battle
// stat AND a NO_RETREAT self-trap tag. Above half HP nothing happens.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER No Turning Back (668)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("on first dropping ≤½ HP: +1 to all stats and a NO_RETREAT self-trap", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[668] as AbilityId) // No Turning Back
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const user = game.scene.getPlayerPokemon()!;
    // Sit just above the half-HP threshold so a single Tackle crosses it.
    const threshold = Math.floor(user.getMaxHp() / 2);
    user.hp = threshold + 1;
    expect(user.getTag(BattlerTagType.NO_RETREAT)).toBeUndefined();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // Crossed the threshold this turn → all stats +1 and trapped.
    expect(user.hp).toBeLessThanOrEqual(threshold);
    for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD]) {
      expect(user.getStatStage(stat)).toBe(1);
    }
    expect(user.getTag(BattlerTagType.NO_RETREAT)).toBeDefined();
  });

  it("above half HP: no boost, no trap", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[668] as AbilityId)
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH); // enemy does nothing → user stays at full HP
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);

    const user = game.scene.getPlayerPokemon()!;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(user.getStatStage(Stat.ATK)).toBe(0);
    expect(user.getTag(BattlerTagType.NO_RETREAT)).toBeUndefined();
  });
});
