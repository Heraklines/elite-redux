/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 2: Anneal (5979). The default holder is a Normal type, so no foe move in the L1 grid or the L2 twin is
// resisted and the gate is false everywhere. These probes make the holder resist (the engine's effectiveness answer
// is stubbed), fill and exhaust the private raise counter, and compare each attr with its rebuild.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import {
  type AnnealAbAttr,
  type AnnealResetAbAttr,
  annealGainedCount,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ANNEAL = 5979;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

describe("B13 Anneal", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  const attrs = () => {
    const list = liveAbility(ANNEAL).attrs;
    return { reset: list[0] as AnnealResetAbAttr, anneal: list[1] as AnnealAbAttr };
  };

  /** The foe uses a move: a new record in its move history (what Anneal counts once per move). */
  function foeUses(foe: Pokemon): void {
    foe.pushMoveHistory({
      move: MoveId.TACKLE,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
      result: MoveResult.SUCCESS,
    });
  }

  const hit = (
    holder: Pokemon,
    foe: Pokemon,
    damage = 10,
    hitResult = HitResult.EFFECTIVE,
    moveId = MoveId.TACKLE,
    simulated = false,
  ): never => ({ pokemon: holder, opponent: foe, move: allMoves[moveId], damage, hitResult, simulated }) as never;

  const resist = (holder: Pokemon, value: number) =>
    vi.spyOn(holder, "getMoveEffectiveness").mockReturnValue(value as never);

  it("fires only on a damaging, unblocked, resisted (not immune) hit of a move not counted yet; the rebuild agrees", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { reset, anneal } = attrs();
    const rebuilt = recomposeAttr(module("AnnealAbAttr"), anneal, ANNEAL, 1) as AbAttr;
    expect(rebuilt).not.toBe(anneal);
    reset.apply({ pokemon: holder, simulated: false } as never);
    foeUses(foe);
    const both = (damage = 10, hitResult = HitResult.EFFECTIVE) => [
      anneal.canApply(hit(holder, foe, damage, hitResult)),
      rebuilt.canApply(hit(holder, foe, damage, hitResult)),
    ];
    const spy = resist(holder, 0.5);
    expect(both()).toEqual([true, true]);
    for (const [value, expected] of [
      [0.25, true],
      [0.5, true],
      [0.51, false],
      [1, false],
      [2, false],
      [0, false],
    ] as const) {
      spy.mockReturnValue(value as never);
      expect([value, both()]).toEqual([value, [expected, expected]]);
    }
    spy.mockReturnValue(0.5 as never);
    expect(both(0)).toEqual([false, false]);
    expect(both(10, HitResult.NO_EFFECT)).toEqual([false, false]);
    expect(both(10, HitResult.MISS)).toEqual([false, false]);
    expect(both(10, HitResult.NOT_VERY_EFFECTIVE)).toEqual([true, true]);
    // A replaced gate replaces only the effectiveness clauses: the guards and the memory stay.
    const anyHit = buildAttr(module("AnnealAbAttr"), {}, { gate: () => true });
    spy.mockReturnValue(2 as never);
    expect(anyHit.canApply(hit(holder, foe))).toBe(true);
    expect(anyHit.canApply(hit(holder, foe, 0))).toBe(false);
    spy.mockRestore();
  });

  it("raises Defense after a physical move and Sp. Def otherwise, counts each foe move once and stops after 2", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const { reset, anneal } = attrs();
    reset.apply({ pokemon: holder, simulated: false } as never);
    resist(holder, 0.5);
    const queued = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    foeUses(foe);
    expect(anneal.canApply(hit(holder, foe))).toBe(true);
    // A simulated call changes no stat but still spends the memory (an oddity recorded in the notes).
    anneal.apply(hit(holder, foe, 10, HitResult.EFFECTIVE, MoveId.TACKLE, true));
    expect(queued).not.toHaveBeenCalled();
    expect(annealGainedCount(holder)).toBe(1);

    foeUses(foe);
    anneal.apply(hit(holder, foe, 10, HitResult.EFFECTIVE, MoveId.TACKLE));
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.DEF], 1);
    expect(annealGainedCount(holder)).toBe(2);
    // The same foe move again, and the cap of 2, both close the gate even for a new move.
    expect(anneal.canApply(hit(holder, foe))).toBe(false);
    foeUses(foe);
    expect(anneal.canApply(hit(holder, foe))).toBe(false);
    reset.apply({ pokemon: holder, simulated: false } as never);
    foeUses(foe);
    expect(anneal.canApply(hit(holder, foe))).toBe(true);
    anneal.apply(hit(holder, foe, 10, HitResult.EFFECTIVE, MoveId.WATER_GUN));
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPDEF], 1);
    queued.mockRestore();
  });

  it("the numbers and stats are params: a different cap, stage count and stats change the behaviour", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const { reset } = attrs();
    reset.apply({ pokemon: holder, simulated: false } as never);
    resist(holder, 0.5);
    const queued = vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    const custom = buildAttr(
      module("AnnealAbAttr"),
      { maxTriggers: 3, stages: 2, physicalStat: "Speed", specialStat: "Attack" },
      { gate: () => true },
    ) as AnnealAbAttr;
    for (let i = 0; i < 3; i++) {
      foeUses(foe);
      expect(custom.canApply(hit(holder, foe))).toBe(true);
      custom.apply(hit(holder, foe));
    }
    foeUses(foe);
    expect(custom.canApply(hit(holder, foe))).toBe(false);
    expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", holder.getBattlerIndex(), true, [Stat.SPD], 2);
    queued.mockRestore();
  });
});
