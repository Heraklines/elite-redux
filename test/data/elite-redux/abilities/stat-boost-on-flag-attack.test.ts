/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke tests: stat-boost-on-flag-attack cluster.
//
// Covers ER abilities Growing Tooth / Hardened Sheath (post-flag-move self
// stat lift). We use a stub `globalScene.phaseManager` to capture the
// queued StatStageChangePhase invocations and verify they fire only when
// the configured flag is set on the used move.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { StatBoostOnFlagAttackAbAttr } from "#data/elite-redux/abilities/stat-boost-on-flag-attack";
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

type StubAttackerOpts = {
  battlerIndex?: number;
};

function makeStubAttacker(opts: StubAttackerOpts = {}): Pokemon {
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

describe("StatBoostOnFlagAttackAbAttr", () => {
  it("constructs and exposes accessors", () => {
    const attr = new StatBoostOnFlagAttackAbAttr({
      flag: MoveFlags.BITING_MOVE,
      stat: Stat.ATK,
      stages: 1,
    });
    expect(attr.getFlag()).toBe(MoveFlags.BITING_MOVE);
    expect(attr.getStat()).toBe(Stat.ATK);
    expect(attr.getStages()).toBe(1);
  });

  it("rejects stages=0 or non-integer", () => {
    expect(
      () =>
        new StatBoostOnFlagAttackAbAttr({
          flag: MoveFlags.BITING_MOVE,
          stat: Stat.ATK,
          stages: 0,
        }),
    ).toThrow();
    expect(
      () =>
        new StatBoostOnFlagAttackAbAttr({
          flag: MoveFlags.BITING_MOVE,
          stat: Stat.ATK,
          stages: 1.5,
        }),
    ).toThrow();
  });

  it("fires when the used move carries the configured flag (Growing Tooth, biting)", () => {
    const attr = new StatBoostOnFlagAttackAbAttr({
      flag: MoveFlags.BITING_MOVE,
      stat: Stat.ATK,
      stages: 1,
    });
    const user = makeStubAttacker({ battlerIndex: 3 });
    const target = makeStubAttacker();
    const move = makeStubMove({ flags: [MoveFlags.BITING_MOVE, MoveFlags.MAKES_CONTACT] });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 3, true, [Stat.ATK], 1);
  });

  it("does NOT fire when the move lacks the configured flag", () => {
    const attr = new StatBoostOnFlagAttackAbAttr({
      flag: MoveFlags.BITING_MOVE,
      stat: Stat.ATK,
      stages: 1,
    });
    const user = makeStubAttacker();
    const target = makeStubAttacker();
    const move = makeStubMove({ flags: [MoveFlags.MAKES_CONTACT] });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("does NOT fire when the move is a status move (PostAttackAbAttr default condition)", () => {
    const attr = new StatBoostOnFlagAttackAbAttr({
      flag: MoveFlags.HORN_BASED,
      stat: Stat.ATK,
      stages: 1,
    });
    const user = makeStubAttacker();
    const target = makeStubAttacker();
    const move = makeStubMove({ flags: [MoveFlags.HORN_BASED], isStatus: true });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("simulated runs queue no phase", () => {
    const attr = new StatBoostOnFlagAttackAbAttr({
      flag: MoveFlags.HORN_BASED,
      stat: Stat.ATK,
      stages: 1,
    });
    const user = makeStubAttacker();
    const target = makeStubAttacker();
    const move = makeStubMove({ flags: [MoveFlags.HORN_BASED] });
    const params = makeParams({ user, target, move, simulated: true });
    attr.apply(params);
    expect(unshiftNew).not.toHaveBeenCalled();
  });

  it("Hardened Sheath wiring: horn-based, +1 ATK", () => {
    const attr = new StatBoostOnFlagAttackAbAttr({
      flag: MoveFlags.HORN_BASED,
      stat: Stat.ATK,
      stages: 1,
    });
    const user = makeStubAttacker({ battlerIndex: 1 });
    const target = makeStubAttacker();
    const move = makeStubMove({ flags: [MoveFlags.HORN_BASED] });
    const params = makeParams({ user, target, move });
    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 1, true, [Stat.ATK], 1);
  });
});
