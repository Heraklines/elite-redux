/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 2: Heavyweight (5982) and Meteor Mass (5997, its attr 1 is the same power class). The grid has two
// Pokemon of one fixed weight and no punches, so these probes cover the weight-class maths, the move gate against its
// rebuild, and the once-per-turn drop with its guards.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import type {
  HeavyweightDropAbAttr,
  HeavyweightPowerAbAttr,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const HEAVYWEIGHT = 5982;
const METEOR_MASS = 5997;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

describe("B13 Heavyweight", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const power = (holder: Pokemon, foe: Pokemon, moveId: MoveId, value = 100): never =>
    ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[moveId],
      power: new NumberHolder(value),
      simulated: false,
    }) as never;
  const hit = (holder: Pokemon, foe: Pokemon, moveId: MoveId, damage = 10, simulated = false): never =>
    ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[moveId],
      damage,
      hitResult: HitResult.EFFECTIVE,
      simulated,
    }) as never;

  it("both users' power attrs and their rebuilds boost exactly Heavy Slam, Heat Crash and punching moves", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const users: [number, number][] = [
      [HEAVYWEIGHT, 0],
      [METEOR_MASS, 1],
    ];
    for (const [abilityId, index] of users) {
      const original = liveAbility(abilityId).attrs[index] as HeavyweightPowerAbAttr;
      const rebuilt = recomposeAttr(module("HeavyweightPowerAbAttr"), original, abilityId, index) as AbAttr;
      expect(rebuilt).not.toBe(original);
      for (const [moveId, expected] of [
        [MoveId.HEAVY_SLAM, true],
        [MoveId.HEAT_CRASH, true],
        [MoveId.MACH_PUNCH, true],
        [MoveId.FIRE_PUNCH, true],
        [MoveId.TACKLE, false],
        [MoveId.EARTHQUAKE, false],
        [MoveId.WATER_GUN, false],
      ] as const) {
        expect([abilityId, moveId, original.canApply(power(holder, foe, moveId))]).toEqual([
          abilityId,
          moveId,
          expected,
        ]);
        expect([abilityId, moveId, rebuilt.canApply(power(holder, foe, moveId))]).toEqual([
          abilityId,
          moveId,
          expected,
        ]);
      }
    }
  });

  it("the power multiplier is 10% per weight class above the target, capped at 5 classes, never below 1", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(HEAVYWEIGHT).attrs[0] as HeavyweightPowerAbAttr;
    const rebuilt = recomposeAttr(module("HeavyweightPowerAbAttr"), original, HEAVYWEIGHT, 0) as AbAttr;
    const holderWeight = vi.spyOn(holder, "getWeight");
    const foeWeight = vi.spyOn(foe, "getWeight");
    const multiplier = (attr: AbAttr, h: number, f: number): number => {
      holderWeight.mockReturnValue(h);
      foeWeight.mockReturnValue(f);
      const params = power(holder, foe, MoveId.HEAVY_SLAM);
      attr.apply(params);
      return (params as { power: NumberHolder }).power.value;
    };
    // [holder weight, foe weight, expected multiplier]: classes are how many of 10, 25, 50, 100, 200 are reached.
    for (const [h, f, expected] of [
      [300, 5, 1.5],
      [300, 150, 1.1],
      [60, 30, 1.1],
      [60, 60, 1],
      [5, 300, 1],
      [30, 5, 1.2],
    ] as const) {
      expect([h, f, multiplier(original, h, f)]).toEqual([h, f, 100 * expected]);
      expect([h, f, multiplier(rebuilt, h, f)]).toEqual([h, f, 100 * expected]);
    }
    // Params: 20% per class and at most 2 classes.
    const custom = buildAttr(
      module("HeavyweightPowerAbAttr"),
      { percentPerClass: 20, maxClasses: 2 },
      { gate: () => true },
    );
    expect(multiplier(custom, 300, 5)).toBeCloseTo(140);
    expect(multiplier(custom, 60, 30)).toBeCloseTo(120);
    holderWeight.mockRestore();
    foeWeight.mockRestore();
  });

  it("the drop attr: damaging heavy hit, once per turn, and its rebuild agrees", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(HEAVYWEIGHT).attrs[1] as HeavyweightDropAbAttr;
    const rebuilt = recomposeAttr(module("HeavyweightDropAbAttr"), original, HEAVYWEIGHT, 1) as AbAttr;
    expect(rebuilt).not.toBe(original);
    const queued = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    const both = (moveId: MoveId, damage = 10): [boolean, boolean] => [
      original.canApply(hit(holder, foe, moveId, damage)),
      rebuilt.canApply(hit(holder, foe, moveId, damage)),
    ];
    expect(both(MoveId.TACKLE)).toEqual([false, false]);
    expect(both(MoveId.HEAVY_SLAM, 0)).toEqual([false, false]);
    expect(both(MoveId.SWORDS_DANCE)).toEqual([false, false]);
    expect(both(MoveId.HEAVY_SLAM)).toEqual([true, true]);
    expect(both(MoveId.MACH_PUNCH)).toEqual([true, true]);

    // A simulated call queues nothing but spends the turn (oddity in the notes); a real one lowers the foe's Defense.
    original.apply(hit(holder, foe, MoveId.HEAVY_SLAM, 10, true));
    expect(queued).not.toHaveBeenCalled();
    expect(both(MoveId.HEAVY_SLAM)).toEqual([false, false]);
    // Next turn the memory is stale again.
    game.scene.currentBattle.turn += 1;
    expect(both(MoveId.HEAVY_SLAM)).toEqual([true, true]);
    rebuilt.apply(hit(holder, foe, MoveId.HEAVY_SLAM));
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.DEF], -1);
    expect(both(MoveId.HEAVY_SLAM)).toEqual([false, false]);
    // The gate is replaceable; the damage guard and the once-per-turn rule stay.
    const anyMove = buildAttr(
      module("HeavyweightDropAbAttr"),
      { stat: "Speed", stages: -2 },
      { "ctor:0": () => true, gate: () => true },
    );
    game.scene.currentBattle.turn += 1;
    expect(anyMove.canApply(hit(holder, foe, MoveId.TACKLE))).toBe(true);
    expect(anyMove.canApply(hit(holder, foe, MoveId.TACKLE, 0))).toBe(false);
    anyMove.apply(hit(holder, foe, MoveId.TACKLE));
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPD], -2);
    expect(globalScene.currentBattle.turn).toBeGreaterThan(1);
    queued.mockRestore();
  });
});
