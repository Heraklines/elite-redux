/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: `damage-reduction-generic` archetype primitive.
//
// Implements taxonomy entry #8 (~30 abilities) — a parameterized AbAttr that
// reduces incoming damage by a configurable multiplier when the incoming move
// matches a filter. Covers ER's wide "less damage from X" payload family
// (excluding type-keyed resists, which are archetype #11 and live in
// `immunity-with-absorb.ts`).
//
// Base class: `ReceivedMoveDamageMultiplierAbAttr` — pokerogue's existing
// generic damage-multiplier-with-condition class (used by Fluffy, Solid Rock,
// Filter, Multiscale, Ice Scales, etc.). The parent constructor takes a
// `(target, attacker, move) => boolean` predicate plus a `damageMultiplier`;
// we build the predicate from the typed-options discriminated `filter` union.
//
// Filter sub-shapes:
//   - **All damaging moves** (Aura Armor-style "Takes 10% less from attacks"):
//     `{ kind: "all" }`.
//   - **By category** (Fire Scales / Ice Plumes "Halves Special damage"):
//     `{ kind: "category"; category: MoveCategory.PHYSICAL | SPECIAL }`.
//   - **Contact** (1/2 dmg from contact moves): `{ kind: "contact" }`.
//   - **Super-effective** (Permafrost / Primal Armor / Thick Skin /
//     Flame Shield — "Takes 35/50% less from super-effective"):
//     `{ kind: "super-effective" }`.
//   - **Full-HP** (Brain Mass "Halves damage at full HP"): `{ kind: "full-hp" }`.
//
// Sub-shapes intentionally NOT in this primitive:
//   - **Type-keyed resist** (Elemental Aegis "1/2 damage from Fire/Elec/Water"):
//     handled by `TypeAbsorbHealAbAttr` / type-resist subclass in archetype
//     #11 (`immunity-with-absorb.ts`). Composes with this primitive via the
//     `CompositeAbAttr` layer.
//   - **Weather-gated** (Christmas Spirit "1/2 damage if hail active"):
//     composes via `WeatherOrTerrainInteraction` + this primitive. Layered
//     wire-up rather than a unified discriminator.
//   - **Crit-damage reduction** (Bad Omen "1/4 damage from crits"): defender-
//     side crit hook differs from the base damage path — handled bespoke since
//     pokerogue routes crit damage through a separate pipeline.
//
// Examples (per taxonomy):
//   - `Aura Armor` — `new DamageReductionAbAttr({ reduction: 0.1,
//       filter: { kind: "all" } })`
//   - `Permafrost` — `new DamageReductionAbAttr({ reduction: 0.35,
//       filter: { kind: "super-effective" } })`
//   - `Fire Scales` — `new DamageReductionAbAttr({ reduction: 0.5,
//       filter: { kind: "category", category: MoveCategory.SPECIAL } })`
//   - `Brain Mass` — `new DamageReductionAbAttr({ reduction: 0.5,
//       filter: { kind: "full-hp" } })`
// =============================================================================

import { ReceivedMoveDamageMultiplierAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { MoveCategory, type MoveDamageCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/**
 * Discriminated filter for {@linkcode DamageReductionAbAttr}. Each variant
 * gates the reduction on a specific predicate over the incoming move. New
 * variants should be appended (additive) as we expand archetype coverage.
 */
export type DamageReductionFilter =
  | { readonly kind: "all" }
  | { readonly kind: "category"; readonly category: MoveDamageCategory }
  | { readonly kind: "contact" }
  | { readonly kind: "super-effective" }
  | { readonly kind: "resisted" }
  | { readonly kind: "full-hp" }
  /** Crit-received reduction — Bad Omen ("takes 1/4 damage from crits"). */
  | { readonly kind: "crit" }
  /** Category-in-weather — Sand Guard / Sun Basking ("1/2 spec dmg in sand"). */
  | {
      readonly kind: "category-in-weather";
      readonly category: MoveDamageCategory;
      readonly weather: WeatherType;
    }
  /** Type-of-move filter — Thick Blubber ("1/4 fire/ice dmg"), Strong Foundation. */
  | { readonly kind: "move-type"; readonly type: PokemonType };

/** Construction options for {@linkcode DamageReductionAbAttr}. */
export interface DamageReductionOptions {
  /**
   * Damage REDUCTION fraction in `(0, 1)`. Stored as the "amount removed", not
   * the final multiplier — so `reduction: 0.5` means "take 50% less damage"
   * which translates to a `multiplier: 0.5` passed to the parent. Validated
   * as strictly between 0 and 1 (exclusive on both ends).
   *
   * Example: `reduction: 0.35` → 35% damage reduction → 65% damage taken.
   */
  readonly reduction: number;
  /**
   * Discriminated filter selecting which incoming moves the reduction applies
   * to. Required: there's no implicit "all damaging moves" default — pass
   * `{ kind: "all" }` explicitly to be unambiguous at the data layer.
   */
  readonly filter: DamageReductionFilter;
  /** Whether this reduction also applies to direct fixed-damage moves. */
  readonly affectsFixedDamage?: boolean;
}

/**
 * Parameterized `AbAttr` implementing the generic damage-reduction archetype.
 *
 * Used (or will be used) by ER abilities such as `Aura Armor`, `Permafrost`,
 * `Primal Armor`, `Thick Skin`, `Flame Shield`, `Fire Scales`, `Ice Plumes`,
 * `Brain Mass`, and other "takes N% less damage from X" abilities.
 *
 * @remarks
 * Extends pokerogue's {@linkcode ReceivedMoveDamageMultiplierAbAttr}. The
 * parent's `canApply` calls our condition closure; the parent's `apply`
 * multiplies the damage holder by the configured multiplier (which we
 * derive as `1 - reduction`).
 *
 * Note that the parent stores its condition as a protected `condition`; we
 * keep our own discriminated `filter` snapshot for introspection and tests.
 *
 * For the `super-effective` filter, we evaluate `move.getMoveEffectiveness`
 * via the attacker's pokemon-effectiveness method. Since the parent's
 * condition predicate runs inside `canApply` (which has access to the live
 * defender/attacker/move triple), this works without modifying pokerogue's
 * dispatch. We use the lightweight `getAttackTypeEffectiveness` form since
 * we only need the type chart multiplier; the parent has already filtered
 * out cancelled / immune cases by the time the predicate runs.
 */
export class DamageReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  private readonly reductionAmount: number;
  private readonly filterSpec: DamageReductionFilter;

  constructor(opts: DamageReductionOptions) {
    if (!(opts.reduction > 0 && opts.reduction < 1)) {
      throw new Error(`[DamageReductionAbAttr] reduction must be in (0, 1); got ${opts.reduction}`);
    }
    // Defensive runtime check: even though `MoveDamageCategory` excludes
    // STATUS at the type level, callers may bypass strict typing (e.g. via
    // `as never`) so we keep a runtime guard. The cast keeps TS happy since
    // it knows the static type rules out STATUS already.
    if (opts.filter.kind === "category" && (opts.filter.category as MoveCategory) === MoveCategory.STATUS) {
      throw new Error(
        "[DamageReductionAbAttr] category filter cannot target MoveCategory.STATUS — status moves do not deal damage",
      );
    }
    const filter = opts.filter;
    const multiplier = 1 - opts.reduction;
    super(
      (target: Pokemon, attacker: Pokemon, move: Move) =>
        DamageReductionAbAttr.matchesFilter(filter, target, attacker, move),
      multiplier,
      false,
      opts.affectsFixedDamage,
    );
    this.reductionAmount = opts.reduction;
    this.filterSpec = filter;
  }

  /** Read-only accessor for the configured reduction (0 < r < 1). */
  public getReduction(): number {
    return this.reductionAmount;
  }

  /** Read-only accessor for the configured filter spec. */
  public getFilter(): DamageReductionFilter {
    return this.filterSpec;
  }

  /**
   * Evaluate the filter against an incoming move. Returns true if the
   * configured reduction should apply.
   *
   * Exposed as a static so tests can verify each filter variant in isolation
   * and the composite archetype (Phase C1f) can reuse the predicate without
   * re-implementing the discriminator switch.
   *
   * @param filter   The configured filter spec
   * @param target   The defending Pokemon (this AbAttr's owner)
   * @param attacker The attacking Pokemon
   * @param move     The incoming move
   */
  public static matchesFilter(filter: DamageReductionFilter, target: Pokemon, attacker: Pokemon, move: Move): boolean {
    switch (filter.kind) {
      case "all":
        return move.category !== MoveCategory.STATUS;
      case "category":
        return move.category === filter.category;
      case "contact":
        return move.hasFlag(MoveFlags.MAKES_CONTACT);
      case "super-effective": {
        // Use the attacker-side move type (after type-changing abilities) and
        // call the defender's effectiveness check. `getAttackTypeEffectiveness`
        // returns the type-chart multiplier (e.g. 2 for super-effective, 0.5
        // for resisted, 0 for immune). > 1 means super-effective.
        const moveType = attacker.getMoveType(move);
        const eff = target.getAttackTypeEffectiveness(moveType, { source: attacker, move });
        return eff > 1;
      }
      case "resisted": {
        // Symmetric to super-effective: the incoming move is not-very-effective
        // (type-chart multiplier in (0, 1)). Immunity (0) does not count.
        if (move.category === MoveCategory.STATUS) {
          return false;
        }
        const moveType = attacker.getMoveType(move);
        const eff = target.getAttackTypeEffectiveness(moveType, { source: attacker, move });
        return eff > 0 && eff < 1;
      }
      case "full-hp":
        return target.isFullHp() && move.category !== MoveCategory.STATUS;
      case "crit": {
        // `move.isCrit` would only be set during the actual damage phase.
        // Pokerogue's PostDefend chain provides crit info via the damage
        // calculator; for our PreApply reduction we approximate via
        // `target.turnData.attacksReceived[0]?.critical`. Falls back to
        // false if no attack data is recorded yet.
        const lastAttack = target.turnData.attacksReceived?.[0];
        return move.category !== MoveCategory.STATUS && !!lastAttack?.critical;
      }
      case "category-in-weather": {
        const currentWeather = globalScene?.arena?.weather?.weatherType;
        return move.category === filter.category && currentWeather === filter.weather;
      }
      case "move-type": {
        if (move.category === MoveCategory.STATUS) {
          return false;
        }
        return attacker.getMoveType(move) === filter.type;
      }
    }
  }
}

/**
 * Marker type — useful for the wire-up layer to refer to this archetype's
 * primary class generically. Mirrors the convention in `weather-terrain-
 * interaction`, `status-immunity`, `crit-mod`.
 */
export type DamageReduction = DamageReductionAbAttr;
