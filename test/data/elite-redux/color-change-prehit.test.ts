/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER reworks COLOR_CHANGE: vanilla swaps the holder's type to the move's type
// AFTER the hit (PostDefendTypeChangeAbAttr). ER instead changes the holder to a
// type that resists/negates the move BEFORE it lands (PreHitResistTypeChangeAbAttr,
// applied from move-effect-phase before effectiveness). The vanilla-rebalance
// patcher must swap the attr; this asserts the post-init attr layout.

import { initGlobalScene } from "#app/global-scene";
import { type AugmentMoveInteractionAbAttrParams, PreHitResistTypeChangeAbAttr } from "#data/abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Color Change is a PRE-hit resist type change", () => {
  beforeAll(() => {
    initGlobalScene({ gameMode: { challenges: [] } } as never);
  });

  const attrNames = (): string[] =>
    (allAbilities[AbilityId.COLOR_CHANGE] as unknown as { attrs: { constructor: { name: string } }[] }).attrs.map(
      a => a.constructor.name,
    );

  it("has the pre-hit resist attr", () => {
    expect(attrNames()).toContain("PreHitResistTypeChangeAbAttr");
  });

  it("no longer has the vanilla post-hit type-change attr", () => {
    expect(attrNames()).not.toContain("PostDefendTypeChangeAbAttr");
  });

  it("compares candidate resist types against the holder's first current type", () => {
    const attr = new PreHitResistTypeChangeAbAttr();
    const pokemon = {
      isTerastallized: false,
      getTypes: () => [PokemonType.WATER, PokemonType.GRASS],
      summonData: { types: [PokemonType.WATER, PokemonType.GRASS] },
      updateInfo: () => {},
    };
    const opponent = { getMoveType: () => PokemonType.FIRE };
    const move = { category: MoveCategory.PHYSICAL, hasAttr: () => false };
    const params = { pokemon, opponent, move, simulated: false } as unknown as AugmentMoveInteractionAbAttrParams;

    expect(attr.canApply(params)).toBe(false);
  });

  it("uses the first better single type in type order when the first current type is worse", () => {
    const attr = new PreHitResistTypeChangeAbAttr();
    const pokemon = {
      isTerastallized: false,
      getTypes: () => [PokemonType.GRASS, PokemonType.WATER],
      summonData: { types: [PokemonType.GRASS, PokemonType.WATER] },
      updateInfo: () => {},
    };
    const opponent = { getMoveType: () => PokemonType.FIRE };
    const move = { category: MoveCategory.PHYSICAL, hasAttr: () => false };
    const params = { pokemon, opponent, move, simulated: false } as unknown as AugmentMoveInteractionAbAttrParams;

    expect(attr.canApply(params)).toBe(true);
    attr.apply(params);
    expect(pokemon.summonData.types).toEqual([PokemonType.ROCK]);
  });
});
