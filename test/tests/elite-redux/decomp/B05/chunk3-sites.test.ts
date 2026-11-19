/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 chunk 3: what the shared L1 grid and L2 twin cannot see for the weather classes.
//   - the L1 grid only has four weathers (rain, sun, sandstorm, snow) and the L2 twin runs one weather per scenario; here every
//     one of the 13 weather types is swept, for every user of every class;
//   - the form classes are never in their busted form on the shared holder (Blissey), so the form index is swept directly;
//   - Frisk needs a foe that holds items;
//   - Weather.isEffectSuppressed (the engine query behind Cloud Nine) is not a dispatched moment.
// Every check compares the ORIGINAL attr of each user with its REBUILD (what a staff blueprint compiles to), and each "true"
// side is asserted to occur at least once so that an all-false comparison cannot pass.
import type { AbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { Weather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import type { GameManager } from "#test/framework/game-manager";
import { freshGame, startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId } from "#test/tests/elite-redux/decomp/harness/twin";
import { setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ALL_WEATHERS: readonly WeatherType[] = Object.values(WeatherType).filter(
  (value): value is WeatherType => typeof value === "number",
);

/** Every (ability id, attr index) of the live game whose attr is an instance of `className`. */
function usersOf(className: string): { id: number; index: number; name: string }[] {
  const users: { id: number; index: number; name: string }[] = [];
  for (const ability of allAbilities as (Ability | undefined)[]) {
    if (ability === undefined || ability.id >= 29000) {
      continue;
    }
    ability.attrs.forEach((attr, index) => {
      if (attr.constructor.name === className) {
        users.push({ id: ability.id, index, name: ability.name });
      }
    });
  }
  return users;
}

describe("B05 chunk 3: weather classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(unregisterShadows);

  const rebuilt = (className: string, id: number, index: number): AbAttr => {
    const module = declRegistry.get(className);
    expect(module, `${className} is declared`).toBeDefined();
    const original = allAbilities[id]?.attrs[index] as AbAttr;
    expect(original?.constructor.name, `ability ${id} attr ${index}`).toBe(className);
    return recomposeAttr(module!, original, id, index);
  };

  function shadowOf(abilityId: number, expectedRebuilt: number[]): number {
    const original = allAbilities[abilityId] as Ability;
    const shadowId = allocateShadowId();
    const result = rebuildAbility(original, shadowId, { registry: declRegistry });
    for (const index of expectedRebuilt) {
      expect(result.rebuilt, `${original.name} attr ${index} must be rebuilt`).toContain(index);
    }
    registerShadow(shadowId, result.ability);
    return shadowId;
  }

  // ---- BlockWeatherDamageAttr and SuppressWeatherEffectAbAttr ---------------------------------------------------

  it("BlockWeatherDamageAttr: every user's rebuild blocks exactly the weathers the original blocks (all 13 weathers, no weather, already cancelled)", async () => {
    await startWorld(phaserGame);
    const users = usersOf("BlockWeatherDamageAttr");
    expect(users.length).toBe(21);
    const blocked = new Map<string, WeatherType[]>();
    for (const { id, index, name } of users) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const copy = rebuilt("BlockWeatherDamageAttr", id, index);
      expect(copy, `${name} is rebuilt, not shared`).not.toBe(original);
      const seen: WeatherType[] = [];
      for (const weather of [null, ...ALL_WEATHERS]) {
        for (const already of [false, true]) {
          const make = () => ({
            pokemon: globalScene.getPlayerPokemon()!,
            weather: weather === null ? null : new Weather(weather, 5, 5),
            cancelled: new BooleanHolder(already),
          });
          const a = make();
          const b = make();
          const can = original.canApply(a as never);
          expect(copy.canApply(b as never), `${name} in ${String(weather)} (already ${already})`).toBe(can);
          if (can) {
            original.apply(a as never);
            copy.apply(b as never);
            expect(b.cancelled.value).toBe(a.cancelled.value);
            expect(a.cancelled.value).toBe(true);
            if (!already && weather !== null) {
              seen.push(weather);
            }
          }
        }
      }
      blocked.set(name, seen);
    }
    // Overcoat lists nothing and so blocks every weather; Sand Veil blocks only Sandstorm; a listed pair blocks two.
    expect(blocked.get("Overcoat")).toEqual([...ALL_WEATHERS]);
    expect(blocked.get("Sand Veil")).toEqual([WeatherType.SANDSTORM]);
    expect(blocked.get("Slush Rush")).toEqual([WeatherType.HAIL, WeatherType.SNOW]);
    expect(blocked.get("Guardian Coat")).toEqual([WeatherType.SANDSTORM, WeatherType.HAIL, WeatherType.SNOW]);
  });

  it("SuppressWeatherEffectAbAttr: the damage-tick dispatch answers the same for original and rebuild, for every weather", async () => {
    await startWorld(phaserGame);
    const users = usersOf("SuppressWeatherEffectAbAttr");
    expect(users.map(u => u.name).sort()).toEqual(["Air Lock", "Clueless", "Cloud Nine", "In the Clouds"].sort());
    const primal = [WeatherType.HEAVY_RAIN, WeatherType.HARSH_SUN, WeatherType.STRONG_WINDS];
    for (const { id, index, name } of users) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const copy = rebuilt("SuppressWeatherEffectAbAttr", id, index);
      for (const weather of [null, ...ALL_WEATHERS]) {
        for (const already of [false, true]) {
          const make = () => ({
            pokemon: globalScene.getPlayerPokemon()!,
            weather: weather === null ? null : new Weather(weather, 5, 5),
            cancelled: new BooleanHolder(already),
          });
          const a = make();
          const b = make();
          const can = original.canApply(a as never);
          expect(copy.canApply(b as never), `${name} in ${String(weather)}`).toBe(can);
          if (weather !== null && !already) {
            // canApply is `affectsImmutable || weather.isImmutable()`: Cloud Nine, Air Lock and In the Clouds (true) cancel every
            // weather, Clueless (false) cancels ONLY the three primal weathers here (which the damage tick never dispatches,
            // they do not hurt). The engine query isEffectSuppressed reads the flag the other way round (see the next test).
            expect(can, `${name} in ${WeatherType[weather]}`).toBe(name !== "Clueless" || primal.includes(weather));
          }
          if (can) {
            original.apply(a as never);
            copy.apply(b as never);
            expect(b.cancelled.value).toBe(a.cancelled.value);
          }
        }
      }
    }
  });

  it("SuppressWeatherEffectAbAttr: the engine query Weather.isEffectSuppressed gives the same answer for the original and the rebuilt ability, and none for a control", async () => {
    const answers = async (abilityId: number): Promise<boolean[]> => {
      const game: GameManager = freshGame(phaserGame);
      game.override
        .battleStyle("single")
        .moveset([MoveId.SPLASH])
        .ability(abilityId as AbilityId)
        .startingLevel(50)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(50)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH)
        .hasPassiveAbility(false)
        .enemyHasPassiveAbility(false);
      await game.classicMode.startBattle(SpeciesId.BLISSEY);
      const result: boolean[] = [];
      for (const weather of ALL_WEATHERS.filter(w => w !== WeatherType.NONE)) {
        setWeatherOf(game, weather);
        result.push(game.scene.arena.weather!.isEffectSuppressed());
      }
      return result;
    };
    const control = await answers(AbilityId.BALL_FETCH as number);
    expect(control.some(Boolean), "a holder without the flag suppresses nothing").toBe(false);
    for (const [id, index, name] of [
      [13, 0, "Cloud Nine"],
      [76, 0, "Air Lock"],
      [5162, 0, "Clueless"],
      [6020, 1, "In the Clouds"],
    ] as const) {
      const original = await answers(id);
      expect(original.some(Boolean), `${name} suppresses at least one weather`).toBe(true);
      // Every weather but NONE, in enum order; the three primal weathers are the only ones Clueless leaves alone.
      const expected = ALL_WEATHERS.filter(w => w !== WeatherType.NONE).map(
        w =>
          name !== "Clueless" || ![WeatherType.HEAVY_RAIN, WeatherType.HARSH_SUN, WeatherType.STRONG_WINDS].includes(w),
      );
      expect(original, `${name} suppresses ordinary weather, and primal weather only with the setting`).toEqual(
        expected,
      );
      const shadow = shadowOf(id, [index]);
      expect(await answers(shadow), name).toEqual(original);
    }
  });

  // ---- FriskAbAttr -----------------------------------------------------------------------------------------------

  it("FriskAbAttr: original and rebuild reveal the same items and say the same thing, nothing when simulated, no message for an empty foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const users = usersOf("FriskAbAttr");
    expect(users.map(u => u.name).sort()).toEqual(["Frisk", "Gleam Eyes"]);
    const stack = (name: string, id: string) => ({ type: { name, id } });
    for (const { id, index, name } of users) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const copy = rebuilt("FriskAbAttr", id, index);
      for (const [label, items] of [
        ["two items", [stack("Leftovers", "LEFTOVERS"), stack("Sitrus Berry", "BERRY")]],
        ["no item", []],
      ] as const) {
        for (const simulated of [false, true]) {
          const run = (attr: AbAttr) => {
            const spies = [
              vi.spyOn(foe, "getHeldItems").mockReturnValue(items as never),
              vi.spyOn(foe, "revealHeldItems").mockImplementation(() => {}),
              vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => {}),
            ];
            try {
              attr.apply({ pokemon: holder, simulated } as never);
              return { reveal: spies[1].mock.calls, message: spies[2].mock.calls.map(call => call[0]) };
            } finally {
              for (const spy of spies) {
                spy.mockRestore();
              }
            }
          };
          const a = run(original);
          const b = run(copy);
          expect(b, `${name}, ${label}, simulated ${simulated}`).toEqual(a);
          if (simulated) {
            expect(a.reveal, "nothing is revealed during a simulated check").toEqual([]);
            expect(a.message).toEqual([]);
          } else {
            expect(a.reveal.length, "every foe is revealed").toBeGreaterThan(0);
            expect(a.message.length, `${label}: a message only when the foe holds something`).toBe(
              items.length === 0 ? 0 : a.reveal.length,
            );
          }
        }
      }
    }
  });

  // ---- the weather-change moment ---------------------------------------------------------------------------------

  it("the weather the attr is TOLD equals the weather on the field when the engine dispatches (the premise of the weather gate bindings)", async () => {
    const game: GameManager = freshGame(phaserGame);
    game.override
      .battleStyle("single")
      .moveset([MoveId.SPLASH])
      .ability(281 as AbilityId) // Protosynthesis: its PostWeatherChange attr is evaluated at every change
      .startingLevel(50)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(50)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .hasPassiveAbility(false)
      .enemyHasPassiveAbility(false);
    await game.classicMode.startBattle(SpeciesId.BLISSEY);
    const holder = game.field.getPlayerPokemon();
    const pairs: [WeatherType, WeatherType][] = [];
    const proto = Object.getPrototypeOf(holder.getAbility().attrs[1]) as {
      gate: (p: { weather: WeatherType }) => boolean;
    };
    const gate = proto.gate;
    vi.spyOn(proto, "gate").mockImplementation(function (this: unknown, params: { weather: WeatherType }) {
      pairs.push([params.weather, globalScene.arena.weatherType]);
      return gate.call(this, params);
    });
    for (const weather of ALL_WEATHERS) {
      globalScene.arena.trySetWeather(weather === WeatherType.NONE ? WeatherType.RAIN : weather, holder);
      globalScene.arena.trySetWeather(WeatherType.NONE);
    }
    expect(pairs.length).toBeGreaterThan(10);
    for (const [told, onField] of pairs) {
      expect(onField, `told ${WeatherType[told]}`).toBe(told);
    }
  });

  it("IceFaceFormChangeAbAttr, FogRestoreDisguiseFormChangeAbAttr: original and rebuild agree for every form number and weather, and fire the same form change", async () => {
    const game: GameManager = (await startWorld(phaserGame)).game;
    const holder = game.field.getPlayerPokemon();
    const cases: [string, number, number, readonly WeatherType[]][] = [
      ["IceFaceFormChangeAbAttr", 248, 3, [WeatherType.HAIL, WeatherType.SNOW]],
      ["FogRestoreDisguiseFormChangeAbAttr", 209, 5, [WeatherType.FOG, WeatherType.EERIE_FOG]],
      ["FogRestoreDisguiseFormChangeAbAttr", 5396, 5, [WeatherType.FOG, WeatherType.EERIE_FOG]],
      ["FogRestoreDisguiseFormChangeAbAttr", 5396, 7, [WeatherType.FOG, WeatherType.EERIE_FOG]],
    ];
    for (const [className, id, index, firing] of cases) {
      const name = `${allAbilities[id].name} #${index}`;
      const original = allAbilities[id].attrs[index] as AbAttr;
      const copy = rebuilt(className, id, index);
      const fired: WeatherType[] = [];
      for (const formIndex of [0, 1, 2]) {
        holder.formIndex = formIndex;
        for (const weather of ALL_WEATHERS) {
          setWeatherOf(game, weather);
          for (const simulated of [false, true]) {
            const run = (attr: AbAttr) => {
              const trigger = vi.spyOn(globalScene, "triggerPokemonFormChange").mockImplementation(() => true);
              try {
                const params = { pokemon: holder, weather, simulated };
                const can = attr.canApply(params as never);
                if (can) {
                  attr.apply(params as never);
                }
                return { can, calls: trigger.mock.calls.length };
              } finally {
                trigger.mockRestore();
              }
            };
            const a = run(original);
            const b = run(copy);
            expect(b, `${name}, form ${formIndex}, ${WeatherType[weather]}, simulated ${simulated}`).toEqual(a);
            if (a.can && !simulated) {
              expect(a.calls).toBe(1);
              fired.push(weather);
            }
            if (a.can && simulated) {
              expect(a.calls, "nothing fires during a simulated check").toBe(0);
            }
          }
        }
      }
      // Only form 1 (the busted form) in the listed weathers fires, once per weather.
      expect(fired.sort(), name).toEqual([...firing].sort());
      holder.formIndex = 0;
    }
  });

  it("PostSummonFogRestoreDisguiseAbAttr: original and rebuild agree for every form number and field weather, and neither re-runs on a form change", async () => {
    const game: GameManager = (await startWorld(phaserGame)).game;
    const holder = game.field.getPlayerPokemon();
    const fired: WeatherType[] = [];
    for (const [id, index] of [
      [209, 6],
      [5396, 6],
      [5396, 8],
    ] as const) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const copy = rebuilt("PostSummonFogRestoreDisguiseAbAttr", id, index);
      expect((copy as unknown as { shouldActivateOnFormChange(): boolean }).shouldActivateOnFormChange()).toBe(false);
      expect((original as unknown as { shouldActivateOnFormChange(): boolean }).shouldActivateOnFormChange()).toBe(
        false,
      );
      for (const formIndex of [0, 1, 2]) {
        holder.formIndex = formIndex;
        for (const weather of ALL_WEATHERS) {
          setWeatherOf(game, weather);
          const run = (attr: AbAttr) => {
            const trigger = vi.spyOn(globalScene, "triggerPokemonFormChange").mockImplementation(() => true);
            try {
              const can = attr.canApply({ pokemon: holder, simulated: false } as never);
              if (can) {
                attr.apply({ pokemon: holder, simulated: false } as never);
              }
              return { can, calls: trigger.mock.calls.length };
            } finally {
              trigger.mockRestore();
            }
          };
          const a = run(original);
          const b = run(copy);
          expect(b, `ability ${id} #${index}, form ${formIndex}, ${WeatherType[weather]}`).toEqual(a);
          if (a.can) {
            fired.push(weather);
            expect(formIndex).toBe(1);
          }
        }
      }
      holder.formIndex = 0;
    }
    expect([...new Set(fired)].sort()).toEqual([WeatherType.FOG, WeatherType.EERIE_FOG].sort());
  });

  it("PostWeatherChangeAddBattlerTagAbAttr: original and rebuild agree for every weather and for a holder that can and cannot take the tag, and add the same tag", async () => {
    const game: GameManager = (await startWorld(phaserGame)).game;
    const holder = game.field.getPlayerPokemon();
    const original = allAbilities[281].attrs[1] as AbAttr;
    const copy = rebuilt("PostWeatherChangeAddBattlerTagAbAttr", 281, 1);
    const fired: WeatherType[] = [];
    for (const hasTag of [false, true]) {
      holder.removeTag(BattlerTagType.PROTOSYNTHESIS);
      for (const weather of ALL_WEATHERS) {
        setWeatherOf(game, weather);
        for (const simulated of [false, true]) {
          const run = (attr: AbAttr) => {
            const canAdd = vi.spyOn(holder, "canAddTag").mockImplementation(() => !hasTag);
            const add = vi.spyOn(holder, "addTag").mockImplementation(() => true);
            try {
              const params = { pokemon: holder, weather, simulated };
              const can = attr.canApply(params as never);
              if (can) {
                attr.apply(params as never);
              }
              return { can, adds: add.mock.calls };
            } finally {
              canAdd.mockRestore();
              add.mockRestore();
            }
          };
          const a = run(original);
          const b = run(copy);
          expect(b, `${WeatherType[weather]}, has tag ${hasTag}, simulated ${simulated}`).toEqual(a);
          if (a.can && !simulated) {
            expect(a.adds).toEqual([[BattlerTagType.PROTOSYNTHESIS, 0]]);
            fired.push(weather);
          }
        }
      }
    }
    expect([...new Set(fired)].sort()).toEqual([WeatherType.SUNNY, WeatherType.HARSH_SUN].sort());
  });

  it("PostWeatherChangeFormChangeAbAttr: original and rebuild pick the same arena call for Castform and Cherrim and do nothing for anyone else", async () => {
    const game: GameManager = (await startWorld(phaserGame)).game;
    const users = usersOf("PostWeatherChangeFormChangeAbAttr");
    expect(users.map(u => u.name).sort()).toEqual(["Flower Gift", "Forecast"]);
    const standIn = (speciesId: SpeciesId) => ({ species: { speciesId } }) as never;
    const seen = new Set<string>();
    for (const { id, index, name } of users) {
      const original = allAbilities[id].attrs[index] as AbAttr;
      const copy = rebuilt("PostWeatherChangeFormChangeAbAttr", id, index);
      for (const species of [SpeciesId.CASTFORM, SpeciesId.CHERRIM, SpeciesId.BLISSEY]) {
        for (const weather of ALL_WEATHERS) {
          setWeatherOf(game, weather);
          for (const simulated of [false, true]) {
            const run = (attr: AbAttr) => {
              const normal = vi
                .spyOn(globalScene.arena, "triggerWeatherBasedFormChangesToNormal")
                .mockImplementation(() => {});
              const follow = vi.spyOn(globalScene.arena, "triggerWeatherBasedFormChanges").mockImplementation(() => {});
              try {
                const params = { pokemon: standIn(species), weather, simulated };
                const can = attr.canApply(params as never);
                if (can) {
                  attr.apply(params as never);
                }
                return { can, toNormal: normal.mock.calls.length, follow: follow.mock.calls.length };
              } finally {
                normal.mockRestore();
                follow.mockRestore();
              }
            };
            const a = run(original);
            const b = run(copy);
            expect(b, `${name}, ${SpeciesId[species]}, ${WeatherType[weather]}, simulated ${simulated}`).toEqual(a);
            if (a.can && !simulated) {
              seen.add(`${name}:${a.toNormal === 1 ? "normal" : "follow"}`);
            }
            if (a.can) {
              expect(species, `${name} works only for its own species`).toBe(
                name === "Forecast" ? SpeciesId.CASTFORM : SpeciesId.CHERRIM,
              );
            }
          }
        }
      }
    }
    expect([...seen].sort()).toEqual([
      "Flower Gift:follow",
      "Flower Gift:normal",
      "Forecast:follow",
      "Forecast:normal",
    ]);
  });
});
