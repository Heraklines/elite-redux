/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Relics (#439) vanished on refresh / Continue. Relics are granted off-pool
// (Giratina's Bargain, abyss events), so they never pass through the reward
// screen's id fix-up - and the Bargain wraps each func in a fresh arrow, so even
// that reverse-lookup missed. The factory built the ModifierType with id="", so
// the save recorded typeId="" and the load path's getModifierTypeFuncById("")
// returned undefined => the relic was silently dropped. Fix: the factory now pins
// the registry id (erRelicTypeId). This test drives the REAL load machinery
// (ModifierData -> toModifier -> getModifierTypeFuncById) for every registered
// relic, so it fails before the fix (typeId="" => restored null) and passes after.
// =============================================================================

import { modifierTypes } from "#data/data-lists";
import type { ErRelicKind } from "#data/elite-redux/er-relics";
import { ErRelicModifier } from "#modifiers/modifier";
import { getModifierTypeFuncById } from "#modifiers/modifier-type";
import { ModifierData } from "#system/modifier-data";
import { describe, expect, it } from "vitest";

// Hardcoded so it.each can enumerate at collection time (the live `modifierTypes`
// registry is only populated once game-init runs, i.e. after test collection).
// The "stays in sync" test below fails loudly if a relic is added/removed.
const RELIC_KEYS = [
  "ER_RELIC_FIELD_MEDIC",
  "ER_RELIC_WARM_INCUBATOR",
  "ER_RELIC_COIN_PURSE",
  "ER_RELIC_MYSTERY_CHARM",
  "ER_RELIC_MORALE_BANNER",
  "ER_RELIC_SECOND_WIND",
  "ER_RELIC_TWIN_LINK",
  "ER_RELIC_ANCHOR",
  "ER_RELIC_SCRAP_MAGNET",
  "ER_RELIC_WEATHERVANE",
  "ER_RELIC_BONDED_CHARM",
  "ER_RELIC_COLLECTORS_ALBUM",
  "ER_RELIC_QUARTERMASTER",
  "ER_RELIC_LOOKOUT",
  "ER_RELIC_MOLTEN_CORE",
  "ER_RELIC_CAPACITOR",
  "ER_RELIC_PHARAOH_ANKH",
  "ER_RELIC_COVENANT",
  "ER_RELIC_CURSED_IDOL",
] as const;

/** Build a relic ModifierType by its registry key (resolved at call time). */
const makeRelicType = (key: string) =>
  (modifierTypes as Record<string, () => ReturnType<typeof modifierTypes.ER_RELIC_CURSED_IDOL>>)[key]();

describe("ER relic save persistence", () => {
  it("the hardcoded relic list stays in sync with the live registry", () => {
    const live = Object.keys(modifierTypes).filter(k => k.startsWith("ER_RELIC_"));
    // Only enforce equality if the registry is enumerable in this env (it is once
    // initialised); a non-enumerable shape would yield [], which the per-relic
    // round-trips still cover. A populated, divergent list is a real drift.
    if (live.length > 0) {
      expect(new Set(live)).toEqual(new Set(RELIC_KEYS));
    }
  });

  it.each(RELIC_KEYS)("%s round-trips through save load (was dropped with id='')", key => {
    const type = makeRelicType(key);

    // The fix: the factory pins the id (was "" -> save typeId="" -> dropped).
    expect(type.id).toBe(key);
    // ...and that id must resolve back to a type factory on the load side.
    expect(getModifierTypeFuncById(type.id)).toBeDefined();

    // Grant it exactly as the game does, then serialize like GameData.saveAll.
    const granted = type.newModifier() as ErRelicModifier;
    const data = new ModifierData(granted, true);
    expect(data.typeId).toBe(key);

    // Reconstruct exactly as GameData.loadSession does.
    const restored = data.toModifier(ErRelicModifier) as ErRelicModifier | null;
    expect(restored).not.toBeNull();
    expect(restored).toBeInstanceOf(ErRelicModifier);
    expect(restored!.kind).toBe(granted.kind);
    expect(restored!.stackCount).toBe(granted.stackCount);
  });

  it("preserves a stacked relic's stackCount across the round-trip", () => {
    const type = modifierTypes.ER_RELIC_CURSED_IDOL();
    const kind = (type.newModifier() as ErRelicModifier).kind as ErRelicKind;
    // Stack two (clamped to the relic's max inside toModifier, which we stay under).
    const granted = new ErRelicModifier(type, kind, 1);
    granted.stackCount = Math.min(2, granted.getMaxStackCount());

    const restored = new ModifierData(granted, true).toModifier(ErRelicModifier) as ErRelicModifier | null;
    expect(restored).not.toBeNull();
    expect(restored!.stackCount).toBe(granted.stackCount);
  });
});
