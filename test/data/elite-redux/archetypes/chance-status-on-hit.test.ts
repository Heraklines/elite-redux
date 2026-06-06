/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: tests for the `chance-status-on-hit` archetype.
//
// We exercise the archetype primitive directly with duck-typed Pokemon and
// Move stubs. The RNG is fully controlled (we stub `randBattleSeedInt` per
// test) so each scenario is deterministic.
//
// Direct unit testing here is the right tool: the archetype's behavior is
// fundamentally "predicate + status setting", and the C0 harness doesn't yet
// have a PostDefend trigger for full integration tests.
// =============================================================================

import {
  ChanceBattlerTagOnHitAbAttr,
  ChanceStatusOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { describe, expect, it, vi } from "vitest";

type StubPokemonOpts = {
  hasStatus?: boolean;
  canSetStatus?: boolean;
  rolls?: number[];
};

function makeStubPokemon(opts: StubPokemonOpts = {}): Pokemon {
  // We use a generator from a fixed list of rolls so each call advances.
  const rolls = opts.rolls ?? [0];
  let idx = 0;
  return {
    id: 1,
    status: opts.hasStatus ? { effect: StatusEffect.BURN } : null,
    canSetStatus: vi.fn(() => opts.canSetStatus ?? true),
    trySetStatus: vi.fn(),
    randBattleSeedInt: vi.fn(() => {
      const v = rolls[idx % rolls.length];
      idx++;
      return v;
    }),
  } as unknown as Pokemon;
}

function makeStubMove(opts: { makesContact?: boolean; flags?: MoveFlags; type?: number }): Move {
  const flags = opts.flags ?? MoveFlags.NONE;
  return {
    doesFlagEffectApply: ({ flag }: { flag: MoveFlags }) => {
      if (flag === MoveFlags.MAKES_CONTACT) {
        return opts.makesContact ?? false;
      }
      return false;
    },
    hasFlag: (flag: MoveFlags) => (flags & flag) !== MoveFlags.NONE,
    type: opts.type ?? 0,
  } as unknown as Move;
}

/**
 * Build a {@linkcode PostMoveInteractionAbAttrParams}-shaped params object
 * for the archetype's canApply / apply. `pokemon` is the *defender* (the one
 * with this ability) and `opponent` is the attacker.
 */
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

describe("ChanceStatusOnHitAbAttr archetype (C1)", () => {
  it("fires on a contact hit when the roll passes (Static at 30%, roll=0)", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 30,
      effects: [StatusEffect.PARALYSIS],
    });
    const defender = makeStubPokemon({ rolls: [0] });
    const attacker = makeStubPokemon();
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(attacker.trySetStatus).toHaveBeenCalledWith(StatusEffect.PARALYSIS, defender);
  });

  it("does NOT fire when the roll exceeds the configured chance", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 30,
      effects: [StatusEffect.PARALYSIS],
    });
    const defender = makeStubPokemon({ rolls: [50] }); // 50 >= 30 → fail
    const attacker = makeStubPokemon();
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(false);
  });

  it("100% chance fires without consulting the roll", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(true);
    expect(defender.randBattleSeedInt).not.toHaveBeenCalled();
  });

  it("does NOT fire when contactRequired=true and move does not make contact", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
    });
    const params = makeParams({
      defender: makeStubPokemon(),
      attacker: makeStubPokemon(),
      move: makeStubMove({ makesContact: false }),
    });
    expect(attr.canApply(params)).toBe(false);
  });

  it("fires on non-contact hit when contactRequired=false", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      contactRequired: false,
    });
    const params = makeParams({
      defender: makeStubPokemon(),
      attacker: makeStubPokemon(),
      move: makeStubMove({ makesContact: false }),
    });
    expect(attr.canApply(params)).toBe(true);
  });

  it("does NOT fire when the attacker already has a status", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.PARALYSIS],
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ hasStatus: true });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(false);
  });

  it("does NOT fire when canSetStatus rejects the effect", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.PARALYSIS],
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ canSetStatus: false });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(false);
  });

  it("Effect Spore-style: picks a status from the multi-effect list via RNG", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.POISON, StatusEffect.PARALYSIS, StatusEffect.SLEEP],
    });
    // First call: randBattleSeedInt(3) returns 1 → PARALYSIS picked.
    const defender = makeStubPokemon({ rolls: [1, 1] }); // pickEffect runs in canApply + apply
    const attacker = makeStubPokemon();
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(attacker.trySetStatus).toHaveBeenCalledWith(StatusEffect.PARALYSIS, defender);
  });

  it("apply is a no-op when simulated", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    attr.apply({
      ...makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) }),
      simulated: true,
    });
    expect(attacker.trySetStatus).not.toHaveBeenCalled();
  });

  it("rejects invalid chance values at construction time", () => {
    expect(() => new ChanceStatusOnHitAbAttr({ chance: -1, effects: [StatusEffect.BURN] })).toThrow(
      /chance must be in/,
    );
    expect(() => new ChanceStatusOnHitAbAttr({ chance: 101, effects: [StatusEffect.BURN] })).toThrow(
      /chance must be in/,
    );
  });

  it("rejects empty effects list at construction time", () => {
    expect(() => new ChanceStatusOnHitAbAttr({ chance: 50, effects: [] })).toThrow(/at least one status effect/);
  });

  it("exposes its configuration via accessors", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 25,
      effects: [StatusEffect.SLEEP, StatusEffect.POISON],
      contactRequired: false,
    });
    expect(attr.getChance()).toBe(25);
    expect(attr.getEffects()).toEqual([StatusEffect.SLEEP, StatusEffect.POISON]);
    expect(attr.requiresContact()).toBe(false);
  });

  // ===========================================================================
  // Regression: the non-contact (`contactExcluded`) tier — e.g. Flame Body's
  // "20% burn on non-contact" and Static's "10% paralyze on non-contact" — must
  // only fire on non-contact ATTACKS (damaging moves), NEVER on STATUS-category
  // moves. The ER ROM text reads "...on non-contact attacks" / "Non-contact has
  // a 20% chance" (i.e. attacks). A foe opening with Growl/Leer (status) used to
  // proc the burn, which players reported as "Flame Body burned me before I made
  // any move." See #(contact-ability) repro.
  // ===========================================================================
  it("contactExcluded tier does NOT fire on a STATUS-category hit (Growl/Leer)", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      contactExcluded: true,
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    // A non-contact status move (e.g. Growl): inherentlyMakesContact=false so the
    // contactExcluded gate would pass, but hitResult is STATUS (no damage) → reject.
    const move = makeStubMove({ makesContact: false });
    const params = makeParams({ defender, attacker, move, hitResult: HitResult.STATUS });
    expect(attr.canApply(params)).toBe(false);
  });

  it("contactExcluded tier DOES fire on a non-contact damaging attack (Ember)", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      contactExcluded: true,
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    const move = makeStubMove({ makesContact: false }); // inherently ranged
    const params = makeParams({ defender, attacker, move, hitResult: HitResult.EFFECTIVE });
    expect(attr.canApply(params)).toBe(true);
  });

  it("contactExcluded tier does NOT fire when there is no attack (NO_EFFECT)", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      contactExcluded: true,
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    const move = makeStubMove({ makesContact: false });
    const params = makeParams({ defender, attacker, move, hitResult: HitResult.NO_EFFECT });
    expect(attr.canApply(params)).toBe(false);
  });
});

