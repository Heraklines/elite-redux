import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { erWeathervaneBlocksWeatherDamage } from "#data/elite-redux/er-relics";
import { erTacticalBlocksWeatherDamage } from "#data/elite-redux/er-tactical-items";
import type { Weather } from "#data/weather";
import { getWeatherDamageMessage, getWeatherLapseMessage, isFogWeather } from "#data/weather";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { CommonAnim } from "#enums/move-anims-common";
import { PokemonType } from "#enums/pokemon-type";
import type { BattleStat } from "#enums/stat";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { CommonAnimPhase } from "#phases/common-anim-phase";
import { BooleanHolder, toDmgValue } from "#utils/common";

/**
 * Map a weather type to the {@linkcode CommonAnim} used for its per-turn effect
 * visual. FOG has its own anim; ER's Snowy Wrath reuses the hail visual. Every
 * other (contiguous) weather uses the `SUNNY + (w-1)` index math.
 */
function weatherEffectAnim(w: WeatherType): CommonAnim {
  if (isFogWeather(w)) {
    return CommonAnim.FOG;
  }
  if (w === WeatherType.SNOWY_WRATH) {
    return CommonAnim.HAIL;
  }
  return CommonAnim.SUNNY + (w - 1);
}

/** Stat stages Eerie Fog decays toward +0 each turn. */
const ER_FOG_DECAY_STATS: readonly BattleStat[] = [
  Stat.ATK,
  Stat.DEF,
  Stat.SPATK,
  Stat.SPDEF,
  Stat.SPD,
  Stat.ACC,
  Stat.EVA,
];

export class WeatherEffectPhase extends CommonAnimPhase {
  public readonly phaseName = "WeatherEffectPhase";
  public weather: Weather | null;

  constructor() {
    const w = globalScene?.arena?.weather?.weatherType || WeatherType.NONE;
    // ER: special-case FOG (CommonAnim.FOG) and Snowy Wrath (reuse the hail visual)
    // so the default `SUNNY + (w-1)` index math doesn't run off the enum.
    const anim = weatherEffectAnim(w);
    super(undefined, undefined, anim);
    this.weather = globalScene?.arena?.weather;
  }

  start() {
    // Update weather state with any changes that occurred during the turn
    this.weather = globalScene?.arena?.weather;

    if (!this.weather) {
      return this.end();
    }

    const w = this.weather.weatherType;
    const anim = weatherEffectAnim(w);
    this.setAnimation(anim);

    // ER Eerie Fog: each turn, every active Pokémon that is NOT Ghost- or
    // Psychic-type loses one stage off each POSITIVE stat boost (decays to +0).
    // Debuffs (negative stages) are left alone. Fires under vanilla FOG and ER's
    // distinct EERIE_FOG (Fog Machine now summons the latter).
    if (isFogWeather(w)) {
      this.executeForAll((pokemon: Pokemon) => {
        if (!pokemon || pokemon.switchOutStatus || pokemon.isFainted()) {
          return;
        }
        if (pokemon.isOfType(PokemonType.GHOST) || pokemon.isOfType(PokemonType.PSYCHIC)) {
          return;
        }
        for (const stat of ER_FOG_DECAY_STATS) {
          const cur = pokemon.getStatStage(stat);
          if (cur > 0) {
            pokemon.setStatStage(stat, cur - 1);
          }
        }
      });
    }

    if (this.weather.isDamaging()) {
      const cancelled = new BooleanHolder(false);

      this.executeForAll((pokemon: Pokemon) =>
        applyAbAttrs("SuppressWeatherEffectAbAttr", { pokemon, weather: this.weather, cancelled }),
      );

      if (!cancelled.value) {
        const inflictDamage = (pokemon: Pokemon) => {
          const cancelled = new BooleanHolder(false);

          applyAbAttrs("PreWeatherDamageAbAttr", { pokemon, weather: this.weather, cancelled });
          applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon, cancelled });

          if (
            cancelled.value
            || pokemon.getTag(BattlerTagType.UNDERGROUND)
            || pokemon.getTag(BattlerTagType.UNDERWATER)
          ) {
            return;
          }

          const damage = toDmgValue(pokemon.getMaxHp() / 16);

          globalScene.phaseManager.queueMessage(getWeatherDamageMessage(this.weather!.weatherType, pokemon) ?? "");
          pokemon.damageAndUpdate(damage, { result: HitResult.INDIRECT, ignoreSegments: true });
        };

        this.executeForAll((pokemon: Pokemon) => {
          const immune =
            !pokemon
            || pokemon.getTypes(true, true).filter(t => this.weather?.isTypeDamageImmune(t)).length > 0
            || pokemon.switchOutStatus // ER relic (#439): Weathervane - player mons ignore residual // sandstorm/hail chip damage while the relic is held.
            || (pokemon.isPlayer() && erWeathervaneBlocksWeatherDamage())
            || erTacticalBlocksWeatherDamage(pokemon); // ER Safety Goggles
          if (!immune) {
            inflictDamage(pokemon);
          }
        });
      }
    }

    globalScene.ui.showText(getWeatherLapseMessage(this.weather.weatherType) ?? "", null, () => {
      this.executeForAll((pokemon: Pokemon) => {
        if (!pokemon.switchOutStatus) {
          applyAbAttrs("PostWeatherLapseAbAttr", { pokemon, weather: this.weather });
        }
      });

      super.start();
    });
  }
}
