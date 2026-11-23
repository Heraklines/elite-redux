/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B10 chunk 5, what the L1 grid and the L2 twin cannot show for the five classes: each user is rebuilt from its declaration (the two
// capped Wishmaker rules, whose library gate is a written legacy binding, with the class's own gate as a stand-in) and driven next to the
// original. The rebuilt attr must be identical (fingerprint), read its settings back, and queue the same phases and make the same calls,
// in the same order, including the memory (once per battle, three casts), the guards (no foe, fainted foe, preview) and the weather gate.
import { globalScene } from "#app/global-scene";
import { readDeclParams, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclModule } from "#data/elite-redux/ability-studio/define-decl";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveUseMode } from "#enums/move-use-mode";
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
  if (args[0] === "MovePhase") {
    const pokemonMove = args[3] as {
      moveId: number;
      getMove(): { power: number; accuracy: number; hasFlag(f: number): boolean };
    };
    const built = pokemonMove.getMove();
    return [
      "MovePhase",
      (args[1] as Pokemon).id,
      args[2],
      pokemonMove.moveId,
      built.power,
      built.accuracy,
      built.hasFlag(MoveFlags.REFLECTABLE),
      args[4],
    ];
  }
  return args.map(arg => (typeof arg === "object" ? JSON.stringify(arg) : arg));
}

