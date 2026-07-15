/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Dandelion Burst`.
//
// "Once per battle, when the holder falls to half HP or lower, it automatically
// applies Leech Seed to ALL opposing Pokemon and uses Cotton Spore against the
// opposing side. The auto-effects respect normal immunities (e.g. Grass types
// can't be seeded)."
//
// Threshold-crossing model mirrors Wimp Out / Emergency Exit
// ({@linkcode PostDamageForceSwitchAbAttr}): fires when a damage event drops the
// holder from above half to at-or-below half. Leech Seed is applied per-foe via
// `SeedTag.canAdd` (Grass foes are skipped), and Cotton Spore is modeled as a -2
// Speed drop per foe through a StatStageChangePhase, which honors Clear Body /
// Mist / Contrary and friends. Once-per-battle is tracked per-holder per-wave.
// =============================================================================

import { PostDamageAbAttr, type PostDamageAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_DANDELION_BURST_ABILITY_ID = 5907;

/** HP fraction at/below which Dandelion Burst triggers. */
export const DANDELION_BURST_THRESHOLD = 0.5;
/** Speed stages dropped by the automatic Cotton Spore. */
export const DANDELION_BURST_COTTON_SPORE_STAGES = -2;

/** Per-holder record of the wave (battle) in which Dandelion Burst last fired. */
const DANDELION_BURST_USED = new WeakMap<Pokemon, number>();

export class DandelionBurstAbAttr extends PostDamageAbAttr {
  override canApply({ pokemon, damage }: PostDamageAbAttrParams): boolean {
    if (pokemon.hp <= 0) {
      return false;
    }
    if (DANDELION_BURST_USED.get(pokemon) === (globalScene.currentBattle?.waveIndex ?? 0)) {
      return false;
    }
    const threshold = pokemon.getMaxHp() * DANDELION_BURST_THRESHOLD;
    // Fired only on the hit that CROSSES to at-or-below half (was above before it).
    if (!(pokemon.hp <= threshold && pokemon.hp + damage > threshold)) {
      return false;
    }
    // At least one living opposing Pokemon to act on.
    return pokemon.getOpponents().some(o => o?.isActive(true));
  }

  override apply({ pokemon, simulated }: PostDamageAbAttrParams): void {
    if (simulated) {
      return;
    }
    DANDELION_BURST_USED.set(pokemon, globalScene.currentBattle?.waveIndex ?? 0);
    for (const opponent of pokemon.getOpponents()) {
      if (!opponent?.isActive(true)) {
        continue;
      }
      // Leech Seed — SeedTag.canAdd rejects Grass-types (immunity respected).
      opponent.addTag(BattlerTagType.SEEDED, undefined, MoveId.LEECH_SEED, pokemon.id);
      // Cotton Spore — a -2 Speed drop routed through the stat-stage phase, which
      // honors Clear Body / Mist / Contrary and other stat-drop immunities.
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        opponent.getBattlerIndex(),
        false,
        [Stat.SPD],
        DANDELION_BURST_COTTON_SPORE_STAGES,
      );
    }
  }
}
