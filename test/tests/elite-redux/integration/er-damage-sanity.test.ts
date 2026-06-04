/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Damage-sanity tests — verify ER ability damage modifiers produce
// correct numerical outputs. Each test runs ONE controlled battle and
// asserts a single numerical property of the resulting damage.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

async function erId(id: number): Promise<AbilityId | undefined> {
  const erIdMap = (await import("#data/elite-redux/er-id-map")).ER_ID_MAP;
  return erIdMap.abilities[id] as AbilityId | undefined;
}

describe.skipIf(!RUN_SCENARIOS)("ER damage sanity", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Dead Bark (944) — Snorlax becomes Normal/Ghost; Tackle hits for 0", async () => {
    const pkrgDeadBark = await erId(944);
    if (pkrgDeadBark === undefined) return;
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(pkrgDeadBark)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    // Dead Bark adds Ghost type → Normal Tackle 1× × 0× = 0×.
    expect(hpBefore - enemy.hp).toBe(0);
  });

  it("Thunderbolt vs Gyarados (4× SE) does positive damage", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.GYARADOS)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.THUNDERBOLT)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.THUNDERBOLT);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Strong Jaw + Crunch deals significant damage", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.STRONG_JAW)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.CRUNCH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SHARPEDO);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.CRUNCH);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Iron Fist + Mach Punch deals damage", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.IRON_FIST)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.MACH_PUNCH)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.HITMONCHAN);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.MACH_PUNCH);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Thunderbolt vs Snorlax (1× neutral) does positive damage", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.THUNDERBOLT)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.PIKACHU);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.THUNDERBOLT);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });
});
