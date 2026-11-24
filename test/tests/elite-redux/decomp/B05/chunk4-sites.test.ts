/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B05 chunk 4: what the shared L1 grid and L2 twin cannot see for the weather-tick, terrain-change and random-berry classes.
//   - the weather and terrain gates of PostWeatherLapseHealAbAttr, PostWeatherLapseDamageAbAttr and
//     PostTerrainChangeAddBattlerTagAttr are bound `legacy-closure` (requests R-B05-25 and R-B05-29), so L1 and L2 do not rebuild
//     those attrs. Here the ORIGINAL attr of every user is compared with a hand-built copy whose gate is a library IF tree set
//     through `gateOverride`, over all 13 weathers (or all terrains), hurt and unhurt: the override path works and, for the plain
//     cases, answers the same as the class's own rule;
//   - the two places where the library atoms differ from the class (a switched-off weather, a Clueless field) are asserted as
//     DIFFERENT on purpose: they are the reason for the requests;
//   - the berry class has no gate and IS rebuilt by L1; here its single random draw, its pool order and its simulated no-op are
//     checked for the original and the rebuild.
import { type AbAttr, PostTurnRandomBerryEffectAbAttr } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { ConditionNode } from "#data/elite-redux/ability-studio/vocabulary/composition-types";
import { TerrainType } from "#data/terrain";
import { Weather } from "#data/weather";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { WeatherType } from "#enums/weather-type";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { setTerrainOf, setWeatherOf } from "#test/tests/elite-redux/decomp/harness/world";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const ALL_WEATHERS: readonly WeatherType[] = Object.values(WeatherType).filter(
  (value): value is WeatherType => typeof value === "number",
);
const ALL_TERRAINS: readonly TerrainType[] = Object.values(TerrainType).filter(
  (value): value is TerrainType => typeof value === "number",
);

const nameOf = (table: Readonly<Record<string, string | number>>, value: number): string =>
  Object.keys(table).find(key => table[key] === value && Number.isNaN(Number(key)))!;

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

/** The library form of "one of the listed weathers is the arena weather": any of one `field.weather` atom each. */
function weatherGate(list: readonly WeatherType[]): ConditionNode {
  return { any: list.map(w => ({ block: "field.weather", params: { weather: nameOf(WeatherType, w) } })) };
}

