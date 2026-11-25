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
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { type BattleStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_DANDELION_BURST_ABILITY_ID = 5907;

/** HP fraction at/below which Dandelion Burst triggers. */
export const DANDELION_BURST_THRESHOLD = 0.5;
/** Speed stages dropped by the automatic Cotton Spore. */
export const DANDELION_BURST_COTTON_SPORE_STAGES = -2;

/** Per-holder record of the wave (battle) in which Dandelion Burst last fired. */
const DANDELION_BURST_USED = new WeakMap<Pokemon, number>();

export class DandelionBurstAbAttr extends PostDamageAbAttr implements GatedAttr<PostDamageAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostDamageAbAttrParams) => boolean) | undefined;

  /**
   * @param hpRatio - The share of max HP the holder must fall to (or below) for the ability to trigger (default 0.5).
   * @param stat - The stat each foe loses (default Speed, the automatic Cotton Spore).
   * @param stages - How many stages that stat changes (default -2).
   */
  constructor(
    public readonly hpRatio: number = DANDELION_BURST_THRESHOLD,
    public readonly stat: BattleStat = Stat.SPD,
    public readonly stages: number = DANDELION_BURST_COTTON_SPORE_STAGES,
  ) {
    super();
  }

  /** Tier B (ability studio spec 3.1): `canApply` is `guards && gate && residual`, the original clause order. */
  override canApply(params: PostDamageAbAttrParams): boolean {
    return gatedCanApply<PostDamageAbAttrParams>(this, params);
  }

  /** Safety rules, in the original order: not fainted, then the ability's own once-per-battle memory. */
  public guards({ pokemon }: PostDamageAbAttrParams): boolean {
    if (pokemon.hp <= 0) {
      return false;
    }
    return DANDELION_BURST_USED.get(pokemon) !== (globalScene.currentBattle?.waveIndex ?? 0);
  }

  /** The replaceable condition: the hit CROSSED to at-or-below the ratio (it was above before the hit). */
  public gate({ pokemon, damage }: PostDamageAbAttrParams): boolean {
    const threshold = pokemon.getMaxHp() * this.hpRatio;
    return pokemon.hp <= threshold && pokemon.hp + damage > threshold;
  }

  /** What stays in the class: at least one living opposing Pokemon to act on. */
  public residual({ pokemon }: PostDamageAbAttrParams): boolean {
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
        [this.stat],
        this.stages,
      );
    }
  }
}

export function erDandelionBurstUsedWave(pokemon: Pokemon): number | undefined {
  return DANDELION_BURST_USED.get(pokemon);
}
