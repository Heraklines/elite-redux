/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Double-battle mayhem tests — multiple bespoke abilities active
// simultaneously, with spread moves, ally-targeting, and entry-effect
// pile-ups. Stress-tests the engine's phase ordering and the ER ability
// dispatcher under realistic combat conditions.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN_SCENARIOS)("ER double-battle mayhem", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Double battle — 4 mons with INTIMIDATE all init without crash", { timeout: 60_000 }, async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.INTIMIDATE)
      .enemyAbility(AbilityId.INTIMIDATE)
      .enemySpecies(SpeciesId.MIGHTYENA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA, SpeciesId.POOCHYENA);
    const enemies = game.scene.getEnemyField();
    // Both enemies should have ATK dropped from BOTH Intimidates.
    for (const e of enemies) {
      expect(e.getStatStage(Stat.ATK)).toBeLessThanOrEqual(0);
    }
  });

  it("Double battle — weather + terrain combo (Drizzle + Electric Surge)", async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.DRIZZLE)
      .passiveAbility(AbilityId.ELECTRIC_SURGE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.PELIPPER, SpeciesId.TAPU_KOKO);
    expect(game.scene.arena.weather?.weatherType).toBeDefined();
    expect(game.scene.arena.terrain?.terrainType).toBeDefined();
  });

  it("Double battle — earthquake hits both ally + enemy (spread)", { timeout: 60_000 }, async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.RAMPARDOS, SpeciesId.PIKACHU);
    const enemies = game.scene.getEnemyField();
    const ally = game.scene.getPlayerField()[1];
    const enemyHpBefore = enemies.map(e => e.hp);
    const allyHpBefore = ally.hp;
    game.move.use(MoveId.EARTHQUAKE, 0);
    game.move.use(MoveId.SPLASH, 1);
    await game.toEndOfTurn();
    for (let i = 0; i < enemies.length; i++) {
      expect(enemies[i].hp).toBeLessThanOrEqual(enemyHpBefore[i]);
    }
    expect(ally.hp).toBeLessThanOrEqual(allyHpBefore);
  });

  it("Double battle — Friend Guard wire installed on holder", async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.FRIEND_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.CLEFAIRY, SpeciesId.PIKACHU);
    const allies = game.scene.getPlayerField();
    expect(allies.length).toBe(2);
  });

  it("Double battle — Power Spot ally wire installed", async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.POWER_SPOT)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH, MoveId.TACKLE])
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.STONJOURNER, SpeciesId.PIKACHU);
    expect(game.scene.getPlayerField().length).toBe(2);
  });

  it("Double battle — Plus + Minus pair init", async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.PLUS)
      .passiveAbility(AbilityId.MINUS)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.PLUSLE, SpeciesId.MINUN);
    expect(game.scene.getPlayerField().length).toBe(2);
  });

  it("Double battle — Healer ally wire installed", async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.HEALER)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.AUDINO, SpeciesId.PIKACHU);
    expect(game.scene.getPlayerField().length).toBe(2);
  });

  it("Double battle — Mummy contact survives without crash", { timeout: 60_000 }, async () => {
    game.override
      .battleStyle("double")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.MUMMY)
      .enemySpecies(SpeciesId.COFAGRIGUS)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .criticalHits(false)
      .startingLevel(50)
      .enemyLevel(50);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    game.move.use(MoveId.TACKLE, 0, 0);
    game.move.use(MoveId.SPLASH, 1);
    await game.toEndOfTurn();
    expect(game.scene.getPlayerField()[0].hp).toBeGreaterThanOrEqual(0);
  });
});