describe("B05 chunk 4: weather tick, terrain change and random berry", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PostWeatherLapseHealAbAttr: the five users, original against a rebuild with the gate set by override (13 weathers, hurt and unhurt)", async () => {
    const world = await startWorld(phaserGame);
    const holder = globalScene.getPlayerPokemon()!;
    const module = declRegistry.get("PostWeatherLapseHealAbAttr")!;
    const users = usersOf("PostWeatherLapseHealAbAttr");
    expect(users.map(u => `${u.id}:${u.index}`).sort()).toEqual(["115:1", "44:0", "5632:4", "5953:1", "87:1"].sort());
    let fired = 0;
    for (const { id, index, name } of users) {
      const original = allAbilities[id].attrs[index] as AbAttr & { weatherTypes: WeatherType[]; healFactor: number };
      expect(original.healFactor, `${name} heals 1/8`).toBe(2);
      const params = readDeclParams(module, original);
      expect(params.sixteenths).toBe(2);
      const copy = buildAttr(module, params, { gate: weatherGate(original.weatherTypes) });
      expect(copy).not.toBe(original);
      expect(copy.constructor.name).toBe("PostWeatherLapseHealAbAttr");
      for (const weather of ALL_WEATHERS) {
        for (const hurt of [false, true]) {
          setWeatherOf(world.game, weather);
          holder.hp = hurt ? holder.getMaxHp() - 7 : holder.getMaxHp();
          const make = (simulated: boolean) => ({
            pokemon: holder,
            weather: world.game.scene.arena.weather,
            simulated,
          });
          const label = `${name} in ${String(weather)} (hurt ${hurt})`;
          const origCond = original.getCondition()!(holder);
          expect(copy.getCondition()!(holder), `${label}: the gate`).toBe(origCond);
          const can = original.canApply(make(false) as never);
          expect(copy.canApply(make(false) as never), `${label}: canApply`).toBe(can);
          expect(can, `${label}: canApply is exactly "not at full HP"`).toBe(hurt);
          if (origCond && can) {
            const seen: unknown[][][] = [[], []];
            [original, copy].forEach((attr, which) => {
              const spy = vi
                .spyOn(globalScene.phaseManager, "unshiftNew")
                .mockImplementation(((...args: unknown[]) => seen[which].push(args)) as never);
              attr.apply(make(false) as never);
              spy.mockRestore();
            });
            expect(seen[1], `${label}: apply`).toEqual(seen[0]);
            expect(seen[0].length).toBe(1);
            expect(seen[0][0][0]).toBe("PokemonHealPhase");
            // toDmgValue(maxHp / (16 / 2)) = maxHp / 8, rounded down
            expect(seen[0][0][2]).toBe(Math.max(1, Math.floor(holder.getMaxHp() / 8)));
            fired++;
          }
          // simulated: no phase at all, for both
          const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
          original.apply(make(true) as never);
          copy.apply(make(true) as never);
          expect(spy).not.toHaveBeenCalled();
          spy.mockRestore();
        }
      }
    }
    expect(fired).toBeGreaterThanOrEqual(5 * 2);
  }, 120000);

  it("PostWeatherLapseDamageAbAttr: Dry Skin, original against the override rebuild, plus the indirect-damage block", async () => {
    const world = await startWorld(phaserGame);
    const holder = globalScene.getPlayerPokemon()!;
    const module = declRegistry.get("PostWeatherLapseDamageAbAttr")!;
    const users = usersOf("PostWeatherLapseDamageAbAttr");
    // Solar Power is constructed with the class but the Elite Redux patch strips it again: Dry Skin is the only live user.
    expect(users.map(u => `${u.id}:${u.index}:${u.name}`)).toEqual(["87:0:Dry Skin"]);
    const original = allAbilities[87].attrs[0] as AbAttr & { weatherTypes: WeatherType[] };
    const params = readDeclParams(module, original);
    expect(params.sixteenths).toBe(2);
    const copy = buildAttr(module, params, { gate: weatherGate(original.weatherTypes) });
    let fired = 0;
    for (const weather of ALL_WEATHERS) {
      for (const blocked of [false, true]) {
        setWeatherOf(world.game, weather);
        const hasBlock = vi
          .spyOn(holder, "hasAbilityWithAttr")
          .mockImplementation(((name: string) => blocked && name === "BlockNonDirectDamageAbAttr") as never);
        const make = (simulated: boolean) => ({ pokemon: holder, weather: world.game.scene.arena.weather, simulated });
        const label = `Dry Skin in ${String(weather)} (indirect damage blocked ${blocked})`;
        const origCond = original.getCondition()!(holder);
        expect(copy.getCondition()!(holder), `${label}: the gate`).toBe(origCond);
        const can = original.canApply(make(false) as never);
        expect(copy.canApply(make(false) as never), `${label}: canApply`).toBe(can);
        expect(can).toBe(!blocked);
        if (origCond && can) {
          const results: { messages: unknown[]; damage: unknown[] }[] = [];
          for (const attr of [original, copy]) {
            const messages: unknown[] = [];
            const damage: unknown[] = [];
            const q = vi
              .spyOn(globalScene.phaseManager, "queueMessage")
              .mockImplementation(((m: unknown) => messages.push(m)) as never);
            const d = vi
              .spyOn(holder, "damageAndUpdate")
              .mockImplementation(((...a: unknown[]) => damage.push(a)) as never);
            attr.apply(make(false) as never);
            q.mockRestore();
            d.mockRestore();
            results.push({ messages, damage });
          }
          expect(results[1], `${label}: apply`).toEqual(results[0]);
          expect(results[0].messages.length).toBe(1);
          expect(results[0].damage).toEqual([
            [Math.max(1, Math.floor(holder.getMaxHp() / 8)), { result: expect.anything() }],
          ]);
          fired++;
        }
        // simulated: neither message nor damage
        const d = vi.spyOn(holder, "damageAndUpdate").mockImplementation((() => 0) as never);
        original.apply(make(true) as never);
        copy.apply(make(true) as never);
        expect(d).not.toHaveBeenCalled();
        hasBlock.mockRestore();
      }
    }
    expect(fired).toBe(2);
  }, 120000);

  it("weather gates: where the library atom differs from the class rule (the reason for R-B05-25)", async () => {
    const world = await startWorld(phaserGame);
    const holder = globalScene.getPlayerPokemon()!;
    const module = declRegistry.get("PostWeatherLapseHealAbAttr")!;
    const original = allAbilities[44].attrs[0] as AbAttr;
    const copy = buildAttr(module, readDeclParams(module, original), {
      gate: weatherGate([WeatherType.RAIN, WeatherType.HEAVY_RAIN]),
    });
    setWeatherOf(world.game, WeatherType.RAIN);
    expect(original.getCondition()!(holder)).toBe(true);
    expect(copy.getCondition()!(holder)).toBe(true);
    // Cloud Nine or Air Lock on the field: the class says no, field.weather (the bare arena weather) still says yes.
    vi.spyOn(Weather.prototype, "isEffectSuppressed").mockReturnValue(true);
    expect(original.getCondition()!(holder)).toBe(false);
    expect(copy.getCondition()!(holder)).toBe(true);
  }, 120000);

  it("PostTerrainChangeAddBattlerTagAttr: Quark Drive, original against the override rebuild over every terrain, with and without the tag", async () => {
    const world = await startWorld(phaserGame);
    const holder = globalScene.getPlayerPokemon()!;
    const module = declRegistry.get("PostTerrainChangeAddBattlerTagAttr")!;
    const users = usersOf("PostTerrainChangeAddBattlerTagAttr");
    expect(users.map(u => `${u.id}:${u.index}:${u.name}`)).toEqual(["282:1:Quark Drive"]);
    const original = allAbilities[282].attrs[1] as AbAttr & { terrainTypes: TerrainType[] };
    const params = readDeclParams(module, original);
    expect(params).toMatchObject({ tag: "QUARK_DRIVE", turns: 0, terrains: "ELECTRIC" });
    const copy = buildAttr(module, params, {
      gate: {
        any: original.terrainTypes.map(t => ({ block: "field.terrain", params: { terrain: nameOf(TerrainType, t) } })),
      },
    });
    let fired = 0;
    for (const terrain of ALL_TERRAINS) {
      for (const hasTag of [false, true]) {
        // The engine stores the terrain first, then dispatches it (arena.ts:714), so the arena terrain IS the passed one.
        setTerrainOf(world.game, terrain);
        holder.removeTag(BattlerTagType.QUARK_DRIVE);
        if (hasTag) {
          holder.addTag(BattlerTagType.QUARK_DRIVE, 0);
        }
        const make = (simulated: boolean) => ({ pokemon: holder, terrain, simulated });
        const label = `terrain ${String(terrain)} (already has the effect ${hasTag})`;
        const can = original.canApply(make(false) as never);
        expect(copy.canApply(make(false) as never), label).toBe(can);
        if (can) {
          const seen: unknown[][][] = [[], []];
          [original, copy].forEach((attr, which) => {
            const spy = vi
              .spyOn(holder, "addTag")
              .mockImplementation(((...args: unknown[]) => seen[which].push(args) && true) as never);
            attr.apply(make(false) as never);
            attr.apply(make(true) as never);
            spy.mockRestore();
          });
          expect(seen[1], `${label}: apply`).toEqual(seen[0]);
          expect(seen[0]).toEqual([[BattlerTagType.QUARK_DRIVE, 0]]);
          fired++;
        }
      }
    }
    holder.removeTag(BattlerTagType.QUARK_DRIVE);
    // fires for Electric Terrain only, and only without the effect
    expect(fired).toBe(1);
  }, 120000);

  it("terrain gate: where the library atom differs from the class rule (the reason for R-B05-29)", async () => {
    const world = await startWorld(phaserGame);
    const holder = globalScene.getPlayerPokemon()!;
    const module = declRegistry.get("PostTerrainChangeAddBattlerTagAttr")!;
    const original = allAbilities[282].attrs[1] as AbAttr;
    const copy = buildAttr(module, readDeclParams(module, original), {
      gate: { any: [{ block: "field.terrain", params: { terrain: "ELECTRIC" } }] },
    });
    setTerrainOf(world.game, TerrainType.ELECTRIC);
    holder.removeTag(BattlerTagType.QUARK_DRIVE);
    const params = { pokemon: holder, terrain: TerrainType.ELECTRIC, simulated: false };
    expect(original.canApply(params as never)).toBe(true);
    expect(copy.canApply(params as never)).toBe(true);
    // Clueless on the field: arena.terrainType reads NONE, the terrain the dispatch passes is still Electric.
    vi.spyOn(world.game.scene.arena, "isFieldEffectSuppressed").mockReturnValue(true);
    expect(original.canApply(params as never)).toBe(true);
    expect(copy.canApply(params as never)).toBe(false);
  }, 120000);

  it("PostTurnRandomBerryEffectAbAttr: one draw, the pool order is the index, the rebuild equals the original, simulated does nothing", async () => {
    await startWorld(phaserGame);
    const holder = globalScene.getPlayerPokemon()!;
    const module = declRegistry.get("PostTurnRandomBerryEffectAbAttr")!;
    expect(usersOf("PostTurnRandomBerryEffectAbAttr").map(u => `${u.id}:${u.index}:${u.name}`)).toEqual([
      "5591:0:Craving",
    ]);
    const original = allAbilities[5591].attrs[0] as PostTurnRandomBerryEffectAbAttr;
    const copy = recomposeAttr(module, original, 5591, 0) as PostTurnRandomBerryEffectAbAttr;
    expect(copy).not.toBe(original);
    const pool = original.getBerryPool()!;
    expect(pool.map(b => BerryType[b])).toEqual([
      "SITRUS",
      "LIECHI",
      "GANLON",
      "SALAC",
      "PETAYA",
      "APICOT",
      "LANSAT",
      "STARF",
    ]);
    expect(copy.getBerryPool()).toEqual(pool);
    expect(readDeclParams(module, original).berries).toBe("SITRUS,LIECHI,GANLON,SALAC,PETAYA,APICOT,LANSAT,STARF");

    const run = (attr: AbAttr, index: number, simulated: boolean) => {
      const draws: number[] = [];
      const phases: unknown[][] = [];
      const draw = vi.spyOn(holder, "randBattleSeedInt").mockImplementation(((range: number) => {
        draws.push(range);
        return index;
      }) as never);
      const phase = vi
        .spyOn(globalScene.phaseManager, "unshiftNew")
        .mockImplementation(((...args: unknown[]) => phases.push(args)) as never);
      const queued = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => {}) as never);
      attr.apply({ pokemon: holder, simulated } as never);
      draw.mockRestore();
      phase.mockRestore();
      queued.mockRestore();
      holder.removeTag(BattlerTagType.CRIT_BOOST);
      return { draws, phases };
    };
    for (let index = 0; index < pool.length; index++) {
      const a = run(original, index, false);
      const b = run(copy, index, false);
      // exactly one draw, over the pool size, and the first queued phase is the item animation
      expect(a.draws, `pool index ${index}`).toEqual([8]);
      expect(b.draws, `pool index ${index}`).toEqual([8]);
      expect(a.phases[0][0]).toBe("CommonAnimPhase");
      // Starf draws its own random stat with the global RNG, so only the phase names are compared for it
      if (pool[index] === BerryType.STARF) {
        expect(b.phases.map(p => p[0])).toEqual(a.phases.map(p => p[0]));
      } else {
        expect(b.phases).toEqual(a.phases);
      }
    }
    // simulated: no draw and no phase, for both
    for (const attr of [original, copy]) {
      const s = run(attr, 0, true);
      expect(s.draws).toEqual([]);
      expect(s.phases).toEqual([]);
    }
    // No pool at all: the draw is over every berry (11), the empty list reads back as "every berry".
    const all = buildAttr(module, { berries: "" }) as PostTurnRandomBerryEffectAbAttr;
    const legacy = new PostTurnRandomBerryEffectAbAttr();
    expect(all.getBerryPool()).toBeUndefined();
    expect(readDeclParams(module, legacy).berries).toBe("");
    expect(run(all, 4, false).draws).toEqual([11]);
    expect(run(legacy, 4, false).draws).toEqual([11]);
  }, 120000);
});
