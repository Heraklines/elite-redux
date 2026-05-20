/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: tests for the `stat-trigger-on-event` archetype.
//
// The archetype splits across four subclasses (one per trigger surface). We
// test each subclass's `canApply` predicates and configuration accessors
// directly, mocking the global phase manager so we can assert the right
// `StatStageChangePhase` is unshifted on apply.
//
// We deliberately do NOT test through the C0 battle harness — the harness's
// current trigger set does not include PostKnockOut / PostStatStageChange
// dispatches, so direct unit testing is the cleanest tool for the math.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import {
  StatTriggerOnEntryAbAttr,
  StatTriggerOnHitAbAttr,
  StatTriggerOnKoAbAttr,
  StatTriggerOnStatLoweredAbAttr,
} from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

/**
 * The {@linkcode applyStatChanges} helper inside the archetype dispatches via
 * `globalScene.phaseManager.unshiftNew(...)`. We initialize the module-level
 * `globalScene` with a stub `BattleScene` so we can capture the calls without
 * spinning up the full scene.
 */
function mockPhaseManager(): Mock {
  const unshiftNew = vi.fn();
  initGlobalScene({ phaseManager: { unshiftNew } } as unknown as BattleScene);
  return unshiftNew;
}

function makeStubPokemon(): Pokemon {
  return {
    id: 1,
    getBattlerIndex: () => 0,
    // `getMoveType` is used by on-hit filtering: we return the move's "type" field directly.
    getMoveType: (move: Move) => (move as unknown as { type: PokemonType }).type,
  } as unknown as Pokemon;
}

function makeStubMove(opts: { type?: PokemonType | undefined; flags?: MoveFlags | undefined }): Move {
  const flags = opts.flags ?? MoveFlags.NONE;
  return {
    type: opts.type ?? PokemonType.NORMAL,
    flags,
    hasFlag(flag: MoveFlags) {
      return (flags & flag) !== MoveFlags.NONE;
    },
  } as unknown as Move;
}

describe("StatTriggerOnKoAbAttr archetype (C1)", () => {
  let unshiftNew: Mock;
  beforeEach(() => {
    unshiftNew = mockPhaseManager();
  });

  it("dispatches StatStageChangePhase for each configured change on apply", () => {
    const attr = new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] });
    const pokemon = makeStubPokemon();
    const victim = makeStubPokemon();
    attr.apply({ pokemon, victim, simulated: false });
    expect(unshiftNew).toHaveBeenCalledTimes(1);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 0, true, [Stat.ATK], 1);
  });

  it("dispatches one phase per stat change in a multi-stat payload", () => {
    const attr = new StatTriggerOnKoAbAttr({
      stats: [{ stat: Stat.ATK, stages: 1 } as const, { stat: Stat.SPD, stages: 2 } as const],
    });
    attr.apply({ pokemon: makeStubPokemon(), victim: makeStubPokemon(), simulated: false });
    expect(unshiftNew).toHaveBeenCalledTimes(2);
    expect(unshiftNew).toHaveBeenNthCalledWith(1, "StatStageChangePhase", 0, true, [Stat.ATK], 1);
    expect(unshiftNew).toHaveBeenNthCalledWith(2, "StatStageChangePhase", 0, true, [Stat.SPD], 2);
  });

  it("is a no-op when simulated is true", () => {
    const attr = new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] });
    attr.apply({ pokemon: makeStubPokemon(), victim: makeStubPokemon(), simulated: true });
    expect(unshiftNew).not.toHaveBeenCalled();
  });

  it("canApply always returns true", () => {
    const attr = new StatTriggerOnKoAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] });
    expect(attr.canApply({ pokemon: makeStubPokemon(), victim: makeStubPokemon(), simulated: false })).toBe(true);
  });

  it("exposes payload via accessors", () => {
    const stats = [{ stat: Stat.ATK, stages: 1 }] as const;
    const attr = new StatTriggerOnKoAbAttr({ stats });
    expect(attr.event).toBe("on-ko");
    expect(attr.getStatChanges()).toEqual(stats);
  });
});

