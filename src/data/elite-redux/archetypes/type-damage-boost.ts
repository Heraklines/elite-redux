/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `type-damage-boost` archetype primitive.
//
// Implements taxonomy entry #3 (~30 abilities). Parameterized AbAttr that
// multiplies a Pokemon's outgoing move power when the move's resolved type
// matches a configured `PokemonType`. Optionally swaps to a stronger
// multiplier when the user is below a configurable HP threshold (default
// `1/3`) — this covers the `Vengeance`/`Hellblaze`/`Riptide`/... cluster
// that shares the "X-type boost N×, M× under 1/3 HP" shape.
//
// Base class: `MovePowerBoostAbAttr` (extends `VariableMovePowerAbAttr`).
// We picked the *power* boost surface (not the damage boost surface in
// `MoveDamageBoostAbAttr`) because it's the canonical attack-power
// modification path — `MoveTypePowerBoostAbAttr` and
// `LowHpMoveTypePowerBoostAbAttr` use it, and pokerogue's damage calc
// reads multiplied `power.value` to compute final damage.
//
// Sub-shapes intentionally NOT covered in this primitive (deferred to
// later archetypes):
//   - Recoil rider (`"… but have N% recoil"` — separate archetype, slot in
//     via `CompositeAbAttr`).
//   - Multi-type (`Antarctic Bird` — `types: PokemonType[]`). Wire a multi-
//     instance per type, or extend later.
//
// Examples (per taxonomy):
//   - `new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.25 })`
//     → `Electrocytes`.
//   - `new TypeDamageBoostAbAttr({ type: PokemonType.FIRE, multiplier: 1.2,
//        lowHpMultiplier: 1.5 })`
//     → `Hellblaze` (1.2× normally, 1.5× under 1/3 HP).
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { PokemonType } from "#enums/pokemon-type";
import type { WeatherType } from "#enums/weather-type";

/** Construction options for {@linkcode TypeDamageBoostAbAttr}. */
export interface TypeDamageBoostAbAttrOptions {
  /** The move type that this boost gates on (matched against `pokemon.getMoveType(move)`). */
  readonly type: PokemonType;
  /**
   * The damage multiplier applied when the move's type matches {@linkcode type}
   * AND the user is at or above {@linkcode lowHpThreshold} HP. Must be > 0; > 1
   * for a boost, < 1 for a penalty.
   */
  readonly multiplier: number;
  /**
   * The damage multiplier applied when the move's type matches {@linkcode type}
   * AND the user is strictly below {@linkcode lowHpThreshold} HP. When omitted,
   * {@linkcode multiplier} is always used — i.e. there is no low-HP swap.
   */
  readonly lowHpMultiplier?: number;
  /**
   * The HP ratio (`hp / maxHp`) strictly below which {@linkcode lowHpMultiplier}
   * applies. Ignored when {@linkcode lowHpMultiplier} is undefined.
   * @defaultValue `1 / 3` — matches vanilla pokerogue Overgrow / Blaze / ER
   * `Vengeance`-cluster semantics.
   */
  readonly lowHpThreshold?: number;
  /**
   * Optional weather gate. When set, the boost only applies while one of these
   * weather types is active AND not effect-suppressed (Cloud Nine / Air Lock).
   * Covers ER abilities like `Whiteout` (Ice moves ×1.5 in hail). Omit for an
   * always-on type boost.
   */
  readonly weathers?: readonly WeatherType[];
}

/**
 * Parameterized `AbAttr` implementing the `type-damage-boost` archetype.
 *
 * Used (or will be used) by ER abilities such as `Vengeance`, `Hellblaze`,
 * `Riptide`, `Forest Rage`, `Purgatory`, `Earthbound`, `Psychic Mind`,
 * `Rockhard Will`, `Foul Energy`, `Flock`, `Short Circuit`, `Fighter`,
 * `Electrocytes`, `Combustion`, etc.
 *
 * @remarks
 * Extends {@linkcode MovePowerBoostAbAttr}, which itself extends
 * {@linkcode VariableMovePowerAbAttr}. The closure passed to the super
 * constructor evaluates `pokemon.getMoveType(move) === this.type` so that
 * type-changing abilities (Aerilate, Pixilate, Galvanize, …) on the SAME
 * Pokemon are respected — i.e. an Aerilate user's Normal-type Hyper Voice
 * counts as Flying for type-damage-boost gating.
 *
 * When {@linkcode TypeDamageBoostAbAttrOptions.lowHpMultiplier} is set, the
 * stored `powerMultiplier` on the base class is the *high-HP* value; the
 * `apply` override below recomputes the multiplier at apply-time so we can
 * read the user's current HP ratio.
 */
