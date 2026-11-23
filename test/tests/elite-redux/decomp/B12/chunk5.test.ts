/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 5 probes. The four weather classes. Every user is a legacy-closure today (the library has no atom for "one of these weathers is on AND its effects are
// not switched off", request R-B12-39), so the shared L1 and L2 have nothing to rebuild. These tests drive the classes themselves, on the live attr and on a fresh
// build, against the OLD formulas (copied from the code before the Tier B split):
//   * WeatherStatMultiplier: stat test first, then the weather test, for every stat, every weather and Cloud Nine; the short-circuit; the multiplier,
//   * WeatherTypeBoost: the move's type (after another ability changed it) and the weather, for every move of the game; a missing user; the multiplier,
//   * WeatherDamageReduction: the weather only (never the move), the rounding of the damage,
//   * WeatherGroundAirborne: `fire` for every move type, every matchup and every weather,
//   * the replaced gate (what staff will compose): the guards stay, the gate is what changes, the order is kept,
//   * the weather list codec, the bindings, the params read back from the live attrs, and a fresh build from them.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { formatWeatherList, parseWeatherList } from "#data/elite-redux/ability-studio/decl/B12/b12-chunk3-codecs";
import { requiredWeatherListCodec } from "#data/elite-redux/ability-studio/decl/B12/b12-chunk5-codecs";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { WeatherGroundAirborneAbAttr } from "#data/elite-redux/archetypes/weather-ground-airborne";
import { WeatherStatMultiplierAbAttr } from "#data/elite-redux/archetypes/weather-stat-multiplier";
import {
  WeatherDamageReductionAbAttr,
  WeatherTypeBoostAbAttr,
} from "#data/elite-redux/archetypes/weather-terrain-interaction";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { type AttrSite, allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder, toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

type AnyAttr = {
  canApply(params: never): boolean;
  apply(params: never): void;
  gateOverride: ((params: never) => boolean) | undefined;
  showAbility: boolean;
};

const WEATHER_CLASSES = [
  "WeatherStatMultiplierAbAttr",
  "WeatherTypeBoostAbAttr",
  "WeatherDamageReductionAbAttr",
  "WeatherGroundAirborneAbAttr",
] as const;

/** Every weather of the game, None first. */
const ALL_WEATHERS: readonly WeatherType[] = Object.values(WeatherType).filter(
  (value): value is WeatherType => typeof value === "number",
);

function sitesOf(className: string): AttrSite[] {
  return allAttrSites().filter(site => site.className === className);
}

function weathersOf(attr: unknown): readonly WeatherType[] {
  return (attr as { weathers: readonly WeatherType[] }).weathers;
}

/** The arena the old code read: `arena.weather` (null for none) with `isEffectSuppressed()` and `arena.weatherType`. */
function setWeather(weather: WeatherType, suppressed: boolean): void {
  const arena = globalScene.arena as unknown as { weather: unknown };
  arena.weather = weather === WeatherType.NONE ? null : { weatherType: weather, isEffectSuppressed: () => suppressed };
  vi.spyOn(globalScene.arena, "weatherType", "get").mockReturnValue(weather);
}

/** The OLD weather test of the three options-object classes (and of Ground): suppressed first, then the list. */
function oldWeatherTest(weathers: readonly WeatherType[], weather: WeatherType, suppressed: boolean): boolean {
  if (weather !== WeatherType.NONE && suppressed) {
    return false;
  }
  return weathers.includes(weather);
}

describe("B12 chunk 5: the weather classes", () => {
  let phaserGame: Phaser.Game;
  let savedWeather: unknown;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    (globalScene.arena as unknown as { weather: unknown }).weather = savedWeather ?? null;
    vi.restoreAllMocks();
  });

  it("the sites: 5 + 2 + 2 + 1 attrs, the live params read back as the notes say, every gate is a legacy-closure with a written reason", async () => {
    await startWorld(phaserGame);
    const counts: Record<string, number> = {};
    const seen: string[] = [];
    for (const className of WEATHER_CLASSES) {
      for (const site of sitesOf(className)) {
        counts[className] = (counts[className] ?? 0) + 1;
        const binding = getBinding(site.abilityId, site.attrIndex, "gate");
        if (className === "WeatherGroundAirborneAbAttr") {
          // Parked declaration (R-B12-40): no declaration, so no binding.
          expect(declRegistry.get(className)).toBeUndefined();
          expect(binding).toBeUndefined();
        } else {
          expect(binding?.spec, `${site.abilityName} must not be bound to a lookalike`).toBeUndefined();
          expect(binding?.legacyClosure?.reason).toContain("R-B12-39");
          const module = declRegistry.get(className)!;
          expect(module, `${className} declared`).toBeDefined();
          const params = readDeclParams(module, site.attr);
          seen.push(
            `${site.abilityId}:${site.attrIndex} ${className} ${Object.entries(params)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" ")}`,
          );
        }
      }
    }
    expect(counts).toEqual({
      WeatherStatMultiplierAbAttr: 5,
      WeatherTypeBoostAbAttr: 2,
      WeatherDamageReductionAbAttr: 2,
      WeatherGroundAirborneAbAttr: 1,
    });
    expect(seen.sort()).toEqual(
      [
        "5563:0 WeatherStatMultiplierAbAttr stat=SPD multiplier=1.5 weathers=Sun, Extremely harsh sunlight, Hail, Snow",
        "5331:0 WeatherStatMultiplierAbAttr stat=SPD multiplier=1.5 weathers=Fog, Eerie fog",
        "5503:0 WeatherStatMultiplierAbAttr stat=SPD multiplier=1.5 weathers=Sun, Extremely harsh sunlight",
        `5359:0 WeatherStatMultiplierAbAttr stat=EVA multiplier=${4 / 3} weathers=Fog, Eerie fog`,
        "5719:0 WeatherStatMultiplierAbAttr stat=SPDEF multiplier=1.5 weathers=Hail, Snow",
        "5296:0 WeatherTypeBoostAbAttr type=ROCK multiplier=1.5 weathers=Hail, Snow",
        "5296:1 WeatherTypeBoostAbAttr type=ICE multiplier=1.5 weathers=Sandstorm",
        "5021:0 WeatherDamageReductionAbAttr multiplier=0.5 weathers=Hail, Snow",
        "5167:0 WeatherDamageReductionAbAttr multiplier=0.65 weathers=Sandstorm",
      ].sort(),
    );
  });

  it("a fresh build from the live params is an equal attr: same class, same banner, same params, same behaviour with the original's gate", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    savedWeather = (globalScene.arena as unknown as { weather: unknown }).weather;
    for (const className of WEATHER_CLASSES.filter(name => name !== "WeatherGroundAirborneAbAttr")) {
      const module = declRegistry.get(className)!;
      for (const site of sitesOf(className)) {
        const original = site.attr as unknown as AnyAttr & { gate(params: never): boolean };
        const params = readDeclParams(module, site.attr);
        const copy = buildAttr(module, params, { gate: original.gate.bind(original) as never }) as unknown as AnyAttr;
        expect(copy).not.toBe(site.attr);
        expect(copy.constructor).toBe(original.constructor);
        expect(copy.showAbility).toBe(original.showAbility);
        expect(readDeclParams(module, copy as never)).toEqual(params);
        expect(weathersOf(copy)).toEqual(weathersOf(original));
        // The same answers over every weather, with and without Cloud Nine, for a hit of every kind the class reads.
        const move = allMoves[MoveId.TACKLE];
        const frame =
          className === "WeatherStatMultiplierAbAttr"
            ? {
                pokemon: holder,
                move,
                stat: (original as unknown as { stat: Stat }).stat,
                statVal: new NumberHolder(100),
              }
            : className === "WeatherTypeBoostAbAttr"
              ? {
                  pokemon: holder,
                  opponent: foe,
                  move: allMoves[MoveId.ROCK_SLIDE],
                  power: new NumberHolder(80),
                  simulated: false,
                }
              : { pokemon: holder, opponent: foe, move, damage: new NumberHolder(100), simulated: false };
        for (const weather of ALL_WEATHERS) {
          for (const suppressed of [false, true]) {
            setWeather(weather, suppressed);
            expect(copy.canApply(frame as never), `${site.abilityName} ${WeatherType[weather]} ${suppressed}`).toBe(
              original.canApply(frame as never),
            );
          }
        }
      }
    }
  });

  it("WeatherStatMultiplier: canApply is 'the stat is the chosen stat AND the weather is on and not switched off', for every stat, weather and Cloud Nine (live attr and a fresh build)", async () => {
    const { holder } = await startWorld(phaserGame);
    savedWeather = (globalScene.arena as unknown as { weather: unknown }).weather;
    const module = declRegistry.get("WeatherStatMultiplierAbAttr")!;
    const move = allMoves[MoveId.TACKLE];
    let trueCount = 0;
    for (const site of sitesOf("WeatherStatMultiplierAbAttr")) {
      const original = site.attr as unknown as AnyAttr & {
        gate(params: never): boolean;
        stat: Stat;
        multiplier: number;
      };
      const copy = buildAttr(module, readDeclParams(module, site.attr), {
        gate: original.gate.bind(original) as never,
      }) as unknown as AnyAttr;
      for (const stat of [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA]) {
        for (const weather of ALL_WEATHERS) {
          for (const suppressed of [false, true]) {
            setWeather(weather, suppressed);
            const expected = stat === original.stat && oldWeatherTest(weathersOf(original), weather, suppressed);
            const params = { pokemon: holder, move, stat, statVal: new NumberHolder(100), simulated: false } as never;
            const label = `${site.abilityName} ${Stat[stat]} ${WeatherType[weather]} suppressed=${suppressed}`;
            expect(original.canApply(params), label).toBe(expected);
            expect(copy.canApply(params), `${label} (fresh build)`).toBe(expected);
            trueCount += expected ? 1 : 0;
          }
        }
      }
      // The effect: the stat value is multiplied (4/3 and 1.5 exactly, no rounding).
      for (const attr of [original, copy]) {
        const statVal = new NumberHolder(120);
        attr.apply({ pokemon: holder, move, stat: original.stat, statVal, simulated: false } as never);
        expect(statVal.value).toBe(120 * original.multiplier);
      }
    }
    // 5 users x their weathers (4+2+2+2+2 = 12) x not suppressed.
    expect(trueCount).toBe(12);
  });

  it("WeatherStatMultiplier: the stat test runs first and the weather test only for the chosen stat (old short-circuit), and a replaced gate keeps the stat test", async () => {
    const { holder } = await startWorld(phaserGame);
    savedWeather = (globalScene.arena as unknown as { weather: unknown }).weather;
    const attr = new WeatherStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 1.5, weathers: [WeatherType.RAIN] });
    const move = allMoves[MoveId.TACKLE];
    const weatherSpy = vi.spyOn(attr, "isWeatherActive");
    setWeather(WeatherType.RAIN, false);
    expect(
      attr.canApply({ pokemon: holder, move, stat: Stat.ATK, statVal: new NumberHolder(1), simulated: false } as never),
    ).toBe(false);
    expect(weatherSpy).not.toHaveBeenCalled();
    expect(
      attr.canApply({ pokemon: holder, move, stat: Stat.SPD, statVal: new NumberHolder(1), simulated: false } as never),
    ).toBe(true);
    expect(weatherSpy).toHaveBeenCalledTimes(1);
    // A replaced gate (what a composed rule will set): the weather no longer matters, the chosen stat still does.
    (attr as unknown as AnyAttr).gateOverride = () => true;
    setWeather(WeatherType.NONE, false);
    expect(
      attr.canApply({ pokemon: holder, move, stat: Stat.SPD, statVal: new NumberHolder(1), simulated: false } as never),
    ).toBe(true);
    expect(
      attr.canApply({ pokemon: holder, move, stat: Stat.ATK, statVal: new NumberHolder(1), simulated: false } as never),
    ).toBe(false);
    (attr as unknown as AnyAttr).gateOverride = () => false;
    setWeather(WeatherType.RAIN, false);
    expect(
      attr.canApply({ pokemon: holder, move, stat: Stat.SPD, statVal: new NumberHolder(1), simulated: false } as never),
    ).toBe(false);
  });

  it("WeatherTypeBoost: canApply is 'the move's type is the type AND the weather is on and not switched off' for every move of the game, every weather and Cloud Nine; a missing user never counts", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    savedWeather = (globalScene.arena as unknown as { weather: unknown }).weather;
    const module = declRegistry.get("WeatherTypeBoostAbAttr")!;
    const moves = allMoves.filter(move => move !== undefined && move.id !== MoveId.NONE);
    let trueCount = 0;
    for (const site of sitesOf("WeatherTypeBoostAbAttr")) {
      const original = site.attr as unknown as AnyAttr & { gate(params: never): boolean; boostType: PokemonType };
      const copy = buildAttr(module, readDeclParams(module, site.attr), {
        gate: original.gate.bind(original) as never,
      }) as unknown as AnyAttr;
      for (const weather of ALL_WEATHERS) {
        for (const suppressed of [false, true]) {
          setWeather(weather, suppressed);
          const active = oldWeatherTest(weathersOf(original), weather, suppressed);
          for (const move of moves) {
            const expected = holder.getMoveType(move) === original.boostType && active;
            const params = {
              pokemon: holder,
              opponent: foe,
              move,
              power: new NumberHolder(80),
              simulated: false,
            } as never;
            const label = `${site.abilityName} ${MoveId[move.id]} ${WeatherType[weather]} suppressed=${suppressed}`;
            expect(original.canApply(params), label).toBe(expected);
            expect(copy.canApply(params), `${label} (fresh build)`).toBe(expected);
            trueCount += expected ? 1 : 0;
          }
        }
      }
      // A missing user (the old closure tested it before anything else).
      setWeather([...weathersOf(original)][0], false);
      const noUser = {
        pokemon: undefined,
        opponent: foe,
        move: allMoves[MoveId.ROCK_SLIDE],
        power: new NumberHolder(80),
        simulated: false,
      } as never;
      expect(original.canApply(noUser)).toBe(false);
      expect(copy.canApply(noUser)).toBe(false);
      // The effect: power x 1.5, unrounded.
      for (const attr of [original, copy]) {
        const power = new NumberHolder(85);
        attr.apply({ pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], power, simulated: false } as never);
        expect(power.value).toBe(85 * 1.5);
      }
    }
    expect(trueCount).toBeGreaterThan(40);
  });

  it("WeatherTypeBoost: the move's type is read AFTER another ability changed it, and the gate is one piece (a replaced gate takes the type and the weather away together)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    savedWeather = (globalScene.arena as unknown as { weather: unknown }).weather;
    const attr = new WeatherTypeBoostAbAttr({ weathers: [WeatherType.HAIL], type: PokemonType.ROCK, multiplier: 1.5 });
    const tackle = allMoves[MoveId.TACKLE];
    const params = {
      pokemon: holder,
      opponent: foe,
      move: tackle,
      power: new NumberHolder(40),
      simulated: false,
    } as never;
    setWeather(WeatherType.HAIL, false);
    expect(attr.canApply(params)).toBe(false);
    // Another ability turns the Tackle into a Rock move: now it counts.
    vi.spyOn(holder, "getMoveType").mockReturnValue(PokemonType.ROCK);
    expect(attr.canApply(params)).toBe(true);
    setWeather(WeatherType.HAIL, true);
    expect(attr.canApply(params)).toBe(false);
    // The parent's own constructor closure (what the class handed `super`) agrees with canApply.
    setWeather(WeatherType.HAIL, false);
    const closure = (attr as unknown as { condition: (p: unknown, d: unknown, m: unknown) => boolean }).condition;
    expect(closure(holder, foe, tackle)).toBe(true);
    setWeather(WeatherType.RAIN, false);
    expect(closure(holder, foe, tackle)).toBe(false);
    // A replaced gate answers for the whole old condition.
    (attr as unknown as AnyAttr).gateOverride = () => true;
    vi.spyOn(holder, "getMoveType").mockReturnValue(PokemonType.WATER);
    expect(attr.canApply(params)).toBe(true);
    // The three accessors the class always had.
    expect(attr.getWeathers()).toEqual([WeatherType.HAIL]);
    expect(attr.getBoostType()).toBe(PokemonType.ROCK);
    expect(attr.getMultiplier()).toBe(1.5);
  });

  it("WeatherDamageReduction: canApply is 'the weather is on and not switched off' and never looks at the move, for every weather and Cloud Nine; the damage is rounded like the parent", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    savedWeather = (globalScene.arena as unknown as { weather: unknown }).weather;
    const module = declRegistry.get("WeatherDamageReductionAbAttr")!;
    let trueCount = 0;
    for (const site of sitesOf("WeatherDamageReductionAbAttr")) {
      const original = site.attr as unknown as AnyAttr & { gate(params: never): boolean; reductionMultiplier: number };
      const copy = buildAttr(module, readDeclParams(module, site.attr), {
        gate: original.gate.bind(original) as never,
      }) as unknown as AnyAttr;
      for (const weather of ALL_WEATHERS) {
        for (const suppressed of [false, true]) {
          setWeather(weather, suppressed);
          const expected = oldWeatherTest(weathersOf(original), weather, suppressed);
          for (const moveId of [
            MoveId.TACKLE,
            MoveId.WATER_GUN,
            MoveId.EARTHQUAKE,
            MoveId.SPLASH,
            MoveId.SEISMIC_TOSS,
          ]) {
            const params = {
              pokemon: holder,
              opponent: foe,
              move: allMoves[moveId],
              damage: new NumberHolder(100),
              simulated: false,
            } as never;
            const label = `${site.abilityName} ${MoveId[moveId]} ${WeatherType[weather]} suppressed=${suppressed}`;
            expect(original.canApply(params), label).toBe(expected);
            expect(copy.canApply(params), `${label} (fresh build)`).toBe(expected);
            trueCount += expected ? 1 : 0;
          }
        }
      }
      for (const attr of [original, copy]) {
        for (const damage of [1, 2, 3, 57, 101, 999]) {
          const holderDamage = new NumberHolder(damage);
          attr.apply({
            pokemon: holder,
            opponent: foe,
            move: allMoves[MoveId.TACKLE],
            damage: holderDamage,
            simulated: false,
          } as never);
          expect(holderDamage.value).toBe(toDmgValue(damage * original.reductionMultiplier));
        }
      }
    }
    // Christmas Spirit (Hail, Snow) and Dune Terror (Sandstorm): 3 weathers x 5 moves, not suppressed.
    expect(trueCount).toBe(15);
  });

  it("WeatherDamageReduction: the constructor refuses what the old one refused", () => {
    expect(() => new WeatherDamageReductionAbAttr({ weathers: [WeatherType.HAIL], multiplier: 0 })).toThrow();
    expect(() => new WeatherDamageReductionAbAttr({ weathers: [WeatherType.HAIL], multiplier: 1.01 })).toThrow();
    expect(() => new WeatherDamageReductionAbAttr({ weathers: [], multiplier: 0.5 })).toThrow();
    expect(() => new WeatherTypeBoostAbAttr({ weathers: [], type: PokemonType.ROCK, multiplier: 1.5 })).toThrow();
    expect(
      () => new WeatherTypeBoostAbAttr({ weathers: [WeatherType.HAIL], type: PokemonType.ROCK, multiplier: 0 }),
    ).toThrow();
    expect(
      () => new WeatherStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 1.5, weathers: [WeatherType.NONE] }),
    ).toThrow();
    expect(
      () => new WeatherStatMultiplierAbAttr({ stat: Stat.SPD, multiplier: 0, weathers: [WeatherType.RAIN] }),
    ).toThrow();
  });

  it("WeatherGroundAirborne: fire() rewrites a 0 matchup of a Ground move to 1 in the listed weather and nothing else, for every move type, matchup, weather and Cloud Nine", async () => {
    await startWorld(phaserGame);
    savedWeather = (globalScene.arena as unknown as { weather: unknown }).weather;
    const site = sitesOf("WeatherGroundAirborneAbAttr")[0];
    expect(site.abilityName).toBe("Desert Spirit");
    const original = site.attr as unknown as WeatherGroundAirborneAbAttr;
    expect(weathersOf(original)).toEqual([WeatherType.SANDSTORM]);
    const fresh = new WeatherGroundAirborneAbAttr([...weathersOf(original)]);
    let rewrites = 0;
    for (const attr of [original, fresh]) {
      for (const weather of ALL_WEATHERS) {
        for (const suppressed of [false, true]) {
          setWeather(weather, suppressed);
          const active = weather !== WeatherType.NONE && !suppressed && weathersOf(attr).includes(weather);
          for (let type = PokemonType.NORMAL; type <= PokemonType.STELLAR; type++) {
            for (const start of [0, 0.25, 0.5, 1, 2, 4]) {
              const multi = new NumberHolder(start);
              attr.fire(type, multi);
              const expected = type === PokemonType.GROUND && start === 0 && active ? 1 : start;
              expect(
                multi.value,
                `${PokemonType[type]} x${start} ${WeatherType[weather]} suppressed=${suppressed}`,
              ).toBe(expected);
              rewrites += expected === start ? 0 : 1;
            }
          }
        }
      }
    }
    // One weather (Sandstorm), one type (Ground), one matchup (0), not suppressed: once per attr.
    expect(rewrites).toBe(2);
    // A replaced gate answers for the weather part only; the Ground and the immunity tests stay in fire().
    (fresh as unknown as AnyAttr).gateOverride = () => true;
    setWeather(WeatherType.NONE, false);
    const ground = new NumberHolder(0);
    fresh.fire(PokemonType.GROUND, ground);
    expect(ground.value).toBe(1);
    const water = new NumberHolder(0);
    fresh.fire(PokemonType.WATER, water);
    expect(water.value).toBe(0);
    const neutral = new NumberHolder(0.5);
    fresh.fire(PokemonType.GROUND, neutral);
    expect(neutral.value).toBe(0.5);
    // The default list is a sandstorm.
    expect(weathersOf(new WeatherGroundAirborneAbAttr())).toEqual([WeatherType.SANDSTORM]);
  });

  it("the weather list codec: plain words both ways, at least one weather, and every weather staff can name round-trips", () => {
    expect(requiredWeatherListCodec.toCtor("Hail, Snow")).toEqual([WeatherType.HAIL, WeatherType.SNOW]);
    expect(requiredWeatherListCodec.toCtor("fog,eerie fog")).toEqual([WeatherType.FOG, WeatherType.EERIE_FOG]);
    expect(() => requiredWeatherListCodec.toCtor("")).toThrow(/at least one weather/);
    expect(() => requiredWeatherListCodec.toCtor("Meteors")).toThrow(/not a weather/);
    expect(requiredWeatherListCodec.fromInstance([WeatherType.SUNNY, WeatherType.HARSH_SUN])).toBe(
      "Sun, Extremely harsh sunlight",
    );
    expect(requiredWeatherListCodec.fromInstance([])).toBeUndefined();
    expect(requiredWeatherListCodec.fromInstance(undefined)).toBeUndefined();
    expect(requiredWeatherListCodec.fromInstance([WeatherType.NONE])).toBeUndefined();
    const everyWeather = ALL_WEATHERS.filter(weather => weather !== WeatherType.NONE);
    const text = formatWeatherList(everyWeather)!;
    expect(parseWeatherList(text)).toEqual(everyWeather);
    expect(requiredWeatherListCodec.fromInstance(requiredWeatherListCodec.toCtor(text))).toBe(text);
  });

  it("the declarations refuse what the classes refuse (the setting ranges stay inside the constructor's)", () => {
    const stat = declRegistry.get("WeatherStatMultiplierAbAttr")!;
    const boost = declRegistry.get("WeatherTypeBoostAbAttr")!;
    const reduction = declRegistry.get("WeatherDamageReductionAbAttr")!;
    const gate = { gate: (() => true) as never };
    expect(() => buildAttr(stat, { multiplier: 0 }, gate)).toThrow();
    expect(() => buildAttr(boost, { multiplier: 0 }, gate)).toThrow();
    expect(() => buildAttr(reduction, { multiplier: 1.05 }, gate)).toThrow();
    expect(() => buildAttr(reduction, { weathers: "" }, gate)).toThrow();
    // The defaults build.
    for (const module of [stat, boost, reduction]) {
      expect(buildAttr(module, {}, gate)).toBeDefined();
    }
  });
});