describe("StatTriggerOnHitAbAttr archetype (C1)", () => {
  let unshiftNew: Mock;
  beforeEach(() => {
    unshiftNew = mockPhaseManager();
  });

  function makeHitParams(opts: {
    moveType?: PokemonType;
    moveFlags?: MoveFlags;
    hitResult?: HitResult;
    simulated?: boolean;
  }) {
    return {
      pokemon: makeStubPokemon(),
      opponent: makeStubPokemon(),
      move: makeStubMove({ type: opts.moveType, flags: opts.moveFlags }),
      hitResult: opts.hitResult ?? HitResult.EFFECTIVE,
      damage: 50,
      simulated: opts.simulated ?? false,
    };
  }

  it("fires unconditionally when no filter is configured", () => {
    const attr = new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.DEF, stages: 1 }] });
    const params = makeHitParams({ moveType: PokemonType.NORMAL });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 0, true, [Stat.DEF], 1);
  });

  it("Inflatable-style filter: fires only when hit by Flying or Fire", () => {
    const attr = new StatTriggerOnHitAbAttr({
      stats: [
        { stat: Stat.DEF, stages: 1 },
        { stat: Stat.SPDEF, stages: 1 },
      ],
      filter: { types: [PokemonType.FLYING, PokemonType.FIRE] },
    });
    expect(attr.canApply(makeHitParams({ moveType: PokemonType.FLYING }))).toBe(true);
    expect(attr.canApply(makeHitParams({ moveType: PokemonType.FIRE }))).toBe(true);
    expect(attr.canApply(makeHitParams({ moveType: PokemonType.WATER }))).toBe(false);
  });

  it("does NOT fire when the hit was NO_EFFECT or worse", () => {
    const attr = new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.DEF, stages: 1 }] });
    expect(attr.canApply(makeHitParams({ hitResult: HitResult.NO_EFFECT }))).toBe(false);
    expect(attr.canApply(makeHitParams({ hitResult: HitResult.IMMUNE }))).toBe(false);
    expect(attr.canApply(makeHitParams({ hitResult: HitResult.MISS }))).toBe(false);
  });

  it("flag filter: composite of types AND flags must both match", () => {
    const attr = new StatTriggerOnHitAbAttr({
      stats: [{ stat: Stat.SPD, stages: 2 }],
      filter: { types: [PokemonType.ROCK], flags: [MoveFlags.PUNCHING_MOVE] },
    });
    // Right type, wrong flag → fail
    expect(attr.canApply(makeHitParams({ moveType: PokemonType.ROCK, moveFlags: MoveFlags.SLICING_MOVE }))).toBe(false);
    // Right type AND right flag → pass
    expect(attr.canApply(makeHitParams({ moveType: PokemonType.ROCK, moveFlags: MoveFlags.PUNCHING_MOVE }))).toBe(true);
    // Wrong type, right flag → fail
    expect(attr.canApply(makeHitParams({ moveType: PokemonType.WATER, moveFlags: MoveFlags.PUNCHING_MOVE }))).toBe(
      false,
    );
  });

  it("exposes the filter via accessor; null when omitted", () => {
    const noFilter = new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.DEF, stages: 1 }] });
    expect(noFilter.getFilter()).toBeNull();
    const withFilter = new StatTriggerOnHitAbAttr({
      stats: [{ stat: Stat.DEF, stages: 1 }],
      filter: { types: [PokemonType.FIRE] },
    });
    expect(withFilter.getFilter()).toEqual({ types: [PokemonType.FIRE] });
  });
});

describe("StatTriggerOnEntryAbAttr archetype (C1)", () => {
  let unshiftNew: Mock;
  beforeEach(() => {
    unshiftNew = mockPhaseManager();
  });

  it("dispatches StatStageChangePhase on entry", () => {
    const attr = new StatTriggerOnEntryAbAttr({ stats: [{ stat: Stat.SPDEF, stages: 1 }] });
    attr.apply({ pokemon: makeStubPokemon(), simulated: false });
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 0, true, [Stat.SPDEF], 1);
  });

  it("supports multi-stat payloads", () => {
    const attr = new StatTriggerOnEntryAbAttr({
      stats: [
        { stat: Stat.ATK, stages: 1 },
        { stat: Stat.DEF, stages: 1 },
      ],
    });
    attr.apply({ pokemon: makeStubPokemon(), simulated: false });
    expect(unshiftNew).toHaveBeenCalledTimes(2);
  });

  it("event discriminator is 'on-entry'", () => {
    const attr = new StatTriggerOnEntryAbAttr({ stats: [{ stat: Stat.SPDEF, stages: 1 }] });
    expect(attr.event).toBe("on-entry");
  });
});

describe("StatTriggerOnStatLoweredAbAttr archetype (C1)", () => {
  let unshiftNew: Mock;
  beforeEach(() => {
    unshiftNew = mockPhaseManager();
  });

  function makeStatChangeParams(opts: { stages: number; selfTarget?: boolean }) {
    // Cast `stats` through `as const` so TS infers the literal tuple type
    // `readonly [Stat.ATK]`, which is assignable to `readonly BattleStat[]`.
    // Without this, TS widens to `Stat[]` (which includes Stat.HP and so isn't
    // a BattleStat[]).
    return {
      pokemon: makeStubPokemon(),
      stats: [Stat.ATK] as const,
      stages: opts.stages,
      selfTarget: opts.selfTarget ?? false,
      simulated: false,
    };
  }

  it("Narcissist-style: fires when a stat was lowered by another source", () => {
    const attr = new StatTriggerOnStatLoweredAbAttr({
      stats: [
        { stat: Stat.ATK, stages: 2 },
        { stat: Stat.SPATK, stages: 2 },
      ],
    });
    expect(attr.canApply(makeStatChangeParams({ stages: -1 }))).toBe(true);
    attr.apply(makeStatChangeParams({ stages: -1 }));
    expect(unshiftNew).toHaveBeenCalledTimes(2);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 0, true, [Stat.ATK], 2);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 0, true, [Stat.SPATK], 2);
  });

  it("does NOT fire on a raise (positive stages)", () => {
    const attr = new StatTriggerOnStatLoweredAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] });
    expect(attr.canApply(makeStatChangeParams({ stages: 1 }))).toBe(false);
  });

  it("does NOT fire when the source was the subject's own self-targeting move", () => {
    const attr = new StatTriggerOnStatLoweredAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] });
    expect(attr.canApply(makeStatChangeParams({ stages: -1, selfTarget: true }))).toBe(false);
  });
});

describe("Stat trigger archetype — validation", () => {
  it("rejects empty stats list", () => {
    expect(() => new StatTriggerOnKoAbAttr({ stats: [] })).toThrow(/at least one stat change/);
  });

  it("rejects a stat change with zero stages", () => {
    expect(
      () =>
        new StatTriggerOnHitAbAttr({
          stats: [{ stat: Stat.ATK, stages: 0 }],
        }),
    ).toThrow(/stages must be non-zero/);
  });
});
