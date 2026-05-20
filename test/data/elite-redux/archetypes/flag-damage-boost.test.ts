/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: tests for the `flag-damage-boost` archetype.
//
// As with type-damage-boost, we exercise the archetype primitive directly.
// The flag-keyed gating logic is structurally identical to type-damage-boost
// (the only difference is what predicate the super-class condition checks),
// so the tests mirror the type-damage suite point-for-point and add a few
// flag-specific cases (multi-bit composite flags, NONE rejection, etc).
// =============================================================================

import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { MoveFlags } from "#enums/move-flags";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

/**
 * Stub pokemon — the flag predicate doesn't read pokemon fields (only the
 * move's flag bits), but the apply path reads `getHpRatio(true)` so we stub
 * that too.
 */
function makeStubPokemon(opts: { hpRatio?: number }): Pokemon {
  const hpRatio = opts.hpRatio ?? 1;
  return {
    getHpRatio: (_precise = false) => hpRatio,
    // getMoveType is provided so we don't trip type-related code paths anywhere
    // downstream — it's not used by the flag-damage-boost predicate itself.
    getMoveType: (move: Move) => move.type,
  } as unknown as Pokemon;
}

/**
 * Build a duck-typed `move` stub with the given flags bitmask. The archetype
 * reads via `move.hasFlag()`, which delegates to the bitwise AND on the
 * (private) `flags` field — we mirror that contract in the stub.
 */
function makeStubMove(flags: MoveFlags): Move {
  return {
    flags,
    hasFlag(flag: MoveFlags) {
      return (flags & flag) !== MoveFlags.NONE;
    },
  } as unknown as Move;
}

function runBoost(opts: { attr: FlagDamageBoostAbAttr; pokemon: Pokemon; move: Move; initialPower: number }): {
  fired: boolean;
  finalPower: number;
} {
  const power = new NumberHolder(opts.initialPower);
  const params = {
    pokemon: opts.pokemon,
    opponent: opts.pokemon,
    move: opts.move,
    power,
    simulated: true,
  } as unknown as Parameters<FlagDamageBoostAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalPower: power.value };
}

describe("FlagDamageBoostAbAttr archetype (C1)", () => {
  it("applies the multiplier when the move carries the configured flag", () => {
    const attr = new FlagDamageBoostAbAttr({ flag: MoveFlags.PUNCHING_MOVE, multiplier: 1.3 });
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({}),
      move: makeStubMove(MoveFlags.PUNCHING_MOVE),
      initialPower: 100,
    });
    expect(result.fired).toBe(true);
    expect(result.finalPower).toBeCloseTo(130, 5);
  });

  it("does NOT fire when the move lacks the configured flag", () => {
    const attr = new FlagDamageBoostAbAttr({ flag: MoveFlags.SLICING_MOVE, multiplier: 1.3 });
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({}),
      move: makeStubMove(MoveFlags.PUNCHING_MOVE),
      initialPower: 100,
    });
    expect(result.fired).toBe(false);
    expect(result.finalPower).toBe(100);
  });

  it("any-of semantics: composite flag matches when the move has either bit", () => {
    // Mighty Horn-style: any of (a configured composite of two bits) triggers
    // the boost. We use PUNCHING_MOVE | SLICING_MOVE for the test.
    const attr = new FlagDamageBoostAbAttr({
      flag: MoveFlags.PUNCHING_MOVE | MoveFlags.SLICING_MOVE,
      multiplier: 1.3,
    });
    // Move has SLICING only — should fire.
    const slicing = runBoost({
      attr,
      pokemon: makeStubPokemon({}),
      move: makeStubMove(MoveFlags.SLICING_MOVE),
      initialPower: 100,
    });
    expect(slicing.fired).toBe(true);
    expect(slicing.finalPower).toBeCloseTo(130, 5);

    // Move has PUNCHING only — should also fire.
    const punching = runBoost({
      attr,
      pokemon: makeStubPokemon({}),
      move: makeStubMove(MoveFlags.PUNCHING_MOVE),
      initialPower: 100,
    });
    expect(punching.fired).toBe(true);
    expect(punching.finalPower).toBeCloseTo(130, 5);

    // Move has neither — should not fire.
    const neither = runBoost({
      attr,
      pokemon: makeStubPokemon({}),
      move: makeStubMove(MoveFlags.SOUND_BASED),
      initialPower: 100,
    });
    expect(neither.fired).toBe(false);
    expect(neither.finalPower).toBe(100);
  });

  it("multi-flag move (move has multiple bits set) triggers the boost when one matches", () => {
    const attr = new FlagDamageBoostAbAttr({ flag: MoveFlags.BITING_MOVE, multiplier: 1.5 });
    // Move has both BITING and PUNCHING bits — the boost should fire (BITING matched).
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({}),
      move: makeStubMove(MoveFlags.BITING_MOVE | MoveFlags.PUNCHING_MOVE),
      initialPower: 100,
    });
    expect(result.fired).toBe(true);
    expect(result.finalPower).toBeCloseTo(150, 5);
  });

  it("uses lowHpMultiplier when subject HP is strictly below the threshold", () => {
    const attr = new FlagDamageBoostAbAttr({
      flag: MoveFlags.BALLBOMB_MOVE,
      multiplier: 1.2,
      lowHpMultiplier: 1.8,
    });
    const result = runBoost({
      attr,
      pokemon: makeStubPokemon({ hpRatio: 0.3 }),
      move: makeStubMove(MoveFlags.BALLBOMB_MOVE),
      initialPower: 100,
    });
    expect(result.fired).toBe(true);
    expect(result.finalPower).toBeCloseTo(180, 5);
  });

  it("default lowHpThreshold is 1/3 — boundary picks high-HP branch", () => {
    const attr = new FlagDamageBoostAbAttr({
      flag: MoveFlags.SOUND_BASED,
      multiplier: 1.2,
      lowHpMultiplier: 1.6,
    });
    expect(attr.getLowHpThreshold()).toBeCloseTo(1 / 3, 10);
    // At the threshold exactly → high-HP branch
    expect(attr.resolveMultiplier(1 / 3)).toBe(1.2);
    // Strictly below → low-HP branch
    expect(attr.resolveMultiplier(0.333)).toBe(1.6);
  });

  it("exposes its configuration via accessors", () => {
    const attr = new FlagDamageBoostAbAttr({
      flag: MoveFlags.DANCE_MOVE,
      multiplier: 1.4,
      lowHpMultiplier: 2.0,
      lowHpThreshold: 0.5,
    });
    expect(attr.getBoostFlag()).toBe(MoveFlags.DANCE_MOVE);
    expect(attr.getHighHpMultiplier()).toBe(1.4);
    expect(attr.getLowHpMultiplier()).toBe(2.0);
    expect(attr.getLowHpThreshold()).toBe(0.5);
  });

  it("rejects MoveFlags.NONE at construction time", () => {
    expect(() => new FlagDamageBoostAbAttr({ flag: MoveFlags.NONE, multiplier: 1.5 })).toThrow(
      /non-NONE MoveFlags bit/,
    );
  });

  it("rejects non-positive multipliers at construction time", () => {
    expect(() => new FlagDamageBoostAbAttr({ flag: MoveFlags.SOUND_BASED, multiplier: 0 })).toThrow(
      /multiplier must be > 0/,
    );
    expect(
      () =>
        new FlagDamageBoostAbAttr({
          flag: MoveFlags.SOUND_BASED,
          multiplier: 1,
          lowHpMultiplier: -0.5,
        }),
    ).toThrow(/lowHpMultiplier must be > 0/);
  });
});