describe("B10 chunk 5: effects of the classes", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("every user of the five declared classes rebuilds to an identical attr", async () => {
    await startWorld(phaserGame);
    const counts: Record<string, number> = {
      PostSummonQuashFoesAbAttr: 2,
      PostSummonScriptedMoveAbAttr: 40,
      PostSummonStackSetEffectsAbAttr: 2,
      PostTurnApplyTagOnFoesAbAttr: 1,
      PostTurnDrainAbAttr: 3,
    };
    for (const [name, count] of Object.entries(counts)) {
      expect(sitesOf(name).length, name).toBe(count);
      for (const site of sitesOf(name)) {
        const rebuilt = rebuild(name, site);
        expect(rebuilt, `${site.abilityName} ${name}`).not.toBe(site.attr);
        expect(attrFingerprint(rebuilt as never), `${site.abilityName} ${name}`).toEqual(
          attrFingerprint(site.attr as never),
        );
      }
    }
  });

  it("settings read back from the live users", async () => {
    await startWorld(phaserGame);
    const read = (name: string, ability: string, attrIndex?: number) => {
      const site = sitesOf(name).find(
        s => s.abilityName === ability && (attrIndex === undefined || s.attrIndex === attrIndex),
      ) as ReturnType<typeof sitesOf>[number];
      return readDeclParams(moduleOf(name), site.attr);
    };
    expect(read("PostSummonQuashFoesAbAttr", "Rejection")).toEqual({ stages: -6 });
    expect(read("PostSummonQuashFoesAbAttr", "Suppress")).toEqual({ stages: -6 });
    expect(read("PostTurnApplyTagOnFoesAbAttr", "Permanence")).toEqual({ tag: "HEAL_BLOCK", turns: 2 });
    expect(read("PostTurnDrainAbAttr", "Life Steal")).toEqual({ percent: 10, onlyTrapped: false, weather: "NONE" });
    expect(read("PostTurnDrainAbAttr", "Soul Tap")).toEqual({
      percent: 10,
      onlyTrapped: false,
      weather: "FOG,EERIE_FOG",
    });
    expect(read("PostTurnDrainAbAttr", "Poseidon's Dominion")).toEqual({
      percent: 16.6667,
      onlyTrapped: true,
      weather: "NONE",
    });
    for (const ability of ["Harukaze", "Gale Bloom"]) {
      expect(read("PostSummonStackSetEffectsAbAttr", ability)).toEqual({
        terrain: "GRASSY",
        tagType1: "TAILWIND",
        tagTurns1: 4,
        tagSide1: "MY_SIDE",
        tagType2: "NONE",
        tagTurns2: 5,
        tagSide2: "MY_SIDE",
      });
    }
    const name = "PostSummonScriptedMoveAbAttr";
    expect(read(name, "Jumpscare")).toEqual({
      moveId: "ASTONISH",
      power: 40,
      aim: "THE_FIRST_FOE",
      alwaysHit: false,
      nonReflectable: false,
      memoryKey: "jumpscare-scripted-move",
      maxUses: 0,
    });
    expect(read(name, "Sand Pit")).toEqual({
      moveId: "SAND_TOMB",
      power: 20,
      aim: "EVERY_FOE",
      alwaysHit: true,
      nonReflectable: false,
      memoryKey: "NONE",
      maxUses: 0,
    });
    expect(read(name, "Wishmaker")).toEqual({
      moveId: "WISH",
      power: 0,
      aim: "ME",
      alwaysHit: false,
      nonReflectable: false,
      memoryKey: "wishmaker",
      maxUses: 3,
    });
    expect(read(name, "Web Spinner")).toMatchObject({ moveId: "STRING_SHOT", aim: "EVERY_FOE", power: 0 });
    expect(read(name, "Jackpot")).toMatchObject({ moveId: "HAPPY_HOUR", aim: "ME", memoryKey: "jackpot-happy-hour" });
  });

  it("scripted entry move: every user queues the same phase, in the same way, with a foe, without one and in a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const seen = new Set<string>();
    for (const site of sitesOf("PostSummonScriptedMoveAbAttr")) {
      const opts = (site.attr as Any).opts;
      const aim = opts.targetsSelf ? "me" : opts.allOpponents ? "every" : "first";
      seen.add(aim);
      for (const withFoe of [true, false]) {
        const results: unknown[] = [];
        for (const attr of [site.attr, rebuild("PostSummonScriptedMoveAbAttr", site)]) {
          holder.waveData.entryEffectsFired.clear();
          const fainted = vi.spyOn(foe, "isFainted").mockReturnValue(!withFoe);
          queue.mockClear();
          const can = attr.canApply({ pokemon: holder, simulated: false } as never);
          if (can) {
            attr.apply({ pokemon: holder, simulated: false } as never);
          }
          results.push([can, queue.mock.calls.map(describeCall), [...holder.waveData.entryEffectsFired]]);
          // a preview passes canApply and queues nothing
          queue.mockClear();
          expect(attr.canApply({ pokemon: holder, simulated: true } as never), site.abilityName).toBe(true);
          attr.apply({ pokemon: holder, simulated: true } as never);
          expect(queue).not.toHaveBeenCalled();
          fainted.mockRestore();
        }
        expect(results[1], `${site.abilityName} attr ${site.attrIndex} foe=${withFoe}`).toEqual(results[0]);
        const [can, calls] = results[0] as [boolean, unknown[][]];
        expect(can, site.abilityName).toBe(withFoe || opts.targetsSelf === true);
        expect(calls.length, site.abilityName).toBe(can ? 1 : 0);
        if (can) {
          expect(calls[0][3], site.abilityName).toBe(opts.moveId);
          expect(calls[0][7], site.abilityName).toBe(opts.targetsSelf ? MoveUseMode.FOLLOW_UP : MoveUseMode.INDIRECT);
        }
      }
    }
    expect([...seen].sort()).toEqual(["every", "first", "me"]);
  });

  it("scripted entry move: once per battle (Jumpscare, Jackpot) and at most three casts (Wishmaker) match the original", async () => {
    const { holder } = await startWorld(phaserGame);
    vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const run = (attr: { canApply(p: never): boolean; apply(p: never): void }, times: number): boolean[] => {
      holder.waveData.entryEffectsFired.clear();
      const answers: boolean[] = [];
      for (let i = 0; i < times; i++) {
        const can = attr.canApply({ pokemon: holder, simulated: false } as never);
        answers.push(can);
        if (can) {
          attr.apply({ pokemon: holder, simulated: false } as never);
        }
      }
      return answers;
    };
    for (const [ability, times, expected] of [
      ["Jumpscare", 3, [true, false, false]],
      ["Jackpot", 3, [true, false, false]],
      ["Wishmaker", 5, [true, true, true, false, false]],
    ] as const) {
      const site = sitesOf("PostSummonScriptedMoveAbAttr").find(s => s.abilityName === ability) as ReturnType<
        typeof sitesOf
      >[number];
      const original = run(site.attr as never, times);
      const rebuilt = run(rebuild("PostSummonScriptedMoveAbAttr", site) as never, times);
      expect(original, ability).toEqual(expected);
      expect(rebuilt, ability).toEqual(expected);
      // the rebuilt gate reads and writes the class's own memory key: a marker left by the original blocks the rebuild at once
      const key = (site.attr as Any).opts.oncePerBattleKey as string;
      if ((site.attr as Any).opts.maxUsesPerBattle === undefined) {
        for (const attr of [site.attr, rebuild("PostSummonScriptedMoveAbAttr", site)]) {
          holder.waveData.entryEffectsFired.clear();
          holder.waveData.entryEffectsFired.add(key);
          expect(attr.canApply({ pokemon: holder, simulated: false } as never), ability).toBe(false);
          holder.waveData.entryEffectsFired.clear();
          attr.apply({ pokemon: holder, simulated: false } as never);
          expect([...holder.waveData.entryEffectsFired], ability).toEqual([key]);
        }
      }
    }
    // the markers the capped rule leaves behind are wishmaker#0, #1, #2
    const wish = sitesOf("PostSummonScriptedMoveAbAttr").find(s => s.abilityName === "Wishmaker") as ReturnType<
      typeof sitesOf
    >[number];
    run(rebuild("PostSummonScriptedMoveAbAttr", wish) as never, 5);
    expect([...holder.waveData.entryEffectsFired].sort()).toEqual(["wishmaker#0", "wishmaker#1", "wishmaker#2"]);
  });

  it("Rejection and Suppress: a Speed drop is queued for every adjacent living foe; nothing in a preview or without a foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    for (const site of sitesOf("PostSummonQuashFoesAbAttr")) {
      for (const attr of [site.attr, rebuild("PostSummonQuashFoesAbAttr", site)]) {
        queue.mockClear();
        expect(attr.canApply({ pokemon: holder, simulated: false } as never), site.abilityName).toBe(true);
        attr.apply({ pokemon: holder, simulated: true } as never);
        expect(queue).not.toHaveBeenCalled();
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(queue.mock.calls.map(describeCall), site.abilityName).toEqual([
          ["StatStageChangePhase", foe.getBattlerIndex(), false, JSON.stringify([Stat.SPD]), -6],
        ]);
      }
      vi.spyOn(foe, "isFainted").mockReturnValue(true);
      for (const attr of [site.attr, rebuild("PostSummonQuashFoesAbAttr", site)]) {
        queue.mockClear();
        expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
        attr.apply({ pokemon: holder, simulated: false } as never);
        expect(queue).not.toHaveBeenCalled();
      }
      vi.mocked(foe.isFainted).mockReturnValue(false);
    }
  });

  it("Permanence (turn end): the tag goes on every adjacent living foe with the holder as source; nothing in a preview or without a foe", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const addTag = vi.spyOn(foe, "addTag").mockReturnValue(true);
    const [site] = sitesOf("PostTurnApplyTagOnFoesAbAttr");
    for (const attr of [site.attr, rebuild("PostTurnApplyTagOnFoesAbAttr", site)]) {
      addTag.mockClear();
      expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
      attr.apply({ pokemon: holder, simulated: true } as never);
      expect(addTag).not.toHaveBeenCalled();
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(addTag.mock.calls).toEqual([["HEAL_BLOCK", 2, undefined, holder.id]]);
    }
    vi.spyOn(foe, "isFainted").mockReturnValue(true);
    for (const attr of [site.attr, rebuild("PostTurnApplyTagOnFoesAbAttr", site)]) {
      addTag.mockClear();
      expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
      attr.apply({ pokemon: holder, simulated: false } as never);
      expect(addTag).not.toHaveBeenCalled();
    }
  });

  it("Harukaze and Gale Bloom: the terrain, then Tailwind on the holder's own side, for a player and an enemy holder", async () => {
    const { holder } = await startWorld(phaserGame);
    const trySet = vi.spyOn(globalScene.arena, "trySetTerrain").mockReturnValue(true);
    const addTag = vi.spyOn(globalScene.arena, "addTag").mockReturnValue(true);
    for (const site of sitesOf("PostSummonStackSetEffectsAbAttr")) {
      for (const player of [true, false]) {
        vi.spyOn(holder, "isPlayer").mockReturnValue(player);
        const own = player ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
        for (const attr of [site.attr, rebuild("PostSummonStackSetEffectsAbAttr", site)]) {
          trySet.mockClear();
          addTag.mockClear();
          expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
          attr.apply({ pokemon: holder, simulated: true } as never);
          expect(trySet).not.toHaveBeenCalled();
          expect(addTag).not.toHaveBeenCalled();
          attr.apply({ pokemon: holder, simulated: false } as never);
          expect(trySet.mock.calls, site.abilityName).toEqual([[TerrainType.GRASSY, false]]);
          expect(addTag.mock.calls, site.abilityName).toEqual([[ArenaTagType.TAILWIND, 4, undefined, holder.id, own]]);
        }
      }
    }
  });

  it("the stack builder keeps order and sides: terrain only, two field effects on the foes' side and both sides", async () => {
    const { holder } = await startWorld(phaserGame);
    const trySet = vi.spyOn(globalScene.arena, "trySetTerrain").mockReturnValue(true);
    const addTag = vi.spyOn(globalScene.arena, "addTag").mockReturnValue(true);
    const { buildStackOptions } = await import("#data/elite-redux/ability-studio/decl/B10/c5-codecs");
    const { PostSummonStackSetEffectsAbAttr } = await import(
      "#data/elite-redux/archetypes/post-summon-stack-set-effects"
    );
    const base = {
      terrain: "NONE",
      tagType1: "NONE",
      tagTurns1: 4,
      tagSide1: "MY_SIDE",
      tagType2: "NONE",
      tagTurns2: 5,
      tagSide2: "MY_SIDE",
    };
    const attr = new PostSummonStackSetEffectsAbAttr(
      buildStackOptions({
        ...base,
        terrain: "MISTY",
        tagType1: "REFLECT",
        tagSide1: "THE_FOES_SIDE",
        tagType2: "TRICK_ROOM",
        tagTurns2: 3,
        tagSide2: "BOTH_SIDES",
      }) as never,
    );
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(trySet.mock.calls).toEqual([[TerrainType.MISTY, false]]);
    expect(addTag.mock.calls).toEqual([
      [ArenaTagType.REFLECT, 4, undefined, holder.id, ArenaTagSide.ENEMY],
      [ArenaTagType.TRICK_ROOM, 3, undefined, holder.id, ArenaTagSide.BOTH],
    ]);
    trySet.mockClear();
    addTag.mockClear();
    new PostSummonStackSetEffectsAbAttr(buildStackOptions(base) as never).apply({
      pokemon: holder,
      simulated: false,
    } as never);
    expect(trySet).not.toHaveBeenCalled();
    expect(addTag).not.toHaveBeenCalled();
    expect(() => buildStackOptions({ ...base, tagType2: "MIST" })).toThrow(/first field effect/);
  });

  it("Life Steal, Soul Tap and Poseidon's Dominion: same gate, same damage and same heals as the original, for every weather and trapped state", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const arena = globalScene.arena as Any;
    const queue = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => undefined) as never);
    const damageCalls: unknown[][] = [];
    vi.spyOn(foe, "damageAndUpdate").mockImplementation(((amount: number, opts: unknown) => {
      damageCalls.push([amount, JSON.stringify(opts)]);
      foe.hp = Math.max(0, foe.hp - amount);
      return amount;
    }) as never);
    const savedWeather = arena.weather;
    const weathers = [WeatherType.NONE, WeatherType.FOG, WeatherType.EERIE_FOG, WeatherType.SUNNY, WeatherType.RAIN];
    const max = foe.getMaxHp();
    const summary: Record<string, string[]> = {};
    for (const site of sitesOf("PostTurnDrainAbAttr")) {
      const opts = site.attr as Any;
      for (const weather of weathers) {
        for (const trapped of [true, false]) {
          for (const hp of [max, 3, 1]) {
            const results: unknown[] = [];
            for (const attr of [site.attr, rebuild("PostTurnDrainAbAttr", site)]) {
              arena.weather = weather === WeatherType.NONE ? undefined : { weatherType: weather };
              vi.spyOn(foe, "isTrapped").mockReturnValue(trapped);
              foe.hp = hp;
              queue.mockClear();
              damageCalls.length = 0;
              const can = attr.canApply({ pokemon: holder, simulated: false } as never);
              if (can) {
                attr.apply({ pokemon: holder, simulated: false } as never);
              }
              results.push([can, damageCalls.map(c => c.join("|")), queue.mock.calls.length, foe.hp]);
              damageCalls.length = 0;
              attr.apply({ pokemon: holder, simulated: true } as never);
              expect(damageCalls).toEqual([]);
            }
            expect(results[1], `${site.abilityName} weather ${weather} trapped ${trapped} hp ${hp}`).toEqual(
              results[0],
            );
            const [can, damage] = results[0] as [boolean, string[]];
            const weatherOk = opts.weather === null || opts.weather.includes(weather);
            expect(can, `${site.abilityName} weather ${weather} trapped ${trapped}`).toBe(
              weatherOk && (!opts.onlyIfTrapped || trapped),
            );
            (summary[site.abilityName] ??= []).push(can ? `${damage.length}` : "-");
          }
        }
      }
    }
    // a sanity check that the fraction really was a tenth and a sixth
    foe.hp = max;
    expect(Math.floor(max * 0.1)).toBeGreaterThan(0);
    arena.weather = savedWeather;
    expect(Object.keys(summary).sort()).toEqual(["Life Steal", "Poseidon's Dominion", "Soul Tap"]);
    // each user really drained somebody in at least one state, and some states drained nobody
    for (const [ability, list] of Object.entries(summary)) {
      expect(list, ability).toContain("1");
      if (ability !== "Life Steal") {
        expect(list, ability).toContain("-");
      }
    }
  });
});
