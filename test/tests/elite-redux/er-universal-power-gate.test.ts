/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #441 - Universal power gate: EVERY EnemyPokemon construction (wild, trainer,
// mystery encounter, scripted) passes the wave BST ceiling on every difficulty.
// Hell uses a steeper ladder. Species origin does not matter: an ER custom that
// fits the curve is allowed; a vanilla box legendary at wave 1 is not.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { resetErDifficulty, setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { EnemyPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER universal power gate (#441)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });

  afterEach(() => {
    resetErDifficulty();
  });

  it("YOUNGSTER: a box legendary constructed at wave 1 is devolved/swapped under the cap", () => {
    setErDifficulty("youngster");
    const enemy = new EnemyPokemon(getPokemonSpecies(SpeciesId.KYOGRE), 20, TrainerSlot.NONE, false);
    expect(enemy.species.speciesId).not.toBe(SpeciesId.KYOGRE);
    expect(enemy.species.getBaseStatTotal()).toBeLessThanOrEqual(460);
    enemy.destroy();
  });

  it("YOUNGSTER: an over-ceiling ER CUSTOM is gated the same way", () => {
    setErDifficulty("youngster");
    const fatCustom = allSpecies.find(s => s.speciesId >= 10000 && s.getBaseStatTotal() > 560 && s.forms.length === 0);
    expect(fatCustom).toBeTruthy();
    const enemy = new EnemyPokemon(fatCustom!, 20, TrainerSlot.NONE, false);
    expect(enemy.species.getBaseStatTotal()).toBeLessThanOrEqual(460);
    enemy.destroy();
  });

  it("YOUNGSTER: a curve-LEGAL ER custom is kept (species gated by power, not origin)", () => {
    setErDifficulty("youngster");
    const modestCustom = allSpecies.find(
      s =>
        s.speciesId >= 10000
        && s.getBaseStatTotal() <= 400
        && !s.legendary
        && !s.subLegendary
        && !s.mythical
        && s.forms.length === 0,
    );
    expect(modestCustom).toBeTruthy();
    const enemy = new EnemyPokemon(modestCustom!, 20, TrainerSlot.NONE, false);
    expect(enemy.species.speciesId).toBe(modestCustom!.speciesId);
    enemy.destroy();
  });

  it("HELL: the steeper early ladder still caps an overpowered legendary", () => {
    setErDifficulty("hell");
    const enemy = new EnemyPokemon(getPokemonSpecies(SpeciesId.KYOGRE), 20, TrainerSlot.NONE, false);
    expect(enemy.species.speciesId).not.toBe(SpeciesId.KYOGRE);
    expect(enemy.getSpeciesForm().getBaseStatTotal()).toBeLessThanOrEqual(460);
    enemy.destroy();
  });
});
