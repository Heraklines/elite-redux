/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `weather-terrain-interaction` archetype.
//
// Implements taxonomy entry #23 (~30 abilities — including the "set weather/
// terrain on entry" cluster, the "boosts X-type in WEATHER" cluster, and the
// damage-modifier-during-WEATHER cluster). Because the sub-shapes use
// different pokerogue trigger surfaces, we split the archetype into FOUR
// sibling subclasses — one per surface:
//
//   - `SetWeatherOnEntryAbAttr`           extends `PostSummonWeatherChangeAbAttr`
//     (already in pokerogue with the exact behavior we want; we only need a
//     typed-options constructor wrapper for parity with the rest of the
//     archetype layer).
//
//   - `SetTerrainOnEntryAbAttr`           extends `PostSummonTerrainChangeAbAttr`
//     (same story — pokerogue's class is fine; we just wrap it for typed
//     construction).
//
//   - `WeatherTypeBoostAbAttr`            extends `MovePowerBoostAbAttr`
//     (matches the structure of {@linkcode TypeDamageBoostAbAttr} but the
//     gating predicate is "active weather is in the configured set AND the
//     outgoing move type is in the configured set"). Covers "Boosts Water
//     moves in rain"-style abilities (`Catastrophe`'s rain-Fire piece, etc.).
//
//   - `WeatherDamageReductionAbAttr`      extends `ReceivedMoveDamageMultiplierAbAttr`
//     (mirrors pokerogue's `AlliedFieldDamageReductionAbAttr` family). Covers
//     "takes 50% less damage if hail is active"-style abilities (`Christmas
//     Spirit`, `Sand Guard`'s special-damage piece, etc.).
//
// Why four classes? The trigger surfaces are genuinely different:
//   - On-entry weather/terrain setters fire from `PostSummonAbAttr`.
//   - Type-boost-in-weather fires from the power-boost calc.
//   - Damage-reduction-in-weather fires from the incoming damage calc.
// A single mega-class would have to subclass every surface at once, which the
// existing ability infrastructure doesn't support. Splitting matches what
// pokerogue does (`PostSummonWeatherChangeAbAttr` and `MovePowerBoostAbAttr`
// are already separate trees), and the wire-up layer composes them naturally
// when an ER ability needs more than one ("Catastrophe" = type-boost +
// type-boost, one per weather).
//
// Sub-shapes intentionally NOT covered in this primitive (deferred to later
// archetypes / composites):
//   - **Stat boost in weather** (e.g. `Whiteout`'s "highest attacking stat
//     +1.5x in WEATHER") — overlaps with `stat-trigger-on-event` archetype
//     (the weather-active sub-shape called out as deferred in C1b). Will land
//     when that archetype's first-turn / weather-active variant is wired.
//   - **Status-immunity in weather** (e.g. `Desert Cloak`'s "protects from
//     status in sand") — overlaps with the `status-immunity` archetype in
//     this same C1c batch. Configuring a conditional immunity would require
//     a `StatusImmunityAbAttr` variant with a weather-active gate; that's a
//     trivial composition once both archetypes exist but is not implemented
//     in C1c since the canonical taxonomy entries cover the four above.
//   - **Block priority in WEATHER** (`Sand Guard`) — needs a priority-mod
//     interaction; goes through `priority-modifier` archetype when an HP /
//     weather predicate is added.
//
// Examples (per taxonomy):
//   - `Drizzle` (vanilla but ER customs follow the same shape) —
//     `new SetWeatherOnEntryAbAttr({ weather: WeatherType.RAIN })`
//   - `Electric Surge` —
//     `new SetTerrainOnEntryAbAttr({ terrain: TerrainType.ELECTRIC })`
//   - `Catastrophe` (Sun boosts Water) —
//     `new WeatherTypeBoostAbAttr({
//        weathers: [WeatherType.SUNNY], type: PokemonType.WATER, multiplier: 1.5 })`
//   - `Christmas Spirit` —
//     `new WeatherDamageReductionAbAttr({
//        weathers: [WeatherType.HAIL, WeatherType.SNOW], multiplier: 0.5 })`
// =============================================================================

