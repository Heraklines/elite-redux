/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Genesis Supernova` (newcomer patch, Primal Mew).
//
// "This Pokemon's Psychic-type moves summon Psychic Terrain." Modeled on the
// PostMoveUsed surface (the same hook Dancer / ER copy-by-filter use), which
// fires for EVERY move used, including the holder's own — so it catches both
// damaging AND status Psychic moves, unlike PostAttack (which the dispatch site
// only reaches for damaging hits). We gate to (a) the HOLDER being the user and
// (b) the move resolving to Psychic type via `getMoveType` (so type-changing
// effects like -ate abilities are respected), then set Psychic Terrain with the
// non-forced setter (existing higher-priority terrain is respected, and an
// already-Psychic terrain is a silent no-op).
// =============================================================================

import { PostMoveUsedAbAttr, type PostMoveUsedAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
import { TerrainType } from "#data/terrain";
import { PokemonType } from "#enums/pokemon-type";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_GENESIS_SUPERNOVA_ABILITY_ID = 5937;

/**
 * Summons Psychic Terrain whenever the holder uses a Psychic-type move.
 */
export class GenesisSupernovaAbAttr extends PostMoveUsedAbAttr implements GatedAttr<PostMoveUsedAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveUsedAbAttrParams) => boolean) | undefined;

  /**
   * @param terrainType - The terrain the ability sets (default Psychic Terrain).
   * @param moveType - The move type that makes it trigger (default Psychic).
   */
  constructor(
    public readonly terrainType: TerrainType = TerrainType.PSYCHIC,
    public readonly moveType: PokemonType = PokemonType.PSYCHIC,
  ) {
    super();
  }

  /** Tier B (ability studio spec 3.1): everything the rule decides lives in `gate`; there is no residual. */
  public override canApply(params: PostMoveUsedAbAttrParams): boolean {
    return gatedCanApply<PostMoveUsedAbAttrParams>(this, params);
  }

  /** The replaceable condition, in the original order: the holder used the move, and the move resolves to the type. */
  public gate(params: PostMoveUsedAbAttrParams): boolean {
    const { pokemon, source, move } = params;
    // Only react to the HOLDER's own move (PostMoveUsed fires for every field
    // Pokemon; source is the mon that used the move).
    if (source.getBattlerIndex() !== pokemon.getBattlerIndex()) {
      return false;
    }
    return source.getMoveType(move.getMove()) === this.moveType;
  }

  public override apply(params: PostMoveUsedAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    globalScene.arena.trySetTerrain(this.terrainType, false, params.pokemon);
  }
}
