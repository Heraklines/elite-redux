/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke tests: stat-debuff-on-flag-attack cluster.
//
// Covers ER abilities Denting Blows / Chainsaw (post-flag-move opponent-stat
// drop). We use a stub `globalScene.phaseManager` to capture the queued
// StatStageChangePhase invocations and verify they target the OPPONENT
// (selfTarget = false) and fire only when the configured flag is set on the
// used move.
//
// Mirror of `stat-boost-on-flag-attack.test.ts` — kept aligned so the
// symmetry between the user-side and opponent-side surfaces is obvious.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { StatDebuffOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-debuff-on-flag-attack";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { beforeEach, describe, expect, it, vi } from "vitest";

const unshiftNew = vi.fn();

beforeEach(() => {
  unshiftNew.mockClear();
  initGlobalScene({
    phaseManager: {
      unshiftNew: (...args: unknown[]) => unshiftNew(...args),
      queueAbilityDisplay: () => {},
    },
  } as unknown as BattleScene);
});

type StubMonOpts = {
  battlerIndex?: number;
};

function makeStubMon(opts: StubMonOpts = {}): Pokemon {
  return {
    getBattlerIndex: () => opts.battlerIndex ?? 0,
  } as unknown as Pokemon;
}

function makeStubMove(opts: { flags: MoveFlags[]; isStatus?: boolean }): Move {
  return {
    category: opts.isStatus ? MoveCategory.STATUS : MoveCategory.PHYSICAL,
    doesFlagEffectApply: ({ flag }: { flag: MoveFlags }) => opts.flags.includes(flag),
  } as unknown as Move;
}

function makeParams(opts: { user: Pokemon; target: Pokemon; move: Move; simulated?: boolean }) {
  return {
    pokemon: opts.user,
    opponent: opts.target,
    move: opts.move,
    hitResult: HitResult.EFFECTIVE,
    damage: 50,
    simulated: opts.simulated ?? false,
  };
}

describe("StatDebuffOnFlagAttackAbAttr", () => {
  it("constructs and exposes accessors", () => {
    const attr = new StatDebuffOnFlagAttackAbAttr({
      flag: MoveFlags.HAMMER_BASED,
      stat: Stat.DEF,
      stages: -1,
    });
    expect(attr.getFlag()).toBe(MoveFlags.HAMMER_BASED);
    expect(attr.getStat()).toBe(Stat.DEF);
    expect(attr.getStages()).toBe(-1);
  });

  it("rejects stages=0 or non-integer", () => {
    expect(
      () =>
        new StatDebuffOnFlagAttackAbAttr({
          flag: MoveFlags.HAMMER_BASED,
          stat: Stat.DEF,
          stages: 0,
        }),
    ).toThrow();
    expect(
      () =>
        new StatDebuffOnFlagAttackAbAttr({
          flag: MoveFlags.HAMMER_BASED,
          stat: Stat.DEF,
          stages: -1.5,
        }),
    ).toThrow();
  });

  it("fires when the used move carries the configured flag (Denting Blows, hammer)", () => {
    const attr = new StatDebuffOnFlagAttackAbAttr({
      flag: MoveFlags.HAMMER_BASED,
      stat: Stat.DEF,
      stages: -1,
    });
    const user = makeStubMon({ battlerIndex: 0 });
    const target = makeStubMon({ battlerIndex: 2 });
    const move = makeStubMove({ flags: [MoveFlags.HAMMER_BASED, MoveFlags.MAKES_CONTACT] });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    // Target's battlerIndex passed, selfTarget = false, [DEF], -1.
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 2, false, [Stat.DEF], -1);
  });

  it("does NOT fire when the move lacks the configured flag", () => {
    const attr = new StatDebuffOnFlagAttackAbAttr({
      flag: MoveFlags.HAMMER_BASED,
      stat: Stat.DEF,
      stages: -1,
    });
    const user = makeStubMon();
    const target = makeStubMon();
    const move = makeStubMove({ flags: [MoveFlags.MAKES_CONTACT] });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("does NOT fire on status moves (PostAttackAbAttr default condition)", () => {
    const attr = new StatDebuffOnFlagAttackAbAttr({
      flag: MoveFlags.HAMMER_BASED,
      stat: Stat.DEF,
      stages: -1,
    });
    const user = makeStubMon();
    const target = makeStubMon();
    const move = makeStubMove({ flags: [MoveFlags.HAMMER_BASED], isStatus: true });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("simulated runs queue no phase", () => {
    const attr = new StatDebuffOnFlagAttackAbAttr({
      flag: MoveFlags.HAMMER_BASED,
      stat: Stat.DEF,
      stages: -1,
    });
    const user = makeStubMon();
    const target = makeStubMon();
    const move = makeStubMove({ flags: [MoveFlags.HAMMER_BASED] });
    const params = makeParams({ user, target, move, simulated: true });
    attr.apply(params);
    expect(unshiftNew).not.toHaveBeenCalled();
  });

  it("Chainsaw wiring: keen edge (slicing) -1 DEF on target", () => {
    const attr = new StatDebuffOnFlagAttackAbAttr({
      flag: MoveFlags.SLICING_MOVE,
      stat: Stat.DEF,
      stages: -1,
    });
    const user = makeStubMon();
    const target = makeStubMon({ battlerIndex: 4 });
    const move = makeStubMove({ flags: [MoveFlags.SLICING_MOVE] });
    const params = makeParams({ user, target, move });
    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 4, false, [Stat.DEF], -1);
  });
});
