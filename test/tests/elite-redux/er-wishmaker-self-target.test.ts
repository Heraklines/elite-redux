/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Wishmaker (#412, live report): the on-entry Wish landed on the OPPONENT's
// slot, so the delayed heal restored the ENEMY instead of the holder. Wish is
// a USER-target move - the scripted post-summon cast needs targetsSelf, like
// Air Blower's Tailwind. This drives a real battle: holder enters hurt, the
// entry Wish heals the HOLDER on the next turn and never the enemy.
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
const WISHMAKER_ER_ID = 496;

describe.skipIf(!RUN)("ER Wishmaker heals the HOLDER, not the opponent (#412)", () => {
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
      .enemyMoveset(MoveId.GROWL)
      .enemyLevel(100)
      .startingLevel(100)
      .ability(ER_ID_MAP.abilities[WISHMAKER_ER_ID] as AbilityId);
  });

  it("the entry Wish restores the holder's HP on the following turn", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Hurt both so a misdirected heal is unmistakable.
    player.hp = Math.floor(player.getMaxHp() / 4);
    enemy.hp = Math.floor(enemy.getMaxHp() / 4);
    const playerHpBefore = player.hp;
    const enemyHpBefore = enemy.hp;

    // Turn 1 (Wish pends) + turn 2 (Wish resolves). Growl on both sides -
    // no damage anywhere, so any HP GAIN is the delayed Wish heal.
    game.move.use(MoveId.GROWL);
    await game.toEndOfTurn();
    game.move.use(MoveId.GROWL);
    await game.toEndOfTurn();

    // The HOLDER got the delayed heal...
    expect(player.hp).toBeGreaterThan(playerHpBefore);
    // ...and the enemy was never HEALED (incidental chip damage from ER
    // move rebalances is fine - the bug was the Wish landing on its slot).
    expect(enemy.hp).toBeLessThanOrEqual(enemyHpBefore);
  });
});
