import type { ArenaTag, ArenaTagTypeMap } from "#data/arena-tag";
import type { NonSerializableArenaTagType, SerializableArenaTagType } from "#types/arena-tags";

/**
 * Enum representing all different types of {@linkcode ArenaTag}s.
 * @privateRemarks
 * ⚠️ When modifying the fields in this enum, ensure that:
 * - The entry is added to / removed from {@linkcode ArenaTagTypeMap}
 * - The tag is added to / removed from {@linkcode NonSerializableArenaTagType} or {@linkcode SerializableArenaTagType}
 */
export enum ArenaTagType {
  NONE = "NONE",
  MUD_SPORT = "MUD_SPORT",
  WATER_SPORT = "WATER_SPORT",
  SPIKES = "SPIKES",
  TOXIC_SPIKES = "TOXIC_SPIKES",
  MIST = "MIST",
  /** Elite Redux (#394): ER Smokescreen - obscures the user's party in smoke, +25% evasiveness for 5 turns. */
  ER_SMOKESCREEN = "ER_SMOKESCREEN",
  STEALTH_ROCK = "STEALTH_ROCK",
  STICKY_WEB = "STICKY_WEB",
  TRICK_ROOM = "TRICK_ROOM",
  /** Elite Redux — Inverse Room: reverses type matchups field-wide for a few turns. */
  INVERSE_ROOM = "INVERSE_ROOM",
  GRAVITY = "GRAVITY",
  REFLECT = "REFLECT",
  LIGHT_SCREEN = "LIGHT_SCREEN",
  AURORA_VEIL = "AURORA_VEIL",
  QUICK_GUARD = "QUICK_GUARD",
  WIDE_GUARD = "WIDE_GUARD",
  MAT_BLOCK = "MAT_BLOCK",
  CRAFTY_SHIELD = "CRAFTY_SHIELD",
  TAILWIND = "TAILWIND",
  HAPPY_HOUR = "HAPPY_HOUR",
  SAFEGUARD = "SAFEGUARD",
  NO_CRIT = "NO_CRIT",
  IMPRISON = "IMPRISON",
  ION_DELUGE = "ION_DELUGE",
  FIRE_GRASS_PLEDGE = "FIRE_GRASS_PLEDGE",
  WATER_FIRE_PLEDGE = "WATER_FIRE_PLEDGE",
  GRASS_WATER_PLEDGE = "GRASS_WATER_PLEDGE",
  FAIRY_LOCK = "FAIRY_LOCK",
  NEUTRALIZING_GAS = "NEUTRALIZING_GAS",
  PENDING_HEAL = "PENDING_HEAL",
  /** Elite Redux — Hot Coals: single-use foe-side trap that burns the next grounded, burnable switch-in. */
  HOT_COALS = "HOT_COALS",
  /**
   * Elite Redux — Foamy Web (ability 949): a Sticky Web variant laid on the
   * foe's side that lasts only 5 turns and cannot be removed by Rapid Spin or
   * Defog (it is intentionally absent from those moves' removal lists). Lowers
   * the Speed of grounded switch-ins by 1 stage, exactly like Sticky Web.
   */
  FOAMY_WEB = "FOAMY_WEB",
  /**
   * Elite Redux — Creeping Thorns: a Spikes-style entry hazard that damages the
   * grounded switch-in (Spikes' layer-based 1/8, 1/6, 1/4 ratio) AND inflicts
   * ER_BLEED on it. Deployed by the Loose Thorns ability (909, "Sets Creeping
   * Thorns when hit by contact") and the Creeping Thorns / Caltrops moves.
   */
  CREEPING_THORNS = "CREEPING_THORNS",
  /**
   * Elite Redux — Clear Skies: while active, no new weather can be set (checked
   * in {@linkcode Arena.canSetWeather}). Lasts 5 turns; does not block clearing
   * to {@linkcode WeatherType.NONE}. Field-wide.
   */
  ER_WEATHER_LOCK = "ER_WEATHER_LOCK",
  /**
   * Elite Redux — one-use entry trap primitive. Placed on a side (typically the
   * opposing side, via an entry ability like Spore Bed); the NEXT grounded switch-in
   * on that side has the trap's configured {@linkcode BattlerTagType} applied to it
   * (Spore Bed uses {@linkcode BattlerTagType.INFESTATION}), then the trap is spent
   * (removed at the next turn-end). Reusable: the applied effect is a serialized
   * field on {@linkcode ErEntryTrapTag}, so different mons can trap with different
   * effects without a new ArenaTagType.
   */
  ER_INFESTATION_TRAP = "ER_INFESTATION_TRAP",
}
