/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// #632: live report - "Coil Up is meant to work on the first biting move even if
// it fails, but seems to persist until it lands a biting move." Coil Up (ability
// 302) grants +1 priority to the holder's FIRST biting move on entry; it must be
// consumed the first time a biting move is USED, even if that move misses/fails.
// The bug: the boost was consumed by a PostAttack hook that only fires on a HIT,
// so a non-landing biting move (miss/immune) left the boost active for the next
// biting move.
//
// Deterministic repro (no RNG miss): a slow Coil Up SNORLAX uses Thunder Fang (a
// biting Electric move) into a GROUND-type DUGTRIO - immune, so the move is used
// but does NOT land. Next turn it uses Crunch (also biting). The boost must have
// been consumed on the turn-1 Thunder Fang, so the faster Diglett moves first on
// turn 2 (Snorlax's Crunch no longer has +1 priority). Before the fix the boost
// persisted and Snorlax's Crunch went first.
//
// Run: ER_SCENARIO=1 npx vitest run test/tests/elite-redux/er-coil-up-consume-on-use.test.ts

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const COIL_UP = ER_ID_MAP.abilities[302] as AbilityId; // 5040

describe.skipIf(!RUN)("ER Coil Up consumes its +1-priority boost on the first biting move USED (#632)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterAll(() => phaserGame?.destroy(true));

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(145) // past the #419 BST cap so Diglett isn't devolved
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false)
      .ability(COIL_UP)
      .moveset([MoveId.THUNDER_FANG, MoveId.CRUNCH])
      .enemySpecies(SpeciesId.DIGLETT) // Ground -> immune to Thunder Fang; fast + very frail (Crunch OHKOs)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset([MoveId.TACKLE]);
  });

  it("a non-landing (immune) biting move still consumes the boost; next biting move has no priority", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    // Turn 1: Thunder Fang (biting, +1 priority) into Ground-immune Diglett -> the
    // move is USED but lands no effect. This must consume the Coil Up boost.
    game.move.select(MoveId.THUNDER_FANG);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.toEndOfTurn();
    expect(enemy.isFainted(), "Diglett is immune to Thunder Fang and survives turn 1").toBe(false);
    const hpAfterT1 = player.hp;
    enemy.hp = 1; // guarantee Crunch KOs on turn 2 regardless of the damage roll, so ORDER is the only variable

    // Turn 2: Crunch (biting). If the boost was correctly consumed on turn 1, Snorlax
    // no longer outspeeds via priority, so the faster Diglett Tackles FIRST (player
    // loses HP) before Snorlax's Crunch KOs it. If the boost wrongly persisted,
    // Snorlax's Crunch goes first and KOs Diglett before it can Tackle (no HP loss).
    game.move.select(MoveId.CRUNCH);
    await game.move.forceEnemyMove(MoveId.TACKLE);
    await game.toEndOfTurn();

    const lostHpOnT2 = player.hp < hpAfterT1;
    console.log(
      `#632: hpAfterT1=${hpAfterT1}/${player.getMaxHp()} hpAfterT2=${player.hp} lostHpOnT2=${lostHpOnT2} `
        + `enemyFainted=${enemy.isFainted()}`,
    );

    expect(enemy.isFainted(), "Snorlax's Crunch KO'd Diglett").toBe(true);
    expect(
      lostHpOnT2,
      "the faster Diglett must move FIRST on turn 2 (the Coil Up boost was consumed by the immune Thunder Fang)",
    ).toBe(true);
  }, 120_000);
});
