/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER custom held items (gems, terrain seeds, reactive items, recreated Life Orb
// / Assault Vest / Rocky Helmet) vanished on refresh / Continue: the save LOAD
// path reconstructs each modifier via `Modifier[className]`, a lookup in
// #modifiers/modifier - and these ER classes live elsewhere, so the lookup
// missed them and the item was dropped. Fix: an ER class registry the loader
// falls back to, plus getArgs() on the classes carrying extra ctor state so they
// round-trip. This test pins both, with no game init (pure reconstruction).
// =============================================================================

import { ErGemModifier } from "#data/elite-redux/er-elemental-gems";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import { ErReactiveItemModifier } from "#data/elite-redux/er-reactive-items";
import { ErAssaultVestModifier } from "#data/elite-redux/er-recreated-items";
import { ErSeedModifier } from "#data/elite-redux/er-terrain-seeds";
import { PokemonType } from "#enums/pokemon-type";
import type { ModifierType } from "#modifiers/modifier-type";
import { describe, expect, it } from "vitest";

/** Minimal stand-in - the round-trip never reads the type, only stores it. */
const stubType = (id: string): ModifierType => ({ id }) as unknown as ModifierType;

/** Reconstruct exactly as GameData.toModifier does: ctor(type, ...getArgs, stackCount). */
function roundTrip<T extends ErGemModifier | ErReactiveItemModifier | ErSeedModifier | ErAssaultVestModifier>(
  original: T,
): T {
  const Cls = resolveErModifierClass(original.constructor.name);
  expect(Cls, original.constructor.name).toBeDefined();
  return Reflect.construct(Cls!, [original.type, ...original.getArgs(), original.stackCount]) as T;
}

describe("ER held-item save persistence", () => {
  it("registers the un-side-channeled ER classes, and NOT the side-channeled ones", () => {
    expect(resolveErModifierClass("ErGemModifier")).toBe(ErGemModifier);
    expect(resolveErModifierClass("ErSeedModifier")).toBe(ErSeedModifier);
    expect(resolveErModifierClass("ErReactiveItemModifier")).toBe(ErReactiveItemModifier);
    expect(resolveErModifierClass("ErAssaultVestModifier")).toBe(ErAssaultVestModifier);
    // Resist berries (#357) + ward stones (#358) restore via their own session
    // side-channels - registering them here too would double-attach on load.
    expect(resolveErModifierClass("ErResistBerryModifier")).toBeUndefined();
    expect(resolveErModifierClass("ErWardStoneModifier")).toBeUndefined();
    // Vanilla classes are resolved by the caller's Modifier[className], not here.
    expect(resolveErModifierClass("PokemonHeldItemModifier")).toBeUndefined();
  });

  it("round-trips a gem's type (the extra ctor arg) through getArgs", () => {
    const original = new ErGemModifier(stubType("ER_GEM"), 123, PokemonType.WATER, 1);
    const restored = roundTrip(original);
    expect(restored.pokemonId).toBe(123);
    expect(restored.gemType).toBe(PokemonType.WATER);
    expect(restored.matchType(original)).toBe(true);
  });

  it("round-trips Assault Vest WITHOUT the StatBooster stats leaking into stackCount", () => {
    // ErAssaultVestModifier hardcodes stats/multiplier in its ctor but inherits
    // StatBoosterModifier.getArgs ([pokemonId, stats, multiplier]); the override
    // must trim that to [pokemonId] or the stats array lands in stackCount.
    const original = new ErAssaultVestModifier(stubType("ER_AV"), 9, 3);
    const restored = roundTrip(original);
    expect(restored.pokemonId).toBe(9);
    expect(restored.stackCount).toBe(3);
  });
});