export class TypeDamageBoostAbAttr extends MovePowerBoostAbAttr {
  private readonly type: PokemonType;
  private readonly highHpMultiplier: number;
  private readonly lowHpMultiplier: number | null;
  private readonly lowHpThreshold: number;
  private readonly weathers: readonly WeatherType[] | null;

  constructor(opts: TypeDamageBoostAbAttrOptions) {
    if (!(opts.multiplier > 0)) {
      throw new Error(`[TypeDamageBoostAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    if (opts.lowHpMultiplier !== undefined && !(opts.lowHpMultiplier > 0)) {
      throw new Error(`[TypeDamageBoostAbAttr] lowHpMultiplier must be > 0 when set; got ${opts.lowHpMultiplier}`);
    }
    const weathers = opts.weathers && opts.weathers.length > 0 ? opts.weathers : null;
    // Pass the *baseline* multiplier to the super; we override apply() below
    // to swap in lowHpMultiplier when appropriate. Super's `canApply` calls
    // the condition closure which checks type-match (and the optional weather
    // gate) so the super's existing gating works as-is.
    super(
      (pokemon, _defender, move) => {
        if (pokemon?.getMoveType(move) !== opts.type) {
          return false;
        }
        if (weathers) {
          if (globalScene.arena.weather?.isEffectSuppressed()) {
            return false;
          }
          return weathers.includes(globalScene.arena.weatherType);
        }
        return true;
      },
      opts.multiplier,
      false,
    );
    this.type = opts.type;
    this.highHpMultiplier = opts.multiplier;
    this.lowHpMultiplier = opts.lowHpMultiplier ?? null;
    this.lowHpThreshold = opts.lowHpThreshold ?? 1 / 3;
    this.weathers = weathers;
  }

  /** The configured weather gate, or `null` for an always-on type boost. */
  public getWeathers(): readonly WeatherType[] | null {
    return this.weathers;
  }

  /** The configured boost type (read-only accessor for tests / introspection). */
  public getBoostType(): PokemonType {
    return this.type;
  }

  /** The configured high-HP multiplier (≥ {@linkcode lowHpThreshold}). */
  public getHighHpMultiplier(): number {
    return this.highHpMultiplier;
  }

  /** The configured low-HP multiplier, or `null` if the archetype has no low-HP swap. */
  public getLowHpMultiplier(): number | null {
    return this.lowHpMultiplier;
  }

  /** The configured low-HP threshold (defaults to `1/3`). */
  public getLowHpThreshold(): number {
    return this.lowHpThreshold;
  }

  /**
   * Multiply `power.value` by the appropriate multiplier given the user's
   * current HP ratio. The super's `canApply` already verified the move's
   * type matches.
   *
   * @remarks
   * We deliberately do NOT call `super.apply` because the super uses its
   * fixed-at-construction `powerMultiplier`; we want the swap-aware value.
   * The `params.simulated` flag has no effect here — the multiplier is
   * applied identically in simulated and real dispatches because the
   * outcome is only the value of `power.value` (no side effects).
   */
  public override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const mult = this.resolveMultiplier(params.pokemon.getHpRatio(true));
    params.power.value *= mult;
  }

  /**
   * Compute the multiplier that {@linkcode apply} would use for a Pokemon with
   * the given HP ratio. Exposed for tests and downstream archetype clients
   * (e.g. `CompositeAbAttr` introspection).
   *
   * @param hpRatio - The user's `hp / maxHp` at the moment of dispatch.
   * @returns {@linkcode lowHpMultiplier} when configured and `hpRatio < lowHpThreshold`,
   *   otherwise {@linkcode highHpMultiplier}.
   */
  public resolveMultiplier(hpRatio: number): number {
    if (this.lowHpMultiplier !== null && hpRatio < this.lowHpThreshold) {
      return this.lowHpMultiplier;
    }
    return this.highHpMultiplier;
  }
}
