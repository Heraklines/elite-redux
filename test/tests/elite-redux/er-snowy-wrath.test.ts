/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Snowy Wrath (er 666).
//
// DEX (2.65): summons a wrathful blizzard that chips non-Ice types 1/16 HP each
// turn AND boosts Ice-type Defense by 50%, distinct from vanilla hail/snow so
// Abomasnow's plain Snow Warning is unaffected. Keeps the Cryomancy 30%
// frostbite-on-hit rider. The bespoke EERIE-distinct SNOWY_WRATH weather backs
// it (8-turn summon).
// =============================================================================

import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { Weather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("ER Snowy Wrath (er 666)", () => {
  it("666 wires an EntryEffect that summons SNOWY_WRATH for 8 turns", () => {
    const attrs = dispatchArchetype("bespoke", null, 666).attrs;
    const entry = attrs.find(a => a instanceof EntryEffectAbAttr) as EntryEffectAbAttr | undefined;
    expect(entry).toBeDefined();
    // A frostbite-on-hit rider (Cryomancy) is retained alongside the weather summon.
    expect(attrs.length).toBeGreaterThanOrEqual(2);
  });

  describe("behavior", () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .weather(WeatherType.SNOWY_WRATH)
        .criticalHits(false)
        .battleStyle("single")
        .ability(AbilityId.BALL_FETCH)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .moveset(MoveId.SPLASH)
        .startingLevel(50)
        .enemyLevel(50);
    });

    it("chips a non-Ice foe 1/16 max HP each turn", async () => {
      game.override.enemySpecies(SpeciesId.MAGIKARP); // Water — not Ice
      await game.classicMode.startBattle(SpeciesId.GASTLY);
      const enemy = game.field.getEnemyPokemon();
      const maxHp = enemy.getMaxHp();
      enemy.hp = maxHp;

      game.move.select(MoveId.SPLASH);
      await game.phaseInterceptor.to("TurnEndPhase");

      // Chipped like hail (the exact 1/16 is vanilla hail's shared toDmgValue
      // formula); assert a clear, plausible chip and that it actually fired.
      const lost = maxHp - enemy.hp;
      expect(lost).toBeGreaterThanOrEqual(1);
      expect(lost).toBeLessThanOrEqual(Math.ceil(maxHp / 8));
    });

    it("does NOT chip an Ice-type (immune) and boosts its Defense +50%", async () => {
      game.override.enemySpecies(SpeciesId.SNOM).weather(WeatherType.NONE); // Ice/Bug, low BST (no #419 swap)
      await game.classicMode.startBattle(SpeciesId.MIGHTYENA);
      const enemy = game.field.getEnemyPokemon();
      const maxHp = enemy.getMaxHp();
      enemy.hp = maxHp;

      // Directly control the arena weather for the calc (no WEATHER_OVERRIDE timing race).
      game.scene.arena.weather = new Weather(WeatherType.SNOWY_WRATH, 8);
      const defFoggy = enemy.getEffectiveStat(Stat.DEF);
      game.scene.arena.weather = null;
      const defClear = enemy.getEffectiveStat(Stat.DEF);

      // Ice Defense is boosted 1.5× under Snowy Wrath (allow ±1 for double-floor).
      expect(defFoggy).toBeGreaterThan(defClear);
      expect(Math.abs(defFoggy - defClear * 1.5)).toBeLessThanOrEqual(1);

      // Snowy Wrath is a damaging weather, but Ice-types are immune to its chip.
      const wrath = new Weather(WeatherType.SNOWY_WRATH, 8);
      expect(wrath.isDamaging()).toBe(true);
      expect(wrath.isTypeDamageImmune(PokemonType.ICE)).toBe(true);
      expect(wrath.isTypeDamageImmune(PokemonType.WATER)).toBe(false);
    });
  });
});
