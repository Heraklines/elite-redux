/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #419 - Elite trainer BST curve. The curve report (docs/er-bst-curve-report.md)
// showed wave-20 boss teams fielding Kyogre/Suicune/Manaphy at lvl 11. Elite
// trainer mons over the wave's BST ceiling (or legend-like before wave 80) are
// now DEVOLVED stage by stage, or SWAPPED for a wave-appropriate factory pick
// when no prevolution fits. Hell exempt. Gated behind ER_SCENARIO=1.
// =============================================================================

import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { enforceErEliteBstCurve } from "#data/elite-redux/er-trainer-runtime-hook";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Elite BST curve enforcement (#419)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(11)
      .startingLevel(11)
      .ability(AbilityId.BALL_FETCH);
  });

  afterEach(() => {
    setErDifficulty("ace");
  });

  const retarget = (speciesId: SpeciesId, wave: number): EnemyPokemon => {
    const enemy = game.scene.getEnemyPokemon()! as EnemyPokemon;
    enemy.species = getPokemonSpecies(speciesId);
    enemy.formIndex = 0;
    (game.scene.currentBattle as unknown as { waveIndex: number }).waveIndex = wave;
    return enemy;
  };

  it("wave-20 Kyogre (the report case) is swapped for a non-legend under the boss cap", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("elite");
    const enemy = retarget(SpeciesId.KYOGRE, 20);
    enforceErEliteBstCurve(enemy);
    expect(enemy.species.speciesId).not.toBe(SpeciesId.KYOGRE);
    expect(enemy.species.getBaseStatTotal()).toBeLessThanOrEqual(460); // 420 + 40 boss headroom
    expect(enemy.species.legendary || enemy.species.subLegendary || enemy.species.mythical).toBe(false);
  });

  it("an over-cap final stage devolves (Garchomp at wave 30 becomes its prevolution)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("elite");
    const enemy = retarget(SpeciesId.GARCHOMP, 33);
    enforceErEliteBstCurve(enemy);
    expect(enemy.species.speciesId).toBe(SpeciesId.GABITE);
  });

  it("no cap past wave 100, and Hell is exempt entirely", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    setErDifficulty("elite");
    const late = retarget(SpeciesId.KYOGRE, 120);
    enforceErEliteBstCurve(late);
    expect(late.species.speciesId).toBe(SpeciesId.KYOGRE);

    setErDifficulty("hell");
    const hell = retarget(SpeciesId.KYOGRE, 20);
    enforceErEliteBstCurve(hell);
    expect(hell.species.speciesId).toBe(SpeciesId.KYOGRE);
  });
});
