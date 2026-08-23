/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { BadDreamsImmunityAbAttr, StatusEffectImmunityAbAttr } from "#abilities/ab-attrs";
import { DrowsyTag, loadBattlerTag } from "#data/battler-tags";
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
import { StatusMove, userActsInSun } from "#data/moves/move";
import { targetSleptOrComatoseCondition, userSleptOrComatoseCondition } from "#data/moves/move-condition";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
    game.override.ability(spatialMagic).enemySpecies(SpeciesId.MEW);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    expect(game.field.getPlayerPokemon().getAbility().id).toBe(spatialMagic);
  });

  it("Spatial Magic predicts lethal direct hits, excludes status, and respects no-bench replacement", async () => {
    game.override
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(spatialMagic)
      .moveset(MoveId.TACKLE)
      .enemyMoveset(MoveId.TACKLE)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const direct = player.getMoveset()[0].getMove();
    const status = new StatusMove(MoveId.GROWL, PokemonType.NORMAL, 100, 40, -1, 0, 1);
    enemy.hp = 1;
    expect(spatialMagicWouldSwitch(enemy, player, direct)).toBe(true);
    expect(spatialMagicWouldSwitch(enemy, player, status)).toBe(false);
    game.scene.currentBattle.trainer = null;
    expect(spatialMagicSwitchIfLethal(enemy, player, direct)).toBe(false);
    player.hp = 1;
  });

  it("Stellarize changes Normal moves to Stellar and grants Stellar STAB", async () => {
    game.override.ability(stellarize).moveset(MoveId.TACKLE).enemySpecies(SpeciesId.MEW);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    expect(player.getMoveType(player.getMoveset()[0].getMove())).toBe(PokemonType.STELLAR);
    expect(player.getAbility().attrs.some(attr => attr.constructor.name === "StabAddAbAttr")).toBe(true);
  });

  it("Reap and Sow starts Grassy Terrain and is wired to the holder", async () => {
    game.override.ability(reapAndSow).enemySpecies(SpeciesId.MEW);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
    expect(game.field.getPlayerPokemon().getAbility().id).toBe(reapAndSow);
    expect(userActsInSun(game.field.getPlayerPokemon())).toBe(true);
  });

  it("Reap and Sow gates shared sun ability conditions to Grassy Terrain", async () => {
    game.override.ability(AbilityId.CHLOROPHYLL).enemyAbility(reapAndSow).enemySpecies(SpeciesId.MEW);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    expect(userActsInSun(player)).toBe(true);
  });

  it("suppressed Reap and Sow does not satisfy shared sun conditions", async () => {
    game.override.ability(AbilityId.CHLOROPHYLL).enemyAbility(reapAndSow).enemySpecies(SpeciesId.MEW);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    enemy.summonData.abilitySuppressed = true;
    expect(userActsInSun(player)).toBe(false);
  });

  it("sun ability conditions stay off outside Grassy Terrain without Reap and Sow", async () => {
    game.override.ability(AbilityId.CHLOROPHYLL).enemyAbility(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.MEW);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    expect(userActsInSun(player)).toBe(false);
  });

  it("Serfdom restores berries and shares adjacent berry consumption", async () => {
    game.override.ability(AbilityId.BALL_FETCH).enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.PIDGEY);
    const user = game.field.getPlayerPokemon();
    const ally = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.RATTATA), 100);
    game.field.mockAbility(ally, serfdom);
    vi.spyOn(user, "getAdjacentAllies").mockReturnValue([ally]);
    vi.spyOn(ally, "getActiveAbilitySources").mockReturnValue([{ ability: ally.getAbility(), passive: false }]);
    vi.spyOn(ally, "isActive").mockReturnValue(true);
    expect(user.getAdjacentAllies()).toEqual([ally]);
    expect(ally.isActive(true)).toBe(true);
    expect(ally.getActiveAbilitySources().some(source => source.ability.id === serfdom)).toBe(true);
    expect(ally.trySetStatus(StatusEffect.PARALYSIS)).toBe(true);
    user.recordEatenBerry(BerryType.LUM);
    expect(ally.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
    expect(ally.battleData.hasEatenBerry).toBe(true);
    expect(ally.getAbility().attrs.map(attr => attr.constructor.name)).toContain("PostTurnRestoreBerryAbAttr");
  });

  it("Sleeping In makes sleep moves Yawn-like instead of applying sleep immediately", async () => {
    game.override
      .ability(sleepingIn)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset([MoveId.SLEEP_POWDER, MoveId.SWORDS_DANCE])
      .enemyMoveset(MoveId.WATER_GUN)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const sleepMove = allMoves[MoveId.SLEEP_POWDER];
    expect(sleepMove.calculateBattleAccuracy(player, enemy)).toBe(100);
    game.move.use(MoveId.SLEEP_POWDER);
    await game.toEndOfTurn();
    expect(enemy.status?.effect ?? StatusEffect.NONE).not.toBe(StatusEffect.SLEEP);
    expect(sleepingInBlocksMove(player, sleepMove)).toBe(true);
    expect(sleepingInBlocksMove(player, allMoves[MoveId.TACKLE])).toBe(false);
    expect(enemy.getTag(BattlerTagType.DROWSY)).toBeDefined();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    await game.phaseInterceptor.to("ObtainStatusEffectPhase");
    expect(enemy.status?.effect).toBe(StatusEffect.SLEEP);
    expect(enemy.status?.sleepTurnsRemaining).toBe(2);
    expect(player.getAbility().id).toBe(sleepingIn);
    await game.phaseInterceptor.to("CommandPhase");
    const hpBeforeSleepTurn = player.hp;
    game.move.use(MoveId.SWORDS_DANCE);
    await game.toNextTurn();
    expect(player.hp).toBe(hpBeforeSleepTurn);
    expect(enemy.status?.effect).toBe(StatusEffect.SLEEP);
    game.move.use(MoveId.SWORDS_DANCE);
    await game.toNextTurn();
    expect(enemy.status?.effect ?? StatusEffect.NONE).not.toBe(StatusEffect.SLEEP);
    expect(player.hp).toBeLessThan(hpBeforeSleepTurn);
  });

  it("Sleeping In gives native Yawn a one-turn sleep after its normal delay", async () => {
    game.override
      .ability(sleepingIn)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset(MoveId.YAWN)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.YAWN);
    await game.toEndOfTurn();
    expect(enemy.status?.effect ?? StatusEffect.NONE).not.toBe(StatusEffect.SLEEP);
    expect(enemy.getTag(BattlerTagType.DROWSY)).toBeDefined();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();
    await game.phaseInterceptor.to("ObtainStatusEffectPhase");
    expect(enemy.status?.effect).toBe(StatusEffect.SLEEP);
    expect(enemy.status?.sleepTurnsRemaining).toBe(2);
  });

  it("Sleeping In's one-turn duration survives Drowsy tag serialization", () => {
    const drowsy = new DrowsyTag();
    drowsy.setSleepTurnsRemaining(2);
    const restored = loadBattlerTag({ ...drowsy });
    expect(restored).toBeInstanceOf(DrowsyTag);
    expect((restored as DrowsyTag).sleepTurnsRemaining).toBe(2);
  });

  it("Honk Shoo composes Comatose and Sweet Dreams with unconditional 1/8 recovery", async () => {
    game.override
      .ability(honkShoo)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.RATTATA);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    const player = game.field.getPlayerPokemon();
    const snore = allMoves[MoveId.SNORE];
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
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    await game.phaseInterceptor.to("PokemonHealPhase");
    expect(player.hp).toBeGreaterThan(before);
  });

  it("Somniloquy is registered as a post-turn Sleep Talk rider", async () => {
    game.override.ability(somniloquy).enemySpecies(SpeciesId.MEW);
    await game.classicMode.startBattle(SpeciesId.MISMAGIUS);
    expect(
      game.field
        .getPlayerPokemon()
        .getAbility()
        .attrs.map(attr => attr.constructor.name),
    ).toContain("SomniloquyPostTurnAbAttr");
  });
});
