/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Parasitic Spores (609, on Parasect).
//
// DEX: "Gain parasitic spores on entry. Each turn, affected Pokemon lose 1/8
// max HP (Ghost types immune). When using contact moves, spread spores to the
// target. Spores persist until switch-out."
//
// The per-turn 1/8 non-Ghost field aura already worked (PostTurnHurtNonTyped).
// This exercises the ADDED contact-spread: the holder's contact moves plant the
// persistent ER_PARASITIC_SPORES tag on the target (Ghost-immune, chips 1/8 each
// turn, persists until the target switches out).
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER - Parasitic Spores contact-spread", () => {
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
      .startingLevel(50)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(ErAbilityId.PARASITIC_SPORES as unknown as AbilityId)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  it("plants ER_PARASITIC_SPORES on a non-Ghost target hit by a contact move", async () => {
    game.override.enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.PARASECT);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getTag(BattlerTagType.ER_PARASITIC_SPORES)).toBeUndefined();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // The contact move spread the spores, and the tag chipped the target.
    expect(enemy.getTag(BattlerTagType.ER_PARASITIC_SPORES)).toBeDefined();
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
  });

  it("does NOT plant spores on a Ghost-type target (immune)", async () => {
    game.override.enemySpecies(SpeciesId.GENGAR);
    await game.classicMode.startBattle(SpeciesId.PARASECT);
    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    expect(enemy.getTag(BattlerTagType.ER_PARASITIC_SPORES)).toBeUndefined();
  });

  it("does NOT spread spores via a non-contact move", async () => {
    game.override.enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.PARASECT);
    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(enemy.getTag(BattlerTagType.ER_PARASITIC_SPORES)).toBeUndefined();
  });

  it("keeps chipping the spored target on subsequent turns (persists on field)", async () => {
    game.override.enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.PARASECT);
    const enemy = game.field.getEnemyPokemon();

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    const hpAfterTurn1 = enemy.hp;
    expect(enemy.getTag(BattlerTagType.ER_PARASITIC_SPORES)).toBeDefined();

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    // Still spored, and it took further chip damage from the persistent tag.
    expect(enemy.getTag(BattlerTagType.ER_PARASITIC_SPORES)).toBeDefined();
    expect(enemy.hp).toBeLessThan(hpAfterTurn1);
  });
});
