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

/**
 * The roundings of the "has at most / at least / between % HP" atoms: `exact` and `floor-half` as above, plus
 * `rounded-ratio`, which reads the game's own two-decimal ratio (`Pokemon.getHpRatio()`, pokemon.ts:2430,
 * `Math.round(hp / maxHp * 100) / 100`) the way the Zen Mode, Schooling and Defeatist closures do.
 */
export const HP_LEVEL_ROUNDING_OPTIONS = ["exact", "floor-half", "rounded-ratio"] as const;

/**
 * The roundings of "just dropped below": `exact` (Wimp Out), `floor-half` (Berserk) and `damage-value`, the
 * Anger Shell form `toDmgValue(maxHp * ratio)`, which never lets the line fall to 0 HP.
 */
export const HP_CROSSING_ROUNDING_OPTIONS = ["exact", "floor-half", "damage-value"] as const;

export type HpRounding =
  | (typeof HP_ROUNDING_OPTIONS)[number]
  | (typeof HP_LEVEL_ROUNDING_OPTIONS)[number]
  | (typeof HP_CROSSING_ROUNDING_OPTIONS)[number];

/** Whose HP an HP atom reads: one Pokemon, or "any foe" (true when at least one opponent matches). */
export const HP_WHO_OPTIONS = ["holder", "other", "ally", "any-foe"] as const;

/** Whose HP the "just dropped below" atom reads (the damage slot belongs to one Pokemon). */
export const HP_CROSSING_WHO_OPTIONS = ["holder", "other"] as const;

/** The two Pokemon a hit can be read from. */
export const HIT_SIDE_OPTIONS = ["holder", "other"] as const;

export const ONCE_PER_SCOPES = ["entry", "wave", "battle", "turn", "switch"] as const;
export type OncePerScope = (typeof ONCE_PER_SCOPES)[number];

export const ARENA_SIDE_OPTIONS = ["holder-side", "opposing-side", "both"] as const;

export const SIDE_KIND_OPTIONS = ["ally", "foe", "self"] as const;

export const ITEM_KIND_OPTIONS = ["any", "berry"] as const;

export const TARGET_KIND_OPTIONS = ["single", "all-foes", "all-others", "user-or-ally", "field"] as const;

/**
 * The exact aim of a move, one entry per way the game can aim it, in player words. The evaluate side maps each word to
 * the MoveTarget it stands for (evaluate/conditions.ts EXACT_TARGETS).
 */
export const MOVE_AIM_OPTIONS = [
  "one other Pokemon, any distance",
  "one adjacent Pokemon",
  "one adjacent foe",
  "one random adjacent foe",
  "all adjacent Pokemon",
  "all adjacent foes",
  "all foes",
  "all other Pokemon",
  "the foe's side of the field",
  "my side of the field",
  "both sides of the field",
  "only the user",
  "an adjacent ally",
  "an ally, any distance",
  "the user or an adjacent ally",
  "the user and its allies",
  "every Pokemon",
  "the whole party",
  "the Pokemon that last hit the user",
  "the Curse aim",
] as const;
