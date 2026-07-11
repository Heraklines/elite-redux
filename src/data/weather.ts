import type { SuppressWeatherEffectAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import i18next from "i18next";

/**
 * Elite Redux — the set of "weather-based" moves that {@linkcode WeatherType.STRONG_WINDS}
 * (Delta Stream, er 191) makes unusable, per the 2.65 dex ("Weather-based moves not usable").
 * Mirrors how Desolate Land / Primordial Sea make Water / Fire moves fizzle. Covers Weather
 * Ball (type + power derive from weather), the weather-setting moves, and the Solar charge
 * moves (their behaviour depends on weather).
 */
const ER_WEATHER_BASED_MOVES: ReadonlySet<MoveId> = new Set<MoveId>([
  MoveId.WEATHER_BALL,
  MoveId.RAIN_DANCE,
  MoveId.SUNNY_DAY,
  MoveId.SANDSTORM,
  MoveId.HAIL,
  MoveId.SNOWSCAPE,
  MoveId.CHILLY_RECEPTION,
  MoveId.SOLAR_BEAM,
  MoveId.SOLAR_BLADE,
]);

/** Whether the given move is a "weather-based" move blocked by Delta Stream's Strong Winds. */
export function isErWeatherBasedMove(move: Move): boolean {
  return ER_WEATHER_BASED_MOVES.has(move.id);
}

/**
 * Elite Redux — treat vanilla {@linkcode WeatherType.FOG} and ER's distinct
 * {@linkcode WeatherType.EERIE_FOG} as "fog" for every fog-gated synergy (Eerie
 * Spell/Vexing Void always-hit, Ominous Wind / Echolocation / Foggy Eye boosts,
 * Shallow Grave's deferred revive, Madness Enhancement's fog-enrage, the Curse
 * Ghost-variant, the per-turn buff decay, the Ghost/Psychic damage reduction,
 * etc.). Fog Machine now summons EERIE_FOG, so these checks must fire under BOTH
 * — while the graveyard biome's vanilla FOG keeps its existing behavior.
 */
export function isFogWeather(weatherType: WeatherType | undefined): boolean {
  return weatherType === WeatherType.FOG || weatherType === WeatherType.EERIE_FOG;
}

export interface SerializedWeather {
  weatherType: WeatherType;
  turnsLeft: number;
}

export class Weather {
  // TODO: Exclude `WeatherType.NONE` from this (which indicates a lack of weather)
  public weatherType: WeatherType;
  public turnsLeft: number;
  public maxDuration: number;

  constructor(weatherType: WeatherType, turnsLeft = 0, maxDuration: number = turnsLeft) {
    this.weatherType = weatherType;
    this.turnsLeft = this.isImmutable() ? 0 : turnsLeft;
    this.maxDuration = this.isImmutable() ? 0 : maxDuration;
  }

  /**
   * Tick down this weather's duration.
   * @returns Whether the current weather should remain active (`turnsLeft > 0`)
   */
  lapse(): boolean {
    if (this.isImmutable()) {
      return true;
    }
    // TODO: Add a flag for infinite duration weathers separate from "0 turn count"
    if (this.turnsLeft) {
      return !!--this.turnsLeft;
    }

    return true;
  }

  isImmutable(): boolean {
    switch (this.weatherType) {
      case WeatherType.HEAVY_RAIN:
      case WeatherType.HARSH_SUN:
      case WeatherType.STRONG_WINDS:
        return true;
    }

    return false;
  }

  isDamaging(): boolean {
    switch (this.weatherType) {
      case WeatherType.SANDSTORM:
      case WeatherType.HAIL:
      case WeatherType.TEMPEST_STORM:
      // ER Snowy Wrath: a damaging snow — chips non-Ice types 1/16 HP each turn like hail.
      case WeatherType.SNOWY_WRATH:
        return true;
    }

    return false;
  }

  isTypeDamageImmune(type: PokemonType): boolean {
    switch (this.weatherType) {
      case WeatherType.SANDSTORM:
        return type === PokemonType.GROUND || type === PokemonType.ROCK || type === PokemonType.STEEL;
      case WeatherType.HAIL:
      // ER Snowy Wrath chips like hail — Ice-types are immune to the chip.
      case WeatherType.SNOWY_WRATH:
        return type === PokemonType.ICE;
      case WeatherType.TEMPEST_STORM:
        // Electric-types are at home in a thundershock storm.
        return type === PokemonType.ELECTRIC;
    }

    return false;
  }

  getAttackTypeMultiplier(attackType: PokemonType): number {
    switch (this.weatherType) {
      case WeatherType.SUNNY:
      case WeatherType.HARSH_SUN:
        if (attackType === PokemonType.FIRE) {
          return 1.5;
        }
        if (attackType === PokemonType.WATER) {
          return 0.5;
        }
        break;
      case WeatherType.RAIN:
      case WeatherType.HEAVY_RAIN:
        if (attackType === PokemonType.FIRE) {
          return 0.5;
        }
        if (attackType === PokemonType.WATER) {
          return 1.5;
        }
        break;
    }

    return 1;
  }

  isMoveWeatherCancelled(user: Pokemon, move: Move): boolean {
    const moveType = user.getMoveType(move);

    switch (this.weatherType) {
      case WeatherType.HARSH_SUN:
        return move.is("AttackMove") && moveType === PokemonType.WATER;
      case WeatherType.HEAVY_RAIN:
        return move.is("AttackMove") && moveType === PokemonType.FIRE;
      case WeatherType.STRONG_WINDS:
        // ER Delta Stream (er 191): "Weather-based moves not usable." The strong
        // winds disrupt any weather-manipulating move (Weather Ball, the weather
        // setters, Solar moves), mirroring how Desolate Land / Primordial Sea make
        // Water / Fire moves fizzle. STRONG_WINDS is only ever set by Delta Stream,
        // so this cleanly gates the effect to that ability.
        return isErWeatherBasedMove(move);
    }

    return false;
  }

  isEffectSuppressed(): boolean {
    const field = globalScene.getField(true);

    for (const pokemon of field) {
      let suppressWeatherEffectAbAttr: SuppressWeatherEffectAbAttr | null = pokemon
        .getAbility()
        .getAttrs("SuppressWeatherEffectAbAttr")[0];
      if (!suppressWeatherEffectAbAttr) {
        suppressWeatherEffectAbAttr = pokemon.hasPassive()
          ? pokemon.getPassiveAbility().getAttrs("SuppressWeatherEffectAbAttr")[0]
          : null;
      }
      if (suppressWeatherEffectAbAttr && (!this.isImmutable() || suppressWeatherEffectAbAttr.affectsImmutable)) {
        return true;
      }
    }

    return false;
  }
}

// TODO: These functions should not be able to accept `WeatherType.NONE`
// and should have `null` removed from the signature
export function getWeatherStartMessage(weatherType: WeatherType): string | null {
  switch (weatherType) {
    case WeatherType.SUNNY:
      return i18next.t("weather:sunnyStartMessage");
    case WeatherType.RAIN:
      return i18next.t("weather:rainStartMessage");
    case WeatherType.SANDSTORM:
      return i18next.t("weather:sandstormStartMessage");
    case WeatherType.HAIL:
      return i18next.t("weather:hailStartMessage");
    case WeatherType.SNOW:
      return i18next.t("weather:snowStartMessage");
    case WeatherType.FOG:
      return i18next.t("weather:fogStartMessage");
    case WeatherType.HEAVY_RAIN:
      return i18next.t("weather:heavyRainStartMessage");
    case WeatherType.HARSH_SUN:
      return i18next.t("weather:harshSunStartMessage");
    case WeatherType.STRONG_WINDS:
      return i18next.t("weather:strongWindsStartMessage");
    case WeatherType.TEMPEST_STORM:
      // ER custom weather — hardcoded English (the shared locales submodule has
      // no key for it; ER's custom content is English-only).
      return "A thundershock storm brewed!";
    case WeatherType.SNOWY_WRATH:
      return "A wrathful blizzard kicked up!";
    case WeatherType.EERIE_FOG:
      // ER custom weather — English-only (the shared locales submodule has no key).
      return "An eerie fog crept in!";
  }

  return null;
}

export function getWeatherLapseMessage(weatherType: WeatherType): string | null {
  switch (weatherType) {
    case WeatherType.SUNNY:
      return i18next.t("weather:sunnyLapseMessage");
    case WeatherType.RAIN:
      return i18next.t("weather:rainLapseMessage");
    case WeatherType.SANDSTORM:
      return i18next.t("weather:sandstormLapseMessage");
    case WeatherType.HAIL:
      return i18next.t("weather:hailLapseMessage");
    case WeatherType.SNOW:
      return i18next.t("weather:snowLapseMessage");
    case WeatherType.FOG:
      return i18next.t("weather:fogLapseMessage");
    case WeatherType.HEAVY_RAIN:
      return i18next.t("weather:heavyRainLapseMessage");
    case WeatherType.HARSH_SUN:
      return i18next.t("weather:harshSunLapseMessage");
    case WeatherType.STRONG_WINDS:
      return i18next.t("weather:strongWindsLapseMessage");
    case WeatherType.TEMPEST_STORM:
      return "The thundershock storm rages.";
    case WeatherType.SNOWY_WRATH:
      return "The wrathful blizzard rages.";
    case WeatherType.EERIE_FOG:
      return "The eerie fog is deep.";
  }

  return null;
}

export function getWeatherDamageMessage(weatherType: WeatherType, pokemon: Pokemon): string | null {
  switch (weatherType) {
    case WeatherType.SANDSTORM:
      return i18next.t("weather:sandstormDamageMessage", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
      });
    case WeatherType.HAIL:
      return i18next.t("weather:hailDamageMessage", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
      });
    case WeatherType.TEMPEST_STORM:
      return `${getPokemonNameWithAffix(pokemon)} is struck\nby the thundershock storm!`;
    case WeatherType.SNOWY_WRATH:
      return `${getPokemonNameWithAffix(pokemon)} is buffeted\nby the wrathful blizzard!`;
  }

  return null;
}

