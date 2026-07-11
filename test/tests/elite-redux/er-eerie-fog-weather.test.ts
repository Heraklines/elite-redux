/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — the distinct EERIE_FOG weather (Fog Machine er 905).
//
// docs/er-custom-mechanics.md: Eerie Fog is a SEPARATE Ghost/Psychic weather,
// NOT vanilla FOG. It has NO accuracy debuff and four effects:
//   1. Each turn, non-Ghost/Psychic mons lose one POSITIVE stat stage (decay
//      toward +0; debuffs untouched).
//   2. Halves weather-based recovery (Moonlight etc.), like other non-Sun weather.
//   3. Ghost/Psychic defenders take 20% less move damage (x0.8).
//   4. All Curses become the Ghost-type Curse.
// Fog Machine (905) summons EERIE_FOG on being hit. The pre-existing fog-synergy
// hooks (Curse variant, Ominous Wind boost, etc.) must still fire under it.
// =============================================================================

import { Weather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { PlantHealAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Eerie Fog (distinct EERIE_FOG weather)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .weather(WeatherType.EERIE_FOG)
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.RATTATA)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50);
  });

  it("effect 1: a non-Ghost/Psychic mon loses one positive stage/turn (debuffs survive)", async () => {
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA); // Dark — not Ghost/Psychic
    const player = game.field.getPlayerPokemon();
    player.setStatStage(Stat.ATK, 2);
    player.setStatStage(Stat.SPD, 1);
    player.setStatStage(Stat.DEF, -1); // a debuff — Eerie Fog must NOT touch it

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(player.getStatStage(Stat.ATK)).toBe(1);
    expect(player.getStatStage(Stat.SPD)).toBe(0);
    expect(player.getStatStage(Stat.DEF)).toBe(-1);
  });

  it("effect 1: a Ghost/Psychic mon keeps its buffs in Eerie Fog", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY); // Ghost/Poison
    const player = game.field.getPlayerPokemon();
    player.setStatStage(Stat.ATK, 2);

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(player.getStatStage(Stat.ATK)).toBe(2);
  });

  it("effect 2: weather-based recovery (Moonlight/PlantHeal) is halved to 1/4 in Eerie Fog", async () => {
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const player = game.field.getPlayerPokemon();
    const heal = new PlantHealAttr();

    // 0.25× in fog vs 0.5× in clear weather — clearly a quarter, not a half.
    expect(heal.getWeatherHealRatio(WeatherType.EERIE_FOG, player)).toBe(0.25);
    expect(heal.getWeatherHealRatio(WeatherType.NONE, player)).toBe(0.5);
  });

  it("effect 3: a Psychic-type defender takes 20% less move damage (x0.8) in Eerie Fog", async () => {
    game.override.moveset(MoveId.TACKLE).enemySpecies(SpeciesId.RALTS).weather(WeatherType.NONE); // Psychic/Fairy
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const move = player
      .getMoveset()
      .find(m => m.moveId === MoveId.TACKLE)!
      .getMove();
    const params = { source: player, move, forcedRandomMultiplier: 1, isCritical: false } as const;

    game.scene.arena.weather = new Weather(WeatherType.EERIE_FOG, 8);
    const foggy = enemy.getAttackDamage(params).damage;
    game.scene.arena.weather = null;
    const clear = enemy.getAttackDamage(params).damage;

    // 0.8× is applied mid-pipeline (arena type multiplier), so allow ±1 rounding.
    expect(foggy).toBeLessThan(clear);
    expect(Math.abs(foggy - clear * 0.8)).toBeLessThanOrEqual(1);
  });

  it("effect 4: a non-Ghost user's Curse becomes the Ghost-type Curse in Eerie Fog", async () => {
    game.override.moveset(MoveId.CURSE);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA); // Dark — normally the stat-boost Curse
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const maxHp = player.getMaxHp();
    // Force the override to apply now so Curse resolves under Eerie Fog on turn 1.
    game.scene.arena.trySetWeather(WeatherType.EERIE_FOG);

    game.move.select(MoveId.CURSE);
    await game.phaseInterceptor.to("TurnEndPhase");

    // Ghost-variant Curse: user sacrifices ~half its HP and curses the enemy.
    expect(enemy.getTag(BattlerTagType.CURSED)).toBeDefined();
    expect(player.hp).toBeLessThanOrEqual(maxHp - Math.floor(maxHp / 2));
    // NOT the stat-boost Curse — Attack was not raised (fog buff-decay only trims positives).
    expect(player.getStatStage(Stat.ATK)).toBeLessThanOrEqual(0);
  });

  it("fog-synergy still fires: Shallow Grave (629) revives under EERIE_FOG", async () => {
    game.override
      .moveset(MoveId.SPLASH)
      .statusEffect(StatusEffect.POISON) // chips the holder to a non-attack KO at turn end
      .ability(ErAbilityId.SHALLOW_GRAVE as unknown as AbilityId)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(100)
      .enemyLevel(100);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.MAGIKARP);
    const holder = game.field.getPlayerPokemon();
    const maxHp = holder.getMaxHp();
    holder.hp = 1; // poison chip faints it at end of turn, under the EERIE_FOG override

    game.move.select(MoveId.SPLASH);
    game.doSelectPartyPokemon(1); // send out the next party member after the faint
    await game.toNextTurn();

    // The fog-gated deferred revive triggered under EERIE_FOG (not just vanilla FOG).
    expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.MAGIKARP);
    expect(holder.isFainted()).toBe(false);
    expect(holder.hp).toBe(Math.max(1, Math.floor(maxHp * 0.25)));
  });

  it("Fog Machine (905) summons EERIE_FOG when the holder is hit (not vanilla FOG)", async () => {
    game.override
      .weather(WeatherType.NONE)
      .ability(ErAbilityId.FOG_MACHINE as unknown as AbilityId)
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    expect(game.scene.arena.weather?.weatherType).toBe(WeatherType.EERIE_FOG);
    expect(game.scene.arena.weather?.weatherType).not.toBe(WeatherType.FOG);
  });
});
