/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — completion of five PARTIAL dex fixes (sub-clause each):
//   1. Ability 108 Forewarn — 80-BP always-hit Future Sight variant on entry.
//   2. Ability 138 Flare Boost — self-ignite (burn) in Eerie Fog.
//   3. Ability 184 Aerilate — Flying user's Flying moves +10% (ROM 1.1× ate boost).
//   4. Move 159 Sharpen — grants Cutthroat to a non-Cutthroat user.
//   5. Move 149 Psywave — subclass-aware strip so it's a real 40-BP special.
// Authoritative dex text: er-ability-rom-descriptions.ts / er-moves.ts.
// =============================================================================

import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { FOREWARN_FUTURE_SIGHT_ID } from "#data/elite-redux/init-elite-redux-vanilla-rebalance";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { FixedDamageAttr, RandomLevelDamageAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const CUTTHROAT_ABILITY_ID = ER_ID_MAP.abilities[743];

describe("ER dex-fix PARTIAL completion batch (Forewarn/Flare Boost/Aerilate/Sharpen/Psywave)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100);
  });

  // ===== 1. FOREWARN =========================================================
  it("Forewarn: registers a DISTINCT 80-BP always-hit Future Sight (real move stays 120/100)", () => {
    const variant = allMoves[FOREWARN_FUTURE_SIGHT_ID];
    expect(variant).toBeDefined();
    expect(variant.power).toBe(80);
    expect(variant.accuracy).toBe(-1); // -1 = bypasses the accuracy check → always connects
    expect(variant.category).toBe(MoveCategory.SPECIAL);

    // Regression: the real Future Sight is untouched (120 BP / 100 acc).
    const real = allMoves[MoveId.FUTURE_SIGHT];
    expect(real.power).toBe(120);
    expect(real.accuracy).toBe(100);
    expect(real.id).not.toBe(FOREWARN_FUTURE_SIGHT_ID);
  });

  it("Forewarn: casts the 80-BP Future Sight on entry; the delayed hit lands", async () => {
    game.override.ability(AbilityId.FOREWARN);
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM); // Psychic (STAB on the strike)
    const enemy = game.field.getEnemyPokemon();
    const fullHp = enemy.hp;

    // The player only ever Splashes, so the ONLY damage the enemy can take is the
    // Forewarn-scripted delayed strike that resolves ~2 turns after entry.
    for (let i = 0; i < 4; i++) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      if (enemy.hp < fullHp) {
        break;
      }
    }

    expect(enemy.hp).toBeLessThan(fullHp); // the always-hit delayed strike connected
  });

  // ===== 2. FLARE BOOST ======================================================
  it("Flare Boost: self-ignites (burn) on switch-in when Eerie Fog is already active", async () => {
    game.override.ability(AbilityId.FLARE_BOOST).weather(WeatherType.EERIE_FOG);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA); // Dark — burnable
    const player = game.field.getPlayerPokemon();
    expect(player.status?.effect).toBe(StatusEffect.BURN);
  });

  it("Flare Boost: self-ignites the instant Eerie Fog is set on-field", async () => {
    game.override.ability(AbilityId.FLARE_BOOST).weather(WeatherType.NONE);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const player = game.field.getPlayerPokemon();
    expect(player.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);

    // Weather change → PostWeatherChange hook → self-burn queued synchronously.
    game.scene.arena.trySetWeather(WeatherType.EERIE_FOG);
    expect(player.turnData.pendingStatus).toBe(StatusEffect.BURN);

    // …and it actually lands once the queued ObtainStatusEffectPhase resolves.
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.status?.effect).toBe(StatusEffect.BURN);
  });

  it("Flare Boost: does NOT self-burn with no fog (regression)", async () => {
    game.override.ability(AbilityId.FLARE_BOOST).weather(WeatherType.NONE);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const player = game.field.getPlayerPokemon();
    expect(player.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
  });

  // ===== 3. AERILATE =========================================================
  it("Aerilate: a Flying-type user's Flying move deals ~1.1× (the ROM ate boost)", async () => {
    game.override.ability(AbilityId.AERILATE).moveset(MoveId.GUST);
    await game.classicMode.startBattle(SpeciesId.PIDGEOT); // Normal/Flying
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = player
      .getMoveset()
      .find(m => m.moveId === MoveId.GUST)!
      .getMove();
    const params = { source: player, move, forcedRandomMultiplier: 1, isCritical: false } as const;

    const boosted = enemy.getAttackDamage(params).damage;
    // Swap to a no-op ability and re-measure: the only delta is Aerilate's 1.1×.
    player.setTempAbility(allAbilities[AbilityId.BALL_FETCH]);
    const control = enemy.getAttackDamage(params).damage;

    expect(boosted).toBeGreaterThan(control);
    expect(Math.abs(boosted - control * 1.1)).toBeLessThanOrEqual(1); // ±1 rounding
  });

  it("Aerilate: the ability carries both -ate branches (1.2× non-Flying, 1.1× Flying)", () => {
    const attrs = allAbilities[AbilityId.AERILATE].getAttrs("MovePowerBoostAbAttr");
    const mults = attrs.map(a => (a as unknown as { getHighHpMultiplier?: () => number }).getHighHpMultiplier?.());
    expect(mults).toContain(1.2);
    expect(mults).toContain(1.1);
  });

  // ===== 4. SHARPEN ==========================================================
  it("Sharpen: grants Cutthroat to a non-Cutthroat user (and still boosts a stat)", async () => {
    game.override.moveset(MoveId.SHARPEN).ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const player = game.field.getPlayerPokemon();
    expect(player.getAbility().id).not.toBe(CUTTHROAT_ABILITY_ID);

    game.move.select(MoveId.SHARPEN);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(player.getAbility().id).toBe(CUTTHROAT_ABILITY_ID);
    // Highest attacking stat (ATK for Mightyena) got raised.
    expect(player.getStatStage(Stat.ATK)).toBe(1);
  });

  it("Sharpen: Simple Beam's ability-change path is untouched (regression)", async () => {
    game.override.moveset(MoveId.SIMPLE_BEAM).ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const enemy = game.field.getEnemyPokemon();

    game.move.select(MoveId.SIMPLE_BEAM);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(enemy.getAbility().id).toBe(AbilityId.SIMPLE);
  });

  // ===== 5. PSYWAVE ==========================================================
  it("Psywave: is a real 40-BP special (no fixed-damage attr; keeps confuse)", () => {
    const psywave = allMoves[MoveId.PSYWAVE];
    expect(psywave.power).toBe(40);
    expect(psywave.category).toBe(MoveCategory.SPECIAL);
    // The RandomLevelDamageAttr (a FixedDamageAttr subclass) must be stripped.
    expect(psywave.getAttrs("FixedDamageAttr").length).toBe(0);
    expect(psywave.attrs.some(a => a instanceof RandomLevelDamageAttr)).toBe(false);
    expect(psywave.attrs.some(a => a instanceof FixedDamageAttr)).toBe(false);
    expect(psywave.getAttrs("ConfuseAttr").length).toBeGreaterThan(0);
  });

  it("Psywave: damage scales with the user's SpAtk (not a flat level roll)", async () => {
    game.override.moveset(MoveId.PSYWAVE);
    await game.classicMode.startBattle(SpeciesId.ALAKAZAM);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = player
      .getMoveset()
      .find(m => m.moveId === MoveId.PSYWAVE)!
      .getMove();
    const params = { source: player, move, forcedRandomMultiplier: 1, isCritical: false } as const;

    const base = enemy.getAttackDamage(params).damage;
    player.setStatStage(Stat.SPATK, 6); // +6 SpAtk must raise damage if the formula uses the stat
    const boosted = enemy.getAttackDamage(params).damage;

    expect(base).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(base);
  });
});
