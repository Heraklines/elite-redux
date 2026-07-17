/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — a trainer / ghost snapshot must never field an already-Busted
// Mimikyu.
//
// Report: trainers can field Mimikyu already Busted. "Busted" is a battle-RESULT
// form (Disguise breaking), not a resting form. The player restores it between
// battles via PostBattleInitAbAttr, but that pass is player-party only, so a
// trainer / ghost team that captured a Mimikyu mid-run in its busted form fields
// it broken (#442 Unown-Revelation leak class, extended to Busted). `Trainer.
// genPartyMember` now runs `resetBattleResultForm` on every generated member,
// resetting the busted form back to the resting form.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { resetBattleResultForm } from "#field/trainer";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER — battle-result form guard (Mimikyu never spawns Busted)", () => {
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
      .enemySpecies(SpeciesId.MIMIKYU)
      .enemyAbility(AbilityId.DISGUISE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  /**
   * Pin the enemy to the REAL Mimikyu species (the wild-gen override does not
   * reliably keep the requested species/forms — same limitation the flammable-
   * coat enemy test works around). `getPokemonSpecies(MIMIKYU)` carries the true
   * [disguised, busted] form layout.
   */
  async function makeEnemyMimikyu() {
    const enemy = game.field.getEnemyPokemon();
    enemy.species = getPokemonSpecies(SpeciesId.MIMIKYU);
    enemy.formIndex = 0;
    await enemy.loadAssets(false);
    return enemy;
  }

  it("resetBattleResultForm resets a Busted Mimikyu to its resting form", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = await makeEnemyMimikyu();
    const bustedIndex = enemy.species.forms.findIndex(f => f.formKey === "busted");
    expect(bustedIndex, "Mimikyu should have a busted form").toBeGreaterThan(0);
    const restingKey = enemy.species.forms[0].formKey;

    // Simulate a snapshot that captured the mon mid-run in its busted form.
    enemy.formIndex = bustedIndex;
    expect(enemy.getFormKey()).toBe("busted");

    resetBattleResultForm(enemy);

    expect(enemy.getFormKey(), "the busted disguise must be reset to the resting form").toBe(restingKey);
    expect(enemy.getFormKey()).not.toBe("busted");
  });

  it("leaves a non-busted Mimikyu untouched", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = await makeEnemyMimikyu();
    const restingKey = enemy.species.forms[0].formKey;
    enemy.formIndex = 0;

    resetBattleResultForm(enemy);

    expect(enemy.getFormKey()).toBe(restingKey);
  });
});
