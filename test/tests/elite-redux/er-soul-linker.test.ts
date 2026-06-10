/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#376) — Soul Linker (ER 332): "Enemies take all the damage they
// deal, same for this Pokemon." Both directions:
//  - DEFENSE: an attacker that damages the holder takes that damage back;
//  - OFFENSE: the holder takes the damage it deals.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SOUL_LINKER = (ER_ID_MAP.abilities[332] ?? 332) as AbilityId;

describe.skipIf(!RUN)("ER Soul Linker (#376)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(SOUL_LINKER)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE]);
  });

  it("an attacker takes back the damage it deals to a Soul Linker holder", async () => {
    await game.classicMode.startBattle(SpeciesId.MACHAMP);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;
    const playerHpBefore = player.hp;

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();

    const dealt = enemy.getMaxHp() - enemy.hp;
    expect(dealt).toBeGreaterThan(0);
    // The attacker mirrored the damage it dealt (allow rounding wiggle).
    const reflected = playerHpBefore - player.hp;
    expect(reflected).toBeGreaterThanOrEqual(Math.max(1, dealt - 2));
  });
});
