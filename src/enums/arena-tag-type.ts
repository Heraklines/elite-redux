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
  /**
   * Elite Redux (move 478 Magic Room): suppresses the effects of ALL held items
   * on BOTH sides of the field for 5 turns (consulted in
   * {@linkcode PokemonHeldItemModifier.shouldApply}). Room-style: re-using Magic
   * Room while it is active ends it. Field-wide.
   */
  MAGIC_ROOM = "MAGIC_ROOM",
  /**
   * Elite Redux (move 472 Wonder Room): for 5 turns, every Pokemon's Attack and
   * Sp. Atk are swapped field-wide, and their stat stages ("buffs") are ignored
   * (the swap reads the RAW base stats). Consulted in
   * {@linkcode Pokemon.getEffectiveStat}. Room-style: re-using Wonder Room while
   * it is active ends it. Field-wide.
   */
  WONDER_ROOM = "WONDER_ROOM",
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
}
