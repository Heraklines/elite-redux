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

import type { BattleScene } from "#app/battle-scene";
import { initGlobalScene } from "#app/global-scene";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { ER_COMMUNITY_ITEM_CONFIG, type ErCommunityItemKind } from "#data/elite-redux/er-community-items";
import { ErGemModifier, erGemItemType } from "#data/elite-redux/er-elemental-gems";
import { resolveErModifierClass } from "#data/elite-redux/er-persistent-modifiers";
import { ErReactiveItemModifier, erReactiveItemType } from "#data/elite-redux/er-reactive-items";
import {
  ER_ASSAULT_VEST_TYPE,
  ER_LIFE_ORB_TYPE,
  ER_ROCKY_HELMET_TYPE,
  ErAssaultVestModifier,
  ErLifeOrbModifier,
  ErRockyHelmetModifier,
} from "#data/elite-redux/er-recreated-items";
import {
  ER_RESIST_BERRY_BY_TYPE,
  ErResistBerryModifier,
  erResistBerryModifierType,
  erResistBerryTypeId,
} from "#data/elite-redux/er-resist-berries";
import {
  ER_TACTICAL_CONFIG,
  ErTacticalItemModifier,
  type ErTacticalKind,
  erTacticalItemType,
} from "#data/elite-redux/er-tactical-items";
import { ErSeedModifier, erSeedItemType } from "#data/elite-redux/er-terrain-seeds";
import {
  ER_WARD_STONE_CONFIG,
  ER_WARD_STONE_TIERS,
  ErWardStoneModifier,
  erWardStoneModifierType,
  erWardStoneTypeId,
} from "#data/elite-redux/er-ward-stones";
import { BerryType } from "#enums/berry-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import * as Modifier from "#modifiers/modifier";
import { ErCommunityItemModifier, PersistentModifier } from "#modifiers/modifier";
import {
  erCommunityItemModifierType,
  erCommunityItemTypeId,
  getModifierTypeFuncById,
  type ModifierType,
  ModifierTypeGenerator,
} from "#modifiers/modifier-type";
import { getModifierDataTypeFactory, ModifierData } from "#system/modifier-data";
import { beforeAll, describe, expect, it } from "vitest";

/** Minimal stand-in - the round-trip never reads the type, only stores it. */
const stubType = (id: string): ModifierType => ({ id }) as unknown as ModifierType;

class IdentityProbeModifier extends PersistentModifier {
  clone(): PersistentModifier {
    return new IdentityProbeModifier(this.type, this.stackCount);
  }

  apply(): boolean {
    return true;
  }

  getMaxStackCount(): number {
    return 1;
  }
}

/** Reconstruct exactly as GameData.toModifier does: ctor(type, ...getArgs, stackCount). */
function roundTrip<T extends ErGemModifier | ErReactiveItemModifier | ErSeedModifier | ErAssaultVestModifier>(
  original: T,
): T {
  const Cls = resolveErModifierClass(original.constructor.name);
  expect(Cls, original.constructor.name).toBeDefined();
  return Reflect.construct(Cls!, [original.type, ...original.getArgs(), original.stackCount]) as T;
}

type ModCtor = new (...args: any[]) => PersistentModifier;

/**
 * The REAL save->load path: serialize to ModifierData, then rebuild it exactly as
 * GameData.loadSession does - `Modifier[className] ?? resolveErModifierClass(...)`
 * fed to `toModifier`, which FIRST gates on `getModifierTypeFuncById(typeId)`. The
 * `roundTrip` helper above skips that guard, so it can't catch a typeId="" drop;
 * this one does. Returns null exactly where the loader would drop the item.
 */
function reload(original: PersistentModifier): PersistentModifier | null {
  const data = new ModifierData(original, true);
  const registry = Modifier as unknown as Record<string, ModCtor | undefined>;
  const ctor = registry[data.className] ?? resolveErModifierClass(data.className);
  return data.toModifier(ctor);
}

