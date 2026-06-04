/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Retribution Blow (407) + the OnOpponentStatRaise base fix. The ER attr used
// to extend PostStatStageChange with a `!pokemon.isPlayer` (method-reference)
// canApply bug that ALWAYS returned false — so Egoist/Retribution Blow never
// fired. Now it rides the registered StatStageChangeCopy (Opportunist) hook.
// Behavioural proof: when the PLAYER raises a stat (Swords Dance), a
// Retribution-Blow enemy fires a scripted Hyper Beam back — the player takes
// damage it otherwise never would (the enemy's only move is Splash).
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Retribution Blow (407) — Hyper Beam when a foe boosts", () => {
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
      .enemyAbility(ER_ID_MAP.abilities[407] as AbilityId)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SWORDS_DANCE])
      .ability(AbilityId.BALL_FETCH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("the player taking a stat boost triggers the enemy's Hyper Beam", async () => {
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.SWORDS_DANCE); // copyable +2 ATK on the player
    await game.toEndOfTurn();

    // The enemy's only move is Splash (0 damage), so any HP loss on the player
    // is the Retribution Blow Hyper Beam (which cannot miss).
    expect(player.getInverseHp()).toBeGreaterThan(0);
  });
});
