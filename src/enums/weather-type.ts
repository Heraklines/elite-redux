export enum WeatherType {
  NONE,
  SUNNY,
  RAIN,
  SANDSTORM,
  HAIL,
  SNOW,
  FOG,
  HEAVY_RAIN,
  HARSH_SUN,
  STRONG_WINDS,
  /** Elite Redux — Tempest Storm: a thundershock storm that chips both sides each turn (Electric-types immune). */
  TEMPEST_STORM,
  /**
   * Elite Redux — Snowy Wrath: a damaging snow summoned by Snowy Wrath (er 666).
   * Behaves like HAIL (chips non-Ice types 1/16 HP per turn, Ice-types immune) AND
   * grants Ice-types the SNOW Defense boost (+50%). Distinct from vanilla HAIL/SNOW
   * so Abomasnow's plain hail is unaffected. Appended AFTER TEMPEST_STORM so existing
   * serialized weather values are preserved.
   */
  SNOWY_WRATH,
  /**
   * Elite Redux — Eerie Fog: a Ghost/Psychic-themed weather summoned by Fog
   * Machine (er 905), Low Visibility (er 619) and Overcast (er 983). COMPLETELY
   * distinct from vanilla {@linkcode WeatherType.FOG} — it has NO accuracy debuff
   * (see docs/er-custom-mechanics.md). Its effects: per-turn positive-stat-stage
   * decay on non-Ghost/Psychic mons, Ghost/Psychic defenders take 20% less move
   * damage, halved weather-based recovery, and all Curses become the Ghost-type
   * Curse. Appended AFTER SNOWY_WRATH so existing serialized weather values are
   * preserved.
   */
  EERIE_FOG,
}
