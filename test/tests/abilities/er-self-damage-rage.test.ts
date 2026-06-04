/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — self-damage-on-attack + on-crit-raise abilities, previously
// wired as partials (the recoil / on-crit piece was deferred):
//
//   - SUPER_STRAIN — moves deal 25% of damage done as recoil (+ KO drops ATK)
//   - BLOOD_PRICE  — lose 10% of max HP when landing an attack (+30% damage)
//   - RAGE_POINT   — taking a crit raises ATK & SPATK by 1 (+1.5x while statused)
//
// Asserts the EFFECT, not just the wiring.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

describe("ER abilities — Super Strain / Blood Price / Rage Point", () => {
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
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  test("Blood Price — loses 10% of max HP when landing an attack", async () => {
    game.override
      .ability(ErAbilityId.BLOOD_PRICE as unknown as AbilityId)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.CHANSEY);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const maxHp = player.getMaxHp();
    expect(player.hp).toBe(maxHp);

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Self-cost is floor(maxHp * 0.10); the enemy only uses Splash.
    expect(player.hp).toBe(maxHp - Math.floor(maxHp * 0.1));
  });

  test("Super Strain — takes 25% of the damage it deals as recoil", async () => {
    game.override
      .ability(ErAbilityId.SUPER_STRAIN as unknown as AbilityId)
      .moveset([MoveId.TACKLE])
      .enemySpecies(SpeciesId.CHANSEY);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const maxHp = player.getMaxHp();
    const enemyHpBefore = enemy.hp;

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");

    const dealt = enemyHpBefore - enemy.hp;
    expect(dealt).toBeGreaterThan(0);
    expect(player.hp).toBe(maxHp - Math.max(Math.floor(dealt * 0.25), 1));
  });

  test("Rage Point — taking a critical hit raises ATK and SPATK by 1", async () => {
    game.override
      .ability(ErAbilityId.RAGE_POINT as unknown as AbilityId)
      .moveset([MoveId.SPLASH])
      .enemyMoveset(MoveId.TACKLE)
      .enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.SNORLAX); // bulky enough to survive a crit
    const player = game.field.getPlayerPokemon();
    expect(player.getStatStage(Stat.ATK)).toBe(0);

    // Force the incoming enemy Tackle to crit the player.
    vi.spyOn(player, "getCriticalHitResult").mockReturnValueOnce(true);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(player.getStatStage(Stat.ATK)).toBe(1);
    expect(player.getStatStage(Stat.SPATK)).toBe(1);
  });
});
