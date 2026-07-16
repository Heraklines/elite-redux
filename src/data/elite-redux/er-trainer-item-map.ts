/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — trainer held-item translation.
//
// ER trainer Pokémon carry an `itemId` (ER's GBA item enum). The runtime hook
// applies PokeRogue's normal trainer roll as the baseline, then — with a soft
// chance — converts to the ER-faithful item when one resolves here. Mega stones
// instead force the holder's Mega form (boss treatment, always).
//
// Coverage:
//   - flat 1:1 → existing PokeRogue held items (orbs, claws, lenses, Eviolite,
//     Leftovers, Soul Dew, Focus Band, weather rocks → Mystical Rock, …)
//   - type boosters → Gems + Plates map to AttackTypeBoosterModifierType(type)
//   - species items → Light Ball / Thick Club / Metal·Quick Powder / Deep Sea
//     Tooth via SpeciesStatBoosterModifierType
//   - recreated ER-only items → Life Orb / Assault Vest / Rocky Helmet
//   - mega stones → force Mega
//   - everything else (balls, berries, consumables, evo items, niche modern
//     items with no equivalent) → unresolved → baseline roll stands
// =============================================================================

import { TYPE_BOOST_ITEM_BOOST_PERCENT } from "#app/constants";
import { ER_MEGA_STONE_ITEM_IDS } from "#data/elite-redux/er-mega-stone-item-ids";
import {
  ER_ASSAULT_VEST_TYPE,
  ER_LIFE_ORB_TYPE,
  ER_ROCKY_HELMET_TYPE,
} from "#data/elite-redux/er-recreated-items";
import { PokemonType } from "#enums/pokemon-type";
import {
  AttackTypeBoosterModifierType,
  type ModifierType,
  type SpeciesStatBoosterItem,
  SpeciesStatBoosterModifierType,
  getModifierTypeFuncById,
} from "#modifiers/modifier-type";

/** Soft-conversion probability for a mappable ER held item (0-1). */
export const ER_ITEM_CONVERT_CHANCE = 0.25;

/** ER item id → PokeRogue modifier-type key (items that already exist here). */
export const ER_ITEM_TO_MODIFIER_KEY: Readonly<Record<number, string>> = {
  273: "LEFTOVERS",
  305: "LEFTOVERS", // Black Sludge → Leftovers (no Black Sludge; same turn-end heal)
  303: "FLAME_ORB",
  302: "TOXIC_ORB",
  254: "FOCUS_BAND",
  287: "FOCUS_BAND", // Focus Sash → Focus Band (nearest survivor item)
  310: "EVIOLITE",
  277: "SHELL_BELL",
  300: "GRIP_CLAW",
  244: "QUICK_CLAW",
  256: "SCOPE_LENS",
  288: "WIDE_LENS",
  241: "WHITE_HERB",
  375: "SOUL_DEW",
  245: "SOOTHE_BELL",
  // ER tactical held items (er-tactical-items.ts): faithful 1:1 recreations, so
  // an ER trainer's native item carries over. GROUND-TRUTH id math (2026-07-16):
  // LAST_MISC_ITEM_INDEX = ITEM_OLD_AMBER = 229, so id = 229 + the offset in
  // vendor/.../include/constants/items.h. DO NOT "verify" ids against that
  // file's LINE numbers - they coincidentally equal 250+offset and produced a
  // wrong base twice (the every-pre-existing-entry cross-check - LEFTOVERS
  // +44=273, WIDE_LENS +59=288, SOUL_DEW +146=375, BUG_GEM +103=332,
  // INSECT_PLATE +129=358, ROCKY_HELMET +83=312 - pins the true base at 229).
  246: "ER_MENTAL_HERB",
  252: "ER_SMOKE_BALL",
  289: "ER_ZOOM_LENS",
  290: "ER_METRONOME_ITEM",
  291: "ER_MUSCLE_BAND",
  292: "ER_WISE_GLASSES",
  293: "ER_EXPERT_BELT",
  304: "ER_STICKY_BARB",
  306: "ER_IRON_BALL",
  308: "ER_SHED_SHELL",
  311: "ER_FLOAT_STONE",
  313: "ER_AIR_BALLOON",
  314: "ER_RED_CARD",
  317: "ER_EJECT_BUTTON",
  324: "ER_SAFETY_GOGGLES",
  325: "ER_ADRENALINE_ORB",
  350: "ER_THROAT_SPRAY",
  351: "ER_EJECT_PACK",
  352: "ER_HEAVY_DUTY_BOOTS",
  353: "ER_BLUNDER_POLICY",
  354: "ER_ROOM_SERVICE",
  355: "ER_UTILITY_UMBRELLA",
  // Weather / terrain duration extenders → Mystical Rock.
  295: "MYSTICAL_ROCK", // Icy Rock
  296: "MYSTICAL_ROCK", // Smooth Rock
  297: "MYSTICAL_ROCK", // Heat Rock
  298: "MYSTICAL_ROCK", // Damp Rock
  326: "MYSTICAL_ROCK", // Terrain Extender
};

