/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER relics batch (#130) - SAVE ROUND-TRIP. Each new relic, granted then driven
// through the REAL load machinery (ModifierData -> getModifierTypeFuncById ->
// toModifier), comes back as an ErRelicModifier with the same kind/stack. This is
// the maintainer's "proper save serialization" requirement (the #61 fix discipline)
// and ALSO pins Stormglass's chosen-weather extra ctor arg, modeled on how
// ErCommunityItemModifier carries charges (er-item-save-persistence.test.ts).
//
// Pure reconstruction, NO game init (a 1-method scene stub), so it must stay in its
// OWN file: a stub globalScene here would crash the GameManager-based effect test
// (er-new-relics.test.ts) which re-uses globalScene if one already exists.
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { WeatherType } from "#enums/weather-type";
import * as Modifier from "#modifiers/modifier";
import { ErRelicModifier, type PersistentModifier } from "#modifiers/modifier";
import { getModifierTypeFuncById } from "#modifiers/modifier-type";
import { ModifierData } from "#system/modifier-data";
import { beforeAll, describe, expect, it } from "vitest";

/** The 7 new relics: registry key + kind, used to enumerate the round-trips. */
const NEW_RELICS = [
  { key: "ER_RELIC_BLOOD_PACT", kind: "bloodPact" },
  { key: "ER_RELIC_MOMENTUM_ENGINE", kind: "momentumEngine" },
  { key: "ER_RELIC_STORMGLASS", kind: "stormglass" },
  { key: "ER_RELIC_CARTOGRAPHERS_LENS", kind: "cartographersLens" },
  { key: "ER_RELIC_TRAILBLAZERS_MARK", kind: "trailblazersMark" },
  { key: "ER_RELIC_MERCHANTS_SEAL", kind: "merchantsSeal" },
  { key: "ER_RELIC_GAMBLERS_COIN", kind: "gamblersCoin" },
] as const;

type ModCtor = new (...args: any[]) => PersistentModifier;

/**
 * The REAL save->load path (mirrors GameData.loadSession): serialize to ModifierData,
 * then rebuild via `Modifier[className]` fed to toModifier, which FIRST gates on
 * getModifierTypeFuncById(typeId). Returns null exactly where the loader would drop it.
 */
function reload(original: PersistentModifier): PersistentModifier | null {
  const data = new ModifierData(original, true);
  const registry = Modifier as unknown as Record<string, ModCtor | undefined>;
  const ctor = registry[data.className];
  return data.toModifier(ctor);
}

describe("ER new relics (#130) - save persistence", () => {
  // toModifier clamps stackCount via getMaxStackCount; for relics that path never
  // reads a Pokemon (it reads ER_RELIC_CONFIG), so a 1-method scene stub is enough.
  beforeAll(() => {
    initGlobalScene({ getPokemonById: () => ({ isPlayer: () => false }) } as unknown as BattleScene);
  });

  it.each(NEW_RELICS)("$key round-trips through the full save load path", ({ key, kind }) => {
    const type = (modifierTypes as Record<string, () => ReturnType<typeof modifierTypes.ER_RELIC_CURSED_IDOL>>)[key]();
    // The #61 save fix: the factory pins the id, and that id must equal the key AND
    // resolve back to a factory on the load side.
    expect(type.id).toBe(key);
    expect(getModifierTypeFuncById(type.id)).toBeDefined();

    const granted = type.newModifier() as ErRelicModifier;
    expect(granted.kind).toBe(kind);

    const restored = reload(granted) as ErRelicModifier | null;
    expect(restored, key).toBeInstanceOf(ErRelicModifier);
    expect(restored!.kind, key).toBe(kind);
    expect(restored!.stackCount).toBe(granted.stackCount);
  });

  it("preserves Stormglass's CHOSEN weather across the round-trip (the extra ctor arg)", () => {
    const type = modifierTypes.ER_RELIC_STORMGLASS();
    // Grant, then set a chosen weather as the game would - it must survive the save
    // serializer via getArgs, exactly like a community item's charges.
    const granted = new ErRelicModifier(type, "stormglass", WeatherType.SANDSTORM, 1);
    expect(granted.chosenWeather).toBe(WeatherType.SANDSTORM);

    const restored = reload(granted) as ErRelicModifier | null;
    expect(restored).toBeInstanceOf(ErRelicModifier);
    expect(restored!.kind).toBe("stormglass");
    expect(restored!.chosenWeather).toBe(WeatherType.SANDSTORM);
  });

  it("a relic with no chosen weather round-trips a null (every non-Stormglass relic)", () => {
    const granted = modifierTypes.ER_RELIC_BLOOD_PACT().newModifier() as ErRelicModifier;
    expect(granted.chosenWeather).toBeNull();
    const restored = reload(granted) as ErRelicModifier | null;
    expect(restored).toBeInstanceOf(ErRelicModifier);
    expect(restored!.chosenWeather).toBeNull();
  });
});
