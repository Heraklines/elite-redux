/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#375) — Neutralizing Gas must suppress ER Scare's on-entry
// SpAtk drop (Scare is the ER Intimidate analog targeting Sp. Atk).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const SCARE = (ER_ID_MAP.abilities[329] ?? 329) as AbilityId;

describe.skipIf(!RUN)("ER Neutralizing Gas vs Scare (#375)", () => {
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
      .enemySpecies(SpeciesId.WEEZING)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  it("without Neutralizing Gas, Scare drops the foe's SpAtk on entry", async () => {
    game.override.ability(SCARE).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const enemy = game.scene.getEnemyPokemon()!;
    expect(enemy.getStatStage(Stat.SPATK)).toBe(-1);
  });

  it("with Neutralizing Gas on the field, Scare's entry drop is suppressed", async () => {
    game.override.ability(SCARE).enemyAbility(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const enemy = game.scene.getEnemyPokemon()!;
    expect(enemy.getStatStage(Stat.SPATK)).toBe(0);
  });

  it("Neutralizing Gas also suppresses Scare when it is an INNATE slot", async () => {
    game.override.ability(AbilityId.BALL_FETCH).passiveAbility(SCARE).enemyAbility(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.GYARADOS);
    const enemy = game.scene.getEnemyPokemon()!;
    expect(enemy.getStatStage(Stat.SPATK)).toBe(0);
  });
});
