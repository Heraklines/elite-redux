/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 1 probes: only what the shared L1 grid and the L2 twin cannot see. Each test drives the ORIGINAL attr of a real
// ability and its REBUILD (recomposeAttr: a fresh instance made from the declaration) side by side:
//   1. weather forms on the field (Air Lock / Cloud Nine, and Forecast) need a real Castform;
//   2. an Elite Redux ailment that lives on a tag, not on `pokemon.status` (Natural Cure);
//   3. a second holder of the same primal weather (Primordial Sea), which the single-holder grid cannot reach.
import type { AbAttr } from "#abilities/ab-attrs";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import type { AbAttrBaseParams } from "#types/ability-types";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

function pair(abilityId: number, attrIndex: number, className: string): { original: AbAttr; rebuilt: AbAttr } {
  const original = liveAbility(abilityId).attrs[attrIndex];
  expect(original.constructor.name).toBe(className);
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  const rebuilt = recomposeAttr(module!, original, abilityId, attrIndex);
  expect(rebuilt).not.toBe(original);
  expect(rebuilt.constructor.name).toBe(className);
  return { original, rebuilt };
}

function params(pokemon: Pokemon, simulated = false): AbAttrBaseParams {
  return { pokemon, simulated } as AbAttrBaseParams;
}

describe("B04 chunk 1: states the grid cannot reach", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  async function start(
    setup: (game: GameManager) => void,
    ...species: SpeciesId[]
  ): Promise<{ game: GameManager; player: Pokemon[]; enemy: Pokemon[] }> {
    const game = freshGame(phaserGame);
    game.override
      .battleStyle(species.length > 1 ? "double" : "single")
      .moveset([MoveId.SPLASH])
      .startingLevel(100)
      .enemyLevel(30)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false);
    setup(game);
    await game.classicMode.startBattle(...species);
    return { game, player: game.scene.getPlayerField(), enemy: game.scene.getEnemyField() };
  }

  it("Air Lock: a Castform with Forecast on the field makes it apply, no weather form makes it stay quiet", async () => {
    // Castform with Forecast is the weather-form Pokemon; the attr under test only reads the field, so the holder of the
    // attr does not matter (the real Air Lock holder would be on the other side).
    const withCastform = await start(
      game =>
        game.override.ability(AbilityId.FORECAST).enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.CASTFORM,
    );
    const { original, rebuilt } = pair(AbilityId.AIR_LOCK, 2, "PostSummonWeatherSuppressedFormChangeAbAttr");
    const holder = withCastform.player[0];
    expect(original.canApply(params(holder))).toBe(true);
    expect(rebuilt.canApply(params(holder))).toBe(true);

    const without = await start(
      game =>
        game.override.ability(AbilityId.FORECAST).enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.BLISSEY,
    );
    expect(original.canApply(params(without.player[0]))).toBe(false);
    expect(rebuilt.canApply(params(without.player[0]))).toBe(false);
  });

  it("Cloud Nine: both of its entry attrs rebuild and agree with the original under rain", async () => {
    const world = await start(
      game =>
        game.override.ability(AbilityId.CLOUD_NINE).enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.BLISSEY,
    );
    const holder = world.player[0];
    const clear = pair(AbilityId.CLOUD_NINE, 1, "PostSummonClearWeatherAbAttr");
    for (const weather of [WeatherType.RAIN, WeatherType.HEAVY_RAIN, WeatherType.NONE]) {
      setWeatherOf(world.game, weather);
      const expected = weather !== WeatherType.NONE;
      expect(clear.original.canApply(params(holder)), `original, ${WeatherType[weather]}`).toBe(expected);
      expect(clear.rebuilt.canApply(params(holder)), `rebuilt, ${WeatherType[weather]}`).toBe(expected);
    }
  });

  it("Forecast: a Castform can take a weather form, a Blissey cannot", async () => {
    const { original, rebuilt } = pair(AbilityId.FORECAST, 1, "PostSummonFormChangeByWeatherAbAttr");
    const castform = await start(
      game =>
        game.override.ability(AbilityId.FORECAST).enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.CASTFORM,
    );
    // Every Castform weather form change is gated on the weather matching, so clear weather means no form change yet.
    expect(original.canApply(params(castform.player[0])), "clear sky, original").toBe(false);
    expect(rebuilt.canApply(params(castform.player[0])), "clear sky, rebuilt").toBe(false);
    setWeatherOf(castform.game, WeatherType.SUNNY);
    expect(original.canApply(params(castform.player[0])), "sun, original").toBe(true);
    expect(rebuilt.canApply(params(castform.player[0])), "sun, rebuilt").toBe(true);

    const blissey = await start(
      game =>
        game.override.ability(AbilityId.FORECAST).enemySpecies(SpeciesId.MAGIKARP).enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.BLISSEY,
    );
    expect(original.canApply(params(blissey.player[0]))).toBe(false);
    expect(rebuilt.canApply(params(blissey.player[0]))).toBe(false);
  });

  it("Natural Cure: a holder with only an ER ailment tag (Frostbite) is cured, a simulated call changes nothing", async () => {
    const world = await start(
      game =>
        game.override
          .ability(AbilityId.NATURAL_CURE)
          .enemySpecies(SpeciesId.MAGIKARP)
          .enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.BLISSEY,
    );
    const holder = world.player[0];
    const foe = world.enemy[0];
    const { original, rebuilt } = pair(AbilityId.NATURAL_CURE, 0, "PreSwitchOutResetStatusAbAttr");

    expect(holder.status ?? null).toBeNull();
    expect(original.canApply(params(holder)), "healthy holder, original").toBe(false);
    expect(rebuilt.canApply(params(holder)), "healthy holder, rebuilt").toBe(false);

    for (const [name, attr] of [
      ["original", original],
      ["rebuilt", rebuilt],
    ] as const) {
      holder.addTag(BattlerTagType.ER_FROSTBITE, 0, MoveId.NONE, foe.id);
      expect(holder.getTag(BattlerTagType.ER_FROSTBITE), `${name}: the tag landed`).toBeDefined();
      expect(holder.status ?? null, `${name}: no vanilla status, only the tag`).toBeNull();
      expect(attr.canApply(params(holder)), `${name}: tag-only ailment is enough`).toBe(true);

      attr.apply(params(holder, true));
      expect(holder.getTag(BattlerTagType.ER_FROSTBITE), `${name}: simulated apply keeps the tag`).toBeDefined();

      attr.apply(params(holder));
      expect(holder.getTag(BattlerTagType.ER_FROSTBITE), `${name}: apply clears the tag`).toBeUndefined();
      expect(attr.canApply(params(holder)), `${name}: nothing left to cure`).toBe(false);
    }
  });

  it("Regenerator: heals 33% of max HP (floor, at least 1) and only while hurt, original and rebuild equal", async () => {
    const world = await start(
      game =>
        game.override
          .ability(AbilityId.REGENERATOR)
          .enemySpecies(SpeciesId.MAGIKARP)
          .enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.BLISSEY,
    );
    const holder = world.player[0];
    const { original, rebuilt } = pair(AbilityId.REGENERATOR, 0, "PreSwitchOutHealAbAttr");
    const max = holder.getMaxHp();
    holder.hp = max;
    expect(original.canApply(params(holder))).toBe(false);
    expect(rebuilt.canApply(params(holder))).toBe(false);
    for (const attr of [original, rebuilt]) {
      holder.hp = 1;
      expect(attr.canApply(params(holder))).toBe(true);
      attr.apply(params(holder, true));
      expect(holder.hp, "simulated apply heals nothing").toBe(1);
      attr.apply(params(holder));
      expect(holder.hp).toBe(Math.min(max, 1 + Math.max(Math.floor(max * 0.33), 1)));
    }
  });

  it("Primordial Sea: another holder on the field keeps the weather, so only the last one ends it", async () => {
    // Wave 1 is always a single battle, so start at wave 2 to get two holders on the field.
    const world = await start(
      game =>
        game.override
          .startingWave(2)
          .ability(AbilityId.PRIMORDIAL_SEA)
          .enemySpecies(SpeciesId.MAGIKARP)
          .enemyAbility(AbilityId.BALL_FETCH),
      SpeciesId.BLISSEY,
      SpeciesId.CHANSEY,
    );
    const [first, second] = world.player;
    const { original, rebuilt } = pair(AbilityId.PRIMORDIAL_SEA, 2, "PreLeaveFieldClearWeatherAbAttr");
    const results: boolean[] = [];

    setWeatherOf(world.game, WeatherType.HEAVY_RAIN);
    for (const attr of [original, rebuilt]) {
      const withPartner = attr.canApply(params(first));
      expect(withPartner, "a second holder is still on the field").toBe(false);
      results.push(withPartner);
    }

    second.hp = 0;
    for (const attr of [original, rebuilt]) {
      const alone = attr.canApply(params(first));
      expect(alone, "the partner fainted, I am the last holder").toBe(true);
      results.push(alone);
    }

    setWeatherOf(world.game, WeatherType.RAIN);
    for (const attr of [original, rebuilt]) {
      expect(attr.canApply(params(first)), "a different weather is not mine to end").toBe(false);
    }
    expect(results).toEqual([false, false, true, true]);
  });
});
