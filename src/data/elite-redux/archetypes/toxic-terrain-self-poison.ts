/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `toxic-terrain-self-poison` archetype.
//
// Toxic Boost (vanilla ability 137) in ER: "+50% Attack when poisoned.
// IMMEDIATELY applies poison to the user when in Toxic Terrain, regardless of
// grounding. Nullifies poison damage." The +50% Atk (vanilla) and poison-damage
// nullify (BlockStatusDamageAbAttr, wired in the rebalance map) already exist;
// this supplies the missing Toxic-Terrain self-poison.
//
// Two cooperating attrs so the self-poison lands on BOTH occasions the dex
// requires — the holder switching into an already-active Toxic Terrain, and the
// terrain BECOMING Toxic while the holder is on the field:
//   1. ToxicTerrainSelfPoisonOnSummonAbAttr        — switch-in (PostSummon).
//   2. ToxicTerrainSelfPoisonOnTerrainChangeAbAttr — terrain change (PostTerrainChange).
//
// B12 chunk 3 (ability studio spec 3.1, Tier B): the "Toxic Terrain is active" test is split out as the replaceable `gate`
// of each class and the status is a constructor option that defaults to Poison. Behaviour is unchanged:
//   - the switch-in class keeps its condition INSIDE `apply` (after the ability banner is queued), exactly where the old helper
//     tested it, so the banner still shows on every entry; only the place it is read from moved into the `gate` method;
//   - the terrain-change class keeps its `canApply` test (the terrain that just began is Toxic), now as its `gate`. The old
//     helper tested the terrain AGAIN in `apply` (the terrain object on the field); that second test always agrees with the
//     event's own terrain, so it is dropped here and the gate is the only terrain test.
//
// The poison bypasses the terrain's grounding requirement (the dex's "regardless
// of grounding") because it is applied directly, not via the terrain's per-turn
// grounded-chip path. Ordinary type immunity (Poison/Steel can't be poisoned)
// still applies through the normal `trySetStatus` immunity checks.
// =============================================================================

import { PostSummonAbAttr, PostTerrainChangeAbAttr, type PostTerrainChangeAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { TerrainType } from "#data/terrain";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

/**
 * Whether Toxic Terrain is the terrain set on the field. Reads the terrain object itself (not `arena.terrainType`), so
 * Clueless negating terrain effects does not hide it: the dex says the poison lands "regardless".
 */
const toxicTerrainIsSet = (): boolean => globalScene.arena.terrain?.terrainType === TerrainType.TOXIC;

/**
 * Give the holder the status (Poison unless the ability says otherwise). No-op when the holder has fainted or already
 * carries a status. Grounding is intentionally NOT checked: the dex applies the poison "regardless of grounding".
 */
const selfStatusInToxicTerrain = (pokemon: Pokemon, status: StatusEffect): void => {
  if (pokemon.isFainted() || (pokemon.status?.effect ?? StatusEffect.NONE) !== StatusEffect.NONE) {
    return;
  }
  pokemon.trySetStatus(status, pokemon);
};

/** Self-poison on switch-in when Toxic Terrain is already active. */
export class ToxicTerrainSelfPoisonOnSummonAbAttr extends PostSummonAbAttr implements GatedAttr<AbAttrBaseParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;
  private readonly status: StatusEffect;

  constructor(status: StatusEffect = StatusEffect.POISON) {
    super();
    this.status = status;
  }

  /**
   * The replaceable condition: Toxic Terrain is set. It is read from `apply` (not `canApply`) so the ability banner
   * keeps showing on every entry, as it did when the test was inside the helper.
   */
  public gate(_params: AbAttrBaseParams): boolean {
    return toxicTerrainIsSet();
  }

  override apply(params: AbAttrBaseParams): void {
    if (params.simulated) {
      return;
    }
    const gate = this.gateOverride ?? this.gate.bind(this);
    if (!gate(params)) {
      return;
    }
    selfStatusInToxicTerrain(params.pokemon, this.status);
  }
}

/** Self-poison the instant the terrain becomes Toxic while the holder is on field. */
export class ToxicTerrainSelfPoisonOnTerrainChangeAbAttr
  extends PostTerrainChangeAbAttr
  implements GatedAttr<PostTerrainChangeAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostTerrainChangeAbAttrParams) => boolean) | undefined;
  private readonly status: StatusEffect;

  constructor(status: StatusEffect = StatusEffect.POISON) {
    super();
    this.status = status;
  }

  override canApply(params: PostTerrainChangeAbAttrParams): boolean {
    return gatedCanApply<PostTerrainChangeAbAttrParams>(this, params);
  }

  /** The replaceable condition (the whole old `canApply`): the terrain that just began is Toxic Terrain. */
  public gate({ terrain }: PostTerrainChangeAbAttrParams): boolean {
    return terrain === TerrainType.TOXIC;
  }

  override apply({ pokemon, simulated }: PostTerrainChangeAbAttrParams): void {
    if (simulated) {
      return;
    }
    selfStatusInToxicTerrain(pokemon, this.status);
  }
}
