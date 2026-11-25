/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B02 chunk 1: classes the L1 attr differential cannot compare because the harness has no engine-parameter
// builder for their WHEN (request B02-9), plus the closure that has no adapter yet (request B02-7).
//  - PostReceiveCritStatStageChangeAbAttr: `apply` queues the same StatStageChangePhase for every user and nothing when simulated.
//  - PostStatStageChangeStatStageChangeAbAttr: every user's closure is `stages < 0`; a recomposed attr that is handed the
//    ORIGINAL closure agrees on canApply and apply over (stats, stages, selfTarget), and the library atom the future
//    binding will use (stage.just-changed, lowered) agrees with the closure, so request B02-7 is the only missing piece.
//  - PostDefendWeatherChangeAbAttr: the Sand Spit closure is the move.damaging atom (also covered by L1) and the optional
//    slot of Cryo Proficiency really is absent.
import type {
  PostDefendWeatherChangeAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  PostStatStageChangeStatStageChangeAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { compileCondition } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

function sitesOf(className: string) {
  return allAttrSites().filter(site => site.className === className);
}

describe("B02 chunk 1: Anger Point family (critical hit stat change)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("every user queues the same StatStageChangePhase after a rebuild, and nothing when simulated", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostReceiveCritStatStageChangeAbAttr")!;
    const sites = sitesOf("PostReceiveCritStatStageChangeAbAttr");
    expect(sites).toHaveLength(11);
    const seen = new Set<string>();
    for (const site of sites) {
      const original = site.attr as PostReceiveCritStatStageChangeAbAttr;
      const rebuilt = recomposeAttr(
        module,
        original,
        site.abilityId,
        site.attrIndex,
      ) as PostReceiveCritStatStageChangeAbAttr;
      expect(rebuilt).not.toBe(original);
      const record = (attr: PostReceiveCritStatStageChangeAbAttr, simulated: boolean): unknown[][] => {
        const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
        attr.apply({
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.TACKLE],
          damage: 9,
          hitResult: HitResult.EFFECTIVE,
          simulated,
        } as PostMoveInteractionAbAttrParams);
        const calls = spy.mock.calls.map(call => [...call]);
        spy.mockRestore();
        return calls;
      };
      const before = record(original, false);
      expect(before).toHaveLength(1);
      expect(before[0].slice(0, 2)).toEqual(["StatStageChangePhase", holder.getBattlerIndex()]);
      expect(record(rebuilt, false)).toEqual(before);
      expect(record(original, true)).toEqual([]);
      expect(record(rebuilt, true)).toEqual([]);
      expect(rebuilt.canApply({} as never)).toBe(original.canApply({} as never));
      seen.add(JSON.stringify(before[0].slice(3)));
    }
    // ATK, DEF, SPATK, SPDEF, SPD at 12 stages and Rage Point's two +1 attrs: the comparison reached every signature.
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
});

describe("B02 chunk 1: Defiant family (stat-change closure, request B02-7)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("a rebuild that keeps the original closure agrees with the original over every (stats, stages, selfTarget)", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = declRegistry.get("PostStatStageChangeStatStageChangeAbAttr")!;
    const sites = sitesOf("PostStatStageChangeStatStageChangeAbAttr");
    expect(sites).toHaveLength(6);
    const statSets: Stat[][] = [[Stat.ATK], [Stat.SPATK], [Stat.DEF, Stat.SPD], [Stat.ATK, Stat.SPATK]];
    let passed = 0;
    let blocked = 0;
    for (const site of sites) {
      const original = site.attr as PostStatStageChangeStatStageChangeAbAttr;
      const closure = (original as unknown as { condition: never }).condition;
      const rebuilt = recomposeAttr(module, original, site.abilityId, site.attrIndex, {
        conds: { "ctor:0": closure },
      }) as PostStatStageChangeStatStageChangeAbAttr;
      for (const stats of statSets) {
        for (const stages of [-6, -2, -1, 0, 1, 2, 6]) {
          for (const selfTarget of [false, true]) {
            const params = { pokemon: holder, stats, stages, selfTarget, simulated: false };
            const a = original.canApply(params as never);
            expect(rebuilt.canApply(params as never), `${site.abilityName} ${stats} ${stages} self=${selfTarget}`).toBe(
              a,
            );
            a ? passed++ : blocked++;
          }
        }
      }
      expect(Reflect.get(rebuilt, "statsToChange")).toEqual(Reflect.get(original, "statsToChange"));
      expect(Reflect.get(rebuilt, "stages")).toEqual(Reflect.get(original, "stages"));
    }
    expect(passed).toBeGreaterThan(0);
    expect(blocked).toBeGreaterThan(0);
  });

  it("the library atom the future binding will use equals every user's closure on `stages`", async () => {
    const { holder } = await startWorld(phaserGame);
    const lowered = compileCondition({ block: "stage.just-changed", params: { direction: "lowered" } });
    for (const site of sitesOf("PostStatStageChangeStatStageChangeAbAttr")) {
      const closure = (site.attr as unknown as { condition: (...args: unknown[]) => boolean }).condition;
      for (const stages of [-6, -3, -1, 0, 1, 3, 6]) {
        const stats = [Stat.ATK];
        expect(lowered({ holder, stat: stats[0], stages, simulated: true }), `${site.abilityName} ${stages}`).toBe(
          closure(holder, stats, stages),
        );
      }
    }
  });

  it("apply queues one StatStageChangePhase with the user's stats and stages, and nothing when simulated", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const site of sitesOf("PostStatStageChangeStatStageChangeAbAttr")) {
      const attr = site.attr as PostStatStageChangeStatStageChangeAbAttr;
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      attr.apply({ pokemon: holder, stats: [Stat.DEF], stages: -1, selfTarget: false, simulated: false } as never);
      attr.apply({ pokemon: holder, stats: [Stat.DEF], stages: -1, selfTarget: false, simulated: true } as never);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0].slice(0, 3)).toEqual(["StatStageChangePhase", holder.getBattlerIndex(), true]);
      spy.mockRestore();
    }
  });
});

describe("B02 chunk 1: Sand Spit and Cryo Proficiency (weather on hit)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Sand Spit's closure ignores status moves, Cryo Proficiency has no closure, and both rebuild the same", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const module = declRegistry.get("PostDefendWeatherChangeAbAttr")!;
    const sites = sitesOf("PostDefendWeatherChangeAbAttr");
    expect(sites.map(site => site.abilityName).sort()).toEqual(["Cryo Proficiency", "Sand Spit"]);
    const cryo = sites.find(site => site.abilityName === "Cryo Proficiency")!;
    expect(Reflect.get(cryo.attr, "condition")).toBeUndefined();
    const results: boolean[] = [];
    for (const site of sites) {
      const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex) as PostDefendWeatherChangeAbAttr;
      for (const move of [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.LEER, MoveId.SWORDS_DANCE]) {
        const params = {
          pokemon: holder,
          opponent: foe,
          move: allMoves[move],
          damage: 4,
          hitResult: HitResult.EFFECTIVE,
          simulated: false,
        } as PostMoveInteractionAbAttrParams;
        const a = site.attr.canApply(params);
        expect(rebuilt.canApply(params), `${site.abilityName} ${MoveId[move]}`).toBe(a);
        results.push(a);
      }
    }
    expect(results).toContain(true);
    expect(results).toContain(false);
  });
});
