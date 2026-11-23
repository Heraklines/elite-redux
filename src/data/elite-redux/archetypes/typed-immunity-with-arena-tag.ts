/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `typed-immunity-with-arena-tag` archetype.
//
// PreDefend hook: holder is immune to attacks of the configured type, AND
// when triggered, sets an arena tag on the holder's side (e.g. Mist).
//
// Wires:
//   - 444 Evaporate — "Takes no damage and sets Mist if hit by water."
//     (immuneType: WATER, arenaTag: MIST.)
// =============================================================================

import { TypeImmunityAbAttr, type TypeMultiplierAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import type { PokemonType } from "#enums/pokemon-type";

export interface TypedImmunityWithArenaTagOptions {
  readonly immuneType: PokemonType;
  readonly arenaTag: ArenaTagType;
  readonly turns: number;
}

// MUST extend TypeImmunityAbAttr (not PreDefendAbAttr): the damage pipeline collects
// type immunities via `applyAbAttrs("TypeImmunityAbAttr", …)`, which filters by
// `instanceof TypeImmunityAbAttr`. A sibling PreDefendAbAttr subclass is never collected,
// so the immunity silently did nothing (Mega Tyranitar's Evaporate took full Water damage).
// Mirrors TypeImmunityHealAbAttr (immunity via super.apply + its own on-trigger side effect).
export class TypedImmunityWithArenaTagAbAttr
  extends TypeImmunityAbAttr
  implements GatedAttr<TypeMultiplierAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: TypeMultiplierAbAttrParams) => boolean) | undefined;
  private readonly arenaTag: ArenaTagType;
  private readonly tagTurns: number;

  constructor(opts: TypedImmunityWithArenaTagOptions) {
    super(opts.immuneType);
    this.arenaTag = opts.arenaTag;
    this.tagTurns = opts.turns;
  }

  override canApply(params: TypeMultiplierAbAttrParams): boolean {
    return gatedCanApply<TypeMultiplierAbAttrParams>(this, params);
  }

  /**
   * Tier B (ability studio spec 3.1), the old `canApply` in its old order. The replaceable condition: only damaging moves of the
   * immune type ("Takes no damage … if hit by water"), so this is the attack-move test.
   */
  public gate(params: TypeMultiplierAbAttrParams): boolean {
    return params.move.is("AttackMove");
  }

  /** Effect-side feasibility that stays in the class: the parent's immunity test (the move can target me, it is not mine, its type is the immune type). */
  public residual(params: TypeMultiplierAbAttrParams): boolean {
    return super.canApply(params);
  }

  override apply(params: TypeMultiplierAbAttrParams): void {
    super.apply(params); // sets typeMultiplier.value = 0 (the immunity)
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    const side = pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    globalScene.arena.addTag(this.arenaTag, this.tagTurns, undefined, pokemon.id, side);
  }
}
