/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Inflatable (ER 290): "Ups Def and Sp. Def by one stage if hit by Flying or Fire
// moves." The `stat-trigger-on-event` dispatcher dropped the configured type
// filter, so it triggered on EVERY hit (reported: triggered on a Rock move).
// It must fire ONLY on Fire/Flying hits. Gated behind ER_SCENARIO=1.
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Inflatable (290) — only triggers on Fire/Flying hits", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Bulky high-level enemy + a weak attacker so the hit lands WITHOUT KOing the
    // target (Inflatable boosts "after the hit lands" — a fainted target can't be
    // checked and would end the battle).
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(ER_ID_MAP.abilities[290] as AbilityId) // Inflatable on the target
      .enemyLevel(100)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(5)
      .moveset([MoveId.ROCK_THROW, MoveId.EMBER, MoveId.GUST, MoveId.TACKLE]);
  });

  it("does NOT raise Def/SpD when hit by a Rock-type move", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.move.use(MoveId.ROCK_THROW);
    await game.toNextTurn();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getStatStage(Stat.DEF)).toBe(0);
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(0);
  });

  it("raises Def + SpD by 1 when hit by a Fire-type move", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.move.use(MoveId.EMBER);
    await game.toNextTurn();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getStatStage(Stat.DEF)).toBe(1);
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(1);
  });

  it("raises Def + SpD by 1 when hit by a Flying-type move", async () => {
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    game.move.use(MoveId.GUST);
    await game.toNextTurn();
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getStatStage(Stat.DEF)).toBe(1);
    expect(enemy.getStatStage(Stat.SPDEF)).toBe(1);
  });
});
