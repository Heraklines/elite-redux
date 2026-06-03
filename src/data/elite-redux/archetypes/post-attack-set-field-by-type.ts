/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — offense-side "set field effect by move type" primitives.
//
// PostAttack ability attrs that deploy a TERRAIN or an entry HAZARD on the
// foe's side when the holder lands a damaging move of a matching type, with a
// per-proc chance. Used by Archmage 455's per-type "add a type-based effect"
// suite: Electric/Psychic/Grass/Fairy moves set their terrain; Rock moves set
// Stealth Rock. Because these live ON the ability, they are inherently gated to
// the ability's holder — no per-user check needed.
// =============================================================================

import { PostAttackAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import { HitResult } from "#enums/hit-result";
import type { PokemonType } from "#enums/pokemon-type";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

/** A successful (non-immune) damaging hit landed by the holder. */
function landedDamagingHit(params: PostMoveInteractionAbAttrParams): boolean {
  return params.hitResult < HitResult.NO_EFFECT;
}

/**
 * On a damaging hit, set a {@linkcode TerrainType} keyed to the move's type
 * (e.g. Electric move → Electric Terrain), with a `chance` roll. `force=false`
 * so terrain-priority rules apply and a no-op is silent.
 */
export class PostAttackSetTerrainByMoveTypeAbAttr extends PostAttackAbAttr {
  private readonly chance: number;
  private readonly terrainByType: ReadonlyMap<PokemonType, TerrainType>;

  constructor(chance: number, terrainByType: ReadonlyMap<PokemonType, TerrainType>) {
    super();
    this.chance = chance;
    this.terrainByType = terrainByType;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params) || !landedDamagingHit(params)) {
      return false;
    }
    if (!this.terrainByType.has(params.move.type)) {
      return false;
    }
    return this.chance >= 100 || params.pokemon.randBattleSeedInt(100) < this.chance;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const terrain = this.terrainByType.get(params.move.type);
    if (terrain !== undefined) {
      globalScene.arena.trySetTerrain(terrain, false, params.pokemon);
    }
  }

  /** Read-only accessor (tests): the configured type → terrain map. */
  public getTerrainByType(): ReadonlyMap<PokemonType, TerrainType> {
    return this.terrainByType;
  }
}

/**
 * On a damaging hit with a move of `moveType`, deploy an entry-hazard arena tag
 * (e.g. Stealth Rock) on the FOE's side, with a `chance` roll.
 */
export class PostAttackSetHazardByMoveTypeAbAttr extends PostAttackAbAttr {
  private readonly chance: number;
  private readonly moveType: PokemonType;
  private readonly tagType: ArenaTagType;

  constructor(chance: number, moveType: PokemonType, tagType: ArenaTagType) {
    super();
    this.chance = chance;
    this.moveType = moveType;
    this.tagType = tagType;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params) || !landedDamagingHit(params)) {
      return false;
    }
    if (params.move.type !== this.moveType) {
      return false;
    }
    return this.chance >= 100 || params.pokemon.randBattleSeedInt(100) < this.chance;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    // Hazards land on the side opposite the attacker (the foe's side).
    const foeSide = params.pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
    globalScene.arena.addTag(this.tagType, 0, undefined, params.pokemon.id, foeSide);
  }

  /** Read-only accessors (tests). */
  public getMoveType(): PokemonType {
    return this.moveType;
  }
  public getTagType(): ArenaTagType {
    return this.tagType;
  }
}
