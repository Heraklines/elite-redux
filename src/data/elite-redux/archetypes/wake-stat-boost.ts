/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `wake-stat-boost` primitive (Rude Awakening 738).
//
// "Upon awakening, the user permanently gains immunity to sleep status and
// boosts all stats by one stage. Once per battle."
//
// This is the on-wake half. The matching sleep-immunity half is a plain
// `StatusEffectImmunityAbAttrEr({statuses:[SLEEP]})` whose condition is gated
// on the same `rudeAwakeningTriggered` battleData flag this attr sets — so the
// holder is freely sleepable until it first wakes, and immune thereafter.
//
// The hook fires from `MovePhase.checkSleep` (via the `PostWakeUpAbAttr`
// lifecycle marker) the instant sleep turns reach zero and the holder wakes
// naturally. The once-per-battle gate lives on `battleData`, so it resets each
// encounter but persists across the wake within a battle.
// =============================================================================

import { PostWakeUpAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { type EffectiveStat, Stat } from "#enums/stat";
import type { AbAttrBaseParams } from "#types/ability-types";

/** The five core battle stats — "all stats" excludes accuracy/evasion. */
const ALL_STATS: readonly EffectiveStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];

export interface WakeStatBoostOptions {
  /** Stats to change on wake. Defaults to the five core battle stats. */
  readonly stats?: readonly EffectiveStat[];
  /** Stage delta to apply to each stat. */
  readonly stages: number;
}

/**
 * On natural wake-from-sleep, apply a one-time stat-stage change to the holder
 * and flip the `rudeAwakeningTriggered` flag (which also switches on the gated
 * sleep immunity). Fires at most once per battle.
 */
export class WakeStatBoostAbAttr extends PostWakeUpAbAttr {
  private readonly stats: readonly EffectiveStat[];
  private readonly stages: number;

  constructor(opts: WakeStatBoostOptions) {
    super();
    this.stats = opts.stats ?? ALL_STATS;
    this.stages = opts.stages;
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return !pokemon.battleData.rudeAwakeningTriggered;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Spend the once-per-battle charge before queueing so a re-entrant wake
    // (or AI preview) can't double-fire it.
    pokemon.battleData.rudeAwakeningTriggered = true;
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [...this.stats],
      this.stages,
    );
  }
}
