/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: `hit-multiplier` archetype primitive.
//
// Implements the bulk of taxonomy entry #19 (~7 abilities). Parameterized
// AbAttr that adds extra strikes to a Pokemon's outgoing move when the move
// matches a configurable filter (type, flag, or unfiltered "any damaging
// move"). Each added strike can optionally apply a per-hit power multiplier
// to scale down the additional damage (matches the `Raging Boxer` /
// `Hyper Aggressive` / `Primal Maw` ER pattern: "Punching moves hit twice,
// 2nd hit at 40% power").
//
// Base class: `AddSecondStrikeAbAttr` (extends `PreAttackAbAttr`) — pokerogue's
// existing Parental Bond implementation. The parent's `canApply` checks the
// move's `canBeMultiStrikeEnhanced` predicate (which excludes charging moves,
// status moves, native multi-hit moves like Bullet Seed, and a few special-
// cased moves like Fling/Pollen Puff). Our subclass adds the filter gate on
// top — only firing the extra strike for moves that match our configured
// filter — and parameterizes the strike count.
//
// Sub-shapes covered:
//   - Type-keyed: `Raging Moth` — "Fire moves hit twice, both at 70% power"
//     (`{ filter: { type: FIRE }, extraStrikes: 1, multiplier: 0.7 }`).
//   - Flag-keyed: `Raging Boxer` — "Punching moves hit twice, 2nd at 40%"
//     (`{ filter: { flag: PUNCHING }, extraStrikes: 1, multiplier: 0.4 }`).
//   - Unfiltered: `Hyper Aggressive` — "Moves hit twice, 2nd at 25%"
//     (`{ extraStrikes: 1, multiplier: 0.25 }`).
//   - Multi-strike: ER abilities that add 2+ strikes (`{ extraStrikes: 2 }`)
//     — captured but not commonly used; the taxonomy mentions one form-
//     dependent example (`Multi-Headed`) which we defer to bespoke.
//
// Sub-shapes intentionally NOT in this primitive (deferred):
//   - **Skill-Link-style "always max hits" on native multi-hit moves**:
//     pokerogue's `MaxMultiHitAbAttr` already covers this exactly; ER's
//     `Skill Link` parity wires that class directly. The hit-multiplier
//     archetype focuses on ADDING strikes to moves that don't natively
//     multi-hit, not max-rolling existing multi-hits.
//   - **Range-rolled extra strikes** (`Unrelenting` — "Moves hit 2-5 times"):
//     needs a per-dispatch random roll over a range. Tracked as a follow-up
//     primitive; one-off use until a second ability adopts the shape.
//   - **Per-hit power scaling that differs across hits** (`Raging Boxer`'s
//     "first hit at 100%, second at 40%"): our `multiplier` field applies the
//     same scaling to every added strike. The "1st hit unchanged, 2nd hit at
//     N%" shape is the common case and covered here; cases with per-hit
//     scaling tables are deferred to bespoke.
//
// We expose three sibling classes following pokerogue's split convention:
//
//   - `HitMultiplierAbAttr`        extends `AddSecondStrikeAbAttr` — adds the
//     extra strike(s) with the filter gate.
//   - `HitMultiplierPowerAbAttr`   extends `MoveDamageBoostAbAttr` (via the
//     parent's flexible condition closure) — applies the configured per-strike
//     damage multiplier to the extra-strike damage.
//
// The two classes compose: an ability with a power multiplier wires both
// instances; an ability with no power multiplier wires only `HitMultiplierAbAttr`.
//
// Examples (per taxonomy):
//   - `Raging Boxer` — `new HitMultiplierAbAttr({ filter: { flag: PUNCHING },
//       extraStrikes: 1 })` + `new HitMultiplierPowerAbAttr({ filter: { flag:
//       PUNCHING }, multiplier: 0.4 })`
//   - `Hyper Aggressive` — `new HitMultiplierAbAttr({ extraStrikes: 1 })` +
//     `new HitMultiplierPowerAbAttr({ multiplier: 0.25 })`
// =============================================================================

