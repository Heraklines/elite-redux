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
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";

const SHARED_TURN_FLAG = Symbol("FieldStatShare.lastTurn");

export class FieldStatShareAbAttr extends PostStatStageChangeAbAttr {
  constructor() {
    super(true);
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostStatStageChangeAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): `guards` (the reentrancy memory), then `gate`, in the original clause order. */
  override canApply(params: PostStatStageChangeAbAttrParams): boolean {
    return gatedCanApply<PostStatStageChangeAbAttrParams>(this, params);
  }

  /**
   * The reentrancy memory: this Pokemon has not already shared (or received) a change this turn. Without it the
   * propagated changes would propagate again for ever. Moved verbatim from `canApply`.
   */
  public guards(params: PostStatStageChangeAbAttrParams): boolean {
    const turn = globalScene.currentBattle?.turn ?? 0;
    const last = (params.pokemon as unknown as Record<symbol, number>)[SHARED_TURN_FLAG] ?? -1;
    return last !== turn;
  }

  /** The replaceable condition: the stat really changed (a change of 0 stages is not shared). Moved verbatim from `canApply`. */
  public gate(params: PostStatStageChangeAbAttrParams): boolean {
    return params.stages !== 0;
  }

  override apply(params: PostStatStageChangeAbAttrParams): void {
    const { pokemon, stats, stages, selfTarget, simulated } = params;
    if (simulated) {
      return;
    }
    const turn = globalScene.currentBattle?.turn ?? 0;
    (pokemon as unknown as Record<symbol, number>)[SHARED_TURN_FLAG] = turn;
    const others = globalScene.getField().filter(p => p && p !== pokemon && !p.isFainted());
    for (const other of others) {
      (other as unknown as Record<symbol, number>)[SHARED_TURN_FLAG] = turn;
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", other.getBattlerIndex(), selfTarget, stats, stages);
    }
  }
}
