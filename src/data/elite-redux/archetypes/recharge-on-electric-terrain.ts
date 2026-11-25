/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `recharge-on-electric-terrain` primitive.
//
// Re-applies the CHARGED battler tag (doubling the next Electric move's power)
// whenever Electric Terrain becomes active. Used by Energized 699 ("Recharge
// when Electric Terrain becomes active during battle") alongside its entry
// charge. Rides pokerogue's PostTerrainChangeAbAttr hook (fired from
// `Arena.trySetTerrain`), so it is consulted for every terrain change and only
// acts when the new terrain is Electric.
// =============================================================================

import { PostTerrainChangeAbAttr, type PostTerrainChangeAbAttrParams, PostVictoryAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import type { AbAttrBaseParams } from "#types/ability-types";

export class RechargeChargedOnElectricTerrainAbAttr extends PostTerrainChangeAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostTerrainChangeAbAttrParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the replaceable gate, then the effect's own feasibility. */
  override canApply(params: PostTerrainChangeAbAttrParams): boolean {
    return gatedCanApply<PostTerrainChangeAbAttrParams>(this, params);
  }

  /** The replaceable condition (clause 1 of the original): the terrain that just began is Electric Terrain. */
  public gate({ terrain }: PostTerrainChangeAbAttrParams): boolean {
    return terrain === TerrainType.ELECTRIC;
  }

  /** Clause 2 of the original: the holder can take the Charged state (feasibility of the effect). */
  public residual({ pokemon }: PostTerrainChangeAbAttrParams): boolean {
    return pokemon.canAddTag(BattlerTagType.CHARGED);
  }

  override apply({ simulated, pokemon }: PostTerrainChangeAbAttrParams): void {
    if (!simulated) {
      pokemon.addTag(BattlerTagType.CHARGED, 0);
    }
  }
}

/**
 * Energized 699: "Recharges when scoring a direct KO with an Electric move."
 * Rides pokerogue's PostVictoryAbAttr hook (fired in `FaintPhase` on the
 * Pokemon that landed the KO blow). Gated on the KO'er's last-used move being
 * Electric-type — that move is the one that just secured the knockout.
 */
export class RechargeChargedOnElectricKoAbAttr extends PostVictoryAbAttr {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** Tier B split (ability studio spec 3.1): the replaceable gate, then the effect's own feasibility. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition (clauses 1 and 2 of the original): the holder's last move is a printed Electric-type move. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    const last = pokemon.getLastXMoves(1)[0];
    return last !== undefined && allMoves[last.move]?.type === PokemonType.ELECTRIC;
  }

  /** Clause 3 of the original: the holder can take the Charged state (feasibility of the effect). */
  public residual({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.canAddTag(BattlerTagType.CHARGED);
  }

  override apply({ simulated, pokemon }: AbAttrBaseParams): void {
    if (!simulated) {
      pokemon.addTag(BattlerTagType.CHARGED, 0);
    }
  }
}
