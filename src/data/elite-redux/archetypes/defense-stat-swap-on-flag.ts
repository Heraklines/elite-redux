/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `defense-stat-swap-on-flag` archetype.
//
// MovePowerBoost-style approximation of "this flagged move targets the
// OPPOSITE defensive stat". Pokerogue's damage formula picks DEF for
// physical and SPDEF for special moves at field/pokemon.ts:3748 — there
// is no hook to override which defensive stat the move uses.
//
// We approximate by adjusting the move's POWER by the ratio of the
// "wrong" defensive stat over the "right" one. So a physical Iron Fist
// move (normally hits DEF) with this attr targeting SPDEF becomes:
//
//   adjusted_power = base_power * (target.DEF / target.SPDEF)
//
// The resulting damage matches what would happen if the move had been
// computed against SPDEF directly — same final damage, but routed through
// pokerogue's existing power-multiplier hook instead of touching the
// defender-stat selector.
//
// Wires (defer until needed in the dispatcher):
//   - 273 Power Fists — PUNCHING_MOVE → target SpDef (+ separate 1.3x boost)
//   - 568 Mind Crunch — BITING_MOVE → target SpAtk (offensive swap; different)
//   - 645 Soul Crusher — HAMMER_BASED → target SpDef
//   - 658 Power Edge — SLICING_MOVE → target SpDef
//   - 742 Magical Fists — PUNCHING_MOVE → target SpAtk (offensive swap)
//   - 708 Megabite — BITING_MOVE → target SpAtk (offensive swap)
//
// For "offensive swap" (use SPATK as the attacking stat instead of ATK),
// flip `swapTo` to `attacker-spatk` — handled by a sister primitive
// (TODO when those abilities are wired).
// =============================================================================

import { MovePowerBoostAbAttr } from "#abilities/ab-attrs";
import type { MoveFlags } from "#enums/move-flags";
import { MoveCategory } from "#enums/move-category";
import { Stat } from "#enums/stat";

export interface DefenseStatSwapOnFlagOptions {
  /** Move flag that triggers the swap. */
  readonly flag: MoveFlags;
  /**
   * Which side of the swap to perform:
   *  - "target-spdef-instead-of-def" — physical move now hits SPDEF
   *    (multiplier = target.DEF / target.SPDEF)
   *  - "target-def-instead-of-spdef" — special move now hits DEF
   *    (multiplier = target.SPDEF / target.DEF)
   */
  readonly swap: "target-spdef-instead-of-def" | "target-def-instead-of-spdef";
}

export class DefenseStatSwapOnFlagAbAttr extends MovePowerBoostAbAttr {
  constructor(private readonly opts: DefenseStatSwapOnFlagOptions) {
    super(() => true, 1);
  }

  override apply(params: Parameters<MovePowerBoostAbAttr["apply"]>[0]): void {
    const { opponent, move, power } = params;
    if (!opponent || !move.hasFlag(this.opts.flag)) {
      return;
    }
    const def = opponent.getStat(Stat.DEF, false);
    const spdef = opponent.getStat(Stat.SPDEF, false);
    if (def <= 0 || spdef <= 0) {
      return;
    }
    if (this.opts.swap === "target-spdef-instead-of-def" && move.category === MoveCategory.PHYSICAL) {
      power.value *= def / spdef;
    } else if (this.opts.swap === "target-def-instead-of-spdef" && move.category === MoveCategory.SPECIAL) {
      power.value *= spdef / def;
    }
  }
}
