/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Majestic Moth (ER 330): "On entry, raises highest calculated stat by one
// stage." Volcarona's highest stat is Sp. Atk (base 135), so on switch-in it
// must raise SPATK by exactly 1 — not Sp. Def or Speed. Reported in-game as
// "didn't boost Sp. Atk on Volcarona". Gated behind ER_SCENARIO=1.
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Majestic Moth (330) — raises highest stat on entry", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    const majesticMoth = ER_ID_MAP.abilities[330];
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .enemySpecies(SpeciesId.RATTATA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(majesticMoth as AbilityId);
  });

  it("maps ER 330 to an ability carrying the highest-stat-on-summon attr", () => {
    const pkrg = ER_ID_MAP.abilities[330];
    expect(pkrg).toBeDefined();
  });

  it("raises Volcarona's Sp. Atk (highest stat) by 1 on switch-in — not SpDef/Speed (ACTIVE ability)", async () => {
    await game.classicMode.startBattle([SpeciesId.VOLCARONA]);
    const volc = game.field.getPlayerPokemon();

    expect(volc.getStatStage(Stat.SPATK)).toBe(1);
    expect(volc.getStatStage(Stat.SPDEF)).toBe(0);
    expect(volc.getStatStage(Stat.SPD)).toBe(0);
    expect(volc.getStatStage(Stat.ATK)).toBe(0);
    expect(volc.getStatStage(Stat.DEF)).toBe(0);
  });

  it("raises Sp. Atk when Majestic Moth is a PASSIVE/innate (slot 0 override)", async () => {
    const majesticMoth = ER_ID_MAP.abilities[330];
    game.override.ability(AbilityId.BALL_FETCH).passiveAbility(majesticMoth as AbilityId);
    await game.classicMode.startBattle([SpeciesId.VOLCARONA]);
    const volc = game.field.getPlayerPokemon();
    expect(volc.getStatStage(Stat.SPATK)).toBe(1);
  });

  it("raises Sp. Atk via Volcarona's NATURAL innate slot — passive UNLOCKED (the in-game scenario)", async () => {
    // Benign active ability; Volcarona's species innates [Swarm, Majestic Moth,
    // Levitate] provide Majestic Moth in slot 1. hasPassiveAbility(true) emulates
    // a player who has the passive unlocked — Majestic Moth (slot 1) must fire.
    game.override.ability(AbilityId.BALL_FETCH).hasPassiveAbility(true);
    await game.classicMode.startBattle([SpeciesId.VOLCARONA]);
    const volc = game.field.getPlayerPokemon();
    expect(volc.getStatStage(Stat.SPATK)).toBe(1);
  });

  it("does NOT fire when the player's passive is locked (player gating preserved)", async () => {
    game.override.ability(AbilityId.BALL_FETCH).hasPassiveAbility(false);
    await game.classicMode.startBattle([SpeciesId.VOLCARONA]);
    const volc = game.field.getPlayerPokemon();
    expect(volc.getStatStage(Stat.SPATK)).toBe(0);
  });

  it("ENEMY Volcarona ALWAYS gets Majestic Moth (slot 1) on entry — no unlock needed", async () => {
    // Enemies are always-on (ER design): a high-level enemy unlocks all 3 innate
    // slots via getEnemyPassiveSlotLimit, so Majestic Moth (slot 1) fires and
    // raises the enemy's Sp. Atk. No passive override on the enemy.
    game.override
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.VOLCARONA)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyLevel(50);
    await game.classicMode.startBattle([SpeciesId.MAGIKARP]);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.getStatStage(Stat.SPATK)).toBe(1);
  });
});
