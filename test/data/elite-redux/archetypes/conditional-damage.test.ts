/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: tests for the `conditional-damage` archetype.
//
// As with the other power-boost archetypes (type-damage-boost,
// flag-damage-boost), we exercise the archetype primitive directly. The
// condition discriminator branches are tested both at the static
// `evaluateCondition` level (each condition kind in isolation) and through
// the full apply path (canApply → apply mutates power).
// =============================================================================

import { ConditionalDamageAbAttr, type DamageCondition } from "#data/elite-redux/archetypes/conditional-damage";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

type StubPokemonOpts = {
  hpRatio?: number;
  status?: StatusEffect | null;
  confused?: boolean;
  statStages?: Partial<Record<Stat, number>>;
};

function makeStubPokemon(opts: StubPokemonOpts = {}): Pokemon {
  const stages: Partial<Record<Stat, number>> = opts.statStages ?? {};
  return {
    getHpRatio: () => opts.hpRatio ?? 1,
    status: opts.status == null ? null : { effect: opts.status },
    getTag: (tag: BattlerTagType) => {
      if (tag === BattlerTagType.CONFUSED && opts.confused) {
        return {};
      }
      return null;
    },
    getStatStage: (stat: Stat) => stages[stat] ?? 0,
  } as unknown as Pokemon;
}

function makeStubMove(): Move {
  return {} as unknown as Move;
}

function runBoost(opts: { attr: ConditionalDamageAbAttr; subject: Pokemon; target: Pokemon; initialPower: number }): {
  fired: boolean;
  finalPower: number;
} {
  const power = new NumberHolder(opts.initialPower);
  const params = {
    pokemon: opts.subject,
    opponent: opts.target,
    move: makeStubMove(),
    power,
    simulated: true,
  } as unknown as Parameters<ConditionalDamageAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalPower: power.value };
}

describe("ConditionalDamageAbAttr archetype (C1)", () => {
  describe("target-statused condition", () => {
    it("Dreamcatcher-style: fires when target has SLEEP", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-statused", statuses: [StatusEffect.SLEEP] },
        multiplier: 2.0,
      });
      const result = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ status: StatusEffect.SLEEP }),
        initialPower: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(200);
    });

    it("does NOT fire when target's status is not in the configured set", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-statused", statuses: [StatusEffect.SLEEP] },
        multiplier: 2.0,
      });
      const result = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ status: StatusEffect.BURN }),
        initialPower: 100,
      });
      expect(result.fired).toBe(false);
      expect(result.finalPower).toBe(100);
    });

    it("any-status variant: fires when target has any non-null status", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-statused" }, // no `statuses` → any status
        multiplier: 1.5,
      });
      expect(
        runBoost({
          attr,
          subject: makeStubPokemon(),
          target: makeStubPokemon({ status: StatusEffect.POISON }),
          initialPower: 100,
        }).finalPower,
      ).toBe(150);
    });

    it("any-status variant: does NOT fire on unstatused target", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-statused" },
        multiplier: 1.5,
      });
      const result = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ status: null }),
        initialPower: 100,
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("target-low-hp condition", () => {
    it("fires when target HP ratio is at-or-below default threshold (0.5)", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-low-hp" },
        multiplier: 1.5,
      });
      // hpRatio = 0.5 → at threshold → fires
      const at = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ hpRatio: 0.5 }),
        initialPower: 100,
      });
      expect(at.fired).toBe(true);
      // hpRatio = 0.3 → below threshold → fires
      const below = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ hpRatio: 0.3 }),
        initialPower: 100,
      });
      expect(below.fired).toBe(true);
      // hpRatio = 0.6 → above threshold → does not fire
      const above = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ hpRatio: 0.6 }),
        initialPower: 100,
      });
      expect(above.fired).toBe(false);
    });

    it("respects a custom threshold", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-low-hp", threshold: 0.25 },
        multiplier: 2.0,
      });
      expect(
        runBoost({
          attr,
          subject: makeStubPokemon(),
          target: makeStubPokemon({ hpRatio: 0.25 }),
          initialPower: 100,
        }).fired,
      ).toBe(true);
      expect(
        runBoost({
          attr,
          subject: makeStubPokemon(),
          target: makeStubPokemon({ hpRatio: 0.3 }),
          initialPower: 100,
        }).fired,
      ).toBe(false);
    });
  });

  describe("self-low-hp condition", () => {
    it("fires based on subject HP, not target HP", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "self-low-hp" },
        multiplier: 1.5,
      });
      // Subject is at 30% HP, target at full → should fire (subject's HP is what matters).
      const result = runBoost({
        attr,
        subject: makeStubPokemon({ hpRatio: 0.3 }),
        target: makeStubPokemon({ hpRatio: 1 }),
        initialPower: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(150);
    });
  });

  describe("target-confused condition", () => {
    it("Cosmic Daze-style: fires when target has CONFUSED tag", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-confused" },
        multiplier: 2.0,
      });
      const result = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ confused: true }),
        initialPower: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(200);
    });

    it("does NOT fire when target is not confused", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-confused" },
        multiplier: 2.0,
      });
      const result = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ confused: false }),
        initialPower: 100,
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("target-has-lowered-stat condition", () => {
    it("Pretty Princess-style: fires when target has any lowered stat", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-has-lowered-stat" },
        multiplier: 1.5,
      });
      const result = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ statStages: { [Stat.ATK]: -1 } }),
        initialPower: 100,
      });
      expect(result.fired).toBe(true);
    });

    it("does NOT fire when no stats are lowered (only raises and zero)", () => {
      const attr = new ConditionalDamageAbAttr({
        condition: { kind: "target-has-lowered-stat" },
        multiplier: 1.5,
      });
      const result = runBoost({
        attr,
        subject: makeStubPokemon(),
        target: makeStubPokemon({ statStages: { [Stat.ATK]: 2, [Stat.SPD]: 0 } }),
        initialPower: 100,
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("validation + accessors", () => {
    it("rejects non-positive multipliers at construction time", () => {
      expect(
        () =>
          new ConditionalDamageAbAttr({
            condition: { kind: "target-statused" },
            multiplier: 0,
          }),
      ).toThrow(/multiplier must be > 0/);
    });

    it("exposes its configuration via accessors", () => {
      const condition: DamageCondition = { kind: "target-low-hp", threshold: 0.25 };
      const attr = new ConditionalDamageAbAttr({ condition, multiplier: 1.5 });
      expect(attr.getDamageCondition()).toEqual(condition);
      expect(attr.getMultiplier()).toBe(1.5);
    });
  });
});