// Tag-flavor stubs — separate factory so we can fake `canAddTag` / `addTag`
// independently of the status-side `canSetStatus` / `trySetStatus` plumbing.
type StubTagPokemonOpts = {
  canAddTag?: boolean;
  rolls?: number[];
};

function makeStubTagPokemon(opts: StubTagPokemonOpts = {}): Pokemon {
  const rolls = opts.rolls ?? [0];
  let idx = 0;
  return {
    id: 1,
    canAddTag: vi.fn(() => opts.canAddTag ?? true),
    addTag: vi.fn(),
    randBattleSeedInt: vi.fn(() => {
      const v = rolls[idx % rolls.length];
      idx++;
      return v;
    }),
  } as unknown as Pokemon;
}

describe("ChanceBattlerTagOnHitAbAttr archetype (round-2 extension)", () => {
  it("fires on a contact hit when the roll passes (Haunting Frenzy, 20% flinch, roll=0)", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 20,
      tags: [BattlerTagType.FLINCHED],
    });
    const defender = makeStubTagPokemon({ rolls: [0] });
    const attacker = makeStubTagPokemon();
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(attacker.addTag).toHaveBeenCalledWith(BattlerTagType.FLINCHED, undefined, undefined, defender.id);
  });

  it("does NOT fire when the roll exceeds the chance", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 20,
      tags: [BattlerTagType.CONFUSED],
    });
    const defender = makeStubTagPokemon({ rolls: [50] });
    const attacker = makeStubTagPokemon();
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(false);
  });

  it("Loud Bang-style: non-contact proc at 50% with CONFUSED", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 50,
      tags: [BattlerTagType.CONFUSED],
      contactRequired: false,
    });
    const params = makeParams({
      defender: makeStubTagPokemon({ rolls: [0] }),
      attacker: makeStubTagPokemon(),
      move: makeStubMove({ makesContact: false }),
    });
    expect(attr.canApply(params)).toBe(true);
  });

  it("does NOT fire when canAddTag rejects the tag", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 100,
      tags: [BattlerTagType.FLINCHED],
    });
    const defender = makeStubTagPokemon();
    const attacker = makeStubTagPokemon({ canAddTag: false });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(false);
  });

  it("apply is a no-op when simulated", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 100,
      tags: [BattlerTagType.FLINCHED],
    });
    const defender = makeStubTagPokemon();
    const attacker = makeStubTagPokemon();
    attr.apply({
      ...makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) }),
      simulated: true,
    });
    expect(attacker.addTag).not.toHaveBeenCalled();
  });

  it("forwards `turns` to addTag when configured", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 100,
      tags: [BattlerTagType.DISABLED],
      turns: 3,
    });
    const defender = makeStubTagPokemon();
    const attacker = makeStubTagPokemon();
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    attr.apply(params);
    expect(attacker.addTag).toHaveBeenCalledWith(BattlerTagType.DISABLED, 3, undefined, defender.id);
  });

  it("rejects empty tags array at construction time", () => {
    expect(() => new ChanceBattlerTagOnHitAbAttr({ chance: 50, tags: [] })).toThrow(/at least one battler tag/);
  });

  it("rejects invalid chance values at construction time", () => {
    expect(() => new ChanceBattlerTagOnHitAbAttr({ chance: -1, tags: [BattlerTagType.FLINCHED] })).toThrow(
      /chance must be in/,
    );
    expect(() => new ChanceBattlerTagOnHitAbAttr({ chance: 101, tags: [BattlerTagType.FLINCHED] })).toThrow(
      /chance must be in/,
    );
  });

  it("exposes configuration via accessors", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 30,
      tags: [BattlerTagType.CONFUSED, BattlerTagType.INFATUATED],
      contactRequired: false,
      turns: 4,
    });
    expect(attr.getChance()).toBe(30);
    expect(attr.getTags()).toEqual([BattlerTagType.CONFUSED, BattlerTagType.INFATUATED]);
    expect(attr.requiresContact()).toBe(false);
    expect(attr.getTurns()).toBe(4);
  });
});

