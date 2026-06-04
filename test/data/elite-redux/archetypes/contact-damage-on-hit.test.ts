/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: tests for the `contact-damage-on-hit` archetype.
//
// We exercise the archetype primitive directly with duck-typed Pokemon and Move
// stubs. The archetype mutates attacker state via `damageAndUpdate` + tracks
// `turnData.damageTaken`, so we mock both on the attacker stub. The
// `hasAbilityWithAttr` Magic-Guard check is also stubbed for the immunity
// case.
//
// Direct unit testing here is the right tool: the archetype's behavior is
// fundamentally "predicate + damage application", and the C0 harness doesn't
// yet expose a PostDefend trigger for full integration tests.
// =============================================================================

import { ContactDamageOnHitAbAttr } from "#data/elite-redux/archetypes/contact-damage-on-hit";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it, vi } from "vitest";

type AttackerOpts = {
  maxHp?: number;
  hasBlockNonDirect?: boolean;
};

function makeAttacker(opts: AttackerOpts = {}): Pokemon {
  return {
    id: 2,
    getMaxHp: vi.fn(() => opts.maxHp ?? 100),
    damageAndUpdate: vi.fn(),
    hasAbilityWithAttr: vi.fn(
      (name: string) => name === "BlockNonDirectDamageAbAttr" && (opts.hasBlockNonDirect ?? false),
    ),
    turnData: { damageTaken: 0 },
  } as unknown as Pokemon;
}

function makeDefender(): Pokemon {
  return {
    id: 1,
  } as unknown as Pokemon;
}

function makeStubMove(opts: { makesContact?: boolean }): Move {
  return {
    doesFlagEffectApply: ({ flag }: { flag: MoveFlags }) => {
      if (flag === MoveFlags.MAKES_CONTACT) {
        return opts.makesContact ?? false;
      }
      return false;
    },
  } as unknown as Move;
}

function makeParams(opts: {
  defender: Pokemon;
  attacker: Pokemon;
  move: Move;
  simulated?: boolean;
  hitResult?: HitResult;
}) {
  return {
    pokemon: opts.defender,
    opponent: opts.attacker,
    move: opts.move,
    hitResult: opts.hitResult ?? HitResult.EFFECTIVE,
    damage: 50,
    simulated: opts.simulated ?? false,
  };
}

