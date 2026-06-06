/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug: the Ability Randomizer item did nothing on FUSED Pokémon. Root cause:
// Pokemon.getAbility() returned early in the isFusion() branch and never
// consulted customPokemonData.ability — the exact field the randomizer writes
// (setAbilityOverrideForSlot(0)). So a fused mon always showed its fusion-derived
// ability and the reroll silently no-opped. This test pins that an active-ability
// override is now honored for a fused mon.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Ability Randomizer works on fused mons", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  it("getAbility honors an active-ability override on a fused Pokémon", async () => {
    game.override.enableStarterFusion().starterFusionSpecies(SpeciesId.CHARMANDER);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);

    const player = game.field.getPlayerPokemon();
    expect(player.isFusion()).toBe(true);

    const before = player.getAbility().id;
    // Pick a deterministic override distinct from the current ability.
    const override = before === AbilityId.IMPOSTER ? AbilityId.STURDY : AbilityId.IMPOSTER;

    // This is exactly what the Ability Randomizer does for the active slot.
    player.setAbilityOverrideForSlot(0, override);

    // Pre-fix this returned the fusion-derived ability (override ignored).
    expect(player.getAbility().id).toBe(override);
    expect(player.getAbility().id).not.toBe(before);
  });
});
