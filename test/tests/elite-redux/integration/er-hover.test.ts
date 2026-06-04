/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Hover 715 — "Adds Psychic type on entry; immune to Ground-type moves AND
// ground effects such as Spikes and terrains." Verifies the FloatAbAttr
// ungrounding (isGrounded false → Spikes don't hurt on switch-in) and that the
// holder gains the Psychic type.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Hover (715)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("is ungrounded (Levitate-style), gains Psychic type, and ignores Spikes on entry", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[715] as AbilityId) // Hover
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    // Pre-lay Spikes on the player's side; an ungrounded Hover holder should not
    // take Spikes damage on switch-in.
    game.scene.arena.addTag(ArenaTagType.SPIKES, 0, undefined, 0, ArenaTagSide.PLAYER);
    await game.classicMode.startBattle([SpeciesId.RATTATA]); // Normal — would be grounded without Hover

    const user = game.field.getPlayerPokemon();
    expect(user.isGrounded()).toBe(false);
    expect(user.hp).toBe(user.getMaxHp()); // no Spikes chip
    // Entry effect added Psychic to its typing.
    expect(user.getTypes().includes(PokemonType.PSYCHIC)).toBe(true);
  });

  it("a non-Hover Pokemon IS grounded and takes Spikes damage", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    game.scene.arena.addTag(ArenaTagType.SPIKES, 0, undefined, 0, ArenaTagSide.PLAYER);
    await game.classicMode.startBattle([SpeciesId.RATTATA]);

    const user = game.field.getPlayerPokemon();
    expect(user.isGrounded()).toBe(true);
    expect(user.hp).toBeLessThan(user.getMaxHp()); // took Spikes chip
  });
});
