/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #330 — Items that only benefit an INNATE the player hasn't unlocked must NOT
// be weighted into the reward pool (e.g. Mystical Rock for an un-unlocked Seed
// Sower). The ability-gated pool conditions now use `Pokemon.hasUnlockedAbility`,
// which matches the active ability + any candy-UNLOCKED innate slot and excludes
// latent locked innates.
//
// The leak only manifests on MULTI-innate mons: once ANY slot is unlocked,
// `hasPassive()` is true, so the old `hasAbility(a, false, true)` (canApply=false)
// happily matched an ability sitting in a still-LOCKED slot. We reproduce that by
// injecting Seed Sower into innate slot 1 (via customPokemonData.passive2) while
// only slot 0 is unlocked.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { Passive as PassiveAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER hasUnlockedAbility — innate-unlock gate for reward pools (#330)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .startingLevel(50)
      .enemyLevel(50);
  });

  it("a LOCKED innate slot leaks through hasAbility() but NOT hasUnlockedAbility()", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const p = game.field.getPlayerPokemon();

    // Inject Seed Sower into innate slot 1 (slot 0 is Snorlax's species passive).
    p.customPokemonData.passive2 = AbilityId.SEED_SOWER;
    expect(p.getPassiveAbilities()[1]?.id, "slot 1 now holds Seed Sower").toBe(AbilityId.SEED_SOWER);

    const root = p.species.getRootSpeciesId();
    // Unlock + enable slot 0 ONLY. hasPassive() is now true, but slot 1 (Seed
    // Sower) stays locked.
    game.scene.gameData.starterData[root].passiveAttr = PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1;

    // Old, buggy behavior: canApply=false matches the latent locked-slot innate.
    expect(p.hasAbility(AbilityId.SEED_SOWER, false, true)).toBe(true);
    // Fix: the locked innate slot does not count as "unlocked".
    expect(p.hasUnlockedAbility(AbilityId.SEED_SOWER)).toBe(false);
  });

  it("counts the innate once its slot is unlocked + enabled", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const p = game.field.getPlayerPokemon();
    p.customPokemonData.passive2 = AbilityId.SEED_SOWER;

    const root = p.species.getRootSpeciesId();
    game.scene.gameData.starterData[root].passiveAttr =
      PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1 | PassiveAttr.UNLOCKED_2 | PassiveAttr.ENABLED_2;

    expect(p.hasUnlockedAbility(AbilityId.SEED_SOWER)).toBe(true);
  });

  it("an unlocked-but-DISABLED innate slot does not count", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const p = game.field.getPlayerPokemon();
    p.customPokemonData.passive2 = AbilityId.SEED_SOWER;

    const root = p.species.getRootSpeciesId();
    // Slot 0 active (so hasPassive() is true); slot 1 unlocked but NOT enabled.
    game.scene.gameData.starterData[root].passiveAttr =
      PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1 | PassiveAttr.UNLOCKED_2;

    expect(p.hasUnlockedAbility(AbilityId.SEED_SOWER)).toBe(false);
  });

  it("the active ability always counts as unlocked", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const p = game.field.getPlayerPokemon();
    const root = p.species.getRootSpeciesId();
    game.scene.gameData.starterData[root].passiveAttr = 0; // nothing unlocked

    expect(p.hasUnlockedAbility(p.getAbility().id)).toBe(true);
  });
});
