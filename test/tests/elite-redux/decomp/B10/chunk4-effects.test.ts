/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 4, what the L1 grid and the L2 twin cannot show for the seven classes that have an effect to compare: each user is rebuilt
// from its declaration (the Tier B classes with their own gate as a stand-in, because their library gate is a written legacy binding)
// and driven next to the original. The rebuilt attr must be identical (fingerprint) and every queued phase, damage call and tag call must
// match, in the same order, including the guards (no foe, fainted foe, preview).
import { globalScene } from "#app/global-scene";
import { normalizeBindingSpec } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { erApplyPendingRevives, erDeferredReviveState } from "#data/elite-redux/archetypes/post-faint-deferred-revive";
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { PostFaintSpreadDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-spread-detonate";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { rebuildWithClassGate } from "#test/tests/elite-redux/decomp/B10/rebuild-with-class-gate";
import { attrFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const moduleOf = (name: string): DeclModule => declRegistry.get(name) as DeclModule;
const sitesOf = (name: string) => allAttrSites().filter(site => site.className === name);
type Any = Record<string, any>; // biome-ignore lint/suspicious/noExplicitAny: reads private fields of the attrs under test

/** Rebuild with the library gate when the binding has one, else with the class's own gate as a stand-in. */
function rebuild(name: string, site: ReturnType<typeof sitesOf>[number]) {
  const module = moduleOf(name);
  try {
    return recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
  } catch {
    return rebuildWithClassGate(module, site.attr, site.abilityId, site.attrIndex);
  }
}

/** What a queued phase looks like once the move object is reduced to what it will do. */
function describeCall(args: unknown[]): unknown[] {
  const move = args[3] as {
    moveId?: number;
    getMove?(): { power: number; type: number; category: number; chance: number };
  };
  if (args[0] === "MovePhase") {
    const built = move?.getMove?.();
    return [
      "MovePhase",
      (args[1] as Pokemon).id,
      args[2],
      move?.moveId,
      built?.power,
      built?.type,
      built?.category,
      built?.chance,
      args[4],
      args[5],
    ];
  }
  return args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : arg));
}

