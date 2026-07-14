/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `flare-boost-fog-self-burn` archetype.
//
// Flare Boost (vanilla ability 138) in ER 2.65: "Raises the Pokemon's Special
// Attack stat by 50% when burned. Negates burn damage. Immediately applies burn
// to self in fog." The +50% SpAtk (vanilla) and burn-damage negation
// (BlockStatusDamageAbAttr, wired in the rebalance map) already exist; this
// supplies the missing "self-ignite in fog" clause.
//
// Mirrors the `toxic-terrain-self-poison` archetype (Toxic Boost's Toxic-Terrain
// self-poison). Two cooperating attrs so the self-burn lands on BOTH occasions
// the dex requires — the holder switching into already-active Eerie Fog, and the
// weather BECOMING fog while the holder is on the field:
//   1. FlareBoostSelfBurnOnSummonAbAttr        — switch-in (PostSummon).
//   2. FlareBoostSelfBurnOnWeatherChangeAbAttr — weather change (PostWeatherChange).
//
// `isFogWeather()` covers BOTH ER Eerie Fog (WeatherType.EERIE_FOG) and vanilla
// FOG. Ordinary burn immunity (Fire-types can't be burned) still applies through
// the normal `trySetStatus` immunity checks, so a Fire-type Flare Boost holder is
// left unburned — faithful to the status system.
// =============================================================================

import { PostSummonAbAttr, PostWeatherChangeAbAttr, type PostWeatherChangeAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { isFogWeather } from "#data/weather";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

/**
 * Burn the holder if (and only if) a fog weather is currently active. No-op when
 * simulated, when the holder has fainted, or when it already carries a status.
 * The burn is self-sourced so Ward Stones / external-status blocks don't gate it;
 * ordinary type immunity (Fire can't be burned) still applies via `trySetStatus`.
 */
const selfBurnInFog = (pokemon: Pokemon, simulated: boolean | undefined): void => {
  if (simulated) {
    return;
  }
  if (!isFogWeather(globalScene.arena.weatherType)) {
    return;
  }
  if (pokemon.isFainted() || (pokemon.status?.effect ?? StatusEffect.NONE) !== StatusEffect.NONE) {
    return;
  }
  pokemon.trySetStatus(StatusEffect.BURN, pokemon);
};

/** Self-burn on switch-in when a fog weather is already active. */
export class FlareBoostSelfBurnOnSummonAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    selfBurnInFog(pokemon, simulated);
  }
}

/** Self-burn the instant the weather becomes fog while the holder is on field. */
export class FlareBoostSelfBurnOnWeatherChangeAbAttr extends PostWeatherChangeAbAttr {
  override canApply({ weather }: PostWeatherChangeAbAttrParams): boolean {
    return isFogWeather(weather);
  }

  override apply({ pokemon, simulated }: PostWeatherChangeAbAttrParams): void {
    selfBurnInFog(pokemon, simulated);
  }
}
