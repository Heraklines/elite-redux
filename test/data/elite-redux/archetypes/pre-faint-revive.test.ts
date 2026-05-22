/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: tests for the `pre-faint-revive` archetype.
//
// The archetype's canApply checks four conditions in sequence: HP gate match,
// max-HP > 1, damage >= hp, and no existing STURDY tag. Tests exercise each
// gate's matching predicate plus the validation path.
// =============================================================================

import { PreFaintReviveAbAttr } from "#data/elite-redux/archetypes/pre-faint-revive";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { Pokemon } from "#field/pokemon";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

type StubOpts = {
  hp?: number;
  maxHp?: number;
  fullHp?: boolean;
  hasSturdy?: boolean;
  hitCount?: number;
};

function makeStubPokemon(opts: StubOpts = {}): Pokemon {
  const hp = opts.hp ?? 100;
  const maxHp = opts.maxHp ?? 100;
  return {
    id: 1,
    hp,
    isFullHp: () => opts.fullHp ?? hp === maxHp,
    getMaxHp: () => maxHp,
    getHpRatio: (_precise = false) => hp / maxHp,
    getTag: (tag: BattlerTagType) => (tag === BattlerTagType.STURDY && opts.hasSturdy ? {} : null),
    addTag: () => {},
    // `battleData.hitCount` is the persistent counter the `first-n-hits` usage
    // policy gates on; we stub it as a plain numeric field. The real engine
    // increments this post-damage in `move-effect-phase.ts:705`.
    battleData: { hitCount: opts.hitCount ?? 0 },
  } as unknown as Pokemon;
}

function makeParams(opts: { pokemon: Pokemon; damageValue: number; simulated?: boolean }) {
  return {
    pokemon: opts.pokemon,
    damage: new NumberHolder(opts.damageValue),
    simulated: opts.simulated ?? false,
  } as unknown as Parameters<PreFaintReviveAbAttr["apply"]>[0];
}

