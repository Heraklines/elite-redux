/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: tests for the `immunity-with-absorb` archetype.
//
// We exercise the two subclasses (heal flavor + stat-boost flavor) directly.
// The heal subclass overrides `apply` to use a configurable healFraction, so
// the apply path is tested with a mocked phase manager. The stat-boost
// subclass just wraps pokerogue's existing TypeImmunityStatStageChangeAbAttr
// constructor — we verify it's parameterized correctly and that
// construction-time validation rejects zero-stage configs.
//
// canApply is inherited from pokerogue's TypeImmunityAbAttr (verified by the
// existing pokerogue test suite); we don't re-test the parent's gating here,
// only assert that our subclass plugs into it without breaking.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { TypeAbsorbHealAbAttr, TypeAbsorbStatBoostAbAttr } from "#data/elite-redux/archetypes/immunity-with-absorb";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { BooleanHolder, NumberHolder } from "#utils/value-holder";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

function mockPhaseManager(): Mock {
  const unshiftNew = vi.fn();
  initGlobalScene({ phaseManager: { unshiftNew } } as unknown as BattleScene);
  return unshiftNew;
}

function makeStubPokemon(opts: { isFullHp?: boolean; maxHp?: number; hp?: number } = {}): Pokemon {
  return {
    id: 1,
    isFullHp: () => opts.isFullHp ?? false,
    getMaxHp: () => opts.maxHp ?? 100,
    hp: opts.hp ?? 50,
    getBattlerIndex: () => 0,
    // getMoveType returns the move's type as-is (no Aerilate-style override).
    getMoveType: (move: Move) => (move as unknown as { type: PokemonType }).type,
  } as unknown as Pokemon;
}

function makeStubMove(type: PokemonType): Move {
  return {
    type,
    moveTarget: MoveTarget.NEAR_OTHER,
  } as unknown as Move;
}

/** Build canApply / apply params for the type-immunity flavor. */
function makeParams(opts: {
  defender: Pokemon;
  attacker: Pokemon;
  moveType: PokemonType;
  simulated?: boolean;
  initialTypeMultiplier?: number;
}) {
  const typeMultiplier = new NumberHolder(opts.initialTypeMultiplier ?? 1);
  const cancelled = new BooleanHolder(false);
  return {
    params: {
      pokemon: opts.defender,
      opponent: opts.attacker,
      move: makeStubMove(opts.moveType),
      typeMultiplier,
      cancelled,
      simulated: opts.simulated ?? false,
    } as unknown as Parameters<TypeAbsorbHealAbAttr["apply"]>[0],
    typeMultiplier,
    cancelled,
  };
}

