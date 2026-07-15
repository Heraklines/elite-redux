import { modifierTypes } from "#data/data-lists";
import { BerryType } from "#enums/berry-type";
import type { ModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import type { HeldModifierConfig } from "#types/held-modifier-config";

/**
 * Production held-item resolver. Maps a string key (e.g., "LEFTOVERS") to a
 * `HeldModifierConfig` ready for `EnemyPokemonConfig.modifierConfigs`.
 *
 * Returns `null` when the key is unknown or doesn't refer to a per-Pokémon
 * held item — the authored team is allowed to specify keys we don't recognize;
 * the caller drops them silently.
 *
 * THREE resolution tiers (checked in order):
 *   1. A plain `modifierTypes` key (LEFTOVERS, EVIOLITE, and every `ER_*_GEM`
 *      elemental gem, which are individual keyed items) — resolved directly.
 *   2. A TYPE-BOOSTER item name (CHARCOAL, MYSTIC_WATER, MAGNET, …). The game
 *      registers only ONE generic `ATTACK_TYPE_BOOSTER` generator; a specific
 *      booster is produced by passing the item's `PokemonType` as a pregenArg.
 *   3. A BERRY key (`SITRUS_BERRY`, `LUM_BERRY`, …). Same story: one generic
 *      `BERRY` generator, keyed to a concrete `BerryType` via pregenArgs.
 *
 * Passing the pregenArg bypasses the generators' party-moveset-weighted RANDOM
 * fallback entirely, so an authored enemy fields EXACTLY the item requested,
 * deterministically and independent of the player's party.
 *
 * Lives in its own module (not in authored-team.ts) so the pure mapper stays
 * free of `globalScene`-dependent imports and remains unit-testable without
 * mocks.
 */

/**
 * The 18 `ATTACK_TYPE_BOOSTER` item names, in `PokemonType` order (index === the
 * `PokemonType` numeric value the generator expects as a pregenArg). Mirrors the
 * `AttackTypeBoosterItem` enum in `modifier-type.ts` (a module-local enum, so it
 * is duplicated here rather than imported). Kept in enum order so `index` is the
 * type value with no separate lookup table.
 */
const ATTACK_TYPE_BOOSTER_ITEMS = [
  "SILK_SCARF", // NORMAL (0)
  "BLACK_BELT", // FIGHTING (1)
  "SHARP_BEAK", // FLYING (2)
  "POISON_BARB", // POISON (3)
  "SOFT_SAND", // GROUND (4)
  "HARD_STONE", // ROCK (5)
  "SILVER_POWDER", // BUG (6)
  "SPELL_TAG", // GHOST (7)
  "METAL_COAT", // STEEL (8)
  "CHARCOAL", // FIRE (9)
  "MYSTIC_WATER", // WATER (10)
  "MIRACLE_SEED", // GRASS (11)
  "MAGNET", // ELECTRIC (12)
  "TWISTED_SPOON", // PSYCHIC (13)
  "NEVER_MELT_ICE", // ICE (14)
  "DRAGON_FANG", // DRAGON (15)
  "BLACK_GLASSES", // DARK (16)
  "FAIRY_FEATHER", // FAIRY (17)
] as const;

/** authored held-item key -> the generic generator + the pregenArg that specializes it. */
type ParameterizedHeldItem = { generatorKey: "ATTACK_TYPE_BOOSTER" | "BERRY"; pregenArg: number };

let parameterizedHeldItemsCache: Map<string, ParameterizedHeldItem> | null = null;
function parameterizedHeldItems(): Map<string, ParameterizedHeldItem> {
  if (parameterizedHeldItemsCache !== null) {
    return parameterizedHeldItemsCache;
  }
  const map = new Map<string, ParameterizedHeldItem>();
  // Type boosters: item name -> ATTACK_TYPE_BOOSTER with [PokemonType].
  ATTACK_TYPE_BOOSTER_ITEMS.forEach((name, type) => {
    map.set(name, { generatorKey: "ATTACK_TYPE_BOOSTER", pregenArg: type });
  });
  // Berries: `<NAME>_BERRY` -> BERRY with [BerryType]. Derived from the enum so
  // the set can never drift from the game's BerryType definition.
  for (const [name, value] of Object.entries(BerryType)) {
    if (typeof value === "number") {
      map.set(`${name}_BERRY`, { generatorKey: "BERRY", pregenArg: value });
    }
  }
  parameterizedHeldItemsCache = map;
  return map;
}

/**
 * Whether a generated `ModifierType` is a per-Pokémon held item (only
 * `PokemonHeldItemModifierType` exposes `newModifier`). Non-held types (POKEBALL,
 * RARE_CANDY, …) lack it and would crash later when the pool tries to attach the
 * item to a Pokémon, so those are rejected as unresolvable.
 */
function asHeldConfig(modifier: ModifierType | null): HeldModifierConfig | null {
  if (!modifier) {
    return null;
  }
  if (typeof (modifier as { newModifier?: unknown }).newModifier !== "function") {
    return null;
  }
  return { modifier: modifier as PokemonHeldItemModifierType };
}

export function resolveHeldItemKey(key: string): HeldModifierConfig | null {
  // Tier 1: a plain keyed modifier (LEFTOVERS, EVIOLITE, ER_*_GEM, …).
  const factory = (modifierTypes as Record<string, (() => ModifierType) | undefined>)[key];
  if (typeof factory === "function") {
    return asHeldConfig(generateModifierType(factory));
  }
  // Tier 2/3: a type-booster or berry family key that needs a pregenArg.
  const param = parameterizedHeldItems().get(key);
  if (param) {
    const generator = (modifierTypes as Record<string, (() => ModifierType) | undefined>)[param.generatorKey];
    if (typeof generator === "function") {
      return asHeldConfig(generateModifierType(generator, [param.pregenArg]));
    }
  }
  return null;
}