describe("PreFaintReviveAbAttr archetype (C1d)", () => {
  describe("full-hp gate (Sturdy default)", () => {
    it("fires when at full HP and damage would KO", () => {
      const attr = new PreFaintReviveAbAttr();
      const pokemon = makeStubPokemon({ hp: 100, maxHp: 100 });
      const params = makeParams({ pokemon, damageValue: 150 });
      expect(attr.canApply(params)).toBe(true);
    });

    it("does NOT fire when not at full HP", () => {
      const attr = new PreFaintReviveAbAttr();
      const pokemon = makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false });
      const params = makeParams({ pokemon, damageValue: 100 });
      expect(attr.canApply(params)).toBe(false);
    });

    it("does NOT fire when damage wouldn't actually KO", () => {
      const attr = new PreFaintReviveAbAttr();
      const pokemon = makeStubPokemon({ hp: 100, maxHp: 100 });
      const params = makeParams({ pokemon, damageValue: 50 });
      expect(attr.canApply(params)).toBe(false);
    });

    it("does NOT fire when max HP is 1 (no room to clamp)", () => {
      const attr = new PreFaintReviveAbAttr();
      const pokemon = makeStubPokemon({ hp: 1, maxHp: 1 });
      const params = makeParams({ pokemon, damageValue: 1 });
      expect(attr.canApply(params)).toBe(false);
    });

    it("does NOT fire when STURDY tag is already present", () => {
      const attr = new PreFaintReviveAbAttr();
      const pokemon = makeStubPokemon({ hp: 100, maxHp: 100, hasSturdy: true });
      const params = makeParams({ pokemon, damageValue: 150 });
      expect(attr.canApply(params)).toBe(false);
    });
  });

  describe("hp-threshold gate", () => {
    it("fires when HP ratio is at-or-above the threshold", () => {
      const attr = new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0.5 } });
      // At threshold (boundary inclusive)
      expect(
        attr.canApply(
          makeParams({ pokemon: makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false }), damageValue: 100 }),
        ),
      ).toBe(true);
      // Above threshold
      expect(
        attr.canApply(
          makeParams({ pokemon: makeStubPokemon({ hp: 75, maxHp: 100, fullHp: false }), damageValue: 100 }),
        ),
      ).toBe(true);
    });

    it("does NOT fire when HP ratio is below the threshold", () => {
      const attr = new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0.5 } });
      expect(
        attr.canApply(
          makeParams({ pokemon: makeStubPokemon({ hp: 40, maxHp: 100, fullHp: false }), damageValue: 100 }),
        ),
      ).toBe(false);
    });

    it("threshold = 0 fires even on 1 HP", () => {
      const attr = new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0 } });
      const pokemon = makeStubPokemon({ hp: 1, maxHp: 100, fullHp: false });
      const params = makeParams({ pokemon, damageValue: 100 });
      expect(attr.canApply(params)).toBe(true);
    });

    it("threshold = 1 is equivalent to full-HP gate", () => {
      const attr = new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 1 } });
      const fullHp = makeStubPokemon({ hp: 100, maxHp: 100 });
      const damaged = makeStubPokemon({ hp: 99, maxHp: 100, fullHp: false });
      expect(attr.canApply(makeParams({ pokemon: fullHp, damageValue: 150 }))).toBe(true);
      expect(attr.canApply(makeParams({ pokemon: damaged, damageValue: 150 }))).toBe(false);
    });
  });

  describe("matchesGate static helper", () => {
    it("evaluates full-hp gate via the isFullHp arg", () => {
      const attr = new PreFaintReviveAbAttr();
      expect(attr.matchesGate(1, true)).toBe(true);
      expect(attr.matchesGate(0.5, false)).toBe(false);
    });

    it("evaluates hp-threshold gate via the hpRatio arg", () => {
      const attr = new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0.3 } });
      expect(attr.matchesGate(0.3, false)).toBe(true);
      expect(attr.matchesGate(0.31, false)).toBe(true);
      expect(attr.matchesGate(0.29, false)).toBe(false);
    });
  });

  describe("accessors", () => {
    it("exposes the configured gate", () => {
      const attr = new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0.5 } });
      expect(attr.getGate()).toEqual({ kind: "hp-threshold", threshold: 0.5 });
    });

    it("defaults to full-hp gate when no options are passed", () => {
      const attr = new PreFaintReviveAbAttr();
      expect(attr.getGate()).toEqual({ kind: "full-hp" });
    });

    it("defaults usage to per-hit when no options are passed", () => {
      const attr = new PreFaintReviveAbAttr();
      expect(attr.getUsage()).toEqual({ kind: "per-hit" });
    });

    it("exposes the configured usage", () => {
      const attr = new PreFaintReviveAbAttr({ usage: { kind: "first-n-hits", n: 2 } });
      expect(attr.getUsage()).toEqual({ kind: "first-n-hits", n: 2 });
    });
  });

  describe("validation", () => {
    it("rejects hp-threshold below 0", () => {
      expect(() => new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: -0.1 } })).toThrow(
        /threshold must be in/,
      );
    });

    it("rejects hp-threshold above 1", () => {
      expect(() => new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 1.5 } })).toThrow(
        /threshold must be in/,
      );
    });

    it("accepts boundary thresholds (0 and 1)", () => {
      expect(() => new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 0 } })).not.toThrow();
      expect(() => new PreFaintReviveAbAttr({ gate: { kind: "hp-threshold", threshold: 1 } })).not.toThrow();
    });

    it("rejects first-n-hits n below 1", () => {
      expect(() => new PreFaintReviveAbAttr({ usage: { kind: "first-n-hits", n: 0 } })).toThrow(
        /first-n-hits n must be a positive integer/,
      );
    });

    it("rejects first-n-hits non-integer n", () => {
      expect(() => new PreFaintReviveAbAttr({ usage: { kind: "first-n-hits", n: 1.5 } })).toThrow(
        /first-n-hits n must be a positive integer/,
      );
    });
  });

  describe("first-n-hits usage policy", () => {
    it("fires when hitCount is below n (first hit, N=1, Gallantry-style)", () => {
      const attr = new PreFaintReviveAbAttr({
        gate: { kind: "hp-threshold", threshold: 0 },
        usage: { kind: "first-n-hits", n: 1 },
      });
      const pokemon = makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false, hitCount: 0 });
      expect(attr.canApply(makeParams({ pokemon, damageValue: 150 }))).toBe(true);
    });

    it("blocks fires after the Nth hit (Gallantry, N=1, hitCount=1)", () => {
      const attr = new PreFaintReviveAbAttr({
        gate: { kind: "hp-threshold", threshold: 0 },
        usage: { kind: "first-n-hits", n: 1 },
      });
      const pokemon = makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false, hitCount: 1 });
      expect(attr.canApply(makeParams({ pokemon, damageValue: 150 }))).toBe(false);
    });

    it("permits exactly N fires (Cheating Death, N=2)", () => {
      const attr = new PreFaintReviveAbAttr({
        gate: { kind: "hp-threshold", threshold: 0 },
        usage: { kind: "first-n-hits", n: 2 },
      });
      // hitCount=0 → first hit OK
      expect(
        attr.canApply(
          makeParams({
            pokemon: makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false, hitCount: 0 }),
            damageValue: 150,
          }),
        ),
      ).toBe(true);
      // hitCount=1 → second hit OK
      expect(
        attr.canApply(
          makeParams({
            pokemon: makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false, hitCount: 1 }),
            damageValue: 150,
          }),
        ),
      ).toBe(true);
      // hitCount=2 → third hit blocked
      expect(
        attr.canApply(
          makeParams({
            pokemon: makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false, hitCount: 2 }),
            damageValue: 150,
          }),
        ),
      ).toBe(false);
    });

    it("ignores the STURDY tag check under first-n-hits (the persistent counter is the source of truth)", () => {
      // Under per-hit, having STURDY tag blocks the proc. Under first-n-hits,
      // the STURDY tag is irrelevant — only hitCount matters.
      const attr = new PreFaintReviveAbAttr({
        gate: { kind: "hp-threshold", threshold: 0 },
        usage: { kind: "first-n-hits", n: 1 },
      });
      const pokemon = makeStubPokemon({ hp: 50, maxHp: 100, fullHp: false, hitCount: 0, hasSturdy: true });
      expect(attr.canApply(makeParams({ pokemon, damageValue: 150 }))).toBe(true);
    });
  });

  describe("matchesUsage helper", () => {
    it("per-hit returns true when STURDY tag is absent, false when present", () => {
      const attr = new PreFaintReviveAbAttr();
      expect(attr.matchesUsage(makeStubPokemon({ hasSturdy: false }))).toBe(true);
      expect(attr.matchesUsage(makeStubPokemon({ hasSturdy: true }))).toBe(false);
    });

    it("first-n-hits returns true when hitCount < n, false otherwise", () => {
      const attr = new PreFaintReviveAbAttr({ usage: { kind: "first-n-hits", n: 2 } });
      expect(attr.matchesUsage(makeStubPokemon({ hitCount: 0 }))).toBe(true);
      expect(attr.matchesUsage(makeStubPokemon({ hitCount: 1 }))).toBe(true);
      expect(attr.matchesUsage(makeStubPokemon({ hitCount: 2 }))).toBe(false);
      expect(attr.matchesUsage(makeStubPokemon({ hitCount: 3 }))).toBe(false);
    });
  });
});