import {
  MovePowerBoostAbAttr,
  PostSummonTerrainChangeAbAttr,
  PostSummonWeatherChangeAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { TerrainType } from "#data/terrain";
import type { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { PreAttackModifyPowerAbAttrParams } from "#types/ability-types";

/** Construction options for {@linkcode SetWeatherOnEntryAbAttr}. */
export interface SetWeatherOnEntryOptions {
  /** The weather to set when this Pokemon switches in. */
  readonly weather: WeatherType;
}

/**
 * Parameterized `AbAttr` implementing the "set weather on entry" sub-shape of
 * the `weather-terrain-interaction` archetype.
 *
 * Used (or will be used) by vanilla `Drizzle`, `Drought`, `Sand Stream`,
 * `Snow Warning`, `Primordial Sea`, `Desolate Land`, `Delta Stream`, and ER
 * custom weather-setters (Fog-setters, etc.).
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostSummonWeatherChangeAbAttr}. The parent
 * already covers the immutability gate (heavy rain / harsh sun / strong winds
 * can't be overwritten unless the new weather is itself immutable) and the
 * simulated-skip convention. This subclass exists purely to give the data
 * layer a typed-options constructor matching the rest of the archetype layer.
 */
export class SetWeatherOnEntryAbAttr extends PostSummonWeatherChangeAbAttr {
  constructor(opts: SetWeatherOnEntryOptions) {
    if (opts.weather === WeatherType.NONE) {
      throw new Error("[SetWeatherOnEntryAbAttr] weather must not be NONE");
    }
    super(opts.weather);
  }
}

/** Construction options for {@linkcode SetTerrainOnEntryAbAttr}. */
export interface SetTerrainOnEntryOptions {
  /** The terrain to set when this Pokemon switches in. */
  readonly terrain: TerrainType;
}

/**
 * Parameterized `AbAttr` implementing the "set terrain on entry" sub-shape of
 * the `weather-terrain-interaction` archetype.
 *
 * Used (or will be used) by vanilla `Electric Surge`, `Grassy Surge`,
 * `Misty Surge`, `Psychic Surge`, and ER terrain-setter customs.
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostSummonTerrainChangeAbAttr}. Like the
 * weather equivalent, the parent already implements the apply/canApply
 * surface correctly — this subclass adds typed options for parity.
 */
export class SetTerrainOnEntryAbAttr extends PostSummonTerrainChangeAbAttr {
  private readonly terrain: TerrainType;

  constructor(opts: SetTerrainOnEntryOptions) {
    super(opts.terrain);
    this.terrain = opts.terrain;
  }

  /** The configured terrain (read-only accessor for tests / introspection). */
  public getTerrain(): TerrainType {
    return this.terrain;
  }
}

/** Construction options for {@linkcode WeatherTypeBoostAbAttr}. */
export interface WeatherTypeBoostOptions {
  /**
   * The weather conditions under which the boost fires. Active weather must
   * be in this set. Use a single-element array for "in rain", multi-element
   * for "in rain OR sun" composite forecasts.
   */
  readonly weathers: readonly WeatherType[];
  /** The outgoing move type that this boost gates on. */
  readonly type: PokemonType;
  /** The damage multiplier applied when both gates pass. Must be > 0. */
  readonly multiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the "boost X-type moves in WEATHER"
 * sub-shape of the `weather-terrain-interaction` archetype.
 *
 * Used (or will be used) by ER abilities such as `Catastrophe` (composes a
 * sun-Water boost with a rain-Fire boost), the implicit Swift Swim/Chlorophyll
 * power-side equivalents in ER, and similar weather-keyed type boosters.
 *
 * @remarks
 * Extends {@linkcode MovePowerBoostAbAttr}, like {@linkcode TypeDamageBoostAbAttr}
 * and {@linkcode FlagDamageBoostAbAttr}. The gating closure checks both the
 * active weather (via `globalScene.arena.weatherType`, honoring weather
 * suppression by checking `weather?.isEffectSuppressed()`) AND the resolved
 * move type. Both gates must pass for the boost to fire.
 *
 * The weather list uses OR semantics — passing multiple weathers means "if
 * ANY of these is active." This matches the `Catastrophe`-style "in rain OR
 * sun" pattern when composed appropriately, though Catastrophe itself wires
 * two separate instances (one per weather → type pairing).
 */
export class WeatherTypeBoostAbAttr extends MovePowerBoostAbAttr {
  private readonly weathers: readonly WeatherType[];
  private readonly boostType: PokemonType;
  private readonly boostMultiplier: number;

  constructor(opts: WeatherTypeBoostOptions) {
    if (!(opts.multiplier > 0)) {
      throw new Error(`[WeatherTypeBoostAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    if (opts.weathers.length === 0) {
      throw new Error("[WeatherTypeBoostAbAttr] weathers must include at least one WeatherType");
    }
    // We deliberately read globalScene inside the closure — pokerogue's
    // weather state is module-global and updated as the battle progresses.
    super(
      (pokemon: Pokemon, _defender: Pokemon | null, move: Move) => {
        if (pokemon === undefined || pokemon === null) {
          return false;
        }
        if (pokemon.getMoveType(move) !== opts.type) {
          return false;
        }
        if (globalScene.arena.weather?.isEffectSuppressed()) {
          return false;
        }
        return opts.weathers.includes(globalScene.arena.weatherType);
      },
      opts.multiplier,
      false,
    );
    this.weathers = opts.weathers;
    this.boostType = opts.type;
    this.boostMultiplier = opts.multiplier;
  }

  /** The configured weather set (read-only accessor). */
  public getWeathers(): readonly WeatherType[] {
    return this.weathers;
  }

  /** The configured boost type. */
  public getBoostType(): PokemonType {
    return this.boostType;
  }

  /** The configured multiplier. */
  public getMultiplier(): number {
    return this.boostMultiplier;
  }
}

/** Construction options for {@linkcode WeatherDamageReductionAbAttr}. */
export interface WeatherDamageReductionOptions {
  /**
   * Active weather must be in this set for the reduction to fire. Use a
   * multi-element array for hail-OR-snow-style "winter" reductions.
   */
  readonly weathers: readonly WeatherType[];
  /**
   * The damage multiplier applied to incoming damage when the gate passes.
   * Must be in `(0, 1]` — values > 1 belong on the boost side, values <= 0
   * would zero-out damage entirely (use a different archetype for that).
   */
  readonly multiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the "takes less damage during WEATHER"
 * sub-shape of the `weather-terrain-interaction` archetype.
 *
 * Used (or will be used) by ER abilities such as `Christmas Spirit` (50% less
 * damage in hail), `Sand Guard`'s special-damage-in-sand piece, and similar
 * weather-gated damage reducers.
 *
 * @remarks
 * Extends {@linkcode ReceivedMoveDamageMultiplierAbAttr}, which carries a
 * predicate + multiplier. We pass a closure that checks active weather; the
 * parent applies the multiplier when the predicate fires.
 *
 * The reduction is independent of the move's type or category — it applies
 * to ALL incoming damage during the configured weather. ER abilities that
 * narrow to phys/spec or to a specific type compose with the existing
 * pokerogue damage-reduction families (which we'll re-archetype later in
 * the `damage-reduction-generic` task).
 */
export class WeatherDamageReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  private readonly weathers: readonly WeatherType[];
  private readonly reductionMultiplier: number;

  constructor(opts: WeatherDamageReductionOptions) {
    if (!(opts.multiplier > 0 && opts.multiplier <= 1)) {
      throw new Error(`[WeatherDamageReductionAbAttr] multiplier must be in (0, 1]; got ${opts.multiplier}`);
    }
    if (opts.weathers.length === 0) {
      throw new Error("[WeatherDamageReductionAbAttr] weathers must include at least one WeatherType");
    }
    super((_target: Pokemon, _user: Pokemon, _move: Move) => {
      if (globalScene.arena.weather?.isEffectSuppressed()) {
        return false;
      }
      return opts.weathers.includes(globalScene.arena.weatherType);
    }, opts.multiplier);
    this.weathers = opts.weathers;
    this.reductionMultiplier = opts.multiplier;
  }

  /** The configured weather set. */
  public getWeathers(): readonly WeatherType[] {
    return this.weathers;
  }

  /** The configured damage multiplier (in `(0, 1]`). */
  public getMultiplier(): number {
    return this.reductionMultiplier;
  }
}

/**
 * Marker type — useful for callers / wire-up layer to refer to any of the
 * four archetype subclasses generically. Kept for parity with the other
 * archetypes' discriminated-union exports.
 */
export type WeatherTerrainInteraction =
  | SetWeatherOnEntryAbAttr
  | SetTerrainOnEntryAbAttr
  | WeatherTypeBoostAbAttr
  | WeatherDamageReductionAbAttr;

// Re-export PreAttackModifyPowerAbAttrParams so test files can type their
// `apply()` params without reaching into pokerogue internals.
export type { PreAttackModifyPowerAbAttrParams };