export function getWeatherClearMessage(weatherType: WeatherType): string | null {
  switch (weatherType) {
    case WeatherType.SUNNY:
      return i18next.t("weather:sunnyClearMessage");
    case WeatherType.RAIN:
      return i18next.t("weather:rainClearMessage");
    case WeatherType.SANDSTORM:
      return i18next.t("weather:sandstormClearMessage");
    case WeatherType.HAIL:
      return i18next.t("weather:hailClearMessage");
    case WeatherType.SNOW:
      return i18next.t("weather:snowClearMessage");
    case WeatherType.FOG:
      return i18next.t("weather:fogClearMessage");
    case WeatherType.HEAVY_RAIN:
      return i18next.t("weather:heavyRainClearMessage");
    case WeatherType.HARSH_SUN:
      return i18next.t("weather:harshSunClearMessage");
    case WeatherType.STRONG_WINDS:
      return i18next.t("weather:strongWindsClearMessage");
    case WeatherType.TEMPEST_STORM:
      return i18next.t("weather:tempestStormClearMessage");
    case WeatherType.SNOWY_WRATH:
      return "The wrathful blizzard subsided.";
    case WeatherType.EERIE_FOG:
      return "The eerie fog lifted.";
  }

  return null;
}

export function getLegendaryWeatherContinuesMessage(weatherType: WeatherType): string | null {
  switch (weatherType) {
    case WeatherType.HARSH_SUN:
      return i18next.t("weather:harshSunContinueMessage");
    case WeatherType.HEAVY_RAIN:
      return i18next.t("weather:heavyRainContinueMessage");
    case WeatherType.STRONG_WINDS:
      return i18next.t("weather:strongWindsContinueMessage");
  }
  return null;
}

export function getWeatherBlockMessage(weatherType: WeatherType): string {
  switch (weatherType) {
    case WeatherType.HARSH_SUN:
      return i18next.t("weather:harshSunEffectMessage");
    case WeatherType.HEAVY_RAIN:
      return i18next.t("weather:heavyRainEffectMessage");
    case WeatherType.STRONG_WINDS:
      // ER Delta Stream — a weather-based move fizzled in the strong winds.
      return "The mysterious strong winds\ndissipated the attack!";
  }
  return i18next.t("weather:defaultEffectMessage");
}
