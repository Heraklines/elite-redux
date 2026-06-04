/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `field-stat-share` archetype.
//
// PostStatStageChange hook: when ANY pokemon on the field has a stat-stage
// change, propagate the SAME change to every other on-field pokemon.
//
// Wires:
//   - 577 Sharing Is Caring — "Stat changes are shared between all
//     battlers."
//
// Reentrancy: we mark each propagation as "shared" via a per-turn marker
// so the propagated change doesn't re-propagate infinitely.
// =============================================================================

import { PostStatStageChangeAbAttr, type PostStatStageChangeAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";

const SHARED_TURN_FLAG = Symbol("FieldStatShare.lastTurn");

export class FieldStatShareAbAttr extends PostStatStageChangeAbAttr {
  constructor() {
    super(true);
  }

  override canApply(params: PostStatStageChangeAbAttrParams): boolean {
    const turn = globalScene.currentBattle?.turn ?? 0;
    const last = (params.pokemon as unknown as Record<symbol, number>)[SHARED_TURN_FLAG] ?? -1;
    return last !== turn && params.stages !== 0;
  }

  override apply(params: PostStatStageChangeAbAttrParams): void {
    const { pokemon, stats, stages, simulated } = params;
    if (simulated) {
      return;
    }
    const turn = globalScene.currentBattle?.turn ?? 0;
    (pokemon as unknown as Record<symbol, number>)[SHARED_TURN_FLAG] = turn;
    const others = globalScene.getField().filter(p => p && p !== pokemon && !p.isFainted());
    for (const other of others) {
      (other as unknown as Record<symbol, number>)[SHARED_TURN_FLAG] = turn;
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        other.getBattlerIndex(),
        true,
        stats,
        stages,
      );
    }
  }
}
