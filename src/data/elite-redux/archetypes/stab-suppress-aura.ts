/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `stab-suppress-aura` archetype.
//
// Field-wide STAB suppressor: any pokemon on the field other than the
// holder receives 1/1.5 ≈ 0.667x damage on STAB moves to neutralize the
// 1.5x boost. Hook via MovePowerBoost on attacker side with negative
// condition: "attacker is not the holder AND move type ∈ attacker.types".
//
// Wires:
//   - 866 Relic Stone — "Other battlers don't benefit from STAB."
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { PokemonAttackCondition } from "#types/ability-types";

/**
 * The power multiplier applied to a same-type move: the reciprocal of the natural STAB factor, so it cancels it.
 * @defaultValue `1 / 1.5`
 */
export const STAB_SUPPRESSION_MULTIPLIER = 1 / 1.5;

export class StabSuppressAuraAbAttr extends MovePowerBoostAbAttr {
  /**
   * "Another battler on the field has the same ability as the attacker." Find the holder (any pokemon on field with this
   * ability instance): scan all on-field pokemon; if one of them is NOT this attacker AND has the ability marker, the
   * suppression applies. Constructor argument 0 (ability studio slot ctor:0).
   */
  private readonly auraCondition: PokemonAttackCondition;
  /** "The move's resolved type is one of the attacker's types (Tera type included)." Constructor argument 1 (slot ctor:1). */
  private readonly ownTypeCondition: PokemonAttackCondition;
  /** What a suppressed move's power is multiplied by. Constructor argument 2. */
  private readonly suppression: number;

  constructor(
    auraCondition?: PokemonAttackCondition,
    ownTypeCondition?: PokemonAttackCondition,
    suppression: number = STAB_SUPPRESSION_MULTIPLIER,
  ) {
    const aura: PokemonAttackCondition =
      auraCondition
      ?? ((pokemon, _target, _move) => {
        const field = globalScene.getField().filter(p => p && !p.isFainted());
        return field.some(
          p =>
            p !== pokemon
            && (p.hasAbility(pokemon.getAbility().id) || p.getPassiveAbility().id === pokemon.getAbility().id),
        );
      });
    const ownType: PokemonAttackCondition =
      ownTypeCondition
      ?? ((pokemon, _target, move) => {
        const userTypes = pokemon.getTypes(true);
        const moveType = pokemon.getMoveType(move);
        return userTypes.includes(moveType);
      });
    // The two tests used to sit in `apply` (aura first, then the type test); they are the parent's condition now, in the
    // same order, so `apply` only runs for a move that is really suppressed.
    super((pokemon, target, move) => aura(pokemon, target, move) && ownType(pokemon, target, move), 1);
    this.auraCondition = aura;
    this.ownTypeCondition = ownType;
    this.suppression = suppression;
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    params.power.value *= this.suppression;
  }
}
