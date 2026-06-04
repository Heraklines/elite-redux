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
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import type { AbAttrBaseParams } from "#types/ability-types";

export class RechargeChargedOnElectricTerrainAbAttr extends PostTerrainChangeAbAttr {
  override canApply({ pokemon, terrain }: PostTerrainChangeAbAttrParams): boolean {
    return terrain === TerrainType.ELECTRIC && pokemon.canAddTag(BattlerTagType.CHARGED);
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
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    const last = pokemon.getLastXMoves(1)[0];
    return (
      last !== undefined
      && allMoves[last.move]?.type === PokemonType.ELECTRIC
      && pokemon.canAddTag(BattlerTagType.CHARGED)
    );
  }

  override apply({ simulated, pokemon }: AbAttrBaseParams): void {
    if (!simulated) {
      pokemon.addTag(BattlerTagType.CHARGED, 0);
    }
  }
}
