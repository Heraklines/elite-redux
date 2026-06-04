/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Hot Coals 704 — "Sets a burning trap on the opponent's side on switch-in;
// the next grounded, burnable Pokemon to switch in is burned, then it's
// consumed." Verifies (a) the HOT_COALS entry hazard burns a grounded switch-in
// and is consumed, and (b) the ability lays the trap on the foe's side on entry.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Hot Coals (704)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("HOT_COALS burns a grounded, burnable Pokemon switching in, then is consumed", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA) // Normal — grounded, burnable
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    // Pre-lay the trap on the enemy side, then start (the enemy is sent in
    // after the tag exists, so it triggers — same pattern as the Toxic Spikes test).
    game.scene.arena.addTag(ArenaTagType.HOT_COALS, 0, undefined, 0, ArenaTagSide.ENEMY);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.status?.effect).toBe(StatusEffect.BURN);
    // Single-use: consumed after triggering.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.HOT_COALS, ArenaTagSide.ENEMY)).toBeUndefined();
  });

  it("does NOT burn a Fire-type switch-in (cannot be burned)", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.CHARMANDER) // Fire — immune to burn
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    game.scene.arena.addTag(ArenaTagType.HOT_COALS, 0, undefined, 0, ArenaTagSide.ENEMY);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);

    const enemy = game.field.getEnemyPokemon();
    expect(enemy.status?.effect).not.toBe(StatusEffect.BURN);
  });

  it("the Hot Coals ability lays a foe-side burn trap on entry (burns the grounded foe present)", async () => {
    game.override
      .battleStyle("single")
      .ability(ER_ID_MAP.abilities[704] as AbilityId) // Hot Coals
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);

    // The holder lays the trap on the FOE's side; the grounded enemy already on
    // the field triggers it (burned) and the single-use trap is consumed.
    expect(game.field.getEnemyPokemon().status?.effect).toBe(StatusEffect.BURN);
    // It was a FOE-side trap, never the holder's own side.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.HOT_COALS, ArenaTagSide.PLAYER)).toBeUndefined();
  });
});
