/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Flammable Coat (669) on an ENEMY Lumbering Sloth.
//
// Report: a trainer-owned Lumbering Sloth does NOT transform into Engulfed when
// hit by a Fire move. The player-side surface is covered by
// er-flammable-coat-form-change.test.ts; this locks the ENEMY-side execution:
// the PostDefend FireHitFormChangeAbAttr must fire `triggerPokemonFormChange` on
// an ENEMY pokemon (form changes are commonly player-only in the base engine).
//
// The enemy is pinned to Lumbering Sloth by reassigning the spawned enemy's
// species (the ENEMY_SPECIES_OVERRIDE helper can't take an ER-custom id, and the
// wild-gen path does not honor it for the 10000-band ids). Gated ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/** Pokerogue species id of Lumbering Sloth (ER id 1049). */
const LUMBER_SLOTH_ID = 10023 as SpeciesId;

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER - Flammable Coat form change on an ENEMY", () => {
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
      .startingLevel(100)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(ErAbilityId.FLAMMABLE_COAT as unknown as AbilityId)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.EMBER, MoveId.SPLASH]);
  });

  /** Pin the spawned enemy to Lumbering Sloth (base form) with its engulfed form intact. */
  async function makeEnemyLumberSloth() {
    const enemy = game.field.getEnemyPokemon();
    enemy.species = getPokemonSpecies(LUMBER_SLOTH_ID);
    enemy.formIndex = 0;
    await enemy.loadAssets(false);
    return enemy;
  }

  it("the enemy Lumbering Sloth transforms into Engulfed when HIT by a Fire move", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = await makeEnemyLumberSloth();
    expect(enemy.getFormKey()).toBe("");

    game.move.select(MoveId.EMBER);
    await game.toEndOfTurn();

    expect(enemy.getFormKey()).toBe("engulfed");
  });

  it("the enemy does NOT transform when hit by a non-Fire move", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = await makeEnemyLumberSloth();

    game.move.select(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(enemy.getFormKey()).toBe("");
  });
});
