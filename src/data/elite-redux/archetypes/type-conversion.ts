/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1d: `type-conversion` archetype primitive.
//
// Implements taxonomy entry #10 (~13 abilities). Parameterized AbAttr that
// converts a Pokemon's outgoing move type categorically — keyed on either
// the move's current (resolved) type OR a `MoveFlag` bit. Distinct from
// {@linkcode MoveTypeReplacementAbAttr} (in `move-replacement.ts`), which
// rewires SPECIFIC move IDs to a target type. This primitive covers the
// broader categorical conversions:
//
//   - **Type-keyed** (Aerilate/Pixilate/Galvanize family): "every Normal-type
//     move becomes [Flying/Fairy/Electric] and gets a 1.1x boost". Used by
//     ER's `Immolate`, `Hydrate`, `Fighting Spirit`, `Spectralize`,
//     `Mineralize`, `Draconize` (9-cluster).
//   - **Flag-keyed** (Sand-Song family): "Sound moves get a 1.2x boost and
//     become Ground if Normal". Used by `Sand Song`, `Banshee`, `Snow Song`,
//     `Power Metal` (4-cluster).
//   - **Source→Target sub-type swap** (Crystallize family): "X-type moves
//     become Y and get a 1.1x boost". Used by `Crystallize`, `Superconductor`.
//
// All three sub-shapes share a single trigger surface (PreAttack — modify
// the moveType holder + optionally boost power) and converge to a single
// class with a discriminated filter payload.
//
// Base classes:
//   - `MoveTypeChangeAbAttr` extends `PreAttackAbAttr` — pokerogue's existing
//     type-change primitive. The parent's constructor takes
//     `(newType, condition)`; we wrap the typed-options shape into a
//     condition closure (the filter) and pass the configured target type.
//   - Optional power boost: we deliberately do NOT extend
//     `MoveTypePowerBoostAbAttr` for the boost piece, because that class
//     gates on the *original* move type, not the new one. Instead we expose
//     a separate sibling subclass `TypeConversionPowerBoostAbAttr` extending
//     `MovePowerBoostAbAttr` that gates on the same filter used by the type
//     change, so wire-up at the data layer composes the pair naturally.
//
// Sub-shapes intentionally NOT covered (deferred):
//   - **Per-move-id type rewrites**: covered by the `MoveTypeReplacementAbAttr`
//     in `move-replacement.ts`. This primitive is for CATEGORICAL conversions
//     (every move of source type X becomes Y), not specific named moves.
//   - **Always-rotate type** (`Color Spectrum` — "Changes type each turn"):
//     fundamentally bespoke; tracked in the long-tail.
//   - **Tera-style self type conversion** (Protean / Libero): already covered
//     by pokerogue's `PokemonTypeChangeAbAttr`.
//
// Examples (per taxonomy):
//   - `Immolate` (Aerilate-style → Fire instead of Flying):
//     `new TypeConversionAbAttr({ source: { kind: "type", type: PokemonType.NORMAL },
//       newType: PokemonType.FIRE })` + `new TypeConversionPowerBoostAbAttr({
//       source: { kind: "type", type: PokemonType.NORMAL }, multiplier: 1.1 })`
//   - `Sand Song`: `new TypeConversionAbAttr({ source: { kind: "flag",
//       flag: MoveFlags.SOUND_BASED, requireType: PokemonType.NORMAL },
//       newType: PokemonType.GROUND })` + power-boost sibling.
//   - `Crystallize`: `new TypeConversionAbAttr({ source: { kind: "type",
//       type: PokemonType.ROCK }, newType: PokemonType.ICE })` + 1.1x boost.
// =============================================================================

import { MovePowerBoostAbAttr, MoveTypeChangeAbAttr } from "#abilities/ab-attrs";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

/**
 * Discriminated source-filter payload. Describes which moves this conversion
 * applies to:
 *
 *   - `type`: matches every move of the configured source type (Aerilate-
 *     style: "every Normal-type move becomes X").
 *   - `flag`: matches every move with the configured flag, optionally also
 *     requiring a specific original type (Sand-Song-style: "Sound moves
 *     become Ground IF they were Normal").
 */
export type TypeConversionSource =
  | { readonly kind: "type"; readonly type: PokemonType }
  | { readonly kind: "flag"; readonly flag: MoveFlags; readonly requireType?: PokemonType };

/** Construction options for {@linkcode TypeConversionAbAttr}. */
export interface TypeConversionOptions {
  /** The source-side filter describing which moves get converted. */
  readonly source: TypeConversionSource;
  /**
   * The target type the matching moves are rewritten to. Must not be
   * {@linkcode PokemonType.UNKNOWN}.
   */
  readonly newType: PokemonType;
}

/**
 * Parameterized `AbAttr` implementing the type-rewriting piece of the
 * `type-conversion` archetype.
 *
 * Used (or will be used) by ER abilities such as `Immolate` (Aerilate-style
 * Normal → Fire), `Hydrate` (Normal → Water), `Sand Song` (Sound, Normal-
 * gated → Ground), `Crystallize` (Rock → Ice), and similar categorical
 * conversions.
 *
 * @remarks
 * Extends pokerogue's {@linkcode MoveTypeChangeAbAttr}. The parent's
 * constructor takes `(newType, condition)`. We build the condition closure
 * from the discriminated `source` filter:
 *   - For `kind: "type"`, the closure evaluates `getMoveType(move) === source.type`.
 *   - For `kind: "flag"`, the closure evaluates `move.hasFlag(source.flag)`
 *     AND (when `requireType` is set) `getMoveType(move) === requireType`.
 *
 * Note that `getMoveType` is read BEFORE the type-conversion fires (i.e. on
 * the move's "pre-conversion" type). This matches the Aerilate semantics:
 * Aerilate gates on "is this move Normal-type at dispatch time", then
 * rewrites to Flying.
 *
 * Idempotency: if the move's current type already equals `newType`, the
 * predicate still passes (the closure doesn't compare against newType). The
 * parent's apply just writes the same value back — a no-op. Tests verify the
 * predicate fires correctly in both pre- and post-conversion states for
 * downstream-of-this-ability dispatches.
 */
