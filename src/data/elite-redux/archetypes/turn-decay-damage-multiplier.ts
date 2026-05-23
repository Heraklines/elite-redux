/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `turn-decay-damage-multiplier` archetype.
//
// MovePowerBoost hook that decays the holder's outgoing damage 20% per turn,
// floored at a minimum, resetting on switch-in. Tracked via
// `tempSummonData.turnCount`.
//
// Wires:
//   - 394 Lethargy — "Damage drops 20% each turn to 20%. Resets on switch-in"
//     (start 1.0, drop 0.2 each turn, floor 0.2).
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";

export interface TurnDecayDamageMultiplierOptions {
  /** Starting multiplier (turn 0). Defaults to 1.0. */
  readonly start?: number;
  /** Per-turn additive drop. */
  readonly drop: number;
  /** Floor — multiplier won't decay below this. */
  readonly floor: number;
}

export class TurnDecayDamageMultiplierAbAttr extends MovePowerBoostAbAttr {
  constructor(options: TurnDecayDamageMultiplierOptions) {
    const start = options.start ?? 1.0;
    // Pokerogue's MovePowerBoostAbAttr applies a fixed multiplier; to express
    // per-turn decay we override the condition to ALWAYS pass and store the
    // factor by intercepting at apply-time. Easiest path: store config and
    // override apply().
    super(() => true, start);
    this.startMul = start;
    this.dropMul = options.drop;
    this.floorMul = options.floor;
  }

  private readonly startMul: number;
  private readonly dropMul: number;
  private readonly floorMul: number;

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const { pokemon, power } = params;
    const turn = pokemon.tempSummonData?.turnCount ?? 0;
    const mul = Math.max(this.floorMul, this.startMul - turn * this.dropMul);
    power.value *= mul;
  }
}
