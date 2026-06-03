/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Energized 699 — "Charges on entry; recharges when Electric Terrain is set or
// on a direct KO with an Electric move." Verifies the entry charge and the
// Electric-move-KO recharge (the new PostVictory hook). The CHARGED tag doubles
// the next Electric move's power.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Energized (699)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("charges (CHARGED tag) on entry", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[699] as AbilityId)
      .moveset([MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    expect(game.field.getPlayerPokemon().getTag(BattlerTagType.CHARGED)).toBeDefined();
  });

  it("recharges (CHARGED) after a direct KO with an Electric move", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[699] as AbilityId)
      .moveset([MoveId.THUNDERBOLT])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    // Consume the entry charge so we can observe the KO-recharge re-applying it.
    user.removeTag(BattlerTagType.CHARGED);
    enemy.hp = 1; // guarantee the KO

    // KO with an Electric move → Energized recharges. Check after the move
    // resolves (the recharge fires in the faint phase) but before the turn-end
    // lapse that would expire the freshly-added CHARGED tag.
    game.move.use(MoveId.THUNDERBOLT);
    await game.move.forceHit();
    await game.phaseInterceptor.to("MoveEndPhase");

    expect(enemy.isFainted()).toBe(true);
    expect(user.getTag(BattlerTagType.CHARGED)).toBeDefined();
  });

  it("does NOT recharge on a KO with a non-Electric move", async () => {
    game.override
      .ability(ER_ID_MAP.abilities[699] as AbilityId)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle([SpeciesId.PIKACHU]);
    const user = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    user.removeTag(BattlerTagType.CHARGED);
    enemy.hp = 1;

    game.move.use(MoveId.TACKLE);
    await game.move.forceHit();
    await game.phaseInterceptor.to("MoveEndPhase");

    expect(enemy.isFainted()).toBe(true);
    expect(user.getTag(BattlerTagType.CHARGED)).toBeUndefined();
  });
});
