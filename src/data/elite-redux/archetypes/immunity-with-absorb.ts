/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1: `immunity-with-absorb` archetype primitive.
//
// Implements the absorb-flavored half of taxonomy entry #11
// (`type-resist-or-absorb`, ~8 abilities; we cover the absorb variant in
// C1b and defer the resist variant — `Elemental Aegis`-style flat
// multiplier — to a follow-up task).
//
// Two sibling subclasses cover the two sub-shapes:
//
//   - `TypeAbsorbHealAbAttr`       extends `TypeImmunityHealAbAttr`
//     (already in pokerogue; covers Water Absorb / Volt Absorb pattern —
//     heal a configurable fraction of max HP when hit by the immune type).
//
//   - `TypeAbsorbStatBoostAbAttr`  extends `TypeImmunityStatStageChangeAbAttr`
//     (also in pokerogue; covers Storm Drain / Lightning Rod / Sap Sipper —
//     boost a configurable stat by N stages when hit by the immune type).
//
// Why two classes instead of one with a discriminator? Because pokerogue's
// existing class tree splits the two — `TypeImmunityHealAbAttr` and
// `TypeImmunityStatStageChangeAbAttr` are siblings, both extending
// `TypeImmunityAbAttr`. Following the same split lets us reuse 100% of the
// vanilla apply / dispatch logic; we only need to make `healFraction` /
// `stat / stages` configurable instead of hard-coded.
//
// Vanilla `TypeImmunityHealAbAttr.apply` hardcodes the heal to `1/4` of max
// HP. Our subclass overrides `apply` to use a configurable fraction so ER
// abilities like "Heals 50% HP when hit by X" can wire it.
//
// Examples (per taxonomy):
//   - `Water Absorb` — `new TypeAbsorbHealAbAttr({
//       type: PokemonType.WATER, healFraction: 1/4 })`
//   - `Poison Absorb` — `new TypeAbsorbHealAbAttr({
//       type: PokemonType.POISON, healFraction: 1/4 })`
//   - `Storm Drain` — `new TypeAbsorbStatBoostAbAttr({
//       type: PokemonType.WATER, stat: Stat.SPATK, stages: 1 })`
//   - `Sap Sipper` — `new TypeAbsorbStatBoostAbAttr({
//       type: PokemonType.GRASS, stat: Stat.ATK, stages: 1 })`
//
// Sub-shapes NOT covered in this primitive (deferred to later C tasks):
//   - Multi-type immunity (`Elemental Aegis` — three types resisted).
//     Handled by the resist variant of `type-resist-or-absorb` (separate
//     archetype task) or by composition (one absorb instance per type).
//   - Redirect (Storm Drain's redirect-to-self piece). Pokerogue's
//     `RedirectTypeMoveAbAttr` covers this; the wiring composes both.
//   - Composite absorb (`Ice Dew` / `Heat Sink` — "Redirects X moves.
//     Absorbs them, ups highest Atk."). Handled via composition of this
//     archetype with redirect.
// =============================================================================