describe("ChanceStatusOnHitAbAttr — filter (round 5)", () => {
  it("flag-filter accepts a flag-bearing move", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      filter: { flag: MoveFlags.SLICING_MOVE },
    });
    // contactRequired auto-defaults to false when filter is set.
    expect(attr.requiresContact()).toBe(false);
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    const move = makeStubMove({ flags: MoveFlags.SLICING_MOVE });
    const result = attr.canApply(makeParams({ defender, attacker, move }));
    expect(result).toBe(true);
  });

  it("flag-filter rejects a move missing the flag", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      filter: { flag: MoveFlags.SLICING_MOVE },
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    const move = makeStubMove({ flags: MoveFlags.NONE });
    expect(attr.canApply(makeParams({ defender, attacker, move }))).toBe(false);
  });

  it("type-filter accepts a matching type", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      filter: { type: 11 as never }, // arbitrary type tag for the stub
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    const move = makeStubMove({ type: 11 });
    expect(attr.canApply(makeParams({ defender, attacker, move }))).toBe(true);
  });

  it("type-filter rejects a non-matching type", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      filter: { type: 11 as never },
    });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    const move = makeStubMove({ type: 5 });
    expect(attr.canApply(makeParams({ defender, attacker, move }))).toBe(false);
  });

  it("filter AND contactRequired both must pass", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 100,
      effects: [StatusEffect.BURN],
      filter: { flag: MoveFlags.SLICING_MOVE },
      contactRequired: true,
    });
    expect(attr.requiresContact()).toBe(true);
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon();
    // Has flag but no contact → rejected.
    const noContact = makeStubMove({ flags: MoveFlags.SLICING_MOVE, makesContact: false });
    expect(attr.canApply(makeParams({ defender, attacker, move: noContact }))).toBe(false);
    // Has contact but no flag → rejected.
    const noFlag = makeStubMove({ flags: MoveFlags.NONE, makesContact: true });
    expect(attr.canApply(makeParams({ defender, attacker, move: noFlag }))).toBe(false);
    // Both → accepted.
    const both = makeStubMove({ flags: MoveFlags.SLICING_MOVE, makesContact: true });
    expect(attr.canApply(makeParams({ defender, attacker, move: both }))).toBe(true);
  });

  it("filter accessor returns the configured filter", () => {
    const attr = new ChanceStatusOnHitAbAttr({
      chance: 50,
      effects: [StatusEffect.BURN],
      filter: { flag: MoveFlags.BITING_MOVE },
    });
    expect(attr.getFilter()).toEqual({ flag: MoveFlags.BITING_MOVE });
  });
});

