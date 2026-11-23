/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `bone-move-type-chart` archetype.
//
// "Bone moves bypass immunities and hit for normal damage, while resisted moves
// do 2x damage. Neutral/super-effective moves remain unchanged."
//
// Bone moves are flagged `MoveFlags.BONE_BASED`. This attr rewrites the type
// effectiveness multiplier for such moves:
//   - immune (0x)        → 1x   (bypass the type immunity, normal damage)
//   - resisted (<1x)     → ×2   (0.5x → 1x-equivalent, 0.25x → 0.5x)
//   - neutral / SE (≥1x) → unchanged
//
// Read (registration-free, by class name) inside
// `Pokemon.getAttackTypeEffectiveness`, alongside OffensiveTypeChartOverride.
//
// Wires:
//   - 353 Bone Zone — "Bone moves ignore immunities and deal 2x on not very
//     effective."
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { MoveFlags } from "#enums/move-flags";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";
import type { NumberHolder } from "#utils/common";

/** Settings of {@linkcode BoneMoveTypeChartAbAttr}. Every default equals the original fixed behaviour. */
export interface BoneMoveTypeChartOptions {
  /** Moves with this property are rewritten (default BONE_BASED). */
  readonly flag?: MoveFlags;
  /** The multiplier an immune matchup (0x) becomes (default 1, normal damage). */
  readonly immuneBecomes?: number;
  /** The factor a resisted matchup (below 1x) is multiplied by (default 2). */
  readonly resistedFactor?: number;
}

/** What the engine knows when it asks the question: the attacker (the holder) and the move. */
export interface BoneMoveTypeChartParams {
  readonly pokemon: Pokemon;
  readonly move: Move;
}

export class BoneMoveTypeChartAbAttr extends AbAttr implements GatedAttr<BoneMoveTypeChartParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: BoneMoveTypeChartParams) => boolean) | undefined;

  private readonly flag: MoveFlags;
  private readonly immuneBecomes: number;
  private readonly resistedFactor: number;

  constructor(options: BoneMoveTypeChartOptions = {}) {
    super(false);
    this.flag = options.flag ?? MoveFlags.BONE_BASED;
    this.immuneBecomes = options.immuneBecomes ?? 1;
    this.resistedFactor = options.resistedFactor ?? 2;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply(_params: AbAttrBaseParams): void {}

  /**
   * Adjust the effectiveness multiplier for a bone move. No-op otherwise. Tier B: the property test is the replaceable
   * `gate` (the first clause, a pure read, no random draw); `source` is the attacker that holds the ability.
   */
  public fire(move: Move, multi: NumberHolder, source: Pokemon): void {
    if (!gatedCanApply<BoneMoveTypeChartParams>(this, { pokemon: source, move })) {
      return;
    }
    if (multi.value === 0) {
      multi.value = this.immuneBecomes; // bypass type immunity → normal damage
    } else if (multi.value < 1) {
      multi.value *= this.resistedFactor; // resisted → doubled
    }
  }

  /** The replaceable condition: the move has the configured property (bone by default). */
  public gate({ move }: BoneMoveTypeChartParams): boolean {
    return move.hasFlag(this.flag);
  }
}
