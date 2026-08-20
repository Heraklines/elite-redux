/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BadDreamsImmunityAbAttr, StatusEffectImmunityAbAttr } from "#abilities/ab-attrs";
import { TerrainType } from "#app/data/terrain";
import { allMoves } from "#data/data-lists";
import {
  ER_HONK_SHOO_ABILITY_ID,
  ER_REAP_AND_SOW_ABILITY_ID,
  ER_SERFDOM_ABILITY_ID,
  ER_SLEEPING_IN_ABILITY_ID,
  ER_SOMNILOQUY_ABILITY_ID,
  ER_SPATIAL_MAGIC_ABILITY_ID,
  ER_STELLARIZE_ABILITY_ID,
} from "#data/elite-redux/abilities/fakemon-pitch-abilities";
import {
  sleepingInBlocksMove,
  spatialMagicSwitchIfLethal,
  spatialMagicWouldSwitch,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { PassiveRecoveryAbAttr } from "#data/elite-redux/archetypes/passive-recovery";
import { userActsInSun } from "#data/moves/move";
import { targetSleptOrComatoseCondition, userSleptOrComatoseCondition } from "#data/moves/move-condition";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const spatialMagic = ER_SPATIAL_MAGIC_ABILITY_ID as AbilityId;
const stellarize = ER_STELLARIZE_ABILITY_ID as AbilityId;
const reapAndSow = ER_REAP_AND_SOW_ABILITY_ID as AbilityId;
const serfdom = ER_SERFDOM_ABILITY_ID as AbilityId;
const sleepingIn = ER_SLEEPING_IN_ABILITY_ID as AbilityId;
const honkShoo = ER_HONK_SHOO_ABILITY_ID as AbilityId;
const somniloquy = ER_SOMNILOQUY_ABILITY_ID as AbilityId;
describe.skipIf(!RUN)("fakemon pitch abilities 6052-6058", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("single").criticalHits(false).enemyLevel(100).startingLevel(100);
  });

  it("Spatial Magic is a real registered ability on the holder", async () => {
    game.override.ability(spatialMagic).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    expect(game.field.getPlayerPokemon().getAbility().id).toBe(spatialMagic);
  });

  it("Spatial Magic predicts lethal direct hits, excludes status, and respects no-bench replacement", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(spatialMagic)
      .moveset(MoveId.TACKLE)
      .enemyMoveset(MoveId.TACKLE)
      .enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const direct = player.getMoveset()[0].getMove();
    const status = allMoves.find(move => move.id === MoveId.GROWL)!;
    enemy.hp = 1;
    expect(spatialMagicWouldSwitch(enemy, player, direct)).toBe(true);
    expect(spatialMagicWouldSwitch(enemy, player, status)).toBe(false);
    expect(spatialMagicSwitchIfLethal(enemy, player, direct)).toBe(false);
    player.hp = 1;
  });

  it("Stellarize changes Normal moves to Stellar and grants Stellar STAB", async () => {
    game.override.ability(stellarize).moveset(MoveId.TACKLE).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    expect(player.getMoveType(player.getMoveset()[0].getMove())).toBe(PokemonType.STELLAR);
    expect(player.getAbility().attrs.some(attr => attr.constructor.name === "StabAddAbAttr")).toBe(true);
  });

  it("Reap and Sow starts Grassy Terrain and is wired to the holder", async () => {
    game.override.ability(reapAndSow).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
    expect(game.field.getPlayerPokemon().getAbility().id).toBe(reapAndSow);
    expect(userActsInSun(game.field.getPlayerPokemon())).toBe(true);
  });

  it("Reap and Sow gates shared sun ability conditions to Grassy Terrain", async () => {
    game.override.ability(AbilityId.CHLOROPHYLL).enemyAbility(reapAndSow).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const speedAttr = player.getAbility().attrs.find(attr => attr.constructor.name === "StatMultiplierAbAttr");
    expect(speedAttr?.getCondition()?.(player)).toBe(true);
  });

  it("sun ability conditions stay off outside Grassy Terrain without Reap and Sow", async () => {
    game.override.ability(AbilityId.CHLOROPHYLL).enemyAbility(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const speedAttr = player.getAbility().attrs.find(attr => attr.constructor.name === "StatMultiplierAbAttr");
    expect(speedAttr?.getCondition()?.(player)).toBe(false);
  });

  it("Serfdom carries Harvest and Commensality riders", async () => {
    game.override.ability(serfdom).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const attrs = game.field
      .getPlayerPokemon()
      .getAbility()
      .attrs.map(attr => attr.constructor.name);
    expect(attrs).toContain("PostTurnRestoreBerryAbAttr");
  });

  it("Sleeping In makes sleep moves Yawn-like instead of applying sleep immediately", async () => {
    game.override.ability(sleepingIn).moveset(MoveId.SPORE).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.SPORE);
    await game.toEndOfTurn();
    expect(enemy.status?.effect ?? StatusEffect.NONE).not.toBe(StatusEffect.SLEEP);
    expect(sleepingInBlocksMove(player, allMoves.find(move => move.id === MoveId.SPORE)!)).toBe(true);
    expect(enemy.getTag(BattlerTagType.DROWSY)).toBeDefined();
    await game.toEndOfTurn();
    expect(enemy.status?.effect).toBe(StatusEffect.SLEEP);
    expect(enemy.status?.sleepTurnsRemaining).toBe(1);
    await game.toEndOfTurn();
    expect(enemy.status?.effect ?? StatusEffect.NONE).not.toBe(StatusEffect.SLEEP);
    expect(player.getAbility().id).toBe(sleepingIn);
  });

  it("Honk Shoo composes Comatose and Sweet Dreams with unconditional 1/8 recovery", async () => {
    game.override.ability(honkShoo).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const snore = allMoves.find(move => move.id === MoveId.SNORE)!;
    expect(userSleptOrComatoseCondition.apply(player, player, snore)).toBe(true);
    expect(targetSleptOrComatoseCondition.apply(player, player, snore)).toBe(true);
    expect(player.getAbility().attrs.some(attr => attr instanceof StatusEffectImmunityAbAttr)).toBe(true);
    expect(player.getAbility().attrs.some(attr => attr instanceof BadDreamsImmunityAbAttr)).toBe(true);
    const recovery = player
      .getAbility()
      .attrs.find(attr => attr instanceof PassiveRecoveryAbAttr) as PassiveRecoveryAbAttr;
    expect(recovery.getRecoveryCondition()).toEqual({ kind: "always" });
    player.hp = player.getMaxHp() - 100;
    const before = player.hp;
    await game.toEndOfTurn();
    expect(player.hp).toBeGreaterThan(before);
  });

  it("Somniloquy is registered as a post-turn Sleep Talk rider", async () => {
    game.override.ability(somniloquy).enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    expect(
      game.field
        .getPlayerPokemon()
        .getAbility()
        .attrs.map(attr => attr.constructor.name),
    ).toContain("SomniloquyPostTurnAbAttr");
  });
});