/** ER recreated ER-only items (see er-recreated-items.ts). */
export const ER_ITEM_RECREATE: Readonly<Record<number, "LIFE_ORB" | "ASSAULT_VEST" | "ROCKY_HELMET">> = {
  301: "LIFE_ORB",
  323: "ASSAULT_VEST",
  312: "ROCKY_HELMET",
};

/** ER Gem + Plate ids → boosted type (→ AttackTypeBoosterModifierType). */
export const ER_ITEM_TO_TYPE: Readonly<Record<number, PokemonType>> = {
  // Gems (332-349)
  332: PokemonType.BUG, 333: PokemonType.DARK, 334: PokemonType.DRAGON, 335: PokemonType.ELECTRIC,
  336: PokemonType.FAIRY, 337: PokemonType.FIGHTING, 338: PokemonType.FIRE, 339: PokemonType.FLYING,
  340: PokemonType.GHOST, 341: PokemonType.GRASS, 342: PokemonType.GROUND, 343: PokemonType.ICE,
  344: PokemonType.NORMAL, 345: PokemonType.POISON, 346: PokemonType.PSYCHIC, 347: PokemonType.ROCK,
  348: PokemonType.STEEL, 349: PokemonType.WATER,
  // Plates (358-373)
  358: PokemonType.BUG, 359: PokemonType.DARK, 360: PokemonType.DRAGON, 361: PokemonType.ELECTRIC,
  362: PokemonType.FAIRY, 363: PokemonType.FIGHTING, 364: PokemonType.FIRE, 365: PokemonType.FLYING,
  366: PokemonType.GHOST, 367: PokemonType.GRASS, 368: PokemonType.GROUND, 369: PokemonType.ICE,
  370: PokemonType.POISON, 371: PokemonType.PSYCHIC, 372: PokemonType.ROCK, 373: PokemonType.STEEL,
};

/** ER species-item ids → PokeRogue SpeciesStatBooster key. */
export const ER_ITEM_TO_SPECIES_KEY: Readonly<Record<number, SpeciesStatBoosterItem>> = {
  382: "LIGHT_BALL",
  380: "THICK_CLUB",
  379: "METAL_POWDER",
  383: "QUICK_POWDER",
  147: "DEEP_SEA_TOOTH",
};

/**
 * True if the raw ER item id is a mega/primal stone (or a legendary mega-trigger
 * orb/mask). ER's mega-stone item ids are NOT contiguous — they're scattered
 * across the ~384..970 range intermixed with ordinary items — so a numeric
 * threshold (the old `>= 748`) only caught a small fraction of them and silently
 * left most mega-stone holders in their base form. The authoritative id set is
 * generated from the vendor JSON (see er-mega-stone-item-ids.ts). Eviolite (310)
 * and Meteorite are excluded there despite the "-ite" suffix.
 */
export function isErMegaStone(itemId: number): boolean {
  return ER_MEGA_STONE_ITEM_IDS.has(itemId);
}

/** Result of resolving an ER held item to a PokeRogue action. */
export type ErItemResolution = { kind: "modifier"; make: () => ModifierType } | { kind: "mega" } | null;

/** Resolve an ER held-item id to the PokeRogue item/action it translates to. */
export function resolveErTrainerItem(itemId: number): ErItemResolution {
  if (itemId === 0) {
    return null;
  }
  if (isErMegaStone(itemId)) {
    return { kind: "mega" };
  }
  const rec = ER_ITEM_RECREATE[itemId];
  if (rec === "LIFE_ORB") {
    return { kind: "modifier", make: ER_LIFE_ORB_TYPE };
  }
  if (rec === "ASSAULT_VEST") {
    return { kind: "modifier", make: ER_ASSAULT_VEST_TYPE };
  }
  if (rec === "ROCKY_HELMET") {
    return { kind: "modifier", make: ER_ROCKY_HELMET_TYPE };
  }
  const key = ER_ITEM_TO_MODIFIER_KEY[itemId];
  if (key !== undefined) {
    const func = getModifierTypeFuncById(key);
    if (func) {
      return {
        kind: "modifier",
        make: () => {
          const modifierType = func();
          modifierType.id = key;
          return modifierType;
        },
      };
    }
  }
  const type = ER_ITEM_TO_TYPE[itemId];
  if (type !== undefined) {
    return {
      kind: "modifier",
      make: () => {
        const modifierType = new AttackTypeBoosterModifierType(type, TYPE_BOOST_ITEM_BOOST_PERCENT);
        modifierType.id = "ATTACK_TYPE_BOOSTER";
        return modifierType;
      },
    };
  }
  const speciesKey = ER_ITEM_TO_SPECIES_KEY[itemId];
  if (speciesKey !== undefined) {
    return {
      kind: "modifier",
      make: () => {
        const modifierType = new SpeciesStatBoosterModifierType(speciesKey);
        modifierType.id = "SPECIES_STAT_BOOSTER";
        return modifierType;
      },
    };
  }
  return null;
}
