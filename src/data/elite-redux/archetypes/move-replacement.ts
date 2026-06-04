/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: `move-replacement` archetype primitive.
//
// Implements taxonomy entry #16 (~10 abilities). Covers two sub-shapes that
// share the "this move becomes a different move/type while ability is active"
// pattern but route to different pokerogue trigger surfaces:
//
//   - `MovesetReplacementAbAttr`        extends `PostSummonAbAttr`
//     "Move A becomes Move B" — on switch-in, every configured source move in
//     the user's moveset is replaced with the target move via
//     `summonData.moveset`. The original moveset is preserved at the
//     `Pokemon.moveset` slot; the override only lives in summonData (which
//     pokerogue clears on switch-out). Used by `Temporal Rupture` (Roar of
//     Time → altered variant), `Angel's Wrath` (all moves replaced),
//     `Cold Plasma` (status-side, via composition).
//
//   - `MoveTypeReplacementAbAttr`       extends `MoveTypeChangeAbAttr`
//     "Move X's type changes to Y" — fires every time the user uses a
//     matching move, overriding its outgoing type. Same trigger surface as
//     pokerogue's Aerilate/Pixilate/Refrigerate, but the gate is a specific
//     move ID set rather than the "any Normal-type" filter those abilities
//     use. Used for ER abilities that retype specific named moves.
//
// Why two classes? They use different pokerogue trigger surfaces — moveset
// replacement is a PostSummon mutation of `summonData.moveset`, while move-
// type changes are PreAttack ability filters that mutate the `moveType` holder
// in-flight. A single mega-class would have to live in both subclass
// hierarchies; following pokerogue's existing split keeps each implementation
// small and routable through the standard dispatch keys.
//
// Sub-shapes intentionally NOT covered (deferred):
//   - **Categorical type conversion** ("Sound moves become Ground if Normal")
//     — overlaps with the `type-conversion` archetype #10. The C1c primitive
//     focuses on per-move-id and per-type-id mappings; categorical conversion
//     gets its own archetype with the broader filter.
//   - **Move replacement based on form** (DNA Scramble, etc.) — overlaps with
//     the `form-change` archetype #25. Form-conditional movesets are the
//     form-change archetype's responsibility.
//   - **Status-side replacement** ("Electric moves now burn instead of
//     paralyze") — composes with `chance-status-on-hit` archetype #6 by
//     overriding the status effect on a per-type filter; not a moveset
//     replacement at all.
//
// Documenting the gap: pokerogue's base class library has no "swap move A for
// move B at runtime" primitive. The closest is `summonData.moveset` (the
// override slot read by `getMoveset(false)`). We implement it directly here,
// following the conventions used by `PostSummonTransformAbAttr` (which also
// mutates `summonData.moveset`) for consistency.
//
// Examples (per taxonomy):
//   - `Temporal Rupture` — `new MovesetReplacementAbAttr({
//       replaceMap: { [MoveId.ROAR_OF_TIME]: MoveId.TEMPORAL_RUPTURE_VARIANT } })`
//   - "Move FOO's type becomes ICE" — `new MoveTypeReplacementAbAttr({
//       moves: [MoveId.SOME_MOVE], newType: PokemonType.ICE })`
// =============================================================================

import { MoveTypeChangeAbAttr, PostSummonAbAttr } from "#abilities/ab-attrs";
import type { MoveId } from "#enums/move-id";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { PokemonMove } from "#moves/pokemon-move";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Construction options for {@linkcode MovesetReplacementAbAttr}. */
export interface MovesetReplacementOptions {
  /**
   * Map of source move ID to target move ID. On switch-in, every moveset slot
   * whose move matches a source key is replaced with the corresponding target.
   * Slots whose moves are not in the map are left untouched. Idempotent —
   * re-firing on a slot that already contains the target leaves it as-is.
   */
  readonly replaceMap: ReadonlyMap<MoveId, MoveId>;
}

/**
 * Parameterized `AbAttr` implementing the per-move-id replacement sub-shape of
 * the `move-replacement` archetype.
 *
 * Used (or will be used) by ER abilities such as `Temporal Rupture` (Roar of
 * Time → altered variant), `Angel's Wrath` (replaces all of the user's moves),
 * and similar "this ability swaps your N-th move for X" abilities.
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostSummonAbAttr}. The replacement is
 * written into `pokemon.summonData.moveset`, which `getMoveset(false)` reads
 * with higher priority than the base `pokemon.moveset`. Because summonData
 * clears on switch-out, the replacement is naturally scoped to "while this
 * Pokemon is on the field" — switching out reverts to the original moveset
 * automatically.
 *
 * The override array is constructed lazily: we read `getMoveset(true)` (which
 * bypasses the override) to get the original moveset, then build a parallel
 * array swapping matching entries. PP is reset to the new move's full PP
 * (matches `PostSummonTransformAbAttr`'s behavior).
 *
 * Construction-time validation rejects empty maps and maps where a source ID
 * equals its target (no-op).
 */
