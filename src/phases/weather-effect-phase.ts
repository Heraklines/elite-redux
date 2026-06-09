import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import type { Weather } from "#data/weather";
import { getWeatherDamageMessage, getWeatherLapseMessage } from "#data/weather";
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
    // ER: special-case FOG so it picks CommonAnim.FOG instead of CommonAnim.WIND.
    const anim = w === WeatherType.FOG ? CommonAnim.FOG : CommonAnim.SUNNY + (w - 1);
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
    const anim = w === WeatherType.FOG ? CommonAnim.FOG : CommonAnim.SUNNY + (w - 1);
    this.setAnimation(anim);

    // ER Eerie Fog: each turn, every active Pokémon that is NOT Ghost- or
    // Psychic-type loses one stage off each POSITIVE stat boost (decays to +0).
    // Debuffs (negative stages) are left alone.
    if (w === WeatherType.FOG) {
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
            || pokemon.switchOutStatus;
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
