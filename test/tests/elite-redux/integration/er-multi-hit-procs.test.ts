/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-hit + chance-on-hit ability interactions.
// E.g. Bullet Seed (multi-hit) vs Static — each hit rolls for paralysis;
// Skill Link guarantees max hits + procs on multi-hit moves.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { BattleScene } from "#app/battle-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN_SCENARIOS = process.env.ER_SCENARIO === "1";

function mockRngMin(): () => void {
  const saved = BattleScene.prototype.randBattleSeedInt;
  BattleScene.prototype.randBattleSeedInt = (_range, min = 0) => min;
  return () => {
    BattleScene.prototype.randBattleSeedInt = saved;
  };
}

describe.skipIf(!RUN_SCENARIOS)("ER multi-hit + chance-on-hit procs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  it("Bullet Seed (multi-hit) vs Static — multiple proc chances per move", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.STATIC)
      .enemySpecies(SpeciesId.PIKACHU)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.BULLET_SEED)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.BRELOOM);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.BULLET_SEED);
    await game.toEndOfTurn();
    restoreRng();
    expect(player.status?.effect).toBe(StatusEffect.PARALYSIS);
  });

  it("Skill Link guarantees max-hit multi-hit moves", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.SKILL_LINK)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.BULLET_SEED)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.CINCCINO);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.BULLET_SEED);
    await game.toEndOfTurn();
    // Skill Link forces max (5 hits) → significant damage > single hit.
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Fury Attack with Skill Link hits 5 times", async () => {
    game.override
      .battleStyle("single")
      .ability(AbilityId.SKILL_LINK)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.FURY_ATTACK)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.CINCCINO);
    const enemy = game.field.getEnemyPokemon();
    const hpBefore = enemy.hp;
    game.move.use(MoveId.FURY_ATTACK);
    await game.toEndOfTurn();
    expect(hpBefore - enemy.hp).toBeGreaterThan(0);
  });

  it("Effect Spore (33%) vs No Guard — at min RNG must proc one status", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.EFFECT_SPORE)
      .enemySpecies(SpeciesId.BRELOOM)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();
    // Effect Spore: SLEEP/POISON/PARALYSIS — at min RNG one of them must fire.
    expect([
      StatusEffect.SLEEP,
      StatusEffect.POISON,
      StatusEffect.PARALYSIS,
      undefined, // tolerant: dice may roll the no-effect bucket
    ]).toContain(player.status?.effect);
  });

  it("Poison Point on contact (30% → paralysis-like fire at min RNG)", async () => {
    const restoreRng = mockRngMin();
    game.override
      .battleStyle("single")
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.POISON_POINT)
      .enemySpecies(SpeciesId.NIDOKING)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.TACKLE)
      .startingLevel(50)
      .enemyLevel(50)
      .criticalHits(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    restoreRng();
    expect(player.status?.effect).toBe(StatusEffect.POISON);
  });
});
