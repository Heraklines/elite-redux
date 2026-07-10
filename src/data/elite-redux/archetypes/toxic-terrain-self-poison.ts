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
// The poison bypasses the terrain's grounding requirement (the dex's "regardless
// of grounding") because it is applied directly, not via the terrain's per-turn
// grounded-chip path. Ordinary type immunity (Poison/Steel can't be poisoned)
// still applies through the normal `trySetStatus` immunity checks.
// =============================================================================

import { PostSummonAbAttr, PostTerrainChangeAbAttr, type PostTerrainChangeAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

/**
 * Poison the holder if (and only if) Toxic Terrain is currently active. No-op
 * when simulated, when the holder has fainted, or when it already carries a
 * status. Grounding is intentionally NOT checked — the dex applies the poison
 * "regardless of grounding".
 */
const selfPoisonInToxicTerrain = (pokemon: Pokemon, simulated: boolean | undefined): void => {
  if (simulated) {
    return;
  }
  if (globalScene.arena.terrain?.terrainType !== TerrainType.TOXIC) {
    return;
  }
  if (pokemon.isFainted() || (pokemon.status?.effect ?? StatusEffect.NONE) !== StatusEffect.NONE) {
    return;
  }
  pokemon.trySetStatus(StatusEffect.POISON, pokemon);
};

/** Self-poison on switch-in when Toxic Terrain is already active. */
export class ToxicTerrainSelfPoisonOnSummonAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    selfPoisonInToxicTerrain(pokemon, simulated);
  }
}

/** Self-poison the instant the terrain becomes Toxic while the holder is on field. */
export class ToxicTerrainSelfPoisonOnTerrainChangeAbAttr extends PostTerrainChangeAbAttr {
  override canApply({ terrain }: PostTerrainChangeAbAttrParams): boolean {
    return terrain === TerrainType.TOXIC;
  }

  override apply({ pokemon, simulated }: PostTerrainChangeAbAttrParams): void {
    selfPoisonInToxicTerrain(pokemon, simulated);
  }
}