export class TypeConversionAbAttr extends MoveTypeChangeAbAttr {
  private readonly source: TypeConversionSource;
  private readonly configuredNewType: PokemonType;

  constructor(opts: TypeConversionOptions) {
    if (opts.newType === PokemonType.UNKNOWN) {
      throw new Error("[TypeConversionAbAttr] newType cannot be PokemonType.UNKNOWN");
    }
    if (opts.source.kind === "flag" && opts.source.flag === MoveFlags.NONE) {
      throw new Error("[TypeConversionAbAttr] source.flag must be a non-NONE MoveFlags bit");
    }
    if (opts.source.kind === "type" && opts.source.type === PokemonType.UNKNOWN) {
      throw new Error("[TypeConversionAbAttr] source.type cannot be PokemonType.UNKNOWN");
    }
    const source = opts.source;
    super(opts.newType, (user: Pokemon, _target: Pokemon | null, move: Move) =>
      TypeConversionAbAttr.matchesSource(source, user, move),
    );
    this.source = source;
    this.configuredNewType = opts.newType;
  }

  /** Read-only accessor for the configured source filter. */
  public getSource(): TypeConversionSource {
    return this.source;
  }

  /** Read-only accessor for the configured target type. */
  public getNewType(): PokemonType {
    return this.configuredNewType;
  }

  /**
   * Evaluate the source filter against a candidate move. Exposed as a static
   * for tests and for the power-boost sibling class to reuse without
   * re-implementing the predicate.
   */
  public static matchesSource(source: TypeConversionSource, _user: Pokemon, move: Move): boolean {
    // IMPORTANT: use `move.type` (the move's BASE type from its data) not
    // `user.getMoveType(move)`. The latter runs PreAttack AbAttrs including
    // this one, which causes an infinite recursion: getMoveType → applyAbAttrs
    // → TypeConversionAbAttr.canApply → matchesSource → getMoveType. This
    // bug manifested in real battles by freezing the fight UI when the
    // player tried to pick a move (the moveset render path calls
    // `m.getMove().id` AFTER move type resolution).
    switch (source.kind) {
      case "type":
        return move.type === source.type;
      case "flag":
        if (!move.hasFlag(source.flag)) {
          return false;
        }
        if (source.requireType !== undefined && move.type !== source.requireType) {
          return false;
        }
        return true;
    }
  }
}

/** Construction options for {@linkcode TypeConversionPowerBoostAbAttr}. */
export interface TypeConversionPowerBoostOptions {
  /**
   * The same source filter used by the paired {@linkcode TypeConversionAbAttr}.
   * The boost fires for moves that would also be type-converted; wire both
   * instances together at the data layer for symmetric semantics.
   */
  readonly source: TypeConversionSource;
  /**
   * The power multiplier applied to matching moves. Typical value is `1.1`
   * (matches Aerilate / Pixilate / Galvanize), but ER variants use up to
   * `1.2` (Sand Song family). Must be > 0; values < 1 are permitted for
   * symmetry but unusual.
   */
  readonly multiplier: number;
}

/**
 * Parameterized `AbAttr` implementing the power-boost piece of the
 * `type-conversion` archetype.
 *
 * Used as a sibling to {@linkcode TypeConversionAbAttr} when an ER ability
 * does both ("Normal moves become Fire AND get 1.1x") — wire both instances
 * with the same {@linkcode source} filter so the predicates agree.
 *
 * @remarks
 * Extends pokerogue's {@linkcode MovePowerBoostAbAttr}. We don't extend
 * {@linkcode MoveTypePowerBoostAbAttr} because that class gates on the
 * type-after-conversion if Aerilate-style abilities run first. Reading the
 * filter directly from the original type / flag bypasses dispatch-ordering
 * ambiguity and matches what the type-conversion class already does.
 */
export class TypeConversionPowerBoostAbAttr extends MovePowerBoostAbAttr {
  private readonly source: TypeConversionSource;
  private readonly multiplier: number;

  constructor(opts: TypeConversionPowerBoostOptions) {
    if (!(opts.multiplier > 0)) {
      throw new Error(`[TypeConversionPowerBoostAbAttr] multiplier must be > 0; got ${opts.multiplier}`);
    }
    if (opts.source.kind === "flag" && opts.source.flag === MoveFlags.NONE) {
      throw new Error("[TypeConversionPowerBoostAbAttr] source.flag must be a non-NONE MoveFlags bit");
    }
    const source = opts.source;
    super((user, _defender, move) => TypeConversionAbAttr.matchesSource(source, user, move), opts.multiplier, false);
    this.source = source;
    this.multiplier = opts.multiplier;
  }

  /** Read-only accessor for the configured source filter. */
  public getSource(): TypeConversionSource {
    return this.source;
  }

  /** Read-only accessor for the configured power multiplier. */
  public getMultiplier(): number {
    return this.multiplier;
  }
}

/**
 * Marker type — useful for the wire-up layer to refer to either subclass of
 * this archetype generically.
 */
export type TypeConversion = TypeConversionAbAttr | TypeConversionPowerBoostAbAttr;
