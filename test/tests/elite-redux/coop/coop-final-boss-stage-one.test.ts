/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op classic finale stage-one normalization", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setErDifficulty("ace");
    game = new GameManager(phaserGame);
    game.override.battleStyle("double").startingWave(200);
  });

  afterEach(() => {
    setErDifficulty("ace");
    vi.restoreAllMocks();
  });

  it("starts the co-op finale as one canonical Eternatus instead of two random bosses", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(true);
    expect(game.scene.currentBattle.double, "phase one is single; initFinalBossPhaseTwo enables double").toBe(false);
    expect(game.scene.currentBattle.enemyParty).toHaveLength(1);
    expect(game.scene.currentBattle.enemyParty[0]?.species.speciesId).toBe(SpeciesId.ETERNATUS);
  });

  it("does not grant finale immortality to an unrelated segmented enemy", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const unrelatedBoss = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.DODRIO), 200, TrainerSlot.NONE);
    unrelatedBoss.setBoss(true, 2);
    unrelatedBoss.hp = unrelatedBoss.getMaxHp();

    unrelatedBoss.damage(unrelatedBoss.hp, true, true, true);

    expect(unrelatedBoss.hp, "only Eternatus/Cascoon stage one may be held at 1 HP").toBe(0);
  });
});
