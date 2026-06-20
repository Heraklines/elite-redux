/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Disguise / Ice Face nullify the first hit by transforming into a "busted" /
// "noice" form. A holder with the ability but NO such form change blocks EVERY
// hit forever (effectively invincible), so the damage-block is guarded by
// canBreakForm: it only applies if the holder can actually break into its other
// form.
//
// The Mimikyu Apex line (Apex/Apex Busted, Rayquaza/Primal) ships as separate ER
// species, NOT forms, so they had no busted form change and their Disguise innate
// silently did nothing. The fix injects each disguised tier's busted counterpart
// as a form + an ability-trigger edge (the Battle Bond model), so Disguise now
// works for them. This test asserts (a) those edges exist, and (b) a genuinely
// formless Disguise holder (the guard's real target) still takes full damage.
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
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
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

  it("Mimikyu Apex + Rayquaza now register a busted form change so Disguise works", () => {
    // The fix: each disguised tier gets its busted counterpart injected as a form
    // + an ability-trigger edge, so canBreakForm passes and Disguise blocks the
    // first hit (instead of doing nothing). Both tiers must have the edge now.
    for (const name of ["Mimikyu Apex", "Mimikyu Rayquaza"]) {
      const species = allSpecies.find(s => s.name === name);
      expect(species, name).toBeDefined();
      const changes = pokemonFormChanges[species!.speciesId] ?? [];
      const hasAbilityFormChange = changes.some(fc => fc.findTrigger(SpeciesFormChangeAbilityTrigger));
      expect(hasAbilityFormChange, `${name} ability form change`).toBe(true);
      // A disguised (index 0) + busted (index 1) form pair must exist to break into.
      expect(species!.forms.length, `${name} forms`).toBeGreaterThanOrEqual(2);
    }
  });

  it("a genuinely formless Disguise holder still takes full damage (guard intact)", async () => {
    // Snorlax has no busted form change, so the canBreakForm guard must keep
    // Disguise from infinitely blocking - it takes a normal Tackle.
    game.override.enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    const maxHp = enemy.getMaxHp();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // Damage was NOT nullified: it lost more than the 1/8 recoil a real disguise costs.
    expect(enemy.hp).toBeLessThan(maxHp - Math.ceil(maxHp / 8));
  });
});
