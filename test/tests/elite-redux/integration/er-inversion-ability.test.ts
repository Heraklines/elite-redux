/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #103 — Inversion (473): "Sets up Inverse Room on entry, lasts 3 turns."
// Previously a 1.2x damage-boost proxy (pokerogue lacked the tag); now sets the
// real ER INVERSE_ROOM arena tag on entry.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { getTypeDamageMultiplier } from "#data/type";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Inversion ability (#103)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("sets the INVERSE_ROOM arena tag on entry", async () => {
    const map = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    const ability = map.abilities[473] as AbilityId | undefined;
    if (ability === undefined) {
      return;
    }
    game.override
      .battleStyle("single")
      .ability(ability)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    expect(game.scene.arena.getTag(ArenaTagType.INVERSE_ROOM)).toBeDefined();
  });

  it("explains Xatu's reversed matchup when Inversion starts and ends", async () => {
    const map = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
    const ability = map.abilities[473] as AbilityId | undefined;
    expect(ability).toBeDefined();

    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(ability as AbilityId)
      .enemySpecies(SpeciesId.XATU)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.KNOCK_OFF)
      .startingWave(145)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);

    const messageSpy = vi.spyOn(game.scene.phaseManager, "queueMessage");
    await game.classicMode.startBattle(SpeciesId.WEAVILE);

    expect(game.scene.arena.getTag(ArenaTagType.INVERSE_ROOM)).toBeDefined();
    expect(getTypeDamageMultiplier(PokemonType.DARK, PokemonType.PSYCHIC)).toBe(0.5);
    expect(messageSpy.mock.calls.map(([message]) => String(message))).toContain(
      "Inverse Room reversed\ntype matchups!",
    );

    game.scene.arena.removeTagOnSide(ArenaTagType.INVERSE_ROOM, ArenaTagSide.ENEMY);
    expect(messageSpy.mock.calls.map(([message]) => String(message))).toContain(
      "Inverse Room wore off!\nType matchups returned to normal.",
    );
  });
});