describe("ER held-item save persistence", () => {
  // `toModifier` clamps stackCount via getMaxStackCount -> globalScene.getPokemonById.
  // We don't spin up a game; a 1-method stub is enough for the held-item caps
  // (which ignore the pokemon for these ER items).
  beforeAll(() => {
    initGlobalScene({ getPokemonById: () => ({ isPlayer: () => false }) } as unknown as BattleScene);
  });

  it("fails at construction instead of admitting an untraceable persistent modifier", () => {
    expect(() => new IdentityProbeModifier(stubType(""))).toThrow(/stable ModifierType\.id/);
    expect(() => new IdentityProbeModifier(stubType("TRACEABLE"))).not.toThrow();
  });

  it("every dynamic generator pins its own registry id, including rare variants", () => {
    const cases: [string, unknown[]][] = [
      ["SPECIES_STAT_BOOSTER", ["DEEP_SEA_TOOTH"]],
      ["RARE_SPECIES_STAT_BOOSTER", ["LIGHT_BALL"]],
      ["TEMP_STAT_STAGE_BOOSTER", [Stat.ATK]],
      ["BASE_STAT_BOOSTER", [Stat.HP]],
      ["ATTACK_TYPE_BOOSTER", [PokemonType.FIRE]],
      ["MINT", [Nature.HARDY]],
      ["TERA_SHARD", [PokemonType.WATER]],
      ["BERRY", [BerryType.SITRUS]],
      ["TM_COMMON", [MoveId.TACKLE]],
      ["TM_GREAT", [MoveId.TACKLE]],
      ["TM_ULTRA", [MoveId.TACKLE]],
      ["EVOLUTION_ITEM", [EvolutionItem.LINKING_CORD]],
      ["RARE_EVOLUTION_ITEM", [EvolutionItem.BLACK_AUGURITE]],
      ["FORM_CHANGE_ITEM", [FormChangeItem.ABOMASITE]],
      ["RARE_FORM_CHANGE_ITEM", [FormChangeItem.SHARP_METEORITE]],
      ["MYSTERY_ENCOUNTER_SHUCKLE_JUICE", [10]],
      ["MYSTERY_ENCOUNTER_BLACK_SLUDGE", [2.5]],
    ];
    for (const [id, pregenArgs] of cases) {
      const generator = getModifierTypeFuncById(id)();
      expect(generator, id).toBeInstanceOf(ModifierTypeGenerator);
      expect(generator.id, `${id} generator identity`).toBe(id);
      const concrete = (generator as ModifierTypeGenerator).generateType([], pregenArgs);
      expect(concrete, `${id} concrete type`).not.toBeNull();
      expect(concrete!.id, `${id} concrete identity`).toBe(id);
    }
  });

  it("registers every ER class used by save/co-op reconstruction", () => {
    expect(resolveErModifierClass("ErGemModifier")).toBe(ErGemModifier);
    expect(resolveErModifierClass("ErSeedModifier")).toBe(ErSeedModifier);
    expect(resolveErModifierClass("ErReactiveItemModifier")).toBe(ErReactiveItemModifier);
    expect(resolveErModifierClass("ErTacticalItemModifier")).toBe(ErTacticalItemModifier);
    expect(resolveErModifierClass("ErAssaultVestModifier")).toBe(ErAssaultVestModifier);
    expect(resolveErModifierClass("ErResistBerryModifier")).toBe(ErResistBerryModifier);
    expect(resolveErModifierClass("ErWardStoneModifier")).toBe(ErWardStoneModifier);
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

  it("pins the modifierType id (ER_*) so items persist from EVERY grant path, not just rewards", () => {
    // The class registry above only matters once toModifier gets past its
    // getModifierTypeFuncById(typeId) guard. These builders used id="", so an
    // off-pool grant (loot/event) saved typeId="" and the load dropped it (the
    // "gems vanish for some people" report). Each id must equal its
    // modifierTypeInitObj key.
    expect(erGemItemType(PokemonType.FIRE).id).toBe("ER_FIRE_GEM");
    expect(erGemItemType(PokemonType.WATER).id).toBe("ER_WATER_GEM");
    expect(erSeedItemType("electricSeed").id).toBe("ER_ELECTRIC_SEED");
    expect(erSeedItemType("grassySeed").id).toBe("ER_GRASSY_SEED");
    expect(erReactiveItemType("cellBattery").id).toBe("ER_CELL_BATTERY");
    expect(erReactiveItemType("weaknessPolicy").id).toBe("ER_WEAKNESS_POLICY");
    expect(erTacticalItemType("expertBelt").id).toBe("ER_EXPERT_BELT");
    expect(erTacticalItemType("covertCloak").id).toBe("ER_COVERT_CLOAK");
    expect(erTacticalItemType("redCard").id).toBe("ER_RED_CARD");
    expect(erTacticalItemType("ejectButton").id).toBe("ER_EJECT_BUTTON");
  });

  it("round-trips EVERY tactical item through the full load path, preserving kind + Booster charge state", () => {
    const kinds = Object.keys(ER_TACTICAL_CONFIG) as ErTacticalKind[];
    expect(kinds.length).toBe(27);
    for (const [index, kind] of kinds.entries()) {
      const type = erTacticalItemType(kind);
      // The pinned id MUST be a real registry key, or the loader drops the item.
      expect(getModifierTypeFuncById(type.id), `getModifierTypeFuncById(${type.id})`).toBeDefined();

      // Exercise the Booster-Energy charge fields (spent / waveProgress) so they
      // round-trip through getArgs -> ModifierData -> ctor for every kind.
      const spent = index % 2 === 1;
      const waveProgress = index;
      const original = new ErTacticalItemModifier(type, 900 + index, kind, spent, waveProgress, 1);
      const restored = reload(original) as ErTacticalItemModifier | null;
      expect(restored, kind).toBeInstanceOf(ErTacticalItemModifier);
      expect(restored!.kind, kind).toBe(kind);
      expect(restored!.pokemonId).toBe(900 + index);
      expect(restored!.spent, kind).toBe(spent);
      expect(restored!.waveProgress, kind).toBe(waveProgress);
      expect(restored!.matchType(original), kind).toBe(true);
    }
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

  it("pins + registers the recreated trainer items so they survive the FULL load path", () => {
    // Both halves must line up: a pinned type.id AND a modifierTypeInitObj entry
    // under that same id. The class registry alone isn't enough - toModifier bails
    // at getModifierTypeFuncById(typeId) before it ever reaches the ctor.
    for (const make of [ER_LIFE_ORB_TYPE, ER_ASSAULT_VEST_TYPE, ER_ROCKY_HELMET_TYPE]) {
      const id = make().id;
      expect(id, "recreated item must pin a non-empty id").toBeTruthy();
      expect(getModifierTypeFuncById(id), `getModifierTypeFuncById(${id})`).toBeDefined();
    }

    // Round-trip the two PokemonHeldItem-shaped ones through the real loader.
    const orb = reload(new ErLifeOrbModifier(ER_LIFE_ORB_TYPE(), 7));
    expect(orb).toBeInstanceOf(ErLifeOrbModifier);
    expect((orb as ErLifeOrbModifier).pokemonId).toBe(7);

    const helmet = reload(new ErRockyHelmetModifier(ER_ROCKY_HELMET_TYPE(), 8));
    expect(helmet).toBeInstanceOf(ErRockyHelmetModifier);
    expect((helmet as ErRockyHelmetModifier).pokemonId).toBe(8);

    // Assault Vest through the real loader (not just resolveErModifierClass).
    const vest = reload(new ErAssaultVestModifier(ER_ASSAULT_VEST_TYPE(), 9));
    expect(vest).toBeInstanceOf(ErAssaultVestModifier);
    expect((vest as ErAssaultVestModifier).pokemonId).toBe(9);
  });

  it("round-trips EVERY community item through the full load path, preserving kind + charges", () => {
    const kinds = Object.keys(ER_COMMUNITY_ITEM_CONFIG) as ErCommunityItemKind[];
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      const id = erCommunityItemTypeId(kind);
      // The derived id MUST be a real registry key, or the loader drops the item.
      expect(getModifierTypeFuncById(id), `getModifierTypeFuncById(${id})`).toBeDefined();
      expect(erCommunityItemModifierType(kind).id, kind).toBe(id);

      // A non-default charge state must survive (Omni Gem / Power Herb spend charges).
      const original = new ErCommunityItemModifier(erCommunityItemModifierType(kind), 42, kind, 1, 4);
      const restored = reload(original) as ErCommunityItemModifier | null;
      expect(restored, kind).toBeInstanceOf(ErCommunityItemModifier);
      expect(restored!.kind, kind).toBe(kind);
      expect(restored!.pokemonId).toBe(42);
      expect(restored!.charges).toBe(1);
      expect(restored!.waveProgress).toBe(4);
    }
  });

  it("round-trips EVERY Ward Stone tier through ModifierData with mutable charge state", () => {
    const ids = new Set<string>();
    for (const [index, tier] of ER_WARD_STONE_TIERS.entries()) {
      const id = erWardStoneTypeId(tier);
      const type = erWardStoneModifierType(tier);
      expect(type.id, tier).toBe(id);
      expect(getModifierDataTypeFactory(id), `${id} dynamic factory`).toBeDefined();
      ids.add(id);

      const max = ER_WARD_STONE_CONFIG[tier].maxCharges;
      const original = new ErWardStoneModifier(type, 700 + index, tier, Math.max(0, max - 1), 4 + index, 1);
      const restored = reload(original) as ErWardStoneModifier | null;
      expect(restored, tier).toBeInstanceOf(ErWardStoneModifier);
      expect(restored!.pokemonId).toBe(700 + index);
      expect(restored!.tier).toBe(tier);
      expect(restored!.charges).toBe(Math.max(0, max - 1));
      expect(restored!.waveProgress).toBe(4 + index);
    }
    expect(ids.size).toBe(ER_WARD_STONE_TIERS.length);
  });

  it("round-trips EVERY resist-berry variant through ModifierData", () => {
    const ids = new Set<string>();
    for (const [index, resistType] of [...ER_RESIST_BERRY_BY_TYPE.keys()].entries()) {
      const id = erResistBerryTypeId(resistType);
      const type = erResistBerryModifierType(resistType);
      expect(type.id, PokemonType[resistType]).toBe(id);
      expect(getModifierDataTypeFactory(id), `${id} dynamic factory`).toBeDefined();
      ids.add(id);

      const original = new ErResistBerryModifier(type, 800 + index, resistType, 1);
      const restored = reload(original) as ErResistBerryModifier | null;
      expect(restored, PokemonType[resistType]).toBeInstanceOf(ErResistBerryModifier);
      expect(restored!.pokemonId).toBe(800 + index);
      expect(restored!.resistType).toBe(resistType);
    }
    expect(ids.size).toBe(ER_RESIST_BERRY_BY_TYPE.size);
  });
});
