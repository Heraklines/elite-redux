/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Furnace (ability 447): "+2 Speed stages when hit by a Rock move OR when
// switching in with Stealth Rock present on the holder's own side."
//
// The on-hit half was already wired (StatTriggerOnHitAbAttr, filter ROCK); the
// switch-in-with-Stealth-Rock half was missing (PostSummonStatStageChangeAbAttr
// gated on Stealth Rock being on the holder's own side). Both halves proven here.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const FURNACE = ErAbilityId.FURNACE as unknown as AbilityId;

describe.skipIf(!RUN)("ER Furnace — +2 Speed on Rock hit / Stealth-Rock switch-in", () => {
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
      .ability(FURNACE)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyLevel(5)
      .startingLevel(50);
  });

  it("gains +2 Speed when hit by a Rock move", async () => {
    game.override.enemyMoveset(MoveId.POWER_GEM).enemyLevel(100); // Rock, 100% accuracy, real damage
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.SPD)).toBe(0);

    game.move.use(MoveId.SPLASH);
    await game.move.forceEnemyMove(MoveId.POWER_GEM);
    await game.toEndOfTurn();

    expect(player.hp).toBeLessThan(player.getMaxHp()); // the Rock move connected
    expect(player.getStatStage(Stat.SPD)).toBe(2);
  });

  it("gains +2 Speed when switching in with Stealth Rock on its own side", async () => {
    game.override.enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGCARGO);
    const arena = game.scene.arena;
    const enemyId = game.scene.getEnemyPokemon()!.id;
    // Lay Stealth Rock on the PLAYER side, then switch the Furnace bench mon in.
    arena.addTag(ArenaTagType.STEALTH_ROCK, 0, undefined, enemyId, ArenaTagSide.PLAYER);
    const bench = game.scene.getPlayerParty()[1];
    expect(bench.getStatStage(Stat.SPD)).toBe(0);

    game.doSwitchPokemon(1);
    await game.toNextTurn();

    const active = game.scene.getPlayerPokemon()!;
    expect(active.species.speciesId).toBe(SpeciesId.MAGCARGO);
    expect(active.getStatStage(Stat.SPD)).toBe(2);
  });
});