import { AddSecondStrikeAbAttr, type AddSecondStrikeAbAttrParams, MoveDamageBoostAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/**
 * Filter narrowing which moves the extra strike applies to. Exactly one of
 * {@linkcode type} or {@linkcode flag} should be provided in practice; if both
 * are present, BOTH must match. An empty filter (`{}`) matches every move —
 * used by unfiltered "all attacking moves hit twice" abilities.
 */
export interface HitMultiplierFilter {
  /** Move type that triggers the extra strike. Omit to accept any type. */
  readonly type?: PokemonType;
  /** Move flag(s) that triggers the extra strike. Omit to accept any flags. */
  readonly flag?: MoveFlags;
}

/** Construction options for {@linkcode HitMultiplierAbAttr}. */
export interface HitMultiplierOptions {
  /**
   * Number of extra strikes to add. Must be a positive integer. Most ER
   * abilities use `1` (move hits twice total); rare cases use 2+ for triple-
   * hit patterns.
   */
  readonly extraStrikes: number;
  /**
   * Optional move filter. Omit to apply the extra strike to any damaging
   * move that passes `canBeMultiStrikeEnhanced`.
   */
  readonly filter?: HitMultiplierFilter;
}

/**
 * Parameterized `AbAttr` implementing the strike-count piece of the
 * `hit-multiplier` archetype.
 *
 * Used (or will be used) by ER abilities such as `Raging Boxer` (punching
 * moves hit twice), `Primal Maw` (biting moves hit twice), `Raging Moth`
 * (Fire moves hit twice), `Hyper Aggressive` (all moves hit twice), `Ice
 * Cold Hunter` (Ice moves hit twice in hail — weather gate composed via
 * {@linkcode WeatherOrTerrainInteraction}), etc.
 *
 * @remarks
 * Extends pokerogue's {@linkcode AddSecondStrikeAbAttr}. The parent's
 * `canApply` already checks `move.canBeMultiStrikeEnhanced`; we extend it
 * with our filter gate (type / flag match). The parent's `apply` increments
 * `hitCount.value` by 1; we override it to add the configured number of
 * extra strikes.
 *
 * Note that the parent doesn't have a constructor — `AddSecondStrikeAbAttr`
 * inherits from `PreAttackAbAttr`. We declare `super()` with no arguments;
 * `PreAttackAbAttr` is an abstract class with the default `AbAttr` ctor.
 */
export class HitMultiplierAbAttr extends AddSecondStrikeAbAttr {
  private readonly extraStrikes: number;
  private readonly filter: HitMultiplierFilter;

  constructor(opts: HitMultiplierOptions) {
    if (!Number.isInteger(opts.extraStrikes) || opts.extraStrikes < 1) {
      throw new Error(`[HitMultiplierAbAttr] extraStrikes must be a positive integer; got ${opts.extraStrikes}`);
    }
    if (opts.filter?.flag === MoveFlags.NONE) {
      throw new Error("[HitMultiplierAbAttr] filter.flag must be a non-NONE MoveFlags bit when set");
    }
    super();
    this.extraStrikes = opts.extraStrikes;
    this.filter = opts.filter ?? {};
  }

  /** Read-only accessor for the configured extra-strike count. */
  public getExtraStrikes(): number {
    return this.extraStrikes;
  }

  /** Read-only accessor for the configured move filter. */
  public getFilter(): HitMultiplierFilter {
    return this.filter;
  }

  /**
   * canApply: the parent's `canBeMultiStrikeEnhanced` predicate AND our
   * configured filter. Both must pass for the extra strike(s) to fire.
   */
  public override canApply(params: AddSecondStrikeAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    return HitMultiplierAbAttr.matchesFilter(this.filter, params.pokemon, params.move);
  }

  /**
   * Apply the configured number of extra strikes. The parent's `apply` adds
   * exactly 1; we override to add {@linkcode extraStrikes} instead.
   */
  public override apply(params: AddSecondStrikeAbAttrParams): void {
    params.hitCount.value += this.extraStrikes;
  }

  /**
   * Evaluate the filter against a candidate move. Both `type` and `flag`
   * (when present) must match; an empty filter matches every move.
   *
   * Exposed as a static so tests can verify the predicate in isolation and
   * future archetypes can reuse it.
   */
  public static matchesFilter(filter: HitMultiplierFilter, pokemon: Pokemon, move: Move): boolean {
    if (filter.type !== undefined && pokemon.getMoveType(move) !== filter.type) {
      return false;
    }
    if (filter.flag !== undefined && !move.hasFlag(filter.flag)) {
      return false;
    }
    return true;
  }
}

/** Construction options for {@linkcode HitMultiplierPowerAbAttr}. */
export interface HitMultiplierPowerOptions {
  /**
   * Damage multiplier applied to every dispatch of a matching move. Used to
   * scale down the per-hit damage when an ability adds extra strikes. Typical
   * values: `0.25`, `0.4`, `0.7`. Must be > 0 and ≤ 1 (we don't allow boosting
   * via this class — that's `TypeDamageBoostAbAttr`'s job).
   */
  readonly multiplier: number;
  /** Optional move filter (same shape as {@linkcode HitMultiplierAbAttr}). */
  readonly filter?: HitMultiplierFilter;
}

/**
 * Parameterized `AbAttr` implementing the per-strike damage-scaling piece of
 * the `hit-multiplier` archetype.
 *
 * Used (or will be used) by ER abilities that pair `HitMultiplierAbAttr` with
 * a per-strike scale-down — e.g. `Raging Boxer`'s "1st hit 100%, 2nd at 40%"
 * (compose this with multiplier 0.4 applied to the second strike).
 *
 * @remarks
 * Extends pokerogue's {@linkcode MoveDamageBoostAbAttr}. The parent's
 * constructor takes `(damageMultiplier, condition)`; we wrap the typed-options
 * shape into a condition closure that checks the filter.
 *
 * Important nuance: `MoveDamageBoostAbAttr` applies its multiplier to EVERY
 * dispatch of a matching move — including the first hit. To get true
 * "1st hit unchanged, 2nd hit at N%" semantics you would want a per-strike-
 * index multiplier, which pokerogue doesn't expose without modifying its
 * dispatch loop. The closest available shape, used by ER, is "both hits at
 * 70%" (Raging Moth) — where every dispatch is scaled and the strike count
 * is doubled. That's what this primitive enforces. The header comment above
 * documents this limitation; the deferred "per-strike scaling table" sub-
 * shape is the long-tail follow-up.
 */
export class HitMultiplierPowerAbAttr extends MoveDamageBoostAbAttr {
  private readonly powerMultiplier: number;
  private readonly powerFilter: HitMultiplierFilter;

  constructor(opts: HitMultiplierPowerOptions) {
    if (!(opts.multiplier > 0)) {
      throw new Error(`[HitMultiplierPowerAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    if (opts.multiplier > 1) {
      throw new Error(
        `[HitMultiplierPowerAbAttr] multiplier must be ≤ 1 (this primitive scales DOWN extra-strike damage); got ${opts.multiplier}. Use TypeDamageBoostAbAttr / FlagDamageBoostAbAttr for boosts.`,
      );
    }
    if (opts.filter?.flag === MoveFlags.NONE) {
      throw new Error("[HitMultiplierPowerAbAttr] filter.flag must be a non-NONE MoveFlags bit when set");
    }
    const filter = opts.filter ?? {};
    super(opts.multiplier, (pokemon: Pokemon, _target: Pokemon | null, move: Move) =>
      HitMultiplierAbAttr.matchesFilter(filter, pokemon, move),
    );
    this.powerMultiplier = opts.multiplier;
    this.powerFilter = filter;
  }

  /** Read-only accessor for the configured damage multiplier. */
  public getMultiplier(): number {
    return this.powerMultiplier;
  }

  /** Read-only accessor for the configured move filter. */
  public getFilter(): HitMultiplierFilter {
    return this.powerFilter;
  }
}

/**
 * Marker type — useful for the wire-up layer to refer to either subclass of
 * this archetype generically.
 */
export type HitMultiplier = HitMultiplierAbAttr | HitMultiplierPowerAbAttr;