describe("B10 chunk 4: effects of the classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every user of the seven declared classes rebuilds to an identical attr and reads its settings back", async () => {
    await startWorld(phaserGame);
    const names = [
      "PostDefendHpGatedSelfTagAbAttr",
      "PostFaintDeferredReviveAbAttr",
      "PostFaintDetonateAbAttr",
      "PostFaintSpreadDetonateAbAttr",
      "PostItemLostScriptedMoveAbAttr",
      "PostSummonApplyTagOnFoesAbAttr",
      "PostSummonClearTerrainAbAttr",
    ];
    let total = 0;
    for (const name of names) {
      for (const site of sitesOf(name)) {
        const rebuilt = rebuild(name, site);
        expect(rebuilt, `${site.abilityName} ${name}`).not.toBe(site.attr);
        expect(attrFingerprint(rebuilt as never), `${site.abilityName} ${name}`).toEqual(
          attrFingerprint(site.attr as never),
        );
        total++;
      }
    }
    expect(total).toBe(1 + 2 + 4 + 2 + 1 + 2 + 3);
  });

  it("settings read back from the live users", async () => {
    await startWorld(phaserGame);
    const read = (name: string, ability: string) => {
      const site = sitesOf(name).find(s => s.abilityName === ability) as ReturnType<typeof sitesOf>[number];
      return readDeclParams(moduleOf(name), site.attr);
    };
    expect(read("PostDefendHpGatedSelfTagAbAttr", "No Turning Back")).toEqual({
      hpGate: 50,
      tagType: "NO_RETREAT",
      turnCount: 0,
    });
    expect(read("PostFaintDeferredReviveAbAttr", "Shallow Grave")).toEqual({
      hpFraction: 25,
      requireWeather: "FOG,EERIE_FOG",
      requireTerrain: "NONE",
    });
    expect(read("PostFaintDeferredReviveAbAttr", "Backup Power")).toEqual({
      hpFraction: 25,
      requireWeather: "NONE",
      requireTerrain: "ELECTRIC",
    });
    expect(read("PostFaintDetonateAbAttr", "Aftermath")).toEqual({ power: 100, flinch: true, type: "NORMAL" });
    expect(read("PostFaintSpreadDetonateAbAttr", "Victory Bomb")).toEqual({ power: 100, flinch: false, type: "FIRE" });
    expect(read("PostItemLostScriptedMoveAbAttr", "Greedy")).toEqual({ moveId: "THIEF", power: 0 });
    expect(read("PostSummonApplyTagOnFoesAbAttr", "Permanence")).toEqual({ tag: "HEAL_BLOCK", turns: 5 });
    expect(read("PostSummonApplyTagOnFoesAbAttr", "Mashed Potato")).toEqual({ tag: "SYRUP_BOMB", turns: 3 });
    const lawn = read("PostSummonClearTerrainAbAttr", "Lawnmower");
    expect(lawn).toMatchObject({
      clearedStat: "NONE",
      healPercent: 0,
      grassyStat: "DEF",
      electricStat: "DEF",
      mistyStat: "SPDEF",
      psychicStat: "SPDEF",
      toxicStat: "SPDEF",
    });
    expect(read("PostSummonClearTerrainAbAttr", "Curse of Famine")).toMatchObject({
      clearedStat: "DEF",
      clearedStages: 1,
      healPercent: 25,
      grassyStat: "NONE",
    });
    expect(read("PostSummonClearTerrainAbAttr", "Turf War")).toMatchObject({
      clearedStat: "NONE",
      healPercent: 0,
      toxicStat: "NONE",
    });
  });

  it("Greedy: the original and the rebuild queue the same free move at the first living foe; none for a fainted foe or a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const [site] = sitesOf("PostItemLostScriptedMoveAbAttr");
    const rebuilt = rebuild("PostItemLostScriptedMoveAbAttr", site);
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const calls: unknown[][] = [];
    for (const attr of [site.attr, rebuilt]) {
      queue.mockClear();
      expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(queue).toHaveBeenCalledTimes(1);
      calls.push(describeCall(queue.mock.calls[0]));
      queue.mockClear();
      attr.apply({ pokemon: holder, simulated: true } as never);
      expect(queue).not.toHaveBeenCalled();
    }
    expect(calls[1]).toEqual(calls[0]);
    expect(calls[0][0]).toBe("MovePhase");
    expect(calls[0][3]).toBe(MoveId.THIEF);
    vi.spyOn(foe, "isFainted").mockReturnValue(true);
    for (const attr of [site.attr, rebuilt]) {
      queue.mockClear();
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(queue).not.toHaveBeenCalled();
    }
  });

  it("Permanence and Mashed Potato: the tag goes on every adjacent living foe with the holder as source; nothing in a preview or without a foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const addTag = vi.spyOn(foe, "addTag").mockReturnValue(true);
    for (const site of sitesOf("PostSummonApplyTagOnFoesAbAttr")) {
      const rebuilt = rebuild("PostSummonApplyTagOnFoesAbAttr", site);
      const opts = (site.attr as Any).opts;
      for (const attr of [site.attr, rebuilt]) {
        addTag.mockClear();
        expect(attr.canApply({ pokemon: holder, simulated: false } as never), site.abilityName).toBe(true);
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(addTag).not.toHaveBeenCalled();
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(addTag.mock.calls, site.abilityName).toEqual([[opts.tag, opts.turns, undefined, holder.id]]);
      }
      vi.spyOn(foe, "isFainted").mockReturnValue(true);
      for (const attr of [site.attr, rebuilt]) {
        addTag.mockClear();
        expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(addTag).not.toHaveBeenCalled();
      }
      vi.mocked(foe.isFainted).mockReturnValue(false);
    }
  });

  it("Lawnmower, Curse of Famine and Turf War: the terrain is cleared and the same phases are queued, in the same order, for every terrain", async () => {
    const { holder } = await startWorld(phaserGame);
    const arena = globalScene.arena as Any;
    const savedTerrain = arena.terrain;
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const trySet = vi.spyOn(globalScene.arena, "trySetTerrain").mockReturnValue(true);
    const max = holder.getMaxHp();
    const terrains = [
      TerrainType.GRASSY,
      TerrainType.ELECTRIC,
      TerrainType.MISTY,
      TerrainType.PSYCHIC,
      TerrainType.TOXIC,
    ];
    const seen: Record<string, string[]> = {};
    for (const site of sitesOf("PostSummonClearTerrainAbAttr")) {
      const rebuilt = rebuild("PostSummonClearTerrainAbAttr", site);
      for (const terrain of terrains) {
        for (const hp of [max, 1]) {
          const results: unknown[] = [];
          for (const attr of [site.attr, rebuilt]) {
            arena.terrain = { terrainType: terrain };
            holder.hp = hp;
            queue.mockClear();
            trySet.mockClear();
            expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
            attr.apply({ pokemon: holder, simulated: true } as never);
            expect(trySet).not.toHaveBeenCalled();
            expect(queue).not.toHaveBeenCalled();
            attr.apply({ pokemon: holder, simulated: false } as never);
            expect(trySet.mock.calls).toEqual([[TerrainType.NONE, false]]);
            results.push(queue.mock.calls.map(call => describeCall(call)));
          }
          expect(results[1], `${site.abilityName} ${TerrainType[terrain]} hp ${hp}`).toEqual(results[0]);
          (seen[site.abilityName] ??= []).push(
            `${TerrainType[terrain]}:${hp === max ? "full" : "hurt"}:${(results[0] as unknown[]).length}`,
          );
        }
      }
    }
    // Lawnmower: one stat raise per terrain and no heal; Curse of Famine: the common raise, plus a heal only when hurt; Turf War: nothing queued.
    expect(seen.Lawnmower.every(entry => entry.endsWith(":1"))).toBe(true);
    expect(seen["Curse of Famine"].map(entry => entry.split(":").slice(1).join(":"))).toEqual([
      "full:1",
      "hurt:2",
      "full:1",
      "hurt:2",
      "full:1",
      "hurt:2",
      "full:1",
      "hurt:2",
      "full:1",
      "hurt:2",
    ]);
    expect(seen["Turf War"].every(entry => entry.endsWith(":0"))).toBe(true);
    // The raised stat of Lawnmower follows the cleared terrain (Defense for Grassy and Electric, Sp. Def for the other three).
    const lawn = sitesOf("PostSummonClearTerrainAbAttr").find(s => s.abilityName === "Lawnmower") as ReturnType<
      typeof sitesOf
    >[number];
    const stats: number[] = [];
    for (const terrain of terrains) {
      arena.terrain = { terrainType: terrain };
      queue.mockClear();
      lawn.attr.apply({ pokemon: holder, simulated: false } as never);
      stats.push(((queue.mock.calls[0] as unknown[])[3] as number[])[0]);
    }
    expect(stats).toEqual([Stat.DEF, Stat.DEF, Stat.SPDEF, Stat.SPDEF, Stat.SPDEF]);
    arena.terrain = savedTerrain;
  });

  it("Balloon Bomb and Victory Bomb: the original and the rebuild hit the same foes for the same damage; Damp and a missing foe stop it", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const damage = vi.spyOn(foe, "damageAndUpdate").mockReturnValue(0 as never);
    const addTag = vi.spyOn(foe, "addTag").mockReturnValue(true);
    const per: Record<string, unknown[]> = {};
    for (const site of sitesOf("PostFaintSpreadDetonateAbAttr")) {
      const rebuilt = rebuild("PostFaintSpreadDetonateAbAttr", site);
      for (const attr of [site.attr, rebuilt]) {
        damage.mockClear();
        expect(attr.canApply({ pokemon: holder, simulated: false } as never), site.abilityName).toBe(true);
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(damage).not.toHaveBeenCalled();
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(damage.mock.calls.length, site.abilityName).toBe(1);
        const [dealt, options] = damage.mock.calls[0] as [number, Any];
        (per[site.abilityName] ??= []).push([dealt, options.result, options.source.id]);
      }
      expect(per[site.abilityName][1], site.abilityName).toEqual(per[site.abilityName][0]);
      expect((per[site.abilityName][0] as number[])[0]).toBeGreaterThan(0);
      const blocked = vi.spyOn(PostFaintSpreadDetonateAbAttr as Any, "isExplosionBlocked").mockReturnValue(true);
      expect(site.attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
      expect(rebuilt.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
      blocked.mockRestore();
    }
    // a user with the flinch rider: the rebuild equals the original, and the foe gets one FLINCHED turn from the holder
    const flinching = new PostFaintSpreadDetonateAbAttr({ power: 80, flinch: true, type: PokemonType.FIRE });
    const module = moduleOf("PostFaintSpreadDetonateAbAttr");
    const copy = buildAttr(module, readDeclParams(module, flinching));
    expect(attrFingerprint(copy as never)).toEqual(attrFingerprint(flinching as never));
    for (const attr of [flinching, copy]) {
      addTag.mockClear();
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(addTag.mock.calls).toEqual([[BattlerTagType.FLINCHED, 1, MoveId.EXPLOSION, holder.id]]);
    }
    vi.spyOn(holder, "getAdjacentOpponents").mockReturnValue([]);
    for (const site of sitesOf("PostFaintSpreadDetonateAbAttr")) {
      expect(site.attr.canApply({ pokemon: holder, simulated: false } as never), site.abilityName).toBe(false);
    }
  });

  it("Aftermath family: the original and the rebuild queue the same one-off explosion (power, type, category, flinch rider) first", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    for (const who of [holder, foe]) {
      vi.spyOn(who, "addTag").mockReturnValue(true);
    }
    const sites = sitesOf("PostFaintDetonateAbAttr");
    const first: unknown[][] = [];
    for (const site of sites) {
      const rebuilt = rebuild("PostFaintDetonateAbAttr", site);
      const described: unknown[][] = [];
      // Both attrs act on the SAME holder (the category depends on its stats); the turn counter moves on so the arming memory of the
      // first call is stale for the second one.
      for (const attr of [site.attr, rebuilt]) {
        const who = holder;
        queue.mockClear();
        const params = { pokemon: who, opponent: undefined, damage: { value: who.hp + 20 }, simulated: false } as never;
        expect(attr.canApply(params), site.abilityName).toBe(true);
        attr.apply(params);
        expect(queue, site.abilityName).toHaveBeenCalledTimes(1);
        described.push(describeCall(queue.mock.calls[0]).slice(2));
        // forget the arming memory of this Pokemon for the next ability
        (globalScene.currentBattle as Any).turn += 1;
      }
      expect(described[1], site.abilityName).toEqual(described[0]);
      first.push(described[0]);
    }
    expect(first.every(entry => JSON.stringify(entry) === JSON.stringify(first[0]))).toBe(true);
    // power 100, Normal, chance 100 (the flinch rider), FOLLOW_UP use mode
    expect(first[0][1]).toBe(MoveId.EXPLOSION);
    expect(first[0][2]).toBe(100);
    expect(first[0][3]).toBe(PokemonType.NORMAL);
    expect(first[0][5]).toBe(100);
  });

  it("Shallow Grave: the armed record becomes a revive at the next send-out in the original and in the rebuild", async () => {
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
        conds: {
          gate: normalizeBindingSpec({
            any: [
              { id: "field.weather", weather: "FOG" },
              { id: "field.weather", weather: "EERIE_FOG" },
            ],
          }) as never,
        },
      },
    );
    for (const [attr, who] of [
      [site.attr, holder],
      [rebuilt, foe],
    ] as const) {
      const max = who.getMaxHp();
      attr.apply({ pokemon: who, simulated: false } as never);
      expect(erDeferredReviveState(who).pendingHpFraction).toBe(0.25);
      who.hp = 0;
      vi.spyOn(who, "isFainted").mockReturnValue(true);
      vi.spyOn(who, "resetStatus").mockImplementation((() => undefined) as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => undefined) as never);
      erApplyPendingRevives(who.isPlayer());
      expect(who.hp, "revived HP").toBe(Math.max(1, Math.floor(max * 0.25)));
      expect(erDeferredReviveState(who).pendingHpFraction).toBeNull();
    }
    arena.weather = savedWeather;
  });

  it("Detonate settings: a rebuilt blast of another power, type and flinch setting builds the same attr as the constructor", async () => {
    await startWorld(phaserGame);
    const module = moduleOf("PostFaintDetonateAbAttr");
    const odd = new PostFaintDetonateAbAttr({ power: 60, flinch: false, type: PokemonType.FIRE });
    const copy = buildAttr(module, readDeclParams(module, odd), { gate: (() => true) as never });
    expect(attrFingerprint(copy as never)).toEqual(attrFingerprint(odd as never));
    expect(readDeclParams(module, odd)).toEqual({ power: 60, flinch: false, type: "FIRE" });
  });
});
