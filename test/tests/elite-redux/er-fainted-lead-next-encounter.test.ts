/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("next encounter with a fainted lead", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset(MoveId.TACKLE)
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(5);
  });

  it("promotes and summons a healthy reserve instead of entering targetless turns", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.EEVEE);
    const lead = globalScene.getPlayerParty()[0];
    const reserve = globalScene.getPlayerParty()[1];

    game.move.use(MoveId.TACKLE);
    await game.phaseInterceptor.to("SelectModifierPhase", false);

    // Reproduce a final-action KO: Victory has already won the battle, so no
    // ordinary faint-replacement prompt will transpose the party before the
    // next encounter begins.
    lead.hp = 0;
    lead.doSetStatus(StatusEffect.FAINT);

    await game.toNextWave();

    expect(globalScene.getPlayerParty()[0]).toBe(reserve);
    expect(reserve.isOnField()).toBe(true);
    expect(globalScene.getPlayerPokemon()).toBe(reserve);
    expect(game.phaseInterceptor.log).toContain("SummonPhase");
  }, 90_000);
});
