/**
 * A list of possible flags that various moves may have.
 * Represented internally as a bitmask.
 */
export enum MoveFlags {
  NONE = 0,
  /**
   * Whether the move makes contact.
   * Set by default on all contact moves, and unset by default on all special moves.
   */
  MAKES_CONTACT = 1 << 0,
  IGNORE_PROTECT = 1 << 1,
  /**
   * Sound-based moves have the following effects:
   * - Pokemon with the {@linkcode AbilityId.SOUNDPROOF | Soundproof}  Ability are unaffected by other Pokemon's sound-based moves.
   * - Pokemon affected by {@linkcode MoveId.THROAT_CHOP | Throat Chop} cannot use sound-based moves for two turns.
   * - Sound-based moves used by a Pokemon with {@linkcode AbilityId.LIQUID_VOICE | Liquid Voice} become Water-type moves.
   * - Sound-based moves used by a Pokemon with {@linkcode AbilityId.PUNK_ROCK | Punk Rock} are boosted by 30%. Pokemon with Punk Rock also take half damage from sound-based moves.
   * - All sound-based moves (except Howl) can hit Pokemon behind an active {@linkcode MoveId.SUBSTITUTE | Substitute}.
   *
   * cf https://bulbapedia.bulbagarden.net/wiki/Sound-based_move
   */
  SOUND_BASED = 1 << 2,
  HIDE_USER = 1 << 3,
  HIDE_TARGET = 1 << 4,
  BITING_MOVE = 1 << 5,
  PULSE_MOVE = 1 << 6,
  PUNCHING_MOVE = 1 << 7,
  SLICING_MOVE = 1 << 8,
  /**
   * Indicates a move should be affected by {@linkcode AbilityId.RECKLESS}
   * @see {@linkcode Move.recklessMove}
   */
  RECKLESS_MOVE = 1 << 9,
  /** Indicates a move should be affected by {@linkcode AbilityId.BULLETPROOF} */
  BALLBOMB_MOVE = 1 << 10,
  /** Grass types and pokemon with {@linkcode AbilityId.OVERCOAT} are immune to powder moves */
  POWDER_MOVE = 1 << 11,
  /** Indicates a move should trigger {@linkcode AbilityId.DANCER} */
  DANCE_MOVE = 1 << 12,
  /** Indicates a move should trigger {@linkcode AbilityId.WIND_RIDER} */
  WIND_MOVE = 1 << 13,
  /** Indicates a move should trigger {@linkcode AbilityId.TRIAGE} */
  TRIAGE_MOVE = 1 << 14,
  IGNORE_ABILITIES = 1 << 15,
  /** Enables all hits of a multi-hit move to be accuracy checked individually */
  CHECK_ALL_HITS = 1 << 16,
  /** Indicates a move is able to bypass its target's Substitute (if the target has one) */
  IGNORE_SUBSTITUTE = 1 << 17,
  /** Indicates a move is able to be reflected by {@linkcode AbilityId.MAGIC_BOUNCE} and {@linkcode MoveId.MAGIC_COAT} */
  REFLECTABLE = 1 << 18,
  /** Indicates a move should fail when {@link https://bulbapedia.bulbagarden.net/wiki/Gravity_(move) | Gravity} is in effect */
  GRAVITY = 1 << 19,
  /**
   * Elite Redux: air- or wing-based moves. Boosted by ER abilities such as
   * `Giant Wings`. No vanilla pokerogue analog.
   */
  AIR_BASED = 1 << 20,
  /**
   * Elite Redux: arrow-based moves. Boosted by ER's `Archer` ability.
   * No vanilla pokerogue analog.
   */
  ARROW_BASED = 1 << 21,
  /**
   * Elite Redux: bone-based moves. Boosted by ER's `Calcium Bones` ability
   * (sourced from Marowak-family moves). No vanilla pokerogue analog.
   */
  BONE_BASED = 1 << 22,
  /**
   * Elite Redux: drill-based moves. Often shares boosters with
   * {@linkcode HORN_BASED} via composite ER abilities. No vanilla pokerogue analog.
   */
  DRILL_BASED = 1 << 23,
  /**
   * Elite Redux: terrain/field-interaction moves. Triggers ER abilities
   * that key on field manipulation. No vanilla pokerogue analog.
   */
  FIELD_BASED = 1 << 24,
  /**
   * Elite Redux: hammer-based moves. Boosted by ER's `Super Slammer` ability.
   * No vanilla pokerogue analog.
   */
  HAMMER_BASED = 1 << 25,
  /**
   * Elite Redux: horn-based moves. Boosted by ER's `Mighty Horn` ability
   * (and its drill-flavoured composite). No vanilla pokerogue analog.
   */
  HORN_BASED = 1 << 26,
  /**
   * Elite Redux: kicking moves. Boosted by ER's `Striker` ability (the
   * kick-flavoured Iron Fist analog). No vanilla pokerogue analog.
   */
  KICKING_MOVE = 1 << 27,
  /**
   * Elite Redux: lunar-themed moves (e.g. moon-flavoured attacks). Used by
   * ER's lunar-themed forms for stat-boost interactions. No vanilla pokerogue analog.
   */
  LUNAR_MOVE = 1 << 28,
  /**
   * Elite Redux: throw-flavoured moves (Beat Up, Bonemerang lineage). Used by
   * ER throw-boost abilities. No vanilla pokerogue analog.
   */
  THROW_BASED = 1 << 29,
  /**
   * Elite Redux: moves whose mechanics interact with the active weather.
   * Used by ER weather-syncing abilities. No vanilla pokerogue analog.
   */
  WEATHER_BASED = 1 << 30,
}
