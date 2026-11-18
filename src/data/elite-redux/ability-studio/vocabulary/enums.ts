/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Enum option lists used by param schemas. They duplicate
// the V1 lists of ability-blueprint.ts on purpose (that file pulls in game code); a test keeps
// them identical.

export const TYPE_OPTIONS = [
  "NORMAL",
  "FIGHTING",
  "FLYING",
  "POISON",
  "GROUND",
  "ROCK",
  "BUG",
  "GHOST",
  "STEEL",
  "FIRE",
  "WATER",
  "GRASS",
  "ELECTRIC",
  "PSYCHIC",
  "ICE",
  "DRAGON",
  "DARK",
  "FAIRY",
  "STELLAR",
] as const;

export const CATEGORY_OPTIONS = ["PHYSICAL", "SPECIAL", "STATUS"] as const;

export const MOVE_FLAG_OPTIONS = [
  "MAKES_CONTACT",
  "SOUND_BASED",
  "BITING_MOVE",
  "PULSE_MOVE",
  "PUNCHING_MOVE",
  "SLICING_MOVE",
  "RECKLESS_MOVE",
  "BALLBOMB_MOVE",
  "POWDER_MOVE",
  "DANCE_MOVE",
  "WIND_MOVE",
  "TRIAGE_MOVE",
  "AIR_BASED",
  "ARROW_BASED",
  "BONE_BASED",
  "DRILL_BASED",
  "FIELD_BASED",
  "HAMMER_BASED",
  "HORN_BASED",
  "KICKING_MOVE",
  "LUNAR_MOVE",
  "THROW_BASED",
  "WEATHER_BASED",
] as const;

export const WEATHER_OPTIONS = [
  "NONE",
  "SUNNY",
  "RAIN",
  "SANDSTORM",
  "HAIL",
  "SNOW",
  "FOG",
  "HEAVY_RAIN",
  "HARSH_SUN",
  "STRONG_WINDS",
  "TEMPEST_STORM",
  "SNOWY_WRATH",
  "EERIE_FOG",
] as const;

export const TERRAIN_OPTIONS = ["NONE", "MISTY", "ELECTRIC", "GRASSY", "PSYCHIC", "TOXIC"] as const;

export const STATUS_OPTIONS = ["POISON", "TOXIC", "PARALYSIS", "SLEEP", "FREEZE", "BURN"] as const;

export const STAT_OPTIONS = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] as const;

export const TARGET_OPTIONS = ["holder", "other", "holder-side", "opposing-side"] as const;

/** Comparison operators for numeric atoms. */
export const COMPARE_OPTIONS = ["lt", "lte", "eq", "gte", "gt"] as const;
export type CompareOp = (typeof COMPARE_OPTIONS)[number];

/** Who a Pokemon-reading atom looks at. `ally` needs the ally slot. */
export const WHO_OPTIONS = ["holder", "other", "ally"] as const;
export type WhoOption = (typeof WHO_OPTIONS)[number];

/**
 * HP rounding variants (spec 1.3). `exact` keeps the original comparison as written (integer cross
 * multiplication for percentages, the class's own float expression for ratios). `floor-half` first
 * floors the threshold: hp <= floor(maxHp * pct / 100), the form Berserk-style abilities use.
 */
export const HP_ROUNDING_OPTIONS = ["exact", "floor-half"] as const;
export type HpRounding = (typeof HP_ROUNDING_OPTIONS)[number];

export const ONCE_PER_SCOPES = ["entry", "wave", "battle", "turn", "switch"] as const;
export type OncePerScope = (typeof ONCE_PER_SCOPES)[number];

export const ARENA_SIDE_OPTIONS = ["holder-side", "opposing-side", "both"] as const;

export const SIDE_KIND_OPTIONS = ["ally", "foe", "self"] as const;

export const ITEM_KIND_OPTIONS = ["any", "berry"] as const;

export const TARGET_KIND_OPTIONS = ["single", "all-foes", "all-others", "user-or-ally", "field"] as const;
