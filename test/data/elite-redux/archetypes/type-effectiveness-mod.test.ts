/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Round 10 of the bespoke ability grind: tests for the
// `type-effectiveness-mod` archetype primitive.
//
// We exercise the archetype factory and its two AbAttrs directly. The
// offensive side gates on the *defender's* type (a `MovePowerBoostAbAttr`
// subclass); the defensive side gates on the *incoming move's* type
// (a stock `ReceivedTypeDamageMultiplierAbAttr` from pokerogue). Both
// are pure transformations of holders (`power` for offense, `damage` for
// defense) — no battle harness needed.
// =============================================================================

import { ReceivedTypeDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import {
  buildTypeEffectivenessModAttrs,
  OffensiveTypeMultiplierAbAttr,
} from "#data/elite-redux/archetypes/type-effectiveness-mod";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { NumberHolder } from "#utils/value-holder";
import { describe, expect, it } from "vitest";

/**
 * Build a duck-typed `pokemon` stub whose `isOfType(type)` returns true iff
 * `type` is in the configured `defenderTypes` list. We model the same
 * `includeTeraType: true` semantics that the real `Pokemon.isOfType` provides
 * by allowing callers to pass `teraType` directly into `defenderTypes` — the
 * primitive doesn't distinguish.
 */
function makeStubDefender(opts: { defenderTypes: PokemonType[] }): Pokemon {
  let currentTypes = [...opts.defenderTypes];
  return {
    isOfType: (type: PokemonType) => currentTypes.includes(type),
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
    // Test helper: mutate the type list (simulates a Soak-style mid-battle
    // type override).
    setTypes: (next: PokemonType[]) => {
      currentTypes = [...next];
    },
  } as unknown as Pokemon;
}

/** Build a duck-typed user (attacker for offensive tests). Same shape as the type-damage-boost helper. */
function makeStubAttacker(): Pokemon {
  return {
    getMoveType: (move: Move) => (move as unknown as { _type: PokemonType })._type,
  } as unknown as Pokemon;
}

/** Build a duck-typed move with a configured type. */
function makeStubMove(type: PokemonType): Move {
  return { _type: type } as unknown as Move;
}

/**
 * Run the offensive attr's `canApply` + `apply` against a defender, returning
 * whether it fired and the resulting `power.value`. Mirrors what the dispatcher
 * does at PreAttack time.
 */
function runOffense(opts: {
  attr: OffensiveTypeMultiplierAbAttr;
  attacker: Pokemon;
  defender: Pokemon;
  move: Move;
  initialPower?: number;
}): { fired: boolean; finalPower: number } {
  const power = new NumberHolder(opts.initialPower ?? 100);
  const params = {
    pokemon: opts.attacker,
    opponent: opts.defender,
    move: opts.move,
    power,
    simulated: true,
  } as unknown as Parameters<OffensiveTypeMultiplierAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalPower: power.value };
}

/**
 * Run the defensive attr's `canApply` + `apply` against an incoming move,
 * returning whether it fired and the resulting `damage.value`. Mirrors what
 * pokerogue does at PreDefend time.
 */
function runDefense(opts: {
  attr: ReceivedTypeDamageMultiplierAbAttr;
  defender: Pokemon;
  attacker: Pokemon;
  move: Move;
  initialDamage?: number;
}): { fired: boolean; finalDamage: number } {
  const damage = new NumberHolder(opts.initialDamage ?? 100);
  const params = {
    pokemon: opts.defender,
    opponent: opts.attacker,
    move: opts.move,
    damage,
    simulated: true,
  } as unknown as Parameters<ReceivedTypeDamageMultiplierAbAttr["apply"]>[0];
  const canFire = opts.attr.canApply(params);
  if (canFire) {
    opts.attr.apply(params);
  }
  return { fired: canFire, finalDamage: damage.value };
}

