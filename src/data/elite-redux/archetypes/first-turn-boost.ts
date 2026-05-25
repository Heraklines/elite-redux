/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `first-turn-boost` primitive.
//
// Applies one or more stat-stage changes to the holder on their FIRST
// turn after switch-in. Only fires once per send-out — re-switching
// resets the trigger.
//
// Wires:
//   - 350 Violent Rush  — SPD +50% + ATK +20% on first turn (we model as
//     stat-stage +2 SPD + +1 ATK since stage % is engine-side coarse).
//   - 557 Readied Action — "Doubles attack on first turn" — model as +2 ATK.
//   - 573 Rapid Response — SPD +50% + SPATK +20% — +2 SPD + +1 SPATK.
//   - 616 Demolitionist — Readied Action + Ignore Protect + screens break
//     (we wire the +2 ATK piece; protect/screens deferred).
//   - 648 On the Prowl — "+1 priority for the first turn. Negative priority
//     becomes +0." Different shape — priority bracket modifier; deferred.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import type { AbAttrBaseParams } from "#types/ability-types";
import { globalScene } from "#app/global-scene";
import type { EffectiveStat } from "#enums/stat";

export interface FirstTurnStatBoostRule {
  readonly stat: EffectiveStat;
  readonly stages: number;
}

export interface FirstTurnBoostOptions {
  readonly boosts: readonly FirstTurnStatBoostRule[];
}

/**
 * On switch-in, apply each configured stat boost. Activates once per
 * send-out (matches ER's `switchInAbilityDone` flag).
 */
export class FirstTurnBoostAbAttr extends PostSummonAbAttr {
  private readonly boosts: readonly FirstTurnStatBoostRule[];

  constructor(opts: FirstTurnBoostOptions) {
    super(true);
    if (opts.boosts.length === 0) {
      throw new Error("[FirstTurnBoostAbAttr] boosts must be non-empty");
    }
    this.boosts = opts.boosts;
  }

  override canApply(_params: AbAttrBaseParams): boolean {
    return true;
  }

  override apply(params: AbAttrBaseParams): void {
    const { pokemon, simulated } = params;
    if (simulated) return;
    for (const boost of this.boosts) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [boost.stat],
        boost.stages,
      );
    }
  }
}
