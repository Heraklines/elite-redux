/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `repeat-move-power-boost` archetype.
//
// MovePowerBoost hook that scales the move's power by `1 + bonus * N`,
// where N is the number of times the holder has used the SAME move in a
// row (resets on switch). Tracked via the pokemon's tempSummonData turn
// counter and `lastMove` semantic.
//
// Wires:
//   - 640 Rhythmic — "Deals 10% more damage for each repeated move use."
//     (bonus 0.1, cap 5x.)
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import { MoveResult } from "#enums/move-result";

export interface RepeatMovePowerBoostOptions {
  /** Per-repeat additive multiplier (e.g. 0.1 = +10% per repeat). */
  readonly bonus: number;
  /** Cap on total boost. */
  readonly cap?: number;
}

export class RepeatMovePowerBoostAbAttr extends MovePowerBoostAbAttr {
  private readonly bonus: number;
  private readonly cap: number;

  constructor(options: RepeatMovePowerBoostOptions) {
    super(() => true, 1);
    this.bonus = options.bonus;
    this.cap = options.cap ?? 5;
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const { pokemon, move, power } = params;
    const last = pokemon.getLastXMoves(-1);
    let repeats = 0;
    for (const m of last) {
      if (m && m.move === move.id && m.result === MoveResult.SUCCESS) {
        repeats++;
      } else {
        break;
      }
    }
    const mul = Math.min(this.cap, 1 + this.bonus * repeats);
    power.value *= mul;
  }
}
