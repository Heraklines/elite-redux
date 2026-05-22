/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: `passive-recovery` archetype primitive.
//
// Implements taxonomy entry #14 (~12 abilities). Parameterized AbAttr that
// heals the user a fixed fraction of max HP at end-of-turn, optionally gated
// on a condition (status, weather, terrain, custom predicate).
//
// Base class: `PostTurnHealAbAttr` — pokerogue's existing fixed `1/16` heal
// AbAttr (used by `Healer`/`Rain Dish`/`Ice Body`/etc. siblings via the
// `PostTurnAbAttr` family). The parent hardcodes `pokemon.getMaxHp() / 16`;
// we override `apply` to use the configured `healFraction` instead and add
// a typed condition gate on top of the inherited "not at full HP" gate.
//
// Sub-shapes covered:
//   - Unconditional passive recovery (Healer-style fixed-fraction heal):
//     `{ healFraction: 1/16 }`.
//   - **Status-gated** (Sweet Dreams "Heals 1/8 if asleep"):
//     `{ healFraction: 1/8, condition: { kind: "status";
//       status: StatusEffect.SLEEP } }`.
//   - **Weather-gated** (Rain Dish "Heals 1/16 in rain"):
//     `{ healFraction: 1/16, condition: { kind: "weather";
//       weathers: [WeatherType.RAIN, WeatherType.HEAVY_RAIN] } }`.
//   - **Terrain-gated** (Grassy-Surge-recovery-style):
//     `{ healFraction: 1/16, condition: { kind: "terrain";
//       terrains: [TerrainType.GRASSY] } }`.
//
// Sub-shapes intentionally NOT in this primitive (deferred to bespoke / other
// archetypes):
//   - **Per-foe drain** (Life Steal "Steals 1/10 HP from foes each turn"):
//     Needs per-target enumeration of opponents; not a pure self-heal. Belongs
//     in a `passive-drain` sibling primitive (not yet listed in taxonomy as
//     its own archetype — folded into the `damage-deal-heal` family in the
//     curation; we'll wire bespoke until a second drain-ability adopts the
//     shape).
//   - **HP-curve / variable healing**: not in scope. Some ER customs scale
//     heal by HP missing; those are bespoke.
//
// Examples (per taxonomy):
//   - Generic ER "Recovers 1/16 each turn" — `new PassiveRecoveryAbAttr({
//       healFraction: 1/16 })`
//   - `Sweet Dreams`-heal-piece — `new PassiveRecoveryAbAttr({
//       healFraction: 1/8, condition: { kind: "status",
//       status: StatusEffect.SLEEP } })`
// =============================================================================

import { PostTurnHealAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { TerrainType } from "#data/terrain";
import type { StatusEffect } from "#enums/status-effect";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

/**
 * Discriminated condition gating when the heal fires at end-of-turn. New
 * variants should be appended (additive) as we expand archetype coverage.
 *
 * The `always` variant matches vanilla `Healer`-style unconditional heals;
 * the others gate on a battle-field property.
 */
export type PassiveRecoveryCondition =
  | { readonly kind: "always" }
  | { readonly kind: "status"; readonly status: StatusEffect }
  | { readonly kind: "weather"; readonly weathers: readonly WeatherType[] }
  | { readonly kind: "terrain"; readonly terrains: readonly TerrainType[] }
  | {
      /**
       * Gate the heal on the subject's current HP being at or below a fraction
       * of their max HP. Models ER abilities like Resilience ("Heal 1/4 of max
       * HP whenever below 1/2 health"). The fraction is inclusive — when
       * configured at `0.5`, the heal fires at exactly 50% HP and below.
       */
      readonly kind: "hp-below-fraction";
      /** Threshold fraction of max HP. Must be in `(0, 1)`. Typical: `0.5`. */
      readonly fraction: number;
    };

/** Construction options for {@linkcode PassiveRecoveryAbAttr}. */
export interface PassiveRecoveryOptions {
  /**
   * Fraction of the user's max HP to heal each turn. Must be in `(0, 1]`.
   * Typical values: `1/16`, `1/8`, `1/4`. Higher fractions are unusual but
   * not rejected — they're useful for ER customs.
   */
  readonly healFraction: number;
  /**
   * Optional condition gating the heal. Defaults to `{ kind: "always" }` —
   * the heal fires every turn the Pokemon isn't at full HP.
   */
  readonly condition?: PassiveRecoveryCondition;
}

/**
 * Parameterized `AbAttr` implementing the `passive-recovery` archetype.
 *
 * Used (or will be used) by ER abilities such as generic "Recovers 1/16 of
 * max HP at end of turn", `Sweet Dreams` (heal piece, gated on sleep),
 * `Rain Dish` / `Ice Body` (gated on weather), and similar end-of-turn self-
 * heals.
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostTurnHealAbAttr}. The parent's `canApply`
 * checks `!pokemon.isFullHp()`; we extend it with our condition gate. The
 * parent's `apply` hardcodes `pokemon.getMaxHp() / 16` and uses i18n string
 * `abilityTriggers:postTurnHeal`; we override `apply` to scale the heal by
 * the configured `healFraction`.
 *
 * Why duplicate the parent's `apply` body instead of calling super? The
 * parent uses a fixed `/16` divisor inline — there's no exposed seam to
 * override the fraction without rewriting the heal-phase shift. Our override
 * mirrors the parent body line-for-line and substitutes the divisor.
 */
export class PassiveRecoveryAbAttr extends PostTurnHealAbAttr {
  private readonly healFractionValue: number;
  private readonly conditionSpec: PassiveRecoveryCondition;

  constructor(opts: PassiveRecoveryOptions) {
    if (!(opts.healFraction > 0 && opts.healFraction <= 1)) {
      throw new Error(`[PassiveRecoveryAbAttr] healFraction must be in (0, 1]; got ${opts.healFraction}`);
    }
    if (opts.condition?.kind === "hp-below-fraction") {
      const f = opts.condition.fraction;
      if (!(f > 0 && f < 1)) {
        throw new Error(`[PassiveRecoveryAbAttr] hp-below-fraction must be in (0, 1); got ${f}`);
      }
    }
    super();
    this.healFractionValue = opts.healFraction;
    this.conditionSpec = opts.condition ?? { kind: "always" };
  }

  /** Read-only accessor for the configured heal fraction. */
  public getHealFraction(): number {
    return this.healFractionValue;
  }

  /**
   * Read-only accessor for the configured condition spec. Named
   * `getRecoveryCondition` rather than `getCondition` to avoid shadowing the
   * base `AbAttr.getCondition(): AbAttrCondition | null` accessor (which
   * returns a wholly different shape — a `(pokemon) => boolean` predicate,
   * not a discriminated options object). See the same pattern in
   * {@linkcode PriorityModifierAbAttr.getPriorityCondition}.
   */
  public getRecoveryCondition(): PassiveRecoveryCondition {
    return this.conditionSpec;
  }

  /**
   * canApply: inherits the parent's "not at full HP" gate, then layers the
   * configured condition gate. Both must pass for the heal to fire.
   */
  public override canApply(params: Parameters<PostTurnHealAbAttr["canApply"]>[0]): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    return PassiveRecoveryAbAttr.matchesCondition(this.conditionSpec, params.pokemon);
  }

  /**
   * Apply: heal the user by `maxHp * healFraction`, mirroring the parent's
   * heal-phase shift but with the configured fraction.
   */
  public override apply(params: Parameters<PostTurnHealAbAttr["apply"]>[0]): void {
    const { simulated, pokemon } = params;
    if (simulated) {
      return;
    }
    const abilityRef = pokemon.getAbility();
    const abilityName = abilityRef?.name ?? "";
    globalScene.phaseManager.unshiftNew(
      "PokemonHealPhase",
      pokemon.getBattlerIndex(),
      toDmgValue(pokemon.getMaxHp() * this.healFractionValue),
      i18next.t("abilityTriggers:postTurnHeal", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        abilityName,
      }),
      true,
    );
  }

  /**
   * Evaluate the configured condition against the subject Pokemon at the
   * end-of-turn tick. Exposed as a static so tests can verify each variant
   * in isolation and composite archetypes can reuse the predicate.
   *
   * @param condition The configured condition spec
   * @param pokemon   The Pokemon owning this ability (end-of-turn subject)
   */
  public static matchesCondition(condition: PassiveRecoveryCondition, pokemon: Pokemon): boolean {
    switch (condition.kind) {
      case "always":
        return true;
      case "status":
        return pokemon.status?.effect === condition.status;
      case "weather":
        return condition.weathers.includes(globalScene.arena.weatherType);
      case "terrain":
        return condition.terrains.includes(globalScene.arena.terrainType);
      case "hp-below-fraction":
        return pokemon.hp <= toDmgValue(pokemon.getMaxHp() * condition.fraction);
    }
  }
}

/** Marker type — generic alias for the wire-up layer. */
export type PassiveRecovery = PassiveRecoveryAbAttr;