describe("ContactDamageOnHitAbAttr archetype (C1d)", () => {
  describe("Rough-Skin-style (default contact gate)", () => {
    it("fires on a contact hit and deals 1/8 max HP damage", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8 });
      const defender = makeDefender();
      const attacker = makeAttacker({ maxHp: 800 });
      const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
      expect(attr.canApply(params)).toBe(true);
      attr.apply(params);
      expect(attacker.damageAndUpdate).toHaveBeenCalledWith(100, { result: HitResult.INDIRECT });
      // turnData.damageTaken updated by the same amount
      expect(attacker.turnData.damageTaken).toBe(100);
    });

    it("does NOT fire on a non-contact hit when contactRequired defaults to true", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8 });
      const params = makeParams({
        defender: makeDefender(),
        attacker: makeAttacker({ maxHp: 800 }),
        move: makeStubMove({ makesContact: false }),
      });
      expect(attr.canApply(params)).toBe(false);
    });
  });

  describe("non-contact variant", () => {
    it("fires on any hit when contactRequired=false", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8, contactRequired: false });
      const params = makeParams({
        defender: makeDefender(),
        attacker: makeAttacker({ maxHp: 800 }),
        move: makeStubMove({ makesContact: false }),
      });
      expect(attr.canApply(params)).toBe(true);
    });
  });

  describe("hit-result gating", () => {
    it("does NOT fire when the move resolved to NO_EFFECT", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8 });
      const params = makeParams({
        defender: makeDefender(),
        attacker: makeAttacker(),
        move: makeStubMove({ makesContact: true }),
        hitResult: HitResult.NO_EFFECT,
      });
      expect(attr.canApply(params)).toBe(false);
    });
  });

  describe("BlockNonDirectDamage immunity (Magic Guard)", () => {
    it("does NOT fire when the attacker has BlockNonDirectDamageAbAttr (Magic Guard)", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8 });
      const params = makeParams({
        defender: makeDefender(),
        attacker: makeAttacker({ hasBlockNonDirect: true }),
        move: makeStubMove({ makesContact: true }),
      });
      expect(attr.canApply(params)).toBe(false);
    });
  });

  describe("simulated dispatches", () => {
    it("canApply is false in simulated mode (no side effects)", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8 });
      const params = makeParams({
        defender: makeDefender(),
        attacker: makeAttacker(),
        move: makeStubMove({ makesContact: true }),
        simulated: true,
      });
      expect(attr.canApply(params)).toBe(false);
    });

    it("apply is a no-op when simulated even if accidentally called", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8 });
      const attacker = makeAttacker();
      const params = makeParams({
        defender: makeDefender(),
        attacker,
        move: makeStubMove({ makesContact: true }),
        simulated: true,
      });
      attr.apply(params);
      expect(attacker.damageAndUpdate).not.toHaveBeenCalled();
    });
  });

  describe("damage math at non-standard fractions", () => {
    it("deals 1/4 max HP damage when configured", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 4 });
      const attacker = makeAttacker({ maxHp: 400 });
      const params = makeParams({ defender: makeDefender(), attacker, move: makeStubMove({ makesContact: true }) });
      attr.apply(params);
      expect(attacker.damageAndUpdate).toHaveBeenCalledWith(100, { result: HitResult.INDIRECT });
    });

    it("deals full max HP when configured at maxHpFraction=1 (boundary)", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 });
      const attacker = makeAttacker({ maxHp: 200 });
      const params = makeParams({ defender: makeDefender(), attacker, move: makeStubMove({ makesContact: true }) });
      attr.apply(params);
      expect(attacker.damageAndUpdate).toHaveBeenCalledWith(200, { result: HitResult.INDIRECT });
    });

    it("rounds via toDmgValue when the fraction yields a fractional damage", () => {
      // 100 max HP * (1/3) = 33.33... → toDmgValue rounds to integer.
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 3 });
      const attacker = makeAttacker({ maxHp: 100 });
      const params = makeParams({ defender: makeDefender(), attacker, move: makeStubMove({ makesContact: true }) });
      attr.apply(params);
      // toDmgValue clamps to integer >= 1; assert it's a positive integer
      // matching `Math.floor(100/3)`.
      expect(attacker.damageAndUpdate).toHaveBeenCalledWith(33, { result: HitResult.INDIRECT });
    });
  });

  describe("accessors", () => {
    it("exposes configuration via getters", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8, contactRequired: false });
      expect(attr.getMaxHpFraction()).toBe(1 / 8);
      expect(attr.requiresContact()).toBe(false);
    });

    it("contactRequired defaults to true", () => {
      const attr = new ContactDamageOnHitAbAttr({ maxHpFraction: 1 / 8 });
      expect(attr.requiresContact()).toBe(true);
    });
  });

  describe("construction validation", () => {
    it("rejects maxHpFraction = 0", () => {
      expect(() => new ContactDamageOnHitAbAttr({ maxHpFraction: 0 })).toThrow(/maxHpFraction must be in \(0, 1\]/);
    });

    it("rejects negative maxHpFraction", () => {
      expect(() => new ContactDamageOnHitAbAttr({ maxHpFraction: -0.1 })).toThrow(/maxHpFraction must be in \(0, 1\]/);
    });

    it("rejects maxHpFraction > 1", () => {
      expect(() => new ContactDamageOnHitAbAttr({ maxHpFraction: 1.5 })).toThrow(/maxHpFraction must be in \(0, 1\]/);
    });
  });
});