describe("ChanceBattlerTagOnHitAbAttr — filter (round 5)", () => {
  it("flag-filter routes through canAddTag check", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 100,
      tags: [BattlerTagType.ER_BLEED],
      filter: { flag: MoveFlags.KICKING_MOVE },
    });
    expect(attr.requiresContact()).toBe(false);
    const defender = makeStubPokemon();
    const attacker = {
      id: 2,
      canAddTag: vi.fn(() => true),
      addTag: vi.fn(),
    } as unknown as Pokemon;
    const move = makeStubMove({ flags: MoveFlags.KICKING_MOVE });
    expect(attr.canApply(makeParams({ defender, attacker, move }))).toBe(true);
  });

  it("filter rejects when flag absent", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 100,
      tags: [BattlerTagType.ER_BLEED],
      filter: { flag: MoveFlags.KICKING_MOVE },
    });
    const defender = makeStubPokemon();
    const attacker = { id: 2, canAddTag: vi.fn(() => true) } as unknown as Pokemon;
    const move = makeStubMove({ flags: MoveFlags.NONE });
    expect(attr.canApply(makeParams({ defender, attacker, move }))).toBe(false);
  });

  it("filter accessor returns the configured filter", () => {
    const attr = new ChanceBattlerTagOnHitAbAttr({
      chance: 50,
      tags: [BattlerTagType.ER_FROSTBITE],
      filter: { flag: MoveFlags.BITING_MOVE },
    });
    expect(attr.getFilter()).toEqual({ flag: MoveFlags.BITING_MOVE });
  });
});
