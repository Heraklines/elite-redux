/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke tests: stat-change-on-category-attack cluster.
//
// Covers ER ability Whiplash (#722) — "Physical attacks lower defense". Uses
// a stub `globalScene.phaseManager` to capture queued StatStageChangePhase
// calls, verifying the proc fires on the configured category and targets the
// configured side (self or opponent).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { StatChangeOnCategoryAttackAbAttr } from "#data/elite-redux/abilities/stat-change-on-category-attack";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
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

function makeStubMon(opts: { battlerIndex?: number } = {}): Pokemon {
  return {
    getBattlerIndex: () => opts.battlerIndex ?? 0,
  } as unknown as Pokemon;
}

function makeStubMove(opts: { category: MoveCategory }): Move {
  return {
    category: opts.category,
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

describe("StatChangeOnCategoryAttackAbAttr", () => {
  it("constructs and exposes accessors", () => {
    const attr = new StatChangeOnCategoryAttackAbAttr({
      category: MoveCategory.PHYSICAL,
      stat: Stat.DEF,
      stages: -1,
      target: "opponent",
    });
    expect(attr.getCategory()).toBe(MoveCategory.PHYSICAL);
    expect(attr.getStat()).toBe(Stat.DEF);
    expect(attr.getStages()).toBe(-1);
    expect(attr.getTarget()).toBe("opponent");
  });

  it("rejects stages=0 and non-integer", () => {
    expect(
      () =>
        new StatChangeOnCategoryAttackAbAttr({
          category: MoveCategory.PHYSICAL,
          stat: Stat.DEF,
          stages: 0,
          target: "opponent",
        }),
    ).toThrow();
    expect(
      () =>
        new StatChangeOnCategoryAttackAbAttr({
          category: MoveCategory.PHYSICAL,
          stat: Stat.DEF,
          stages: -1.5,
          target: "opponent",
        }),
    ).toThrow();
  });

  it("Whiplash wiring: fires on PHYSICAL category, drops opponent DEF by -1", () => {
    const attr = new StatChangeOnCategoryAttackAbAttr({
      category: MoveCategory.PHYSICAL,
      stat: Stat.DEF,
      stages: -1,
      target: "opponent",
    });
    const user = makeStubMon({ battlerIndex: 0 });
    const target = makeStubMon({ battlerIndex: 2 });
    const move = makeStubMove({ category: MoveCategory.PHYSICAL });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    // Target's battlerIndex, selfTarget=false, [DEF], -1.
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 2, false, [Stat.DEF], -1);
  });

  it("does NOT fire when the move's category mismatches", () => {
    const attr = new StatChangeOnCategoryAttackAbAttr({
      category: MoveCategory.PHYSICAL,
      stat: Stat.DEF,
      stages: -1,
      target: "opponent",
    });
    const user = makeStubMon();
    const target = makeStubMon();
    const move = makeStubMove({ category: MoveCategory.SPECIAL });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("does NOT fire on STATUS moves (PostAttackAbAttr default condition)", () => {
    const attr = new StatChangeOnCategoryAttackAbAttr({
      category: MoveCategory.PHYSICAL,
      stat: Stat.DEF,
      stages: -1,
      target: "opponent",
    });
    const user = makeStubMon();
    const target = makeStubMon();
    const move = makeStubMove({ category: MoveCategory.STATUS });
    const params = makeParams({ user, target, move });
    expect(attr.canApply(params)).toBe(false);
  });

  it("target=self routes the change to the user (selfTarget=true)", () => {
    const attr = new StatChangeOnCategoryAttackAbAttr({
      category: MoveCategory.SPECIAL,
      stat: Stat.SPATK,
      stages: 1,
      target: "self",
    });
    const user = makeStubMon({ battlerIndex: 5 });
    const target = makeStubMon({ battlerIndex: 3 });
    const move = makeStubMove({ category: MoveCategory.SPECIAL });
    const params = makeParams({ user, target, move });
    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 5, true, [Stat.SPATK], 1);
  });

  it("simulated runs queue no phase", () => {
    const attr = new StatChangeOnCategoryAttackAbAttr({
      category: MoveCategory.PHYSICAL,
      stat: Stat.DEF,
      stages: -1,
      target: "opponent",
    });
    const user = makeStubMon();
    const target = makeStubMon();
    const move = makeStubMove({ category: MoveCategory.PHYSICAL });
    const params = makeParams({ user, target, move, simulated: true });
    attr.apply(params);
    expect(unshiftNew).not.toHaveBeenCalled();
  });
});
