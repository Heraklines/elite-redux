/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4, the four Tier B classes: PostDefendHpGatedSelfTagAbAttr, PostFaintDeferredReviveAbAttr, PostFaintDetonateAbAttr and
// PostSummonClearTerrainAbAttr. The shared L1 grid has no max HP of 1, no terrain object that is None, no armed-turn memory and no
// Damp, so this test drives canApply of
//   (a) the FROZEN original rule, written here from the source as it was before the split,
//   (b) the refactored class (guards && gate && residual),
//   (c) the REBUILD: for Shallow Grave the exact library tree of its gate, for every other user the class gate as a stand-in (every gate is a
//       written legacy binding, so no library tree is bound),
// over the states above and compares them.
import { globalScene } from "#app/global-scene";
import { getBinding, normalizeBindingSpec } from "#data/elite-redux/ability-studio/bindings";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { crossedBelow } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { WeatherType } from "#enums/weather-type";
import { rebuildWithClassGate } from "#test/tests/elite-redux/decomp/B10/rebuild-with-class-gate";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const moduleOf = (name: string): DeclModule => declRegistry.get(name) as DeclModule;
const sitesOf = (name: string) => allAttrSites().filter(site => site.className === name);
type Any = Record<string, any>; // biome-ignore lint/suspicious/noExplicitAny: reads private fields of the attrs under test

/** The exact library form of the Shallow Grave gate (the binding stays legacy until L1 can drive the trigger, request R-B10-c4-12). */
const SHALLOW_GRAVE_GATE = normalizeBindingSpec({
  any: [
    { id: "field.weather", weather: "FOG" },
    { id: "field.weather", weather: "EERIE_FOG" },
  ],
}) as never;

