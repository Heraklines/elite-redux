/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: tests for `damage-reduction-generic` archetype.
//
// Single-class archetype that extends pokerogue's
// `ReceivedMoveDamageMultiplierAbAttr`. Tests cover each `kind` of the
// `DamageReductionFilter` discriminator, construction validation, and the
// numeric reduction math (`multiplier = 1 - reduction`).
// =============================================================================

import { DamageReductionAbAttr } from "#data/elite-redux/archetypes/damage-reduction-generic";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

function makeStubMove(opts: { category?: MoveCategory; flags?: MoveFlags; type?: PokemonType } = {}): Move {
  const flags = opts.flags ?? MoveFlags.NONE;
  return {
    category: opts.category ?? MoveCategory.PHYSICAL,
    _type: opts.type ?? PokemonType.NORMAL,
    flags,
    hasFlag(flag: MoveFlags) {
      return (flags & flag) !== MoveFlags.NONE;
    },
  } as unknown as Move;
}

function makeStubDefender(opts: { hpRatio?: number; effectiveness?: number } = {}): Pokemon {
  const hpRatio = opts.hpRatio ?? 1;
  return {
    isFullHp: () => hpRatio === 1,
    getHpRatio: () => hpRatio,
    getAttackTypeEffectiveness: () => opts.effectiveness ?? 1,
  } as unknown as Pokemon;
}

function makeStubAttacker(): Pokemon {
  return {
    id: 2,
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
  } as unknown as Pokemon;
}

function runReduce(opts: {
  attr: DamageReductionAbAttr;
  target: Pokemon;
  attacker: Pokemon;
  move: Move;
  initialDamage?: number;
}): { fired: boolean; finalDamage: number } {
  const damage = new NumberHolder(opts.initialDamage ?? 100);
  const params = {
    pokemon: opts.target,
    opponent: opts.attacker,
    move: opts.move,
    damage,
    simulated: true,
  } as unknown as Parameters<DamageReductionAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalDamage: damage.value };
}

