/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Live report: "Redux Seel used Icicle Spear and the Koffing lived on 1 hp
// repeatedly - Aftermath was triggering every hit." Koffing carries Aftermath
// as an INNATE (er innate 106). The multi-hit endure (#249) kept the holder at
// 1 HP through EVERY remaining sub-hit, re-flashing the ability each time. ROM
// behavior: the KO hit ends the volley (the holder drops on that strike, the
// rest never happen), then the blast fires. The fix truncates the attacker's
// volley on the arming hit. Gated behind ER_SCENARIO=1.
import { allMoves } from "#data/data-lists";
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Aftermath vs multi-hit: one trigger, volley stops (live Koffing report)", () => {
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
      .enemySpecies(SpeciesId.KOFFING)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(50)
      .startingLevel(100);
  });

  it("a multi-hit KO on innate-Aftermath Koffing detonates and the holder DIES (no 1-HP survivor)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const enemy = game.field.getEnemyPokemon();
    enemy.hp = 5;
    const player = game.field.getPlayerPokemon();

    game.move.use(MoveId.ICICLE_SPEAR);
    await game.toEndOfTurn();

    // The holder must NOT be left alive at 1 HP after the volley.
    expect(enemy.isFainted()).toBe(true);
    // The detonation actually played: the player took explosion damage (the
    // enemy's only move is ER Splash, which it never got to use).
    expect(player.getInverseHp()).toBeGreaterThan(0);
  });

  it("the arming hit TRUNCATES the attacker's volley: Aftermath triggers once, remaining strikes are cancelled", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    const attr = new PostFaintDetonateAbAttr();
    const holder = game.field.getEnemyPokemon();
    const attacker = game.field.getPlayerPokemon();
    const move = allMoves[MoveId.ICICLE_SPEAR];

    // Strike 2 of a 5-strike volley is the lethal (arming) one.
    attacker.turnData.hitCount = 5;
    attacker.turnData.hitsLeft = 4;
    const damage = new NumberHolder(holder.hp + 100);
    expect(attr.canApply({ pokemon: holder, opponent: attacker, move, damage })).toBe(true);
    attr.apply({ pokemon: holder, opponent: attacker, move, damage });

    // The volley is truncated to the 2 strikes that actually happened; the
    // arming strike is the last one, so strikes 3-5 never re-trigger the endure.
    expect(attacker.turnData.hitsLeft).toBe(1);
    expect(attacker.turnData.hitCount).toBe(2);
  });
});