describe("B10 chunk 4: the gates of the four Tier B classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every user has the expected number of attrs and a written legacy gate binding", async () => {
    await startWorld(phaserGame);
    const counts: Record<string, number> = {
      PostDefendHpGatedSelfTagAbAttr: 1,
      PostFaintDeferredReviveAbAttr: 2,
      PostFaintDetonateAbAttr: 4,
      PostSummonClearTerrainAbAttr: 3,
    };
    for (const [name, count] of Object.entries(counts)) {
      const sites = sitesOf(name);
      expect(sites.length, name).toBe(count);
      for (const site of sites) {
        const binding = getBinding(site.abilityId, site.attrIndex, "gate");
        expect(binding, `${site.abilityName} ${name}`).toBeDefined();
        // Every gate is a written legacy binding (the reasons are in bindings.ts and requests/B10.md).
        expect(binding?.legacyClosure, `${site.abilityName} is legacy`).toBeDefined();
      }
    }
    expect(
      sitesOf("PostFaintDeferredReviveAbAttr")
        .map(site => site.abilityName)
        .sort(),
    ).toEqual(["Backup Power", "Shallow Grave"]);
  });

  it("No Turning Back: frozen original and class agree over every HP, damage, max HP, move category and tag state", async () => {
    await startWorld(phaserGame);
    const [site] = sitesOf("PostDefendHpGatedSelfTagAbAttr");
    const frozen = (a: Any, p: Any): boolean => {
      if (p.move.category === MoveCategory.STATUS) {
        return false;
      }
      const t = Math.max(Math.floor(p.pokemon.getMaxHp() * a.hpGate), 1);
      return p.pokemon.hp <= t && p.pokemon.hp + p.damage > t && p.pokemon.getTag(a.tagType) === undefined;
    };
    let checked = 0;
    for (const maxHp of [1, 2, 3, 100, 101]) {
      for (let hp = 0; hp <= maxHp; hp++) {
        for (const damage of [0, 1, 2, Math.floor(maxHp / 2), maxHp, maxHp * 2]) {
          for (const category of [MoveCategory.PHYSICAL, MoveCategory.SPECIAL, MoveCategory.STATUS]) {
            for (const tagged of [false, true]) {
              const pokemon = { hp, getMaxHp: () => maxHp, getTag: () => (tagged ? {} : undefined) };
              const params = { pokemon, move: { category }, damage, simulated: false } as never;
              expect(site.attr.canApply(params), `${maxHp}/${hp} dmg ${damage} cat ${category} tag ${tagged}`).toBe(
                frozen(site.attr as Any, params as Any),
              );
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("No Turning Back: the library floor-half crossing differs only at max HP 1, which is why the gate is a legacy binding", async () => {
    await startWorld(phaserGame);
    const [site] = sitesOf("PostDefendHpGatedSelfTagAbAttr");
    const differs: string[] = [];
    for (const maxHp of [1, 2, 3, 4, 5, 10, 99, 100, 101]) {
      for (let hp = 0; hp <= maxHp; hp++) {
        for (const damage of [1, 2, 3, maxHp, maxHp + 5]) {
          const pokemon = { hp, getMaxHp: () => maxHp, getTag: () => undefined };
          const params = { pokemon, move: { category: MoveCategory.PHYSICAL }, damage, simulated: false } as never;
          const classSays = site.attr.canApply(params);
          const atomSays = crossedBelow(pokemon as never, damage, 0.5, "floor-half");
          if (classSays !== atomSays) {
            differs.push(`max ${maxHp} hp ${hp} damage ${damage}`);
          }
        }
      }
    }
    expect(differs.length).toBeGreaterThan(0);
    expect(differs.every(entry => entry.startsWith("max 1 "))).toBe(true);
  });

  it("No Turning Back: canApply has no fainted check (hp 0 and a big hit still passes) and apply adds the tag with the holder as source", async () => {
    const { holder } = await startWorld(phaserGame);
    const [site] = sitesOf("PostDefendHpGatedSelfTagAbAttr");
    const pokemon = { hp: 0, getMaxHp: () => 100, getTag: () => undefined };
    expect(site.attr.canApply({ pokemon, move: { category: MoveCategory.PHYSICAL }, damage: 60 } as never)).toBe(true);
    const addTag = vi.spyOn(holder, "addTag").mockReturnValue(true);
    site.attr.apply({ pokemon: holder, simulated: true } as never);
    expect(addTag).not.toHaveBeenCalled();
    site.attr.apply({ pokemon: holder, simulated: false } as never);
    expect(addTag).toHaveBeenCalledWith(BattlerTagType.NO_RETREAT, 0, undefined, holder.id);
  });

  it("Deferred revive: frozen original, class and (Shallow Grave) rebuild agree over every weather, terrain and latch state", async () => {
    const { holder } = await startWorld(phaserGame);
    const arena = globalScene.arena as Any;
    const savedWeather = arena.weather;
    const savedTerrain = arena.terrain;
    const weathers: (WeatherType | undefined)[] = [
      undefined,
      ...Object.values(WeatherType).filter(v => typeof v === "number"),
    ] as never;
    const terrains: (TerrainType | undefined)[] = [
      undefined,
      ...Object.values(TerrainType).filter(v => typeof v === "number"),
    ] as never;
    for (const site of sitesOf("PostFaintDeferredReviveAbAttr")) {
      const a = site.attr as Any;
      // Shallow Grave: the exact library form of its gate; Backup Power: the class's own gate as a stand-in.
      const rebuilt =
        site.abilityName === "Shallow Grave"
          ? recomposeAttr(moduleOf("PostFaintDeferredReviveAbAttr"), site.attr, site.abilityId, site.attrIndex, {
              conds: { gate: SHALLOW_GRAVE_GATE },
            })
          : rebuildWithClassGate(moduleOf("PostFaintDeferredReviveAbAttr"), site.attr, site.abilityId, site.attrIndex);
      const frozen = (): boolean => {
        // (the latch clause is tested separately below: it needs the real apply to set it)
        if (a.requireWeather !== null) {
          const w = arena.weather?.weatherType;
          if (w === undefined || !a.requireWeather.includes(w)) {
            return false;
          }
        }
        if (a.requireTerrain !== null) {
          const t = arena.terrain?.terrainType ?? TerrainType.NONE;
          if (!a.requireTerrain.includes(t)) {
            return false;
          }
        }
        return true;
      };
      let trues = 0;
      for (const weather of weathers) {
        for (const terrain of terrains) {
          arena.weather = weather === undefined ? undefined : { weatherType: weather };
          arena.terrain = terrain === undefined ? undefined : { terrainType: terrain };
          const params = { pokemon: holder, simulated: false } as never;
          const want = frozen();
          expect(a.canApply(params), `${site.abilityName} class w${String(weather)} t${String(terrain)}`).toBe(want);
          expect(rebuilt.canApply(params), `${site.abilityName} rebuild w${String(weather)} t${String(terrain)}`).toBe(
            want,
          );
          trues += want ? 1 : 0;
        }
      }
      expect(trues, site.abilityName).toBeGreaterThan(0);
    }
    arena.weather = savedWeather;
    arena.terrain = savedTerrain;
  });

  it("Deferred revive: the per-battle latch blocks the second arming in the original and in the rebuild; a preview arms nothing", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const arena = globalScene.arena as Any;
    const savedWeather = arena.weather;
    arena.weather = { weatherType: WeatherType.FOG };
    const [site] = sitesOf("PostFaintDeferredReviveAbAttr").filter(s => s.abilityName === "Shallow Grave");
    const rebuilt = recomposeAttr(
      moduleOf("PostFaintDeferredReviveAbAttr"),
      site.attr,
      site.abilityId,
      site.attrIndex,
      {
        conds: { gate: SHALLOW_GRAVE_GATE },
      },
    );
    const { erDeferredReviveState } = await import("#data/elite-redux/archetypes/post-faint-deferred-revive");
    for (const [label, attr, who] of [
      ["original", site.attr, holder],
      ["rebuild", rebuilt, foe],
    ] as const) {
      const params = { pokemon: who, simulated: false } as never;
      expect(attr.canApply(params), `${label} before`).toBe(true);
      attr.apply({ pokemon: who, simulated: true } as never);
      expect(erDeferredReviveState(who).usedThisBattle, `${label} preview`).toBe(false);
      expect(attr.canApply(params), `${label} after a preview`).toBe(true);
      attr.apply(params);
      expect(erDeferredReviveState(who), `${label} armed`).toEqual({ pendingHpFraction: 0.25, usedThisBattle: true });
      expect(attr.canApply(params), `${label} latched`).toBe(false);
    }
    arena.weather = savedWeather;
  });

  it("Detonate: frozen original and class agree over max HP, HP, damage, Sturdy and Damp states; the armed turn keeps enduring", async () => {
    const { holder } = await startWorld(phaserGame);
    const [site] = sitesOf("PostFaintDetonateAbAttr");
    const attr = site.attr as PostFaintDetonateAbAttr;
    const blocked = vi.spyOn(PostFaintDetonateAbAttr as Any, "isExplosionBlocked");
    // Frozen original, with no arming memory (the armed turn is checked on its own below).
    const frozen = (p: Any, sturdy: boolean, damp: boolean): boolean => {
      if (p.pokemon.getMaxHp() <= 1 || p.damage.value < p.pokemon.hp) {
        return false;
      }
      if (sturdy) {
        return false;
      }
      return !damp;
    };
    let checked = 0;
    for (const maxHp of [1, 2, 100]) {
      for (const hp of [1, 2, 50, 100]) {
        if (hp > maxHp) {
          continue;
        }
        for (const damage of [0, 1, hp - 1, hp, hp + 1, 500]) {
          for (const sturdy of [false, true]) {
            for (const damp of [false, true]) {
              blocked.mockReturnValue(damp);
              const pokemon = {
                hp,
                getMaxHp: () => maxHp,
                getTag: (tag: BattlerTagType) => (sturdy && tag === BattlerTagType.STURDY ? {} : undefined),
              };
              const params = { pokemon, damage: { value: Math.max(damage, 0) }, simulated: false } as never;
              expect(attr.canApply(params), `max ${maxHp} hp ${hp} dmg ${damage} sturdy ${sturdy} damp ${damp}`).toBe(
                frozen(params as Any, sturdy, damp),
              );
              checked++;
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    blocked.mockReturnValue(false);
    // The armed turn: after a real arming apply, the same turn keeps returning true (even over a Sturdy tag), and the next turn drops it.
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const target = holder as Any;
    const original = { hp: target.hp, maxHp: target.getMaxHp() };
    expect(original.maxHp).toBeGreaterThan(1);
    const damage = { value: original.hp + 10 };
    vi.spyOn(holder, "addTag").mockReturnValue(true);
    const params = { pokemon: holder, opponent: undefined, damage, simulated: false } as never;
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(queue).toHaveBeenCalledTimes(1);
    vi.spyOn(holder, "getTag").mockReturnValue({} as never);
    expect(attr.canApply({ pokemon: holder, damage: { value: 5 }, simulated: false } as never), "armed turn").toBe(
      false,
    );
    // damage 5 < hp: the gate fails first, so use a lethal damage for the armed-turn bypass
    expect(
      attr.canApply({ pokemon: holder, damage: { value: original.hp + 5 }, simulated: false } as never),
      "armed turn, lethal",
    ).toBe(true);
    const battle = globalScene.currentBattle as Any;
    const turn = battle.turn;
    battle.turn = turn + 1;
    expect(
      attr.canApply({ pokemon: holder, damage: { value: original.hp + 5 }, simulated: false } as never),
      "next turn",
    ).toBe(false);
    battle.turn = turn;
  });

  it("Clear terrain: frozen original and class agree for no terrain object, None and every terrain", async () => {
    const { holder } = await startWorld(phaserGame);
    const arena = globalScene.arena as Any;
    const saved = arena.terrain;
    const frozen = (): boolean =>
      arena.terrain?.terrainType !== undefined && arena.terrain.terrainType !== TerrainType.NONE;
    const terrains = Object.values(TerrainType).filter(v => typeof v === "number") as TerrainType[];
    for (const site of sitesOf("PostSummonClearTerrainAbAttr")) {
      for (const terrain of [undefined, ...terrains]) {
        arena.terrain = terrain === undefined ? undefined : { terrainType: terrain };
        expect(
          site.attr.canApply({ pokemon: holder, simulated: false } as never),
          `${site.abilityName} ${String(terrain)}`,
        ).toBe(frozen());
      }
    }
    arena.terrain = saved;
  });
});
