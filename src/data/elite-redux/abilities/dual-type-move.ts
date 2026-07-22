/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — reusable DUAL-TYPE MOVE primitive (Batch 3).
//
// Generalizes vanilla Flying Press (Fighting/Flying) into a mechanism where any
// move instance — or any Pokemon's next physical move (Negative Feedback's
// prime) — can carry a SECOND type for effectiveness. Built as a standalone
// primitive so the maintainer can reuse it on upcoming dual-type moves.
//
// DEFAULTS (documented in the batch report), verified against Flying Press:
//   - Effectiveness = PRODUCT of both type charts. This mirrors Flying Press's
//     `FlyingTypeMultiplierAttr`, which multiplies the base (Fighting) matchup
//     by the target's Flying matchup. `DualTypeMoveAttr` is a
//     `MoveTypeChartOverrideAttr` doing exactly that for its `secondType`, so
//     Flying Press's own behavior is UNCHANGED (it keeps its bespoke attr).
//   - STAB = the user gets STAB if it shares EITHER type. Flying Press vanilla
//     only STABs on its PRIMARY (Fighting) type — the engine's
//     `calculateStabMultiplier` checks solely `source.getMoveType(move)`. This
//     primitive ADDS a +0.5 bonus when the user shares the SECOND type too
//     (via `dualTypeStabBonus`, wired into `calculateStabMultiplier`). Flying
//     Press does NOT carry `DualTypeMoveAttr`, so it is unaffected — the
//     either-type rule applies only to moves built through this primitive.
//
// PRIME (Negative Feedback, item 7 — maintainer-vetoed reading): when Mega
// Minun damages a paralyzed target, the TARGET's next PHYSICAL move is converted
// to Electric (primary) / Fairy (second effectiveness type). The type flip lands
// in `getMoveType` (so absorb/redirect abilities — Volt Absorb, Lightning Rod —
// see the move as Electric and interact correctly), the Fairy effectiveness
// product in `getAttackTypeEffectiveness`, and the either-type STAB in
// `calculateStabMultiplier`. The prime persists until the target uses a physical
// move or leaves the field (whichever first) — documented.
// =============================================================================

import { MoveCategory } from "#enums/move-category";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { DualTypeMoveAttr, Move } from "#moves/move";

// `DualTypeMoveAttr` (the value) lives in `move.ts`; importing it here as a value
// would form an import cycle (move.ts → … → pokemon.ts → this file), so we detect
// it by constructor name and re-export only its TYPE for callers that annotate.
export type { DualTypeMoveAttr };

/** Per-target dual-type prime: the target's next physical move becomes primary/second. */
interface DualTypePrime {
  readonly primaryType: PokemonType;
  readonly secondType: PokemonType;
  readonly physicalOnly: boolean;
}

const DUAL_TYPE_PRIME = new WeakMap<Pokemon, DualTypePrime>();

/**
 * Prime `target`'s next move to become `primaryType`/`secondType` dual-type
 * (Negative Feedback: Electric/Fairy). Overwrites any existing prime.
 * `physicalOnly` (default true) restricts consumption to physical moves; the
 * batch-2 signature Reduction primes any non-status move.
 */
export function primeDualTypeMove(
  target: Pokemon,
  primaryType: PokemonType,
  secondType: PokemonType,
  physicalOnly = true,
): void {
  DUAL_TYPE_PRIME.set(target, { primaryType, secondType, physicalOnly });
}

/** The active dual-type prime on `pokemon`, or `undefined`. */
export function getDualTypePrime(pokemon: Pokemon): DualTypePrime | undefined {
  return DUAL_TYPE_PRIME.get(pokemon);
}

/** Clear a dual-type prime (on use or on leaving the field). Idempotent. */
export function clearDualTypePrime(pokemon: Pokemon): void {
  DUAL_TYPE_PRIME.delete(pokemon);
}

/** Whether `pokemon` is primed AND `move` is a move that consumes the prime. */
export function dualTypePrimeApplies(pokemon: Pokemon, move: Move): boolean {
  const prime = DUAL_TYPE_PRIME.get(pokemon);
  return (
    !!prime && (prime.physicalOnly ? move.category === MoveCategory.PHYSICAL : move.category !== MoveCategory.STATUS)
  );
}

/**
 * The PRIMARY type override for `pokemon`'s move under an active prime, or
 * `undefined`. Read by `getMoveType` to flip the type BEFORE effectiveness /
 * absorb / redirect run. Does NOT clear the prime (consumption happens once the
 * hit actually resolves, in `consumeDualTypePrimeOnUse`).
 */
export function dualTypePrimeMoveType(pokemon: Pokemon, move: Move): PokemonType | undefined {
  if (!dualTypePrimeApplies(pokemon, move)) {
    return;
  }
  return DUAL_TYPE_PRIME.get(pokemon)?.primaryType;
}

/** The SECOND effectiveness type contributed by a prime OR a `DualTypeMoveAttr`. */
export function dualTypeSecondType(source: Pokemon, move: Move): PokemonType | undefined {
  const primed = dualTypePrimeSecondType(source, move);
  if (primed !== undefined) {
    return primed;
  }
  const attr = move.attrs.find(a => a?.constructor?.name === "DualTypeMoveAttr") as DualTypeMoveAttr | undefined;
  return attr?.secondType;
}

/**
 * The SECOND effectiveness type from an active PRIME only (not a `DualTypeMoveAttr`,
 * which the engine already applies via `MoveTypeChartOverrideAttr`). Read by
 * `getAttackTypeEffectiveness` to fold the prime's second type into the product.
 */
export function dualTypePrimeSecondType(source: Pokemon, move: Move): PokemonType | undefined {
  return dualTypePrimeApplies(source, move) ? DUAL_TYPE_PRIME.get(source)?.secondType : undefined;
}

/**
 * The +0.5 STAB bonus a dual-type move grants for its SECOND type when the
 * source shares it (and it is not already the move's primary type, to avoid
 * double counting). Wired into `Pokemon.calculateStabMultiplier`.
 */
export function dualTypeStabBonus(source: Pokemon, move: Move, moveType: PokemonType): number {
  const second = dualTypeSecondType(source, move);
  if (second === undefined || second === PokemonType.STELLAR || second === moveType) {
    return 0;
  }
  return source.getTypes(false, false).includes(second) ? 0.5 : 0;
}

/** Consume a target's dual-type prime after it uses a physical move. */
export function consumeDualTypePrimeOnUse(pokemon: Pokemon, move: Move): void {
  if (dualTypePrimeApplies(pokemon, move)) {
    DUAL_TYPE_PRIME.delete(pokemon);
  }
}
