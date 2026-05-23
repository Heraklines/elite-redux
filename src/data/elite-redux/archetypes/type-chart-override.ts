/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `type-chart-override` archetype.
//
// PreDefend hook that REWRITES the incoming type-effectiveness multiplier
// when the (attackType, defenderType) pair matches one of the configured
// overrides. Distinct from IgnoreTypeImmunityAbAttr (which only flips 0x →
// the configured value) — this primitive can lower SE to neutral, raise
// resisted to neutral, force 0.5x against would-be-2x, etc.
//
// Wires:
//   - 285 Ground Shock — Electric moves vs Ground type: 0x → 0.5x (Grounds
//     are no longer immune to Electric but resist it).
//   - 457 Phantom Pain — Ghost vs Normal: 0x → 1x (Ghost moves deal normal
//     damage to Normal types).
// =============================================================================

import { PreDefendAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import type { PokemonType } from "#enums/pokemon-type";

/**
 * A single override row: when an attacker hits the holder with `attackType`
 * AND the holder has `defenderType`, the effectiveness multiplier becomes
 * `newMultiplier` (regardless of the original chart value).
 */
export interface TypeChartOverrideRule {
  /** Move type triggering the override. */
  readonly attackType: PokemonType;
  /** Defender's type (one of holder's types) that triggers the override. */
  readonly defenderType: PokemonType;
  /** Effectiveness multiplier to write (e.g. 0.5, 1, 2). */
  readonly newMultiplier: number;
}

export interface TypeChartOverrideOptions {
  readonly rules: readonly TypeChartOverrideRule[];
}

export class TypeChartOverrideAbAttr extends PreDefendAbAttr {
  private readonly rules: readonly TypeChartOverrideRule[];

  constructor(options: TypeChartOverrideOptions) {
    super(true);
    if (options.rules.length === 0) {
      throw new Error("[TypeChartOverrideAbAttr] options.rules must be non-empty");
    }
    this.rules = options.rules;
  }

  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    const { move, opponent: attacker, pokemon } = params;
    if (!move.is("AttackMove")) {
      return false;
    }
    if (attacker === pokemon) {
      return false;
    }
    const attackType = attacker.getMoveType(move);
    const defenderTypes = pokemon.getTypes(true);
    return this.rules.some(r => r.attackType === attackType && defenderTypes.includes(r.defenderType));
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    const { move, opponent: attacker, pokemon, typeMultiplier } = params;
    const attackType = attacker.getMoveType(move);
    const defenderTypes = pokemon.getTypes(true);
    // Apply the first matching rule. ER abilities only ship one rule each.
    for (const rule of this.rules) {
      if (rule.attackType === attackType && defenderTypes.includes(rule.defenderType)) {
        typeMultiplier.value = rule.newMultiplier;
        return;
      }
    }
  }
}