describe("TypeAbsorbHealAbAttr archetype (C1)", () => {
  let unshiftNew: Mock;
  beforeEach(() => {
    unshiftNew = mockPhaseManager();
  });

  it("Water Absorb-style: defaults to 1/4 max HP heal when not configured", () => {
    const attr = new TypeAbsorbHealAbAttr({ type: PokemonType.WATER });
    expect(attr.getHealFraction()).toBe(1 / 4);
  });

  it("zeros the type multiplier and enqueues PokemonHealPhase when not at full HP", () => {
    const attr = new TypeAbsorbHealAbAttr({ type: PokemonType.WATER, healFraction: 0.5 });
    const { params, typeMultiplier, cancelled } = makeParams({
      defender: makeStubPokemon({ isFullHp: false, maxHp: 200 }),
      attacker: makeStubPokemon(),
      moveType: PokemonType.WATER,
    });
    attr.apply(params);
    expect(typeMultiplier.value).toBe(0);
    expect(cancelled.value).toBe(true);
    // 0.5 * 200 = 100 → heal phase enqueued with 100.
    expect(unshiftNew).toHaveBeenCalledWith("PokemonHealPhase", 0, 100, null, true);
  });

  it("does NOT heal (and leaves cancelled unset) when defender is at full HP", () => {
    const attr = new TypeAbsorbHealAbAttr({ type: PokemonType.WATER });
    const { params, typeMultiplier, cancelled } = makeParams({
      defender: makeStubPokemon({ isFullHp: true }),
      attacker: makeStubPokemon(),
      moveType: PokemonType.WATER,
    });
    attr.apply(params);
    expect(typeMultiplier.value).toBe(0); // still zeros the multiplier (immunity is unconditional)
    expect(cancelled.value).toBe(false); // no heal → no message suppression
    expect(unshiftNew).not.toHaveBeenCalled();
  });

  it("does NOT call the phase manager when simulated", () => {
    const attr = new TypeAbsorbHealAbAttr({ type: PokemonType.WATER });
    const { params, typeMultiplier } = makeParams({
      defender: makeStubPokemon({ isFullHp: false }),
      attacker: makeStubPokemon(),
      moveType: PokemonType.WATER,
      simulated: true,
    });
    attr.apply(params);
    expect(typeMultiplier.value).toBe(0);
    expect(unshiftNew).not.toHaveBeenCalled();
  });

  it("respects a custom healFraction (e.g. 1.0 for full-heal absorb)", () => {
    const attr = new TypeAbsorbHealAbAttr({ type: PokemonType.POISON, healFraction: 1 });
    const { params } = makeParams({
      defender: makeStubPokemon({ isFullHp: false, maxHp: 80 }),
      attacker: makeStubPokemon(),
      moveType: PokemonType.POISON,
    });
    attr.apply(params);
    // 1.0 * 80 = 80 → heal phase with 80.
    expect(unshiftNew).toHaveBeenCalledWith("PokemonHealPhase", 0, 80, null, true);
  });

  it("rejects out-of-range healFraction at construction time", () => {
    expect(() => new TypeAbsorbHealAbAttr({ type: PokemonType.WATER, healFraction: 0 })).toThrow(
      /healFraction must be in/,
    );
    expect(() => new TypeAbsorbHealAbAttr({ type: PokemonType.WATER, healFraction: -0.5 })).toThrow(
      /healFraction must be in/,
    );
    expect(() => new TypeAbsorbHealAbAttr({ type: PokemonType.WATER, healFraction: 1.5 })).toThrow(
      /healFraction must be in/,
    );
  });

  it("exposes the immune type via the inherited TypeImmunityAbAttr accessor", () => {
    const attr = new TypeAbsorbHealAbAttr({ type: PokemonType.WATER });
    expect(attr.getImmuneType()).toBe(PokemonType.WATER);
  });
});

describe("TypeAbsorbStatBoostAbAttr archetype (C1)", () => {
  let unshiftNew: Mock;
  beforeEach(() => {
    unshiftNew = mockPhaseManager();
  });

  it("Storm Drain-style: zeros type multiplier and queues StatStageChangePhase", () => {
    const attr = new TypeAbsorbStatBoostAbAttr({
      type: PokemonType.WATER,
      stat: Stat.SPATK,
      stages: 1,
    });
    const { params, typeMultiplier, cancelled } = makeParams({
      defender: makeStubPokemon(),
      attacker: makeStubPokemon(),
      moveType: PokemonType.WATER,
    });
    attr.apply(params);
    expect(typeMultiplier.value).toBe(0);
    expect(cancelled.value).toBe(true);
    expect(unshiftNew).toHaveBeenCalledWith("StatStageChangePhase", 0, true, [Stat.SPATK], 1);
  });

  it("does NOT queue the phase when simulated", () => {
    const attr = new TypeAbsorbStatBoostAbAttr({
      type: PokemonType.ELECTRIC,
      stat: Stat.SPD,
      stages: 1,
    });
    const { params, typeMultiplier } = makeParams({
      defender: makeStubPokemon(),
      attacker: makeStubPokemon(),
      moveType: PokemonType.ELECTRIC,
      simulated: true,
    });
    attr.apply(params);
    expect(typeMultiplier.value).toBe(0);
    expect(unshiftNew).not.toHaveBeenCalled();
  });

  it("rejects zero-stage configurations at construction time", () => {
    expect(
      () =>
        new TypeAbsorbStatBoostAbAttr({
          type: PokemonType.WATER,
          stat: Stat.ATK,
          stages: 0,
        }),
    ).toThrow(/stages must be non-zero/);
  });

  it("exposes the immune type via the inherited accessor", () => {
    const attr = new TypeAbsorbStatBoostAbAttr({
      type: PokemonType.GRASS,
      stat: Stat.ATK,
      stages: 1,
    });
    expect(attr.getImmuneType()).toBe(PokemonType.GRASS);
  });
});