describe("DamageReductionAbAttr archetype (C1e)", () => {
  describe("filter — all damaging moves", () => {
    it("reduces damage from a physical move", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "all" } });
      const result = runReduce({
        attr,
        target: makeStubDefender(),
        attacker: makeStubAttacker(),
        move: makeStubMove({ category: MoveCategory.PHYSICAL }),
        initialDamage: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalDamage).toBe(50);
    });

    it("does NOT fire on a status move (zero-damage gate)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "all" } });
      const result = runReduce({
        attr,
        target: makeStubDefender(),
        attacker: makeStubAttacker(),
        move: makeStubMove({ category: MoveCategory.STATUS }),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("filter — by category", () => {
    it("fires only on special moves when category=SPECIAL (Fire-Scales-style)", () => {
      const attr = new DamageReductionAbAttr({
        reduction: 0.5,
        filter: { kind: "category", category: MoveCategory.SPECIAL },
      });
      // Special move → fires
      expect(
        runReduce({
          attr,
          target: makeStubDefender(),
          attacker: makeStubAttacker(),
          move: makeStubMove({ category: MoveCategory.SPECIAL }),
          initialDamage: 100,
        }).finalDamage,
      ).toBe(50);
      // Physical move → doesn't fire
      expect(
        runReduce({
          attr,
          target: makeStubDefender(),
          attacker: makeStubAttacker(),
          move: makeStubMove({ category: MoveCategory.PHYSICAL }),
          initialDamage: 100,
        }).fired,
      ).toBe(false);
    });

    it("fires only on physical moves when category=PHYSICAL", () => {
      const attr = new DamageReductionAbAttr({
        reduction: 0.4,
        filter: { kind: "category", category: MoveCategory.PHYSICAL },
      });
      expect(
        runReduce({
          attr,
          target: makeStubDefender(),
          attacker: makeStubAttacker(),
          move: makeStubMove({ category: MoveCategory.PHYSICAL }),
          initialDamage: 100,
        }).finalDamage,
      ).toBe(60);
    });
  });

  describe("filter — contact", () => {
    it("fires on contact moves", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "contact" } });
      const result = runReduce({
        attr,
        target: makeStubDefender(),
        attacker: makeStubAttacker(),
        move: makeStubMove({ flags: MoveFlags.MAKES_CONTACT }),
        initialDamage: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalDamage).toBe(50);
    });

    it("does NOT fire on non-contact moves", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "contact" } });
      const result = runReduce({
        attr,
        target: makeStubDefender(),
        attacker: makeStubAttacker(),
        move: makeStubMove({ flags: MoveFlags.NONE }),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("filter — super-effective", () => {
    it("fires when the type-chart effectiveness > 1 (Permafrost-style)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.35, filter: { kind: "super-effective" } });
      const result = runReduce({
        attr,
        target: makeStubDefender({ effectiveness: 2 }),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
        initialDamage: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalDamage).toBe(65);
    });

    it("does NOT fire when effectiveness = 1 (neutral)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "super-effective" } });
      const result = runReduce({
        attr,
        target: makeStubDefender({ effectiveness: 1 }),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
      });
      expect(result.fired).toBe(false);
    });

    it("does NOT fire when effectiveness < 1 (resisted)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "super-effective" } });
      const result = runReduce({
        attr,
        target: makeStubDefender({ effectiveness: 0.5 }),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("filter — resisted (Feathercoat)", () => {
    it("fires when effectiveness < 1 (not-very-effective)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.1111, filter: { kind: "resisted" } });
      const result = runReduce({
        attr,
        target: makeStubDefender({ effectiveness: 0.5 }),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
        initialDamage: 100,
      });
      expect(result.fired).toBe(true);
      // 100 * (1 - 0.1111) = 88.89, floored by toDmgValue → 88.
      expect(result.finalDamage).toBe(88);
    });

    it("does NOT fire on neutral (eff = 1) or immune (eff = 0)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.1111, filter: { kind: "resisted" } });
      expect(
        runReduce({
          attr,
          target: makeStubDefender({ effectiveness: 1 }),
          attacker: makeStubAttacker(),
          move: makeStubMove(),
        }).fired,
      ).toBe(false);
      expect(
        runReduce({
          attr,
          target: makeStubDefender({ effectiveness: 0 }),
          attacker: makeStubAttacker(),
          move: makeStubMove(),
        }).fired,
      ).toBe(false);
    });
  });

  describe("filter — full HP", () => {
    it("fires at full HP (Brain-Mass-style)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "full-hp" } });
      const result = runReduce({
        attr,
        target: makeStubDefender({ hpRatio: 1 }),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
        initialDamage: 100,
      });
      expect(result.fired).toBe(true);
      expect(result.finalDamage).toBe(50);
    });

    it("does NOT fire below full HP", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.5, filter: { kind: "full-hp" } });
      const result = runReduce({
        attr,
        target: makeStubDefender({ hpRatio: 0.5 }),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("reduction math", () => {
    it("reduction=0.1 → 10% off (Aura-Armor-style)", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.1, filter: { kind: "all" } });
      const result = runReduce({
        attr,
        target: makeStubDefender(),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
        initialDamage: 100,
      });
      // pokerogue's toDmgValue floors → 100 * 0.9 = 90
      expect(result.finalDamage).toBe(90);
    });

    it("reduction=0.65 → 65% off", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.65, filter: { kind: "all" } });
      const result = runReduce({
        attr,
        target: makeStubDefender(),
        attacker: makeStubAttacker(),
        move: makeStubMove(),
        initialDamage: 100,
      });
      // 100 * 0.35 = 35
      expect(result.finalDamage).toBe(35);
    });
  });

  describe("accessors", () => {
    it("exposes the configured reduction and filter", () => {
      const attr = new DamageReductionAbAttr({ reduction: 0.35, filter: { kind: "super-effective" } });
      expect(attr.getReduction()).toBe(0.35);
      expect(attr.getFilter()).toEqual({ kind: "super-effective" });
    });
  });

  describe("validation", () => {
    it("rejects reduction = 0 (no-op)", () => {
      expect(() => new DamageReductionAbAttr({ reduction: 0, filter: { kind: "all" } })).toThrow(/must be in/);
    });

    it("rejects reduction = 1 (full immunity belongs in type-resist)", () => {
      expect(() => new DamageReductionAbAttr({ reduction: 1, filter: { kind: "all" } })).toThrow(/must be in/);
    });

    it("rejects reduction > 1", () => {
      expect(() => new DamageReductionAbAttr({ reduction: 1.5, filter: { kind: "all" } })).toThrow(/must be in/);
    });

    it("rejects negative reduction", () => {
      expect(() => new DamageReductionAbAttr({ reduction: -0.1, filter: { kind: "all" } })).toThrow(/must be in/);
    });

    it("rejects category filter targeting STATUS", () => {
      expect(
        () =>
          new DamageReductionAbAttr({
            reduction: 0.5,
            filter: { kind: "category", category: MoveCategory.STATUS as never },
          }),
      ).toThrow(/cannot target MoveCategory.STATUS/);
    });
  });

  describe("static matchesFilter", () => {
    it("kind=all returns true for a damaging move", () => {
      const result = DamageReductionAbAttr.matchesFilter(
        { kind: "all" },
        makeStubDefender(),
        makeStubAttacker(),
        makeStubMove({ category: MoveCategory.PHYSICAL }),
      );
      expect(result).toBe(true);
    });

    it("kind=full-hp returns false at status moves even at full HP", () => {
      const result = DamageReductionAbAttr.matchesFilter(
        { kind: "full-hp" },
        makeStubDefender({ hpRatio: 1 }),
        makeStubAttacker(),
        makeStubMove({ category: MoveCategory.STATUS }),
      );
      expect(result).toBe(false);
    });
  });
});
