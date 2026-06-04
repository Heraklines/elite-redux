/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke tests: set-arena-effect-on-hit cluster.
//
// Covers both sibling primitives:
//   - SetArenaTagOnHitAbAttr — places an ArenaTag on hit (Drop Blocks-style).
//   - SetTerrainOnHitAbAttr — sets a TerrainType on hit (Power Leak-style).
//
// We use `initGlobalScene` (same pattern as `passive-recovery.test.ts`) to
// inject a stub arena that records `addTag` / `trySetTerrain` calls; `vi.mock`
// would conflict with the wider non-isolated suite.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { SetArenaTagOnHitAbAttr, SetTerrainOnHitAbAttr } from "#data/elite-redux/abilities/set-arena-effect-on-hit";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { beforeEach, describe, expect, it, vi } from "vitest";

const addTag = vi.fn();
const trySetTerrain = vi.fn();

beforeEach(() => {
  addTag.mockClear();
  trySetTerrain.mockClear();
  initGlobalScene({
    arena: {
      addTag: (...args: unknown[]) => addTag(...args),
      trySetTerrain: (...args: unknown[]) => trySetTerrain(...args),
    },
  } as unknown as BattleScene);
});

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

function makeStubPokemon(opts: { id?: number; isPlayer?: boolean } = {}): Pokemon {
  return {
    id: opts.id ?? 1,
    isPlayer: () => opts.isPlayer ?? true,
  } as unknown as Pokemon;
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

describe("SetArenaTagOnHitAbAttr", () => {
  it("constructs with defaults (turns=0, side=attacker, contactRequired=false)", () => {
    const attr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES });
    expect(attr.getTagType()).toBe(ArenaTagType.SPIKES);
    expect(attr.getTurns()).toBe(0);
    expect(attr.getSide()).toBe("attacker");
    expect(attr.requiresContact()).toBe(false);
  });

  it("constructs with explicit options (Drop Blocks-style)", () => {
    const attr = new SetArenaTagOnHitAbAttr({
      tagType: ArenaTagType.SPIKES,
      side: "attacker",
      contactRequired: true,
    });
    expect(attr.getSide()).toBe("attacker");
    expect(attr.requiresContact()).toBe(true);
  });

  it("fires on a damaging non-contact hit when contactRequired is false", () => {
    const attr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES });
    const defender = makeStubPokemon({ isPlayer: true });
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: false }) });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(addTag).toHaveBeenCalledTimes(1);
    // attacker side of a player defender = ENEMY.
    expect(addTag).toHaveBeenCalledWith(ArenaTagType.SPIKES, 0, undefined, defender.id, ArenaTagSide.ENEMY);
  });

  it("does NOT fire when contactRequired is true and the hit is not contact", () => {
    const attr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES, contactRequired: true });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: false }) });
    expect(attr.canApply(params)).toBe(false);
  });

  it("fires when contactRequired is true and the hit IS contact (Loose Thorns)", () => {
    const attr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES, contactRequired: true });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: true }) });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(addTag).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire on a no-effect hit (status move, immune target)", () => {
    const attr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({
      defender,
      attacker,
      move: makeStubMove({ makesContact: false }),
      hitResult: HitResult.NO_EFFECT,
    });
    expect(attr.canApply(params)).toBe(false);
  });

  it("deploys to the OPPOSITE side when the defender is an enemy Pokemon", () => {
    const attr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES });
    const defender = makeStubPokemon({ isPlayer: false });
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: false }) });
    attr.apply(params);
    expect(addTag).toHaveBeenCalledWith(ArenaTagType.SPIKES, 0, undefined, defender.id, ArenaTagSide.PLAYER);
  });

  it("supports self-side and both-side deploys", () => {
    const selfAttr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.MIST, side: "self" });
    const bothAttr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SAFEGUARD, side: "both" });
    const defender = makeStubPokemon({ isPlayer: true });
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: false }) });
    selfAttr.apply(params);
    bothAttr.apply(params);
    expect(addTag).toHaveBeenNthCalledWith(1, ArenaTagType.MIST, 0, undefined, defender.id, ArenaTagSide.PLAYER);
    expect(addTag).toHaveBeenNthCalledWith(2, ArenaTagType.SAFEGUARD, 0, undefined, defender.id, ArenaTagSide.BOTH);
  });

  it("simulated runs skip the side-effect", () => {
    const attr = new SetArenaTagOnHitAbAttr({ tagType: ArenaTagType.SPIKES });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({
      defender,
      attacker,
      move: makeStubMove({ makesContact: false }),
      simulated: true,
    });
    attr.apply(params);
    expect(addTag).not.toHaveBeenCalled();
  });
});

describe("SetTerrainOnHitAbAttr", () => {
  it("constructs with the configured terrain (Brain Overload-style)", () => {
    const attr = new SetTerrainOnHitAbAttr({ terrain: TerrainType.PSYCHIC });
    expect(attr.getTerrain()).toBe(TerrainType.PSYCHIC);
    expect(attr.requiresContact()).toBe(false);
  });

  it("fires on a damaging hit and sets the configured terrain", () => {
    const attr = new SetTerrainOnHitAbAttr({ terrain: TerrainType.ELECTRIC });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: false }) });
    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(trySetTerrain).toHaveBeenCalledWith(TerrainType.ELECTRIC, false, defender);
  });

  it("respects contactRequired gate", () => {
    const attr = new SetTerrainOnHitAbAttr({ terrain: TerrainType.PSYCHIC, contactRequired: true });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({ defender, attacker, move: makeStubMove({ makesContact: false }) });
    expect(attr.canApply(params)).toBe(false);
  });

  it("does NOT fire on no-effect hit", () => {
    const attr = new SetTerrainOnHitAbAttr({ terrain: TerrainType.PSYCHIC });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({
      defender,
      attacker,
      move: makeStubMove({ makesContact: false }),
      hitResult: HitResult.NO_EFFECT,
    });
    expect(attr.canApply(params)).toBe(false);
  });

  it("simulated runs skip the side-effect", () => {
    const attr = new SetTerrainOnHitAbAttr({ terrain: TerrainType.PSYCHIC });
    const defender = makeStubPokemon();
    const attacker = makeStubPokemon({ id: 2 });
    const params = makeParams({
      defender,
      attacker,
      move: makeStubMove({ makesContact: false }),
      simulated: true,
    });
    attr.apply(params);
    expect(trySetTerrain).not.toHaveBeenCalled();
  });
});
