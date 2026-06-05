/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Disguise / Ice Face nullify the first hit by transforming into a "busted" /
// "noice" form. A holder that has the ability but NO such form change (an ER
// custom fusion like Mimikyu Rayquaza — which has no forms — or a randomized-on
// Disguise) used to block EVERY hit forever (effectively invincible). The
// damage-block now only applies if the holder can actually break into its other
// form. Real Mimikyu / Eiscue (which register the form change) are unaffected.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeAbilityTrigger } from "#data/pokemon-forms/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("Disguise only blocks when the holder can break form", () => {
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
      .enemyAbility(AbilityId.DISGUISE)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100)
      .startingLevel(100);
  });

  it("vanilla Mimikyu still nullifies the first hit (regression)", async () => {
    game.override.enemySpecies(SpeciesId.MIMIKYU);
    await game.classicMode.startBattle([SpeciesId.SNORLAX]);
    const enemy = game.field.getEnemyPokemon();
    const maxHp = enemy.getMaxHp();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // Disguise nullifies Tackle's damage; the holder only loses 1/8 max HP recoil.
    // So it must still be well above half HP (a real Tackle from L100 Snorlax + no
    // disguise would chunk far more). This proves the canBreakForm guard does NOT
    // disable Disguise for a real Mimikyu (which has the busted form change).
    expect(enemy.hp).toBeGreaterThan(maxHp - Math.ceil(maxHp / 8) - 1);
  });

  it("Mimikyu Rayquaza (custom, no busted form) has no ability-trigger form change, so Disguise can't infinitely block", () => {
    const fusion = allSpecies.find(s => s.name === "Mimikyu Rayquaza");
    expect(fusion).toBeDefined();
    const changes = pokemonFormChanges[fusion!.speciesId] ?? [];
    const hasAbilityFormChange = changes.some(fc => fc.findTrigger(SpeciesFormChangeAbilityTrigger));
    // No form to break into → the damage-block guard (canBreakForm) returns false,
    // so the holder takes damage normally instead of being invincible.
    expect(hasAbilityFormChange).toBe(false);
  });
});