describe("buildTypeEffectivenessModAttrs (R10 type-effectiveness-mod)", () => {
  describe("constructed AbAttr pair (offensive + defensive)", () => {
    it("returns both attrs in offensive-then-defensive order for the symmetric Dragonslayer shape", () => {
      const attrs = buildTypeEffectivenessModAttrs({
        type: PokemonType.DRAGON,
        offensiveMultiplier: 1.5,
        defensiveMultiplier: 0.5,
      });
      expect(attrs).toHaveLength(2);
      expect(attrs[0]).toBeInstanceOf(OffensiveTypeMultiplierAbAttr);
      expect(attrs[1]).toBeInstanceOf(ReceivedTypeDamageMultiplierAbAttr);
      expect((attrs[0] as OffensiveTypeMultiplierAbAttr).getTargetDefenderType()).toBe(PokemonType.DRAGON);
      expect((attrs[0] as OffensiveTypeMultiplierAbAttr).getMultiplier()).toBe(1.5);
    });

    it("returns only the offensive attr when defensiveMultiplier === 1 (King of the Jungle shape)", () => {
      const attrs = buildTypeEffectivenessModAttrs({
        type: PokemonType.GRASS,
        offensiveMultiplier: 1.5,
        defensiveMultiplier: 1,
      });
      expect(attrs).toHaveLength(1);
      expect(attrs[0]).toBeInstanceOf(OffensiveTypeMultiplierAbAttr);
    });

    it("returns only the defensive attr when offensiveMultiplier === 1", () => {
      const attrs = buildTypeEffectivenessModAttrs({
        type: PokemonType.FAIRY,
        offensiveMultiplier: 1,
        defensiveMultiplier: 0.5,
      });
      expect(attrs).toHaveLength(1);
      expect(attrs[0]).toBeInstanceOf(ReceivedTypeDamageMultiplierAbAttr);
    });

    it("returns an empty list when both multipliers are 1 (degenerate but accepted)", () => {
      const attrs = buildTypeEffectivenessModAttrs({
        type: PokemonType.NORMAL,
        offensiveMultiplier: 1,
        defensiveMultiplier: 1,
      });
      expect(attrs).toHaveLength(0);
    });

    it("uses default multipliers (1.5 offensive / 0.5 defensive) when omitted", () => {
      const attrs = buildTypeEffectivenessModAttrs({ type: PokemonType.DARK });
      expect(attrs).toHaveLength(2);
      expect((attrs[0] as OffensiveTypeMultiplierAbAttr).getMultiplier()).toBe(1.5);
    });

    it("rejects non-positive multipliers at construction time", () => {
      expect(() => buildTypeEffectivenessModAttrs({ type: PokemonType.FIRE, offensiveMultiplier: 0 })).toThrow(
        /offensiveMultiplier must be > 0/,
      );
      expect(() => buildTypeEffectivenessModAttrs({ type: PokemonType.FIRE, offensiveMultiplier: -1 })).toThrow(
        /offensiveMultiplier must be > 0/,
      );
      expect(() => buildTypeEffectivenessModAttrs({ type: PokemonType.FIRE, defensiveMultiplier: 0 })).toThrow(
        /defensiveMultiplier must be > 0/,
      );
      expect(() => new OffensiveTypeMultiplierAbAttr(PokemonType.GRASS, 0)).toThrow(/multiplier must be > 0/);
    });
  });

  describe("offensive side — boost when defender has the configured type", () => {
    it("applies the offensive boost when the defender is the target type (Lumberjack vs Grass)", () => {
      const [offAttr] = buildTypeEffectivenessModAttrs({
        type: PokemonType.GRASS,
        offensiveMultiplier: 1.5,
        defensiveMultiplier: 1,
      });
      const result = runOffense({
        attr: offAttr as OffensiveTypeMultiplierAbAttr,
        attacker: makeStubAttacker(),
        defender: makeStubDefender({ defenderTypes: [PokemonType.GRASS, PokemonType.POISON] }),
        // Note: the offensive boost gates on DEFENDER type, NOT the move's
        // type — the move type below is irrelevant to the proc.
        move: makeStubMove(PokemonType.NORMAL),
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(150);
    });

    it("does NOT fire when the defender is not the target type", () => {
      const [offAttr] = buildTypeEffectivenessModAttrs({
        type: PokemonType.DRAGON,
        offensiveMultiplier: 1.5,
        defensiveMultiplier: 1,
      });
      const result = runOffense({
        attr: offAttr as OffensiveTypeMultiplierAbAttr,
        attacker: makeStubAttacker(),
        defender: makeStubDefender({ defenderTypes: [PokemonType.STEEL] }),
        move: makeStubMove(PokemonType.DRAGON),
      });
      expect(result.fired).toBe(false);
      expect(result.finalPower).toBe(100);
    });

    it("respects a custom offensive multiplier (e.g. 2x type hunter)", () => {
      const [offAttr] = buildTypeEffectivenessModAttrs({
        type: PokemonType.DARK,
        offensiveMultiplier: 2,
        defensiveMultiplier: 1,
      });
      const result = runOffense({
        attr: offAttr as OffensiveTypeMultiplierAbAttr,
        attacker: makeStubAttacker(),
        defender: makeStubDefender({ defenderTypes: [PokemonType.DARK] }),
        move: makeStubMove(PokemonType.NORMAL),
        initialPower: 80,
      });
      expect(result.fired).toBe(true);
      expect(result.finalPower).toBe(160);
    });

    it("re-evaluates defender's type at each apply (Soak-style mid-battle type changes)", () => {
      // Simulates Soak hitting a Charizard mid-battle, swapping it to pure
      // Water. The Lumberjack user's Grass-defender boost should NOT fire on
      // the original Fire/Flying form (defender wasn't Grass), and should
      // STILL not fire after the swap (defender now Water, also not Grass).
      // Then we swap to pure Grass — the boost should fire on the next call.
      const [offAttr] = buildTypeEffectivenessModAttrs({
        type: PokemonType.GRASS,
        offensiveMultiplier: 1.5,
        defensiveMultiplier: 1,
      });
      const defender = makeStubDefender({ defenderTypes: [PokemonType.FIRE, PokemonType.FLYING] });
      const initial = runOffense({
        attr: offAttr as OffensiveTypeMultiplierAbAttr,
        attacker: makeStubAttacker(),
        defender,
        move: makeStubMove(PokemonType.NORMAL),
      });
      expect(initial.fired).toBe(false);

      (defender as unknown as { setTypes: (t: PokemonType[]) => void }).setTypes([PokemonType.WATER]);
      const afterSoak = runOffense({
        attr: offAttr as OffensiveTypeMultiplierAbAttr,
        attacker: makeStubAttacker(),
        defender,
        move: makeStubMove(PokemonType.NORMAL),
      });
      expect(afterSoak.fired).toBe(false);

      (defender as unknown as { setTypes: (t: PokemonType[]) => void }).setTypes([PokemonType.GRASS]);
      const afterForestCurse = runOffense({
        attr: offAttr as OffensiveTypeMultiplierAbAttr,
        attacker: makeStubAttacker(),
        defender,
        move: makeStubMove(PokemonType.NORMAL),
      });
      expect(afterForestCurse.fired).toBe(true);
      expect(afterForestCurse.finalPower).toBe(150);
    });

    it("handles defenders without `isOfType` gracefully (no throw — returns false)", () => {
      const [offAttr] = buildTypeEffectivenessModAttrs({
        type: PokemonType.FIRE,
        offensiveMultiplier: 1.5,
        defensiveMultiplier: 1,
      });
      const result = runOffense({
        attr: offAttr as OffensiveTypeMultiplierAbAttr,
        attacker: makeStubAttacker(),
        defender: {} as unknown as Pokemon,
        move: makeStubMove(PokemonType.NORMAL),
      });
      expect(result.fired).toBe(false);
    });
  });

  describe("defensive side — reduction on incoming moves of the target type", () => {
    it("reduces incoming damage from a move of the target type (Firefighter vs Fire move)", () => {
      const attrs = buildTypeEffectivenessModAttrs({
        type: PokemonType.FIRE,
        offensiveMultiplier: 1,
        defensiveMultiplier: 0.5,
      });
      const defAttr = attrs[0] as ReceivedTypeDamageMultiplierAbAttr;
      const result = runDefense({
        attr: defAttr,
        defender: makeStubDefender({ defenderTypes: [PokemonType.WATER] }),
        attacker: makeStubAttacker(),
        move: makeStubMove(PokemonType.FIRE),
      });
      expect(result.fired).toBe(true);
      expect(result.finalDamage).toBe(50);
    });

    it("does NOT fire when the incoming move is of a different type", () => {
      const attrs = buildTypeEffectivenessModAttrs({
        type: PokemonType.FIRE,
        offensiveMultiplier: 1,
        defensiveMultiplier: 0.5,
      });
      const defAttr = attrs[0] as ReceivedTypeDamageMultiplierAbAttr;
      const result = runDefense({
        attr: defAttr,
        defender: makeStubDefender({ defenderTypes: [PokemonType.WATER] }),
        attacker: makeStubAttacker(),
        move: makeStubMove(PokemonType.WATER),
      });
      expect(result.fired).toBe(false);
      expect(result.finalDamage).toBe(100);
    });

    it("respects a custom defensive multiplier (e.g. 0.25 quarter damage)", () => {
      const attrs = buildTypeEffectivenessModAttrs({
        type: PokemonType.FAIRY,
        offensiveMultiplier: 1,
        defensiveMultiplier: 0.25,
      });
      const defAttr = attrs[0] as ReceivedTypeDamageMultiplierAbAttr;
      const result = runDefense({
        attr: defAttr,
        defender: makeStubDefender({ defenderTypes: [PokemonType.STEEL] }),
        attacker: makeStubAttacker(),
        move: makeStubMove(PokemonType.FAIRY),
        initialDamage: 200,
      });
      expect(result.fired).toBe(true);
      expect(result.finalDamage).toBe(50);
    });
  });

  describe("five named ER hunter abilities — sanity checks on the resulting AbAttr pair", () => {
    interface HunterSpec {
      readonly id: number;
      readonly name: string;
      readonly type: PokemonType;
    }
    const hunters: readonly HunterSpec[] = [
      { id: 313, name: "Dragonslayer", type: PokemonType.DRAGON },
      { id: 442, name: "Fae Hunter", type: PokemonType.FAIRY },
      { id: 445, name: "Lumberjack", type: PokemonType.GRASS },
      { id: 526, name: "Monster Hunter", type: PokemonType.DARK },
      { id: 804, name: "Firefighter", type: PokemonType.FIRE },
    ];

    for (const hunter of hunters) {
      it(`${hunter.name} (id ${hunter.id}) — 1.5x offense vs ${PokemonType[hunter.type]}, 0.5x defense from ${PokemonType[hunter.type]}`, () => {
        const attrs = buildTypeEffectivenessModAttrs({
          type: hunter.type,
          offensiveMultiplier: 1.5,
          defensiveMultiplier: 0.5,
        });
        expect(attrs).toHaveLength(2);

        // Offensive hit on a matching-type defender.
        const offResult = runOffense({
          attr: attrs[0] as OffensiveTypeMultiplierAbAttr,
          attacker: makeStubAttacker(),
          defender: makeStubDefender({ defenderTypes: [hunter.type] }),
          move: makeStubMove(PokemonType.NORMAL),
        });
        expect(offResult.fired).toBe(true);
        expect(offResult.finalPower).toBe(150);

        // Incoming damage of the matching type.
        const defResult = runDefense({
          attr: attrs[1] as ReceivedTypeDamageMultiplierAbAttr,
          defender: makeStubDefender({ defenderTypes: [PokemonType.NORMAL] }),
          attacker: makeStubAttacker(),
          move: makeStubMove(hunter.type),
        });
        expect(defResult.fired).toBe(true);
        expect(defResult.finalDamage).toBe(50);
      });
    }
  });
});