import {
  TypeImmunityHealAbAttr,
  TypeImmunityStatStageChangeAbAttr,
  type TypeMultiplierAbAttrParams,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { PokemonType } from "#enums/pokemon-type";
import type { BattleStat } from "#enums/stat";
import { toDmgValue } from "#utils/common";

/** Construction options for {@linkcode TypeAbsorbHealAbAttr}. */
export interface TypeAbsorbHealOptions {
  /** The {@linkcode PokemonType} this ability is immune to. */
  readonly type: PokemonType;
  /**
   * The fraction of max HP to heal when the proc fires. Vanilla Water Absorb
   * uses `1 / 4`; ER variants may use a larger fraction.
   * @defaultValue `1 / 4`
   */
  readonly healFraction?: number;
}

/**
 * Parameterized `AbAttr` implementing the heal variant of the
 * `immunity-with-absorb` archetype.
 *
 * Used by `Water Absorb`, `Volt Absorb` (vanilla — both currently
 * hardcoded with 1/4), `Poison Absorb` (ER custom), and similar.
 *
 * @remarks
 * Extends pokerogue's existing {@linkcode TypeImmunityHealAbAttr}, which
 * implements the immunity gate AND the 1/4 heal. We override `apply` to use
 * a configurable {@linkcode healFraction} but otherwise reuse the parent's
 * `canApply` (which already handles the type-match check and the
 * "skip if at full HP" branch).
 *
 * We also call `super.apply` indirectly via the grandparent
 * ({@linkcode TypeImmunityAbAttr.apply}) by re-implementing the apply
 * sequence inline — this is the safest way to keep both the type-multiplier
 * mutation AND the configurable heal in the same method.
 */
export class TypeAbsorbHealAbAttr extends TypeImmunityHealAbAttr {
  private readonly healFraction: number;

  constructor(opts: TypeAbsorbHealOptions) {
    const fraction = opts.healFraction ?? 1 / 4;
    if (!(fraction > 0 && fraction <= 1)) {
      throw new Error(`[TypeAbsorbHealAbAttr] healFraction must be in (0, 1]; got ${fraction}`);
    }
    super(opts.type);
    this.healFraction = fraction;
  }

  /** The configured heal fraction (read-only accessor). */
  public getHealFraction(): number {
    return this.healFraction;
  }

  /**
   * Apply the immunity + configurable heal. Mirrors
   * {@linkcode TypeImmunityHealAbAttr.apply}'s structure with the heal
   * amount drawn from {@linkcode healFraction} instead of the vanilla
   * 1/4. We deliberately don't call `super.apply` — vanilla's `super.apply`
   * fires a heal phase with `pokemon.getMaxHp() / 4` hardcoded, which would
   * shadow our configurable heal. Instead we set the type-multiplier to 0
   * (matching {@linkcode TypeImmunityAbAttr.apply}) and enqueue our own
   * heal phase.
   */
  public override apply(params: TypeMultiplierAbAttrParams): void {
    const { pokemon, typeMultiplier, cancelled, simulated } = params;
    // Step 1: zero out the type multiplier (immunity behavior).
    typeMultiplier.value = 0;
    // Step 2: heal — only if not at full HP and not simulated.
    if (!pokemon.isFullHp() && !simulated) {
      globalScene.phaseManager.unshiftNew(
        "PokemonHealPhase",
        pokemon.getBattlerIndex(),
        toDmgValue(pokemon.getMaxHp() * this.healFraction),
        null,
        true,
      );
      cancelled.value = true; // Suppress the "No Effect" message.
    }
  }
}

/** Construction options for {@linkcode TypeAbsorbStatBoostAbAttr}. */
export interface TypeAbsorbStatBoostOptions {
  /** The {@linkcode PokemonType} this ability is immune to. */
  readonly type: PokemonType;
  /** The {@linkcode BattleStat} to raise/lower when the proc fires. */
  readonly stat: BattleStat;
  /** Number of stat stages to apply. Positive for a raise, negative for a drop. */
  readonly stages: number;
}

/**
 * Parameterized `AbAttr` implementing the stat-boost variant of the
 * `immunity-with-absorb` archetype.
 *
 * Used by `Storm Drain` (Water immunity + Sp. Atk boost), `Lightning Rod`
 * (Electric + Sp. Atk), `Motor Drive` (Electric + Speed), `Sap Sipper`
 * (Grass + Atk), and similar.
 *
 * @remarks
 * Extends pokerogue's existing {@linkcode TypeImmunityStatStageChangeAbAttr}
 * with a thin parameterized constructor. The parent's `apply` already does
 * exactly what we want, so no override is needed — this subclass exists
 * only to give ER's data layer a typed-options constructor (matching the
 * other archetypes' constructor style) instead of the positional super.
 */
export class TypeAbsorbStatBoostAbAttr extends TypeImmunityStatStageChangeAbAttr {
  constructor(opts: TypeAbsorbStatBoostOptions) {
    if (opts.stages === 0) {
      throw new Error("[TypeAbsorbStatBoostAbAttr] stages must be non-zero");
    }
    super(opts.type, opts.stat, opts.stages);
  }
}
