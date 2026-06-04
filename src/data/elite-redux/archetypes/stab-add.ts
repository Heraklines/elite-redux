/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Round 9 of the bespoke ability grind: `stab-add` archetype
// primitive.
//
// Models the ER "moves gain STAB" cluster — abilities that grant the +0.5
// same-type-attack-bonus multiplier to a move type the holder does NOT
// natively share. The vanilla `StabBoostAbAttr` (Adaptability) only amplifies
// **existing** STAB (its `canApply` returns `multiplier.value > 1`), so we
// can't reuse it to *introduce* STAB to an off-type. Instead, we model the
// effect as a `MovePowerBoostAbAttr` that multiplies outgoing move power by
// `multiplier` (default `1.5` — the natural STAB factor) when the move's
// resolved type matches the configured `targetType` AND the move's resolved
// type is NOT one of the user's current types (preventing double-stab on
// real-STAB moves).
//
// When `targetType` is omitted, the gate becomes "moveType not in sourceTypes"
// — i.e. *every* off-type move gets the STAB boost. This is the
// `Mystic Power` / `Arcane Force` "All moves gain STAB" shape.
//
// Why power-boost and not stab-multiplier-mutation?
//
//   Pokerogue's STAB calc (`Pokemon.calculateStabMultiplier`) sets the
//   multiplier to 1.5 only when `sourceTypes.includes(moveType)` and then
//   invokes `StabBoostAbAttr` to top it up. We could in principle add a new
//   hook that fires BEFORE the type-match check to seed the multiplier,
//   but that ripples through `applyAbAttrs` registration and changes the
//   damage formula's call shape. The `MovePowerBoostAbAttr` surface is the
//   conservative choice: it multiplies `power.value` and composes
//   naturally with type-damage-boost and flag-damage-boost. The result
//   matches "this move gains the +0.5 STAB bonus" semantically — final
//   damage scales by 1.5 just as if the move had been the user's type.
//
// Sub-shapes covered:
//   - Single off-type STAB add (`targetType: PokemonType.ICE`) — Aurora
//     Borealis "Ice-type moves gain STAB"; Amphibious "Water moves gain STAB".
//   - All-moves STAB add (`targetType` omitted) — Mystic Power, Arcane Force.
//   - Custom multiplier — abilities that grant a non-1.5 STAB-shaped boost
//     (none in the current ER set, but exposed for future flexibility).
//
// Examples:
//   - Aurora Borealis (291): `new StabAddAbAttr({ targetType: PokemonType.ICE })`
//   - Amphibious (297): `new StabAddAbAttr({ targetType: PokemonType.WATER })`
//   - Mystic Power (287): `new StabAddAbAttr({})` — all off-type moves
//   - Arcane Force (494): same shape; composes with super-effective rider
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import type { PokemonType } from "#enums/pokemon-type";

/** Construction options for {@linkcode StabAddAbAttr}. */
export interface StabAddOptions {
  /**
   * The single move type that gains STAB. When omitted, **all** off-type
   * moves get the STAB boost (Mystic Power / Arcane Force semantics).
   * Move types already shared by the user are skipped to avoid double-stab.
   */
  readonly targetType?: PokemonType;
  /**
   * The power multiplier applied when the gate fires. Defaults to `1.5` —
   * the natural STAB factor. Configurable for ER customs that grant a
   * differently-scaled "STAB-shaped" bonus.
   * @defaultValue `1.5`
   */
  readonly multiplier?: number;
}

/**
 * Parameterized `AbAttr` implementing the `stab-add` archetype.
 *
 * Used (or will be used) by ER abilities such as `Aurora Borealis`,
 * `Amphibious`, `Mystic Power`, `Arcane Force`, and the STAB-add piece of
 * composite abilities like `Lunar Eclipse` / `Moon Spirit`.
 *
 * @remarks
 * Extends {@linkcode MovePowerBoostAbAttr}, which itself extends
 * {@linkcode VariableMovePowerAbAttr}. The closure passed to super performs
 * two checks: (1) the move's resolved type matches the configured
 * `targetType` (or, if no `targetType`, matches *any* off-type), and (2) the
 * move's resolved type is NOT already one of the user's current types
 * (otherwise vanilla STAB already gives +0.5 and we'd double-count).
 *
 * The condition uses `pokemon.getMoveType(move)` (matches `TypeDamageBoost`)
 * so that type-changing abilities (Aerilate, Pixilate, Galvanize, …) on the
 * SAME Pokemon flip the effective type before the STAB-add check — i.e. an
 * Aerilate Hyper Voice on a Normal/Fairy pokemon counts as Flying for the
 * off-type check, and would get the stab-add boost if Flying ≠ source types.
 */
export class StabAddAbAttr extends MovePowerBoostAbAttr {
  private readonly targetType: PokemonType | null;
  private readonly multiplier: number;

  constructor(opts: StabAddOptions = {}) {
    const multiplier = opts.multiplier ?? 1.5;
    if (!(multiplier > 0)) {
      throw new Error(`[StabAddAbAttr] multiplier must be > 0; got ${multiplier}`);
    }
    const targetType = opts.targetType ?? null;
    // Condition: (no targetType OR move type matches targetType) AND
    // move type is NOT one of the user's current types. The second check
    // prevents double-stab on real-STAB moves (the natural STAB already gives
    // +0.5 in `calculateStabMultiplier`).
    super(
      (pokemon, _defender, move) => {
        if (pokemon === null) {
          return false;
        }
        const moveType = pokemon.getMoveType(move);
        if (targetType !== null && moveType !== targetType) {
          return false;
        }
        const sourceTypes = pokemon.getTypes(false, false);
        return !sourceTypes.includes(moveType);
      },
      multiplier,
      false,
    );
    this.targetType = targetType;
    this.multiplier = multiplier;
  }

  /** Read-only accessor for the configured target type, or `null` if all off-types apply. */
  public getTargetType(): PokemonType | null {
    return this.targetType;
  }

  /** Read-only accessor for the configured power multiplier (default `1.5`). */
  public getMultiplier(): number {
    return this.multiplier;
  }
}

/** Marker type — generic alias for the wire-up layer. */
export type StabAdd = StabAddAbAttr;