export class MovesetReplacementAbAttr extends PostSummonAbAttr {
  private readonly replaceMap: ReadonlyMap<MoveId, MoveId>;

  constructor(opts: MovesetReplacementOptions) {
    super(true);
    if (opts.replaceMap.size === 0) {
      throw new Error("[MovesetReplacementAbAttr] replaceMap must contain at least one entry");
    }
    for (const [source, target] of opts.replaceMap) {
      if (source === target) {
        throw new Error(`[MovesetReplacementAbAttr] no-op mapping: source moveId ${source} equals target moveId`);
      }
    }
    this.replaceMap = opts.replaceMap;
  }

  /** Read-only accessor for the configured replacement map. */
  public getReplaceMap(): ReadonlyMap<MoveId, MoveId> {
    return this.replaceMap;
  }

  /**
   * The base moveset (before any override) contains at least one move whose
   * id is in {@linkcode replaceMap}. We honor pokerogue's "skip simulated"
   * convention — canApply is still allowed to query state, but apply mutates.
   */
  public override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const base = pokemon.getMoveset(true);
    for (const slot of base) {
      if (this.replaceMap.has(slot.moveId)) {
        return true;
      }
    }
    return false;
  }

  public override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const base = pokemon.getMoveset(true);
    const override: PokemonMove[] = [];
    for (const slot of base) {
      const targetMoveId = this.replaceMap.get(slot.moveId);
      if (targetMoveId === undefined) {
        override.push(slot);
        continue;
      }
      // Build a fresh PokemonMove with full PP for the replacement. Mirrors
      // what PostSummonTransformAbAttr does when overriding moveset entries —
      // ppUsed=0, ppUp=0, no maxPpOverride (so PP defaults to the target's
      // base PP value).
      override.push(new PokemonMove(targetMoveId, 0, 0));
    }
    pokemon.summonData.moveset = override;
  }
}

/** Construction options for {@linkcode MoveTypeReplacementAbAttr}. */
export interface MoveTypeReplacementOptions {
  /**
   * Move IDs that this ability retypes. The user's moves whose `moveId` is in
   * this set have their outgoing type rewritten to {@linkcode newType}. Must
   * include at least one move ID.
   */
  readonly moves: readonly MoveId[];
  /** The new type to apply to matching moves. */
  readonly newType: PokemonType;
}

/**
 * Parameterized `AbAttr` implementing the per-move-id type-change sub-shape of
 * the `move-replacement` archetype.
 *
 * Used (or will be used) by ER abilities that retype a specific named move
 * (e.g. "Signature Strike becomes Steel-type on this Pokemon"). Symmetric to
 * the broader `type-conversion` archetype #10 but the filter is a fixed move
 * ID set rather than a type or flag.
 *
 * @remarks
 * Extends pokerogue's {@linkcode MoveTypeChangeAbAttr}. The parent's
 * constructor takes `(newType, condition)` where condition is a
 * `(user, target, move) => boolean` predicate. We build the predicate at
 * construction time from {@linkcode MoveTypeReplacementOptions.moves}, using
 * `Set` for O(1) membership checks even for large move lists. The parent
 * handles canApply (predicate match) and apply (rewrite the `moveType`
 * holder); we add typed-options ergonomics and accessors.
 */
export class MoveTypeReplacementAbAttr extends MoveTypeChangeAbAttr {
  private readonly configuredMoves: ReadonlySet<MoveId>;
  private readonly configuredNewType: PokemonType;

  constructor(opts: MoveTypeReplacementOptions) {
    if (opts.moves.length === 0) {
      throw new Error("[MoveTypeReplacementAbAttr] moves must include at least one MoveId");
    }
    const moveSet = new Set(opts.moves);
    super(opts.newType, (_user: Pokemon, _target: Pokemon | null, move: Move) => moveSet.has(move.id));
    this.configuredMoves = moveSet;
    this.configuredNewType = opts.newType;
  }

  /** Read-only accessor for the configured move-ID filter set. */
  public getMoves(): ReadonlySet<MoveId> {
    return this.configuredMoves;
  }

  /** Read-only accessor for the configured new type. */
  public getNewType(): PokemonType {
    return this.configuredNewType;
  }
}

/**
 * Marker type — useful for the wire-up layer to refer to any subclass of this
 * archetype generically.
 */
export type MoveReplacement = MovesetReplacementAbAttr | MoveTypeReplacementAbAttr;
